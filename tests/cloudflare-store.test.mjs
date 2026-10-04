import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDB} from './helpers/d1.mjs';
import {Store} from '../server/db.mjs';
import {Vault as LocalVault} from '../server/vault.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {D1Store,withStore,ConflictError}=await import('../cloudflare/store.mjs').catch(()=>({}));
const {Vault}=await import('../cloudflare/vault.mjs').catch(()=>({}));
const {budgetDatabase}=await import('../cloudflare/budget.mjs').catch(()=>({}));

test('D1 store persists records, sessions, encrypted configuration and transaction rollback',async()=>{
  assert.equal(typeof D1Store,'function');const db=await createTestDB();
  try {let store=await D1Store.open(db);store.set('settings',{name:'original'});
    const row=store.save('tasks',{title:'考试',status:'pending'});
    store.addSession('hash',Date.now()+1000);store.event('tasks','e1',new Date().toISOString());
    assert.throws(()=>store.transaction(()=>{store.set('settings',{name:'broken'});store.remove('tasks',row.id);throw Error('rollback');}));
    await store.commit();store=await D1Store.open(db);
    assert.equal(store.get('settings').name,'original');assert.equal(store.find('tasks',row.id).title,'考试');
    assert.ok(store.getSession('hash'));assert.ok(store.hasEvent('tasks','e1'));
    store.remove('tasks',row.id);store.deleteSession('hash');await store.commit();
    store=await D1Store.open(db);assert.equal(store.find('tasks',row.id),null);assert.equal(store.getSession('hash'),null);
  }finally{db.close();}
});
test('concurrent stale transaction cannot overwrite committed data or partially insert rows',async()=>{
  assert.equal(typeof D1Store,'function');const db=await createTestDB();
  try {const a=await D1Store.open(db),b=await D1Store.open(db);a.set('counter',1);b.set('counter',2);b.save('tasks',{title:'stale'});
    await a.commit();await assert.rejects(b.commit(),ConflictError);
    const fresh=await D1Store.open(db);assert.equal(fresh.get('counter'),1);assert.equal(fresh.list('tasks').length,0);
    await Promise.all(Array.from({length:4},()=>withStore(db,store=>store.set('counter',store.get('counter',0)+1),{retries:8})));
    assert.equal((await D1Store.open(db)).get('counter'),5);
  }finally{db.close();}
});
test('Cloudflare vault decrypts existing local AES settings and preserves ciphertext secrecy',async()=>{
  assert.equal(typeof Vault,'function');const dir=mkdtempSync(join(tmpdir(),'cf-vault-')),local=new Store(dir),db=await createTestDB();
  try {const lv=new LocalVault(local,dir);lv.set('ai.apiKey','test-private-api-key');
    const store=await D1Store.open(db);store.set('secret:ai.apiKey',local.get('secret:ai.apiKey'));
    const key=readFileSync(join(dir,'vault.key')).toString('base64'),vault=new Vault(store,key);
    assert.equal(vault.get('ai.apiKey'),'test-private-api-key');vault.set('deepseek.apiKey','other-private');await store.commit();
    assert.ok(!JSON.stringify(await db.prepare('SELECT * FROM kv').all()).includes('other-private'));
    assert.throws(()=>new Vault(store,'invalid'));vault.clear('ai.apiKey');assert.equal(vault.has('ai.apiKey'),false);
  }finally{local.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('large CAS retries stop before the request query budget and never publish a partial restore',async()=>{
  assert.equal(typeof budgetDatabase,'function');const db=await createTestDB();
  try {
    const limited=budgetDatabase(db,50);let queries=0,competed=false;const original=db.batch.bind(db);
    db.batch=async statements=>{
      queries+=statements.length;
      if(!competed&&statements[0]._sql.startsWith('UPDATE cloudflare_meta')){
        competed=true;db.sqlite.exec("UPDATE cloudflare_meta SET revision=revision+1,write_token='competing-request' WHERE id=1;");
      }
      return original(statements);
    };
    await assert.rejects(withStore(limited,store=>{
      for(let i=0;i<60;i++)store.save('mistakes',{question:'x'.repeat(29999),subject:'English'},'row-'+i);
    }),error=>error.statusCode===409);
    assert.ok(queries<=50,`executed ${queries} queries`);
    assert.equal((await D1Store.open(db)).list('mistakes').length,0);
  }finally{db.close();}
});
