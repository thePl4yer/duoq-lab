// Physical boost-steal analysis from replay frames.
// A pickup counts when it leaves another car without boost it would otherwise have collected:
//   arrived: that car drove over the empty pad while it was still respawning, or
//   race:    that car was about to reach the pad when it was taken.
// Opponent denied = steal. Teammate denied = tax, and only when the taker had more boost (needed it less).
// Amount = what the denied car would have gained: min(pad value, 100 - its boost).
import {remoteId} from './analysis.js';
export const RULES=Object.freeze({Big:{value:100,respawn:10,reach:250,eta:1},Small:{value:12,respawn:4,reach:190,eta:.6},maxHeight:220,minNeed:5,minClosing:300,minCosine:.6,maxSampleAge:.15,maxPickupOffset:400,debounce:1});
// Only maps with standard Soccar pad positions; the parser's pad table is wrong for Hoops.
const STANDARD_MAPS=new Set('beach_night_grs_p beach_p beach_night_p neotokyo_arcade_p neotokyo_standard_p park_night_p park_p park_rainy_p stadium_winter_p stadium_p stadium_foggy_p stadium_day_p stadium_race_day_p trainstation_dawn_p trainstation_p trainstation_night_p underwater_grs_p underwater_p wasteland_s_p wasteland_night_s_p eurostadium_p eurostadium_night_p eurostadium_rainy_p utopiastadium_p utopiastadium_dusk_p utopiastadium_snow_p farm_p farm_night_p cs_p cs_day_p arc_s_p chn_stadium_p chn_stadium_day_p street_p'.split(' '));
const finite=v=>v&&['x','y','z'].every(k=>Number.isFinite(v[k]));
const flat=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function atOrBefore(times,t){let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<=t)lo=mid+1;else hi=mid;}return lo-1;}

export function analyseBoost(replay,ids,rules=RULES){
  const header=Object.fromEntries(replay?.meta?.all_headers??[]),map=String(header.MapName??'').toLowerCase();
  const team=new Map([...(replay?.meta?.team_zero??[]).map(p=>[remoteId(p.remote_id),0]),...(replay?.meta?.team_one??[]).map(p=>[remoteId(p.remote_id),1])]);
  const players=Object.fromEntries(ids.filter(id=>team.has(id)).map(id=>[id,{pickups:0,evaluated:0,steals:0,stolen:0,big:0,small:0,taxCount:0,taxed:0,taxEvents:[]}]));
  const result={rule:2,status:'unavailable',reason:null,players};
  if(Number(replay?.meta?.game_type?.playlist_id)===29||map==='shattershot_p'){result.status='not_applicable';result.reason='dropshot_has_no_boost_pads';return result;}
  if(!STANDARD_MAPS.has(map)){result.reason='pad_positions_unknown_for_map';return result;}
  const times=(replay?.frame_data?.metadata_frames??[]).map(f=>f.time);
  if(!times.length||times.some(t=>!Number.isFinite(t))){result.reason='missing_frame_times';return result;}
  const frames=new Map((replay?.frame_data?.players??[]).map(([id,p])=>[remoteId(id),p?.frames??[]]));
  const state=(id,i)=>{const d=frames.get(id)?.[i]?.Data;return d&&finite(d.rigid_body?.location)&&Number.isFinite(d.boost_amount)?{at:d.rigid_body.location,velocity:d.rigid_body.linear_velocity,boost:d.boost_amount*100/255}:null;};
  const pads=new Map(),ambiguous=new Set();
  for(const pad of replay?.boost_pads??[]){if(!pad.pad_id||!finite(pad.position)||!rules[pad.size])continue;pads.has(pad.pad_id)?ambiguous.add(pad.pad_id):pads.set(pad.pad_id,pad);}
  const others=[...team.keys()],last=new Map();let unknown=0,evaluated=0;
  const pickups=(replay?.boost_pad_events??[]).filter(e=>e?.kind&&Object.hasOwn(e.kind,'PickedUp')&&Number.isFinite(e.time)).sort((a,b)=>a.time-b.time);
  for(const e of pickups){
    const taker=remoteId(e.player),mine=players[taker];
    if(e.time-(last.get(e.pad_id)??-Infinity)<rules.debounce)continue;
    last.set(e.pad_id,e.time);
    if(!mine)continue;
    mine.pickups++;
    const pad=pads.get(e.pad_id),i=atOrBefore(times,e.time);
    if(!pad||ambiguous.has(e.pad_id)||!finite(e.player_position)||flat(e.player_position,pad.position)>rules.maxPickupOffset||i<0||e.time-times[i]>rules.maxSampleAge){unknown++;continue;}
    mine.evaluated++;evaluated++;
    const rule=rules[pad.size];let victim=null;
    // arrived: first other car over the empty pad that could have used it
    for(let j=i+1;j<times.length&&times[j]<e.time+rule.respawn&&!victim;j++)for(const id of others){
      if(id===taker)continue;const s=state(id,j);
      if(s&&s.at.z<=rules.maxHeight&&flat(s.at,pad.position)<=rule.reach&&100-s.boost>=rules.minNeed){victim={id,need:100-s.boost,boost:s.boost,how:'arrived'};break;}
    }
    // race: closest car that was about to get there
    if(!victim){let best=Infinity;for(const id of others){
      if(id===taker)continue;const s=state(id,i);if(!s||!finite(s.velocity)||100-s.boost<rules.minNeed)continue;
      const dx=pad.position.x-s.at.x,dy=pad.position.y-s.at.y,distance=Math.hypot(dx,dy),speed=Math.hypot(s.velocity.x,s.velocity.y);if(!distance||!speed)continue;
      const closing=(s.velocity.x*dx+s.velocity.y*dy)/distance,eta=distance/closing;
      if(closing>rules.minClosing&&closing/speed>=rules.minCosine&&eta<=rule.eta&&eta<best){best=eta;victim={id,need:100-s.boost,boost:s.boost,how:'race'};}
    }}
    if(!victim)continue;
    const amount=Math.min(rule.value,victim.need);
    if(team.get(victim.id)!==team.get(taker)){mine.steals++;mine.stolen+=amount;mine[pad.size==='Big'?'big':'small']++;}
    else if(players[victim.id]){const before=state(taker,i-1)??state(taker,i);if(before&&before.boost>victim.boost){mine.taxCount++;mine.taxed+=amount;if(mine.taxEvents.length<200)mine.taxEvents.push({time:+e.time.toFixed(2),pad:pad.size,amount:Math.round(amount),takerBoost:Math.round(before.boost),theirBoost:Math.round(victim.boost),how:victim.how});}}
  }
  for(const p of Object.values(players)){p.stolen=Math.round(p.stolen);p.taxed=Math.round(p.taxed);}
  result.status=unknown?(evaluated?'partial':'unavailable'):'complete';result.reason=unknown?'some_pickups_unresolved':null;
  return result;
}
