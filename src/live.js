// Rocket League local Stats API (ws://127.0.0.1:49124) -> finished-match summaries for the two players.
// Read-only: nothing is ever sent to the game. The API only streams the match in progress; it has no history.
import {PLAYERS} from './analysis.js';
export const SOCKET_URL='ws://127.0.0.1:49124';
export const TARGETS=Object.freeze(Object.fromEntries(PLAYERS.map(p=>[p.id,p.name])));
export const TELEMETRY=['tracked','speedIntegral','supersonic','air','boostCollected','boostUsed'];
const UNKNOWN=['boostStolen','bigStolen','smallStolen'],SCORE={goals:'Goals',assists:'Assists',saves:'Saves',shots:'Shots',demos:'Demos'};
const validGuid=id=>typeof id==='string'&&/^([a-f\d]{32}|[a-f\d]{64}|[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(id);
const number=(value,max=1e6)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max;
const counter=value=>number(value)&&Number.isInteger(value)?value:null;
const mode=playlist=>({1:'duels',10:'duels',2:'doubles',11:'doubles',3:'standard',13:'standard',17:'hoops',27:'hoops',18:'rumble',28:'rumble',23:'dropshot',29:'dropshot',15:'snowday',30:'snowday'}[playlist]??'other');
export const SPEED_FACTORS={uu:1,kmh:1/.036,mph:1/.022369362920544,mps:100};
export function liveSpeedUnit(peak,supersonicPeak,setting='auto'){
  if(setting!=='auto')return Object.hasOwn(SPEED_FACTORS,setting)?setting:null;
  if(peak>150||peak===0)return 'uu';
  // Supersonic speed is near 2,200–2,300 uu/s. Use that independent flag, never the average alone.
  if(supersonicPeak>=75&&supersonicPeak<=84)return 'kmh';
  if(supersonicPeak>=48&&supersonicPeak<=52)return 'mph';
  if(supersonicPeak>=21.5&&supersonicPeak<=23.5)return 'mps';
  return null;
}

// Every outgoing record passes through this projection: no raw packet, other player, loadout or stray property survives.
export function projectSummary(input){
  if(input?.schema!==1||input.source!=='live'||!validGuid(input.id)||![0,1].includes(input.winnerTeam))throw Error('Invalid live match summary.');
  if(!Array.isArray(input.score)||input.score.length!==2||!input.score.every(x=>number(x,1000)))throw Error('Invalid live match score.');
  if(!Array.isArray(input.players)||input.players.length<1||input.players.length>2)throw Error('Invalid live target players.');
  const players=input.players.map(p=>{
    if(!Object.hasOwn(TARGETS,p.id)||![0,1].includes(p.team))throw Error('Unexpected live player identity.');
    return {id:p.id,name:TARGETS[p.id],team:p.team,...Object.fromEntries(UNKNOWN.map(k=>[k,null])),...Object.fromEntries(TELEMETRY.map(k=>[k,number(p[k])?p[k]:null])),...Object.fromEntries(Object.keys(SCORE).map(k=>[k,counter(p[k])])),...(Object.hasOwn(SPEED_FACTORS,p.speedSourceUnit)?{speedSourceUnit:p.speedSourceUnit}:{}),...(p.speedUnconfirmed?{speedUnconfirmed:true}:{})};
  });
  if(new Set(players.map(p=>p.id)).size!==players.length)throw Error('Duplicate live player.');
  if(!/^\d{4}-\d\d-\d\d$/.test(input.date??''))throw Error('Invalid live capture day.');
  const playlist=input.playlist==null?null:Number(input.playlist);
  if(playlist!==null&&(!Number.isInteger(playlist)||playlist<1||playlist>1000))throw Error('Invalid live playlist.');
  const complete=input.capture?.rosterComplete===true;
  return {schema:1,id:input.id.toUpperCase(),title:'Live match',date:input.date,dateTimezone:'day',mode:mode(playlist),playlist:playlist===null?null:String(playlist),duration:null,score:input.score.slice(),winnerTeam:input.winnerTeam,players,bumps:[],bumpAvailable:false,source:'live',sourceUrl:null,parser:'rocket-league-stats-api/3',capture:{rosterComplete:complete,startedMidMatch:!complete,finalSnapshot:input.capture?.finalSnapshot===true}};
}
export function validateAliases(aliases={}){
  if(!aliases||typeof aliases!=='object'||Array.isArray(aliases))throw Error('aliases must map public platform IDs to a target Steam ID.');
  for(const [key,value] of Object.entries(aliases))if(!/^Epic\|[a-f\d]{32}\|0$/i.test(key)||!Object.hasOwn(TARGETS,value))throw Error('An alias must map Epic|PUBLIC-ID|0 to a configured Steam ID.');
  return new Map(Object.entries(aliases).map(([key,value])=>[key.toLowerCase(),value]));
}
export class MatchCollector{
  constructor({onSummary,onNotice=()=>{},onDebug=()=>{},aliases={},speedUnit='auto',settleMs=2500,now=()=>Date.now()}={}){
    if(speedUnit!=='auto'&&!Object.hasOwn(SPEED_FACTORS,speedUnit))throw Error('Invalid speed unit');
    Object.assign(this,{onSummary,onNotice,onDebug,speedUnit,settleMs,now,aliases:validateAliases(aliases),matches:new Map(),finished:new Set(),replays:new Set(),unnamed:false,reasons:new Set()});
  }
  // Reports each reason for ignoring messages once per connection, for debugging.
  drop(reason,detail){if(this.reasons.has(reason))return;this.reasons.add(reason);this.onDebug(reason,detail);}
  identity(value){
    if(typeof value!=='string')return null;
    const steam=/^Steam\|(\d{17})\|0$/i.exec(value)?.[1];
    return steam&&Object.hasOwn(TARGETS,steam)?steam:this.aliases.get(value.toLowerCase())??null;
  }
  accept(message){
    if(!message||typeof message!=='object')return this.drop('message is not an object');
    // Current game builds send Data as a JSON-encoded string inside the envelope.
    let data=message.Data;
    if(typeof data==='string')try{data=JSON.parse(data);}catch{return this.drop('Data is not valid JSON',data.slice(0,120));}
    if(!data||typeof data!=='object')return this.drop('message without Data');
    const event=message.Event;
    if(!['UpdateState','MatchCreated','MatchInitialized','MatchEnded','MatchDestroyed','ReplayCreated','CountdownBegin'].includes(event))return this.drop(`event not used: ${event}`);
    // The game sets MatchGuid only for online and LAN matches.
    if(!validGuid(data.MatchGuid)){
      this.drop(`no match id on ${event} (private or offline match)`);
      if(event==='MatchDestroyed')this.unnamed=false;
      else if(event==='UpdateState'&&data.Game?.bReplay===false&&!this.unnamed){this.unnamed=true;this.onNotice('Private or offline match: Rocket League sends no match ID here, so it is not recorded. Online matches are.');}
      return;
    }
    this.unnamed=false;
    const id=data.MatchGuid.toUpperCase();
    if(event==='ReplayCreated'){this.replays.add(id);this.discard(id);return;}
    if(this.replays.has(id)||this.finished.has(id))return;
    if(event==='MatchCreated'||event==='MatchInitialized'){const m=this.ensure(id);if(event==='MatchInitialized')m.initialized=true;return;}
    const existing=this.matches.get(id);
    if(event==='CountdownBegin'){if(existing)for(const t of existing.telemetry.values())t.boost=null;return;}
    if(event==='MatchDestroyed'){existing?.winner!=null?this.finish(id):this.discard(id);return;}
    if(event==='MatchEnded'){if(existing&&[0,1].includes(data.WinnerTeamNum)){existing.winner=data.WinnerTeamNum;this.schedule(existing);}return;}
    const game=data.Game;
    if(!game||!Array.isArray(data.Players)||!Array.isArray(game.Teams))return this.drop('UpdateState without Game, Players or Teams',Object.keys(data));
    if(game.bReplay!==false&&!(game.bReplay===true&&existing?.live))return this.drop(`replay or unknown playback state (bReplay=${game.bReplay})`);
    const playlist=Number.isInteger(game.PlaylistId)&&game.PlaylistId>=1&&game.PlaylistId<=1000?game.PlaylistId:null;
    const score=[0,1].map(team=>game.Teams.find(t=>t.TeamNum===team)?.Score);
    if(!score.every(x=>number(x,1000)))return this.drop('team scores missing',game.Teams.map(t=>t.TeamNum));
    const m=this.ensure(id),now=this.now()/1000,dt=Math.min(Math.max(now-(m.tick??now),0),.5),playing=game.bReplay===false&&game.bHasWinner!==true&&m.winner===null;
    Object.assign(m,{live:true,score,playlist:playlist??m.playlist,tick:now});
    if(m.winner!==null)m.finalSnapshot=true;
    for(const entry of data.Players){
      const target=this.identity(entry.PrimaryId);if(!target||![0,1].includes(entry.TeamNum))continue;
      const previous=m.players.get(target);
      if(previous&&previous.team!==entry.TeamNum){m.invalid=true;continue;}
      const stats=Object.fromEntries(Object.entries(SCORE).map(([key,field])=>{const value=counter(entry[field]);return [key,value===null?previous?.[key]??null:Math.max(previous?.[key]??0,value)];}));
      m.players.set(target,{id:target,team:entry.TeamNum,...stats});
      // Speed and boost are only sent for the viewer's own team; absent fields stay unknown.
      if(playing&&number(entry.Speed,1e5)){
        const t=m.telemetry.get(target)??{tracked:0,speedIntegral:0,supersonic:0,air:0,boostCollected:0,boostUsed:0,boost:null,peak:0,supersonicPeak:0};m.telemetry.set(target,t);
        t.peak=Math.max(t.peak,entry.Speed);if(entry.bSupersonic===true)t.supersonicPeak=Math.max(t.supersonicPeak,entry.Speed);
        t.tracked+=dt;t.speedIntegral+=entry.Speed*dt;if(entry.bSupersonic===true)t.supersonic+=dt;if(entry.bOnGround===false&&entry.bOnWall!==true)t.air+=dt;
        if(entry.bDemolished===true||!number(entry.Boost,100))t.boost=null;
        else{if(t.boost!==null){const change=entry.Boost-t.boost;if(change>=3)t.boostCollected+=change;else if(change<0)t.boostUsed-=change;}t.boost=entry.Boost;}
      }
    }
    if(!m.players.size)this.drop('no configured player in this match',data.Players.map(p=>String(p.PrimaryId??'').split('|')[0]));
    if(game.bHasWinner===true){
      const winner=game.Teams.find(t=>typeof t.Name==='string'&&t.Name===game.Winner)?.TeamNum;
      if([0,1].includes(winner)){m.winner=winner;m.finalSnapshot=true;this.schedule(m);}
    }
  }
  ensure(id){
    if(!this.matches.has(id)){
      if(this.matches.size>=12)this.discard(this.matches.keys().next().value);
      this.matches.set(id,{id,date:new Date(this.now()).toISOString().slice(0,10),players:new Map(),telemetry:new Map(),initialized:false,live:false,winner:null,score:null,playlist:null,timer:null});
    }
    return this.matches.get(id);
  }
  schedule(match){if(!match.timer)match.timer=setTimeout(()=>this.finish(match.id),this.settleMs);}
  finish(id){
    const m=this.matches.get(id);if(!m)return;
    this.discard(id);this.finished.add(id);if(this.finished.size>10000)this.finished.delete(this.finished.values().next().value);
    if(!m.live||m.invalid||m.winner===null||!m.score||!m.players.size){this.onDebug('match skipped',{live:m.live,invalid:!!m.invalid,winner:m.winner,score:m.score,players:m.players.size});this.onNotice('Skipped a match without a confirmed result for a configured player.');return;}
    const players=[...m.players.values()].map(p=>{const t=m.telemetry.get(p.id);if(!t||t.tracked<=20)return p;const unit=liveSpeedUnit(t.peak,t.supersonicPeak,this.speedUnit);this.onDebug('speed calibration',{rawAverage:t.speedIntegral/t.tracked,rawPeak:t.peak,supersonicPeak:t.supersonicPeak,sourceUnit:unit,outputUnit:'uu/s'});if(!unit)this.onNotice('Live speed unit could not be confirmed. Speed stays unknown; select the source unit in Data & settings or import a replay.');return {...p,...t,speedIntegral:unit?t.speedIntegral*SPEED_FACTORS[unit]:null,supersonic:unit?t.supersonic:null,air:unit?t.air:null,speedSourceUnit:unit,speedUnconfirmed:!unit};});
    this.onSummary(projectSummary({schema:1,source:'live',id,date:m.date,playlist:m.playlist,score:m.score,winnerTeam:m.winner,players,capture:{rosterComplete:m.initialized,finalSnapshot:m.finalSnapshot===true}}));
  }
  discard(id){const m=this.matches.get(id);if(m?.timer)clearTimeout(m.timer);this.matches.delete(id);}
  disconnect(){for(const [id,m] of this.matches)m.winner!==null?this.finish(id):this.discard(id);this.replays.clear();}
  close(){this.disconnect();}
}
