import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const children=[];let exiting=false;
function close(code=0){if(exiting)return;exiting=true;for(const child of children)child.kill();process.exitCode=code;}
for(const [name,args] of [['API',['--watch','server/index.mjs']],['WEB',['node_modules/vite/bin/vite.js','--host','127.0.0.1']]]){
 const child=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});children.push(child);
 child.on('error',error=>{process.stderr.write(`${name}: ${error.code||'START_FAILED'}\n`);close(1)});
 child.on('exit',code=>{if(!exiting)close(code??1)});
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close());
process.on('exit',()=>{for(const child of children)if(!child.killed)child.kill()});
process.stdout.write('栖台开发预览：http://127.0.0.1:5173/\n演示：http://127.0.0.1:5173/#demo\n按 Ctrl+C 停止前端和后端。\n');
