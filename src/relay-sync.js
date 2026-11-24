import {identity,readRelays,trustedKeys} from './store.js';

// Public-key pairing is local to this browser. Never request or transmit its private signing key.
export function startRelaySync({onRows,onStatus,onResend,onRetry=()=>{}}){
 const sharing=document.querySelector('#share-publicly').closest('section');
 const box=document.createElement('div');box.className='relay-sync';
 box.innerHTML=`<p>Live results sync directly between trusted browsers, without Epic login or a GitHub job. Public relays carry unencrypted match summaries; original replay files stay on your PC.</p><label for="relay-peer">Other player's public browser key (64 hex characters)</label><div class="buttons"><input id="relay-peer" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Paste their public sharing key"><button class="button" id="relay-trust">Trust browser</button></div><p>Exchange the public Key shown above and trust each other on both PCs. Never paste a private key or an account token.</p><div id="relay-peers"></div><div class="buttons"><button class="button" id="relay-refresh">Sync now</button><button class="button" id="relay-resend">Share saved matches</button></div><p id="relay-status" role="status">Starting direct sync…</p><p>“Only matches with both of us” limits sharing, not local recording. Share saved matches explicitly to backfill older recordings under your current sharing choices. Free relay storage is best-effort; keep a backup.</p>`;
 sharing.append(box);
 const status=message=>{box.querySelector('#relay-status').textContent=message;onStatus(message);};
 let peers=[];try{peers=trustedKeys(JSON.parse(localStorage.getItem('duoq.peers')??'[]'));}catch{}
 let approved=[],own='',busy=false,revision=0,stopped=false;
 const renderPeers=()=>{
  const list=box.querySelector('#relay-peers');list.replaceChildren();
  for(const key of peers){const p=document.createElement('p'),code=document.createElement('code'),button=document.createElement('button');code.textContent=key;button.className='link';button.textContent='Remove';button.onclick=()=>{peers=peers.filter(k=>k!==key);localStorage.setItem('duoq.peers',JSON.stringify(peers));revision++;renderPeers();status('Browser removed from future sync. Previously received results remain in this browser.');};p.append(code,' ',button);list.append(p);}
 };
 async function sync(){
  if(busy||stopped||!own)return;busy=true;const version=revision;
  const button=box.querySelector('#relay-refresh');button.disabled=true;
  try{
   const keys=trustedKeys([...new Set([own,...approved,...peers])]);
   const {rows,reached}=await readRelays(keys,0,undefined,{timeout:8000});
   if(stopped||version!==revision)return;
   if(rows.length)await onRows(rows);
   status(reached?`Direct sync: ${rows.length} available matches from ${reached} relays. ${peers.length+approved.filter(k=>k!==own&&!peers.includes(k)).length} trusted other browsers.`:'Relays unavailable or still loading. Saved results remain available; retrying automatically.');
  }catch(e){status('Direct sync failed: '+e.message);}
  finally{busy=false;button.disabled=false;if(!stopped)onRetry();}
 }
 box.querySelector('#relay-trust').onclick=()=>{
  try{const input=box.querySelector('#relay-peer'),key=trustedKeys([input.value.trim()])[0];if(key===own)throw Error('That is your own key. Paste the other browser’s public key.');const next=trustedKeys([...new Set([...peers,key])]);if(next.length>16)throw Error('Maximum 16 paired browsers.');peers=next;localStorage.setItem('duoq.peers',JSON.stringify(peers));revision++;input.value='';renderPeers();status('Browser trusted. Synchronizing its signed matches…');sync();}catch(e){status(e.message);}
 };
 box.querySelector('#relay-refresh').onclick=sync;
 box.querySelector('#relay-resend').onclick=async()=>{const button=box.querySelector('#relay-resend');button.disabled=true;try{await onResend();await sync();}finally{button.disabled=false;}};
 renderPeers();
 Promise.all([identity(),fetch('./data/keys.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).catch(()=>({}))]).then(([me,keys])=>{
  own=me.key;approved=trustedKeys(Object.keys(keys));document.querySelector('#share-key').textContent=own;document.querySelector('#key-status').textContent='public key for direct pairing';sync();
 }).catch(e=>status('Pairing unavailable: '+e.message));
 const timer=setInterval(()=>{if(!document.hidden)sync();},30000);
 const visible=()=>{if(!document.hidden)sync();};document.addEventListener('visibilitychange',visible);
 return {sync,close(){stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);}};
}
