import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const implementation = await import('../server/app.mjs').catch(() => ({}));
const password = 'correct horse battery staple';
const origin = 'http://127.0.0.1:4318';
async function fixture(t, options = {}) {
  assert.equal(typeof implementation.createApp, 'function', 'createApp must implement the persistent API');
  const dataDir = await mkdtemp(join(tmpdir(), 'workbench-test-'));
  const app = await implementation.createApp({ dataDir, origin, testMode:true, ...options });
  t.after(async () => { await app.close(); await rm(dataDir, {recursive: true, force: true}); });
  const setup = await app.inject({method:'POST',url:'/api/auth/setup',headers:{origin},payload:{password}});
  assert.equal(setup.statusCode, 200, setup.body);
  const cookie = setup.headers['set-cookie'].split(';')[0];
  const req = (method, url, payload, headers = {}) => app.inject({method,url,payload,headers:Object.fromEntries(Object.entries({origin,cookie,...headers}).filter(([,value])=>value!==undefined))});
  return {app,req,cookie,dataDir};
}
test('state requires a password session and blocks foreign mutation origins', async t => {
  const {app,req} = await fixture(t);
  assert.equal((await app.inject({url:'/api/state'})).statusCode,401);
  assert.equal((await req('GET','/api/state')).statusCode,200);
  assert.equal((await req('POST','/api/records/tasks',{title:'Test'},{origin:'https://attacker.example'})).statusCode,403);
  assert.equal((await req('POST','/api/records/tasks',{title:'Test'},{origin:undefined})).statusCode,403);
});
test('validated records persist after database reopening', async t => {
  const {app,req,dataDir,cookie} = await fixture(t);
  assert.equal((await req('POST','/api/records/tasks',{title:'',status:'imaginary'})).statusCode,400);
  const result = await req('POST','/api/records/tasks',{title:'Submit homework',dueAt:'2030-01-01T12:00:00Z'});
  assert.equal(result.statusCode,200,result.body);
  await app.close();
  const reopened = await implementation.createApp({dataDir,origin,testMode:true});
  const state = (await reopened.inject({url:'/api/state',headers:{cookie}})).json();
  assert.equal(state.tasks[0].title,'Submit homework');
  assert.equal(state.tasks[0].status,'pending');
  await reopened.close();
});
test('settings encrypt secrets and backups never expose configuration or tokens', async t => {
  const {req,dataDir} = await fixture(t);
  const secret = 'fixture-secret-NEVER-EXPORT';
  const saved = await req('PUT','/api/settings',{ai:{apiKey:secret,model:'test-model'},deepseek:{apiKey:secret}});
  assert.equal(saved.statusCode,200,saved.body);
  assert.equal(saved.json().ai.keyConfigured,true);
  assert.equal(saved.body.includes(secret),false);
  const backup = await req('GET','/api/backup');
  assert.equal(backup.body.includes(secret),false);
  assert.equal('settings' in backup.json(),false);
  assert.equal((await readFile(join(dataDir,'workbench.sqlite'))).includes(Buffer.from(secret)),false);
  assert.equal((await req('PUT','/api/settings',{ai:{apiKey:''}})).json().ai.keyConfigured,true);
  assert.equal((await req('PUT','/api/settings',{clearSecrets:['ai.apiKey','deepseek.apiKey']})).json().ai.keyConfigured,false);
  assert.equal((await req('PUT','/api/settings',{ai:{baseUrl:'http://127.0.0.1:1234/v1'}})).statusCode,400);
});
test('scoped tokens rotate, sync deduplicates events and rejects stale replacement', async t => {
  const {app,req} = await fixture(t);
  const oldToken = (await req('POST','/api/agent/token',{})).json().token;
  const token = (await req('POST','/api/agent/token',{})).json().token;
  const send = (body, auth = token) => app.inject({method:'POST',url:'/api/sync/codex',headers:{authorization:`Bearer ${auth}`},payload:body});
  const event = {eventId:'evt-1',observedAt:new Date().toISOString(),rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:2000000000}},dailyUsageBuckets:[{startDate:'2026-10-02',tokens:123}]};
  assert.equal((await send(event,oldToken)).statusCode,401);
  assert.equal((await send(event)).statusCode,200);
  assert.equal((await send(event)).json().duplicate,true);
  assert.equal((await send({...event,eventId:'evt-old',observedAt:'2020-01-01T00:00:00Z'})).statusCode,400);
  assert.equal((await send({...event,eventId:'evt-future',observedAt:'2099-01-01T00:00:00Z'})).statusCode,400);
  const state = (await req('GET','/api/state')).json();
  assert.equal(state.codex.history.length,1);
  assert.equal(state.codex.rateLimits.primary.usedPercent,25);
  assert.equal(state.codex.dailyUsageBuckets[0].tokens,123);
  assert.equal((await app.inject({url:'/api/state',headers:{authorization:`Bearer ${token}`}})).statusCode,401);
});
test('tasks sync upserts IDs and never deletes omitted or infers completion', async t => {
  const {app,req} = await fixture(t);
  const token = (await req('POST','/api/agent/token',{})).json().token;
  const send = (eventId,tasks, observedAt=new Date().toISOString()) => app.inject({method:'POST',url:'/api/sync/tasks',headers:{authorization:`Bearer ${token}`},payload:{eventId,observedAt,tasks}});
  const task = {platformId:'p1',title:'Assignment',course:'Math',type:'assignment',status:'pending',dueAt:null,url:''};
  assert.equal((await send('t1',[task])).statusCode,200);
  assert.equal((await send('t2',[{...task,title:'Updated'}])).statusCode,200);
  assert.equal((await send('t3',[])).statusCode,200);
  const tasks=(await req('GET','/api/state')).json().tasks;
  assert.equal(tasks.length,1); assert.equal(tasks[0].title,'Updated'); assert.equal(tasks[0].status,'pending');
});
test('backup restores atomically after validation and deduplicates reminders', async t => {
  const {req} = await fixture(t);
  await req('POST','/api/records/tasks',{title:'Due task',dueAt:new Date(Date.now()+3600000).toISOString()});
  const backup=(await req('GET','/api/backup')).json();
  const bad=structuredClone(backup); bad.records.accounts=[{id:'a1',name:'Bad',balance:-1}];
  assert.equal((await req('POST','/api/backup/restore',{backup:bad,mode:'merge'})).statusCode,400);
  assert.equal((await req('POST','/api/backup/restore',{backup,mode:'merge'})).statusCode,200);
  const a=(await req('GET','/api/state')).json(); const b=(await req('GET','/api/state')).json();
  assert.equal(a.tasks.length,1); assert.equal(a.alerts.length,1); assert.equal(b.alerts.length,1);
});
test('password change revokes other sessions while allowing current session', async t => {
  const {app,req} = await fixture(t);
  const login = await app.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{password}});
  const second=login.headers['set-cookie'].split(';')[0];
  assert.equal((await req('POST','/api/auth/password',{currentPassword:password,newPassword:'new correct horse battery staple'})).statusCode,200);
  assert.equal((await app.inject({url:'/api/state',headers:{cookie:second}})).statusCode,401);
  assert.equal((await req('GET','/api/state')).statusCode,200);
});
test('unconfigured adapters and chat preserve honest empty states', async t => {
  const {req}=await fixture(t);
  const balances=(await req('POST','/api/providers/balances/refresh',{})).json();
  assert.equal(balances.accounts.length,0); assert.equal(balances.results[0].status,'unconfigured');
  const market=(await req('POST','/api/market/refresh',{})).json();
  assert.equal(market.quotes.length,0);
  assert.equal((await req('POST','/api/study/chat',{message:'Help',mode:'tutor'})).statusCode,400);
});
test('error sync preserves last good quotas and age while recording attempt timestamp',async t=>{
  const {app,req}=await fixture(t);const token=(await req('POST','/api/agent/token',{})).json().token;
  const send=payload=>app.inject({method:'POST',url:'/api/sync/codex',headers:{authorization:`Bearer ${token}`},payload});
  const good=new Date(Date.now()-5000).toISOString(),attempt=new Date().toISOString();
  await send({eventId:'good',observedAt:good,rateLimits:{primary:{usedPercent:25}},dailyUsageBuckets:[{startDate:'2026-10-02',tokens:10}]});
  await send({eventId:'failed',observedAt:attempt,error:'CODEX_UNAVAILABLE'});
  const codex=(await req('GET','/api/state')).json().codex;
  assert.equal(codex.status,'error');assert.equal(codex.syncedAt,good);assert.equal(codex.observedAt,good);assert.equal(codex.lastAttemptAt,attempt);
  assert.equal(codex.rateLimits.primary.usedPercent,25);assert.equal(codex.dailyUsageBuckets[0].tokens,10);
  assert.equal(codex.history[0].observedAt,good);assert.equal(codex.history[1].observedAt,attempt);assert.equal(codex.history[1].syncedAt,good);
  const recovery=new Date(Date.now()+1000).toISOString();
  await send({eventId:'recovery',observedAt:recovery,rateLimits:null});
  const recovered=(await req('GET','/api/state')).json().codex;
  assert.equal(recovered.status,'ok');assert.equal(recovered.syncedAt,recovery);assert.equal('error' in recovered,false);
});
test('restore preserves imported timestamps so newer source backups merge and local edits win',async t=>{
  const {req}=await fixture(t);
  const createdAt=new Date(Date.now()-86400000*4).toISOString(),older=new Date(Date.now()-86400000*3).toISOString(),newer=new Date(Date.now()-86400000*2).toISOString();
  const restore=(title,updatedAt)=>req('POST','/api/backup/restore',{mode:'merge',backup:{version:1,exportedAt:new Date().toISOString(),records:{tasks:[{id:'imported',title,createdAt,updatedAt}]}}});
  await restore('Older',older);
  let record=(await req('GET','/api/state')).json().tasks[0];assert.equal(record.updatedAt,older);assert.equal(record.createdAt,createdAt);
  await restore('Newer',newer);record=(await req('GET','/api/state')).json().tasks[0];assert.equal(record.title,'Newer');assert.equal(record.updatedAt,newer);
  await req('PATCH','/api/records/tasks/imported',{title:'Local edit'});await restore('Stale backup',newer);
  record=(await req('GET','/api/state')).json().tasks[0];assert.equal(record.title,'Local edit');assert.ok(Date.parse(record.updatedAt)>Date.parse(newer));
});
test('daily statistics failure updates valid quotas while preserving old daily age',async t=>{
  const {req,app}=await fixture(t);const token=(await req('POST','/api/agent/token',{})).json().token;
  const send=payload=>app.inject({method:'POST',url:'/api/sync/codex',headers:{authorization:`Bearer ${token}`},payload});
  const good=new Date(Date.now()-5000).toISOString(),attempt=new Date().toISOString();
  await send({eventId:'daily-good',observedAt:good,rateLimits:{primary:{usedPercent:10}},dailyUsageBuckets:[{startDate:'2026-10-02',tokens:100}]});
  await send({eventId:'daily-error',observedAt:attempt,rateLimits:{primary:{usedPercent:20}},error:'CODEX_USAGE_UNAVAILABLE'});
  const codex=(await req('GET','/api/state')).json().codex;
  assert.equal(codex.status,'error');assert.equal(codex.rateLimits.primary.usedPercent,20);assert.equal(codex.syncedAt,attempt);assert.equal(codex.observedAt,attempt);
  assert.equal(codex.dailyUsageBuckets[0].tokens,100);assert.equal(codex.dailyUsageObservedAt,good);
});
test('a valid exported backup larger than 2 MB restores while ordinary record requests keep the 2 MB limit',async t=>{
  const source=await fixture(t),content='x'.repeat(30000);
  for(let index=0;index<70;index++){
    const saved=await source.req('POST','/api/records/chatMessages',{role:'assistant',content});
    assert.equal(saved.statusCode,200,saved.body);
  }
  const exported=await source.req('GET','/api/backup');assert.equal(exported.statusCode,200);
  assert.ok(Buffer.byteLength(exported.body)>2_000_000,'The real export must exceed the ordinary request limit');
  const destination=await fixture(t);
  const restored=await destination.req('POST','/api/backup/restore',{mode:'merge',backup:exported.json()});
  assert.equal(restored.statusCode,200,restored.body);assert.equal(restored.json().counts.chatMessages,70);
  assert.equal((await destination.req('GET','/api/state')).json().chatMessages.length,70);
  const oversized=await destination.req('POST','/api/records/chatMessages',{role:'assistant',content:'x'.repeat(2_000_001)});
  assert.equal(oversized.statusCode,413,oversized.body);
});
test('status-only task PATCH preserves course, type, deadline, URL, notes and platform identity',async t=>{
  const {req}=await fixture(t);
  const fields={title:'验收 · 作业合并',course:'高等数学',type:'assignment',dueAt:'2026-10-05T12:00:00+08:00',status:'pending',url:'https://example.edu/task?id=42',note:'保留说明',source:'chaoxing',platformId:'work-42'};
  const original=(await req('POST','/api/records/tasks',fields)).json().record;
  const response=await req('PATCH',`/api/records/tasks/${original.id}`,{status:'completed'});
  assert.equal(response.statusCode,200,response.body);
  const updated=response.json().record;const {updatedAt,...persisted}=updated,{updatedAt:previousUpdatedAt,...before}=original;
  assert.deepEqual(persisted,{...before,status:'completed'});
});
test('study-plan status PATCH preserves date, minutes, subject and content',async t=>{
  const {req}=await fixture(t);
  const original=(await req('POST','/api/records/studyPlans',{title:'高数计划',subject:'高数',date:'2026-10-05',minutes:75,content:'复习第三章',status:'pending'})).json().record;
  const response=await req('PATCH',`/api/records/studyPlans/${original.id}`,{status:'completed'});
  assert.equal(response.statusCode,200,response.body);
  const updated=response.json().record;
  assert.equal(updated.date,'2026-10-05');assert.equal(updated.minutes,75);assert.equal(updated.subject,'高数');assert.equal(updated.content,'复习第三章');assert.equal(updated.status,'completed');
});
test('account PATCH preserves balance, currency, provider, allowance, reset and API source',async t=>{
  const {req}=await fixture(t);
  const fields={name:'额度',provider:'provider-name',type:'subscription',currency:'USD',balance:125,total:200,resetsAt:'2026-11-01T00:00:00Z',note:'原说明',source:'api',threshold:15};
  const original=(await req('POST','/api/records/accounts',fields)).json().record;
  const response=await req('PATCH',`/api/records/accounts/${original.id}`,{note:'更新说明'});
  assert.equal(response.statusCode,200,response.body);
  const updated=response.json().record;
  for(const key of ['name','provider','type','currency','balance','total','resetsAt','source','threshold','id','createdAt'])assert.equal(updated[key],original[key],key);
  assert.equal(updated.note,'更新说明');
});
