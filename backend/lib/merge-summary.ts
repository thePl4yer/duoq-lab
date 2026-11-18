// A replay may upgrade a scoreboard-only live record. Concurrent live loggers
// may add target-player coverage, but cannot replace an existing replay.
export function mergeStoredSummary(existing:any,incoming:any){
  if(existing.source!=='live')return existing;
  if(incoming.source!=='live')return {...incoming,winnerTeam:incoming.winnerTeam??existing.winnerTeam};
  if(existing.winnerTeam!==incoming.winnerTeam)return existing;
  const incomingFinal=incoming.capture?.finalSnapshot===true,existingFinal=existing.capture?.finalSnapshot===true;
  if(incomingFinal===existingFinal&&JSON.stringify(existing.score)!==JSON.stringify(incoming.score))return existing;
  const primary=incomingFinal&&!existingFinal?incoming:existing,secondary=primary===incoming?existing:incoming;
  const players=new Map<string,any>(primary.players.map((p:any)=>[p.id,p]));
  for(const p of secondary.players){
    const old:any=players.get(p.id);
    if(old&&old.team!==p.team)return existing;
    const merged={...p};
    if(old)for(const key of ['goals','assists','saves','shots','demos'])merged[key]=p[key]===null?old[key]:old[key]===null?p[key]:Math.max(old[key],p[key]);
    players.set(p.id,merged);
  }
  const rosterComplete=existing.capture?.rosterComplete===true||incoming.capture?.rosterComplete===true;
  return {...primary,players:[...players.values()],capture:{rosterComplete,startedMidMatch:!rosterComplete,finalSnapshot:existingFinal||incomingFinal}};
}
