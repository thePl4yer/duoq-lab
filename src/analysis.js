export const PLAYERS = [
  { id:'76561198058377116', name:'Kate', short:'K', color:'#c3b6db', steam:'https://steamcommunity.com/profiles/76561198058377116/' },
  { id:'76561198060138310', name:'P L 4 Y E R', short:'P', color:'#e4bf69', steam:'https://steamcommunity.com/id/JustAHonestGuy/' }
];
export const MODES = [{id:'standard',name:'Standard',sub:'3v3',playlist:13},{id:'doubles',name:'2v2',sub:'Ranked Doubles',playlist:11},{id:'hoops',name:'Hoops',sub:'2v2',playlist:27},{id:'dropshot',name:'Dropshot',sub:'3v3',playlist:29},{id:'snowday',name:'Snow Day',sub:'3v3',playlist:30},{id:'rumble',name:'Rumble',sub:'3v3',playlist:28}];
export function remoteId(value) {
  if (typeof value==='string') return value;
  if (!value || typeof value!=='object') return '';
  if(value.Steam!==undefined) return String(value.Steam);
  if(value.platform==='steam' && value.id!==undefined) return String(value.id);
  return Object.entries(value).map(([k,v])=>`${k}:${String(v)}`).join('|');
}
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const stat = () => ({tracked:0,speedIntegral:0,supersonic:0,air:0,boostStolen:0,boostCollected:0,boostUsed:null,goals:0,assists:0,saves:0,shots:0,demos:0,bigStolen:0,smallStolen:0});
export function modeId(value) {
  const s=String(value??'').toLowerCase();
  if(s.includes('hoop')||s==='27')return 'hoops';
  if(s.includes('dropshot')||s==='29')return 'dropshot';
  if(s.includes('snow')||s==='30')return 'snowday';
  if(s.includes('rumble')||s==='28')return 'rumble';
  if(s.includes('standard')||s==='13'||s==='3')return 'standard';
  if(s.includes('double')||s==='11'||s==='2')return 'doubles';
  if(s.includes('duel')||s==='10'||s==='1')return 'duels';
  return 'other';
}
export function fromTimeline(t, filename, hash) {
  if(!t?.replay_meta || !Array.isArray(t.frames)||!t.events?.events)throw Error('Incomplete parser output.');
  const h=Object.fromEntries(t.replay_meta.all_headers??[]);
  const all=[...(t.replay_meta.team_zero??[]).map(p=>({...p,team:0})),...(t.replay_meta.team_one??[]).map(p=>({...p,team:1}))];
  const players=all.map(p=>({id:remoteId(p.remote_id),name:p.name,team:p.team,...stat()}));
  const byId=new Map(players.map(p=>[p.id,p]));
  const bumps=[];
  const seen=new Set();
  for(const event of t.events.events){
    if(event.meta?.id && seen.has(event.meta.id))continue;
    if(event.meta?.id)seen.add(event.meta.id);
    const {kind,payload:e}=event.payload??{};
    if(!e)continue;
    const p=byId.get(remoteId(e.player_id??e.player??e.initiator??e.attacker));
    if(kind==='movement'&&p&&e.dt>0){
      p.tracked+=e.dt;p.speedIntegral+=e.speed*e.dt;
      if(e.speed_band==='supersonic')p.supersonic+=e.dt;
      if(e.height_band!=='ground')p.air+=e.dt;
    }
    if(kind==='boost_pickup'&&p&&e.activity!=='inactive'){
      const amount=n(e.collected_amount)*100/255;
      p.boostCollected+=amount;
      if(e.is_steal){p.boostStolen+=amount;if(e.pad_type==='big')p.bigStolen++;if(e.pad_type==='small')p.smallStolen++;}
    }
    if(kind==='demolition'&&p)p.demos++;
    if(kind==='bump')bumps.push({from:remoteId(e.initiator),to:remoteId(e.victim),time:n(e.time),confidence:n(e.confidence),team:!!e.is_team_bump});
  }
  for(const p of players){
    const info=all.find(a=>remoteId(a.remote_id)===p.id);
    for(const key of ['Goals','Assists','Saves','Shots'])p[key.toLowerCase()]=n(info?.stats?.[key]);
    const used=(t.accumulation_tracks??[]).find(a=>a.quantity==='boost_used'&&remoteId(a.player_id)===p.id);
    if(used?.points.length)p.boostUsed=n(used.points.at(-1).value)*100/255;
  }
  const date=typeof h.Date==='string'?h.Date.replace(/(\d{2})-(\d{2})-(\d{2})$/,'$1:$2:$3'):null;
  const game=t.replay_meta.game_type??{};
  return {schema:1,id:String(h.MatchGUID||h.Id||hash),hash,title:filename,date,dateTimezone:'replay-local',mode:modeId(game.playlist_id??game.game_type),playlist:String(game.playlist_id??game.game_type??'Unknown'),duration:t.frames.filter(f=>f.is_live_play).reduce((a,f)=>a+n(f.dt),0),score:[n(h.Team0Score),n(h.Team1Score)],players,bumps,bumpAvailable:true,source:'local',sourceUrl:null,importedAt:new Date().toISOString(),parser:'subtr-actor 1.5.1'};
}
export function fromBallchasing(r) {
  if(!r?.blue?.players||!r?.orange?.players)throw Error('A Ballchasing detail response with blue.players and orange.players is required.');
  if(r.status&&r.status!=='ok')throw Error('This replay has not finished processing.');
  const players=[];
  for(const [team,side] of [r.blue,r.orange].entries())for(const p of side.players){
    const s=p.stats??{}, b=s.boost??{},m=s.movement??{},c=s.core??{};
    const time=n(p.time_in_game??r.duration);
    players.push({id:remoteId(p.id),name:p.name??'',team,...stat(),tracked:time,speedIntegral:n(m.avg_speed)*time,supersonic:n(m.time_supersonic_speed),air:n(m.time_low_air)+n(m.time_high_air),boostStolen:n(b.amount_stolen),boostCollected:n(b.amount_collected),boostUsed:b.amount_used===undefined?null:n(b.amount_used),goals:n(c.goals),assists:n(c.assists),saves:n(c.saves),shots:n(c.shots),demos:n(s.demo?.inflicted),bigStolen:n(b.count_stolen_big),smallStolen:n(b.count_stolen_small)});
  }
  return {schema:1,id:String(r.match_guid||r.id),ballchasingId:r.id,title:r.title||'Ballchasing Replay',date:r.date??null,mode:modeId(r.playlist_id??r.playlist_name),playlist:r.playlist_name??r.playlist_id,duration:n(r.duration),score:[n(r.blue.stats?.core?.goals??r.blue.goals),n(r.orange.stats?.core?.goals??r.orange.goals)],players,bumps:[],bumpAvailable:false,source:'ballchasing',sourceUrl:/^[\w-]+$/.test(r.id)?`https://ballchasing.com/replay/${r.id}`:null,importedAt:new Date().toISOString()};
}
export function mergeReplays(current,incoming){
  const map=new Map(current.map(r=>[r.id.toUpperCase(),r]));
  for(const r of incoming){
    const key=r.id.toUpperCase();
    const previous=map.get(key);
    if(!previous||r.bumpAvailable||!previous.bumpAvailable)map.set(key,{...r,sourceUrl:r.sourceUrl??previous?.sourceUrl??null,ballchasingId:r.ballchasingId??previous?.ballchasingId});
  }
  return [...map.values()].sort((a,b)=>String(b.date??'').localeCompare(String(a.date??'')));
}
export function pairInfo(r){
  const pair=PLAYERS.map(p=>r.players.find(x=>x.id===p.id));
  const both=pair.every(Boolean),together=both&&pair[0].team===pair[1].team;
  const team=pair[0]?.team;
  const scored=together&&r.score.every(Number.isFinite);
  const result=!scored?null:r.score[team]>r.score[1-team]?'win':r.score[team]<r.score[1-team]?'loss':'draw';
  return {pair,both,together,result};
}
export function aggregate(replays,scope='together'){
  const shared=replays.filter(r=>{const pair=pairInfo(r);return scope==='together'?pair.together:scope==='solo'?!pair.both&&pair.pair.some(Boolean):pair.pair.some(Boolean);});
  const players=PLAYERS.map(base=>{
    const matches=shared.filter(r=>r.players.some(p=>p.id===base.id));
    const rows=matches.map(r=>r.players.find(p=>p.id===base.id));
    const total=stat();for(const [index,p] of rows.entries())for(const k of Object.keys(total))if(p[k]!==null&&!(matches[index].boostWarning&&['boostStolen','boostCollected','boostUsed','bigStolen','smallStolen'].includes(k)))total[k]=(total[k]??0)+n(p[k]);
    const boostRows=rows.filter((p,i)=>!matches[i].boostWarning),boostTracked=boostRows.reduce((a,p)=>a+n(p.tracked),0);
    const result=r=>{const p=r.players.find(p=>p.id===base.id);return r.score[p.team]-r.score[1-p.team];};
    const wins=matches.filter(r=>result(r)>0).length,losses=matches.filter(r=>result(r)<0).length,draws=matches.filter(r=>result(r)===0).length;
    return {...base,...total,games:rows.length,wins,losses,draws,winRate:rows.length?100*wins/rows.length:null,boostGames:boostRows.length,avgSpeed:total.tracked?total.speedIntegral/total.tracked:null,superPct:total.tracked?100*total.supersonic/total.tracked:null,airPct:total.tracked?100*total.air/total.tracked:null,bpm:boostTracked?total.boostCollected*60/boostTracked:null};
  });
  const coverage=shared.filter(r=>r.bumpAvailable&&pairInfo(r).both);
  const pairBumps=PLAYERS.map((p,i)=>coverage.flatMap(r=>r.bumps).filter(e=>e.from===p.id&&e.to===PLAYERS[1-i].id).length);
  const wins=shared.filter(r=>pairInfo(r).result==='win').length;
  const results=shared.filter(r=>pairInfo(r).result!==null).length;
  return {shared,players,wins,winRate:results?100*wins/results:null,coverage:coverage.length,pairBumps:coverage.length?pairBumps:[null,null],duration:shared.reduce((a,r)=>a+r.duration,0)};
}
export function validateSummary(r){
  if(!r||r.schema!==1||typeof r.id!=='string'||r.id.length>180||!Array.isArray(r.players)||r.players.length>16||!Array.isArray(r.score)||r.score.length!==2)throw Error('Invalid dashboard backup.');
  if(!Array.isArray(r.bumps)||r.bumps.length>50000)throw Error('Invalid bump data.');
  for(const p of r.players){if(typeof p.id!=='string'||![0,1].includes(p.team))throw Error('Invalid player identity.');for(const key of Object.keys(stat()))if(p[key]!==null&&(!Number.isFinite(p[key])||p[key]<0))throw Error('Invalid statistic.');}
  if(r.date!==null && typeof r.date!=='string')throw Error('Invalid date.');
  if(r.sourceUrl && !/^https:\/\/ballchasing\.com\/replay\/[\w-]+$/.test(r.sourceUrl))r={...r,sourceUrl:null};
  return r;
}
export function trackerRanks(data,expectedId){
  const d=data.data??data;
  if(String(d.platformInfo?.platformUserId)!==expectedId)throw Error('The Tracker response does not match the selected Steam ID.');
  const result={};
  for(const s of d.segments??[]){
    if(s.type!=='playlist')continue;
    const mode=MODES.find(m=>m.playlist===Number(s.attributes?.playlistId));if(!mode)continue;
    const mmr=Number(s.stats?.rating?.value);if(!Number.isFinite(mmr)||mmr<0)continue;
    result[mode.id]={mmr,tier:s.stats?.tier?.metadata?.name??'Rang unbekannt',division:s.stats?.division?.metadata?.name??'',season:d.metadata?.currentSeason??null,source:'tracker-import',updatedAt:new Date().toISOString()};
  }
  if(!Object.keys(result).length)throw Error('This response contains no supported playlist ranks.');
  return result;
}
