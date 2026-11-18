const ids=['76561198058377116','76561198060138310'];
const keys=['tracked','speedIntegral','supersonic','air','boostStolen','boostCollected','boostUsed','goals','assists','saves','shots','demos','bigStolen','smallStolen'];
function finite(value:unknown,max=1e9){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)throw Error('Invalid numeric statistic.');return value;}
export function sanitizeReplay(input:any){
  if(input?.schema!==1||!Array.isArray(input.players)||input.players.length<1||input.players.length>2)throw Error('Expected a DuoQ replay summary.');
  if(typeof input.id!=='string'||!/^([a-f\d]{32}|[a-f\d]{64}|[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(input.id))throw Error('Invalid match identifier.');
  if(!Array.isArray(input.score)||input.score.length!==2)throw Error('Invalid score.');
  const players=input.players.map((p:any)=>{
    if(!ids.includes(p.id)||![0,1].includes(p.team))throw Error('Only Kate and PLAYER replay summaries are accepted.');
    const stats=Object.fromEntries(keys.map(key=>[key,key==='boostUsed'&&p[key]===null?null:finite(p[key])]));
    if(Number(stats.tracked)>14400)throw Error('Invalid tracked time.');
    return {id:p.id,name:ids.indexOf(p.id)===0?'Kate':'P L 4 Y E R',team:p.team,...stats};
  });
  if(new Set(players.map((p:any)=>p.id)).size!==players.length)throw Error('Duplicate player.');
  if(!Array.isArray(input.bumps)||input.bumps.length>1000)throw Error('Invalid bump events.');
  const bumps=input.bumps.map((e:any)=>{if(!ids.includes(e.from)||!ids.includes(e.to)||e.from===e.to)throw Error('Invalid bump players.');return {from:e.from,to:e.to,time:finite(e.time,14400),confidence:finite(e.confidence,1),team:!!e.team};});
  if(input.date!==null&&(typeof input.date!=='string'||input.date.length>60||!/^\d{4}-\d{2}-\d{2}/.test(input.date)))throw Error('Invalid replay date.');
  const mode=['standard','doubles','duels','hoops','dropshot','snowday','rumble','other'].includes(input.mode)?input.mode:'other';
  return {schema:1,id:input.id.toUpperCase(),title:'Community replay',date:input.date,dateTimezone:input.dateTimezone==='replay-local'?'replay-local':undefined,mode,playlist:String(input.playlist??mode).slice(0,40),duration:finite(input.duration,14400),score:input.score.map((s:unknown)=>finite(s,1000)),players,bumps,bumpAvailable:input.bumpAvailable===true,source:'local',sourceUrl:null,importedAt:new Date().toISOString(),parser:'subtr-actor 1.5.1',community:true,snatches:cleanSnatches(input.snatches)};
}
function cleanSnatches(s:any){
  if(!s||!['complete','partial','unavailable','not_applicable'].includes(s.status))return undefined;
  const directions=Object.fromEntries(ids.map(id=>{
    const d=s.directions?.[id];const observed=d?.observedCount===null?null:finite(d?.observedCount??0,1000);
    const events=Array.isArray(d?.events)?d.events.slice(0,1000).map((e:any)=>({time:finite(e.time,14400),teammateBoostPercent:finite(e.teammateBoostPercent,100),teammateDistance:finite(e.teammateDistance,10000)})):[];
    return [id,{observedCount:observed,events}];
  }));
  return {status:s.status,directions,method:'teammate-pad-snatch-v1',heuristic:true};
}
