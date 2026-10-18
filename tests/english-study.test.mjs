import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { createApp } from '../server/app.mjs';
import { Store } from '../server/db.mjs';
import { handleRequest } from '../cloudflare/app.mjs';
import { withStore } from '../cloudflare/store.mjs';
import { createTestDB } from './helpers/d1.mjs';
import { englishArticle,englishSentences } from '../shared/english-data.mjs';

const base='/api/study/english';
async function fixture(t,backend){
  let cookie='',send,mutate;
  const origin=backend==='local'?'http://127.0.0.1:4318':'https://moyaiwork.com';
  if(backend==='local'){
    const dataDir=await mkdtemp(join(tmpdir(),'english-study-'));
    const app=await createApp({dataDir,origin,testMode:true});
    t.after(async()=>{await app.close();assert.equal(dirname(resolve(dataDir)),resolve(tmpdir()));assert.ok(dataDir.split(/[\\/]/).at(-1).startsWith('english-study-'));await rm(dataDir,{recursive:true,force:true});});
    mutate=callback=>{const store=new Store(dataDir);try{return store.transaction(()=>callback(store));}finally{store.close();}};
    send=async(method,path,body,headers={})=>{const r=await app.inject({method,url:path,payload:body,headers:{origin,cookie,...headers}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return {status:r.statusCode,json:()=>r.json()};};
  }else{
    const db=await createTestDB();t.after(()=>db.close());
    const env={DB:db,APP_ORIGIN:origin,SETUP_TOKEN:'english-setup',VAULT_KEY:Buffer.alloc(32,7).toString('base64')};
    mutate=callback=>withStore(db,callback);
    send=async(method,path,body,headers={})=>{const r=await handleRequest(new Request(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  }
  assert.equal((await send('POST','/api/auth/setup',{password:'correct horse battery staple',...(backend==='edge'?{setupToken:'english-setup'}:{})})).status,200);
  const json=async(method,path,body)=>{const r=await send(method,path,body);const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  return {send,mutate,json,snapshot:()=>json('GET',base),act:(kind,fields={},revision=0,eventId=crypto.randomUUID())=>json('POST',base+'/actions',{kind,...fields,expectedRevision:revision,eventId})};
}

for(const backend of ['local','edge']){
  test(`${backend}: English account routes authenticate, protect writes, start empty and never mutate on GET`,async t=>{
    const f=await fixture(t,backend);
    for(const path of [base,base+'/export'])assert.equal((await f.send('GET',path,undefined,{cookie:''})).status,401);
    assert.equal((await f.send('POST',base+'/actions',{}, {cookie:''})).status,401);
    assert.equal((await f.send('POST',base+'/actions',{}, {origin:'https://foreign.example'})).status,403);
    const empty=await f.snapshot();assert.equal(empty.version,1);assert.equal(empty.revision,0);assert.deepEqual(empty.cards,[]);assert.deepEqual(empty.days,{});assert.deepEqual(empty.history,[]);assert.ok(Number.isFinite(Date.parse(empty.serverNow)));
    await f.mutate(store=>assert.equal(store.get('englishStudy'),null));
    const exported=await f.json('GET',base+'/export');assert.equal(exported.version,1);assert.equal(exported.kind,'english-study');assert.equal(exported.state.revision,0);assert.equal(JSON.stringify(exported).includes('password'),false);
  });
  test(`${backend}: canonical spelling and reading completion persist unique Shanghai-day counts`,async t=>{
    const f=await fixture(t,backend);t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T16:01:00Z')});
    const wrong=await f.act('spell',{wordId:'context',answer:'contacts'});assert.equal(wrong.result.correct,false);assert.deepEqual(wrong.snapshot.days,{});assert.equal(wrong.snapshot.cards.length,0);
    const correct=await f.act('spell',{wordId:'context',answer:'  CONTEXT  '},wrong.snapshot.revision);assert.equal(correct.result.correct,true);assert.deepEqual(correct.snapshot.days['2026-10-19'].words,['context']);assert.equal(correct.snapshot.cards.length,1);
    const again=await f.act('spell',{wordId:'context',answer:'context'},correct.snapshot.revision);assert.deepEqual(again.snapshot.days['2026-10-19'].words,['context']);
    const reading=await f.act('reading',{articleId:'small-steps'},again.snapshot.revision);assert.deepEqual(reading.snapshot.days['2026-10-19'].articles,['small-steps']);assert.deepEqual((await f.snapshot()).days,reading.snapshot.days);
  });
  test(`${backend}: collect preserves article context without claiming study and schedules actual FSRS reviews`,async t=>{
    const f=await fixture(t,backend);const now=Date.parse('2026-10-18T02:00:00Z');t.mock.timers.enable({apis:['Date'],now});
    const context=englishArticle.paragraphs[1];
    const collected=await f.act('collect',{wordId:'retain',context});const card=collected.snapshot.cards[0];assert.equal(card.context,context);assert.equal(card.reps,0);assert.equal(card.state,0);assert.equal(card.due,new Date(now).toISOString());assert.deepEqual(collected.snapshot.days,{});
    assert.equal(card.intervals['1'],'2026-10-18T02:01:00.000Z');assert.equal(card.intervals['3'],'2026-10-18T02:10:00.000Z');assert.equal(card.intervals['4'],'2026-10-26T02:00:00.000Z');
    const reviewed=await f.act('review',{wordId:'retain',rating:3},1);assert.equal(reviewed.result.nextDue,card.intervals['3']);assert.equal(reviewed.snapshot.cards[0].reps,1);assert.equal(reviewed.snapshot.history.length,1);assert.deepEqual(reviewed.snapshot.days['2026-10-18'].words,['retain']);
    assert.equal((await f.send('POST',base+'/actions',{kind:'review',wordId:'retain',rating:3,eventId:crypto.randomUUID(),expectedRevision:2})).status,409);
    t.mock.timers.tick(Date.parse(reviewed.result.nextDue)-now);
    const next=await f.act('review',{wordId:'retain',rating:4},2);assert.equal(next.snapshot.cards[0].reps,2);assert.ok(Date.parse(next.result.nextDue)>Date.parse(reviewed.result.nextDue));
    const exported=await f.json('GET',base+'/export');assert.ok(exported.state.cards[0].fsrs.stability>0);assert.equal('fsrs' in next.snapshot.cards[0],false);
  });
  test(`${backend}: dictation aligns insertions, omissions and substitutions and only credits a correct sentence`,async t=>{
    const f=await fixture(t,backend);
    const wrong=await f.act('dictation',{sentenceId:'sentence-0',answer:'Small steps really can lead meaningful process'});assert.equal(wrong.result.correct,false);assert.ok(wrong.result.accuracy>0&&wrong.result.accuracy<100);assert.ok(wrong.result.parts.some(p=>p.type==='extra'&&p.actual==='really'));assert.ok(wrong.result.parts.some(p=>p.type==='missing'&&p.expected==='to'));assert.ok(wrong.result.parts.some(p=>p.type==='wrong'&&p.expected==='progress'));assert.deepEqual(wrong.snapshot.days,{});
    const right=await f.act('dictation',{sentenceId:'sentence-0',answer:englishSentences[0].text.toUpperCase()},wrong.snapshot.revision);assert.equal(right.result.accuracy,100);assert.equal(right.result.correct,true);assert.equal(Object.values(right.snapshot.days)[0].sentences[0],'sentence-0');
  });
  test(`${backend}: retries never double count, event identity binds payload and concurrent revisions have one winner`,async t=>{
    const f=await fixture(t,backend);const action={kind:'collect',wordId:'context',expectedRevision:0,eventId:crypto.randomUUID()};
    const first=await f.json('POST',base+'/actions',action);await f.act('reading',{articleId:'small-steps'},1);
    const retry=await f.json('POST',base+'/actions',action);assert.equal(retry.snapshot.revision,2);assert.deepEqual(retry.result,first.result);assert.equal(retry.snapshot.cards.length,1);
    assert.equal((await f.send('POST',base+'/actions',{...action,wordId:'retain'})).status,409);
    const race=await Promise.all(['retain','progress'].map(wordId=>f.send('POST',base+'/actions',{kind:'collect',wordId,expectedRevision:2,eventId:crypto.randomUUID()})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await f.snapshot()).revision,3);
    const duplicate={kind:'review',wordId:'context',rating:1,expectedRevision:3,eventId:crypto.randomUUID()};const both=await Promise.all([f.send('POST',base+'/actions',duplicate),f.send('POST',base+'/actions',duplicate)]);assert.deepEqual(both.map(r=>r.status),[200,200]);assert.equal((await f.snapshot()).history.length,1);
  });
  test(`${backend}: invalid content, arbitrary contexts and client FSRS fields cannot alter state`,async t=>{
    const f=await fixture(t,backend);const common={eventId:crypto.randomUUID(),expectedRevision:0};
    for(const value of [{kind:'collect',wordId:'unknown'},{kind:'collect',wordId:'context',context:'arbitrary text'},{kind:'collect',wordId:'context',context:'x'.repeat(601)},{kind:'collect',wordId:'context',due:'2020-01-01'},{kind:'collect',wordId:'context',fsrs:{reps:100}},{kind:'review',wordId:'context',rating:5},{kind:'reading',articleId:'unknown'},{kind:'dictation',sentenceId:'sentence-8',answer:'answer'},{kind:'spell',wordId:'context',answer:'x'.repeat(501)}])assert.equal((await f.send('POST',base+'/actions',{...common,...value})).status,400);
    assert.equal((await f.snapshot()).revision,0);
  });
  test(`${backend}: reading snapshots and recollecting cannot reset scheduled cards or mutate stored metadata`,async t=>{
    const f=await fixture(t,backend);await f.act('collect',{wordId:'context'});const review=await f.act('review',{wordId:'context',rating:4},1);
    let before;await f.mutate(store=>{store.set('englishUnrelatedMetadata',{value:'preserve'});before=store.get('englishStudy');});
    await f.snapshot();await f.snapshot();await f.mutate(store=>assert.deepEqual(store.get('englishStudy'),before));
    const recollected=await f.act('collect',{wordId:'context'},2);assert.equal(recollected.snapshot.cards.length,1);assert.equal(recollected.snapshot.cards[0].reps,1);assert.equal(recollected.snapshot.cards[0].due,review.result.nextDue);await f.mutate(store=>assert.deepEqual(store.get('englishUnrelatedMetadata'),{value:'preserve'}));
  });
  test(`${backend}: retention stays bounded and an evicted old receipt still cannot replay with stale revision`,async t=>{
    const f=await fixture(t,backend);const original={kind:'collect',wordId:'context',eventId:crypto.randomUUID(),expectedRevision:0};await f.json('POST',base+'/actions',original);
    await f.mutate(store=>{
      const state=store.get('englishStudy');state.receipts=[state.receipts[0],...Array.from({length:499},(_,i)=>({eventId:`seed-${i}`,digest:'seed',result:{}}))];
      state.history=Array.from({length:200},(_,i)=>({eventId:`review-${i}`,wordId:'context',rating:3,at:'2025-01-01T00:00:00.000Z',due:'2025-01-01T00:10:00.000Z'}));
      state.days=Object.fromEntries(Array.from({length:366},(_,i)=>[new Date(Date.parse('2024-01-01')+i*86400000).toISOString().slice(0,10),{words:[],articles:[],sentences:[]} ]));store.set('englishStudy',state);
    });
    const reviewed=await f.act('review',{wordId:'context',rating:3},1);assert.equal(reviewed.snapshot.history.length,200);assert.equal(reviewed.snapshot.history[0].eventId,'review-1');assert.equal(Object.keys(reviewed.snapshot.days).length,366);assert.equal(Object.keys(reviewed.snapshot.days).includes('2024-01-01'),false);
    const exported=await f.json('GET',base+'/export');assert.equal(exported.state.receipts.length,500);assert.equal(exported.state.receipts.some(r=>r.eventId===original.eventId),false);
    assert.equal((await f.send('POST',base+'/actions',original)).status,409);assert.equal((await f.snapshot()).revision,2);
  });
}

test('local: failed English write rolls back cards and receipts so the same event can safely retry',async t=>{
  const f=await fixture(t,'local');const action={kind:'collect',wordId:'retain',eventId:crypto.randomUUID(),expectedRevision:0};
  await f.mutate(store=>store.db.exec("CREATE TRIGGER reject_english_write BEFORE INSERT ON kv WHEN NEW.key='englishStudy' BEGIN SELECT RAISE(ABORT,'storage unavailable'); END;"));
  assert.equal((await f.send('POST',base+'/actions',action)).status,500);assert.equal((await f.snapshot()).revision,0);assert.deepEqual((await f.snapshot()).cards,[]);
  await f.mutate(store=>store.db.exec('DROP TRIGGER reject_english_write'));
  const saved=await f.json('POST',base+'/actions',action);assert.equal(saved.snapshot.revision,1);assert.equal(saved.snapshot.cards.length,1);
});

test('bundled Cloudflare worker runs actual FSRS, persists retries and makes no outbound calls',{timeout:60000},async t=>{
  const root=resolve('.');execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'pages','functions','build','--outdir','.cache/english-study-runtime','--compatibility-date=2026-10-04','--compatibility-flags=nodejs_compat'],{cwd:root,env:{...process.env,WRANGLER_LOG_PATH:join(root,'.cache/wrangler/logs'),WRANGLER_SEND_METRICS:'false'},stdio:'pipe',windowsHide:true});
  let outboundCalls=0;const origin='https://moyaiwork.com';
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(root,'.cache/english-study-runtime/index.js'),compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'english-study-runtime'},bindings:{APP_ORIGIN:origin,SETUP_TOKEN:'english-setup',VAULT_KEY:Buffer.alloc(32,7).toString('base64')},outboundService:()=>{outboundCalls++;throw new Error('No outbound calls allowed');}}));t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');await db.exec(readFileSync(join(root,'cloudflare/migrations/0001_initial.sql'),'utf8').split('\n').filter(line=>!line.trim().startsWith('--')).join('\n'));
  let cookie='';const send=async(method,path,body,headers={})=>{const r=await mf.dispatchFetch(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  assert.equal((await send('GET',base)).status,401);assert.equal((await send('POST','/api/auth/setup',{password:'correct horse battery staple',setupToken:'english-setup'})).status,200);
  const collect={kind:'collect',wordId:'context',eventId:crypto.randomUUID(),expectedRevision:0};assert.equal((await send('POST',base+'/actions',collect,{origin:'https://foreign.example'})).status,403);assert.equal((await send('POST',base+'/actions',collect)).status,200);
  const review={kind:'review',wordId:'context',rating:4,eventId:crypto.randomUUID(),expectedRevision:1};const r=await send('POST',base+'/actions',review);assert.equal(r.status,200);const saved=await r.json();assert.equal(saved.snapshot.cards[0].state,2);assert.equal(saved.snapshot.cards[0].reps,1);assert.ok(Date.parse(saved.result.nextDue)-Date.parse(saved.snapshot.serverNow)>=7*86400000);
  const retry=await send('POST',base+'/actions',review);assert.equal(retry.status,200);const retried=await retry.json();assert.equal(retried.snapshot.revision,2);assert.equal(retried.snapshot.history.length,1);assert.equal(retried.result.nextDue,saved.result.nextDue);
  assert.equal((await send('POST',base+'/actions',{...review,eventId:crypto.randomUUID(),expectedRevision:2})).status,409);
  const exported=await (await send('GET',base+'/export')).json();assert.ok(exported.state.cards[0].fsrs.stability>0);assert.equal(outboundCalls,0);
});
