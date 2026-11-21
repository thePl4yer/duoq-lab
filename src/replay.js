// Replay bytes -> compact match summary. Used as the browser worker and by the Node collector.
import {fromTimeline,PLAYERS,remoteId} from './analysis.js';
import {analyseBoost} from './boost.js';
let parser;
export async function loadParser(){
  if(parser)return parser;
  if(typeof process!=='undefined'&&process.versions?.node){
    const fs=await import('node:fs'),{fileURLToPath}=await import('node:url'),entry=fileURLToPath(import.meta.resolve('@rlrml/subtr-actor'));
    const m=await import('@rlrml/subtr-actor');await m.default({module_or_path:fs.readFileSync(entry.replace(/\.js$/,'_bg.wasm'))});parser=m;
  }else{const m=await import('../vendor/rl_replay_subtr_actor.js');await m.default();parser=m;}
  return parser;
}
// Per-player habits counted from parser events; only the given ids are kept.
function habits(events,ids){
  const out=Object.fromEntries(ids.map(id=>[id,{touches:0,whiffs:0,passes:0,fifties:0,fiftyWon:0,kickoffs:0,beaten:0,firstMan:0}])),of=v=>out[remoteId(v)],seen=new Set();
  for(const event of events){
    if(event.meta?.id){if(seen.has(event.meta.id))continue;seen.add(event.meta.id);}
    const {kind,payload:e}=event.payload??{};if(!e)continue;
    if(kind==='touch'&&of(e.player))of(e.player).touches++;
    if(kind==='whiff'&&of(e.player))of(e.player).whiffs++;
    if(kind==='pass'&&of(e.passer)&&of(e.receiver))of(e.passer).passes++;
    if(kind==='beaten_to_ball'&&of(e.player))of(e.player).beaten++;
    if(kind==='kickoff'&&of(e.first_touch_player))of(e.first_touch_player).kickoffs++;
    if(kind==='rotation_role'&&e.state==='first_man'&&of(e.player))of(e.player).firstMan+=Number(e.duration)||0;
    if(kind==='fifty_fifty')for(const [zero,key] of [[true,'team_zero_player'],[false,'team_one_player']]){const p=of(e[key]);if(!p)continue;p.fifties++;if(e.winning_team_is_team_0===zero)p.fiftyWon++;}
  }
  return out;
}
// Dropshot floor damage per player, read from the raw network stream (the stats timeline does not carry it).
function dropshotDamage(raw){
  const names=raw.objects??[],owner=new Map(),damage=new Map();
  for(const frame of raw.network_frames?.frames??[])for(const update of frame.updated_actors??[]){
    const name=names[update.object_id],a=update.attribute;
    if(name==='Engine.PlayerReplicationInfo:UniqueId'){const id=a?.UniqueId?.remote_id??a?.Reservation?.unique_id?.remote_id;if(id)owner.set(update.actor_id,remoteId(id));}
    else if(name==='TAGame.PRI_TA:MatchBreakoutDamage'&&Number.isFinite(a?.Int)){const id=owner.get(update.actor_id);if(id)damage.set(id,Math.max(damage.get(id)??0,a.Int));}
  }
  return damage;
}
export async function summarise(bytes,name,hash,{ids=PLAYERS.map(p=>p.id),progress=()=>{}}={}){
  const api=await loadParser(),meta=api.get_replay_meta(bytes).replay_meta;
  if(![...(meta.team_zero??[]),...(meta.team_one??[])].some(p=>ids.includes(remoteId(p.remote_id))))return null;
  progress('Analysing movement, boost and bumps …');
  const timeline=JSON.parse(new TextDecoder().decode(api.get_stats_timeline_json(bytes,false))),summary=fromTimeline(timeline,name,hash);
  summary.players=summary.players.filter(p=>ids.includes(p.id));
  summary.bumps=summary.bumps.filter(e=>ids.includes(e.from)&&ids.includes(e.to));
  const habit=habits(timeline.events.events,ids);
  for(const p of summary.players)Object.assign(p,habit[p.id]);
  progress('Checking who actually lost boost …');
  let frames=null,boost={status:'unavailable',players:{}};
  try{frames=api.get_replay_frames_data(bytes);boost=analyseBoost(frames,ids);}catch{boost.reason='frame_analysis_failed';}
  const usable=['complete','partial'].includes(boost.status);
  for(const p of summary.players){const b=boost.players[p.id];Object.assign(p,usable&&b?{boostStolen:b.stolen,bigStolen:b.big,smallStolen:b.small,taxed:b.taxed,taxCount:b.taxCount}:{boostStolen:null,bigStolen:null,smallStolen:null,taxed:null,taxCount:null});}
  summary.rule=2;summary.boost={status:boost.status,reason:boost.reason??null,tax:usable?Object.fromEntries(Object.entries(boost.players).map(([id,b])=>[id,b.taxEvents])):{}};
  const first=frames?.goal_events?.[0];summary.firstGoal=first?(first.scoring_team_is_team_0?0:1):null;
  if(summary.mode==='dropshot'){try{const damage=dropshotDamage(api.parse_replay(bytes));for(const p of summary.players)p.dropshot=damage.get(p.id)??0;}catch{for(const p of summary.players)p.dropshot=null;}}
  return summary;
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope)self.onmessage=async({data})=>{
  try{const result=await summarise(new Uint8Array(data.bytes),data.name,data.hash,{progress:message=>self.postMessage({type:'progress',message})});self.postMessage(result?{type:'result',result}:{type:'skip'});}
  catch(error){self.postMessage({type:'error',message:String(error?.message??error).slice(0,500)});}
};
