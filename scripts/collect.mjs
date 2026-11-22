// Daily collector. Writes matches.json (and the encrypted logins) into DATA_DIR, a checkout of the `data` branch.
//   node scripts/collect.mjs                 renew logins, relay intake, and in the early morning Epic match history if the player is certainly offline
//   node scripts/collect.mjs login player    bind an Epic account by device code (also: login scout)
// Output is counts and reasons only: no names, account ids, emails or tokens.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto as crypto} from 'node:crypto';
import {PLAYERS,mergeReplays,validateSummary,modeId,publicRow} from '../src/analysis.js';
import * as psynet from '../src/psynet.js';
import {summarise} from '../src/replay.js';
import {collect as relayRows} from '../src/store.js';

const root=path.resolve(import.meta.dirname,'..'),dir=path.resolve(process.env.DATA_DIR??path.join(root,'store'));
const files={matches:path.join(dir,'matches.json'),logins:path.join(dir,'logins.json')};
const owner=PLAYERS.find(p=>p.id===(process.env.OWNER??PLAYERS[1].id));
const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}};
const log=message=>console.log(message),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mask=value=>{if(value&&process.env.GITHUB_ACTIONS)console.log('::add-mask::'+value);};

// Logins are stored encrypted (AES-256-GCM) with a key derived from the LOGIN_KEY secret.
export async function loginKey(secret=process.env.LOGIN_KEY??''){
  if(secret.length<24)throw Error('LOGIN_KEY must be a secret of at least 24 characters.');
  return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt','decrypt']);
}
export async function lock(value,key){
  const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
  return {iv:Buffer.from(iv).toString('base64'),data:Buffer.from(data).toString('base64')};
}
export async function unlock(box,key){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(box.iv,'base64')},key,Buffer.from(box.data,'base64'))));}
const saveLogins=state=>fs.writeFile(files.logins,JSON.stringify(state)+'\n');

// Refresh tokens rotate and may only live for hours, so every run renews both logins first.
// Renewing talks to Epic's login service only; it never touches the game.
async function renew(state,key,io){
  const tokens={},again='connect it again (Actions > Collect matches > Run workflow > login)';
  for(const role of ['player','scout'])if(state[role]){
    let refresh;
    try{refresh=(await unlock(state[role],key)).refresh_token;}catch{delete state[role];log(`${role}: stored login unreadable (LOGIN_KEY changed), ${again}`);process.exitCode=1;continue;}
    try{const token=await psynet.refreshToken(refresh,io);mask(token.access_token);mask(token.refresh_token);state[role]=await lock({refresh_token:token.refresh_token},key);tokens[role]=token;}
    catch(e){
      // Only a definite refusal ends a login; a network or server error keeps it for the next run.
      if(e.status===400||e.status===401){delete state[role];log(`${role}: login expired, ${again}`);}
      else log(`${role}: Epic unreachable (${e.message}), login kept for the next run`);
      process.exitCode=1;
    }
  }
  await saveLogins(state);return tokens;
}
export function steamState(xml){
  const privacy=/<privacyState>([^<]*)/.exec(xml)?.[1],online=/<onlineState>([^<]*)/.exec(xml)?.[1];
  return privacy!=='public'||!online?'unknown':online==='offline'?'offline':'online';
}
const quietHours=(now=new Date())=>{const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Berlin'}).format(now));return hour>=4&&hour<8;};
async function steamStatus(){try{const r=await fetch(`https://steamcommunity.com/profiles/${owner.id}/?xml=1`,{signal:AbortSignal.timeout(15000)});if(r.ok)return steamState(await r.text());}catch{}return 'unknown';}
// One short game session; asks for the history under each id (null = the login's own id) and merges the answers.
// The game may keep a Steam player's history under the Epic login or under the Steam id, so both are asked.
async function history(token,ids,label){
  const rpc=await psynet.connect(token),found=new Map(),notes=[];
  try{for(const id of ids){const name=id?'Steam id':'login id';
    try{const list=await psynet.matchHistory(rpc,id??rpc.player);notes.push(`${name} ${list.length}`);for(const e of list)if(e?.Match?.MatchGUID)found.set(String(e.Match.MatchGUID).toUpperCase(),e);}
    catch{notes.push(`${name} refused`);}}}
  finally{rpc.close();}
  log(`epic: ${label} history: ${notes.join(', ')}`);
  return [...found.values()];
}
// The scout's session never affects the player: it first tries to read his history directly, then asks whether he is online.
// The player's own login is used only when nothing suggests he is playing, or when a manual run explicitly allows it.
async function fetchHistory(tokens){
  const steamId=`Steam|${owner.id}|0`;let online=null;
  if(tokens.scout){
    let rpc;
    try{rpc=await psynet.connect(tokens.scout);
      let list=[];try{list=await psynet.matchHistory(rpc,steamId);}catch{}
      if(list.some(e=>fromHistory(e))){log(`epic: scout history: Steam id ${list.length}`);return list;}
      online=await psynet.anyOnline(rpc,[steamId]);
    }catch(e){online=e;}
    finally{rpc?.close();}
  }
  if(!tokens.player){log('epic: skipped, player login missing');return null;}
  if(process.env.ALLOW_ONLINE==='true')log('epic: online check skipped (manual run): if the player is in a match, Rocket League disconnects him');
  else{
    const steam=await steamStatus();
    const reason=steam==='online'?'player is online on Steam':!tokens.scout?'scout login missing':online instanceof Error?'presence check failed: '+online.message:online!==false?'player is online in Rocket League':null;
    if(reason){log('epic: skipped, '+reason);return null;}
  }
  return history(tokens.player,[null,steamId],'player');
}
// Match-history entry -> box-score row for the configured players (used when the replay cannot be analysed).
export function fromHistory(entry){
  const m=entry.Match,players=(m.Players??[]).map(p=>({base:PLAYERS.find(b=>b.id===/^Steam\|(\d{17})\|0$/i.exec(p.PlayerID??'')?.[1]),p})).filter(x=>x.base).map(({base,p})=>({id:base.id,name:base.name,team:p.LastTeam,tracked:null,speedIntegral:null,supersonic:null,air:null,boostStolen:null,boostCollected:null,boostUsed:null,bigStolen:null,smallStolen:null,goals:p.Goals,assists:p.Assists,saves:p.Saves,shots:p.Shots,demos:p.Demolishes,...(p.Skills?.bValid&&Number.isFinite(p.Skills.Mu)?{rank:{tier:p.Skills.Tier,division:p.Skills.Division,mmr:Math.round(p.Skills.Mu*20+100)}}:{})}));
  if(!players.length||!players.every(p=>[0,1].includes(p.team)))return null;
  return {schema:1,id:String(m.MatchGUID).toUpperCase(),title:'Match',date:new Date(m.RecordStartTimestamp*1000).toISOString().slice(0,10),dateTimezone:'day',mode:modeId(m.Playlist),playlist:String(m.Playlist),duration:Number(m.SecondsPlayed)||0,score:[m.Team0Score,m.Team1Score],...([0,1].includes(m.WinningTeam)?{winnerTeam:m.WinningTeam}:{}),players,bumps:[],bumpAvailable:false,source:'epic',sourceUrl:null,parser:'match-history'};
}
async function analyse(rows,entries){
  const have=new Map(rows.map(r=>[r.id.toUpperCase(),r])),fresh=[];let analysed=0,relevant=0;
  for(const [seq,entry] of [...entries].sort((a,b)=>a.Match.RecordStartTimestamp-b.Match.RecordStartTimestamp).entries()){
    const base=fromHistory(entry);if(!base)continue;relevant++;
    if(have.get(base.id)?.rule===2)continue;
    let row={...base,seq};
    try{
      const response=await fetch(entry.ReplayUrl,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('replay link answered HTTP '+response.status);
      const bytes=new Uint8Array(await response.arrayBuffer()),full=bytes.length>1000?await summarise(bytes,'Match',base.id):null;
      if(full){row={...full,id:base.id,title:'Match',date:base.date,dateTimezone:'day',source:'epic',seq,...(base.winnerTeam!==undefined?{winnerTeam:base.winnerTeam}:{}),players:full.players.map(p=>({...p,name:base.players.find(b=>b.id===p.id)?.name??p.name,...(base.players.find(b=>b.id===p.id)?.rank?{rank:base.players.find(b=>b.id===p.id).rank}:{})}))};delete row.hash;delete row.importedAt;analysed++;}
    }catch{}
    fresh.push(validateSummary(row));
  }
  log(`epic: ${entries.length} matches in history, ${relevant} with a configured player, ${fresh.length} new, ${analysed} analysed from replays`);
  return mergeReplays(rows,fresh);
}
async function run(){
  await fs.mkdir(dir,{recursive:true});
  // Without LOGIN_KEY the store is still published (existing data + relay records); only match history is off.
  const tokens=process.env.LOGIN_KEY?await renew(await read(files.logins,{}),await loginKey()):{};
  if(!process.env.LOGIN_KEY)log('logins: LOGIN_KEY is not set, match history is off (README: daily job setup)');
  let rows=(await read(files.matches,null)??await read(path.join(root,'data/seed.json'),[])).map(validateSummary);
  const keys=Object.keys(await read(path.join(root,'data/keys.json'),{}));
  try{const got=await relayRows(keys,Math.floor(Date.now()/1000)-14*86400);rows=mergeReplays(rows,got);log(`relays: ${got.length} signed records from ${keys.length} approved keys`);}catch(e){log('relays: failed, '+e.message);}
  if(!tokens.player&&!tokens.scout)log('epic: skipped, no logins stored');
  else if(process.env.FORCE!=='true'&&!quietHours())log('epic: skipped, outside 04:00-08:00 Berlin time (logins kept alive only)');
  else try{const entries=await fetchHistory(tokens);if(entries)rows=await analyse(rows,entries);}catch(e){log('epic: failed, '+e.message);process.exitCode=1;}
  await fs.writeFile(files.matches,'[\n'+rows.map(r=>JSON.stringify(publicRow(r))).join(',\n')+'\n]\n');
  log(`store: ${rows.length} matches`);
}
// Device login. The game is never contacted here, so approving while playing is safe.
async function login(role){
  if(!['player','scout'].includes(role))throw Error('Use: login player | login scout');
  await fs.mkdir(dir,{recursive:true});
  const key=await loginKey(),state=await read(files.logins,{}),device=await psynet.deviceStart();mask(device.device_code);
  log(`Open ${device.verification_uri_complete??device.verification_uri} and confirm code ${device.user_code} within ${Math.max(1,Math.round(device.expires_in/60))} minutes.`);
  for(let waited=0;waited<device.expires_in;waited+=device.interval){
    await sleep(device.interval*1000);
    const token=await psynet.deviceToken(device);if(!token)continue;
    mask(token.access_token);mask(token.refresh_token);
    state[role]=await lock({refresh_token:token.refresh_token},key);await saveLogins(state);
    log(`${role} login stored (encrypted). Epic keeps it about ${Math.round((token.refresh_expires_in??0)/3600)} hours; the job renews it every 2 hours.`);return;
  }
  throw Error('The login was not confirmed in time.');
}
if(process.argv[1]===fileURLToPath(import.meta.url))(process.argv[2]==='login'||process.env.LOGIN?login(process.argv[3]??process.env.LOGIN):run()).catch(e=>{console.error('collector: '+e.message);process.exit(1);});
