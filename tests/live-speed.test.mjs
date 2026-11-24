import test from 'node:test';
import assert from 'node:assert/strict';
import {MatchCollector,liveSpeedUnit,SPEED_FACTORS} from '../src/live.js';
import {PLAYERS,validateSummary,aggregate} from '../src/analysis.js';
const id='a'.repeat(32),target=PLAYERS[1].id;
function record({peak,speed,setting='auto',supersonic=true}){
 let now=0,output;const c=new MatchCollector({onSummary:r=>output=r,now:()=>now,speedUnit:setting,settleMs:60000});
 const tick=(Speed,bSupersonic=false)=>c.accept({Event:'UpdateState',Data:{MatchGuid:id,Game:{bReplay:false,bHasWinner:false,PlaylistId:11,Teams:[{TeamNum:0,Score:1},{TeamNum:1,Score:0}]},Players:[{PrimaryId:`Steam|${target}|0`,TeamNum:0,Speed,bSupersonic,bOnGround:true,Boost:33,Goals:1,Assists:0,Saves:0,Shots:1,Demos:0}]}});
 tick(peak,supersonic);for(let i=0;i<300;i++){now+=100;tick(speed);}
 c.accept({Event:'MatchEnded',Data:{MatchGuid:id,WinnerTeamNum:0}});c.finish(id);c.close();return output;
}
test('Small live speed units are calibrated by supersonic evidence, ordinary uu/s stays unchanged',()=>{
 for(const [unit,peak,speed] of [['kmh',82.8,43],['mph',51.45,27],['mps',23,12],['uu',2300,1200]]){
  const row=validateSummary(record({peak,speed})),p=row.players[0];assert.equal(p.speedSourceUnit,unit);assert.ok(Math.abs(p.speedIntegral/p.tracked-speed*SPEED_FACTORS[unit])<1e-7);
 }
 assert.equal(liveSpeedUnit(43,0),null);assert.equal(liveSpeedUnit(0,0),'uu');
});
test('Ambiguous raw 43 is not labelled uu/s, explicit km/h becomes about 1194 uu/s, and old uncertain data is excluded',()=>{
 const unknown=record({peak:43,speed:43,supersonic:false});assert.equal(unknown.players[0].speedIntegral,null);assert.equal(aggregate([validateSummary(unknown)],'overall').players[1].avgSpeed,null);
 const selected=record({peak:43,speed:43,setting:'kmh',supersonic:false});assert.ok(Math.abs(selected.players[0].speedIntegral/selected.players[0].tracked-1194.444444)<.001);
 const legacy={...selected,parser:'rocket-league-stats-api/2',players:selected.players.map(p=>({...p,speedIntegral:p.tracked*43}))};assert.equal(validateSummary(legacy).players[0].speedIntegral,null);
 assert.throws(()=>record({peak:43,speed:43,setting:'invalid'}));
});
