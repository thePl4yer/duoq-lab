// Shared dataset. Read: matches.json on the repo's `data` branch. Write: signed events on free public relays,
// which the daily job collects and commits. Relays only carry small daily records and are not the archive.
import {validateSummary,publicRow,PLAYERS,mergeReplays} from './analysis.js';
export const RELAYS=['wss://relay.damus.io','wss://nos.lol','wss://nostr-pub.wellorder.net','wss://offchain.pub','wss://yabu.me','wss://nostr.21crypto.ch'];
const KIND=30078,TOPIC='duoq-lab';
export function dataUrl(file='matches.json',where=globalThis.location){
  const pages=/^([\w-]+)\.github\.io$/.exec(where?.hostname??''),repo=pages?`${pages[1]}/${where.pathname.split('/')[1]||'duoq-lab'}`:'thePl4yer/duoq-lab';
  return `https://raw.githubusercontent.com/${repo}/data/${file}`;
}
export async function fetchStore(){
  const response=await fetch(dataUrl(),{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Shared dataset unavailable.');
  const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid shared dataset.');
  return rows.map(validateSummary);
}
let library;
const signing=async()=>library??=globalThis.NostrTools??(typeof document==='undefined'?await import('nostr-tools'):await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('../vendor/nostr.bundle.js',import.meta.url);s.onload=()=>resolve(globalThis.NostrTools);s.onerror=()=>reject(Error('Signing library could not be loaded.'));document.head.append(s);}));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),unhex=s=>Uint8Array.from(s.match(/../g),h=>parseInt(h,16));
// This browser's signing key. The public half must be listed in data/keys.json before the daily job accepts its records.
export async function identity(storage=globalThis.localStorage){
  const n=await signing();let secret=storage.getItem('duoq.key');
  if(!/^[0-9a-f]{64}$/.test(secret??'')){secret=hex(n.generateSecretKey());storage.setItem('duoq.key',secret);}
  return {secret:unhex(secret),key:n.getPublicKey(unhex(secret))};
}
// Timestamp is midnight UTC of the day, so the record does not reveal when it was sent.
export async function seal(summary,secret,day=new Date().toISOString().slice(0,10)){
  const row=publicRow(summary);
  return (await signing()).finalizeEvent({kind:KIND,created_at:Date.parse(day+'T00:00:00Z')/1000,tags:[['d',TOPIC+':'+row.id],['t',TOPIC]],content:JSON.stringify(row)},secret);
}
function relay(url,onOpen,onMessage,timeout){
  return new Promise(resolve=>{
    let socket,done=false;const end=value=>{if(done)return;done=true;clearTimeout(timer);try{socket.close();}catch{}resolve(value);},timer=setTimeout(()=>end(null),timeout);
    try{socket=new WebSocket(url);}catch{return end(null);}
    socket.onopen=()=>onOpen(socket);socket.onerror=socket.onclose=()=>end(null);
    socket.onmessage=event=>{if(typeof event.data!=='string'||event.data.length>2000000)return;let m;try{m=JSON.parse(event.data);}catch{return;}if(Array.isArray(m))try{onMessage(m,end);}catch{}};
  });
}
// Resolves to the number of relays that stored the event.
export async function publish(event,relays=RELAYS){
  const stored=await Promise.all(relays.map(url=>relay(url,s=>s.send(JSON.stringify(['EVENT',event])),(m,end)=>{if(m[0]==='OK'&&m[1]===event.id)end(m[2]===true);},8000)));
  return stored.filter(Boolean).length;
}
// Signed, validated rows from the approved keys only.
export function trustedKeys(keys){
  if(!Array.isArray(keys)||keys.length>32||keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{64}$/i.test(k)))throw Error('Use at most 32 public browser keys, each 64 hexadecimal characters.');
  return [...new Set(keys.map(k=>k.toLowerCase()))];
}
export async function readRelays(keys,since=0,relays=RELAYS,{timeout=15000}={}){
  keys=trustedKeys(keys);if(!keys.length)return {rows:[],reached:0};
  const n=await signing(),found=new Map();
  const done=await Promise.all(relays.map(url=>relay(url,s=>s.send(JSON.stringify(['REQ','duoq',{kinds:[KIND],authors:keys,'#t':[TOPIC],since,limit:2000}])),(m,end)=>{
    const e=m[2];if(m[0]==='EVENT'&&m[1]==='duoq'&&e?.id&&found.size<10000&&!found.has(e.id)&&e.kind===KIND&&keys.includes(e.pubkey)&&typeof e.content==='string'&&e.content.length<1000000&&Array.isArray(e.tags)&&e.tags.some(t=>t[0]==='t'&&t[1]===TOPIC)&&n.verifyEvent(e))found.set(e.id,e);
    if(m[0]==='EOSE'&&m[1]==='duoq')end(true);
    if(m[0]==='CLOSED'&&m[1]==='duoq')end(false);
  },timeout)));
  const rows=[];
  for(const e of found.values())try{
    const row=publicRow(validateSummary(JSON.parse(e.content)));
    if(!row.players.length||row.players.some(p=>!PLAYERS.some(base=>base.id===p.id))||!e.tags.some(t=>t[0]==='d'&&t[1]===TOPIC+':'+row.id))continue;
    rows.push(row);
  }catch{}
  return {rows:mergeReplays([],rows),reached:done.filter(Boolean).length};
}
// Collector compatibility; browsers can use readRelays directly without this job.
export async function collect(keys,since,relays=RELAYS){return (await readRelays(keys,since,relays)).rows;}
