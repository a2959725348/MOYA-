import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { createApp } from '../server/app.mjs';
import { Store } from '../server/db.mjs';
import { handleRequest } from '../cloudflare/app.mjs';
import { withStore } from '../cloudflare/store.mjs';
import { createTestDB } from './helpers/d1.mjs';

const demand={text:'我的 ChatGPT 订阅支付失败，求教程。',source:'manual',rightsConfirmed:true};
const config={topicKeywords:[' ChatGPT ','ChatGPT','GPT'],demandKeywords:['支付失败'],excludeKeywords:[],replyTemplate:'关于 {{关键词}}：{{摘要}} {{问题}}'};
const analysis={category:'payment_failure',summary:'需要订阅帮助',evidence:['订阅支付失败'],reason:'原文询问支付',draftReply:'请核对官方账单说明。',confidence:0.9};
async function fixture(t,backend){
  let cookie='',calls=0,send,mutate;
  const origin=backend==='local'?'http://127.0.0.1:4318':'https://moyaiwork.com';
  const fetcher=async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis)}}]});};
  if(backend==='local'){
    const dataDir=await mkdtemp(join(tmpdir(),'heybox-admin-'));
    const app=await createApp({dataDir,origin,testMode:true,testTransport:fetcher});
    t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
    mutate=async callback=>{const store=new Store(dataDir);try{return store.transaction(()=>callback(store));}finally{store.close();}};
    send=async(method,path,body,headers={})=>{const r=await app.inject({method,url:path,payload:body,headers:{origin,cookie,...headers}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return {status:r.statusCode,json:()=>r.json()};};
  }else{
    const db=await createTestDB();t.after(()=>db.close());
    const env={DB:db,APP_ORIGIN:origin,SETUP_TOKEN:'fixture-setup',VAULT_KEY:Buffer.alloc(32,7).toString('base64')};
    mutate=callback=>withStore(db,callback);
    send=async(method,path,body,headers={})=>{const r=await handleRequest(new Request(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{}, {fetcher});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  }
  assert.equal((await send('POST','/api/auth/setup',{password:'correct horse battery staple',...(backend==='edge'?{setupToken:'fixture-setup'}:{})})).status,200);
  const json=async(method,path,body)=>{const r=await send(method,path,body);assert.equal(r.status,200,JSON.stringify(await r.clone?.().json()));return r.json();};
  return {send,json,mutate,get calls(){return calls;},admin:()=>json('GET','/api/heybox/admin'),create:async(text=demand.text)=>(await json('POST','/api/records/demands',{...demand,text})).record,save:async(record,extra={})=>(await json('POST','/api/heybox/reviews',{demandId:record.id,sourceUpdatedAt:record.updatedAt,draft:'请核对官方帮助说明。',expectedUpdatedAt:null,...extra})).review};
}
for(const backend of ['local','edge']){
  test(`${backend}: admin requires authentication, rejects foreign writes and has no platform capabilities`,async t=>{
    const f=await fixture(t,backend);
    for(const [method,path,body] of [['GET','/api/heybox/admin'],['PUT','/api/heybox/config',{expectedRevision:0,config}],['POST','/api/heybox/reviews',{}],['PATCH','/api/heybox/reviews/absent',{}]]){
      assert.equal((await f.send(method,path,body,{cookie:''})).status,401);
      if(method!=='GET')assert.equal((await f.send(method,path,body,{origin:'https://foreign.example'})).status,403);
    }
    const admin=await f.admin();assert.equal(admin.version,1);assert.equal(admin.mode,'manual');assert.deepEqual(admin.reviews,[]);assert.deepEqual(admin.logs,[]);
    assert.deepEqual(admin.capabilities,{platformConnected:false,autoRead:false,autoReply:false,follow:false,directMessage:false});
    assert.deepEqual(admin.config.topicKeywords,['ChatGPT','GPT','Plus']);assert.equal(f.calls,0);
  });
  test(`${backend}: config survives refresh, normalizes keywords and rejects stale/concurrent revisions`,async t=>{
    const f=await fixture(t,backend);const saved=await f.json('PUT','/api/heybox/config',{expectedRevision:0,config});assert.equal(saved.config.revision,1);assert.deepEqual(saved.config.topicKeywords,['ChatGPT','GPT']);
    assert.deepEqual((await f.admin()).config,saved.config);
    const writes=await Promise.all([1,2].map(()=>f.send('PUT','/api/heybox/config',{expectedRevision:1,config})));assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
    assert.equal((await f.send('PUT','/api/heybox/config',{expectedRevision:0,config})).status,409);assert.equal((await f.admin()).logs.length,2);assert.equal(f.calls,0);
  });
  test(`${backend}: config, drafts and notes reject identifiers, excess lengths and unknown fields`,async t=>{
    const f=await fixture(t,backend);const record=await f.create();
    for(const value of [{...config,topicKeywords:[]},{...config,demandKeywords:Array(41).fill('帮助')},{...config,topicKeywords:['x'.repeat(81)]},{...config,replyTemplate:'{{邮箱}}'},{...config,replyTemplate:'{{问题'},{...config,replyTemplate:'a@example.com'},{...config,replyTemplate:'x'.repeat(2001)},{...config,enabled:true}])assert.equal((await f.send('PUT','/api/heybox/config',{expectedRevision:0,config:value})).status,400);
    for(const draft of ['','x'.repeat(2001),'邮件 a@example.com','电话 +86 138 0013 8000','卡号 4111 1111 1111 1111'])assert.equal((await f.send('POST','/api/heybox/reviews',{demandId:record.id,sourceUpdatedAt:record.updatedAt,draft,expectedUpdatedAt:null})).status,400);
    assert.equal((await f.send('POST','/api/heybox/reviews',{demandId:record.id,sourceUpdatedAt:record.updatedAt,draft:'帮助',expectedUpdatedAt:null,status:'approved'})).status,400);
    const review=await f.save(record);
    for(const extra of [{note:'a@example.com'},{note:'x'.repeat(1001)},{send:true}])assert.equal((await f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:review.updatedAt,status:'pending',...extra})).status,400);
    assert.equal((await f.send('POST','/api/records/heyboxReviews',{draft:'bypass'})).status,404);assert.equal(f.calls,0);
  });
  test(`${backend}: edits reset review, lock every update and monotonically version same-tick writes`,async t=>{
    const f=await fixture(t,backend),record=await f.create();
    t.mock.timers.enable({apis:['Date'],now:Date.parse(record.updatedAt)});
    const review=await f.save(record);assert.equal(review.id,record.id);assert.equal(review.status,'pending');assert.equal(review.stale,false);
    const approved=(await f.json('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:review.updatedAt,status:'approved',note:'人工核对完成'})).review;assert.ok(approved.updatedAt>review.updatedAt);
    assert.equal((await f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:approved.updatedAt,status:'approved',draft:'修改后的回复'})).status,400);
    const edited=await f.save(record,{expectedUpdatedAt:approved.updatedAt,draft:'修改后的回复'});assert.equal(edited.status,'pending');assert.equal(edited.note,'');assert.ok(edited.updatedAt>approved.updatedAt);
    assert.equal((await f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:approved.updatedAt,status:'rejected'})).status,409);
    const results=await Promise.all(['approved','rejected'].map(status=>f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:edited.updatedAt,status})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls,0);
  });
  test(`${backend}: stale or deleted sources cannot be approved or copied as current drafts`,async t=>{
    const f=await fixture(t,backend),record=await f.create(),review=await f.save(record);
    await f.json('PATCH',`/api/records/demands/${record.id}`,{text:'新的订阅需求'});assert.equal((await f.admin()).reviews[0].stale,true);
    assert.equal((await f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:review.updatedAt,status:'approved'})).status,409);
    assert.equal((await f.send('POST','/api/heybox/reviews',{demandId:record.id,sourceUpdatedAt:record.updatedAt,draft:'旧版本',expectedUpdatedAt:review.updatedAt})).status,409);
    await f.json('DELETE',`/api/records/demands/${record.id}`);assert.equal((await f.admin()).reviews[0].stale,true);
    assert.equal((await f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:review.updatedAt,status:'approved'})).status,409);
  });
  test(`${backend}: reanalysis invalidates prior drafts even in the same clock tick and logs metadata only`,async t=>{
    const f=await fixture(t,backend),record=await f.create(),review=await f.save(record);
    await f.json('PUT','/api/settings',{deepseek:{apiKey:'FIXTURE-PRIVATE-KEY'}});
    t.mock.timers.enable({apis:['Date'],now:Date.parse(record.updatedAt)});
    const analyzed=(await f.json('POST',`/api/demands/${record.id}/analyze`,{})).record;assert.ok(analyzed.updatedAt>record.updatedAt);
    assert.equal((await f.admin()).reviews[0].stale,true);assert.equal((await f.send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:review.updatedAt,status:'approved'})).status,409);
    const logs=(await f.admin()).logs;assert.ok(logs.some(log=>log.action==='analysis_completed'));assert.equal(JSON.stringify(logs).includes(record.text),false);assert.equal(JSON.stringify(logs).includes('FIXTURE-PRIVATE-KEY'),false);assert.equal(JSON.stringify(logs).includes(analysis.reason),false);assert.equal(f.calls,1);
  });
  test(`${backend}: manual changes append fixed audit labels and rejected operations leave logs untouched`,async t=>{
    const f=await fixture(t,backend);await f.json('POST','/api/demands/import',{items:[demand]});const record=(await f.json('GET','/api/state')).demands[0];
    await f.json('PATCH',`/api/records/demands/${record.id}`,{text:'修改后的订阅需求'});await f.json('DELETE',`/api/records/demands/${record.id}`);
    const logs=(await f.admin()).logs;assert.deepEqual(logs.map(l=>l.action).sort(),['demand_deleted','demand_saved','demands_imported']);
    for(const log of logs){assert.ok(log.label);assert.ok(Number.isFinite(Date.parse(log.at)));assert.deepEqual(Object.keys(log).sort(),log.targetId?['action','at','id','label','targetId']:['action','at','id','label']);}
    assert.equal((await f.send('POST','/api/heybox/logs',{action:'review_approved',label:'forged'})).status,404);assert.deepEqual((await f.admin()).logs,logs);
  });
  test(`${backend}: log retention is bounded and review cap rejects without deleting history`,async t=>{
    const f=await fixture(t,backend),record=await f.create();
    // Fixture seeds existing persisted history, then the real API exercises cap/retention.
    await f.mutate(store=>{
      const at='2026-10-17T00:00:00.000Z';store.set('heyboxLogs',Array.from({length:300},(_,i)=>({id:String(i),at,action:'config_saved',label:'配置已保存'})));
      for(let i=0;i<200;i++)store.save('heyboxReviews',{id:`seed-${i}`,demandId:`seed-${i}`,sourceUpdatedAt:at,draft:'历史草稿',status:'pending',note:'',createdAt:at,updatedAt:at},`seed-${i}`,{preserveMetadata:true});
    });
    assert.equal((await f.send('POST','/api/heybox/reviews',{demandId:record.id,sourceUpdatedAt:record.updatedAt,draft:'新增草稿',expectedUpdatedAt:null})).status,413);
    await f.json('PUT','/api/heybox/config',{expectedRevision:0,config});const admin=await f.admin();assert.equal(admin.reviews.length,200);assert.equal(admin.logs.length,300);assert.equal(admin.logs.some(log=>log.id==='0'),false);assert.ok(admin.logs.some(log=>log.action==='config_saved'&&log.id!=='299'));
  });
}

test('local: audit storage failure rolls back every imported demand and retry succeeds cleanly',async t=>{
  const f=await fixture(t,'local');
  await f.mutate(store=>store.db.exec(`CREATE TRIGGER reject_heybox_import_audit BEFORE INSERT ON kv WHEN NEW.key='heyboxLogs' BEGIN SELECT RAISE(ABORT,'audit write unavailable'); END;`));
  const items=[demand,{...demand,text:'API 额度如何订阅？'}];
  assert.equal((await f.send('POST','/api/demands/import',{items})).status,500);
  assert.deepEqual((await f.json('GET','/api/state')).demands,[]);
  assert.deepEqual((await f.admin()).logs,[]);
  await f.mutate(store=>store.db.exec('DROP TRIGGER reject_heybox_import_audit'));
  const result=await f.json('POST','/api/demands/import',{items});
  assert.equal(result.imported,2);assert.equal(result.duplicates,0);
  assert.equal((await f.json('GET','/api/state')).demands.length,2);
  assert.deepEqual((await f.admin()).logs.map(log=>log.action),['demands_imported']);
  assert.equal(f.calls,0);
});

test('actual Miniflare worker protects admin routes and persists manual config/review without outbound calls',{timeout:60000},async t=>{
  const root=resolve('.');execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'pages','functions','build','--outdir','.cache/heybox-admin-runtime','--compatibility-date=2026-10-04','--compatibility-flags=nodejs_compat'],{cwd:root,env:{...process.env,WRANGLER_LOG_PATH:join(root,'.cache/wrangler/logs'),WRANGLER_SEND_METRICS:'false'},stdio:'pipe',windowsHide:true});
  let calls=0;const origin='https://moyaiwork.com';const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(root,'.cache/heybox-admin-runtime/index.js'),compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'heybox-admin-runtime'},bindings:{APP_ORIGIN:origin,SETUP_TOKEN:'fixture-setup',VAULT_KEY:Buffer.alloc(32,7).toString('base64')},outboundService:()=>{calls++;throw new Error('No network permitted');}}));t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');await db.exec(readFileSync(join(root,'cloudflare/migrations/0001_initial.sql'),'utf8').split('\n').filter(line=>!line.trim().startsWith('--')).join('\n'));
  let cookie='';const send=async(method,path,body,headers={})=>{const r=await mf.dispatchFetch(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  assert.equal((await send('GET','/api/heybox/admin')).status,401);assert.equal((await send('POST','/api/auth/setup',{password:'runtime correct horse battery staple',setupToken:'fixture-setup'})).status,200);
  assert.equal((await send('PUT','/api/heybox/config',{expectedRevision:0,config},{origin:'https://foreign.example'})).status,403);assert.equal((await send('PUT','/api/heybox/config',{expectedRevision:0,config})).status,200);
  const record=(await (await send('POST','/api/records/demands',demand)).json()).record;
  const saved=await send('POST','/api/heybox/reviews',{demandId:record.id,sourceUpdatedAt:record.updatedAt,draft:'人工草稿',expectedUpdatedAt:null});assert.equal(saved.status,200);const review=(await saved.json()).review;
  assert.equal((await send('PATCH',`/api/heybox/reviews/${review.id}`,{expectedUpdatedAt:review.updatedAt,status:'approved'})).status,200);
  const admin=await (await send('GET','/api/heybox/admin')).json();assert.equal(admin.config.revision,1);assert.equal(admin.reviews[0].status,'approved');assert.equal(calls,0);
});
