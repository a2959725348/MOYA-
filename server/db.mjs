import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(dataDir) {
    mkdirSync(dataDir,{recursive:true,mode:0o700});
    this.db = new DatabaseSync(join(dataDir,'workbench.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (scope TEXT NOT NULL,id TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(scope,id));`);
  }
  get(key,fallback=null) { const row=this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row?JSON.parse(row.value):fallback; }
  set(key,value) { this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  list(collection) { return this.db.prepare('SELECT json FROM records WHERE collection=? ORDER BY rowid').all(collection).map(r=>JSON.parse(r.json)); }
  find(collection,id) { const row=this.db.prepare('SELECT json FROM records WHERE collection=? AND id=?').get(collection,id);return row?JSON.parse(row.json):null; }
  save(collection,fields,id=fields.id||randomUUID(),{preserveMetadata=false}={}) {
    const previous=this.find(collection,id), now=new Date().toISOString();
    const record={...fields,id,createdAt:preserveMetadata?fields.createdAt:previous?.createdAt||fields.createdAt||now,updatedAt:preserveMetadata?fields.updatedAt:now};
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json').run(collection,id,JSON.stringify(record));
    return record;
  }
  remove(collection,id) { return this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection,id).changes; }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;} }
  hasEvent(scope,id) { return !!this.db.prepare('SELECT 1 FROM events WHERE scope=? AND id=?').get(scope,id); }
  event(scope,id,observed) { this.db.prepare('INSERT INTO events VALUES (?,?,?)').run(scope,id,observed); this.db.prepare('DELETE FROM events WHERE scope=? AND rowid NOT IN (SELECT rowid FROM events WHERE scope=? ORDER BY rowid DESC LIMIT 5000)').run(scope,scope); }
  close() { if(this.db.isOpen) this.db.close(); }
}
