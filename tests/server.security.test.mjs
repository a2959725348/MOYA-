import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { validateEndpoint,isPublicAddress,transport } from '../server/network.mjs';
async function fixture(t,options={}) {
  const dataDir=await mkdtemp(join(tmpdir(),'workbench-security-'));
  const app=await createApp({dataDir,origin:'http://127.0.0.1:4318',testMode:true,...options});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const send=(method,url,payload,headers={})=>app.inject({method,url,payload,headers:{host:'127.0.0.1:4318',origin:'http://127.0.0.1:4318',...headers}});
  const setup=await send('POST','/api/auth/setup',{password:'correct horse battery staple',...(options.setupToken?{setupToken:options.setupToken}:{})});
  const cookie=setup.headers['set-cookie']?.split(';')[0];
  const req=(method,url,payload,headers={})=>send(method,url,payload,{cookie,...headers});
  return {app,send,req};
}
test('reject invalid dates and empty API endpoint with validation status',async t=>{
  const {req}=await fixture(t);
  assert.equal((await req('POST','/api/records/studySessions',{subject:'Math',minutes:30,date:'2026-99-99'})).statusCode,400);
  assert.equal((await req('PUT','/api/settings',{ai:{baseUrl:''}})).statusCode,400);
});
test('setup token and secure cookies protect publicly configured deployments',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'workbench-public-'));
  const app=await createApp({dataDir,origin:'https://workbench.example',production:true,setupToken:'fixture-setup'});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const request=payload=>app.inject({method:'POST',url:'/api/auth/setup',headers:{host:'workbench.example',origin:'https://workbench.example'},payload});
  assert.equal((await request({password:'correct horse battery staple'})).statusCode,403);
  const setup=await request({password:'correct horse battery staple',setupToken:'fixture-setup'});
  assert.equal(setup.statusCode,200);assert.match(setup.headers['set-cookie'],/HttpOnly/);assert.match(setup.headers['set-cookie'],/Secure/);assert.match(setup.headers['set-cookie'],/SameSite=Strict/);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',headers:{host:'workbench.example',origin:'http://localhost:5173'},payload:{password:'correct horse battery staple'}})).statusCode,403);
});
test('reject rebinding Host, password setup replacement and cookie authentication on sync',async t=>{
  const {req,send}=await fixture(t);
  assert.equal((await req('GET','/api/state',undefined,{host:'attacker.example'})).statusCode,403);
  assert.equal((await send('POST','/api/auth/setup',{password:'another password value'})).statusCode,409);
  assert.equal((await req('POST','/api/sync/codex',{eventId:'x',observedAt:new Date().toISOString()})).statusCode,401);
});
test('strict schemas reject secrets in snapshots and any invalid backup leaves records unchanged',async t=>{
  const {req,app}=await fixture(t);
  const token=(await req('POST','/api/agent/token',{})).json().token;
  const sync=body=>app.inject({method:'POST',url:'/api/sync/codex',headers:{host:'127.0.0.1:4318',authorization:`Bearer ${token}`},payload:body});
  assert.equal((await sync({eventId:'evt',observedAt:new Date().toISOString(),rateLimits:{primary:{usedPercent:5,apiKey:'leak'}}})).statusCode,400);
  assert.equal((await sync({eventId:'evt2',observedAt:new Date().toISOString(),error:'Bearer fixture-key'})).statusCode,400);
  const backup={version:1,exportedAt:new Date().toISOString(),records:{tasks:[{id:'good',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),title:'Good'}],accounts:[{id:'bad',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),name:'Bad',balance:-2}]}};
  assert.equal((await req('POST','/api/backup/restore',{backup,mode:'merge'})).statusCode,400);
  assert.equal((await req('GET','/api/state')).json().tasks.length,0);
});
test('outbound endpoints reject local addresses, credentials, ports and insecure schemes',()=>{
  for(const url of ['http://api.example','https://localhost/v1','https://127.0.0.1/v1','https://[::1]/v1','https://[::ffff:127.0.0.1]/v1','https://169.254.169.254','https://10.0.0.1','https://user:pass@api.example','https://api.example:8443','https://api.example?q=a']) assert.throws(()=>validateEndpoint(url),url);
  for(const address of ['0.0.0.0','10.0.0.1','127.0.0.1','192.168.1.1','172.31.0.1','100.64.0.1','169.254.0.1','224.0.0.1','fc00::1','fe80::1','::ffff:127.0.0.1','2002:7f00:1::','2001:db8::1'])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2001:4860:4860::8888'),true);
  assert.throws(()=>transport({testTransport:fetch}),/testMode/);
});
test('codex snapshots are ordered and null quota fields stay null',async t=>{
  const {app,req}=await fixture(t);const token=(await req('POST','/api/agent/token',{})).json().token;
  const observedAt=new Date().toISOString();
  const sync=payload=>app.inject({method:'POST',url:'/api/sync/codex',headers:{host:'127.0.0.1:4318',authorization:`Bearer ${token}`},payload});
  assert.equal((await sync({eventId:'new',observedAt,rateLimits:{primary:null,secondary:{usedPercent:null,windowDurationMins:300,resetsAt:null}}})).statusCode,200);
  assert.equal((await sync({eventId:'old',observedAt:new Date(Date.parse(observedAt)-1000).toISOString(),rateLimits:{primary:{usedPercent:90}}})).statusCode,400);
  const state=(await req('GET','/api/state')).json();assert.equal(state.codex.rateLimits.primary,null);assert.equal(state.codex.rateLimits.secondary.usedPercent,null);
});
test('reserved IPv6 transition and benchmarking ranges are not public outbound targets',()=>{
  for(const address of ['2001:2::1','2001:10::1','2001:20::1','3ffe::1','3fff::1','192.88.99.1'])assert.equal(isPublicAddress(address),false,address);
});
test('DNS answers containing any private address are rejected before a connection',async()=>{
  const network=await import('../server/network.mjs');
  assert.equal(typeof network.resolvePublicDestination,'function','DNS resolution must validate every answer');
  await assert.rejects(()=>network.resolvePublicDestination('provider.example',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/BLOCKED/);
  await assert.rejects(()=>network.resolvePublicDestination('provider.example',async()=>[{address:'::ffff:10.0.0.1',family:6}]),/BLOCKED/);
  const destination=await network.resolvePublicDestination('provider.example',async()=>[{address:'8.8.8.8',family:4}]);
  assert.equal(destination.address,'8.8.8.8');
});
test('local Vite origin configuration still accepts direct loopback assistant uploads',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'workbench-vite-'));
  const app=await createApp({dataDir,origin:'http://127.0.0.1:5173',apiAddress:'127.0.0.1:4318'});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:{host:'127.0.0.1:4318',origin:'http://127.0.0.1:4318'},payload:{password:'correct horse battery staple'}});
  assert.equal(setup.statusCode,200,setup.body);
  const cookie=setup.headers['set-cookie'].split(';')[0];
  const response=await app.inject({method:'POST',url:'/api/agent/token',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173',cookie},payload:{}});
  assert.equal(response.statusCode,200,response.body);
  const sync=await app.inject({method:'POST',url:'/api/sync/codex',headers:{host:'127.0.0.1:4318',authorization:`Bearer ${response.json().token}`},payload:{eventId:'local-api',observedAt:new Date().toISOString()}});
  assert.equal(sync.statusCode,200,sync.body);
});
test('encoded API and sync route characters cannot bypass authentication or Host and origin checks',async t=>{
  const {app}=await fixture(t);
  for(const url of ['/%61pi/state','/a%70i/state','/api/%73tate'])assert.equal((await app.inject({url,headers:{host:'127.0.0.1:4318'}})).statusCode,401,url);
  for(const url of ['/%61pi/agent/token','/api/%61gent/token'])assert.equal((await app.inject({method:'POST',url,headers:{host:'evil.example',origin:'https://evil.example'},payload:{}})).statusCode,403,url);
  for(const url of ['/%61pi/sync/codex','/api/%73ync/codex','/api/sync/%63odex'])assert.equal((await app.inject({method:'POST',url,headers:{host:'127.0.0.1:4318'},payload:{eventId:'attack',observedAt:new Date().toISOString()}})).statusCode,401,url);
});
