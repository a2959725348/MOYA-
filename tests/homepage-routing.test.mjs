import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.mjs';
const buildModule=await import('../scripts/prepare-homepage.mjs').catch(()=>({}));

test('homepage build preserves the compiled application and points every workbench entry to its separate path',async t=>{
 const root=await mkdtemp(join(tmpdir(),'moya-home-build-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'home'),{recursive:true});
 const app='<!doctype html><title>Workbench</title><div id="root"></div><script type="module" src="/assets/app-hash.js"></script>';
 const home='<!doctype html><title>Ocean</title><h1 id="hero-title">Moya</h1><link rel="stylesheet" href="styles.css"><a href="https://moyaiwork.com" target="_blank" rel="noopener noreferrer">进入工作台</a><a href="#about">关于我</a><video poster="media/surface.jpg" data-src="media/surface.mp4"></video><script src="video-scene.js" defer></script><script src="app.js" defer></script>';
 await writeFile(join(root,'index.html'),app);await writeFile(join(root,'home/index.html'),home);
 assert.equal(typeof buildModule.prepareHomepage,'function','homepage preparation must preserve the old app behind /workbench/');
 await buildModule.prepareHomepage(root);
 assert.equal(await readFile(join(root,'workbench/index.html'),'utf8'),app);
 const deployed=await readFile(join(root,'index.html'),'utf8');
 assert.match(deployed,/<title>Ocean<\/title>/);assert.match(deployed,/href="\/workbench\/"/);
 assert.doesNotMatch(deployed,/href="https:\/\/moyaiwork\.com"/);
 assert.match(deployed,/href="\/home\/styles\.css"/);assert.match(deployed,/data-src="\/home\/media\/surface\.mp4"/);
 assert.match(deployed,/href="#about"/);assert.match(deployed,/src="\/home\/app\.js"/);
 await buildModule.prepareHomepage(root);
 assert.equal(await readFile(join(root,'workbench/index.html'),'utf8'),app,'a repeat build step must never replace the workbench with the landing page');
});

test('server serves the public ocean homepage, authenticated app entry and deep app links without changing API protection',async t=>{
 const root=await mkdtemp(join(tmpdir(),'moya-home-server-'));let app;t.after(async()=>{await app?.close();await rm(root,{recursive:true,force:true})});
 const dist=join(root,'dist');await mkdir(join(dist,'workbench'),{recursive:true});
 await writeFile(join(dist,'index.html'),'<html>OCEAN_HOME</html>');await writeFile(join(dist,'workbench/index.html'),'<html>WORKBENCH_APP</html>');
 app=await createApp({dataDir:join(root,'data'),root:dist,origin:'http://127.0.0.1:4318',testMode:true});
 assert.match((await app.inject('/')).body,/OCEAN_HOME/);
 assert.match((await app.inject('/workbench/')).body,/WORKBENCH_APP/);
 assert.match((await app.inject('/workbench/study')).body,/WORKBENCH_APP/,'deep links must not return the public ocean homepage');
 assert.equal((await app.inject('/api/state')).statusCode,401);
 assert.equal((await app.inject('/api/auth/status')).json().configured,false);
 assert.equal((await app.inject('/health')).json().ok,true);
});
