import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z,ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './db.mjs';
import { Vault,secretNames } from './vault.mjs';
import { hashPassword,verifyPassword,hashToken,token,issueSession } from './auth.mjs';
import { collections,recordMeta,settingsDefaults,settingsSchema,codexSchema,tasksSyncSchema,iso } from './schema.mjs';
import { transport,validateEndpoint } from './network.mjs';
import { refreshBalances } from './adapters.mjs';
import { createMarketCoordinator } from './market.mjs';
import { studyChat } from './chat.mjs';
import { generateReminders } from './reminders.mjs';
import { saveDemand,importDemands,demandStoredSchema,restoreDemand,prepareAnalysis,requestDemandAnalysis,persistAnalysis,validationMessage } from './demands.mjs';
import { reserveAIRequest,recordAnalysisCost } from './ai-limits.mjs';

const publicPaths=new Set(['/api/auth/status','/api/auth/setup','/api/auth/login']);
const writeMethods=new Set(['POST','PUT','PATCH','DELETE']);
const passwordSchema=z.string().min(12).max(256);
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const constantEqual=(a,b)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
function fields(record) { const {id,createdAt,updatedAt,...rest}=record;return rest; }
function snapshotState(store) {
  const saved=store.get('codex');
  return saved?{...saved,observedAt:saved.observedAt??saved.syncedAt,dailyUsageObservedAt:saved.dailyUsageObservedAt??(saved.dailyUsageBuckets?saved.syncedAt:null),status:saved.error?'error':Date.now()-Date.parse(saved.syncedAt)>600000?'stale':'ok'}:{status:'unconfigured',syncedAt:null,observedAt:null,lastAttemptAt:null,dailyUsageObservedAt:null,rateLimitsByLimitId:null,rateLimits:null,dailyUsageBuckets:null,history:[]};
}
export async function createApp(options={}) {
  const app=Fastify({logger:options.logger??false,bodyLimit:2_000_000,requestTimeout:75000,trustProxy:false});
  const dataDir=resolve(options.dataDir||'data'),store=new Store(dataDir),vault=new Vault(store,dataDir),fetcher=transport(options);
  const origin=options.origin||'http://127.0.0.1:4318',originURL=new URL(origin),secure=originURL.protocol==='https:';
  const allowedOrigins=new Set([originURL.origin]);
  if(options.production!==true&&['127.0.0.1','localhost','[::1]'].includes(originURL.hostname)) {
    allowedOrigins.add('http://localhost:5173');allowedOrigins.add('http://127.0.0.1:5173');
    const localAPI=new URL(`http://${options.apiAddress||'127.0.0.1:4318'}`);
    if(!['127.0.0.1','localhost','[::1]'].includes(localAPI.hostname))throw new Error('Development API address must be loopback');
    allowedOrigins.add(localAPI.origin);
  }
  const allowedHosts=new Set([...allowedOrigins].map(o=>new URL(o).host));
  // Fastify inject defaults to localhost:80; only permit this in explicit fixture contexts.
  if(options.testMode)allowedHosts.add('localhost:80');
  const setupRequiresToken=options.setupToken!=null||!['127.0.0.1','localhost','[::1]'].includes(originURL.hostname);
  await app.register(cookie);
  await app.register(rateLimit,{global:true,max:300,timeWindow:'1 minute',errorResponseBuilder:()=>({error:'请求过于频繁，请稍后再试'})});
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff');reply.header('Referrer-Policy','same-origin');reply.header('X-Frame-Options','DENY');
    let pathname;try{pathname=decodeURIComponent(new URL(request.url,origin).pathname);}catch{return reply.code(400).send({error:'请求路径无效'});}
    // Fastify matches decoded path characters. Never make access decisions on the raw URL.
    const matched=request.routeOptions?.url,route=matched?.startsWith('/api/')?matched:pathname;
    if(!route.startsWith('/api/'))return;
    reply.header('Cache-Control','no-store');
    if(!allowedHosts.has(request.headers.host))return reply.code(403).send({error:'请求 Host 不被允许'});
    if(route.startsWith('/api/sync/')) {
      const value=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],stored=store.get('agentTokenHash');
      if(!value||!stored||!constantEqual(hashToken(value),stored))return reply.code(401).send({error:'同步令牌无效'});
      return;
    }
    if(writeMethods.has(request.method)&&!allowedOrigins.has(request.headers.origin))return reply.code(403).send({error:'请求来源不被允许'});
    const session=request.cookies.workbench_session;
    request.sessionHash=session?hashToken(session):null;
    request.authenticated=!!(request.sessionHash&&store.db.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires>?').get(request.sessionHash,Date.now()));
    if(!publicPaths.has(route)&&!request.authenticated)return reply.code(401).send({error:'请先登录'});
  });
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:validationMessage(error),code:'VALIDATION_ERROR'});
    const status=error.statusCode||500;
    if(status>=500)request.log.error({code:error.code||'SERVER_ERROR'},'Request failed');
    reply.code(status).send({error:status>=500?'服务暂时不可用':error.message,...(error.code==='ESTIMATED_BUDGET_REACHED'?{code:error.code}:{})});
  });
  const settings=()=>{
    const stored=store.get('settings',settingsDefaults),result=structuredClone(stored);
    result.ai.dailyBudget??=null;result.ai.keyConfigured=vault.has('ai.apiKey')||(result.ai.provider==='deepseek'&&vault.has('deepseek.apiKey'))||(result.ai.provider==='openai'&&vault.has('openai.apiKey'));
    result.deepseek.keyConfigured=vault.has('deepseek.apiKey');result.openai.keyConfigured=vault.has('openai.apiKey');
    result.market.alpacaKeyConfigured=vault.has('market.alpacaKey');result.market.alpacaSecretConfigured=vault.has('market.alpacaSecret');result.market.tushareKeyConfigured=vault.has('market.tushareToken');
    result.agent={tokenConfigured:!!store.get('agentTokenHash'),lastSeen:store.get('agentLastSeen')};return result;
  };
  const market=createMarketCoordinator({store,vault,fetcher,settings,testMode:options.testMode,scheduler:options.marketScheduler});
  app.addHook('onClose',async()=>{await market.close();store.close();});
  app.get('/health',async()=>({ok:true}));
  app.get('/api/health',async()=>({ok:true}));
  app.get('/api/auth/status',async request=>({configured:!!store.get('password'),authenticated:request.authenticated,setupRequiresToken}));
  app.post('/api/auth/setup',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request,reply)=>{
    const body=z.object({password:passwordSchema,setupToken:z.string().max(256).optional()}).strict().parse(request.body);
    if(store.get('password'))throw fail('账号已经设置',409);
    if(setupRequiresToken&&(!options.setupToken||!constantEqual(body.setupToken||'',options.setupToken)))throw fail('首次设置令牌无效',403);
    const password=await hashPassword(body.password);
    // Concurrent setup hashing must not permit a second caller to replace the owner.
    if(store.get('password'))throw fail('账号已经设置',409);
    store.set('password',password);issueSession(store,reply,secure);return {ok:true};
  });
  app.post('/api/auth/login',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(request,reply)=>{
    const body=z.object({password:z.string().min(1).max(256)}).strict().parse(request.body);
    if(!await verifyPassword(body.password,store.get('password')))throw fail('密码错误',401);
    store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());issueSession(store,reply,secure);return {ok:true};
  });
  app.post('/api/auth/logout',async(request,reply)=>{store.db.prepare('DELETE FROM sessions WHERE hash=?').run(request.sessionHash);reply.clearCookie('workbench_session',{path:'/',httpOnly:true,sameSite:'strict',secure});return {ok:true};});
  app.post('/api/auth/password',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async request=>{
    const body=z.object({currentPassword:z.string().max(256),newPassword:passwordSchema}).strict().parse(request.body);
    if(!await verifyPassword(body.currentPassword,store.get('password')))throw fail('当前密码错误',401);
    const hashed=await hashPassword(body.newPassword);store.transaction(()=>{store.set('password',hashed);store.db.prepare('DELETE FROM sessions WHERE hash<>?').run(request.sessionHash);});return {ok:true};
  });
  app.get('/api/settings',async()=>settings());
  app.put('/api/settings',async request=>{
    const input=settingsSchema.parse(request.body);if(input.ai?.baseUrl!==undefined)validateEndpoint(input.ai.baseUrl);
    const current=store.get('settings',structuredClone(settingsDefaults));
    store.transaction(()=>{
      for(const section of ['profile','ai','deepseek','openai','market','notifications'])if(input[section])for(const [key,value] of Object.entries(input[section])) {
        const name=`${section}.${key}`;if(secretNames.includes(name)){if(value)vault.set(name,value);}else current[section][key]=value;
      }
      for(const name of input.clearSecrets||[])vault.clear(name);
      current.ai.dailyBudget??=null;
      if(current.ai.dailyBudget!==null&&current.ai.inputPrice===0&&current.ai.outputPrice===0)throw fail('启用费用预算阈值前请配置每百万 token 的输入或输出单价');
      store.set('settings',current);
    });if(input.market||(input.clearSecrets||[]).some(name=>name.startsWith('market.')))market.invalidate();return settings();
  });
  app.get('/api/state',async()=>{
    const config=settings();generateReminders(store,config);
    const watched=new Set(store.list('watchlist').map(w=>`${w.market}:${w.symbol}`)),visible=q=>watched.has(`${q.market}:${q.symbol}`);
    return {...Object.fromEntries(Object.keys(collections).map(c=>[c,store.list(c)])),codex:snapshotState(store),quotes:store.get('quotes',[]).filter(visible),quoteHistory:store.get('quoteHistory',[]).filter(visible).slice(-1000),settings:config,sync:{connected:!!config.agent.lastSeen&&Date.now()-Date.parse(config.agent.lastSeen)<600000,lastSeen:config.agent.lastSeen}};
  });
  for(const [collection,schema] of Object.entries(collections)) {
    app.post(`/api/records/${collection}`,async request=>{if(collection==='demands')return {record:store.transaction(()=>saveDemand(store,request.body))};if(store.list(collection).length>=10000)throw fail('记录数量达到上限',413);const record=store.save(collection,schema.parse(request.body));if(collection==='watchlist')market.invalidate();return {record};});
    app.patch(`/api/records/${collection}/:id`,async request=>{
      const original=store.find(collection,request.params.id);if(!original)throw fail('记录不存在',404);
      if(collection==='demands')return {record:store.transaction(()=>saveDemand(store,request.body,original.id))};
      // Parse only the explicit input object here: Zod partial schemas can inject defaults for omitted keys.
      const changes=z.record(z.string(),z.unknown()).parse(request.body);const record=store.save(collection,schema.parse({...fields(original),...changes}),original.id);if(collection==='watchlist')market.invalidate();return {record};
    });
    app.delete(`/api/records/${collection}/:id`,async request=>{if(!store.remove(collection,request.params.id))throw fail('记录不存在',404);if(collection==='watchlist')market.invalidate();return {ok:true};});
  }
  app.post('/api/agent/token',async()=>{const value=token();store.set('agentTokenHash',hashToken(value));store.set('agentLastSeen',null);return {token:value};});
  const observed=(scope,body)=>{
    const stamp=Date.parse(body.observedAt),now=Date.now();if(stamp>now+120000||stamp<now-7*86400000)throw fail('同步时间过旧或超出允许范围');
    const last=store.get(`syncObserved:${scope}`);if(last&&stamp<Date.parse(last))throw fail('同步快照早于已有数据');
  };
  app.post('/api/sync/codex',async request=>{
    const body=codexSchema.parse(request.body);if(store.hasEvent('codex',body.eventId))return {ok:true,duplicate:true};observed('codex',body);
    store.transaction(()=>{
      const previous=store.get('codex'),history=previous?.history||[];
      const quotaGood=!body.error||body.error==='CODEX_USAGE_UNAVAILABLE'&&(body.rateLimits!=null||body.rateLimitsByLimitId!=null);
      const snapshot={syncedAt:quotaGood?body.observedAt:previous?.syncedAt??null,observedAt:quotaGood?body.observedAt:previous?.observedAt??previous?.syncedAt??null,lastAttemptAt:body.observedAt,rateLimits:quotaGood?body.rateLimits??null:previous?.rateLimits??null,rateLimitsByLimitId:quotaGood?body.rateLimitsByLimitId??null:previous?.rateLimitsByLimitId??null,dailyUsageBuckets:body.error?previous?.dailyUsageBuckets??null:body.dailyUsageBuckets??null,dailyUsageObservedAt:body.error?previous?.dailyUsageObservedAt??(previous?.dailyUsageBuckets?previous.syncedAt:null):body.dailyUsageBuckets!=null?body.observedAt:null,...(body.error?{error:body.error}:{})};
      history.push({...snapshot,observedAt:body.observedAt,eventId:body.eventId});store.set('codex',{...snapshot,history:history.slice(-100)});
      store.event('codex',body.eventId,body.observedAt);store.set('syncObserved:codex',body.observedAt);store.set('agentLastSeen',new Date().toISOString());
    });return {ok:true};
  });
  app.post('/api/sync/tasks',async request=>{
    const body=tasksSyncSchema.parse(request.body);if(store.hasEvent('tasks',body.eventId))return {ok:true,duplicate:true,count:0};observed('tasks',body);
    store.transaction(()=>{
      const existing=store.list('tasks');for(const task of body.tasks){const prior=existing.find(t=>t.source==='chaoxing'&&t.platformId===task.platformId);const saved=store.save('tasks',collections.tasks.parse({...fields(prior||{}),...task,source:'chaoxing'}),prior?.id);if(!prior)existing.push(saved);}
      store.event('tasks',body.eventId,body.observedAt);store.set('syncObserved:tasks',body.observedAt);store.set('agentLastSeen',new Date().toISOString());
    });return {ok:true,count:body.tasks.length};
  });
  app.get('/api/backup',async()=>({version:1,exportedAt:new Date().toISOString(),records:Object.fromEntries(Object.keys(collections).map(c=>[c,store.list(c)])),codex:snapshotState(store)}));
  app.post('/api/backup/restore',{bodyLimit:64_000_000},async request=>{
    const body=z.object({backup:z.object({version:z.literal(1),exportedAt:iso,records:z.record(z.string(),z.array(z.unknown()).max(10000)),codex:z.unknown().optional()}).strict(),mode:z.literal('merge')}).strict().parse(request.body);
    const validated={};
    for(const [collection,list] of Object.entries(body.backup.records)) {
      if(!collections[collection])throw fail('备份包含未知集合');
      validated[collection]=list.map(record=>{const meta=recordMeta.parse({id:record?.id,createdAt:record?.createdAt,updatedAt:record?.updatedAt});return {...(collection==='demands'?demandStoredSchema:collections[collection]).parse(fields(record)),...meta};});
    }
    if(body.backup.codex!=null){const c=body.backup.codex;if(c.syncedAt!==null){codexSchema.parse({eventId:'backup',observedAt:c.syncedAt,rateLimits:c.rateLimits,rateLimitsByLimitId:c.rateLimitsByLimitId,dailyUsageBuckets:c.dailyUsageBuckets,...(c.error?{error:c.error}:{})});}}
    const counts={};store.transaction(()=>{for(const [collection,list] of Object.entries(validated)){counts[collection]=0;for(const record of list){const existing=store.find(collection,record.id);if(!existing||Date.parse(record.updatedAt)>Date.parse(existing.updatedAt)){if(collection==='demands'){if(restoreDemand(store,record))counts[collection]++;}else{store.save(collection,record,record.id,{preserveMetadata:true});counts[collection]++;}}}}});
    // Quota snapshot from a backup is not a live observation; retain current assistant state.
    if(validated.watchlist)market.invalidate();return {ok:true,counts};
  });
  app.post('/api/providers/balances/refresh',async()=>refreshBalances(store,vault,fetcher));
  app.post('/api/market/refresh',async()=>market.refresh());
  app.post('/api/study/chat',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>studyChat(request,reply,{store,vault,fetcher,settings:settings()}));
  app.post('/api/demands/import',async request=>importDemands(store,request.body));
  app.post('/api/demands/:id/analyze',async request=>{
    z.object({}).strict().parse(request.body);
    const accountingEvent=token();
    const reserved=store.transaction(()=>{const result=prepareAnalysis(store,request.params.id,settings().ai,vault);reserveAIRequest(store,result.ai);return result;});
    const analysis=await requestDemandAnalysis({...reserved,fetcher});
    // Successful paid usage survives a later session/source rejection. This
    // independent transaction stores accounting only, never stale answer text.
    store.transaction(()=>recordAnalysisCost(store,reserved.record,analysis,accountingEvent));
    return store.transaction(()=>{
      if(!store.db.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires>?').get(request.sessionHash,Date.now()))throw fail('请先登录',401);
      const current=store.find('demands',reserved.record.id);
      if(!current||current.updatedAt!==reserved.record.updatedAt||current.text!==reserved.record.text||current.sourceUrl!==reserved.record.sourceUrl)throw fail('需求在分析期间已修改或删除，请重新分析',409);
      return {record:persistAnalysis(store,reserved.record,analysis)};
    });
  });
  if(options.root&&existsSync(resolve(options.root,'index.html'))) {
    await app.register(staticFiles,{root:resolve(options.root),prefix:'/',index:['index.html']});
    app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:'接口不存在'}):reply.sendFile('index.html'));
  }
  await app.ready();return app;
}
