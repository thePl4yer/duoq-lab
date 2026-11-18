import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const packet=value=>{
  const bytes=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(bytes.length<126?2:4);header[0]=0x81;
  if(bytes.length<126)header[1]=bytes.length;else{header[1]=126;header.writeUInt16BE(bytes.length,2);}
  return Buffer.concat([header,bytes]);
};
test('Manual CLI reads the actual loopback WebSocket in dry run and sends no game commands',{timeout:12000},async t=>{
  const server=http.createServer(),sockets=new Set();let child,stdout='',stderr='',applicationData=false;
  const guid='F'.repeat(32);
  server.on('upgrade',(request,socket)=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    socket.on('data',data=>{if([1,2].includes(data[0]&0x0f))applicationData=true;});
    const update={Event:'UpdateState',Data:{MatchGuid:guid,Players:[{PrimaryId:'Steam|76561198060138310|0',TeamNum:0,Goals:2,Assists:1,Saves:3,Shots:5,Demos:0}],Game:{bReplay:false,PlaylistId:11,Teams:[{TeamNum:0,Name:'Blue',Score:2},{TeamNum:1,Name:'Orange',Score:1}]}}};
    for(const message of [{Event:'MatchInitialized',Data:{MatchGuid:guid}},update,{Event:'MatchEnded',Data:{MatchGuid:guid,WinnerTeamNum:0}},update])socket.write(packet(message));
  });
  try{
    const ready=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(49124,'127.0.0.1',resolve);});
    try{await ready;}catch(e){if(e.code==='EADDRINUSE'){t.skip('Rocket League already owns its local API port; live game was not disturbed.');return;}throw e;}
    child=spawn(process.execPath,[fileURLToPath(new URL('../logger/main.mjs',import.meta.url)),'--dry-run'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{clearInterval(poll);reject(Error('No live summary from the CLI. '+stdout+' '+stderr));},8500);
      const poll=setInterval(()=>{if(stdout.includes('"id": "'+guid+'"')){clearTimeout(timer);clearInterval(poll);resolve();}},40);
      child.once('error',e=>{clearTimeout(timer);clearInterval(poll);reject(e);});
    });
    assert.ok(stdout.includes('DRY RUN'));assert.ok(stdout.includes('"source": "live"'));assert.equal(applicationData,false);assert.equal(stderr,'');
  }finally{
    if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
    for(const socket of sockets)socket.destroy();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
  }
});
