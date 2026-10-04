import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {Store} from '../server/db.mjs';
import {Vault} from '../server/vault.mjs';
import {hashPassword} from '../server/auth.mjs';
import {exportCloudflare} from '../scripts/cloudflare-export.mjs';

test('actual Pages worker imports private data, logs in with original hash and decrypts original API key',{timeout:60000},async()=>{
  const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cf-runtime-'));
  let local,mf;
  try {
    execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'pages','functions','build','--outdir','.cache/cloudflare-runtime','--compatibility-date=2026-10-04','--compatibility-flags=nodejs_compat'],{
      cwd:root,env:{...process.env,WRANGLER_LOG_PATH:join(root,'.cache/wrangler/logs'),WRANGLER_SEND_METRICS:'false'},stdio:'pipe',windowsHide:true,
    });
    const data=join(temp,'source');local=new Store(data);const vault=new Vault(local,data);
    local.set('password',await hashPassword('existing runtime password'));
    vault.set('deepseek.apiKey','private-runtime-provider-key');local.save('tasks',{title:'Original task',status:'pending',course:'English',type:'assignment',dueAt:null,url:'',note:'',source:'manual'});
    const exported=join(temp,'private-cloudflare-export');exportCloudflare({source:data,output:exported});
    let balanceCalls=0,chatCalls=0;const outboundUrls=[];
    mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(root,'.cache/cloudflare-runtime/index.js'),compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],
      d1Databases:{DB:'runtime-workbench'},bindings:{APP_ORIGIN:'https://moyaiwork.com',VAULT_KEY:readFileSync(join(exported,'vault-key.txt'),'utf8').trim()},
      outboundService:async request=>{
        outboundUrls.push(request.url);
        if(request.url==='https://api.deepseek.com/user/balance'){
          balanceCalls++;assert.equal(request.headers.get('authorization'),'Bearer private-runtime-provider-key');
          return Response.json({balance_infos:[{currency:'CNY',total_balance:'15.25'}]});
        }
        if(request.url==='https://api.deepseek.com/chat/completions'){
          chatCalls++;assert.equal(request.headers.get('authorization'),'Bearer new-runtime-ai-key');
          return new Response('data: {"choices":[{"delta":{"content":"运行环境中的回答"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
        }
        throw new Error('Unexpected outbound network in runtime test');
      },
    }));
    const db=await mf.getD1Database('DB');
    const schema=readFileSync(join(root,'cloudflare/migrations/0001_initial.sql'),'utf8').split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
    await db.exec(schema);
    const sql=readFileSync(join(exported,'data.sql'),'utf8').split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
    await db.exec(sql);
    await assert.rejects(db.exec(sql),/overflow/i);
    const request=(path,init={})=>mf.dispatchFetch('https://moyaiwork.com'+path,init);
    assert.equal((await request('/api/state')).status,401);
    const login=await request('/api/auth/login',{method:'POST',headers:{Origin:'https://moyaiwork.com','Content-Type':'application/json'},body:JSON.stringify({password:'existing runtime password'})});
    assert.equal(login.status,200,await login.text());
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const state=await request('/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);
    const contents=await state.text();assert.ok(!contents.includes('private-runtime-provider-key'));
    assert.equal(JSON.parse(contents).tasks[0].title,'Original task');assert.equal(JSON.parse(contents).settings.deepseek.keyConfigured,true);
    const update=await request('/api/settings',{method:'PUT',headers:{Cookie:cookie,Origin:'https://moyaiwork.com','Content-Type':'application/json'},body:JSON.stringify({ai:{apiKey:'new-runtime-ai-key'}})});
    assert.equal(update.status,200);assert.equal((await update.json()).ai.keyConfigured,true);
    const authHeaders={Cookie:cookie,Origin:'https://moyaiwork.com','Content-Type':'application/json'};
    const balances=await request('/api/providers/balances/refresh',{method:'POST',headers:authHeaders});
    assert.equal(balances.status,200);const balanceResult=await balances.json();assert.equal(balanceCalls,1,JSON.stringify({balanceResult,outboundUrls}));assert.equal(balanceResult.accounts[0]?.balance,15.25,JSON.stringify(balanceResult));
    const chat=await request('/api/study/chat',{method:'POST',headers:authHeaders,body:JSON.stringify({mode:'tutor',message:'测试学习'})});
    assert.equal(chat.status,200);const events=await chat.text();assert.ok(events.includes('运行环境中的回答'));assert.ok(events.includes('"type":"done"'));assert.equal(chatCalls,1);
    assert.equal((await request('/api/records/tasks',{method:'POST',headers:{Cookie:cookie,Origin:'https://moyaiwork.com','Content-Type':'application/json'},body:JSON.stringify({title:'Cloud task'})})).status,200);
    assert.equal((await (await request('/api/state',{headers:{Cookie:cookie}})).json()).tasks.length,2);
    const saved=(await (await request('/api/state',{headers:{Cookie:cookie}})).json()).chatMessages;
    assert.equal(saved[1].content,'运行环境中的回答');assert.equal(saved[1].tokens,15);
    assert.equal((await request('/api/missing',{headers:{Cookie:cookie}})).status,404);
  }finally{await mf?.dispose();local?.close();rmSync(temp,{recursive:true,force:true});}
});
