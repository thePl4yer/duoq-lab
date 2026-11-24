import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {identity,seal,publish,readRelays,trustedKeys} from '../src/store.js';
import {mergeReplays,PLAYERS} from '../src/analysis.js';

test('Two separate browser identities exchange a solo match directly; unknown authors, altered signatures and wrong tags are rejected',async()=>{
 const original=globalThis.WebSocket,events=[];
 class FakeRelay{
  constructor(){queueMicrotask(()=>this.onopen?.());}
  close(){}
  send(text){const m=JSON.parse(text);queueMicrotask(()=>{if(m[0]==='EVENT'){events.push(m[1]);this.onmessage?.({data:JSON.stringify(['OK',m[1].id,true])});}else if(m[0]==='REQ'){for(const e of events)this.onmessage?.({data:JSON.stringify(['EVENT',m[1],e])});this.onmessage?.({data:JSON.stringify(['EOSE',m[1]])});}});}
 }
 globalThis.WebSocket=FakeRelay;
 const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
 try{
  const a=await identity(storage()),b=await identity(storage()),stranger=await identity(storage());assert.notEqual(a.key,b.key);
  const seed=JSON.parse(fs.readFileSync(new URL('../data/seed.json',import.meta.url)))[0];
  const row={...seed,id:'DIRECT-SOLO-TEST',players:[{...seed.players[0],id:PLAYERS[0].id}]};
  const event=await seal(row,a.secret);assert.equal(await publish(event,['wss://test']),1);
  events.push({...event,content:event.content.replace('DIRECT-SOLO-TEST','TAMPERED')});
  events.push(await seal({...row,id:'STRANGER'},stranger.secret));
  const wrong=await seal({...row,id:'WRONG-TAG'},a.secret);const {finalizeEvent}=await import('nostr-tools');events.push(finalizeEvent({kind:wrong.kind,created_at:wrong.created_at,tags:[['t','duoq-lab'],['d','duoq-lab:OTHER']],content:wrong.content},a.secret));
  const result=await readRelays([a.key,b.key],0,['wss://test'],{timeout:100});
  assert.equal(result.reached,1);assert.deepEqual(result.rows.map(r=>r.id),['DIRECT-SOLO-TEST']);assert.equal(result.rows[0].players.length,1);
  assert.equal(mergeReplays(result.rows,result.rows).length,1);
  assert.deepEqual(await readRelays([],0,['wss://test']),{rows:[],reached:0});
  assert.throws(()=>trustedKeys(['not-a-public-key']));
 }finally{globalThis.WebSocket=original;}
});
