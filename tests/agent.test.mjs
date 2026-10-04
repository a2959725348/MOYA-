import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

// Missing normalization, correlation, and upload guards must fail these behavior tests.
const normal = () => import('../agent/normalize.mjs');
const rpc = () => import('../agent/rpc.mjs');
const cli = new URL('../agent/index.mjs', import.meta.url);
const quota = { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1790000000 }, secondary: null }, dailyUsageBuckets: [{ startDate: '2026-10-01', tokens: 123 }] };

test('quota preserves primary, secondary, absent fields and separate multi buckets', async () => {
  const { sanitizeSnapshot } = await normal();
  const got = sanitizeSnapshot({ ...quota, rateLimitsByLimitId: { codex: quota.rateLimits, other: { primary: null, secondary: { usedPercent: 78, windowDurationMins: 10080, resetsAt: null } } } });
  assert.deepEqual(got.rateLimits.primary, { usedPercent: 25, windowDurationMins: 300, resetsAt: 1790000000 });
  assert.equal(got.rateLimits.secondary, null);
  assert.equal(got.rateLimitsByLimitId.other.primary, null);
  assert.deepEqual(got.rateLimitsByLimitId.other.secondary, { usedPercent: 78, windowDurationMins: 10080, resetsAt: null });
  assert.deepEqual(sanitizeSnapshot({}), { rateLimits: null, rateLimitsByLimitId: null, dailyUsageBuckets: null });
});

test('sanitization strips credentials, account details and untrusted upstream error text', async () => {
  const { sanitizeSnapshot } = await normal();
  const got = sanitizeSnapshot({ ...quota, token: 'sk-secret', account: { id: 'org-secret' }, error: 'accessToken sk-secret user@example.com', rateLimits: { ...quota.rateLimits, accessToken: 'sk-secret', credits: { balance: '42.50', hasCredits: true, unlimited: false, token: 'sk-secret' }, primary: { ...quota.rateLimits.primary, accountId: 'org-secret' } }, dailyUsageBuckets: [{ startDate: '2026-10-01', tokens: 123, secret: 'sk-secret' }, { startDate: '2026-02-30', tokens: 3 }, { startDate: '2026-10-02', tokens: -1 }] });
  assert.deepEqual(got.dailyUsageBuckets, [{ startDate: '2026-10-01', tokens: 123 }]);
  assert.deepEqual(got.rateLimits.credits, { balance: '42.50', hasCredits: true, unlimited: false });
  assert.equal(JSON.stringify(got).includes('secret'), false);
  assert.equal('error' in got, false);
  assert.equal(sanitizeSnapshot({ rateLimits: { primary: { usedPercent: '10', windowDurationMins: -1, resetsAt: NaN } } }).rateLimits.primary.usedPercent, null);
});

test('manual tasks deduplicate platform ID, strip other fields and preserve explicit completion', async () => {
  const { sanitizeTasks } = await normal();
  const rows = sanitizeTasks({ tasks: [{ platformId: 'course-1-task-2', title: '作业', course: '英语', type: 'assignment', dueAt: null, status: 'pending', url: 'https://example.edu/task/2', token: 'secret' }, { platformId: 'course-1-task-2', title: '已完成', status: 'completed' }] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { platformId: 'course-1-task-2', title: '已完成', course: '', type: 'other', dueAt: null, status: 'completed', url: '' });
  assert.throws(() => sanitizeTasks({ tasks: [{ title: 'No id' }] }), /TASK_FILE_INVALID/);
  assert.throws(() => sanitizeTasks({ tasks: [{ platformId: 'x', title: 'x', url: 'javascript:alert(1)' }] }), /TASK_FILE_INVALID/);
});

async function fixture(t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-agent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'fixture.mjs');
  await writeFile(path, source);
  return { dir, path };
}

test('RPC handshake precedes reads, split lines correlate reverse-order responses', async (t) => {
  const { AppServerClient, readCodexSnapshot } = await rpc();
  const { path } = await fixture(t, `import readline from 'node:readline';
let ready=false, initialized=false, pending=[];
readline.createInterface({ input: process.stdin }).on('line', line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize'){ ready=true; process.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'do not copy'}})+'\\n'); return; }
 if(m.method==='initialized'){ initialized=ready; return; }
 if(!initialized){ process.stdout.write(JSON.stringify({id:m.id,error:{code:401,message:'secret'}})+'\\n'); return; }
 if(!['account/rateLimits/read','account/usage/read'].includes(m.method)) process.exit(3);
 pending.push(m);
 if(pending.length===2){ pending.reverse().forEach((q,i)=>{ const result=q.method==='account/usage/read'?{dailyUsageBuckets:[{startDate:'2026-10-01',tokens:123}],accessToken:'secret'}:${JSON.stringify({ rateLimits: quota.rateLimits })};
 const line=JSON.stringify({id:q.id,result})+'\\n'; setTimeout(()=>{process.stdout.write(line.slice(0,9)); setTimeout(()=>process.stdout.write(line.slice(9)),5);},i*20); });
 }
});`);
  const client = new AppServerClient({ command: process.execPath, args: [path], timeoutMs: 1000 });
  t.after(() => client.close());
  const got = await readCodexSnapshot(client);
  assert.equal(got.rateLimits.primary.usedPercent, 25);
  assert.deepEqual(got.dailyUsageBuckets, [{ startDate: '2026-10-01', tokens: 123 }]);
  assert.equal(JSON.stringify(got).includes('secret'), false);
});

test('RPC sanitizes errors and bounds hung request duration', async (t) => {
  const { AppServerClient } = await rpc();
  const { path } = await fixture(t, `import readline from 'node:readline'; readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line); if(m.method==='bad')process.stdout.write(JSON.stringify({id:m.id,error:{code:401,message:'sk-secret user@example.com'}})+'\\n');});`);
  const client = new AppServerClient({ command: process.execPath, args: [path], timeoutMs: 100 });
  t.after(() => client.close());
  await assert.rejects(client.request('bad'), /CODEX_AUTH_REQUIRED/);
  const before = Date.now();
  await assert.rejects(client.request('hang'), /CODEX_TIMEOUT/);
  assert.ok(Date.now() - before < 1500);
});

function run(args, env={}, cwd=undefined) {
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[cli.pathname.replace(/^\/(\w:)/,'$1'),...args],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',b=>stdout+=b); child.stderr.on('data',b=>stderr+=b);
    child.on('close',code=>resolve({code,stdout,stderr}));
  });
}

test('dry-run imported snapshot emits sanitized quota without token or network', async (t) => {
  const { dir } = await fixture(t, '');
  const path=join(dir,'snapshot.json');
  await writeFile(path,JSON.stringify({...quota,token:'sk-secret',error:'org-secret'}));
  const got=await run(['--dry-run','--snapshot-file',path],{WORKBENCH_AGENT_TOKEN:'bearer-secret',WORKBENCH_URL:'http://invalid.example'});
  assert.equal(got.code,0,got.stderr);
  assert.equal(JSON.parse(got.stdout).rateLimits.primary.usedPercent,25);
  assert.equal((got.stdout+got.stderr).includes('secret'),false);
});

test('sanitizer output parses real server schema with 401 days, null buckets and excessive percent', async () => {
  const {sanitizeSnapshot}=await normal();const {codexSchema}=await import('../server/schema.mjs');
  const daily=Array.from({length:401},(_,i)=>({startDate:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),tokens:i}));
  const data=sanitizeSnapshot({rateLimits:{primary:{usedPercent:101,windowDurationMins:300,resetsAt:1790942400}},rateLimitsByLimitId:{codex:quota.rateLimits,bad:null,invalid:'secret'},dailyUsageBuckets:[...daily.reverse(),{startDate:'2026-02-05',tokens:999}]});
  const parsed=codexSchema.safeParse({eventId:'schema-regression',observedAt:'2026-10-02T12:00:00Z',...data});
  assert.equal(parsed.success,true,JSON.stringify(parsed.error?.issues));assert.equal(data.dailyUsageBuckets.length,400);assert.equal(data.dailyUsageBuckets[0].startDate,'2025-01-02');assert.equal(data.dailyUsageBuckets.at(-1).startDate,'2026-02-05');assert.equal(data.dailyUsageBuckets.at(-1).tokens,999);assert.deepEqual(Object.keys(data.rateLimitsByLimitId),['codex']);assert.equal(data.rateLimits.primary.usedPercent,null);
});

test('task deep links accept only noncredential ID parameters regardless of key case', async () => {
  const {sanitizeTasks}=await normal();
  const url='https://mooc1.chaoxing.com/mooc2/work/dowork?courseId=123&taskId=456&workId=789&examId=abc&classId=100&clazzid=200&id=300&knowledgeId=400';
  assert.equal(sanitizeTasks([{platformId:'x',title:'x',url}])[0].url,url);
  assert.equal(sanitizeTasks([{platformId:'x',title:'x',url:'https://example.edu/task?COURSEID=123'}])[0].url,'https://example.edu/task?COURSEID=123');
  for(const query of ['token=secret','enc=secret','signature=abc','password=x','auth=x','courseId=abc.def.secret','courseId=123&redirect=elsewhere','%74oken=x','courseId=123#secret'])assert.throws(()=>sanitizeTasks([{platformId:'x',title:'x',url:'https://example.edu/task?'+query}]),/TASK_FILE_INVALID/);
});

test('blank CODEX_HOME is omitted from child environment, explicit home remains', async(t)=>{
  const {AppServerClient}=await rpc();const {path}=await fixture(t,`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({id:m.id,result:{home:process.env.CODEX_HOME??null}})+'\\n');});`);
  for(const [home,want] of [['',null],['fixture-home','fixture-home']]){const client=new AppServerClient({command:process.execPath,args:[path],env:{...process.env,CODEX_HOME:home},timeoutMs:1000});try{assert.equal((await client.request('check')).home,want);}finally{client.close();}}
});

test('agent loads URL and token from .env without logging the secret',async(t)=>{
  const {dir}=await fixture(t,'');const path=join(dir,'snapshot.json');await writeFile(path,JSON.stringify(quota));let authorization;
  const server=createServer((req,res)=>{authorization=req.headers.authorization;res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const config=join(dir,'.env');await writeFile(config,'WORKBENCH_URL=http://127.0.0.1:'+server.address().port+'\nWORKBENCH_AGENT_TOKEN=fixture-env-secret\nCODEX_HOME=\nCODEX_BIN=\n');
  const result=await run(['--snapshot-file',path],{WORKBENCH_URL:undefined,WORKBENCH_AGENT_TOKEN:undefined,DOTENV_CONFIG_PATH:config},dir);
  assert.equal(result.code,0,result.stderr);assert.equal(authorization,'Bearer fixture-env-secret');assert.equal((result.stdout+result.stderr).includes('fixture-env-secret'),false);
});

test('once uploads sanitized observation by bearer without following redirects', async (t) => {
  const { dir } = await fixture(t, ''); const path=join(dir,'snapshot.json'); await writeFile(path,JSON.stringify(quota));
  let received;
  const server=createServer(async (req,res)=>{let body='';for await(const chunk of req)body+=chunk;received={url:req.url,auth:req.headers.authorization,body:JSON.parse(body)};res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close());
  const got=await run(['--once','--snapshot-file',path],{WORKBENCH_URL:'http://127.0.0.1:'+server.address().port,WORKBENCH_AGENT_TOKEN:'fixture-bearer'});
  assert.equal(got.code,0,got.stderr);assert.equal(received.url,'/api/sync/codex');assert.equal(received.auth,'Bearer fixture-bearer');assert.match(received.body.eventId,/^[a-f0-9-]{36,64}$/);assert.ok(Date.parse(received.body.observedAt));assert.equal(received.body.rateLimits.primary.usedPercent,25);assert.equal(got.stdout.includes('fixture-bearer'),false);
  server.removeAllListeners('request');server.on('request',(req,res)=>{res.writeHead(302,{Location:'http://invalid.example/credential-collector'});res.end();});
  const redirected=await run(['--once','--snapshot-file',path],{WORKBENCH_URL:'http://127.0.0.1:'+server.address().port,WORKBENCH_AGENT_TOKEN:'fixture-bearer'});
  assert.equal(redirected.code,1);assert.match(redirected.stderr,/SYNC_HTTP_ERROR/);
});

test('remote HTTP and credential-bearing URLs are refused before reading files', async () => {
  for(const url of ['http://remote.example','https://user:secret@example.com','https://example.com/?token=secret']) {
    const got=await run(['--once','--snapshot-file','missing.json'],{WORKBENCH_URL:url,WORKBENCH_AGENT_TOKEN:'fixture-bearer'});
    assert.equal(got.code,1);assert.match(got.stderr,/WORKBENCH_URL_INVALID/);assert.equal(got.stderr.includes('secret'),false);
  }
});

test('task import posts deduplicated records without deleting absent tasks or exposing extra fields', async (t) => {
  const { dir } = await fixture(t, ''); const path=join(dir,'tasks.json');
  await writeFile(path,JSON.stringify({tasks:[{platformId:'task-1',title:'旧标题',token:'secret'},{platformId:'task-1',title:'数学作业',status:'completed',course:'数学'}],cookies:'secret'}));
  let body, route;
  const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);route=req.url;res.writeHead(200);res.end('{"ok":true,"count":1}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const result=await run(['--tasks-file',path],{WORKBENCH_URL:'http://127.0.0.1:'+server.address().port,WORKBENCH_AGENT_TOKEN:'fixture-bearer'});
  assert.equal(result.code,0,result.stderr);assert.equal(route,'/api/sync/tasks');assert.equal(body.tasks.length,1);assert.equal(body.tasks[0].title,'数学作业');assert.equal(body.tasks[0].status,'completed');assert.equal('delete' in body,false);assert.equal(JSON.stringify(body).includes('secret'),false);
});

test('unsupported daily usage stays null while preserving actual quota', async (t) => {
  const { AppServerClient, readCodexSnapshot } = await rpc();
  const {path}=await fixture(t,`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialized')return;const answer=m.method==='account/usage/read'?{error:{code:-32601,message:'secret'}}:{result:m.method==='initialize'?{}:${JSON.stringify({rateLimits:quota.rateLimits})}};process.stdout.write(JSON.stringify({id:m.id,...answer})+'\\n');});`);
  const client=new AppServerClient({command:process.execPath,args:[path],timeoutMs:1000});t.after(()=>client.close());
  const result=await readCodexSnapshot(client);assert.equal(result.rateLimits.primary.usedPercent,25);assert.equal(result.dailyUsageBuckets,null);assert.equal(result.error,'CODEX_USAGE_UNAVAILABLE');
});

test('client close rejects outstanding requests promptly', async (t) => {
  const { AppServerClient }=await rpc();const {path}=await fixture(t,'setInterval(()=>{},1000);');
  const client=new AppServerClient({command:process.execPath,args:[path],timeoutMs:10000});t.after(()=>client.close());
  const pending=client.request('never-responds');client.close();await assert.rejects(pending,/CODEX_UNAVAILABLE/);await assert.rejects(client.request('closed'),/CODEX_UNAVAILABLE/);
});

test('invalid RPC value rejects safely instead of crashing the parent process', async (t) => {
  const {AppServerClient}=await rpc();const {path}=await fixture(t,`process.stdin.on('data',()=>process.stdout.write('null\\n'));`);
  const client=new AppServerClient({command:process.execPath,args:[path],timeoutMs:1000});t.after(()=>client.close());
  await assert.rejects(client.request('invalid'),/CODEX_PROTOCOL_ERROR/);
});

test('missing executable produces an actionable error without revealing its path', async () => {
  const {AppServerClient}=await rpc();
  const client=new AppServerClient({command:join(tmpdir(),'workbench-missing-secret-executable.exe'),timeoutMs:1000});
  try {
    await assert.rejects(client.initialize(), error=>error.message==='CODEX_EXECUTABLE_NOT_FOUND');
  } finally {client.close();}
});

test('Codex startup failures retain safe causes without forwarding stderr or credentials', async(t)=>{
  const {AppServerClient}=await rpc();
  const {safeError}=await import('../agent/index.mjs');
  const {codexSchema}=await import('../server/schema.mjs');
  const cases=[
    ['Error: Could not find home directory','CODEX_HOME_UNAVAILABLE'],
    ['Error: failed to initialize sqlite state runtime under C:\\private\\secret','CODEX_STATE_UNAVAILABLE'],
    ['Error: Access is denied. (os error 5)','CODEX_PERMISSION_DENIED'],
    ['Error: 拒绝访问。 (os error 5)','CODEX_PERMISSION_DENIED'],
    ['Error: arbitrary upstream failure','CODEX_UNAVAILABLE'],
  ];
  for(const [message,want] of cases){
    const {path}=await fixture(t,`process.stdin.resume();process.stderr.write(${JSON.stringify(message+' Bearer secret-token user@example.com\n')});setTimeout(()=>process.exit(1),30);`);
    const client=new AppServerClient({command:process.execPath,args:[path],timeoutMs:1000});
    try {
      await assert.rejects(client.initialize(),error=>error.message===want);
      assert.equal(safeError(new Error(want)),want);
      assert.equal(codexSchema.safeParse({eventId:'startup-failure',observedAt:'2026-10-03T00:00:00Z',error:want}).success,true);
    } finally {client.close();}
  }
});

test('import preserves original observation timestamp and invalid dates fail privately', async (t) => {
  const {dir}=await fixture(t,'');const path=join(dir,'snapshot.json');const original='2026-10-01T01:00:00.000Z';
  await writeFile(path,JSON.stringify({...quota,observedAt:original,eventId:'secret'}));let body;
  const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;body=JSON.parse(raw);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const env={WORKBENCH_URL:'http://127.0.0.1:'+server.address().port,WORKBENCH_AGENT_TOKEN:'fixture-bearer'};
  const first=await run(['--snapshot-file',path],env);assert.equal(first.code,0,first.stderr);assert.equal(body.observedAt,original);const eventId=body.eventId;
  await run(['--snapshot-file',path],env);assert.equal(body.eventId,eventId);
  await writeFile(path,JSON.stringify({...quota,observedAt:'secret-invalid'}));const invalid=await run(['--snapshot-file',path],env);assert.equal(invalid.code,1);assert.match(invalid.stderr,/OBSERVATION_INVALID/);assert.equal(invalid.stderr.includes('secret'),false);
});
