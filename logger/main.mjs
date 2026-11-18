import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MatchCollector} from './match.mjs';
import {SummaryStore,sendSummary} from './store.mjs';

const directory=fileURLToPath(new URL('./',import.meta.url));
const endpoint='https://duoq-lab-library-tk.fairy-cat-9312.chatgpt.site/api/replays';
const socketUrl='ws://127.0.0.1:49124';
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('DuoQ Rocket League logger\nRun: node main.mjs [--dry-run]\nManual start only. Stop with Ctrl+C or close this window.\n--dry-run: show target summaries without saving or sending them.\nRun Configure API.cmd once before starting Rocket League.');
  process.exit(0);
}
if(args.some(a=>a!=='--dry-run'))throw Error('Unknown option. Use --help.');
if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or newer is required. See https://nodejs.org/');
const dryRun=args.includes('--dry-run');
let config={};
try{config=JSON.parse(await fs.readFile(path.join(directory,'logger.config.json'),'utf8'));}
catch(e){if(e.code!=='ENOENT')throw e;}
if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>k!=='aliases'))throw Error('logger.config.json accepts only public platform-ID aliases.');

console.log('DuoQ Lab · Rocket League logger\nManual session: no Windows startup, service or scheduled task.');
console.log('Reads only Rocket League at '+socketUrl+'. No game commands are sent.');
console.log(dryRun?'DRY RUN: no files saved and no data uploaded.':'Completed Kate/PLAYER summaries are published to the public DuoQ library.\nOnly this logger\'s pending summaries and sent match IDs are stored in ./data/.');
console.log('No Epic/Steam login, replay files, game logs, process scanning, keyboard capture or other applications.\nStop with Ctrl+C or close this window.\n');

let store,lock,stopping=false,socket,reconnect,retry,work=Promise.resolve();
const dataDirectory=path.join(directory,'data');
const lockfile=path.join(dataDirectory,'session.lock');
if(!dryRun){
  await fs.mkdir(dataDirectory,{recursive:true});
  try{lock=await fs.open(lockfile,'wx',0o600);}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    const previous=Number(await fs.readFile(lockfile,'utf8'));
    if(!Number.isSafeInteger(previous)||previous<1)throw Error('Invalid session lock. Close other logger windows, then remove data/session.lock.');
    let active=true;
    try{process.kill(previous,0);}catch(error){if(error.code==='ESRCH')active=false;else throw error;}
    if(active)throw Error('Another logger session is already running. Use its window.');
    await fs.unlink(lockfile);lock=await fs.open(lockfile,'wx',0o600);
  }
  await lock.writeFile(String(process.pid));
  try{store=await new SummaryStore(dataDirectory).open();}catch(e){await lock.close();await fs.unlink(lockfile);throw e;}
}
const report=message=>console.log(new Date().toLocaleTimeString()+' · '+message);
async function drain(){
  if(!store||stopping)return;
  while(store.pending.length&&!stopping){
    const row=store.pending[0];
    try{await sendSummary(row,{endpoint});await store.acknowledge(row.id);report('Published match '+row.id);}
    catch(e){report(e.message);return;}
  }
}
function serial(task){work=work.then(task).catch(e=>report('Logger error: '+e.message));}
const collector=new MatchCollector({aliases:config.aliases??{},onNotice:report,onSummary:row=>{
  if(dryRun){console.log(JSON.stringify(row,null,2));return;}
  serial(async()=>{if(await store.enqueue(row))report('Queued completed Rocket League match '+row.id);await drain();});
}});
function connect(){
  if(stopping)return;
  let live=false;
  socket=new WebSocket(socketUrl);
  socket.addEventListener('open',()=>{live=true;report('Connected to Rocket League. Waiting for completed matches containing Kate or PLAYER.');});
  socket.addEventListener('message',event=>{
    if(typeof event.data!=='string'||event.data.length>1024*1024)return;
    try{collector.accept(JSON.parse(event.data));}catch{report('Ignored an invalid Rocket League packet.');}
  });
  socket.addEventListener('error',()=>{});
  socket.addEventListener('close',()=>{
    collector.disconnect();
    if(stopping)return;
    report(live?'Rocket League disconnected. Unfinished matches were not published.':'Waiting for Rocket League on port 49124. If needed, run Configure API.cmd, then restart the game.');
    reconnect=setTimeout(connect,5000);
  });
}
async function stop(){
  if(stopping)return;stopping=true;
  clearTimeout(reconnect);clearInterval(retry);collector.close();socket?.close();
  report('Stopping. Completed unsent summaries remain in this logger\'s data folder.');
  await work;
  if(lock){await lock.close();await fs.unlink(lockfile).catch(()=>{});}
  process.exit(0);
}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
serial(drain);retry=setInterval(()=>serial(drain),15000);connect();
