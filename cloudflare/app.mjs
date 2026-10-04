import { z,ZodError } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { D1Store,withStore,ConflictError } from './store.mjs';
import { Vault,secretNames } from './vault.mjs';
import { hashPassword,verifyPassword,hashToken,token } from '../server/auth.mjs';
import { collections,recordMeta,settingsDefaults,settingsSchema,codexSchema,tasksSyncSchema,iso } from '../server/schema.mjs';
import { refreshBalances,refreshMarkets } from '../server/adapters.mjs';
import { generateReminders } from '../server/reminders.mjs';
import { transport,validateEndpoint } from './network.mjs';
import { handleChat } from './chat.mjs';
import { budgetDatabase } from './budget.mjs';

const publicPaths=new Set(['/api/auth/status','/api/auth/setup','/api/auth/login']);
const writeMethods=new Set(['POST','PUT','PATCH','DELETE']);
const passwordSchema=z.string().min(12).max(256);
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const constantEqual=(a,b)=>{const left=Buffer.from(String(a)),right=Buffer.from(String(b));return left.length===right.length&&timingSafeEqual(left,right);};
const fields=record=>{const {id,createdAt,updatedAt,...rest}=record;return rest;};
const sessionCookie=(value,maxAge=7*86400)=>`workbench_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const issueSession=store=>{const value=token();store.addSession(hashToken(value),Date.now()+7*86400000);return sessionCookie(value);};
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY',...extra}});
const authenticated=(store,hash)=>{const session=hash&&store.getSession(hash);return !!(session&&session.expires>Date.now());};
function settings(store,vault) {
  const result=structuredClone(store.get('settings',settingsDefaults));
  result.ai.dailyBudget??=null;
  result.ai.keyConfigured=vault.has('ai.apiKey')||(result.ai.provider==='deepseek'&&vault.has('deepseek.apiKey'))||(result.ai.provider==='openai'&&vault.has('openai.apiKey'));
  result.deepseek.keyConfigured=vault.has('deepseek.apiKey');result.openai.keyConfigured=vault.has('openai.apiKey');
  result.market.alpacaKeyConfigured=vault.has('market.alpacaKey');result.market.alpacaSecretConfigured=vault.has('market.alpacaSecret');result.market.tushareKeyConfigured=vault.has('market.tushareToken');
  result.agent={tokenConfigured:!!store.get('agentTokenHash'),lastSeen:store.get('agentLastSeen')};return result;
}
function snapshotState(store) {
  const saved=store.get('codex');
  return saved?{...saved,observedAt:saved.observedAt??saved.syncedAt,dailyUsageObservedAt:saved.dailyUsageObservedAt??(saved.dailyUsageBuckets?saved.syncedAt:null),status:saved.error?'error':Date.now()-Date.parse(saved.syncedAt)>600000?'stale':'ok'}:{status:'unconfigured',syncedAt:null,observedAt:null,lastAttemptAt:null,dailyUsageObservedAt:null,rateLimitsByLimitId:null,rateLimits:null,dailyUsageBuckets:null,history:[]};
}
async function readBody(request) {
  if(Number(request.headers.get('content-length'))>2_000_000)throw fail('请求内容过大',413);
  const reader=request.body?.getReader();if(!reader)return undefined;
  let size=0,text='';const decoder=new TextDecoder();
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000)throw fail('请求内容过大',413);text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();if(!text)return undefined;
    try{return JSON.parse(text);}catch{throw fail('请求 JSON 无效');}
  }finally{await reader.cancel().catch(()=>{});}
}
async function rateLimit(db,key,max,windowMs) {
  const now=Date.now(),expires=now+windowMs;
  const row=await db.prepare('INSERT INTO cloudflare_rate_limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count,expires').bind(key,expires,now,now).first();
  if(!row||row.count>max)throw fail('请求过于频繁，请稍后再试',429);
}
async function localRequest(store,env,requestInfo,body) {
  try{const result=await routeLocal(store,env,requestInfo,body);await store.commit();return result;}
  catch(error){if(!(error instanceof ConflictError))throw error;return withStore(env.DB,latest=>routeLocal(latest,env,requestInfo,body),{retries:4});}
}
function observed(store,scope,body) {
  const stamp=Date.parse(body.observedAt),now=Date.now();if(stamp>now+120000||stamp<now-7*86400000)throw fail('同步时间过旧或超出允许范围');
  const last=store.get(`syncObserved:${scope}`);if(last&&stamp<Date.parse(last))throw fail('同步快照早于已有数据');
}
function invalidateMarket(store) {store.set('marketGeneration',token());store.set('marketCache',null);}
function authorize(store,{path,sessionHash,bearer}) {
  if(path.startsWith('/api/sync/')){
    const expected=store.get('agentTokenHash');if(!bearer||!expected||!constantEqual(hashToken(bearer),expected))throw fail('同步令牌无效',401);
  }else if(!publicPaths.has(path)&&!authenticated(store,sessionHash))throw fail('请先登录',401);
}
async function routeLocal(store,env,requestInfo,body) {
  const {path,method,sessionHash}=requestInfo;authorize(store,requestInfo);
  const vault=new Vault(store,env.VAULT_KEY);
  if(method==='GET'&&path==='/api/health')return {ok:true};
  if(method==='GET'&&path==='/api/auth/status')return {configured:!!store.get('password'),authenticated:authenticated(store,sessionHash),setupRequiresToken:true};
  if(method==='POST'&&path==='/api/auth/setup'){
    const input=z.object({password:passwordSchema,setupToken:z.string().max(256).optional()}).strict().parse(body);
    if(store.get('password'))throw fail('账号已经设置',409);
    if(!env.SETUP_TOKEN||!constantEqual(input.setupToken||'',env.SETUP_TOKEN))throw fail('首次设置令牌无效',403);
    store.set('password',await hashPassword(input.password));return {body:{ok:true},cookie:issueSession(store)};
  }
  if(method==='POST'&&path==='/api/auth/login'){
    const input=z.object({password:z.string().min(1).max(256)}).strict().parse(body);
    if(!await verifyPassword(input.password,store.get('password')))throw fail('密码错误',401);
    store.pruneSessions(Date.now());return {body:{ok:true},cookie:issueSession(store)};
  }
  if(method==='POST'&&path==='/api/auth/logout'){store.deleteSession(sessionHash);return {body:{ok:true},cookie:sessionCookie('',0)};}
  if(method==='POST'&&path==='/api/auth/password'){
    const input=z.object({currentPassword:z.string().max(256),newPassword:passwordSchema}).strict().parse(body);
    if(!await verifyPassword(input.currentPassword,store.get('password')))throw fail('当前密码错误',401);
    store.set('password',await hashPassword(input.newPassword));store.deleteOtherSessions(sessionHash);return {ok:true};
  }
  if(method==='GET'&&path==='/api/settings')return settings(store,vault);
  if(method==='PUT'&&path==='/api/settings'){
    const input=settingsSchema.parse(body);if(input.ai?.baseUrl!==undefined)validateEndpoint(input.ai.baseUrl,env);
    const current=structuredClone(store.get('settings',settingsDefaults));
    for(const section of ['profile','ai','deepseek','openai','market','notifications'])if(input[section])for(const [key,value] of Object.entries(input[section])){
      const name=`${section}.${key}`;if(secretNames.includes(name)){if(value)vault.set(name,value);}else current[section][key]=value;
    }
    for(const name of input.clearSecrets||[])vault.clear(name);
    current.ai.dailyBudget??=null;if(current.ai.dailyBudget!==null&&current.ai.inputPrice===0&&current.ai.outputPrice===0)throw fail('启用费用预算阈值前请配置每百万 token 的输入或输出单价');
    store.set('settings',current);if(input.market||(input.clearSecrets||[]).some(name=>name.startsWith('market.')))invalidateMarket(store);
    if(input.deepseek||input.openai||(input.clearSecrets||[]).some(name=>name.startsWith('deepseek.')||name.startsWith('openai.')))store.set('balanceRefreshGeneration',token());
    return settings(store,vault);
  }
  if(method==='GET'&&path==='/api/state'){
    const config=settings(store,vault);generateReminders(store,config);
    const watched=new Set(store.list('watchlist').map(w=>`${w.market}:${w.symbol}`)),visible=q=>watched.has(`${q.market}:${q.symbol}`);
    return {...Object.fromEntries(Object.keys(collections).map(c=>[c,store.list(c)])),codex:snapshotState(store),quotes:store.get('quotes',[]).filter(visible),quoteHistory:store.get('quoteHistory',[]).filter(visible).slice(-1000),settings:config,sync:{connected:!!config.agent.lastSeen&&Date.now()-Date.parse(config.agent.lastSeen)<600000,lastSeen:config.agent.lastSeen}};
  }
  const recordMatch=path.match(/^\/api\/records\/([^/]+)(?:\/([^/]+))?$/);
  if(recordMatch&&Object.hasOwn(collections,recordMatch[1])){
    const [,collection,id]=recordMatch,schema=collections[collection];let result;
    if(method==='POST'&&!id){if(store.list(collection).length>=10000)throw fail('记录数量达到上限',413);result={record:store.save(collection,schema.parse(body))};}
    else if(method==='PATCH'&&id){const original=store.find(collection,id);if(!original)throw fail('记录不存在',404);const changes=z.record(z.string(),z.unknown()).parse(body);result={record:store.save(collection,schema.parse({...fields(original),...changes}),id)};}
    else if(method==='DELETE'&&id){if(!store.remove(collection,id))throw fail('记录不存在',404);result={ok:true};}
    if(result){if(collection==='watchlist')invalidateMarket(store);return result;}
  }
  if(method==='POST'&&path==='/api/agent/token'){const value=token();store.set('agentTokenHash',hashToken(value));store.set('agentLastSeen',null);return {token:value};}
  if(method==='POST'&&path==='/api/sync/codex'){
    const input=codexSchema.parse(body);if(store.hasEvent('codex',input.eventId))return {ok:true,duplicate:true};observed(store,'codex',input);
    const previous=store.get('codex'),history=previous?.history||[],quotaGood=!input.error||input.error==='CODEX_USAGE_UNAVAILABLE'&&(input.rateLimits!=null||input.rateLimitsByLimitId!=null);
    const snapshot={syncedAt:quotaGood?input.observedAt:previous?.syncedAt??null,observedAt:quotaGood?input.observedAt:previous?.observedAt??previous?.syncedAt??null,lastAttemptAt:input.observedAt,rateLimits:quotaGood?input.rateLimits??null:previous?.rateLimits??null,rateLimitsByLimitId:quotaGood?input.rateLimitsByLimitId??null:previous?.rateLimitsByLimitId??null,dailyUsageBuckets:input.error?previous?.dailyUsageBuckets??null:input.dailyUsageBuckets??null,dailyUsageObservedAt:input.error?previous?.dailyUsageObservedAt??(previous?.dailyUsageBuckets?previous.syncedAt:null):input.dailyUsageBuckets!=null?input.observedAt:null,...(input.error?{error:input.error}:{})};
    history.push({...snapshot,observedAt:input.observedAt,eventId:input.eventId});store.set('codex',{...snapshot,history:history.slice(-100)});store.event('codex',input.eventId,input.observedAt);store.set('syncObserved:codex',input.observedAt);store.set('agentLastSeen',new Date().toISOString());return {ok:true};
  }
  if(method==='POST'&&path==='/api/sync/tasks'){
    const input=tasksSyncSchema.parse(body);if(store.hasEvent('tasks',input.eventId))return {ok:true,duplicate:true,count:0};observed(store,'tasks',input);
    const existing=store.list('tasks');for(const task of input.tasks){const prior=existing.find(t=>t.source==='chaoxing'&&t.platformId===task.platformId);if(!prior&&existing.length>=10000)throw fail('记录数量达到上限',413);const saved=store.save('tasks',collections.tasks.parse({...fields(prior||{}),...task,source:'chaoxing'}),prior?.id);if(!prior)existing.push(saved);}
    store.event('tasks',input.eventId,input.observedAt);store.set('syncObserved:tasks',input.observedAt);store.set('agentLastSeen',new Date().toISOString());return {ok:true,count:input.tasks.length};
  }
  if(method==='GET'&&path==='/api/backup')return {version:1,exportedAt:new Date().toISOString(),records:Object.fromEntries(Object.keys(collections).map(c=>[c,store.list(c)])),codex:snapshotState(store)};
  if(method==='POST'&&path==='/api/backup/restore'){
    const input=z.object({backup:z.object({version:z.literal(1),exportedAt:iso,records:z.record(z.string(),z.array(z.unknown()).max(10000)),codex:z.unknown().optional()}).strict(),mode:z.literal('merge')}).strict().parse(body),validated={};
    for(const [collection,list] of Object.entries(input.backup.records)){
      if(!Object.hasOwn(collections,collection))throw fail('备份包含未知集合');
      validated[collection]=list.map(record=>{const meta=recordMeta.parse({id:record?.id,createdAt:record?.createdAt,updatedAt:record?.updatedAt});return {...collections[collection].parse(fields(record)),...meta};});
      if(new Set([...store.list(collection).map(r=>r.id),...validated[collection].map(r=>r.id)]).size>10000)throw fail('记录数量达到上限',413);
    }
    if(input.backup.codex!=null){const c=input.backup.codex;if(c.syncedAt!==null)codexSchema.parse({eventId:'backup',observedAt:c.syncedAt,rateLimits:c.rateLimits,rateLimitsByLimitId:c.rateLimitsByLimitId,dailyUsageBuckets:c.dailyUsageBuckets,...(c.error?{error:c.error}:{})});}
    const counts={};for(const [collection,list] of Object.entries(validated)){counts[collection]=0;for(const record of list){const existing=store.find(collection,record.id);if(!existing||Date.parse(record.updatedAt)>Date.parse(existing.updatedAt)){store.save(collection,record,record.id,{preserveMetadata:true});counts[collection]++;}}}
    if(validated.watchlist)invalidateMarket(store);return {ok:true,counts};
  }
  throw fail('接口不存在',404);
}
async function providerRequest(requestInfo,env,fetcher,store) {
  if(requestInfo.path==='/api/providers/balances/refresh'){
    // Claim this refresh before contacting providers. A later refresh or secret
    // change invalidates its result without replaying any network requests.
    const generation=token();
    store=await withStore(env.DB,latest=>{authorize(latest,requestInfo);latest.set('balanceRefreshGeneration',generation);return latest;});
    const vault=new Vault(store,env.VAULT_KEY);
    const result=await refreshBalances(store,vault,fetcher),updates=result.accounts.filter(a=>a.source==='api'&&result.results.some(r=>r.provider===a.provider&&r.status==='ok'));
    return withStore(env.DB,async latest=>{
      authorize(latest,requestInfo);
      if(latest.get('balanceRefreshGeneration')!==generation)return {...result,accounts:latest.list('accounts'),discarded:true};
      for(const account of updates)latest.save('accounts',account,account.id,{preserveMetadata:true});return {...result,accounts:latest.list('accounts')};
    },{retries:5});
  }
  const vault=new Vault(store,env.VAULT_KEY);
  const cached=store.get('marketCache');if(cached&&Date.now()-cached.at<30000)return cached.result;
  const generation=store.get('marketGeneration'),result=await refreshMarkets(store,vault,fetcher,settings(store,vault));
  const fetchedHistory=store.get('quoteHistory',[]);
  return withStore(env.DB,async latest=>{
    authorize(latest,requestInfo);
    if(latest.get('marketGeneration')!==generation)return {quotes:latest.get('quotes',[]),results:result.results};
    const watched=new Set(latest.list('watchlist').map(w=>`${w.market}:${w.symbol}`));
    const quotes=latest.get('quotes',[]).filter(q=>watched.has(`${q.market}:${q.symbol}`));
    for(const quote of result.quotes){if(!watched.has(`${quote.market}:${quote.symbol}`))continue;const index=quotes.findIndex(q=>q.market===quote.market&&q.symbol===quote.symbol);if(index<0)quotes.push(quote);else if(Date.parse(quote.asOf)>=Date.parse(quotes[index].asOf))quotes[index]=quote;}
    const history=latest.get('quoteHistory',[]),key=q=>`${q.market}:${q.symbol}:${q.asOf}`,seen=new Set(history.map(key));for(const quote of fetchedHistory)if(watched.has(`${quote.market}:${quote.symbol}`)&&!seen.has(key(quote))){history.push(quote);seen.add(key(quote));}
    latest.set('quotes',quotes);latest.set('quoteHistory',history.slice(-10000));const merged={quotes,results:result.results};latest.set('marketCache',{at:Date.now(),result:merged});return merged;
  },{retries:5});
}
export async function handleRequest(request,env,ctx={},options={}) {
  try{
    let origin;try{origin=new URL(env.APP_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.APP_ORIGIN)throw new Error();}catch{throw fail('服务暂时不可用',503);}
    const url=new URL(request.url);if(url.origin!==origin.origin)throw fail('请求 Host 不被允许',403);
    let path;try{path=decodeURIComponent(url.pathname);}catch{throw fail('请求路径无效');}
    if(path==='/health'&&request.method==='GET')return json({ok:true});
    if(!path.startsWith('/api/'))throw fail('接口不存在',404);
    if(!env.DB||!env.VAULT_KEY)throw fail('服务暂时不可用',503);
    env={...env,DB:budgetDatabase(env.DB)};
    const method=request.method;
    if(writeMethods.has(method)&&!path.startsWith('/api/sync/')&&request.headers.get('origin')!==origin.origin)throw fail('请求来源不被允许',403);
    const session=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('workbench_session='))?.slice('workbench_session='.length),sessionHash=session?hashToken(session):null;
    const bearer=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],requestInfo={path,method,sessionHash,bearer};
    const ip=hashToken(request.headers.get('cf-connecting-ip')||'unknown');
    await env.DB.prepare('DELETE FROM cloudflare_rate_limits WHERE key IN (SELECT key FROM cloudflare_rate_limits WHERE expires<=? LIMIT 100)').bind(Date.now()).run();
    await rateLimit(env.DB,`global:${ip}`,300,60000);
    let initial=await D1Store.open(env.DB);authorize(initial,requestInfo);
    const limits={'/api/auth/setup':[5,60000],'/api/auth/login':[10,300000],'/api/auth/password':[5,300000],'/api/study/chat':[10,60000]};
    if(method==='POST'&&limits[path])await rateLimit(env.DB,`route:${path}:${ip}`,...limits[path]);
    const body=writeMethods.has(method)?await readBody(request):undefined;
    const fetcher=transport(env,{nativeFetch:options.fetcher});
    if(method==='POST'&&path==='/api/study/chat'){
      const response=await handleChat(request,env,ctx,{body,fetcher,sessionHash});
      response.headers.set('Referrer-Policy','same-origin');response.headers.set('X-Frame-Options','DENY');
      if(!response.headers.has('Cache-Control'))response.headers.set('Cache-Control','no-store');return response;
    }
    if(method==='GET'&&path==='/api/state'){
      const vault=new Vault(initial,env.VAULT_KEY),config=settings(initial,vault),cached=initial.get('marketCache');
      const configured=initial.list('watchlist').some(item=>item.market==='US'?vault.has('market.alpacaKey')&&vault.has('market.alpacaSecret'):vault.has('market.tushareToken'));
      if(configured&&(!cached||Date.now()-cached.at>=config.market.refreshSeconds*1000)){
        await providerRequest(requestInfo,env,fetcher,initial);initial=await D1Store.open(env.DB);
      }
    }
    const result=method==='POST'&&['/api/providers/balances/refresh','/api/market/refresh'].includes(path)?await providerRequest(requestInfo,env,fetcher,initial):await localRequest(initial,env,requestInfo,body);
    return result?.cookie?json(result.body,200,{'Set-Cookie':result.cookie}):json(result);
  }catch(error){
    if(error instanceof ZodError)return json({error:'提交字段无效，请检查必填项、日期和数值',code:'VALIDATION_ERROR'},400);
    const status=error instanceof ConflictError?409:error.statusCode||500;
    return json({error:status>=500?'服务暂时不可用':error instanceof ConflictError?'数据同时更新，请重试':error.message},status);
  }
}
