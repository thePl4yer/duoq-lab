import test from 'node:test';
import assert from 'node:assert/strict';
import {MatchCollector,TELEMETRY} from '../src/live.js';
import {aggregate,mergeReplays,validateSummary} from '../src/analysis.js';

const kate='76561198058377116',player='76561198060138310',guid='A'.repeat(32);
const participant=(id,team=0,extra={})=>({PrimaryId:`Steam|${id}|0`,Name:'ignored raw name',TeamNum:team,Goals:1,Assists:2,Saves:3,Shots:4,Demos:0,Loadout:['private'],AccessToken:'must-never-be-copied',...extra});
const state=(players=[participant(kate),participant(player)],extra={})=>({Event:'UpdateState',Data:{MatchGuid:guid,Players:players,Game:{bReplay:false,Teams:[{TeamNum:0,Name:'Blue',Score:3},{TeamNum:1,Name:'Orange',Score:1}],PlaylistId:11,...extra}}});
const ended={Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}};

test('Live capture waits for a confirmed winner and only projects the two players, with day-only dates',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000,now:()=>Date.parse('2026-11-19T22:41:07Z')});
  c.accept(state([...state().Data.Players,participant('76561198000000000',1)]));assert.equal(out.length,0);
  c.accept(ended);const final=state();final.Data.Players[0].Goals=2;final.Data.Game.Teams[0].Score=4;c.accept(final);c.finish(guid);c.close();
  assert.equal(out.length,1);assert.equal(out[0].players[0].goals,2);assert.deepEqual(out[0].score,[4,1]);assert.equal(out[0].capture.finalSnapshot,true);
  assert.equal(out[0].date,'2026-11-19');assert.ok(!JSON.stringify(out).includes('22:41'));
  assert.ok(!JSON.stringify(out).includes('76561198000000000'));assert.ok(!JSON.stringify(out).includes('AccessToken'));
  for(const p of out[0].players)for(const key of TELEMETRY)assert.equal(p[key],null);
  validateSummary(out[0]);
});
test('Replay playback, sessions without a match id, bad packets and unfinished games are excluded',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r)});
  c.accept(null);c.accept({Event:'Unrelated',Data:{MatchGuid:guid}});
  const training=state();training.Data.MatchGuid='';c.accept(training);
  c.accept(state(undefined,{bReplay:true}));c.accept(ended);c.finish(guid);assert.equal(out.length,0);
  c.accept(state());c.accept({Event:'ReplayCreated',Data:{MatchGuid:guid}});c.accept(state());c.accept(ended);c.finish(guid);assert.equal(out.length,0);c.close();
  const other=new MatchCollector({onSummary:r=>out.push(r)});other.accept(state());other.disconnect();assert.equal(out.length,0);
});
test('A disconnect keeps a confirmed result, marks the missing final scoreboard and never counts twice',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000});c.accept(state());c.accept(ended);c.disconnect();
  assert.equal(out.length,1);assert.equal(out[0].capture.finalSnapshot,false);c.accept(state());c.accept(ended);c.finish(guid);assert.equal(out.length,1);c.close();
});
test('Only platform ids identify players; name impersonation is ignored and explicit Epic aliases work',()=>{
  const out=[],fake=participant('76561198000000000');fake.Name='Kate';
  const a=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000});a.accept(state([fake]));a.accept(ended);a.finish(guid);a.close();assert.equal(out.length,0);
  const epic='Epic|11111111111111111111111111111111|0',c=new MatchCollector({aliases:{[epic]:kate},onSummary:r=>out.push(r),settleMs:60000});
  c.accept(state([{...participant(kate),PrimaryId:epic}]));c.accept(ended);c.finish(guid);c.close();assert.equal(out[0].players[0].id,kate);
  assert.throws(()=>new MatchCollector({aliases:{password:'secret'},onSummary:()=>{}}));
});
test('Own-team speed and boost are integrated over time; kickoff and respawn resets are not counted as pickups',()=>{
  let now=0;const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000,now:()=>now});
  const tick=(boost,extra={})=>{now+=100;c.accept(state([participant(kate,0,{Speed:1000,Boost:boost,bSupersonic:false,bOnGround:true,...extra}),participant(player,1)]));};
  tick(33);for(let i=0;i<300;i++)tick(33);       // 30 s driving
  tick(45);                                      // small pad: +12
  tick(20);                                      // used 25
  c.accept({Event:'CountdownBegin',Data:{MatchGuid:guid}});tick(33); // kickoff reset, not a pickup
  tick(0,{bDemolished:true});tick(33);           // respawn, not a pickup
  c.accept(ended);c.finish(guid);c.close();
  const k=out[0].players.find(p=>p.id===kate),p=out[0].players.find(p=>p.id===player);
  assert.equal(k.boostCollected,12);assert.equal(k.boostUsed,25);assert.ok(Math.abs(k.speedIntegral/k.tracked-1000)<1e-6);assert.ok(k.tracked>30&&k.tracked<31);
  assert.equal(p.tracked,null);assert.equal(k.boostStolen,null);
  assert.ok(Math.abs(aggregate([validateSummary(out[0])],"overall").players[0].avgSpeed-1000)<1e-6);
});
test('A later replay upgrades the same live match instead of adding a game',()=>{
  const out=[],c=new MatchCollector({onSummary:r=>out.push(r),settleMs:60000});c.accept(state());c.accept(ended);c.accept(state());c.finish(guid);c.close();
  const replay={...out[0],source:'local',bumpAvailable:true,duration:300,rule:2,winnerTeam:undefined};
  const merged=mergeReplays([out[0]],[replay]);assert.equal(merged.length,1);assert.equal(merged[0].source,'local');assert.equal(merged[0].winnerTeam,0);
  assert.equal(mergeReplays(merged,[out[0]])[0].source,'local');
});
