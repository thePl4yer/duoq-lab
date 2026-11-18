/**
 * Pure, conservative teammate boost-pad snatch heuristic.
 * Counts an observed pickup with a nearby, low-boost teammate driving toward that
 * exact resolved pad. It does not infer intention or actual ownership of a pad.
 * All boost_amount inputs are parser raw units (0..255).
 */
export const TARGET_IDS=['76561198058377116','76561198060138310'];
export const SNATCH_RULES=Object.freeze({boostBelowPercent:50,maxDistance:800,minSpeed:300,minApproachCosine:0.6,maxSampleAge:0.15,debounceSeconds:1,spawnLookbackSeconds:0.15,maxPickupPositionOffset:400});
// Only maps with the standard Soccar pad geometry are accepted. In particular,
// the parser's canonical standard pad array must never be used for Hoops.
const STANDARD_MAPS=new Set(['beach_night_grs_p','beach_p','beach_night_p','neotokyo_arcade_p','neotokyo_standard_p','park_night_p','park_p','park_rainy_p','stadium_winter_p','stadium_p','stadium_foggy_p','stadium_day_p','stadium_race_day_p','trainstation_dawn_p','trainstation_p','trainstation_night_p','underwater_grs_p','underwater_p','wasteland_s_p','wasteland_night_s_p','eurostadium_p','eurostadium_night_p','eurostadium_rainy_p','utopiastadium_p','utopiastadium_dusk_p','utopiastadium_snow_p','farm_p','farm_night_p','cs_p','cs_day_p','arc_s_p','chn_stadium_p','chn_stadium_day_p','street_p']);
const steamId=id=>id&&typeof id==='object'&&typeof id.Steam!=='undefined'?String(id.Steam):'';
const finiteVec=v=>v&&['x','y','z'].every(k=>Number.isFinite(v[k]));
const norm=v=>Math.hypot(v.x,v.y,v.z);
const minus=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const emptyCoverage=()=>({targetPickups:0,distinctPickups:0,resolvedPadPickups:0,evaluatedPickups:0,unknownPadPickups:0,unknownStatePickups:0,ignoredRespawnPickups:0,ignoredDifferentTeamPickups:0,duplicatePickups:0});
function atOrBefore(times,t){let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<=t)lo=mid+1;else hi=mid;}return lo-1;}
function playerData(frames,index){return frames?.[index]?.Data??null;}
function stableCar(frames,times,index,lookback){
 const data=playerData(frames,index);if(!finiteVec(data?.rigid_body?.location))return false;
 const targetTime=times[index]-lookback;const before=atOrBefore(times,targetTime);if(before<0||times[index]-times[before]>lookback+0.15)return false;
 let previous=null;
 for(let i=before;i<=index;i++){const d=playerData(frames,i);const pos=d?.rigid_body?.location;if(!finiteVec(pos))return false;
  if(previous){const dt=times[i]-times[i-1];if(dt<=0||dt>0.15||norm(minus(pos,previous))>2600*dt+100)return false;}
  previous=pos;
 }
 return true;
}
export function analyseBoostSnatches(replay,options={}){
 const ids=options.ids??TARGET_IDS;const rules={...SNATCH_RULES,...options.rules};
 const h=Object.fromEntries(replay?.meta?.all_headers??[]);const map=String(h.MapName??'').toLowerCase();
 const playlist=Number(replay?.meta?.game_type?.playlist_id);
 const all=[...(replay?.meta?.team_zero??[]).map(p=>({...p,team:0})),...(replay?.meta?.team_one??[]).map(p=>({...p,team:1}))];
 const members=ids.map(id=>all.find(p=>steamId(p.remote_id)===id));
 const result={schema:1,matchId:String(h.MatchGUID??h.Id??''),method:'teammate-pad-snatch-v1',heuristic:true,rules,status:'unavailable',reason:null,coverage:{},directions:{}};
 for(const from of ids){const to=ids.find(id=>id!==from);result.directions[from]={from,to,status:'unavailable',count:null,observedCount:null,coverage:emptyCoverage(),events:[]};}
 if(members.some(p=>!p)||members[0].team!==members[1].team){result.reason='both_target_ids_must_share_a_team';return result;}
 if(playlist===29||map==='shattershot_p'){result.status='not_applicable';result.reason='dropshot_has_no_boost_pads';for(const d of Object.values(result.directions))d.status='not_applicable';return result;}
 const events=(replay?.boost_pad_events??[]).filter(e=>e?.kind&&Object.hasOwn(e.kind,'PickedUp')&&ids.includes(steamId(e.player)));
 for(const e of events)result.directions[steamId(e.player)].coverage.targetPickups++;
 if(!STANDARD_MAPS.has(map)){result.reason=map.includes('hoop')?'hoops_pad_geometry_not_available':'map_pad_geometry_not_verified';return result;}
 const times=(replay?.frame_data?.metadata_frames??[]).map(f=>f.time);
 if(!times.length||times.some(t=>!Number.isFinite(t))){result.reason='missing_frame_times';return result;}
 const framesById=new Map((replay?.frame_data?.players??[]).map(([id,p])=>[steamId(id),p?.frames]));
 const padById=new Map();const ambiguousPads=new Set();
 for(const pad of replay?.boost_pads??[]){if(!pad.pad_id||!finiteVec(pad.position))continue;if(padById.has(pad.pad_id))ambiguousPads.add(pad.pad_id);else padById.set(pad.pad_id,pad);}
 const seen=new Set(),lastPadTime=new Map();
 for(const e of [...events].sort((a,b)=>a.time-b.time)){
  const from=steamId(e.player),direction=result.directions[from],to=direction.to,c=direction.coverage;
  const key=[e.pad_id,e.frame,e.kind.PickedUp?.sequence,from].join('|');
  if(seen.has(key)||(Number.isFinite(e.time)&&e.time-(lastPadTime.get(e.pad_id)??-Infinity)<rules.debounceSeconds)){c.duplicatePickups++;continue;}
  seen.add(key);if(Number.isFinite(e.time))lastPadTime.set(e.pad_id,e.time);c.distinctPickups++;
  const pad=padById.get(e.pad_id);
  if(!pad||ambiguousPads.has(e.pad_id)||!finiteVec(e.player_position)||norm(minus(e.player_position,pad.position))>rules.maxPickupPositionOffset){c.unknownPadPickups++;continue;}
  c.resolvedPadPickups++;
  const i=Number.isFinite(e.time)?atOrBefore(times,e.time):-1;
  if(i<0||e.time-times[i]>rules.maxSampleAge){c.unknownStatePickups++;continue;}
  const teammate=playerData(framesById.get(to),i),taker=playerData(framesById.get(from),i);
  if(!teammate||!taker||!finiteVec(teammate.rigid_body?.location)||!finiteVec(teammate.rigid_body?.linear_velocity)||!Number.isFinite(teammate.boost_amount)||teammate.boost_amount<0||teammate.boost_amount>255){c.unknownStatePickups++;continue;}
  if(typeof teammate.is_team_0!=='boolean'||typeof taker.is_team_0!=='boolean'){c.unknownStatePickups++;continue;}
  if(teammate.is_team_0!==taker.is_team_0){c.ignoredDifferentTeamPickups++;continue;}
  if(!stableCar(framesById.get(from),times,i,rules.spawnLookbackSeconds)||!stableCar(framesById.get(to),times,i,rules.spawnLookbackSeconds)){c.ignoredRespawnPickups++;continue;}
  c.evaluatedPickups++;
  const displacement=minus(pad.position,teammate.rigid_body.location);const distance=norm(displacement);const speed=norm(teammate.rigid_body.linear_velocity);
  const cosine=distance>0&&speed>0?dot(teammate.rigid_body.linear_velocity,displacement)/(speed*distance):null;
  const boost=teammate.boost_amount*100/255;
  if(boost<rules.boostBelowPercent&&distance<=rules.maxDistance&&speed>rules.minSpeed&&cosine>rules.minApproachCosine){direction.events.push({time:e.time,frame:e.frame,padId:e.pad_id,padSize:pad.size??null,from,to,teammateBoostPercent:boost,teammateDistance:distance,teammateSpeed:speed,approachCosine:cosine,sampleAge:e.time-times[i],padPosition:{...pad.position}});}
 }
 let totalPickups=0,totalEvaluated=0,totalUnknown=0;
 for(const d of Object.values(result.directions)){const c=d.coverage;const unknown=c.unknownPadPickups+c.unknownStatePickups;d.status=unknown?(c.evaluatedPickups?'partial':'unavailable'):'complete';d.observedCount=d.events.length;d.count=d.status==='complete'?d.events.length:null;totalPickups+=c.distinctPickups;totalEvaluated+=c.evaluatedPickups;totalUnknown+=unknown;}
 result.coverage={distinctTargetPickups:totalPickups,evaluatedTargetPickups:totalEvaluated,unknownTargetPickups:totalUnknown,resolvedPads:padById.size};
 result.status=totalUnknown?(totalEvaluated?'partial':'unavailable'):'complete';result.reason=totalUnknown?'some_pickups_have_unresolved_pad_or_missing_state':null;return result;
}
