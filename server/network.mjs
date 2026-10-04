import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

// Restrict IPv6 to globally routed unicast, excluding transition schemes.
export function isPublicAddress(address) {
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);
  }
  if(isIP(address)===6) {
    const [head,second]=address.toLowerCase().split(':'),prefix=parseInt(head,16),subnet=parseInt(second||'0',16);
    return prefix>=0x2000&&prefix<=0x3ffd&&prefix!==0x2002&&!(prefix===0x2001&&(subnet<=0x1ff||subnet===0xdb8));
  }
  return false;
}
export async function resolvePublicDestination(hostname,resolver=lookup) {
  let timer;
  try {
    const addresses=await Promise.race([resolver(hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS_TIMEOUT')),15000);})]);
    if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error('NETWORK_DESTINATION_BLOCKED');
    return addresses[0];
  } finally {clearTimeout(timer);}
}
export function validateEndpoint(value) {
  let url;try{url=new URL(value);}catch{throw Object.assign(new Error('AI 地址无效'),{statusCode:400});}
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.port&&url.port!=='443'||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||isIP(host)&&!isPublicAddress(host)) throw Object.assign(new Error('API 地址必须为公共 HTTPS 地址（443 端口）'),{statusCode:400});
  return url;
}
export function transport(options={}) {
  if(options.testTransport) {
    if(options.testMode!==true) throw new Error('Fixture transport requires explicit testMode');
    return async (url,init)=>{validateEndpoint(url.split('?')[0]);return options.testTransport(url,init);};
  }
  return async function safeRequest(value,init={}) {
    const url=validateEndpoint(value.split('?')[0]);const original=new URL(value);url.search=original.search;
    const pinned=await resolvePublicDestination(url.hostname);
    return new Promise((resolve,reject)=>{
      const request=httpsRequest(url,{method:init.method||'GET',headers:init.headers,signal:init.signal,lookup:(_,lookupOptions,callback)=>callback(null,lookupOptions.all?[pinned]:pinned.address,pinned.family)},response=>{
        const noBody=[204,205,304].includes(response.statusCode);if(noBody)response.resume();
        resolve(new Response(noBody?null:Readable.toWeb(response),{status:response.statusCode,headers:Object.entries(response.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v])}));
      });
      request.on('error',reject);if(init.body)request.write(init.body);request.end();
    });
  };
}
export async function jsonRequest(fetcher,url,init={}) {
  init.signal?.throwIfAborted();
  const response=await fetcher(url,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(!response.ok) { await response.body?.cancel();throw new Error(`UPSTREAM_HTTP_${response.status}`); }
  const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
  try { while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error('UPSTREAM_TOO_LARGE');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode()); }
  finally { await reader.cancel().catch(()=>{}); }
}
