import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,rmSync,constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const run=promisify(execFile);
const sourceDirectories=['cloudflare','functions','docs','src','agent','server','tests','scripts','public','deploy'];
const sourceFiles=['package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','LICENSE','LICENSE.shadcn-admin','.gitignore','.dockerignore','.env.example','.dev.vars.example','.nvmrc','index.html','tsconfig.json','vite.config.ts','wrangler.jsonc','Dockerfile','compose.yaml'];
const excludedDirectories=new Set(['data','backups','backup','node_modules','.git','.wrangler','dist','installers','.cache','.codex','.superpowers']);
function excluded(name,directory) {
  const lower=name.toLowerCase();
  if(directory)return excludedDirectories.has(lower)||lower.startsWith('private-cloudflare-export');
  if(lower==='.env.example'||lower==='.dev.vars.example')return false;
  return lower==='.env'||lower.startsWith('.env.')||lower==='agent.env'||lower.endsWith('.env')||lower.startsWith('.dev.vars')||lower==='vault.key'||lower==='vault-key.txt'||lower==='data.sql'||/\.(sqlite(?:3)?(?:-wal|-shm)?|db(?:-wal|-shm)?|key|pem|pfx|p12|exe|msi|msix|zip|7z|tar|gz|bak|log)$/i.test(lower);
}
function copySource(source,destination) {
  const stat=lstatSync(source);
  if(stat.isSymbolicLink()||excluded(source.split(/[\\/]/).at(-1),stat.isDirectory()))return;
  if(stat.isDirectory()) {
    for(const name of readdirSync(source).sort())copySource(join(source,name),join(destination,name));
  } else if(stat.isFile()) {
    mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination,constants.COPYFILE_EXCL);
  }
}

/** Source-only ZIP, made through Windows .NET with fixed PowerShell code. */
export async function packageCloudflare({source=projectRoot,output=join(projectRoot,'..','personal-workbench-cloudflare-github.zip')}={}) {
  if(process.platform!=='win32')throw new Error('Source packaging uses Windows PowerShell. On another OS, archive the same source allowlist manually and exclude all private data.');
  source=resolve(source);output=resolve(output);
  if(existsSync(output))throw new Error('Package output already exists. Existing ZIP files are never overwritten; choose another output path.');
  if(!existsSync(join(source,'package.json')))throw new Error('Source folder must contain package.json.');
  const temporary=mkdtempSync(join(tmpdir(),'workbench-cloudflare-package-'));
  try {
    const stage=join(temporary,'source');mkdirSync(stage);
    for(const name of [...sourceFiles,...sourceDirectories]) {
      const path=join(source,name);if(existsSync(path))copySource(path,join(stage,name));
    }
    const zip=join(temporary,'source.zip');
    // Paths are environment values, never executable shell text. ZipFile retains
    // .gitignore and other dotfiles that Compress-Archive can silently omit.
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:WORKBENCH_PACKAGE_STAGE,$env:WORKBENCH_PACKAGE_ZIP,[IO.Compression.CompressionLevel]::Optimal,$false)"],{env:{...process.env,WORKBENCH_PACKAGE_STAGE:stage,WORKBENCH_PACKAGE_ZIP:zip},windowsHide:true});
    mkdirSync(dirname(output),{recursive:true});copyFileSync(zip,output,constants.COPYFILE_EXCL);
    return {output};
  } finally {rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2) {
      if(!['--source','--output'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i].slice(2)]!==undefined)throw new Error('Usage: npm run cloudflare:package -- [--source "project folder"] [--output "new source.zip"]');
      options[args[i].slice(2)]=args[i+1];
    }
    const result=await packageCloudflare(options);
    console.log(`Source-only ZIP created: ${result.output}\nExtract it and upload the extracted root contents to your private GitHub repository. Personal data and credentials are excluded.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
