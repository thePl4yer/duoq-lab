import test from 'node:test';
import assert from 'node:assert/strict';
import {assetVersion} from '../scripts/asset-version.mjs';

test('Any changed import, worker, stylesheet or vendor gets a fresh module graph URL',()=>{
 const original=[['src/app.js','import "./store.js"'],['src/store.js','old'],['src/replay.js','worker'],['src/style.css','style'],['vendor/nostr.bundle.js','vendor']];
 const version=assetVersion(original);
 assert.match(version,/^[a-f0-9]{12}$/);
 assert.equal(assetVersion([...original].reverse()),version);
 for(const [name] of original)assert.notEqual(assetVersion(original.map(([path,content])=>[path,content+(path===name?' changed':'')])),version);
 const base=new URL(`https://example.com/duoq-lab/src-${version}/app.js`);
 assert.equal(new URL('./store.js',base).pathname,`/duoq-lab/src-${version}/store.js`);
 assert.equal(new URL('./replay.js',base).pathname,`/duoq-lab/src-${version}/replay.js`);
 assert.equal(new URL('../vendor/nostr.bundle.js',base).pathname,'/duoq-lab/vendor/nostr.bundle.js');
});
