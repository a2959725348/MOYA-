import test from 'node:test';
import assert from 'node:assert/strict';
const appModule=await import('../cloudflare/app.mjs').catch(()=>({}));
const networkModule=await import('../cloudflare/network.mjs').catch(()=>({}));
const helper=await import('./helpers/d1.mjs').catch(()=>({}));
const origin='https://moyaiwork.com';
const password='correct horse battery staple';
async function fixture(options={}) {
  assert.equal(typeof appModule.handleRequest,'function','Fetch API handler must exist');
  const db=await helper.createTestDB();
  const env={DB:db,APP_ORIGIN:origin,SETUP_TOKEN:'root-test-setup-token',VAULT_KEY:Buffer.alloc(32,7).toString('base64')};
  let cookie='';
  const request=async(path,{method='GET',body,headers={},rawBody}={})=>{
    const response=await appModule.handleRequest(new Request(origin+path,{method,headers:{...(method!=='GET'?{'Origin':origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),...(rawBody!==undefined?{body:rawBody}:{})}),env,{},options);
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  const setup=async()=>request('/api/auth/setup',{method:'POST',body:{password,setupToken:env.SETUP_TOKEN}});
  return {env,request,setup,getCookie:()=>cookie};
}
test('edge auth requires configured origin and setup token and persists sessions',async()=>{
  const f=await fixture();
  assert.equal((await f.request('/api/state')).status,401);
  assert.equal((await f.request('/api/auth/setup',{method:'POST',body:{password},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await f.request('/api/auth/setup',{method:'POST',body:{password}})).status,403);
  const response=await f.setup();assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/Secure/);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
  assert.deepEqual(await (await f.request('/api/auth/status')).json(),{configured:true,authenticated:true,setupRequiresToken:true});
  assert.equal((await f.setup()).status,409);
  assert.equal((await f.request('/api/auth/logout',{method:'POST',body:{}})).status,200);
  assert.equal((await f.request('/api/state')).status,401);
  assert.equal((await f.request('/api/auth/login',{method:'POST',body:{password}})).status,200);
  assert.equal((await f.request('/api/state')).status,200);
});
test('edge records enforce validation, preserve omitted fields, and restore newer metadata',async()=>{
  const f=await fixture();await f.setup();
  assert.equal((await f.request('/api/records/tasks',{method:'POST',body:{title:'',dueAt:'bad'}})).status,400);
  const {record}=await (await f.request('/api/records/tasks',{method:'POST',body:{title:'Revision',course:'English',status:'completed'}})).json();
  const updated=await (await f.request('/api/records/tasks/'+record.id,{method:'PATCH',body:{title:'Revised'}})).json();
  assert.equal(updated.record.course,'English');assert.equal(updated.record.status,'completed');
  const backup=await (await f.request('/api/backup')).json();
  backup.records.tasks[0].title='Imported';backup.records.tasks[0].updatedAt=new Date(Date.now()+60000).toISOString();
  const result=await (await f.request('/api/backup/restore',{method:'POST',body:{backup,mode:'merge'}})).json();
  assert.equal(result.counts.tasks,1);assert.equal((await (await f.request('/api/state')).json()).tasks[0].title,'Imported');
  assert.equal((await f.request('/api/records/tasks/'+record.id,{method:'DELETE'})).status,200);
  assert.equal((await f.request('/api/records/tasks/'+record.id,{method:'DELETE'})).status,404);
});
test('edge settings encrypt secrets and validate approved endpoint hosts',async()=>{
  const f=await fixture();await f.setup();
  const response=await f.request('/api/settings',{method:'PUT',body:{deepseek:{apiKey:'fixture-private-key'}}});
  assert.equal(response.status,200);assert.equal((await response.json()).deepseek.keyConfigured,true);
  assert.equal(JSON.stringify(await (await f.request('/api/state')).json()).includes('fixture-private-key'),false);
  assert.equal((await f.request('/api/settings',{method:'PUT',body:{ai:{baseUrl:'https://unapproved.example'}}})).status,400);
  assert.equal((await f.request('/api/settings',{method:'PUT',body:{ai:{dailyBudget:1}}})).status,400);
  const cleared=await (await f.request('/api/settings',{method:'PUT',body:{clearSecrets:['deepseek.apiKey']}})).json();assert.equal(cleared.deepseek.keyConfigured,false);
});
test('edge sync deduplicates, rejects old snapshots, and retains last good quota',async()=>{
  const f=await fixture();await f.setup();const {token}=await (await f.request('/api/agent/token',{method:'POST'})).json();
  const send=body=>f.request('/api/sync/codex',{method:'POST',body,headers:{Authorization:`Bearer ${token}`,Origin:'https://agent.invalid'}});
  const stamp=new Date().toISOString();const body={eventId:'one',observedAt:stamp,rateLimits:{primary:{usedPercent:30,resetsAt:Math.floor(Date.now()/1000)+3600}},dailyUsageBuckets:[{startDate:'2026-10-01',tokens:25}]};
  assert.equal((await send(body)).status,200);assert.equal((await (await send(body)).json()).duplicate,true);
  assert.equal((await send({...body,eventId:'old',observedAt:new Date(Date.now()-10000).toISOString()})).status,400);
  assert.equal((await send({eventId:'error',observedAt:new Date(Date.now()+1000).toISOString(),error:'CODEX_OFFLINE'})).status,200);
  const state=await (await f.request('/api/state')).json();assert.equal(state.codex.rateLimits.primary.usedPercent,30);assert.equal(state.codex.dailyUsageBuckets[0].tokens,25);assert.equal(state.codex.history.length,2);assert.equal(state.codex.status,'error');
});
test('edge task sync upserts platform tasks without creating duplicates',async()=>{
  const f=await fixture();await f.setup();const {token}=await (await f.request('/api/agent/token',{method:'POST'})).json();
  const send=body=>f.request('/api/sync/tasks',{method:'POST',body,headers:{Authorization:`Bearer ${token}`}});
  const body={eventId:'tasks-1',observedAt:new Date().toISOString(),tasks:[{platformId:'p1',title:'Quiz',status:'pending'}]};
  assert.equal((await send(body)).status,200);assert.equal((await (await send(body)).json()).duplicate,true);
  assert.equal((await send({...body,eventId:'tasks-2',tasks:[{platformId:'p1',title:'Quiz updated',status:'completed'}]})).status,200);
  const state=await (await f.request('/api/state')).json();assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].title,'Quiz updated');assert.equal(state.tasks[0].source,'chaoxing');
});
test('edge rejects oversized request bodies and rate limits login attempts persistently',async()=>{
  const f=await fixture();await f.setup();
  assert.equal((await f.request('/api/backup/restore',{method:'POST',rawBody:' '.repeat(2_000_001)})).status,413);
  for(let i=0;i<10;i++)assert.equal((await f.request('/api/auth/login',{method:'POST',body:{password:'incorrect'}})).status,401);
  assert.equal((await f.request('/api/auth/login',{method:'POST',body:{password:'incorrect'}})).status,429);
});
test('edge transport permits HTTPS approved hosts and blocks redirects and private addresses',async()=>{
  assert.equal(typeof networkModule.transport,'function','edge safe transport must exist');
  let redirected;
  const fetcher=networkModule.transport({AI_ALLOWED_HOSTS:'api.example.com'},{nativeFetch:async(url,init)=>{redirected=init.redirect;return new Response('{}');}});
  for(const url of ['http://api.deepseek.com','https://127.0.0.1','https://localhost','https://10.1.1.1','https://unapproved.example','https://api.deepseek.com:8443','https://user:pass@api.deepseek.com'])await assert.rejects(fetcher(url));
  assert.equal((await fetcher('https://api.example.com/v1?limit=1')).status,200);assert.equal(redirected,'manual');
});

test('edge transport rejects redirects without forwarding API credentials to another host',async()=>{
  let calls=0;
  const fetcher=networkModule.transport({}, {nativeFetch:async(url,init)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(init.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});
  }});
  await assert.rejects(fetcher('https://api.deepseek.com/user/balance',{headers:{Authorization:'Bearer fixture-secret'}}),/REDIRECT_BLOCKED/);
  assert.equal(calls,1);
});
test('edge market refresh reuses persistent cache without repeating upstream requests',async()=>{
  let calls=0;
  const f=await fixture({fetcher:async()=>{calls++;return Response.json({latestTrade:{p:105,t:new Date().toISOString()},prevDailyBar:{c:100},dailyBar:{v:50}});}});await f.setup();
  await f.request('/api/settings',{method:'PUT',body:{market:{alpacaKey:'market-key',alpacaSecret:'market-secret'}}});
  await f.request('/api/records/watchlist',{method:'POST',body:{market:'US',symbol:'AAPL'}});
  const first=await (await f.request('/api/market/refresh',{method:'POST'})).json();assert.equal(first.quotes[0].price,105);
  const second=await (await f.request('/api/market/refresh',{method:'POST'})).json();assert.equal(second.quotes[0].price,105);assert.equal(calls,1);
});
test('simultaneous edge setup admits one owner and concurrent writes retain both records',async()=>{
  const f=await fixture();
  const responses=await Promise.all([f.setup(),f.setup()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const writes=await Promise.all(['Alpha','Beta'].map(title=>f.request('/api/records/tasks',{method:'POST',body:{title}})));assert.deepEqual(writes.map(r=>r.status),[200,200]);
  assert.deepEqual((await (await f.request('/api/state')).json()).tasks.map(t=>t.title).sort(),['Alpha','Beta']);
});
test('edge password change revokes other sessions and keeps the current session',async()=>{
  const f=await fixture();await f.setup();const firstCookie=f.getCookie();
  await f.request('/api/auth/login',{method:'POST',body:{password}});
  assert.equal((await f.request('/api/auth/password',{method:'POST',body:{currentPassword:password,newPassword:'a different password long'}})).status,200);
  assert.equal((await f.request('/api/state',{headers:{Cookie:firstCookie}})).status,401);
  assert.equal((await f.request('/api/state')).status,200);
  assert.equal((await f.request('/api/auth/login',{method:'POST',body:{password}})).status,401);
  assert.equal((await f.request('/api/auth/login',{method:'POST',body:{password:'a different password long'}})).status,200);
});
test('edge balance refresh stores provider results without exposing upstream error bodies',async()=>{
  const f=await fixture({fetcher:async url=>url.includes('deepseek')?Response.json({balance_infos:[{currency:'CNY',total_balance:'12.50'}]}):new Response('sensitive-key-secret',{status:403})});await f.setup();
  await f.request('/api/settings',{method:'PUT',body:{deepseek:{apiKey:'private-deepseek-key'},openai:{apiKey:'private-openai-key'}}});
  const response=await f.request('/api/providers/balances/refresh',{method:'POST'});assert.equal(response.status,200);
  const text=await response.text();assert.equal(text.includes('sensitive-key-secret'),false);assert.equal(text.includes('private-openai-key'),false);
  const body=JSON.parse(text);assert.equal(body.accounts[0].balance,12.5);assert.equal(body.results.find(r=>r.provider==='openai').status,'error');
  assert.equal((await (await f.request('/api/state')).json()).accounts[0].balance,12.5);
});

test('a slower older balance response cannot overwrite a newer refresh',async()=>{
  let calls=0,release,entered;
  const waiting=new Promise(resolve=>{release=resolve;}),firstEntered=new Promise(resolve=>{entered=resolve;});
  const f=await fixture({fetcher:async()=>{
    calls++;const balance=calls===1?'10':'20';
    if(calls===1){entered();await waiting;}
    return Response.json({balance_infos:[{currency:'CNY',total_balance:balance}]});
  }});
  await f.setup();await f.request('/api/settings',{method:'PUT',body:{deepseek:{apiKey:'fixture-balance-key'}}});
  const older=f.request('/api/providers/balances/refresh',{method:'POST'});
  await firstEntered;
  try{assert.equal((await f.request('/api/providers/balances/refresh',{method:'POST'})).status,200);}
  finally{release();}
  assert.equal((await older).status,200);
  assert.equal((await (await f.request('/api/state')).json()).accounts[0].balance,20);
});
test('edge rejects request URLs outside configured origin even with a valid cookie',async()=>{
  const f=await fixture();await f.setup();
  const response=await appModule.handleRequest(new Request('https://preview.example.com/api/state',{headers:{Cookie:f.getCookie()}}),f.env);
  assert.equal(response.status,403);
});
test('edge state requests refresh configured watched quotes only after refresh interval',async()=>{
  let calls=0;const f=await fixture({fetcher:async()=>{calls++;return Response.json({latestTrade:{p:105,t:new Date().toISOString()},prevDailyBar:{c:100},dailyBar:{v:50}});}});await f.setup();
  await f.request('/api/settings',{method:'PUT',body:{market:{alpacaKey:'market-key',alpacaSecret:'market-secret',refreshSeconds:120}}});
  await f.request('/api/records/watchlist',{method:'POST',body:{market:'US',symbol:'AAPL'}});
  assert.equal((await (await f.request('/api/state')).json()).quotes[0]?.price,105);assert.equal(calls,1);
  assert.equal((await (await f.request('/api/state')).json()).quotes[0]?.price,105);assert.equal(calls,1);
  await f.env.DB.prepare("UPDATE kv SET value=json_set(value,'$.at',?) WHERE key='marketCache'").bind(Date.now()-31000).run();
  await f.request('/api/state');assert.equal(calls,1);
  await f.env.DB.prepare("UPDATE kv SET value=json_set(value,'$.at',?) WHERE key='marketCache'").bind(Date.now()-121000).run();
  await f.request('/api/state');assert.equal(calls,2);
});
test('edge global rate limiting removes expired persistent counters',async()=>{
  const f=await fixture();await f.env.DB.prepare('INSERT INTO cloudflare_rate_limits(key,count,expires) VALUES (?,1,?)').bind('expired-fixture',Date.now()-1000).run();
  await f.request('/api/auth/status');assert.equal(await f.env.DB.prepare('SELECT count FROM cloudflare_rate_limits WHERE key=?').bind('expired-fixture').first(),null);
});
test('edge rejects unknown collection names inherited from Object prototype',async()=>{
  const f=await fixture();await f.setup();
  assert.equal((await f.request('/api/records/toString',{method:'POST',body:{title:'Invalid collection'}})).status,404);
  assert.equal((await f.request('/api/backup/restore',{method:'POST',body:{mode:'merge',backup:{version:1,exportedAt:new Date().toISOString(),records:{constructor:[]}}}})).status,400);
});
