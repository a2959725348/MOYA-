import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { iso } from './schema.mjs';
import { fail } from './demands.mjs';

const privacyMessage='请先去标识化：删除邮箱、手机号、银行卡号及联系或身份信息后再提交';
const pii=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<!\d)(?:\+?86[ -]?)?1[ -]?[3-9](?:[ -]?\d){9}(?!\d)|(?<!\d)(?:\d[ -]?){13,19}(?!\d)/i;
const privateText=(max,min=0)=>z.string().trim().min(min).max(max).refine(value=>!pii.test(value),privacyMessage);
const keywords=min=>z.array(privateText(80,1)).min(min).max(40).transform(values=>[...new Set(values)]);
const template=privateText(2000,1).refine(value=>!/[{}]/.test(value.replace(/\{\{(?:问题|摘要|关键词)\}\}/g,'')),'模板仅允许 {{问题}}、{{摘要}}、{{关键词}}');
export const configInputSchema=z.object({topicKeywords:keywords(1),demandKeywords:keywords(1),excludeKeywords:keywords(0),replyTemplate:template}).strict();
const configWriteSchema=z.object({expectedRevision:z.number().int().nonnegative(),config:configInputSchema}).strict();
const idSchema=z.string().min(1).max(100);
const reviewSaveSchema=z.object({demandId:idSchema,sourceUpdatedAt:iso,draft:privateText(2000,1),expectedUpdatedAt:iso.nullable()}).strict();
const reviewPatchSchema=z.object({expectedUpdatedAt:iso,status:z.enum(['pending','approved','rejected']),draft:privateText(2000,1).optional(),note:privateText(1000).optional()}).strict();
const configKey='heyboxConfig',logsKey='heyboxLogs',reviewsCollection='heyboxReviews';
const defaults={revision:0,topicKeywords:['ChatGPT','GPT','Plus'],demandKeywords:['如何订阅','支付失败','求教程','订阅'],excludeKeywords:['已经解决','不需要','广告'],replyTemplate:'关于“{{关键词}}”，建议先核对官方订阅说明和具体错误信息。{{摘要}}'};
const labels=Object.freeze({config_saved:'配置已保存',demand_saved:'需求已保存',demands_imported:'需求已导入',demand_deleted:'需求已删除',analysis_completed:'分析已完成',draft_saved:'草稿已保存',review_approved:'审核已批准（不发送）',review_rejected:'审核已退回',review_reset:'审核已重置'});
const nextStamp=previous=>new Date(Math.max(Date.now(),previous?Date.parse(previous)+1:0)).toISOString();
const stale=(store,review)=>store.find('demands',review.demandId)?.updatedAt!==review.sourceUpdatedAt;
const view=(store,review)=>({...review,stale:stale(store,review)});

// Only server code can choose an action. Never persist user content in audit events.
export function appendHeyboxLog(store,action,targetId){
  if(!Object.hasOwn(labels,action))throw new TypeError('Unknown admin audit action');
  const log={id:randomUUID(),at:new Date().toISOString(),action,label:labels[action]};
  // Imported record IDs can be arbitrary. Omit identifiers that may contain PII.
  if(typeof targetId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(targetId)&&!pii.test(targetId))log.targetId=targetId;
  store.set(logsKey,[...store.get(logsKey,[]),log].slice(-300));return log;
}
export function getHeyboxAdmin(store){
  return {version:1,mode:'manual',config:store.get(configKey,structuredClone(defaults)),reviews:store.list(reviewsCollection).map(review=>view(store,review)),logs:store.get(logsKey,[]).slice(-300).reverse(),capabilities:{platformConnected:false,autoRead:false,autoReply:false,follow:false,directMessage:false}};
}
export function saveHeyboxConfig(store,body){
  const input=configWriteSchema.parse(body),current=store.get(configKey,defaults);
  if(input.expectedRevision!==current.revision)throw fail('配置已更新，请重新读取后保存',409);
  const config={revision:current.revision+1,...input.config};store.set(configKey,config);appendHeyboxLog(store,'config_saved');return {config};
}
export function saveHeyboxReview(store,body){
  const input=reviewSaveSchema.parse(body),prior=store.find(reviewsCollection,input.demandId);
  if((prior?.updatedAt??null)!==input.expectedUpdatedAt)throw fail('审核记录已更新，请重新读取后保存',409);
  const source=store.find('demands',input.demandId);
  if(!source||source.updatedAt!==input.sourceUpdatedAt)throw fail('来源已修改或删除，请重新读取需求',409);
  if(!prior&&store.list(reviewsCollection).length>=200)throw fail('草稿数量达到 200 份上限，请先处理已有记录',413);
  const now=nextStamp(prior?.updatedAt);
  const review=store.save(reviewsCollection,{id:input.demandId,demandId:input.demandId,sourceUpdatedAt:input.sourceUpdatedAt,draft:input.draft,status:'pending',note:'',createdAt:prior?.createdAt??now,updatedAt:now},input.demandId,{preserveMetadata:true});
  appendHeyboxLog(store,'draft_saved',review.id);return {review:view(store,review)};
}
export function patchHeyboxReview(store,id,body){
  idSchema.parse(id);const input=reviewPatchSchema.parse(body),prior=store.find(reviewsCollection,id);
  if(!prior)throw fail('审核记录不存在',404);
  if(prior.updatedAt!==input.expectedUpdatedAt)throw fail('审核记录已更新，请重新读取后保存',409);
  if(input.draft!==undefined&&input.status!=='pending')throw fail('修改草稿须保存为待审核，不能同时批准或退回');
  if(input.status==='approved'&&stale(store,prior))throw fail('来源已修改或删除，旧草稿不能批准',409);
  const review=store.save(reviewsCollection,{...prior,status:input.status,...(input.draft!==undefined?{draft:input.draft}:{}),...(input.note!==undefined?{note:input.note}:{}),updatedAt:nextStamp(prior.updatedAt)},id,{preserveMetadata:true});
  appendHeyboxLog(store,input.status==='approved'?'review_approved':input.status==='rejected'?'review_rejected':'review_reset',id);return {review:view(store,review)};
}
// Analysis persistence previously used wall time alone. Preserve its guarded
// behavior while ensuring reanalysis invalidates every prior source version.
export function ensureDemandRevision(store,record,previousUpdatedAt){
  if(Date.parse(record.updatedAt)>Date.parse(previousUpdatedAt))return record;
  return store.save('demands',{...record,updatedAt:nextStamp(previousUpdatedAt)},record.id,{preserveMetadata:true});
}
