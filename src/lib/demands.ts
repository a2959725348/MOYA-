import type {Demand,DemandCategory,DemandInput,Consultation} from './types'
export const categoryLabels:Record<DemandCategory,string>={subscription_question:'订阅问题',payment_failure:'支付失败',api_credits:'API 额度',card_question:'卡片问题',alternative:'替代方案',already_solved:'已经解决',promotion:'广告推广',unrelated:'无关',uncertain:'不确定'}
export const sourceLabels={manual:'手动录入',voluntary:'自愿提供',sample:'合成示例'}
export const statusLabels={pending:'待审核',approved:'人工通过',dismissed:'已忽略'}
export type DemandFilters={search:string;category:DemandCategory|'all'|'unanalyzed';status:Demand['status']|'all'}
export function filterDemands(records:Demand[],filters:DemandFilters){
 const search=filters.search.trim().toLowerCase()
 return records.filter(r=>(!search||`${r.text}\n${r.sourceUrl}`.toLowerCase().includes(search))&&(filters.category==='all'||(filters.category==='unanalyzed'?!r.analysis:r.analysis?.category===filters.category))&&(filters.status==='all'||r.status===filters.status))
}
export function evaluateDemands(records:Demand[]){
 const selected=records.filter(r=>r.expectedCategory&&r.analysis),agreed=selected.filter(r=>r.expectedCategory===r.analysis!.category).length
 return {labelled:records.filter(r=>r.expectedCategory).length,analyzed:records.filter(r=>r.analysis).length,total:selected.length,agreed,agreement:selected.length?agreed/selected.length:null,models:[...new Set(selected.map(r=>r.analysis!.model))]}
}
export function parseDemandImport(text:string,confirmed:boolean):DemandInput[]{
 if(!confirmed)throw new Error('请确认有权使用这些内容并已完成去标识化')
 let items:unknown
 try{items=JSON.parse(text)}catch{throw new Error('JSON 语法错误：请检查双引号、逗号和括号')}
 if(!Array.isArray(items)||items.length<1||items.length>20)throw new Error('请提供包含 1–20 条记录的 JSON 数组')
 return items.map((value,index)=>{
  const fail=(message:string):never=>{throw new Error(`第 ${index+1} 条：${message}`)}
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('必须是记录对象')
  const v=value as Record<string,unknown>
  if(Object.keys(v).some(k=>!['text','source','sourceUrl','rightsConfirmed','expectedCategory','status'].includes(k)))return fail('只允许原文、来源、链接、确认、参考类别和审核状态；不能导入 AI 分析')
  if(typeof v.text!=='string'||!v.text.trim()||v.text.trim().length>4000)return fail('原文须为 1–4000 字')
  if(!['manual','voluntary','sample'].includes(String(v.source)))return fail('来源须为 manual、voluntary 或 sample')
  if(v.rightsConfirmed!==undefined&&v.rightsConfirmed!==true)return fail('授权确认须为 true')
  if(v.sourceUrl!==undefined&&typeof v.sourceUrl!=='string')return fail('来源链接须为文字')
  const sourceUrl=typeof v.sourceUrl==='string'?v.sourceUrl.trim():''
  if(sourceUrl){try{const u=new URL(sourceUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||sourceUrl.length>2000)return fail('来源链接须为无账号密码、无查询参数的 HTTP/HTTPS 地址')}catch{return fail('来源链接格式无效')}}
  if(v.expectedCategory!==undefined&&v.expectedCategory!==null&&!Object.hasOwn(categoryLabels,String(v.expectedCategory)))return fail('参考类别无效')
  if(v.status!==undefined&&!['pending','approved','dismissed'].includes(String(v.status)))return fail('审核状态无效')
  return {text:v.text.trim(),source:v.source as DemandInput['source'],sourceUrl,rightsConfirmed:true,...(v.expectedCategory!==undefined?{expectedCategory:v.expectedCategory as DemandCategory|null}:{}),status:(v.status??'pending') as DemandInput['status']}
 })
}
export function normalizeDemandCollections<T extends object>(state:T):T&{demands:Demand[];consultations:Consultation[]}{
 const collections=state as {demands?:Demand[];consultations?:Consultation[]}
 return {...state,demands:collections.demands??[],consultations:collections.consultations??[]}
}
export const syntheticDemands:DemandInput[]=[
 {text:'【合成示例】订阅付款失败，官方支持页面有哪些排查建议？我希望先了解限制和费用。',source:'sample',sourceUrl:'',rightsConfirmed:true,expectedCategory:'payment_failure',status:'pending'},
 {text:'【合成示例】之前订阅失败，但已经解决了，现在不需要帮助。',source:'sample',sourceUrl:'',rightsConfirmed:true,expectedCategory:'already_solved',status:'pending'},
 {text:'【合成示例】今晚和朋友一起玩游戏，聊聊新地图的风景。',source:'sample',sourceUrl:'',rightsConfirmed:true,expectedCategory:'unrelated',status:'pending'},
 {text:'【合成示例·广告】这是推广广告：某工具订阅限时优惠，欢迎围观。',source:'sample',sourceUrl:'',rightsConfirmed:true,expectedCategory:'promotion',status:'pending'},
]
