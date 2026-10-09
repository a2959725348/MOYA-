import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { handleRequest } from '../cloudflare/app.mjs';
import { createTestDB } from './helpers/d1.mjs';
import { collections } from '../server/schema.mjs';

const input={text:'我的订阅支付失败，需要了解解决步骤。',source:'manual',rightsConfirmed:true};
const answer={category:'payment_failure',summary:'用户询问订阅付款失败的处理步骤',evidence:['订阅支付失败'],reason:'原文直接表达付款问题',draftReply:'可先查看官方账单帮助和免费教程；无法保证付款成功。',confidence:0.9};
const upstream=(value=answer,extra={})=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},...extra});
async function fixture(t,backend,provider=()=>upstream()){
  let cookie='',calls=0,lastBody;
  const fetcher=async(url,init)=>{calls++;lastBody=JSON.parse(init.body);return provider(url,init);};
  const origin=backend==='local'?'http://127.0.0.1:4318':'https://moyaiwork.com';
  let send,database;
  if(backend==='local'){
    const dataDir=await mkdtemp(join(tmpdir(),'demand-test-'));
    const app=await createApp({dataDir,origin,testMode:true,testTransport:fetcher});
    t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
    send=async(method,path,body,headers)=>{
      const r=await app.inject({method,url:path,payload:body,headers:{origin,cookie,...headers}});
      if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];
      return {status:r.statusCode,json:async()=>r.json(),text:async()=>r.body};
    };
  }else{
    const db=await createTestDB();database=db;t.after(()=>db.close());
    const env={DB:db,APP_ORIGIN:origin,SETUP_TOKEN:'fixture-setup',VAULT_KEY:Buffer.alloc(32,7).toString('base64')};
    send=async(method,path,body,headers)=>{
      const r=await handleRequest(new Request(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{}, {fetcher});
      if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;
    };
  }
  assert.equal((await send('POST','/api/auth/setup',{password:'correct horse battery staple',setupToken:backend==='local'?undefined:'fixture-setup'})).status,200);
  return {send,database,get calls(){return calls;},get lastBody(){return lastBody;},configure:async(ai={})=>send('PUT','/api/settings',{deepseek:{apiKey:'PRIVATE-API-KEY'},ai:{inputPrice:1,outputPrice:1,...ai}}),create:async(body=input)=>{const r=await send('POST','/api/records/demands',body);assert.equal(r.status,200,'validated demand create route must exist');return (await r.json()).record;}};
}

test('demand and consultation schemas enforce consent and remove direct identifiers',()=>{
  assert.ok(collections.demands,'demand collection must be validated');
  assert.ok(collections.consultations,'consultation collection must be validated');
  for(const text of ['邮件 a@example.com','电话 13800138000','电话 138-0013-8000','电话 +86 138 0013 8000','卡号 4111 1111 1111 1111'])assert.equal(collections.demands.safeParse({...input,text}).success,false,text);
  assert.equal(collections.demands.safeParse({...input,rightsConfirmed:false}).success,false);
  assert.equal(collections.demands.safeParse({...input,sourceUrl:'https://user:secret@example.com/'}).success,false);
  assert.equal(collections.demands.safeParse({...input,sourceUrl:'https://example.com/?token=secret'}).success,false);
  assert.equal(collections.consultations.safeParse({question:'如何查看账单？',consentConfirmed:true}).success,true);
  assert.equal(collections.consultations.safeParse({question:'联系 a@example.com',consentConfirmed:true}).success,false);
});

for(const backend of ['local','edge']){
  test(`${backend}: import validates before writing and deduplicates create, import, edits and restore`,async t=>{
    const f=await fixture(t,backend);
    assert.equal((await f.send('POST','/api/demands/import',{items:[input,{...input,text:'联系 a@example.com'}]})).status,400);
    assert.deepEqual((await (await f.send('GET','/api/state')).json()).demands,[]);
    const result=await (await f.send('POST','/api/demands/import',{items:[input,{...input,text:'  我的订阅支付失败，需要了解解决步骤。  '}]})).json();
    assert.equal(result.imported,1);assert.equal(result.duplicates,1);assert.equal(result.records[0].analysis,null);
    assert.equal((await f.create()).id,result.records[0].id);
    const other=await f.create({...input,text:'需要了解 API 额度'});
    assert.equal((await f.send('PATCH',`/api/records/demands/${other.id}`,{text:input.text})).status,409);
    const backup=await (await f.send('GET','/api/backup')).json();
    backup.records.demands.push({...backup.records.demands[0],id:'copy'});
    assert.equal((await f.send('POST','/api/backup/restore',{backup,mode:'merge'})).status,200);
    assert.equal((await (await f.send('GET','/api/state')).json()).demands.length,2);
    assert.equal((await f.send('POST','/api/records/consultations',{question:'如何查看账单？',consentConfirmed:true})).status,200);
    assert.equal((await f.send('POST','/api/demands/import',{items:[input]},{cookie:''})).status,401);
    assert.equal((await f.send('POST','/api/demands/import',{items:[input]},{origin:'https://evil.example'})).status,403);
  });
  test(`${backend}: authenticated analysis validates evidence, preserves unknown usage, and protects server-owned fields`,async t=>{
    const f=await fixture(t,backend,()=>upstream(answer,{usage:undefined}));await f.configure({maxTokens:8192});
    const record=await f.create();
    const r=await f.send('POST',`/api/demands/${record.id}/analyze`,{});assert.equal(r.status,200,await r.clone?.().text());
    const analyzed=(await r.json()).record;assert.equal(analyzed.analysis.category,'payment_failure');assert.equal(analyzed.analysis.model,'deepseek-chat');assert.equal('cost' in analyzed.analysis,false);assert.equal('tokens' in analyzed.analysis,false);
    assert.equal(f.lastBody.max_tokens,2048);assert.deepEqual(f.lastBody.thinking,{type:'disabled'});assert.deepEqual(f.lastBody.response_format,{type:'json_object'});
    assert.equal(JSON.stringify(f.lastBody).includes('sourceUrl'),false);assert.equal(JSON.stringify(analyzed).includes('PRIVATE-API-KEY'),false);
    assert.equal((await f.send('PATCH',`/api/records/demands/${record.id}`,{analysis:analyzed.analysis})).status,400);
    assert.equal((await f.send('POST','/api/demands/import',{items:[{...input,analysis:analyzed.analysis}]})).status,400);
    const changed=await (await f.send('PATCH',`/api/records/demands/${record.id}`,{text:'API 额度不足'})).json();assert.equal(changed.record.analysis,null);
  });
  for(const [name,provider] of [
    ['invented evidence',()=>upstream({...answer,evidence:['不存在的原文']})],
    ['HTML',()=>new Response('<html>PRIVATE-API-KEY</html>',{headers:{'content-type':'text/html'}})],
    ['partial output',()=>upstream(answer,{choices:[{finish_reason:'length',message:{content:JSON.stringify(answer)}}]})],
    ['malformed JSON',()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{broken'}}]})],
    ['provider error',()=>Response.json({error:'PRIVATE-API-KEY'},{status:401})],
  ])test(`${backend}: ${name} yields safe error without saving analysis`,async t=>{
    const f=await fixture(t,backend,provider);await f.configure();const record=await f.create();
    const r=await f.send('POST',`/api/demands/${record.id}/analyze`,{});assert.equal(r.status,502);assert.equal((await r.text()).includes('PRIVATE-API-KEY'),false);
    assert.equal((await (await f.send('GET','/api/state')).json()).demands[0].analysis,null);
  });
  for(const action of ['edit','delete','logout'])test(`${backend}: ${action} during paid call rejects persistence`,async t=>{
    let entered,release;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    const f=await fixture(t,backend,async()=>{entered();await gate;return upstream();});await f.configure();const record=await f.create();
    const pending=f.send('POST',`/api/demands/${record.id}/analyze`,{});await waiting;
    if(action==='logout')await f.send('POST','/api/auth/logout',{});
    else await f.send(action==='edit'?'PATCH':'DELETE',`/api/records/demands/${record.id}`,action==='edit'?{text:'文本已修改'}:undefined);
    release();assert.equal((await pending).status,action==='logout'?401:409);assert.equal(f.calls,1);
  });
  for(const action of ['edit','delete','logout'])test(`${backend}: known cost survives ${action} rejection and blocks the next paid call`,async t=>{
    let entered,release;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    const f=await fixture(t,backend,async()=>{entered();await gate;return upstream();});await f.configure({dailyBudget:0.0001});const record=await f.create();
    const pending=f.send('POST',`/api/demands/${record.id}/analyze`,{});await waiting;
    if(action==='logout')await f.send('POST','/api/auth/logout',{});
    else await f.send(action==='edit'?'PATCH':'DELETE',`/api/records/demands/${record.id}`,action==='edit'?{text:'原文已变更'}:undefined);
    release();assert.equal((await pending).status,action==='logout'?401:409);
    if(action==='logout')assert.equal((await f.send('POST','/api/auth/login',{password:'correct horse battery staple'})).status,200);
    const state=await (await f.send('GET','/api/state')).json();assert.equal(state.demands.some(r=>r.analysis),false);
    const next=action==='delete'?await f.create():state.demands[0];
    assert.equal((await f.send('POST',`/api/demands/${next.id}/analyze`,{})).status,429);
    assert.equal((await f.send('POST','/api/study/chat',{message:'hello',mode:'tutor'})).status,429);assert.equal(f.calls,1);
  });
  test(`${backend}: primitive and array demand PATCH bodies are rejected without modifying the record`,async t=>{
    const f=await fixture(t,backend);const record=await f.create();
    for(const body of [12,true,null,[],['text'],'text'])assert.equal((await f.send('PATCH',`/api/records/demands/${record.id}`,body,{'content-type':'application/json'})).status,400,JSON.stringify(body));
    assert.deepEqual((await (await f.send('GET','/api/state')).json()).demands,[record]);
  });
  test(`${backend}: analysis and chat share request reservations and known cost threshold`,async t=>{
    const f=await fixture(t,backend);await f.configure({dailyRequestLimit:1});const record=await f.create();
    const results=await Promise.all([f.send('POST',`/api/demands/${record.id}/analyze`,{}),f.send('POST',`/api/demands/${record.id}/analyze`,{})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);assert.equal(f.calls,1);
    assert.equal((await f.send('POST','/api/study/chat',{message:'hello',mode:'tutor'})).status,429);
    await f.configure({dailyRequestLimit:10,dailyBudget:0.0001});
    assert.equal((await f.send('POST','/api/study/chat',{message:'hello',mode:'tutor'})).status,429);
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,429);assert.equal(f.calls,1);
  });
  test(`${backend}: restored analysis is validated and reanalysis costs remain counted after overwrite`,async t=>{
    const f=await fixture(t,backend);await f.configure();const record=await f.create();
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,200);
    const backup=await (await f.send('GET','/api/backup')).json();
    backup.records.demands[0].updatedAt=new Date(Date.now()+60000).toISOString();
    backup.records.demands[0].analysis.evidence=['捏造'];
    assert.equal((await f.send('POST','/api/backup/restore',{backup,mode:'merge'})).status,400);
    backup.records.demands[0].analysis.evidence=['订阅支付失败'];
    assert.equal((await f.send('POST','/api/backup/restore',{backup,mode:'merge'})).status,200);
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,200);
    await f.configure({dailyBudget:0.0003});
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,429);
  });
  for(const mode of ['missing usage','disabled pricing'])test(`${backend}: restored known cost survives ${mode} without duplication`,async t=>{
    const f=await fixture(t,backend,()=>upstream(answer,mode==='missing usage'?{usage:undefined}:{}));
    await f.configure(mode==='missing usage'?{dailyBudget:0.0003}:{inputPrice:0,outputPrice:0,dailyBudget:null});const record=await f.create();
    const backup=await (await f.send('GET','/api/backup')).json();
    backup.records.demands[0].analysis={...answer,model:'deepseek-chat',analyzedAt:new Date().toISOString(),tokens:200,cost:0.0002,currency:'CNY'};
    backup.records.demands[0].updatedAt=new Date(Date.now()+60000).toISOString();
    assert.equal((await f.send('POST','/api/backup/restore',{backup,mode:'merge'})).status,200);
    let conflicted=false;
    if(backend==='edge'){
      const batch=f.database.batch.bind(f.database);
      f.database.batch=async statements=>{
        if(!conflicted&&statements.some(s=>s._values?.some(v=>typeof v==='string'&&v.includes('demandAnalysisCosts')))){
          conflicted=true;f.database.sqlite.prepare('UPDATE cloudflare_meta SET revision=revision+1 WHERE id=1').run();
        }
        return batch(statements);
      };
    }
    const first=await f.send('POST',`/api/demands/${record.id}/analyze`,{});assert.equal(first.status,200);
    const analysis=(await first.json()).record.analysis;assert.equal('cost' in analysis,false);assert.equal('currency' in analysis,false);
    assert.equal('tokens' in analysis,mode==='disabled pricing');
    await f.configure({dailyBudget:0.0001});
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,429);
    assert.equal((await f.send('POST','/api/study/chat',{message:'hello',mode:'tutor'})).status,429);assert.equal(f.calls,1);
    // Retaining prior spend once permits another call below 0.0003. A duplicate
    // CAS accounting entry would incorrectly reach 0.0004 and block this call.
    await f.configure({dailyBudget:0.0003});
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,200);
    await f.configure({dailyBudget:0.0001});
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,429);
    assert.equal((await f.send('POST','/api/study/chat',{message:'hello',mode:'tutor'})).status,429);assert.equal(f.calls,2);
    if(backend==='edge')assert.equal(conflicted,true);
  });
  test(`${backend}: identifiers yield actionable deidentification errors for consultation and import`,async t=>{
    const f=await fixture(t,backend);
    for(const [path,body] of [['/api/records/consultations',{question:'电话 13800138000',consentConfirmed:true}],['/api/demands/import',{items:[{...input,text:'邮件 a@example.com'}]}]]){
      const r=await f.send('POST',path,body);assert.equal(r.status,400);assert.match((await r.json()).error,/去标识化/);
    }
  });
  test(`${backend}: edits reverted in the same millisecond still invalidate a pending analysis`,async t=>{
    let entered,release;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    const f=await fixture(t,backend,async()=>{entered();await gate;return upstream();});await f.configure();const record=await f.create();
    t.mock.timers.enable({apis:['Date'],now:Date.parse(record.updatedAt)});
    const pending=f.send('POST',`/api/demands/${record.id}/analyze`,{});await waiting;
    await f.send('PATCH',`/api/records/demands/${record.id}`,{text:'临时修改'});
    await f.send('PATCH',`/api/records/demands/${record.id}`,{text:input.text});
    release();assert.equal((await pending).status,409);
  });
  for(const phase of ['fetch','body'])test(`${backend}: 45 second timeout bounds hung ${phase} and preserves its reservation`,async t=>{
    let entered;const waiting=new Promise(r=>entered=r);
    const f=await fixture(t,backend,()=>{
      entered();
      return phase==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
    });await f.configure({dailyRequestLimit:1});const record=await f.create();
    t.mock.timers.enable({apis:['setTimeout']});
    const pending=f.send('POST',`/api/demands/${record.id}/analyze`,{});await waiting;
    await new Promise(r=>setImmediate(r));t.mock.timers.tick(45000);
    assert.equal((await pending).status,502);
    assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,429);
    assert.equal((await (await f.send('GET','/api/state')).json()).demands[0].analysis,null);
  });
}

test('edge: accounting CAS retry charges each valid paid response once and preserves restored costs',async t=>{
  const f=await fixture(t,'edge');await f.configure({dailyBudget:0.0005});const record=await f.create();
  const backup=await (await f.send('GET','/api/backup')).json();
  backup.records.demands[0].analysis={...answer,model:'deepseek-chat',analyzedAt:new Date().toISOString(),tokens:200,cost:0.0002,currency:'CNY'};
  backup.records.demands[0].updatedAt=new Date(Date.now()+60000).toISOString();
  assert.equal((await f.send('POST','/api/backup/restore',{backup,mode:'merge'})).status,200);
  const batch=f.database.batch.bind(f.database);let conflicted=false;
  f.database.batch=async statements=>{
    if(!conflicted&&statements.some(s=>s._values?.some(v=>typeof v==='string'&&v.includes('demandAnalysisCosts')))){
      conflicted=true;f.database.sqlite.prepare('UPDATE cloudflare_meta SET revision=revision+1 WHERE id=1').run();
    }
    return batch(statements);
  };
  assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,200);
  assert.equal(conflicted,true);
  // Restored 0.0002 + first call 0.0002 < threshold: second call is allowed.
  assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,200);
  assert.equal((await f.send('POST',`/api/demands/${record.id}/analyze`,{})).status,429);assert.equal(f.calls,2);
});
