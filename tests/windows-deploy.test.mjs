import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const installer=resolve('deploy/windows/Install.ps1');
const ps=process.env.SystemRoot ? join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe';
function run(args) { return spawnSync(ps,['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,...args],{encoding:'utf8'}); }
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'workbench-deploy-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'package');
  mkdirSync(join(source,'dist'),{recursive:true}); mkdirSync(join(source,'server'));
  writeFileSync(join(source,'dist/index.html'),'<html>fixture</html>');
  writeFileSync(join(source,'server/index.mjs'),'// fixture');
  writeFileSync(join(source,'package.json'),'{}'); writeFileSync(join(source,'package-lock.json'),'{}');
  return {root,source,target:join(root,'installation')};
}
test('Windows installation plan makes no filesystem changes and binds only loopback',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t); const result=run(['-PackageRoot',f.source,'-InstallRoot',f.target,'-PlanOnly']);
  assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(result.stdout.trim());
  assert.equal(plan.host,'127.0.0.1'); assert.equal(plan.origin,'http://127.0.0.1:4318');
  assert.equal(plan.publicHttpsEnabled,false); assert.equal(existsSync(f.target),false);
});
test('Windows preparation preserves existing database and credentials on update',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t); const args=['-PackageRoot',f.source,'-InstallRoot',f.target,'-PrepareOnly'];
  let result=run(args); assert.equal(result.status,0,result.stderr);
  const env=readFileSync(join(f.target,'.env'),'utf8');
  assert.match(env,/SETUP_TOKEN=[a-f0-9]{64}/); assert.doesNotMatch(result.stdout,/SETUP_TOKEN=/);
  writeFileSync(join(f.target,'data/workbench.sqlite'),'existing database');
  writeFileSync(join(f.target,'data/vault.key'),'existing key');
  result=run(args); assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(f.target,'.env'),'utf8'),env);
  assert.equal(readFileSync(join(f.target,'data/workbench.sqlite'),'utf8'),'existing database');
  assert.equal(readFileSync(join(f.target,'data/vault.key'),'utf8'),'existing key');
  const active=JSON.parse(readFileSync(join(f.target,'deployment.json'),'utf8'));
  assert.equal(readFileSync(join(active.appDir,'dist/index.html'),'utf8'),'<html>fixture</html>');
});
test('Windows installer rejects drive root and unrelated nonempty directories',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t);
  const drive=resolve(f.root).slice(0,3);
  const rejectedRoot=run(['-PackageRoot',f.source,'-InstallRoot',drive,'-PlanOnly']);
  assert.notEqual(rejectedRoot.status,0); assert.match(rejectedRoot.stderr,/Unsafe install directory/);
  mkdirSync(f.target); writeFileSync(join(f.target,'unrelated.txt'),'keep');
  const rejectedForeign=run(['-PackageRoot',f.source,'-InstallRoot',f.target,'-PrepareOnly']);
  assert.notEqual(rejectedForeign.status,0); assert.match(rejectedForeign.stderr,/not a workbench installation/);
  assert.equal(readFileSync(join(f.target,'unrelated.txt'),'utf8'),'keep');
});
