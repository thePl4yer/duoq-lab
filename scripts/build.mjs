import fs from 'node:fs/promises';
import path from 'node:path';
import {assetVersion} from './asset-version.mjs';
const root=path.resolve(import.meta.dirname,'..'),dest=path.join(root,'dist'),modules=path.join(root,'node_modules');
if(path.dirname(dest)!==root)throw Error('Build output must remain inside this project.');
await fs.rm(dest,{recursive:true,force:true});await fs.mkdir(path.join(dest,'vendor'),{recursive:true});
for(const file of ['index.html','probe.html','src','data','assets'])await fs.cp(path.join(root,file),path.join(dest,file),{recursive:true});
for(const file of ['rl_replay_subtr_actor.js','rl_replay_subtr_actor_bg.wasm','LICENSE'])await fs.copyFile(path.join(modules,'@rlrml/subtr-actor',file),path.join(dest,'vendor',file));
await fs.copyFile(path.join(modules,'nostr-tools/lib/nostr.bundle.js'),path.join(dest,'vendor/nostr.bundle.js'));
const entries=[];
async function fingerprint(directory,prefix){
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name),name=prefix+'/'+entry.name;
  if(entry.isDirectory())await fingerprint(file,name);else if(entry.isFile())entries.push([name,await fs.readFile(file)]);
 }
}
await fingerprint(path.join(dest,'src'),'src');
await fingerprint(path.join(dest,'vendor'),'vendor');
entries.push(['index.html',await fs.readFile(path.join(dest,'index.html'))]);
entries.push(['scripts/build.mjs',await fs.readFile(new URL('./build.mjs',import.meta.url))]);
entries.push(['scripts/asset-version.mjs',await fs.readFile(new URL('./asset-version.mjs',import.meta.url))]);
const version=assetVersion(entries),sourceDirectory='src-'+version,vendorDirectory='vendor-'+version;
await fs.rename(path.join(dest,'src'),path.join(dest,sourceDirectory));
await fs.rename(path.join(dest,'vendor'),path.join(dest,vendorDirectory));
async function linkVendors(directory){
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())await linkVendors(file);
  else if(entry.name.endsWith('.js'))await fs.writeFile(file,(await fs.readFile(file,'utf8')).replaceAll('../vendor/','../'+vendorDirectory+'/'));
 }
}
await linkVendors(path.join(dest,sourceDirectory));
const html=(await fs.readFile(path.join(dest,'index.html'),'utf8')).replaceAll('./src/','./'+sourceDirectory+'/');
await fs.writeFile(path.join(dest,'index.html'),html);
await fs.writeFile(path.join(dest,'build.json'),JSON.stringify({version,sourceDirectory,vendorDirectory}));
await fs.writeFile(path.join(dest,'.nojekyll'),'');
console.log(`Built dist/ (${sourceDirectory}; versioned modules and styles)`);
