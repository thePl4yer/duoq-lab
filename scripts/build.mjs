import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dest=path.join(root,'dist'),modules=path.join(root,'node_modules');
await fs.rm(dest,{recursive:true,force:true});await fs.mkdir(path.join(dest,'vendor'),{recursive:true});
for(const file of ['index.html','probe.html','src','data','assets'])await fs.cp(path.join(root,file),path.join(dest,file),{recursive:true});
for(const file of ['rl_replay_subtr_actor.js','rl_replay_subtr_actor_bg.wasm','LICENSE'])await fs.copyFile(path.join(modules,'@rlrml/subtr-actor',file),path.join(dest,'vendor',file));
await fs.copyFile(path.join(modules,'nostr-tools/lib/nostr.bundle.js'),path.join(dest,'vendor/nostr.bundle.js'));
await fs.writeFile(path.join(dest,'.nojekyll'),'');
console.log('Built dist/');
