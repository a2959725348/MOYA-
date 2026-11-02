import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep the existing compiled React app intact. Only replace its public entry page.
export async function prepareHomepage(distDir) {
 const root=resolve(distDir),entry=join(root,'index.html'),appEntry=join(root,'workbench/index.html');
 const built=await readFile(entry,'utf8');
 const isApp=html=>/<div\s+id=["']root["']/.test(html);
 const app=isApp(built)?built:await readFile(appEntry,'utf8');
 if(!isApp(app))throw new Error('Compiled workbench entry missing; homepage was not replaced');
 let home=await readFile(join(root,'home/index.html'),'utf8');
 if(!home.includes('id="hero-title"'))throw new Error('Approved ocean homepage missing');
 home=home.replace(/\b(data-src|poster|href|src)="(styles\.css|video\.css|video-scene\.js|app\.js|media\/[^"<>]+)"/g,(_,attribute,path)=>`${attribute}="/home/${path}"`);
 home=home.replaceAll('href="https://moyaiwork.com"','href="/workbench/"');
 home=home.replace(/<a\b[^>]*href="\/workbench\/"[^>]*>/g,tag=>tag.replace(/\s+target="_blank"/g,'').replace(/\s+rel="noopener noreferrer"/g,''));
 await mkdir(join(root,'workbench'),{recursive:true});
 await writeFile(appEntry,app);
 await writeFile(entry,home);
 return {homepage:entry,workbench:appEntry};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const result=await prepareHomepage(resolve(fileURLToPath(new URL('../dist',import.meta.url))));
 console.log('Ocean homepage prepared; existing workbench available at /workbench/');
}
