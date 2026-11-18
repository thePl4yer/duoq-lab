import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PLAYERS,aggregate,fromTimeline,mergeReplays,pairInfo,trackerRanks,validateSummary} from '../src/analysis.js';
const ids=PLAYERS.map(p=>p.id);
const p=(i,team,speed=1000,tracked=60)=>({id:ids[i],name:PLAYERS[i].name,team,tracked,speedIntegral:speed*tracked,supersonic:0,air:0,boostStolen:50,boostCollected:300,boostUsed:null,goals:1,assists:0,saves:0,shots:2,demos:0,bigStolen:0,smallStolen:0});
const r=(id,players,score=[2,1])=>({schema:1,id,players,score,date:'2026-01-01',mode:'standard',duration:60,bumps:[],bumpAvailable:true,source:'local'});
test('Zusammen, Solo und Overall haben getrennte Nenner und eigene Winrates',()=>{
  const rows=[r('duo-win',[p(0,0),p(1,0)]),r('kate-solo-loss',[p(0,1)]),r('player-solo-win',[p(1,0)]),r('opponents',[p(0,1),p(1,0)])];
  assert.equal(aggregate(rows).shared.length,1);
  assert.deepEqual(aggregate(rows,'solo').players.map(p=>[p.games,p.wins]),[[1,0],[1,1]]);
  assert.deepEqual(aggregate(rows,'overall').players.map(p=>[p.games,p.wins]),[[3,1],[3,3]]);
  assert.equal(aggregate(rows,'overall').players[0].winRate,100/3);
  assert.equal(pairInfo(rows[3]).together,false);
});
test('Geschwindigkeit wird zeitgewichtet und nicht aus Match-Mittelwerten gemittelt',()=>{
  const a=aggregate([r('a',[p(0,0,1000,60)]),r('b',[p(0,0,2000,180)])],'overall');
  assert.equal(a.players[0].avgSpeed,1750);
  assert.equal(a.players[1].avgSpeed,null);assert.equal(a.players[1].winRate,null);
});
test('Fehlende Bump-Daten bleiben unbekannt, erkannte Null ist eine echte Null',()=>{
  const unknown={...r('a',[p(0,0),p(1,0)]),bumpAvailable:false};
  assert.deepEqual(aggregate([unknown]).pairBumps,[null,null]);
  const known=r('b',[p(0,0),p(1,0)]);known.bumps=[{from:ids[0],to:ids[1]}];
  assert.deepEqual(aggregate([unknown,known]).pairBumps,[1,0]);
});
test('Match-GUID verhindert Doppelzählung und lokale Analyse ersetzt denselben öffentlichen Match',()=>{
  const bc={...r('ABC',[p(0,0),p(1,0)]),bumpAvailable:false,source:'ballchasing',sourceUrl:'https://ballchasing.com/replay/test'};
  const local=r('abc',[p(0,0),p(1,0)]);
  const merged=mergeReplays([bc],[local]);assert.equal(merged.length,1);assert.equal(merged[0].source,'local');assert.equal(merged[0].sourceUrl,bc.sourceUrl);
});
test('Parser-Adapter priorisiert Playlist-ID und skaliert Boost von 255 auf 100',()=>{
  const timeline={replay_meta:{all_headers:[['Id','test'],['Team0Score',2],['Team1Score',1]],game_type:{game_type:'Ranked',playlist_id:30},team_zero:ids.map((id,i)=>({remote_id:{Steam:id},name:PLAYERS[i].name,stats:{Goals:1}})),team_one:[]},frames:[{is_live_play:true,dt:10}],events:{events:[{meta:{id:'m'},payload:{kind:'movement',payload:{player:{Steam:ids[0]},dt:10,speed:1600,speed_band:'supersonic',height_band:'ground'}}},{meta:{id:'b'},payload:{kind:'boost_pickup',payload:{player_id:{Steam:ids[0]},activity:'active',collected_amount:255,is_steal:true,pad_type:'big'}}}]}};
  const out=fromTimeline(timeline,'file','hash');assert.equal(out.mode,'snowday');assert.equal(out.players[0].boostStolen,100);assert.equal(out.players[0].speedIntegral/out.players[0].tracked,1600);
});
test('Unzuverlässige Boostwerte werden ausgeschlossen, Bewegungswerte bleiben nutzbar',()=>{
  const bad={...r('a',[p(0,0),p(1,0)]),boostWarning:true};const a=aggregate([bad]);assert.equal(a.players[0].boostGames,0);assert.equal(a.players[0].boostStolen,0);assert.equal(a.players[0].bpm,null);assert.equal(a.players[0].avgSpeed,1000);
});
test('Tracker-Import prüft Steam-ID statt Spielernamen',()=>{
  const data={data:{platformInfo:{platformUserId:ids[0]},metadata:{currentSeason:24},segments:[{type:'playlist',attributes:{playlistId:27},stats:{rating:{value:900},tier:{metadata:{name:'Diamond II'}}}}]}};
  assert.equal(trackerRanks(data,ids[0]).hoops.mmr,900);assert.throws(()=>trackerRanks(data,ids[1]));
});
test('Mitgelieferte Daten enthalten nur die Zielspieler und eindeutige Matches',()=>{
  const seed=JSON.parse(fs.readFileSync(new URL('../data/seed.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  const seen=new Set();for(const row of seed){validateSummary(row);assert.ok(!seen.has(row.id.toUpperCase()));seen.add(row.id.toUpperCase());assert.ok(row.players.every(p=>ids.includes(p.id)));}
  assert.equal(seed.length,360);assert.equal(aggregate(seed).shared.length,33);assert.equal(aggregate(seed,'solo').shared.length,326);
});
