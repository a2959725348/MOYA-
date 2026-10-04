import { DatabaseSync } from 'node:sqlite';
import { createDecipheriv } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join,relative,resolve,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const inside=(parent,path)=>{const part=relative(parent,path);return part===''||(!part.startsWith('..')&&!isAbsolute(part));};
const quote=value=>value.includes('\0')?`CAST(X'${Buffer.from(value,'utf8').toString('hex')}' AS TEXT)`:`'${value.replaceAll("'","''")}'`;

function validateSecrets(rows,key) {
  for(const row of rows) {
    let value;
    try {value=JSON.parse(row.value);} catch {throw new Error('Source database contains invalid JSON; export was stopped.');}
    if(!row.key.startsWith('secret:')||value===null)continue;
    try {
      const iv=Buffer.from(value.iv,'base64'),tag=Buffer.from(value.tag,'base64');
      if(iv.length!==12||tag.length!==16)throw new Error('Invalid encryption metadata');
      const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);
      cipher.update(Buffer.from(value.data,'base64'));cipher.final();
    } catch {throw new Error('Existing credentials cannot be decrypted with this vault key. Export was stopped; use the matching original data folder and vault.key.');}
  }
}

/** Read a single SQLite snapshot without changing its rows or encryption key. */
export function exportCloudflare({source=join(projectRoot,'data'),output=join(projectRoot,'private-cloudflare-export')}={}) {
  source=resolve(source);output=resolve(output);
  if(inside(source,output))throw new Error('Export output must be outside the original data folder.');
  if(inside(projectRoot,output)&&relative(projectRoot,output).split(/[\\/]/)[0]!=='private-cloudflare-export') {
    throw new Error('Inside this project, export only into the ignored private-cloudflare-export folder.');
  }
  if(existsSync(output))throw new Error('Export output already exists; choose a new private folder outside the project. Existing exports are never overwritten.');
  const database=join(source,'workbench.sqlite'),keyPath=join(source,'vault.key');
  if(!existsSync(database)||!existsSync(keyPath))throw new Error('Source must contain the existing workbench.sqlite and vault.key.');
  const key=readFileSync(keyPath);
  if(key.length!==32)throw new Error('The original vault key must contain exactly 32 bytes.');
  const db=new DatabaseSync(database,{readOnly:true});
  let rows;
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    rows={
      kv:db.prepare('SELECT key,value FROM kv ORDER BY rowid').all(),
      records:db.prepare('SELECT collection,id,json FROM records ORDER BY rowid').all(),
      events:db.prepare('SELECT scope,id,observed FROM events ORDER BY rowid').all()
    };
    validateSecrets(rows.kv,key);
    for(const row of rows.records) {
      try {JSON.parse(row.json);} catch {throw new Error('A source record contains invalid JSON; export was stopped.');}
    }
    db.exec('COMMIT;');
  } finally {db.close();}
  // An overflow deliberately stops SQL execution before any INSERT if any app
  // table has data. Plain INSERT also refuses colliding keys; never use REPLACE.
  const statements=[
    '-- PRIVATE: contains your password hash, personal records and encrypted API credentials.',
    '-- First apply cloudflare/migrations/0001_initial.sql to a NEW, EMPTY D1 database.',
    '-- A nonempty destination causes an integer overflow before any data is inserted.',
    'SELECT CASE WHEN EXISTS(SELECT 1 FROM kv UNION ALL SELECT 1 FROM records UNION ALL SELECT 1 FROM events UNION ALL SELECT 1 FROM sessions) THEN abs(-9223372036854775808) ELSE 1 END AS require_empty_destination;'
  ];
  for(const [table,columns] of [['kv',['key','value']],['records',['collection','id','json']],['events',['scope','id','observed']]]) {
    for(const row of rows[table]) {
      const sql=`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(column=>quote(row[column])).join(',')});`;
      if(Buffer.byteLength(sql,'utf8')>100000)throw new Error('A source row exceeds the D1 SQL statement limit (100 KB). Export was stopped; split or archive the oversized record before migration.');
      statements.push(sql);
    }
  }
  const counts=Object.fromEntries(Object.entries(rows).map(([name,items])=>[name,items.length]));
  mkdirSync(output,{recursive:true,mode:0o700});
  writeFileSync(join(output,'data.sql'),statements.join('\n')+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(output,'vault-key.txt'),key.toString('base64')+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(output,'manifest.json'),JSON.stringify({format:1,createdAt:new Date().toISOString(),counts,sessionsExported:false},null,2)+'\n',{flag:'wx',mode:0o600});
  return {output,counts};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options={},args=process.argv.slice(2);
    for(let i=0;i<args.length;i+=2) {
      const name=args[i];
      if(!['--source','--output'].includes(name)||!args[i+1]||args[i+1].startsWith('--')||options[name.slice(2)]!==undefined)throw new Error('Usage: npm run cloudflare:export -- --source "existing data folder" --output "private-cloudflare-export"');
      options[name.slice(2)]=args[i+1];
    }
    const result=exportCloudflare(options);
    console.log(`Private export created: ${result.output}\nRows: ${result.counts.kv} settings/credentials, ${result.counts.records} records, ${result.counts.events} events. Login sessions excluded.\nKeep this folder private. Upload only source code to GitHub. Set VAULT_KEY from vault-key.txt in Cloudflare encrypted secrets.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
