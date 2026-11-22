// Epic device login + Rocket League match history. Unofficial protocol, ported from github.com/dank/rlapi (MIT).
// Runs in Node 22+ and in browsers; pass `io` to swap the transport.
const EOS={id:'xyza7891p5D7s9R6Gm6moTHWGloerp7B',secret:'Knh18du4NVlFs+3uQ+ZPpDCVto0WYf4yXP8+OcwVt1o',deployment:'da32ae9c12ae40e8a112c52e1f17f3ba'};
const EOS_URL='https://api.epicgames.dev/epic/oauth/v2/',RPC_URL='https://api.rlpp.psynet.gg/rpc/',SIG_KEY='c338bd36fb8c42b1a431d30add939fc7';
const BUILD_URL='https://raw.githubusercontent.com/dank/rlapi/master/psynet.go';
// The game build changes with every patch; these are only the fallback when the upstream file is unreachable.
const BUILD={gameVersion:'261031.63733.533021',featureSet:'PrimeUpdate60_FFE7A62B41040BB67F8829FD67F2EE8A',buildSecret:'eba094a6fd9abbdf913dcbadf18ab59682671cdcc7cebc4902b81113273f5fa3'};
export const defaults={fetch:(url,init)=>fetch(url,init),socket:(url,headers)=>new WebSocket(url,{headers})};
const text=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));

export function buildId(version){
  let crc=0xFFFFFFFF;
  for(const ch of version)for(const byte of [ch.charCodeAt(0)&255,ch.charCodeAt(0)>>8]){crc^=byte<<24;for(let i=0;i<8;i++)crc=crc&0x80000000?(crc<<1)^0x04C11DB7:crc<<1;}
  return String((crc^0xFFFFFFFF)|0);
}
export async function sign(body){
  const key=await crypto.subtle.importKey('raw',text.encode(SIG_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return b64(await crypto.subtle.sign('HMAC',key,text.encode('-'+body)));
}
export async function buildInfo(io=defaults){
  try{
    const source=await (await io.fetch(BUILD_URL,{signal:AbortSignal.timeout(10000)})).text();
    const pick=(name,pattern)=>new RegExp(name+'\\s*=\\s*"('+pattern+')"').exec(source)?.[1];
    const found={gameVersion:pick('gameVersion','[\\d.]{6,40}'),featureSet:pick('featureSet','\\w{6,80}'),buildSecret:pick('buildSecret','[0-9a-f]{64}')};
    if(Object.values(found).every(Boolean))return found;
  }catch{}
  return BUILD;
}

async function eos(path,params,io,basic=true){
  const response=await io.fetch(EOS_URL+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.19041.1.256.64bit',...(basic?{Authorization:'Basic '+btoa(EOS.id+':'+EOS.secret)}:{})},body:new URLSearchParams(params).toString(),signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>({}));
  return {ok:response.ok,status:response.status,data};
}
const grant=(params,io)=>eos('token',{...params,deployment_id:EOS.deployment,scope:'basic_profile'},io);
// Step 1: returns {user_code, device_code, verification_uri, verification_uri_complete, expires_in, interval}.
export async function deviceStart(io=defaults){
  const r=await eos('deviceAuthorization',{client_id:EOS.id},io,false);
  if(!r.ok||!r.data.device_code)throw Error('Epic refused to start a device login (HTTP '+r.status+').');
  return r.data;
}
// Step 2: null while the user has not approved yet, otherwise the token.
export async function deviceToken(device,io=defaults){
  const r=await grant({grant_type:'device_code',device_code:device.device_code},io);
  return r.ok&&r.data.access_token?r.data:null;
}
export async function refreshToken(refresh,io=defaults){
  const r=await grant({grant_type:'refresh_token',refresh_token:refresh},io);
  if(!r.ok||!r.data.access_token)throw Object.assign(Error(`Epic answered HTTP ${r.status}`),{status:r.status});
  return r.data;
}

// Opens a game session for the token's account. Never call this while that account is in a match: the game gets disconnected.
export async function connect(token,io=defaults){
  const build=await buildInfo(io),id=buildId(build.gameVersion),player='Epic|'+token.account_id+'|0';
  let counter=0;const requestId=()=>'PsyNetMessage_X_'+counter++;
  const body=JSON.stringify({Platform:'Epic',PlayerName:'',PlayerID:token.account_id,Language:'INT',AuthTicket:token.access_token,BuildRegion:'',FeatureSet:build.featureSet,Device:'PC',LocalFirstPlayerID:player,bSkipAuth:false,bSetAsPrimaryAccount:true,EpicAuthTicket:token.access_token,EpicAccountID:token.account_id});
  const response=await io.fetch(RPC_URL+'Auth/AuthPlayer/v2',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':`RL Win/${build.gameVersion} gzip (x86_64-pc-win32) curl-7.67.0 Schannel`,PsyBuildID:id,PsyEnvironment:'Prod',PsyRequestID:requestId(),PsySig:await sign(body),PsyBuildSecret:build.buildSecret},body,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Rocket League login failed (HTTP '+response.status+').');
  const auth=await response.json();
  if(auth.Error||!auth.Result?.PerConURLv2)throw Error('Rocket League login failed: '+(auth.Error?.Type??'no session'));
  const socket=io.socket(auth.Result.PerConURLv2,{PsyBuildID:id,'User-Agent':`RL Win/${build.gameVersion} gzip`,PsyEnvironment:'Prod',PsyToken:auth.Result.PsyToken,PsySessionID:auth.Result.SessionID});
  const pending=new Map();
  const fail=error=>{for(const p of pending.values())p.reject(error);pending.clear();};
  socket.addEventListener('message',event=>{
    const message=String(event.data),split=message.indexOf('\r\n\r\n');
    if(message.startsWith('PsyPong:')||split<0)return;
    const responseId=/^PsyResponseID:\s*(.+)$/m.exec(message.slice(0,split))?.[1]?.trim(),p=pending.get(responseId);
    if(!p)return;pending.delete(responseId);
    try{const data=JSON.parse(message.slice(split+4));data.Error?p.reject(Error(data.Error.Type+': '+data.Error.Message)):p.resolve(data.Result);}catch(e){p.reject(e);}
  });
  socket.addEventListener('close',()=>fail(Error('Rocket League closed the connection.')));
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Rocket League socket failed.')),{once:true});});
  return {player,
    async call(service,data,timeout=15000){
      const request=requestId(),payload=JSON.stringify(data);
      const result=new Promise((resolve,reject)=>{pending.set(request,{resolve,reject});setTimeout(()=>{if(pending.delete(request))reject(Error(service+' timed out.'));},timeout);});
      socket.send(`PsyService: ${service}\r\nPsyRequestID: ${request}\r\nPsySig: ${await sign(payload)}\r\n\r\n${payload}`);
      return result;
    },
    close(){fail(Error('closed'));socket.close();}};
}
// Last 20 matches, each {ReplayUrl, Match:{MatchGUID, Playlist, Players:[…], …}}. Defaults to the logged-in account.
export const matchHistory=async(rpc,playerId=rpc.player)=>(await rpc.call('Matches/GetMatchHistory v1',{PlayerID:playerId})).Matches??[];
// True when Rocket League reports any of the player ids ("Steam|<id>|0") as not offline. Unknown answers count as online.
export async function anyOnline(rpc,ids){
  const rows=(await rpc.call('Players/GetProfile v1',{PlayerIDs:ids})).PlayerData;
  if(!Array.isArray(rows)||rows.length<ids.length)return true;
  return rows.some(r=>!/^(offline|)$/i.test(String(r.PresenceState??'online')));
}
