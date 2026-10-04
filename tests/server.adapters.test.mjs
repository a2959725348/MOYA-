import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const implementation=await import('../server/app.mjs').catch(()=>({}));
async function fixture(t,handler,options={}) {
  assert.equal(typeof implementation.createApp,'function','Adapters require createApp');
  const server=createServer(handler); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dataDir=await mkdtemp(join(tmpdir(),'workbench-adapter-'));
  const testTransport=(url,options)=>fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`,options);
  const app=await implementation.createApp({dataDir,origin:'http://127.0.0.1:4318',testMode:true,testTransport,...options});
  t.after(async()=>{await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
  const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:{origin:'http://127.0.0.1:4318'},payload:{password:'correct horse battery staple'}});
  const cookie=setup.headers['set-cookie'].split(';')[0];
  const req=(method,url,payload)=>app.inject({method,url,payload,headers:{cookie,origin:'http://127.0.0.1:4318'}});
  return {app,req};
}
test('DeepSeek parses real currency balances and OpenAI costs without inventing credit',async t=>{
  const {req}=await fixture(t,(incoming,response)=>{
    response.setHeader('Content-Type','application/json');
    if(incoming.url==='/user/balance') return response.end(JSON.stringify({is_available:true,balance_infos:[{currency:'CNY',total_balance:'110.00',granted_balance:'10.00',topped_up_balance:'100.00'}]}));
    if(incoming.url.startsWith('/v1/organization/costs?')) return response.end(JSON.stringify({data:[{start_time:1,end_time:2,results:[{amount:{value:0.06,currency:'usd'}}]}],has_more:false,next_page:null}));
    response.statusCode=404;response.end('{}');
  });
  await req('PUT','/api/settings',{deepseek:{apiKey:'fixture-key'},openai:{apiKey:'fixture-admin'}});
  const result=(await req('POST','/api/providers/balances/refresh',{})).json();
  assert.equal(result.accounts.find(a=>a.provider==='deepseek').balance,110);
  const openai=result.accounts.find(a=>a.provider==='openai');assert.equal(openai.balance,null);assert.match(openai.note,/0\.06/);
});
test('Alpaca preserves feed delay, timestamp, actual trade and previous close',async t=>{
  const {req}=await fixture(t,(incoming,response)=>{
    assert.equal(new URL(`http://localhost${incoming.url}`).searchParams.get('feed'),'delayed_sip');
    response.end(JSON.stringify({latestTrade:{p:210,t:'2026-10-02T13:30:00Z'},dailyBar:{v:1234},prevDailyBar:{c:200}}));
  });
  await req('PUT','/api/settings',{market:{alpacaKey:'fixture',alpacaSecret:'fixture',alpacaFeed:'delayed_sip'}});
  await req('POST','/api/records/watchlist',{symbol:'AAPL',market:'US'});
  const result=(await req('POST','/api/market/refresh',{})).json();
  assert.equal(result.quotes[0].price,210);assert.equal(result.quotes[0].changePercent,5);assert.equal(result.quotes[0].latency,'delayed');assert.equal(result.quotes[0].asOf,'2026-10-02T13:30:00Z');
});
test('Tushare minute adapter parses columns and keeps unknown change percent null',async t=>{
  const {req}=await fixture(t,(incoming,response)=>{
    let data='';incoming.on('data',chunk=>data+=chunk);incoming.on('end',()=>{
      const body=JSON.parse(data);assert.equal(body.api_name,'rt_min');assert.equal(body.params.ts_code,'600000.SH');
      response.end(JSON.stringify({code:0,data:{fields:['ts_code','time','close','vol'],items:[['600000.SH','2026-10-02 14:00:00',10.5,100]]}}));
    });
  });
  await req('PUT','/api/settings',{market:{tushareToken:'fixture'}});
  await req('POST','/api/records/watchlist',{symbol:'600000.SH',market:'CN'});
  const quote=(await req('POST','/api/market/refresh',{})).json().quotes[0];
  assert.equal(quote.price,10.5);assert.equal(quote.changePercent,null);assert.equal(quote.latency,'minute');assert.equal(quote.asOf,'2026-10-02T06:00:00.000Z');
});
test('streaming chat persists actual text and usage and enforces daily cap',async t=>{
  const {req}=await fixture(t,(incoming,response)=>{
    response.setHeader('Content-Type','text/event-stream');
    response.end('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n');
  });
  await req('PUT','/api/settings',{ai:{apiKey:'fixture',dailyRequestLimit:1,inputPrice:2,outputPrice:3}});
  const result=await req('POST','/api/study/chat',{message:'学习',mode:'tutor'});
  assert.equal(result.statusCode,200,result.body);assert.match(result.body,/你好/);assert.match(result.body,/"type":"done"/);
  const messages=(await req('GET','/api/state')).json().chatMessages;
  assert.equal(messages.length,2);assert.equal(messages[1].tokens,15);assert.equal(messages[1].cost,0.000035);
  assert.equal((await req('POST','/api/study/chat',{message:'Again',mode:'tutor'})).statusCode,429);
});
test('upstream errors never relay credential-bearing provider body',async t=>{
  const {req}=await fixture(t,(_,response)=>{response.statusCode=401;response.end('{"error":"fixture-secret-key"}');});
  await req('PUT','/api/settings',{ai:{apiKey:'fixture-secret-key'}});
  const result=await req('POST','/api/study/chat',{message:'Test',mode:'tutor'});
  assert.equal(result.statusCode,502);assert.equal(result.body.includes('fixture-secret-key'),false);
});
test('a stream cut off before DONE returns SSE error and saves no fabricated answer',async t=>{
  const {req}=await fixture(t,(_,response)=>{response.setHeader('Content-Type','text/event-stream');response.end('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n');});
  await req('PUT','/api/settings',{ai:{apiKey:'fixture'}});
  const result=await req('POST','/api/study/chat',{message:'Test',mode:'tutor'});
  assert.match(result.body,/"type":"error"/);assert.doesNotMatch(result.body,/"type":"done"/);
  assert.equal((await req('GET','/api/state')).json().chatMessages.length,1);
});
test('concurrent chat requests cannot race through a one-request daily cap',async t=>{
  const {req}=await fixture(t,(_,response)=>{setTimeout(()=>{response.setHeader('Content-Type','text/event-stream');response.end('data: {"choices":[{"delta":{"content":"Answer"}}]}\n\ndata: [DONE]\n\n');},50);});
  await req('PUT','/api/settings',{ai:{apiKey:'fixture',dailyRequestLimit:1}});
  const results=await Promise.all([req('POST','/api/study/chat',{message:'One',mode:'tutor'}),req('POST','/api/study/chat',{message:'Two',mode:'tutor'})]);
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,429]);
  assert.equal((await req('GET','/api/state')).json().chatMessages.length,2);
});
test('usage without configured prices preserves tokens without inventing zero billed cost',async t=>{
  const {req}=await fixture(t,(_,response)=>response.end('data: {"choices":[{"delta":{"content":"Answer"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n'));
  await req('PUT','/api/settings',{ai:{apiKey:'fixture'}});
  const response=await req('POST','/api/study/chat',{message:'Test',mode:'tutor'});
  const message=(await req('GET','/api/state')).json().chatMessages[1];
  assert.equal(message.tokens,15);assert.equal('cost' in message,false);assert.equal(response.body.includes('"cost":0'),false);
});
test('SSE parser handles CRLF separators split across response chunks',async t=>{
  const {req}=await fixture(t,(_,response)=>{
    response.setHeader('Content-Type','text/event-stream');
    const chunks=['data: {"choices":[{"delta":{"content":"Split"}}]}\r','\n\r','\n','data: [DONE]\r','\n\r','\n'];
    const interval=setInterval(()=>{if(chunks.length)response.write(chunks.shift());else{clearInterval(interval);response.end();}},8);
  });
  await req('PUT','/api/settings',{ai:{apiKey:'fixture'}});
  const response=await req('POST','/api/study/chat',{message:'Test',mode:'tutor'});
  assert.match(response.body,/"type":"done"/);assert.doesNotMatch(response.body,/"type":"error"/);
  assert.equal((await req('GET','/api/state')).json().chatMessages[1].content,'Split');
});
test('market refresh is single-flight, cached, invalidated and stores distinct source observations',async t=>{
  let requests=0;
  const {req}=await fixture(t,(_,response)=>{requests++;setTimeout(()=>response.end(JSON.stringify({latestTrade:{p:210+requests,t:`2026-10-02T13:30:0${requests}Z`},dailyBar:{v:100},prevDailyBar:{c:200}})),20);});
  await req('PUT','/api/settings',{market:{alpacaKey:'fixture',alpacaSecret:'fixture'}});
  const watch=(await req('POST','/api/records/watchlist',{symbol:'AAPL',market:'US'})).json().record;
  const responses=await Promise.all([req('POST','/api/market/refresh',{}),req('POST','/api/market/refresh',{})]);
  assert.equal(responses[0].statusCode,200);assert.equal(responses[1].statusCode,200);assert.equal(requests,1);
  await req('POST','/api/market/refresh',{});assert.equal(requests,1);
  await req('PATCH',`/api/records/watchlist/${watch.id}`,{name:'Apple'});
  await req('POST','/api/market/refresh',{});assert.equal(requests,2);
  await req('PUT','/api/settings',{market:{alpacaFeed:'sip'}});
  await req('POST','/api/market/refresh',{});assert.equal(requests,3);
  const state=(await req('GET','/api/state')).json();assert.equal(state.quoteHistory.length,3);assert.equal(state.quoteHistory[0].price,211);assert.equal(state.quoteHistory[0].session,null);
  await req('DELETE',`/api/records/watchlist/${watch.id}`);assert.equal((await req('GET','/api/state')).json().quoteHistory.length,0);
});
test('market history does not append duplicate source asOf times',async t=>{
  const {req}=await fixture(t,(_,response)=>response.end(JSON.stringify({latestTrade:{p:210,t:'2026-10-02T13:30:00Z'},dailyBar:{v:100},prevDailyBar:{c:200}})));
  await req('PUT','/api/settings',{market:{alpacaKey:'fixture',alpacaSecret:'fixture'}});
  const watch=(await req('POST','/api/records/watchlist',{symbol:'AAPL',market:'US'})).json().record;
  await req('POST','/api/market/refresh',{});
  await req('PATCH',`/api/records/watchlist/${watch.id}`,{name:'Apple'});
  await req('POST','/api/market/refresh',{});
  assert.equal((await req('GET','/api/state')).json().quoteHistory.length,1);
});
test('central scheduler polls only configured watched markets and stops on removal or close',async t=>{
  const timers=new Map();let requests=0;
  const marketScheduler={setTimeout(fn,delay){const handle={unref(){}};timers.set(handle,{fn,delay});return handle;},clearTimeout(handle){timers.delete(handle);}};
  const {app,req}=await fixture(t,(_,response)=>{requests++;response.end(JSON.stringify({latestTrade:{p:210,t:'2026-10-02T13:30:00Z'}}));},{marketScheduler});
  assert.equal(timers.size,0);
  await req('PUT','/api/settings',{market:{alpacaKey:'fixture',alpacaSecret:'fixture',refreshSeconds:45}});assert.equal(timers.size,0);
  const watch=(await req('POST','/api/records/watchlist',{symbol:'AAPL',market:'US'})).json().record;
  assert.equal(timers.size,1);const [handle,timer]=[...timers][0];assert.equal(timer.delay,45000);
  timers.delete(handle);await timer.fn();assert.equal(requests,1);assert.equal(timers.size,1);
  await req('DELETE',`/api/records/watchlist/${watch.id}`);assert.equal(timers.size,0);
  await req('POST','/api/records/watchlist',{symbol:'AAPL',market:'US'});assert.equal(timers.size,1);
  await app.close();assert.equal(timers.size,0);
});
test('estimated daily budget blocks the next request after recorded known costs hit the threshold',async t=>{
  let requests=0;
  const {req}=await fixture(t,(_,response)=>{requests++;response.end('data: {"choices":[{"delta":{"content":"Answer"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n');});
  assert.equal((await req('PUT','/api/settings',{ai:{dailyBudget:0.00003}})).statusCode,400);
  const settings=await req('PUT','/api/settings',{ai:{apiKey:'fixture',inputPrice:2,outputPrice:3,dailyBudget:0.00003}});
  assert.equal(settings.statusCode,200,settings.body);assert.equal(settings.json().ai.dailyBudget,0.00003);
  assert.equal((await req('POST','/api/study/chat',{message:'One',mode:'tutor'})).statusCode,200);
  assert.equal((await req('POST','/api/study/chat',{message:'Two',mode:'tutor'})).statusCode,429);assert.equal(requests,1);
  await req('PUT','/api/settings',{ai:{dailyBudget:null}});
  assert.equal((await req('POST','/api/study/chat',{message:'Again',mode:'tutor'})).statusCode,200);assert.equal(requests,2);
});
