import {PLAYERS} from './analysis.js';
const modeIds={'Ranked Standard 3v3':'standard','Ranked Doubles 2v2':'doubles',Hoops:'hoops',Dropshot:'dropshot',Snowday:'snowday',Rumble:'rumble',Multiple:'unassigned'};
export function trackerDefaultRanks(snapshot){
  return Object.fromEntries(PLAYERS.map(p=>[p.id,Object.fromEntries(Object.entries(snapshot.profiles[p.id].ranks).map(([mode,r])=>[mode,{...r,season:snapshot.season,source:'tracker-browser',updatedAt:snapshot.rankCapturedAt??snapshot.capturedAt}]))]));
}
export function trackerResultSummary(profile,mode='all'){
 const total=profile.daily.reduce((n,d)=>n+d.matches,0),buckets={};
 for(const s of profile.sessions){if(!/^\d+ (hours?|days?) ago$/.test(s.relative)||(/days?/.test(s.relative)&&parseInt(s.relative)>6))continue;
  for(const r of s.rows){const id=modeIds[r.playlist]??'unassigned';const b=buckets[id]??={wins:0,losses:0,grouped:0};
   if(/^Win\b/.test(r.result))b.wins++;else if(/^Defeat\b/.test(r.result))b.losses++;else if(/^\d+ Wins\b/.test(r.result))b.wins+=parseInt(r.result);else if(/^\d+ Matches\b/.test(r.result))b.grouped+=parseInt(r.result);
  }
 }
 const sum=key=>Object.values(buckets).reduce((n,b)=>n+b[key],0);
 const b=mode==='all'?{wins:sum('wins'),losses:sum('losses'),grouped:sum('grouped')}:buckets[mode]??{wins:0,losses:0,grouped:0};
 // The activity calendar has no playlist breakdown. Never allocate its remaining games or mixed wins to a mode.
 const denominator=mode==='all'?total:null;
 const valid=total>0&&sum('wins')+sum('losses')<=total;
 return {...b,total,denominator,buckets,unassignedWins:buckets.unassigned?.wins??0,lower:valid&&mode==='all'?100*b.wins/total:null,upper:valid&&mode==='all'?100*(total-b.losses)/total:null,unknown:mode==='all'&&valid?total-b.wins-b.losses:null,knownRate:b.wins+b.losses?100*b.wins/(b.wins+b.losses):null};
}
