export const TARGETS=Object.freeze({'76561198058377116':'Kate','76561198060138310':'P L 4 Y E R'});
export const DETAIL_KEYS=['tracked','speedIntegral','supersonic','air','boostStolen','boostCollected','boostUsed','bigStolen','smallStolen'];
export const SCORE_KEYS=['goals','assists','saves','shots','demos'];
export const PARSER='rocket-league-stats-api/1';
const validGuid=id=>typeof id==='string'&&/^([a-f\d]{32}|[a-f\d]{64}|[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(id);
const number=(value,max=1000000)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max;
const counter=value=>number(value)&&Number.isInteger(value)?value:null;
const mode=playlist=>({1:'duels',10:'duels',2:'doubles',11:'doubles',3:'standard',13:'standard',27:'hoops',28:'rumble',29:'dropshot',30:'snowday'}[playlist]??'other');

// Both freshly captured and queued records pass through this projection. No raw
// socket message, other player's identity, loadout, account token or arbitrary
// object property is included in the outbound request.
export function projectSummary(input){
  if(input?.schema!==1||input.source!=='live'||!validGuid(input.id)||![0,1].includes(input.winnerTeam))throw Error('Invalid live match summary.');
  if(!Array.isArray(input.score)||input.score.length!==2||!input.score.every(x=>number(x,1000)))throw Error('Invalid live match score.');
  if(!Array.isArray(input.players)||input.players.length<1||input.players.length>2)throw Error('Invalid live target players.');
  const players=input.players.map(p=>{
    if(!Object.hasOwn(TARGETS,p.id)||![0,1].includes(p.team))throw Error('Unexpected live player identity.');
    return {id:p.id,name:TARGETS[p.id],team:p.team,...Object.fromEntries(DETAIL_KEYS.map(k=>[k,null])),...Object.fromEntries(SCORE_KEYS.map(k=>[k,counter(p[k])]))};
  });
  if(new Set(players.map(p=>p.id)).size!==players.length)throw Error('Duplicate live player.');
  if(typeof input.date!=='string'||!Number.isFinite(Date.parse(input.date)))throw Error('Invalid live capture date.');
  const playlist=Number(input.playlist);
  if(!Number.isInteger(playlist)||playlist<1||playlist>1000)throw Error('Invalid live playlist.');
  return {schema:1,id:input.id.toUpperCase(),title:'Live Rocket League match',date:new Date(input.date).toISOString(),dateTimezone:'UTC',mode:mode(playlist),playlist:String(playlist),duration:null,score:input.score.slice(),winnerTeam:input.winnerTeam,players,bumps:[],bumpAvailable:false,source:'live',sourceUrl:null,parser:PARSER,importedAt:new Date().toISOString(),capture:{rosterComplete:input.capture?.rosterComplete===true,startedMidMatch:input.capture?.rosterComplete!==true,finalSnapshot:input.capture?.finalSnapshot===true}};
}

export function validateAliases(aliases={}){
  if(!aliases||typeof aliases!=='object'||Array.isArray(aliases))throw Error('aliases must be an object of public platform IDs to target Steam IDs.');
  for(const [key,value]of Object.entries(aliases))if(!/^Epic\|[a-f\d]{32}\|0$/i.test(key)||!Object.hasOwn(TARGETS,value))throw Error('An alias must map Epic|PUBLIC-ID|0 to Kate or PLAYER\'s configured Steam ID.');
  return new Map(Object.entries(aliases).map(([key,value])=>[key.toLowerCase(),value]));
}

export class MatchCollector{
  constructor({onSummary,onNotice=()=>{},aliases={},settleMs=2500,now=()=>Date.now()}={}){
    this.onSummary=onSummary;this.onNotice=onNotice;this.aliases=validateAliases(aliases);this.settleMs=settleMs;this.now=now;this.matches=new Map();this.finished=new Set();this.replays=new Set();
  }
  identity(value){
    if(typeof value!=='string')return null;
    const steam=/^Steam\|(\d{17})\|0$/i.exec(value)?.[1];
    return steam&&Object.hasOwn(TARGETS,steam)?steam:this.aliases.get(value.toLowerCase())??null;
  }
  accept(message){
    if(!message||typeof message!=='object'||!message.Data||typeof message.Data!=='object')return;
    const {Event:event,Data:data}=message;
    if(!['UpdateState','MatchCreated','MatchInitialized','MatchEnded','MatchDestroyed','ReplayCreated'].includes(event)||!validGuid(data.MatchGuid))return;
    const id=data.MatchGuid.toUpperCase();
    if(event==='ReplayCreated'){
      this.replays.add(id);this.discard(id);return;
    }
    if(this.replays.has(id)||this.finished.has(id))return;
    if(event==='MatchCreated'||event==='MatchInitialized'){
      const m=this.ensure(id);if(event==='MatchInitialized')m.initialized=true;return;
    }
    const existing=this.matches.get(id);
    if(event==='MatchDestroyed'){
      if(existing?.winner!==null&&existing?.winner!==undefined)this.finish(id);else this.discard(id);
      return;
    }
    if(event==='MatchEnded'){
      if(existing&&[0,1].includes(data.WinnerTeamNum)){existing.winner=data.WinnerTeamNum;this.schedule(existing);}return;
    }
    const game=data.Game;
    if(!game||!Array.isArray(data.Players)||!Array.isArray(game.Teams)||game.bReplay!==false&&!(game.bReplay===true&&existing?.live))return;
    const playlist=game.PlaylistId;
    if(!Number.isInteger(playlist)||playlist<1||playlist>1000)return;
    const score=[0,1].map(team=>game.Teams.find(t=>t.TeamNum===team)?.Score);
    if(!score.every(x=>number(x,1000)))return;
    const m=this.ensure(id);m.live=true;m.score=score;m.playlist=playlist;
    if(m.winner!==null)m.finalSnapshot=true;
    for(const entry of data.Players){
      const target=this.identity(entry.PrimaryId);if(!target||![0,1].includes(entry.TeamNum))continue;
      const previous=m.players.get(target);
      if(previous&&previous.team!==entry.TeamNum){m.invalid=true;continue;}
      const stats=Object.fromEntries(SCORE_KEYS.map(key=>{
        const value=counter(entry[{goals:'Goals',assists:'Assists',saves:'Saves',shots:'Shots',demos:'Demos'}[key]]);
        return [key,value===null?previous?.[key]??null:Math.max(previous?.[key]??0,value)];
      }));
      m.players.set(target,{id:target,team:entry.TeamNum,...stats});
    }
    if(game.bHasWinner===true){
      const winner=game.Teams.find(t=>typeof t.Name==='string'&&t.Name===game.Winner)?.TeamNum;
      if([0,1].includes(winner)){m.winner=winner;m.finalSnapshot=true;this.schedule(m);}
    }
  }
  ensure(id){
    if(!this.matches.has(id)){
      if(this.matches.size>=12)this.discard(this.matches.keys().next().value);
      this.matches.set(id,{id,date:new Date(this.now()).toISOString(),players:new Map(),initialized:false,live:false,winner:null,score:null,playlist:null,timer:null});
    }
    return this.matches.get(id);
  }
  schedule(match){if(!match.timer)match.timer=setTimeout(()=>this.finish(match.id),this.settleMs);}
  finish(id){
    const m=this.matches.get(id);if(!m)return;
    this.discard(id);this.finished.add(id);if(this.finished.size>10000)this.finished.delete(this.finished.values().next().value);
    if(!m.live||m.invalid||m.winner===null||!m.score||!m.players.size){this.onNotice('Skipped a match without a complete result and configured target identities.');return;}
    this.onSummary(projectSummary({schema:1,source:'live',id,date:m.date,playlist:m.playlist,score:m.score,winnerTeam:m.winner,players:[...m.players.values()],capture:{rosterComplete:m.initialized,finalSnapshot:m.finalSnapshot===true}}));
  }
  discard(id){const m=this.matches.get(id);if(m?.timer)clearTimeout(m.timer);this.matches.delete(id);}
  disconnect(){for(const [id,m] of this.matches){if(m.winner!==null)this.finish(id);else this.discard(id);}this.replays.clear();}
  close(){this.disconnect();}
}
