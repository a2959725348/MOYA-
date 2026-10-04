import {randomUUID} from 'node:crypto';

export class ConflictError extends Error {
  constructor(){super('数据正在更新，请重试');this.statusCode=409;}
}
const specs={
  kv:{columns:['key','value'],primary:['key']},
  records:{columns:['collection','id','json'],primary:['collection','id']},
  sessions:{columns:['hash','expires'],primary:['hash']},
  events:{columns:['scope','id','observed'],primary:['scope','id']},
};
const keyOf=(name,row)=>JSON.stringify(specs[name].primary.map(k=>row[k]));
const copy=value=>structuredClone(value);
const json=value=>{
  const serialized=JSON.stringify(value);
  if(serialized===undefined)throw new TypeError('Value must be serializable');
  if(new TextEncoder().encode(serialized).byteLength>1_800_000)throw Object.assign(new Error('单条数据过大，请分批导入'),{statusCode:413});
  return serialized;
};
function chunks(rows){
  const result=[];let group=[],size=2;
  for(const row of rows){const length=new TextEncoder().encode(JSON.stringify(row)).byteLength+1;
    if(group.length&&size+length>90_000){result.push(JSON.stringify(group));group=[];size=2;}
    group.push(row);size+=length;
  }
  if(group.length)result.push(JSON.stringify(group));return result;
}

// A request owns its snapshot. An atomic guarded batch publishes all its changes
// only when that snapshot is still current; a losing writer changes no tables.
export class D1Store {
  static async open(db){
    if(!db?.prepare||!db?.batch)throw new Error('D1 binding DB is missing');
    const results=await db.batch([
      db.prepare('SELECT revision FROM cloudflare_meta WHERE id=1'),
      ...Object.keys(specs).map(name=>db.prepare(`SELECT * FROM ${name} ORDER BY rowid`)),
    ]);
    if(results.some(r=>r.success===false)||!results[0].results?.length)throw new Error('D1 schema has not been initialized');
    const store=new D1Store();store.db=db;store.revision=results[0].results[0].revision;store.tables={};
    Object.keys(specs).forEach((name,index)=>{store.tables[name]=new Map(results[index+1].results.map(row=>[keyOf(name,row),{...row}]));});
    store.baseline=copy(store.tables);return store;
  }
  get(key,fallback=null){const row=this.tables.kv.get(JSON.stringify([key]));return row?JSON.parse(row.value):copy(fallback);}
  set(key,value){this.tables.kv.set(JSON.stringify([key]),{key,value:json(value)});}
  list(collection){return [...this.tables.records.values()].filter(r=>r.collection===collection).map(r=>JSON.parse(r.json));}
  find(collection,id){const row=this.tables.records.get(JSON.stringify([collection,id]));return row?JSON.parse(row.json):null;}
  save(collection,fields,id=fields.id||randomUUID(),{preserveMetadata=false}={}){
    const previous=this.find(collection,id),now=new Date().toISOString();
    const record={...fields,id,createdAt:preserveMetadata?fields.createdAt:previous?.createdAt||fields.createdAt||now,updatedAt:preserveMetadata?fields.updatedAt:now};
    this.tables.records.set(JSON.stringify([collection,id]),{collection,id,json:json(record)});return copy(record);
  }
  remove(collection,id){return Number(this.tables.records.delete(JSON.stringify([collection,id])));}
  transaction(callback){
    const checkpoint=copy(this.tables);
    try {const value=callback();if(value?.then)throw new TypeError('Snapshot transactions require synchronous callbacks');return value;}
    catch(e){this.tables=checkpoint;throw e;}
  }
  hasEvent(scope,id){return this.tables.events.has(JSON.stringify([scope,id]));}
  event(scope,id,observed){
    if(this.hasEvent(scope,id))throw new Error('Duplicate synchronization event');
    this.tables.events.set(JSON.stringify([scope,id]),{scope,id,observed});
    const scoped=[...this.tables.events.entries()].filter(([,row])=>row.scope===scope);
    for(const [key] of scoped.slice(0,Math.max(0,scoped.length-5000)))this.tables.events.delete(key);
  }
  getSession(hash){return copy(this.tables.sessions.get(JSON.stringify([hash]))??null);}
  addSession(hash,expires){this.tables.sessions.set(JSON.stringify([hash]),{hash,expires});}
  deleteSession(hash){this.tables.sessions.delete(JSON.stringify([hash]));}
  deleteOtherSessions(hash){for(const [key,row] of this.tables.sessions)if(row.hash!==hash)this.tables.sessions.delete(key);}
  pruneSessions(now=Date.now()){for(const [key,row] of this.tables.sessions)if(row.expires<=now)this.tables.sessions.delete(key);}
  async commit(){
    const token=randomUUID(),guard='EXISTS (SELECT 1 FROM cloudflare_meta WHERE id=1 AND write_token=?)',statements=[];
    for(const [name,spec] of Object.entries(specs)){
      const before=this.baseline[name],after=this.tables[name];
      const upserts=[...after].filter(([key,row])=>JSON.stringify(before.get(key))!==JSON.stringify(row)).map(([,row])=>row);
      const deletes=[...before].filter(([key])=>!after.has(key)).map(([,row])=>row);
      const selected=spec.columns.map(c=>`json_extract(value,'$.${c}')`).join(',');
      const assignments=spec.columns.filter(c=>!spec.primary.includes(c)).map(c=>`${c}=excluded.${c}`).join(',');
      for(const payload of chunks(upserts))statements.push(this.db.prepare(`INSERT INTO ${name} (${spec.columns.join(',')}) SELECT ${selected} FROM json_each(?) WHERE ${guard} ON CONFLICT (${spec.primary.join(',')}) DO UPDATE SET ${assignments}`).bind(payload,token));
      for(const payload of chunks(deletes))statements.push(this.db.prepare(`DELETE FROM ${name} WHERE ${guard} AND EXISTS (SELECT 1 FROM json_each(?) AS removed WHERE ${spec.primary.map(c=>`${name}.${c}=json_extract(removed.value,'$.${c}')`).join(' AND ')})`).bind(token,payload));
    }
    if(!statements.length)return;
    // Leave room for authentication, rate-limit and snapshot queries in the free
    // plan's 50-query request budget. Large backup restores must be split.
    if(statements.length>38)throw Object.assign(new Error('本次更新过大，请分批导入'),{statusCode:413});
    const batch=await this.db.batch([
      this.db.prepare('UPDATE cloudflare_meta SET revision=revision+1,write_token=? WHERE id=1 AND revision=?').bind(token,this.revision),
      ...statements,
    ]);
    if(batch.some(r=>r.success===false))throw new Error('D1 write failed');
    if(batch[0].meta.changes!==1)throw new ConflictError();
    this.revision++;this.baseline=copy(this.tables);
  }
}

// Use this only for database work. Retrying a callback that calls a paid API
// could charge the user twice; chat reserves and persists in separate calls.
export async function withStore(db,callback,{retries=5}={}){
  for(let attempt=0;;attempt++){
    const store=await D1Store.open(db);
    try {const result=await callback(store);await store.commit();return result;}
    catch(error){if(!(error instanceof ConflictError)||attempt>=retries)throw error;}
  }
}
