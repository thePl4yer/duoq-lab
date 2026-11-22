// Test double for everything the nightly job talks to: Epic login, Rocket League (PsyNet HTTP + WebSocket),
// Steam profile XML and the replay download. Loaded with `node --import ./tests/fake-epic.mjs scripts/collect.mjs`.
// It enforces the protocol (client credentials, PsySig, build id, token rotation) and records every call.
// FAKE_EPIC: path of a JSON world file (read and written back, so token rotation persists between runs).
// FAKE_EPIC_LOG: path of a JSON-lines call log.
import fs from 'node:fs';
import {createHmac} from 'node:crypto';
const file=process.env.FAKE_EPIC,world=JSON.parse(fs.readFileSync(file,'utf8')),save=()=>fs.writeFileSync(file,JSON.stringify(world,null,1));
const log=event=>fs.appendFileSync(process.env.FAKE_EPIC_LOG,JSON.stringify(event)+'\n');
const EOS={id:'xyza7891p5D7s9R6Gm6moTHWGloerp7B',secret:'Knh18du4NVlFs+3uQ+ZPpDCVto0WYf4yXP8+OcwVt1o',deployment:'da32ae9c12ae40e8a112c52e1f17f3ba'};
const SIG_KEY='c338bd36fb8c42b1a431d30add939fc7',BUILD={gameVersion:'270101.11111.600001',featureSet:'PrimeUpdate99_TEST',buildSecret:'ab'.repeat(32)};
const sig=body=>createHmac('sha256',SIG_KEY).update('-'+body).digest('base64');
function buildId(version){const bytes=[];for(const ch of version)bytes.push(ch.charCodeAt(0)&255,ch.charCodeAt(0)>>8&255);let crc=0xFFFFFFFF;for(const b of bytes){crc=(crc^(b<<24))>>>0;for(let i=0;i<8;i++)crc=crc&0x80000000?((crc<<1)^0x04C11DB7)>>>0:(crc<<1)>>>0;}return String((crc^0xFFFFFFFF)|0);}
const reply=(status,body,type='application/json')=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':type}});
const account=id=>Object.values(world.accounts).find(a=>a.account_id===id);
const tokenFor=a=>{a.access=`at-${a.account_id}-${world.seq=(world.seq??0)+1}`;a.refresh=`rt-${a.account_id}-${world.seq}`;save();return {access_token:a.access,refresh_token:a.refresh,account_id:a.account_id,expires_in:7200,refresh_expires_in:28800,token_type:'bearer'};};

async function eos(path,init){
  const form=new URLSearchParams(String(init.body??'')),auth=init.headers?.Authorization;
  if(path==='deviceAuthorization'){
    if(form.get('client_id')!==EOS.id)return reply(400,{errorCode:'errors.com.epicgames.oauth.invalid_client'});
    log({call:'eos.device'});return reply(200,{device_code:'dc-'+world.deviceApproves,user_code:'FAKE1234',verification_uri:'https://www.epicgames.com/activate',verification_uri_complete:'https://www.epicgames.com/activate?userCode=FAKE1234',expires_in:20,interval:1});
  }
  if(auth!=='Basic '+btoa(EOS.id+':'+EOS.secret))return reply(401,{errorCode:'errors.com.epicgames.oauth.invalid_client'});
  if(form.get('deployment_id')!==EOS.deployment||form.get('scope')!=='basic_profile')return reply(400,{errorCode:'errors.com.epicgames.oauth.invalid_request'});
  if(world.epicDown)return reply(503,{errorCode:'errors.com.epicgames.common.server_error'});
  const grant=form.get('grant_type');
  if(grant==='device_code'){const role=form.get('device_code').slice(3);world.polls=(world.polls??0)+1;save();
    if(world.polls<2)return reply(400,{errorCode:'errors.com.epicgames.oauth.authorization_pending'});
    log({call:'eos.device_token',role});return reply(200,tokenFor(world.accounts[role]));}
  if(grant==='refresh_token'){const a=Object.values(world.accounts).find(x=>x.refresh&&x.refresh===form.get('refresh_token'));
    log({call:'eos.refresh',account:a?.role??'unknown'});
    return a&&!a.revoked?reply(200,tokenFor(a)):reply(400,{errorCode:'errors.com.epicgames.account.auth_token.invalid_refresh_token'});}
  return reply(400,{errorCode:'unsupported_grant_type'});
}
async function authPlayer(init){
  const h=init.headers,body=String(init.body);
  const problems=[h.PsySig!==sig(body)&&'PsySig',h.PsyBuildID!==buildId(BUILD.gameVersion)&&'PsyBuildID',h.PsyBuildSecret!==BUILD.buildSecret&&'PsyBuildSecret',!/^RL Win\//.test(h['User-Agent']??'')&&'User-Agent',h.PsyEnvironment!=='Prod'&&'PsyEnvironment',!/^PsyNetMessage_X_\d+$/.test(h.PsyRequestID??'')&&'PsyRequestID'].filter(Boolean);
  const data=JSON.parse(body),a=account(data.EpicAccountID);
  if(data.FeatureSet!==BUILD.featureSet)problems.push('FeatureSet');
  if(!a||a.access!==data.AuthTicket||data.Platform!=='Epic'||data.PlayerID!==a.account_id||data.LocalFirstPlayerID!==`Epic|${a.account_id}|0`)problems.push('ticket');
  log({call:'psynet.auth',account:a?.role,problems,inGame:!!a?.inGame});
  if(problems.length)return reply(200,{Error:{Type:'PlatformAuthError',Message:problems.join(',')}});
  if(a.inGame)log({call:'DUPLICATE_LOGIN',account:a.role});
  return reply(200,{Result:{SessionID:'s-'+a.role,PsyToken:'pt-'+a.role,UseWebSocket:true,PerConURLv2:'wss://ws.fake.psynet/'+a.role}});
}
function rpc(a,service,data){
  if(service==='Players/GetProfile v1'){
    if(world.presenceError)return {Error:{Type:'ServiceUnavailable',Message:'try later'}};
    return {Result:{PlayerData:(data.PlayerIDs??[]).map(id=>({PlayerID:id,PlayerName:'x',PresenceState:world.presence?.[id]??'Offline',PresenceInfo:''}))}};
  }
  if(service==='Matches/GetMatchHistory v1'){
    // The history lives under one identity: the Epic id (default) or the Steam id (historyKey: 'steam').
    const who=data.PlayerID,owner=Object.values(world.accounts).find(x=>`Epic|${x.account_id}|0`===who||x.ids?.includes(who));
    const allowed=owner===a||world.historyOfOthers,holds=world.historyKey==='steam'?owner?.ids?.includes(who):who===`Epic|${owner?.account_id}|0`;
    log({call:'psynet.history',account:a.role,asked:who.split('|')[0],allowed:!!allowed,found:holds?owner.history?.length??0:0});
    if(!allowed)return {Error:{Type:'PermissionDenied',Message:'not your history'}};
    return {Result:{Matches:(holds?owner.history??[]:[]).map(m=>({ReplayUrl:`http://api.rlpp.psynet.gg/Match.replay?MatchGUID=${m.MatchGUID}&Signature=x`,Match:m}))}};
  }
  return {Error:{Type:'UnknownService',Message:service}};
}
class FakeSocket{
  constructor(url,options){this.url=url;this.l={};const role=url.split('/').pop(),a=world.accounts[role],h=options?.headers??{};
    queueMicrotask(()=>{if(!a||h.PsyToken!=='pt-'+role||h.PsySessionID!=='s-'+role||h.PsyBuildID!==buildId(BUILD.gameVersion)){log({call:'ws.reject',role});this.emit('error',{});return;}this.a=a;this.emit('open',{});});}
  addEventListener(type,fn){(this.l[type]??=[]).push(fn);}
  emit(type,e){for(const fn of this.l[type]??[])fn(e);}
  send(text){
    const split=text.indexOf('\r\n\r\n'),head=Object.fromEntries(text.slice(0,split).split('\r\n').map(l=>[l.slice(0,l.indexOf(':')),l.slice(l.indexOf(':')+1).trim()])),body=text.slice(split+4);
    const out=head.PsySig!==sig(body)?{Error:{Type:'InvalidSignature',Message:'PsySig'}}:rpc(this.a,head.PsyService,JSON.parse(body));
    if(world.slowRpc)return;
    setTimeout(()=>this.emit('message',{data:`PsyResponseID: ${head.PsyRequestID}\r\nPsySig: x\r\n\r\n${JSON.stringify(out)}`}),5);
  }
  close(){log({call:'ws.close',role:this.a?.role});this.emit('close',{});}
}
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=String(input),u=new URL(url);
  if(u.host==='api.epicgames.dev')return eos(u.pathname.split('/').pop(),init);
  if(u.host==='raw.githubusercontent.com'&&u.pathname.endsWith('/psynet.go'))return reply(200,`const (\n\tgameVersion  = "${BUILD.gameVersion}"\n\tfeatureSet   = "${BUILD.featureSet}"\n\tbuildSecret  = "${BUILD.buildSecret}"\n)`,'text/plain');
  if(u.host==='api.rlpp.psynet.gg'&&u.pathname==='/rpc/Auth/AuthPlayer/v2')return authPlayer(init);
  if(u.host==='api.rlpp.psynet.gg'&&u.pathname==='/Match.replay'){const guid=u.searchParams.get('MatchGUID'),path=world.replays?.[guid];log({call:'replay',guid,served:!!path});return path?new Response(fs.readFileSync(path)):reply(403,'<html>expired link</html>'.repeat(80),'text/html');}
  if(u.host==='steamcommunity.com'){const id=u.pathname.split('/')[2],s=world.steam?.[id]??{privacy:'public',online:'offline'};log({call:'steam',id});return reply(200,`<?xml version="1.0"?><profile><steamID64>${id}</steamID64><onlineState>${s.online}</onlineState><privacyState>${s.privacy}</privacyState></profile>`,'text/xml');}
  if(u.protocol==='file:')return realFetch(input,init);
  log({call:'UNEXPECTED_FETCH',url});throw TypeError('fake network: '+u.host);
};
globalThis.WebSocket=class{constructor(url,options){if(!String(url).startsWith('wss://ws.fake.psynet/')){log({call:'UNEXPECTED_SOCKET',url});throw Error('fake network');}return new FakeSocket(url,options);}};
