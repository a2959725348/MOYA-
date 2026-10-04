import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.mjs';
const appRoot=fileURLToPath(new URL('../',import.meta.url));
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4318),production=process.env.NODE_ENV==='production';
const origin=process.env.APP_ORIGIN||`http://${host==='0.0.0.0'?'127.0.0.1':host}:${port}`;
const setupToken=process.env.SETUP_TOKEN||process.env.APP_SETUP_TOKEN;
if(!['127.0.0.1','localhost','::1'].includes(host)&&!setupToken){throw new Error('Public binding requires SETUP_TOKEN for initial account setup');}
const app=await createApp({dataDir:resolve(process.env.DATA_DIR||resolve(appRoot,'data')),root:resolve(appRoot,'dist'),origin,apiAddress:['127.0.0.1','localhost','::1'].includes(host)?`${host==='::1'?'[::1]':host}:${port}`:undefined,production,setupToken,logger:true});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
await app.listen({host,port});
