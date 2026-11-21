import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {PLAYERS,publicRow,validateSummary,mergeReplays} from '../src/analysis.js';
import {analyseBoost} from '../src/boost.js';
import * as psynet from '../src/psynet.js';
import {seal,publish,collect,dataUrl} from '../src/store.js';
import {fromHistory,steamState,loginKey,lock,unlock} from '../scripts/collect.mjs';
import {generateSecretKey,getPublicKey} from 'nostr-tools';

const [kate,player]=PLAYERS.map(p=>p.id);
// Minimal WebSocket server: text frames only.
async function wsServer(onSocket,onRequest){
  const server=http.createServer(onRequest??((q,r)=>r.end())),sockets=new Set();
  server.on('upgrade',(request,socket)=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
    const send=text=>{const body=Buffer.from(text),head=body.length<126?Buffer.from([0x81,body.length]):Buffer.from([0x81,126,body.length>>8,body.length&255]);socket.write(Buffer.concat([head,body]));};
    let pending=Buffer.alloc(0);const onText=onSocket(send,request);
    socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);
      while(pending.length>=6){let length=pending[1]&127,offset=2;if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}if(pending.length<offset+4+length)return;
        const mask=pending.subarray(offset,offset+4),body=Buffer.from(pending.subarray(offset+4,offset+4+length)),opcode=pending[0]&15;pending=pending.subarray(offset+4+length);
        if(opcode===8){socket.end();return;}for(let i=0;i<body.length;i++)body[i]^=mask[i&3];if(opcode===1)onText(body.toString());}});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {port:server.address().port,close:()=>new Promise(r=>{for(const s of sockets)s.destroy();server.close(r);})};
}

test('Build id matches the value published for a known game version; signatures are stable',async()=>{
  assert.equal(psynet.buildId('250811.43331.492665'),'151471783');
  assert.equal(await psynet.sign('{}'),await psynet.sign('{}'));assert.notEqual(await psynet.sign('{}'),await psynet.sign('{ }'));
});
test('Game session: signed login, handshake headers, request framing and presence fail closed',async()=>{
  const seen={};
  const server=await wsServer((send,request)=>{seen.handshake=request.headers;return async text=>{
    const [head,body]=text.split('\r\n\r\n'),id=/PsyRequestID: (.+)/.exec(head)[1],service=/PsyService: (.+)/.exec(head)[1];
    seen.signed=/PsySig: (.+)/.exec(head)[1]===await psynet.sign(body);
    const result=service.startsWith('Matches/')?{Matches:[{ReplayUrl:'x',Match:{MatchGUID:'G'}}]}:service.startsWith('Players/')?{PlayerData:JSON.parse(body).PlayerIDs.map(PlayerID=>({PlayerID,PresenceState:seen.presence}))}:null;
    send(`PsyResponseID: ${id}\r\n\r\n`+JSON.stringify(result?{Result:result}:{Error:{Type:'Unknown',Message:service}}));};},
  async(request,response)=>{let body='';for await(const c of request)body+=c;seen.login={sig:request.headers.psysig===await psynet.sign(body),build:request.headers.psybuildid,body:JSON.parse(body)};
    response.end(JSON.stringify({Result:{PerConURLv2:`ws://127.0.0.1:${server.port}`,PsyToken:'tok',SessionID:'sid'}}));});
  const io={...psynet.defaults,fetch:(url,init)=>String(url).includes('raw.githubusercontent')?Promise.resolve(new Response('gameVersion = "250811.43331.492665"\nfeatureSet = "PrimeUpdate55_1"\nbuildSecret = "'+'ab'.repeat(32)+'"')):fetch(`http://127.0.0.1:${server.port}/login`,init)};
  try{
    const rpc=await psynet.connect({access_token:'ticket',account_id:'e'.repeat(32)},io);
    assert.ok(seen.login.sig);assert.equal(seen.login.build,'151471783');assert.equal(seen.login.body.AuthTicket,'ticket');assert.equal(seen.login.body.FeatureSet,'PrimeUpdate55_1');
    assert.equal(seen.handshake.psytoken,'tok');assert.equal(seen.handshake.psysessionid,'sid');assert.ok(Object.values(seen.handshake).some(v=>/^RL Win\/250811/.test(v)));
    assert.deepEqual((await psynet.matchHistory(rpc)).map(m=>m.Match.MatchGUID),['G']);assert.ok(seen.signed);
    seen.presence='Offline';assert.equal(await psynet.anyOnline(rpc,[`Steam|${player}|0`]),false);
    seen.presence='Online';assert.equal(await psynet.anyOnline(rpc,[`Steam|${player}|0`]),true);
    seen.presence=undefined;assert.equal(await psynet.anyOnline(rpc,[`Steam|${player}|0`]),true);
    await assert.rejects(rpc.call('Nope/Nope v1',{}),/Unknown/);rpc.close();
  }finally{await server.close();}
});
test('Shared records are signed, carry the day only, and only approved keys are collected',async()=>{
  const stored=[],relay=await wsServer(send=>text=>{const m=JSON.parse(text);if(m[0]==='EVENT'){stored.push(m[1]);send(JSON.stringify(['OK',m[1].id,true,'']));}if(m[0]==='REQ'){for(const e of stored)send(JSON.stringify(['EVENT',m[1],e]));send(JSON.stringify(['EOSE',m[1]]));}});
  const url=`ws://127.0.0.1:${relay.port}`,mine=generateSecretKey(),stranger=generateSecretKey();
  const row={schema:1,id:'ABC',title:'2026-11-19 22-41-07.replay',hash:'h',importedAt:'2026-11-19T22:45:00Z',date:'2026-11-19 22:41:07',dateTimezone:'replay-local',mode:'doubles',playlist:'11',duration:300,score:[2,1],players:[{id:kate,name:'Kate',team:0,tracked:300,speedIntegral:3e5,supersonic:1,air:1,boostStolen:50,boostCollected:300,boostUsed:null,goals:1,assists:0,saves:0,shots:2,demos:0,bigStolen:0,smallStolen:0}],bumps:[],bumpAvailable:true,source:'local'};
  try{
    const event=await seal(row,mine,'2026-11-20');
    assert.equal(event.created_at,Date.parse('2026-11-20T00:00:00Z')/1000);assert.ok(!event.content.includes('22'));assert.ok(!event.content.includes('.replay'));
    assert.equal(await publish(event,[url,'ws://127.0.0.1:1']),1);
    await publish(await seal({...row,id:'FAKE'},stranger),[url]);stored.push({...event,id:'f'.repeat(64),content:event.content.replace('ABC','TAMPERED')});
    const rows=await collect([getPublicKey(mine)],0,[url]);
    assert.deepEqual(rows.map(r=>r.id),['ABC']);assert.equal(rows[0].date,'2026-11-19');assert.equal(rows[0].hash,undefined);
    assert.deepEqual(await collect([],0,[url]),[]);
  }finally{await relay.close();}
  assert.equal(dataUrl('matches.json',{hostname:'someone.github.io',pathname:'/fork/'}),'https://raw.githubusercontent.com/someone/fork/data/matches.json');
  assert.equal(dataUrl('matches.json',{hostname:'localhost',pathname:'/'}),'https://raw.githubusercontent.com/thePl4yer/duoq-lab/data/matches.json');
});
test('Match history becomes an anonymous day-only box score with rank; logins round-trip encrypted; Steam state fails closed',async()=>{
  const entry={ReplayUrl:'x',Match:{MatchGUID:'abc',RecordStartTimestamp:Date.parse('2026-11-19T22:41:07Z')/1000,Playlist:11,SecondsPlayed:312.4,WinningTeam:1,Team0Score:1,Team1Score:3,Players:[
    {PlayerID:`Steam|${player}|0`,PlayerName:'x',LastTeam:1,Goals:2,Assists:1,Saves:0,Shots:4,Demolishes:1,Skills:{bValid:true,Mu:45.5,Tier:16,Division:2}},
    {PlayerID:'Epic|someone|0',PlayerName:'Stranger',LastTeam:0,Goals:1,Assists:0,Saves:2,Shots:3,Demolishes:0,Skills:{bValid:true,Mu:40,Tier:15,Division:1}}]}};
  const row=validateSummary(fromHistory(entry));
  assert.equal(row.id,'ABC');assert.equal(row.date,'2026-11-19');assert.equal(row.mode,'doubles');assert.equal(row.winnerTeam,1);assert.equal(row.players.length,1);
  assert.deepEqual(row.players[0].rank,{tier:16,division:2,mmr:1010});assert.ok(!JSON.stringify(row).includes('Stranger'));assert.ok(!JSON.stringify(row).includes('22:41'));
  assert.equal(fromHistory({Match:{...entry.Match,Players:[entry.Match.Players[1]]}}),null);
  assert.equal(mergeReplays([row],[{...row,rule:2,bumpAvailable:true,players:[{...row.players[0],rank:undefined}]}])[0].players[0].rank.mmr,1010);
  const key=await loginKey('k'.repeat(32)),box=await lock({refresh_token:'secret-token'},key);
  assert.ok(!JSON.stringify(box).includes('secret-token'));assert.deepEqual(await unlock(box,key),{refresh_token:'secret-token'});
  await assert.rejects(async()=>unlock(box,await loginKey('z'.repeat(32))));await assert.rejects(loginKey('short'));
  assert.equal(steamState('<privacyState>public</privacyState><onlineState>offline</onlineState>'),'offline');
  assert.equal(steamState('<privacyState>public</privacyState><onlineState>in-game</onlineState>'),'online');
  assert.equal(steamState('<privacyState>friendsonly</privacyState><onlineState>offline</onlineState>'),'unknown');assert.equal(steamState('garbage'),'unknown');
  assert.deepEqual(Object.keys(publicRow({id:'a',hash:'h',importedAt:'t',title:'file.replay',date:'2026-11-19 22:41:07'})).sort(),['date','dateTimezone','id','title']);
});
test('Boost steal: an opponent who reaches the empty pad or loses the race is denied; teammate tax needs the taker to hold more boost',()=>{
  const opponent='76561190000000001',times=Array.from({length:400},(_,i)=>i/30),pad={pad_id:'big',size:'Big',position:{x:0,y:0,z:70}},small={pad_id:'small',size:'Small',position:{x:3000,y:0,z:70}};
  const car=(x,y,boost,vx=0,vy=0)=>({Data:{rigid_body:{location:{x,y,z:17},linear_velocity:{x:vx,y:vy,z:0}},boost_amount:boost*2.55}});
  const build=(frames,events)=>({meta:{all_headers:[['MapName','Stadium_P']],game_type:{playlist_id:11},team_zero:[{remote_id:{Steam:kate}},{remote_id:{Steam:player}}],team_one:[{remote_id:{Steam:opponent}}]},boost_pads:[pad,small],frame_data:{metadata_frames:times.map(time=>({time})),players:Object.entries(frames).map(([id,f])=>[{Steam:id},{frames:times.map((t,i)=>f(t,i))}])},boost_pad_events:events.map(([time,id,p])=>({time,pad_id:p.pad_id,player:{Steam:id},player_position:{x:p.position.x,y:p.position.y,z:17},kind:{PickedUp:{sequence:1}}}))});
  // Kate takes the big pad at t=1; the opponent (20 boost) drives over it at t=4, before the 10 s respawn.
  let r=analyseBoost(build({[kate]:()=>car(0,0,30),[player]:()=>car(-4000,3000,100),[opponent]:t=>t>=4&&t<4.2?car(0,0,20):car(2500,2500,20)},[[1,kate,pad]]),[kate,player]);
  assert.equal(r.status,'complete');assert.equal(r.players[kate].steals,1);assert.equal(r.players[kate].big,1);assert.ok(Math.abs(r.players[kate].stolen-80)<.5);
  // A full-boost opponent on the pad loses nothing; one arriving after the respawn was not denied.
  r=analyseBoost(build({[kate]:()=>car(0,0,30),[player]:()=>car(-4000,3000,100),[opponent]:t=>t>=4&&t<4.2?car(0,0,100):car(2500,2500,100)},[[1,kate,pad]]),[kate,player]);assert.equal(r.players[kate].steals,0);
  r=analyseBoost(build({[kate]:()=>car(0,0,30),[player]:()=>car(-4000,3000,100),[opponent]:t=>t>=11.5?car(0,0,20):car(2500,2500,20)},[[1,kate,pad]]),[kate,player]);assert.equal(r.players[kate].steals,0);
  // Race: the opponent is 0.5 s from the small pad at 1500 uu/s when Kate takes it, then turns away.
  r=analyseBoost(build({[kate]:()=>car(3000,0,30),[player]:()=>car(-4000,3000,100),[opponent]:t=>t<=1?car(3000-750-1500*(1-t),0,50,1500,0):car(3000,3000,50)},[[1,kate,small]]),[kate,player]);
  assert.equal(r.players[kate].small,1);assert.equal(r.players[kate].stolen,12);
  // Teammate: Kate (60) takes it, PLAYER (10) arrives -> tax. Kate (5) takes it, PLAYER (40) arrives -> fair, no tax.
  r=analyseBoost(build({[kate]:()=>car(0,0,60),[player]:t=>t>=3&&t<3.2?car(0,0,10):car(2500,2500,10),[opponent]:()=>car(4000,-4000,100)},[[1,kate,pad]]),[kate,player]);
  assert.equal(r.players[kate].taxCount,1);assert.ok(Math.abs(r.players[kate].taxed-90)<.5);assert.equal(r.players[kate].steals,0);assert.equal(r.players[kate].taxEvents[0].how,'arrived');
  r=analyseBoost(build({[kate]:()=>car(0,0,5),[player]:t=>t>=3&&t<3.2?car(0,0,40):car(2500,2500,40),[opponent]:()=>car(4000,-4000,100)},[[1,kate,pad]]),[kate,player]);assert.equal(r.players[kate].taxCount,0);
  // Unknown maps and Dropshot never produce numbers.
  const hoops=build({[kate]:()=>car(0,0,30)},[[1,kate,pad]]);hoops.meta.all_headers=[['MapName','HoopsStadium_P']];assert.equal(analyseBoost(hoops,[kate,player]).status,'unavailable');
});
