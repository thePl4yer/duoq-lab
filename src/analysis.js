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
// Optional per-player numbers from the v0.2 replay analysis (absent in older rows).
export const EXTRA=['taxed','taxCount','touches','whiffs','passes','fifties','fiftyWon','kickoffs','beaten','firstMan','dropshot'];
const TIERS=['Unranked',...['Bronze','Silver','Gold','Platinum','Diamond','Champion','Grand Champion'].flatMap(n=>['I','II','III'].map(d=>n+' '+d)),'Supersonic Legend'];
export const tierName=tier=>TIERS[tier]??'Rank unknown';
// What leaves this browser or the collector: day precision only, no file names, hashes or import times.
export function publicRow(r){const {hash,importedAt,...rest}=r,day=typeof r.date==='string'&&/^\d{4}-\d\d-\d\d/.test(r.date)?r.date.slice(0,10):null;return {...rest,title:'Match',date:day,dateTimezone:'day'};}
const stat = () => ({tracked:0,speedIntegral:0,supersonic:0,air:0,boostStolen:0,boostCollected:0,boostUsed:null,goals:0,assists:0,saves:0,shots:0,demos:0,bigStolen:0,smallStolen:0});
export function modeId(value) {
  const s=String(value??'').toLowerCase();
  if(s.includes('hoop')||s==='27'||s==='17')return 'hoops';
  if(s.includes('dropshot')||s==='29'||s==='23')return 'dropshot';
  if(s.includes('snow')||s==='30'||s==='15')return 'snowday';
  if(s.includes('rumble')||s==='28'||s==='18')return 'rumble';
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
    if(previous?.source!=='live'&&r.source==='live'&&previous)continue;
    if(previous?.source==='live'&&r.source==='live'){
      if(previous.winnerTeam!==r.winnerTeam)continue;
      const incomingFinal=r.capture?.finalSnapshot===true,previousFinal=previous.capture?.finalSnapshot===true;
      if(incomingFinal===previousFinal&&JSON.stringify(previous.score)!==JSON.stringify(r.score))continue;
      const primary=incomingFinal&&!previousFinal?r:previous,secondary=primary===r?previous:r;
      const players=new Map(primary.players.map(p=>[p.id,p]));
      for(const p of secondary.players){const old=players.get(p.id);if(!old)players.set(p.id,p);else if(old.team===p.team)players.set(p.id,{...old,...Object.fromEntries(['goals','assists','saves','shots','demos'].map(k=>[k,p[k]===null?old[k]:old[k]===null?p[k]:Math.max(old[k],p[k])]))});}
      const complete=previous.capture?.rosterComplete===true||r.capture?.rosterComplete===true;
      map.set(key,{...primary,players:[...players.values()],capture:{rosterComplete:complete,startedMidMatch:!complete,finalSnapshot:previousFinal||incomingFinal}});continue;
    }
    if(previous?.rule===2&&r.rule!==2&&previous.bumpAvailable)continue;
    if(!previous||previous.source==='live'||r.bumpAvailable||!previous.bumpAvailable)map.set(key,{...r,...(r.winnerTeam===undefined&&previous?.winnerTeam!==undefined?{winnerTeam:previous.winnerTeam}:{}),players:r.players.map(p=>{const old=previous?.players.find(x=>x.id===p.id);return old?.rank&&!p.rank?{...p,rank:old.rank}:p;}),sourceUrl:r.sourceUrl??previous?.sourceUrl??null,ballchasingId:r.ballchasingId??previous?.ballchasingId});
  }
  return [...map.values()].sort((a,b)=>String(b.date??'').localeCompare(String(a.date??'')));
}
export function pairInfo(r){
  const pair=PLAYERS.map(p=>r.players.find(x=>x.id===p.id));
  const both=pair.every(Boolean),together=both&&pair[0].team===pair[1].team;
  const team=pair[0]?.team;
  const scored=together&&r.score.every(Number.isFinite);
  const result=!scored?null:[0,1].includes(r.winnerTeam)?r.winnerTeam===team?'win':'loss':r.score[team]>r.score[1-team]?'win':r.score[team]<r.score[1-team]?'loss':'draw';
  return {pair,both,together,result};
}
export function aggregate(replays,scope='together'){
  const shared=replays.filter(r=>{const pair=pairInfo(r);return scope==='together'?pair.together:scope==='solo'?!pair.both&&pair.pair.some(Boolean)&&(r.source!=='live'||r.capture?.rosterComplete===true):pair.pair.some(Boolean);});
  const players=PLAYERS.map(base=>{
    const matches=shared.filter(r=>r.players.some(p=>p.id===base.id));
    const rows=matches.map(r=>r.players.find(p=>p.id===base.id));
    const total=stat();for(const [index,p] of rows.entries())for(const k of Object.keys(total))if(p[k]!==null&&!['boostStolen','bigStolen','smallStolen'].includes(k)&&!(matches[index].boostWarning&&['boostCollected','boostUsed'].includes(k)))total[k]=(total[k]??0)+n(p[k]);
    for(const key of ['goals','assists','saves','shots','demos'])if(rows.length&&!rows.some(p=>Number.isFinite(p[key])))total[key]=null;
    const boostRows=rows.filter((p,i)=>!matches[i].boostWarning&&Number.isFinite(p.boostCollected)&&p.tracked>0),boostTracked=boostRows.reduce((a,p)=>a+n(p.tracked),0);
    const sum=(list,k)=>list.reduce((a,p)=>a+n(p[k]),0),stealRows=rows.filter((p,i)=>matches[i].rule===2&&Number.isFinite(p.boostStolen)),oldRows=rows.filter((p,i)=>matches[i].rule!==2&&!matches[i].boostWarning&&Number.isFinite(p.boostStolen));
    const movementRows=rows.filter(p=>p.tracked>0&&Number.isFinite(p.speedIntegral)),movementTime=movementRows.reduce((s,p)=>s+p.tracked,0);
    const result=r=>{const p=r.players.find(p=>p.id===base.id);return [0,1].includes(r.winnerTeam)?r.winnerTeam===p.team?1:-1:r.score[p.team]-r.score[1-p.team];};
    const wins=matches.filter(r=>result(r)>0).length,losses=matches.filter(r=>result(r)<0).length,draws=matches.filter(r=>result(r)===0).length;
    return {...base,...total,boostStolen:sum(stealRows,'boostStolen'),bigStolen:sum(stealRows,'bigStolen'),smallStolen:sum(stealRows,'smallStolen'),taxed:sum(stealRows,'taxed'),taxCount:sum(stealRows,'taxCount'),stealGames:stealRows.length,oldStolen:sum(oldRows,'boostStolen'),oldGames:oldRows.length,games:rows.length,wins,losses,draws,winRate:rows.length?100*wins/rows.length:null,boostGames:boostRows.length,movementGames:movementRows.length,avgSpeed:movementTime?movementRows.reduce((s,p)=>s+p.speedIntegral,0)/movementTime:null,superPct:movementTime?100*total.supersonic/movementTime:null,airPct:movementTime?100*total.air/movementTime:null,bpm:boostTracked?total.boostCollected*60/boostTracked:null};
  });
  const coverage=shared.filter(r=>r.bumpAvailable&&pairInfo(r).both);
  const pairBumps=PLAYERS.map((p,i)=>coverage.flatMap(r=>r.bumps).filter(e=>e.from===p.id&&e.to===PLAYERS[1-i].id).length);
  const wins=shared.filter(r=>pairInfo(r).result==='win').length;
  const results=shared.filter(r=>pairInfo(r).result!==null).length;
  const habits=PLAYERS.map(base=>{const list=shared.filter(r=>r.rule===2).map(r=>r.players.find(p=>p.id===base.id)).filter(p=>p&&Number.isFinite(p.touches)),t=k=>list.reduce((a,p)=>a+n(p[k]),0),per=k=>list.length?t(k)/list.length:null;
    const drops=shared.filter(r=>r.mode==='dropshot').map(r=>r.players.find(p=>p.id===base.id)).filter(p=>p&&Number.isFinite(p.dropshot));
    return {games:list.length,touches:per('touches'),whiffs:per('whiffs'),passes:per('passes'),beaten:per('beaten'),kickoffs:per('kickoffs'),fiftyPct:t('fifties')?100*t('fiftyWon')/t('fifties'):null,fifties:t('fifties'),firstManPct:t('tracked')?100*t('firstMan')/t('tracked'):null,dropshotGames:drops.length,dropshot:drops.length?drops.reduce((a,p)=>a+p.dropshot,0)/drops.length:null};});
  const record=first=>{const list=shared.filter(r=>[0,1].includes(r.firstGoal)&&pairInfo(r).result&&(r.firstGoal===pairInfo(r).pair[0].team)===first);return {games:list.length,wins:list.filter(r=>pairInfo(r).result==='win').length};};
  return {shared,players,habits,scoredFirst:record(true),concededFirst:record(false),wins,winRate:results?100*wins/results:null,coverage:coverage.length,pairBumps:coverage.length?pairBumps:[null,null],duration:shared.reduce((a,r)=>a+n(r.duration),0)};
}
export function validateSummary(r){
  if(!r||r.schema!==1||typeof r.id!=='string'||r.id.length>180||!Array.isArray(r.players)||r.players.length>16||!Array.isArray(r.score)||r.score.length!==2)throw Error('Invalid dashboard backup.');
  if(!Array.isArray(r.bumps)||r.bumps.length>50000)throw Error('Invalid bump data.');
  if(!r.score.every(x=>Number.isFinite(x)&&x>=0&&x<=1000))throw Error('Invalid match score.');
  if(r.winnerTeam!==undefined&&![0,1].includes(r.winnerTeam))throw Error('Invalid match winner.');
  if(r.source==='live'&&(![0,1].includes(r.winnerTeam)||r.duration!==null||r.bumpAvailable||r.bumps.length||typeof r.capture?.rosterComplete!=='boolean'))throw Error('Invalid live match coverage.');
  for(const p of r.players){if(typeof p.id!=='string'||![0,1].includes(p.team))throw Error('Invalid player identity.');for(const key of Object.keys(stat()))if(p[key]!==null&&(!Number.isFinite(p[key])||p[key]<0))throw Error('Invalid statistic.');for(const key of EXTRA)if(p[key]!=null&&(!Number.isFinite(p[key])||p[key]<0))throw Error('Invalid statistic.');}
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
    result[mode.id]={mmr,tier:s.stats?.tier?.metadata?.name??'Rank unknown',division:s.stats?.division?.metadata?.name??'',season:d.metadata?.currentSeason??null,source:'tracker-import',updatedAt:new Date().toISOString()};
  }
  if(!Object.keys(result).length)throw Error('This response contains no supported playlist ranks.');
  return result;
}
