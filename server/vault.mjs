import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const secretNames=['ai.apiKey','deepseek.apiKey','openai.apiKey','market.alpacaKey','market.alpacaSecret','market.tushareToken'];
export class Vault {
  constructor(store,dataDir) {
    this.store=store;
    const path=join(dataDir,'vault.key');
    try { this.key=readFileSync(path); }
    catch(error) { if(error.code!=='ENOENT') throw error;this.key=randomBytes(32);writeFileSync(path,this.key,{flag:'wx',mode:0o600}); }
    if(this.key.length!==32) throw new Error('Vault key is invalid');
  }
  set(name,value) {
    if(!secretNames.includes(name)) throw new Error('Unknown secret');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    this.store.set(`secret:${name}`,{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
  }
  get(name) {
    const item=this.store.get(`secret:${name}`);if(!item) return null;
    const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(item.iv,'base64'));cipher.setAuthTag(Buffer.from(item.tag,'base64'));
    return Buffer.concat([cipher.update(Buffer.from(item.data,'base64')),cipher.final()]).toString('utf8');
  }
  has(name) { return !!this.store.get(`secret:${name}`); }
  clear(name) { this.store.set(`secret:${name}`,null); }
}
