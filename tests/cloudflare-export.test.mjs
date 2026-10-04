import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/db.mjs';
import { Vault } from '../server/vault.mjs';
import { hashPassword,verifyPassword } from '../server/auth.mjs';

const exporter=await import('../scripts/cloudflare-export.mjs').catch(()=>({}));
const packager=await import('../scripts/cloudflare-package.mjs').catch(()=>({}));
const schema=`CREATE TABLE kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE records (collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id));
CREATE TABLE sessions (hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE events (scope TEXT NOT NULL,id TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(scope,id));`;

function temporary(t,close=()=>{}) {
  const root=mkdtempSync(join(tmpdir(),'workbench-cloudflare-test-'));
  t.after(()=>{close();rmSync(root,{recursive:true,force:true});});
  return root;
}

test('migration preserves original password and encrypted credentials but excludes login sessions',async t=>{
  assert.equal(typeof exporter.exportCloudflare,'function','Cloudflare export must be implemented');
  let store,imported;
  const root=temporary(t,()=>{store?.close();imported?.close();}),source=join(root,'source'),output=join(root,'private-cloudflare-export');
  store=new Store(source);const vault=new Vault(store,source);
  const password=await hashPassword('my-existing-password-123');
  store.set('password',password);
  store.set('settings',{ai:{provider:'deepseek'},watchlist:["O'Reilly"]});
  store.set('agentTokenHash','original-agent-token-hash');
  vault.set('deepseek.apiKey','sensitive-existing-provider-secret');
  store.save('notes',{id:'note-1',body:"汉字 ' quote\nsecond line"});
  store.event('sync','event-1','2026-10-01T00:00:00Z');
  store.db.prepare('INSERT INTO sessions VALUES (?,?)').run('existing-session-token-hash',12345);
  const before=store.db.prepare('SELECT key,value FROM kv ORDER BY key').all();
  const result=exporter.exportCloudflare({source,output});
  assert.deepEqual(result.counts,{kv:4,records:1,events:1});
  assert.deepEqual(store.db.prepare('SELECT key,value FROM kv ORDER BY key').all(),before);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,1);
  assert.equal(readFileSync(join(output,'vault-key.txt'),'utf8').trim(),vault.key.toString('base64'));
  imported=new Store(join(root,'imported'));
  imported.db.exec(readFileSync(join(output,'data.sql'),'utf8'));
  assert.deepEqual(imported.get('password'),password);
  assert.equal(await verifyPassword('my-existing-password-123',imported.get('password')),true);
  assert.equal(imported.get('agentTokenHash'),'original-agent-token-hash');
  assert.equal(imported.list('notes')[0].body,"汉字 ' quote\nsecond line");
  assert.equal(imported.hasEvent('sync','event-1'),true);
  assert.equal(imported.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,0);
  writeFileSync(join(root,'imported','vault.key'),Buffer.from(readFileSync(join(output,'vault-key.txt'),'utf8').trim(),'base64'));
  assert.equal(new Vault(imported,join(root,'imported')).get('deepseek.apiKey'),'sensitive-existing-provider-secret');
  assert.doesNotMatch(readFileSync(join(output,'data.sql'),'utf8'),/sensitive-existing-provider-secret|existing-session-token-hash/);
});

test('import refuses any nonempty target before inserting or overwriting data',t=>{
  assert.equal(typeof exporter.exportCloudflare,'function','Cloudflare export must be implemented');
  const root=temporary(t),source=join(root,'source'),output=join(root,'private-cloudflare-export');
  const store=new Store(source);new Vault(store,source);store.set('password',{salt:'original',hash:'hash'});store.close();
  exporter.exportCloudflare({source,output});
  const sql=readFileSync(join(output,'data.sql'),'utf8');
  for(const existing of ["INSERT INTO kv VALUES ('unrelated','true');","INSERT INTO records VALUES ('notes','unrelated','{}');","INSERT INTO events VALUES ('sync','unrelated','today');","INSERT INTO sessions VALUES ('unrelated',1);"]) {
    const db=new DatabaseSync(':memory:');
    try {
      db.exec(schema+existing);
      assert.throws(()=>db.exec(sql));
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM kv WHERE key='password'").get().count,0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count,4);
    } finally {db.close();}
  }
});

test('wrong vault key and reused output are rejected without producing or replacing an export',t=>{
  assert.equal(typeof exporter.exportCloudflare,'function','Cloudflare export must be implemented');
  const root=temporary(t),source=join(root,'source'),output=join(root,'private-cloudflare-export');
  const store=new Store(source),vault=new Vault(store,source);vault.set('openai.apiKey','credential');store.close();
  writeFileSync(join(source,'vault.key'),Buffer.alloc(32));
  assert.throws(()=>exporter.exportCloudflare({source,output}),/vault|key|decrypt/i);
  assert.equal(existsSync(output),false);
  writeFileSync(join(source,'vault.key'),vault.key);
  exporter.exportCloudflare({source,output});
  const before=readFileSync(join(output,'data.sql'));
  assert.throws(()=>exporter.exportCloudflare({source,output}),/exist|empty|overwrite/i);
  assert.deepEqual(readFileSync(join(output,'data.sql')),before);
});

test('source ZIP includes hidden source config and recursively excludes credentials, state and installers',{skip:process.platform!=='win32'},async t=>{
  assert.equal(typeof packager.packageCloudflare,'function','Cloudflare source packaging must be implemented');
  const root=temporary(t),source=join(root,'source'),output=join(root,'source.zip');
  const files={
    'package.json':'{"name":"fixture"}', '.gitignore':'private-cloudflare-export/', 'wrangler.jsonc':'{}',
    'functions/api/[[path]].js':'export function onRequest() {}', 'cloudflare/migrations/0001_initial.sql':'CREATE TABLE kv (key TEXT);',
    'src/main.tsx':'source', 'docs/CLOUDFLARE.md':'guide', 'scripts/cloudflare-export.mjs':'export',
    '.env':'SECRET', 'agent/agent.env':'SECRET', 'docs/nested/.env.production':'SECRET',
    'public/nested/vault.key':'SECRET', 'src/nested/vault-key.txt':'SECRET',
    'scripts/private-cloudflare-export/data.sql':'SECRET', 'docs/backups/account.json':'SECRET',
    'public/.wrangler/state.json':'SECRET', 'src/data/records.json':'SECRET', 'tests/node_modules/key.txt':'SECRET',
    'public/downloads/installer.exe':'BINARY', 'public/downloads/archive.zip':'BINARY', 'dist/index.html':'BUILD',
    'node_modules/library.js':'DEPENDENCY', '.git/config':'GIT', 'private-cloudflare-export/vault-key.txt':'SECRET',
    'unapproved.txt':'UNKNOWN'
  };
  for(const [path,value] of Object.entries(files)) {const destination=join(source,path);mkdirSync(join(destination,'..'),{recursive:true});writeFileSync(destination,value);}
  await packager.packageCloudflare({source,output});
  const names=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:WORKBENCH_TEST_ZIP); try {$z.Entries | ForEach-Object {$_.FullName.Replace('\\','/')}} finally {$z.Dispose()}"],{env:{...process.env,WORKBENCH_TEST_ZIP:output},encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).sort();
  assert.deepEqual(names,['.gitignore','cloudflare/migrations/0001_initial.sql','docs/CLOUDFLARE.md','functions/api/[[path]].js','package.json','scripts/cloudflare-export.mjs','src/main.tsx','wrangler.jsonc'].sort());
  const existing=readFileSync(output);
  await assert.rejects(packager.packageCloudflare({source,output}),/exist|overwrite/i);
  assert.deepEqual(readFileSync(output),existing);
});
