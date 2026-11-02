import {Buffer} from 'node:buffer';

export const secretNames=['ai.apiKey','deepseek.apiKey','openai.apiKey','market.alpacaKey','market.alpacaSecret','market.tushareToken'];
export class Vault {
  constructor(store,encodedKey){
    this.store=store;
    if(typeof encodedKey!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey))throw new Error('VAULT_KEY must contain a base64-encoded 32-byte key');
    this.key=Buffer.from(encodedKey,'base64');
    if(this.key.length!==32||this.key.toString('base64')!==encodedKey)throw new Error('VAULT_KEY is invalid');
  }
  importKey(){
    return this.cryptoKey??=crypto.subtle.importKey('raw',Uint8Array.from(this.key),{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  async set(name,value){
    if(!secretNames.includes(name))throw new Error('Unknown secret');
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128},await this.importKey(),new TextEncoder().encode(value)));
    // Web Crypto appends the authentication tag; retain the existing three-field format.
    this.store.set(`secret:${name}`,{iv:Buffer.from(iv).toString('base64'),tag:Buffer.from(sealed.subarray(-16)).toString('base64'),data:Buffer.from(sealed.subarray(0,-16)).toString('base64')});
  }
  async get(name){
    if(!secretNames.includes(name))throw new Error('Unknown secret');
    const item=this.store.get(`secret:${name}`);if(!item)return null;
    const iv=Uint8Array.from(Buffer.from(item.iv,'base64')),tag=Uint8Array.from(Buffer.from(item.tag,'base64')),data=Uint8Array.from(Buffer.from(item.data,'base64'));
    if(iv.length!==12||tag.length!==16)throw new Error('Invalid encrypted secret');
    const sealed=new Uint8Array(data.length+tag.length);sealed.set(data);sealed.set(tag,data.length);
    const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv,tagLength:128},await this.importKey(),sealed);
    return new TextDecoder().decode(decrypted);
  }
  has(name){return !!this.store.get(`secret:${name}`);}
  clear(name){if(!secretNames.includes(name))throw new Error('Unknown secret');this.store.set(`secret:${name}`,null);}
}

export async function learningKey(vault,provider){
  return await vault.get('ai.apiKey')||(provider==='deepseek'?await vault.get('deepseek.apiKey'):provider==='openai'?await vault.get('openai.apiKey'):null);
}
