import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {MatchCollector,projectSummary,DETAIL_KEYS} from '../logger/match.mjs';
import {SummaryStore,sendSummary} from '../logger/store.mjs';
import {configureIni,configureFile} from '../logger/configure.mjs';
import {aggregate,mergeReplays,validateSummary} from '../src/analysis.js';
import {sanitizeReplay} from '../backend/lib/sanitize.ts';
import {mergeStoredSummary} from '../backend/lib/merge-summary.ts';

const kate='76561198058377116',player='76561198060138310',guid='A'.repeat(32);
const participant=(id,team=0)=>({PrimaryId:`Steam|${id}|0`,Name:'ignored raw name',TeamNum:team,Goals:1,Assists:2,Saves:3,Shots:4,Demos:0,Loadout:['private-irrelevant-packet-data'],AccessToken:'must-never-be-copied'});
const state=(players=[participant(kate),participant(player)],extra={})=>({Event:'UpdateState',Data:{MatchGuid:guid,Players:players,Game:{bReplay:false,Teams:[{TeamNum:0,Name:'Blue',Score:3},{TeamNum:1,Name:'Orange',Score:1}],PlaylistId:11,...extra}}});
function capture({initialized=true,players,extra,finalUpdate=true}={}){
  const out=[];const c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000,now:()=>Date.parse('2026-11-19T12:00:00Z')});
  if(initialized)c.accept({Event:'MatchInitialized',Data:{MatchGuid:guid}});
  c.accept(state(players,extra));c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});
  if(finalUpdate)c.accept(state(players,extra));
  c.finish(guid);c.close();return out[0];
}
async function inFolder(run){
  const base=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(base,'duoq-logger-test-'));
  try{return await run(dir);}finally{
    if(path.dirname(path.resolve(dir))!==base||!path.basename(dir).startsWith('duoq-logger-test-'))throw Error('Unsafe test cleanup path');
    await fs.rm(dir,{recursive:true,force:true});
  }
}

test('Live capture waits for a confirmed winner, settles the last scoreboard and only projects target fields',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000});
  c.accept(state([...state().Data.Players,participant('76561198000000000',1)]));assert.equal(out.length,0);
  c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});
  const final=state();final.Data.Players[0].Goals=2;final.Data.Game.Teams[0].Score=4;c.accept(final);c.finish(guid);c.close();
  assert.equal(out.length,1);assert.equal(out[0].players[0].goals,2);assert.deepEqual(out[0].score,[4,1]);assert.equal(out[0].capture.finalSnapshot,true);
  assert.equal(out[0].players.length,2);assert.ok(!JSON.stringify(out).includes('76561198000000000'));assert.ok(!JSON.stringify(out).includes('AccessToken'));
  for(const p of out[0].players)for(const key of DETAIL_KEYS)assert.equal(p[key],null);
});

test('Replay playback, unnamed training sessions, malformed packets and unfinished games are excluded',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r)});
  c.accept(null);c.accept({Event:'UnrelatedApp',Data:{MatchGuid:guid}});
  const training=state();training.Data.MatchGuid='';c.accept(training);
  c.accept(state(undefined,{bReplay:true}));c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});c.finish(guid);assert.equal(out.length,0);
  c.accept(state());c.accept({Event:'ReplayCreated',Data:{MatchGuid:guid}});c.accept(state());c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});c.finish(guid);assert.equal(out.length,0);c.close();
  const other=new MatchCollector({onSummary:r=>out.push(r)});other.accept(state());other.disconnect();assert.equal(out.length,0);
});

test('Disconnect preserves a confirmed result, marks a missing final scoreboard and does not count it twice',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000});c.accept(state());c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});c.disconnect();
  assert.equal(out.length,1);assert.equal(out[0].capture.finalSnapshot,false);c.accept(state());c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});c.finish(guid);assert.equal(out.length,1);c.close();
});

test('Only public platform IDs identify targets; display-name impersonation is ignored and explicit Epic aliases work',()=>{
  const fake=participant('76561198000000000');fake.Name='Kate';assert.equal(capture({players:[fake]}),undefined);
  const epic='Epic|11111111111111111111111111111111|0',out=[];
  const c=new MatchCollector({aliases:{[epic]:kate},onSummary:r=>out.push(r),settleMs:60000});c.accept(state([{...participant(kate),PrimaryId:epic}]));c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});c.finish(guid);c.close();assert.equal(out[0].players[0].id,kate);
  assert.throws(()=>new MatchCollector({aliases:{'password':'secret'},onSummary:()=>{}}));
});

test('Mid-match one-player coverage counts in Overall but is not invented as Solo; both targets still confirm Together',()=>{
  const partial=capture({initialized:false,players:[participant(kate)]});assert.equal(aggregate([partial],'overall').players[0].games,1);assert.equal(aggregate([partial],'solo').players[0].games,0);
  const complete=capture({players:[participant(kate)]});assert.equal(aggregate([complete],'solo').players[0].games,1);
  assert.equal(aggregate([capture({initialized:false})],'together').shared.length,1);
});

test('WinnerTeam handles a forfeit with a tied last score and target team changes invalidate a capture',()=>{
  const row=capture({extra:{Teams:[{TeamNum:0,Name:'Blue',Score:0},{TeamNum:1,Name:'Orange',Score:0}]}});
  assert.equal(aggregate([row]).players[0].wins,1);assert.equal(aggregate([row]).players[0].draws,0);
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000});c.accept(state());c.accept(state([participant(kate,1),participant(player)]));c.accept({Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}});c.finish(guid);c.close();assert.equal(out.length,0);
});

test('Frontend and backend accept live unknowns; live telemetry cannot masquerade as measured movement',()=>{
  const live=capture();validateSummary(live);const cleaned=sanitizeReplay(live);assert.equal(cleaned.source,'live');assert.equal(cleaned.duration,null);assert.equal(cleaned.players[0].speedIntegral,null);
  assert.throws(()=>sanitizeReplay({...live,players:live.players.map(p=>({...p,tracked:60}))}));
  assert.throws(()=>validateSummary({...live,players:live.players.map(p=>({...p,tracked:60}))}));
  const contaminated={...live,accountPassword:'secret',players:live.players.map(p=>({...p,rawBrowserCookie:'secret'}))};assert.ok(!JSON.stringify(projectSummary(contaminated)).includes('secret'));
});

test('Live games do not dilute replay speed or boost denominators and unknown scoreboard values stay unknown',()=>{
  const live=capture(),replay={...live,id:'B1234567890123456789012345678901B2',source:'local',duration:60,bumpAvailable:true,players:live.players.map(p=>({...p,tracked:60,speedIntegral:60000,supersonic:6,air:12,boostCollected:300,boostStolen:50,bigStolen:1,smallStolen:2}))};
  const combined=aggregate([live,replay]);assert.equal(combined.players[0].games,2);assert.equal(combined.players[0].avgSpeed,1000);assert.equal(combined.players[0].bpm,300);assert.equal(combined.players[0].boostGames,1);assert.equal(combined.coverage,1);
  const missing={...live,players:live.players.map(p=>({...p,goals:null}))};assert.equal(aggregate([missing]).players[0].goals,null);assert.equal(aggregate([live]).players[0].avgSpeed,null);assert.equal(aggregate([live]).players[0].boostGames,0);
});

test('Replay enrichment wins in both merge directions without adding a game; live logger coverage can be combined',()=>{
  const live=capture(),replay={...live,source:'local',bumpAvailable:false,duration:60};
  assert.equal(mergeReplays([live],[replay])[0].source,'local');assert.equal(mergeReplays([replay],[live])[0].source,'local');assert.equal(mergeReplays([live],[replay]).length,1);
  assert.equal(mergeStoredSummary(replay,live).source,'local');assert.equal(mergeStoredSummary(live,replay).source,'local');
  const withoutWinner={...replay};delete withoutWinner.winnerTeam;
  assert.equal(mergeStoredSummary(live,withoutWinner).winnerTeam,live.winnerTeam);assert.equal(mergeReplays([live],[withoutWinner])[0].winnerTeam,live.winnerTeam);
  const a={...live,players:[live.players[0]],capture:{rosterComplete:false}},b={...live,players:[live.players[1]]};
  assert.equal(mergeStoredSummary(a,b).players.length,2);assert.equal(mergeReplays([a],[b])[0].players.length,2);
});

test('A confirmed final scoreboard upgrades an older live snapshot',()=>{
  const final=capture(),early={...capture({finalUpdate:false}),score:[2,1]};
  assert.deepEqual(mergeStoredSummary(early,final).score,[3,1]);assert.deepEqual(mergeReplays([early],[final])[0].score,[3,1]);
  assert.deepEqual(mergeStoredSummary(final,early).score,[3,1]);
});

test('Retry queue survives a restart, deduplicates acknowledgements and strips unknown properties',async()=>inFolder(async directory=>{
  const row={...capture(),password:'not-saved'};const first=await new SummaryStore(directory).open();assert.equal(await first.enqueue(row),true);assert.equal(await first.enqueue(row),false);
  const restarted=await new SummaryStore(directory).open();assert.equal(restarted.pending.length,1);assert.ok(!(await fs.readFile(path.join(directory,'state.json'),'utf8')).includes('not-saved'));
  await assert.rejects(sendSummary(row,{endpoint:'https://example.invalid',fetchImpl:async()=>({ok:false,status:503})}));assert.equal(restarted.pending.length,1);
  let request;await sendSummary(row,{endpoint:'https://example.invalid',fetchImpl:async(url,options)=>{request=options;return {ok:true,json:async()=>({replay:{id:guid}})}}});assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.ok(!request.body.includes('not-saved'));
  await restarted.acknowledge(guid);const final=await new SummaryStore(directory).open();assert.equal(final.pending.length,0);assert.equal(await final.enqueue(row),false);
}));

test('API setup preserves other INI sections, is idempotent, rejects unrelated files and keeps a backup',async()=>{
  const original='[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0\r\nPort=49123\r\nWebPort=0\r\nOtherSetting=true\r\n[IniVersion]\r\n0=123\r\n';
  const configured=configureIni(original);assert.ok(configured.includes('PacketSendRate=10\r\nPort=0\r\nWebPort=49124'));assert.ok(configured.includes('[IniVersion]\r\n0=123'));assert.ok(configured.includes('OtherSetting=true'));assert.equal(configureIni(configured),configured);
  await inFolder(async dir=>{await assert.rejects(configureFile(path.join(dir,'unrelated.ini')));const folder=path.join(dir,'TAGame','Config');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,'TAStatsAPI.ini');await fs.writeFile(file,original);const result=await configureFile(file);assert.equal(await fs.readFile(result.backup,'utf8'),original);assert.equal(await fs.readFile(file,'utf8'),configured);});
});

test('API setup preserves Windows UTF-16 LE encoding and its exact original backup',async()=>inFolder(async dir=>{
  const folder=path.join(dir,'TAGame','Config');await fs.mkdir(folder,{recursive:true});const filename=path.join(folder,'TAStatsAPI.ini');
  const original=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0\r\n[IniVersion]\r\n0=123\r\n','utf16le')]);
  await fs.writeFile(filename,original);const result=await configureFile(filename),updated=await fs.readFile(filename);
  assert.deepEqual(await fs.readFile(result.backup),original);assert.deepEqual(updated.subarray(0,2),Buffer.from([0xff,0xfe]));assert.ok(updated.subarray(2).toString('utf16le').includes('WebPort=49124'));assert.equal((await configureFile(filename)).unchanged,true);
}));
