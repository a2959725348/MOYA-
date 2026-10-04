import { DatabaseSync } from 'node:sqlite';

// Execute the real SQLite SQL generated for D1, including atomic batch rollback.
export async function createTestDB() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE records(collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id));
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
    CREATE TABLE events(scope TEXT NOT NULL,id TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(scope,id));
    CREATE TABLE cloudflare_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,write_token TEXT NOT NULL);
    INSERT INTO cloudflare_meta VALUES(1,0,'');
    CREATE TABLE cloudflare_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  const prepare=(sql,values=[])=>({
    bind(...args){return prepare(sql,args);},
    async all(){return {success:true,results:sqlite.prepare(sql).all(...values),meta:{changes:0}};},
    async first(column){const row=sqlite.prepare(sql).get(...values);return column?row?.[column]??null:row??null;},
    async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,results:[],meta:{changes:Number(result.changes)}};},
    _sql:sql,_values:values,
  });
  return {prepare,async batch(statements){
    sqlite.exec('BEGIN IMMEDIATE');
    try {const result=statements.map(s=>{
      if(/^\s*SELECT/i.test(s._sql))return {success:true,results:sqlite.prepare(s._sql).all(...s._values),meta:{changes:0}};
      const stmt=sqlite.prepare(s._sql);
      if(/\bRETURNING\b/i.test(s._sql))return {success:true,results:stmt.all(...s._values),meta:{changes:0}};
      const out=stmt.run(...s._values);return {success:true,results:[],meta:{changes:Number(out.changes)}};
    });sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}
  },async exec(sql){sqlite.exec(sql);return {count:1,duration:0};},close(){sqlite.close();},sqlite};
}
