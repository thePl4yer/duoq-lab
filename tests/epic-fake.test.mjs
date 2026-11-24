// End-to-end runs of scripts/collect.mjs against tests/fake-epic.mjs (no real network, real code paths).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),KATE='76561198058377116',PLAYER='76561198060138310';
const sample=path.join(os.tmpdir(),'duoq-not-us.replay');fs.writeFileSync(sample,Buffer.alloc(5000,7));
const player={role:'player',account_id:'e0000000000000000000000000000001',ids:[`Steam|${PLAYER}|0`]},scout={role:'scout',account_id:'e0000000000000000000000000000002'};
const who=(id,team,extra={})=>({PlayerID:`Steam|${id}|0`,PlayerName:'n',LastTeam:team,Goals:1,Assists:0,Saves:2,Shots:3,Demolishes:0,Skills:{Mu:null,Tier:null,Division:null,bValid:false},...extra});
const match=(guid,playlist,players,extra={})=>({MatchGUID:guid,RecordStartTimestamp:Date.parse('2026-11-21T20:30:00Z')/1000,MapName:'Stadium_P',Playlist:playlist,SecondsPlayed:300.4,WinningTeam:0,Team0Score:3,Team1Score:1,bNoContest:false,Players:players,...extra});
const history=[
  match('a'.repeat(32),11,[who(KATE,0),who(PLAYER,0,{Skills:{Mu:61.7,Tier:16,Division:2,bValid:true}}),who('76561198000000001',1),who('76561198000000002',1)]),
  match('b'.repeat(32),3,[who(PLAYER,1),who('76561198000000003',0)],{WinningTeam:1,Team0Score:0,Team1Score:2}),
  match('c'.repeat(32),6,[who(PLAYER,0),who(KATE,1)],{WinningTeam:-1,bNoContest:true,Team0Score:0,Team1Score:0}),
  match('d'.repeat(32),11,[who('76561198000000004',0),who('76561198000000005',1)]),
];
function setup(extra={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duoq-epic-')),world=path.join(dir,'world.json'),log=path.join(dir,'calls.jsonl');
  fs.writeFileSync(world,JSON.stringify({accounts:{player:{...player,history},scout},replays:{['a'.repeat(32)]:sample},...extra}));fs.writeFileSync(log,'');
  const run=(env={})=>{const r=spawnSync(process.execPath,['--import',pathToFileURL(path.join(root,'tests/fake-epic.mjs')).href,path.join(root,'scripts/collect.mjs'),...(env.ARGS??[])],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,LOGIN_KEY:'k'.repeat(32),DATA_DIR:path.join(dir,'store'),FAKE_EPIC:world,FAKE_EPIC_LOG:log,GITHUB_ACTIONS:'',FORCE:'',ALLOW_ONLINE:'',...env}});return {code:r.status,out:r.stdout+r.stderr};};
  const calls=()=>fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const edit=f=>{const w=JSON.parse(fs.readFileSync(world,'utf8'));f(w);fs.writeFileSync(world,JSON.stringify(w));};
  const login=role=>{edit(w=>{w.deviceApproves=role;w.polls=0;});return run({ARGS:['login',role]});};
  const rows=()=>JSON.parse(fs.readFileSync(path.join(dir,'store/matches.json'),'utf8')).filter(r=>r.source==='epic');
  return {dir,run,calls,edit,login,rows,clear:()=>fs.writeFileSync(log,'')};
}
const ready=extra=>{const s=setup(extra);assert.equal(s.login('player').code,0);assert.equal(s.login('scout').code,0);s.clear();return s;};
const auths=s=>s.calls().filter(c=>c.call==='psynet.auth').map(c=>c.account);

test('device login stores both accounts encrypted and prints only the link',()=>{
  const s=setup(),r=s.login('player');
  assert.equal(r.code,0,r.out);assert.match(r.out,/Open https:\/\/www\.epicgames\.com\/activate\?userCode=FAKE1234/);assert.doesNotMatch(r.out,/dc-player|at-|rt-/);
  const stored=fs.readFileSync(path.join(s.dir,'store/logins.json'),'utf8');assert.match(stored,/"player":\{"iv"/);assert.doesNotMatch(stored,/rt-/);
});
test('outside the morning window only the logins are renewed; the game is never contacted',()=>{
  const s=ready(),r=s.run();
  assert.match(r.out,/outside 04:00-08:00/);assert.deepEqual(auths(s),[]);
  assert.equal(s.calls().filter(c=>c.call==='eos.refresh').length,2);
});
test('a normal morning run reads the history and stores only the two players with day-only dates',()=>{
  const s=ready(),r=s.run({FORCE:'true'});
  assert.equal(r.code,0,r.out);assert.deepEqual(auths(s),['scout','player']);
  const rows=s.rows();assert.deepEqual(rows.map(x=>x.id).sort(),['A'.repeat(32),'B'.repeat(32),'C'.repeat(32)]);
  for(const x of rows){assert.match(x.date,/^\d{4}-\d\d-\d\d$/);assert.ok(x.players.every(p=>[KATE,PLAYER].includes(p.id)));}
  const duo=rows.find(x=>x.id==='A'.repeat(32));assert.equal(duo.winnerTeam,0);assert.equal(duo.mode,'doubles');assert.equal(duo.players.find(p=>p.id===PLAYER).rank.mmr,1334);
  assert.equal(rows.find(x=>x.id==='C'.repeat(32)).winnerTeam,undefined);
  assert.ok(!s.calls().some(c=>/UNEXPECTED|DUPLICATE/.test(c.call)));
  const before=fs.readFileSync(path.join(s.dir,'store/matches.json'),'utf8');s.run({FORCE:'true'});
  assert.equal(fs.readFileSync(path.join(s.dir,'store/matches.json'),'utf8'),before,'second run changes nothing');
});
test('online on Steam, in game per Rocket League, or an unanswered presence check: the player login is never used',()=>{
  for(const [label,change,expect] of [['steam',w=>{w.steam={[PLAYER]:{privacy:'public',online:'in-game'}};},/online on Steam/],['presence',w=>{w.steam={[PLAYER]:{privacy:'private',online:''}};w.presence={[`Steam|${PLAYER}|0`]:'InGame'};},/online in Rocket League/],['error',w=>{w.presenceError=true;},/presence check failed/]]){
    const s=ready();s.edit(w=>{change(w);w.accounts.player.inGame=true;});const r=s.run({FORCE:'true'});
    assert.match(r.out,expect,label);assert.ok(!auths(s).includes('player'),label);assert.ok(!s.calls().some(c=>c.call==='DUPLICATE_LOGIN'),label);
  }
});
test('a manual run with ALLOW_ONLINE reads the history even while the player is in game, and says so',()=>{
  const s=ready();s.edit(w=>{w.steam={[PLAYER]:{privacy:'public',online:'in-game'}};w.accounts.player.inGame=true;});
  const r=s.run({FORCE:'true',ALLOW_ONLINE:'true'});
  assert.equal(r.code,0,r.out);assert.match(r.out,/online check skipped/);assert.equal(s.rows().length,3);
});
test('history kept under the Steam id is still found',()=>{
  const s=ready({historyKey:'steam'}),r=s.run({FORCE:'true'});
  assert.equal(r.code,0,r.out);assert.equal(s.rows().length,3,r.out);
});
test('if the scout may read the player history, the player login is not needed at all',()=>{
  const s=ready({historyKey:'steam',historyOfOthers:true}),r=s.run({FORCE:'true'});
  assert.equal(r.code,0,r.out);assert.equal(s.rows().length,3,r.out);assert.ok(!auths(s).includes('player'),r.out);
});
test('Epic being down keeps the stored logins; a revoked login is removed with a clear message',()=>{
  const s=ready();s.edit(w=>{w.epicDown=true;});let r=s.run({FORCE:'true'});
  assert.equal(r.code,1);assert.match(r.out,/Epic unreachable/);
  s.edit(w=>{w.epicDown=false;});r=s.run({FORCE:'true'});assert.equal(r.code,0,r.out);assert.equal(s.rows().length,3);
  s.edit(w=>{w.accounts.player.revoked=true;});r=s.run({FORCE:'true'});
  assert.equal(r.code,1);assert.match(r.out,/player: login expired/);assert.doesNotMatch(fs.readFileSync(path.join(s.dir,'store/logins.json'),'utf8'),/"player"/);
});
