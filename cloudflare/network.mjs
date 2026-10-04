import { isIP } from 'node:net';

const defaults=['api.deepseek.com','api.openai.com','data.alpaca.markets','api.tushare.pro'];
const invalidHost=host=>isIP(host.replace(/^\[|\]$/g,''))!==0||!host.includes('.')||host==='localhost'||/\.(localhost|local|internal|test|invalid)$/.test(host);
const failure=()=>Object.assign(new Error('API 地址必须为已批准的公共 HTTPS 地址（443 端口）'),{statusCode:400});
export function allowedHosts(env={}) {
  const hosts=new Set(defaults);
  for(const entry of String(env.AI_ALLOWED_HOSTS||'').split(/[\s,]+/).filter(Boolean)) {
    const host=entry.toLowerCase();
    if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)||invalidHost(host)||host.includes('..'))throw failure();
    hosts.add(host);
  }
  return hosts;
}
export function validateEndpoint(value,env={},options={}) {
  let url;try{url=new URL(value);}catch{throw failure();}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(!options.allowQuery&&url.search)||url.port&&url.port!=='443'||invalidHost(host)||!allowedHosts(env).has(host))throw failure();
  return url;
}
export function transport(env={},options={}) {
  const nativeFetch=options.nativeFetch||globalThis.fetch;
  return async(value,init={})=>{
    const url=validateEndpoint(String(value),env,{allowQuery:true});
    // workerd accepts manual/follow for fetch; reject redirect responses ourselves
    // before credentials can ever be forwarded to a different destination.
    const response=await nativeFetch(url.href,{...init,redirect:'manual'});
    if(response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>{});throw new Error('UPSTREAM_REDIRECT_BLOCKED');}
    return response;
  };
}
export async function jsonRequest(fetcher,url,init={}) {
  init.signal?.throwIfAborted();
  const timeout=AbortSignal.timeout(15000),signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
  const response=await fetcher(url,{...init,signal});
  if(!response.ok){await response.body?.cancel();throw new Error(`UPSTREAM_HTTP_${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('INVALID_RESPONSE');
  const decoder=new TextDecoder();let size=0,text='';
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000)throw new Error('UPSTREAM_TOO_LARGE');text+=decoder.decode(value,{stream:true});}
    return JSON.parse(text+decoder.decode());
  }finally{await reader.cancel().catch(()=>{});}
}
