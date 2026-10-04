import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

export const secretNames=['ai.apiKey','deepseek.apiKey','openai.apiKey','market.alpacaKey','market.alpacaSecret','market.tushareToken'];
export class Vault {
  constructor(store,encodedKey){
    this.store=store;
    if(typeof encodedKey!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey))throw new Error('VAULT_KEY must contain a base64-encoded 32-byte key');
    this.key=Buffer.from(encodedKey,'base64');
    if(this.key.length!==32||this.key.toString('base64')!==encodedKey)throw new Error('VAULT_KEY is invalid');
  }
  set(name,value){
    if(!secretNames.includes(name))throw new Error('Unknown secret');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    this.store.set(`secret:${name}`,{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
  }
  get(name){
    if(!secretNames.includes(name))throw new Error('Unknown secret');
    const item=this.store.get(`secret:${name}`);if(!item)return null;
    const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(item.iv,'base64'));cipher.setAuthTag(Buffer.from(item.tag,'base64'));
    return Buffer.concat([cipher.update(Buffer.from(item.data,'base64')),cipher.final()]).toString('utf8');
  }
  has(name){return !!this.store.get(`secret:${name}`);}
  clear(name){if(!secretNames.includes(name))throw new Error('Unknown secret');this.store.set(`secret:${name}`,null);}
}
