import {PLAYERS,MODES,aggregate,pairInfo,fromBallchasing,mergeReplays,validateSummary,trackerRanks,tierName} from './analysis.js';
import {trackerDefaultRanks,trackerResultSummary} from './tracker.js';
import {fetchStore,identity,seal,publish} from './store.js';
import {startRelaySync} from './relay-sync.js';
import {MatchCollector,SOCKET_URL} from './live.js';
import {$,$$,esc,fmt,berlin,showContent,toast,row,line,note,countUp,chart,tooltips,debug,debugTrail} from './ui.js';
addEventListener('error',e=>debug('uncaught',e.error??e.message));
addEventListener('unhandledrejection',e=>debug('uncaught',e.reason));
const [KATE,PLAYER]=PLAYERS,COLOR={[KATE.id]:'var(--kate)',[PLAYER.id]:'var(--player)'};
const day=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}),utcDay=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const minutes=s=>{if(!Number.isFinite(s))return '—';const value=Math.round(s);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;};
const modeName=id=>MODES.find(m=>m.id===id)?.name??({doubles:'Doubles',duels:'Duels',other:'Other / private'}[id]??id);
const dateLabel=r=>{if(!r.date)return 'No date';const d=new Date(r.date.replace(' ','T'));return isNaN(d)?r.date.slice(0,10):day.format(d);};
const span=(start,end)=>{const [a,b]=[start,end].map(d=>new Date(d+'T12:00:00Z')),m=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'});return m.format(a)===m.format(b)?`${a.getUTCDate()}–${b.getUTCDate()} ${m.format(b)}`:`${a.getUTCDate()} ${m.format(a)} – ${b.getUTCDate()} ${m.format(b)}`;};
const state={replays:[],ranks:{},season:'',coverage:{},tracker:null,results:null,history:null,view:'overall',scope:'all',mode:'all',tableMode:'all',period:'all',search:'',page:0,rankMode:'doubles',status:''};
let current,stored=[],relayCache=[],relaySync,sharingBusy=false,importing=false,aborted=false,activeWorker=null,db;
const pageSize=10,rankChart=chart($('#rank-chart')),speedChart=chart($('#speed-chart')),icon=id=>`<svg class="ico"><use href="#i-${id}"/></svg>`;
tooltips();
async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('duoq-lab',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbRead(key){if(!db)return null;return new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbWrite(key,value){if(!db)throw Error('Local storage is unavailable. Export your data before closing this page.');return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function saveImports(){try{await dbWrite('replays',stored);}catch(e){debug('storage',e);toast(e.message,true);}}
function filtered(){return state.replays.filter(r=>{if(state.mode!=='all'&&r.mode!==state.mode)return false;if(state.period!=='all'){const d=new Date(r.date?.replace(' ','T'));if(!Number.isFinite(+d)||Date.now()-d>Number(state.period)*86400000)return false;}return true;});}

function render(){
  const a=current=aggregate(filtered(),state.view),[k,p]=a.players;
  $$('[data-view]').forEach(b=>{b.classList.toggle('on',b.dataset.view===state.view);b.setAttribute('aria-selected',b.dataset.view===state.view);});
  renderHero(k,p);renderResults(a);renderRanks();
  const steals=v=>v.stealGames?v:{};
  $('#boost').innerHTML=row('Stolen',steals(k).boostStolen,steals(p).boostStolen,{tip:'Boost denied to an opponent: you took a pad and an opponent then drove over the empty pad, or was under a second from it. Amount = what they would have gained. Standard maps, replays only.'})
    +row('Large pads stolen',steals(k).bigStolen,steals(p).bigStolen)+row('Small pads stolen',steals(k).smallStolen,steals(p).smallStolen)
    +row('Boost tax',steals(k).taxed,steals(p).taxed,{tip:'Same test against your teammate, counted only when the taker had more boost. Click for the list.',action:'tax'})
    +row('Collected / min',k.bpm,p.bpm,{tip:'Boost collected per minute of tracked play'})
    +(k.stealGames||p.stealGames?note(`Steal analysis ${k.stealGames} / ${p.stealGames} matches`):note(`Stolen and tax: re-import replays to analyse them (0 of ${fmt(Math.max(k.games,p.games))})`,k.oldGames||p.oldGames?`Older rows only know pickups on the opponent's side: ${fmt(k.oldStolen)} / ${fmt(p.oldStolen)}.`:''));
  $('#score').innerHTML=[['Goals','goals'],['Assists','assists'],['Shots','shots'],['Saves','saves'],['Demos','demos']].map(([label,key])=>row(label,k.games?k[key]:null,p.games?p[key]:null,{tip:`Total ${label.toLowerCase()} in this view`})).join('')+row('Bumped the other',a.coverage?a.pairBumps[0]:null,a.coverage?a.pairBumps[1]:null,{action:'bumps',tip:`Estimated from car movement in ${a.coverage} replays; demos are separate. Click for the list. “That was a tactical bump.”`});
  $('#movement').innerHTML=row('Average speed',k.avgSpeed,p.avgSpeed,{unit:' uu/s',tip:'Weighted by tracked playtime. Top speed is 2,300 uu/s.'})+row('Supersonic',k.superPct,p.superPct,{unit:'%',digits:1,tip:'Share of tracked time at supersonic speed'})+row('In the air',k.airPct,p.airPct,{unit:'%',digits:1,tip:'Share of tracked time off the ground and off walls'});
  if(filtered().some(r=>r.players.some(p=>p.speedUnconfirmed)))$('#movement').innerHTML+=note('Some live speeds have an unconfirmed unit and are excluded. Replays can replace these values; choose the source unit in Live capture for future games.');
  renderSpeed(a);
  const [hk,hp]=a.habits;
  $('#habits').innerHTML=hk.games||hp.games?row('Whiffs / game',hk.whiffs,hp.whiffs,{digits:1})+row('Beaten to the ball / game',hk.beaten,hp.beaten,{digits:1})+row('50/50s won',hk.fiftyPct,hp.fiftyPct,{unit:'%',bar:false})+row('Kickoffs taken / game',hk.kickoffs,hp.kickoffs,{digits:1})+row('Passes / game',hk.passes,hp.passes,{digits:1,tip:'Passes to the other player'})+row('First man',hk.firstManPct,hp.firstManPct,{unit:'%',bar:false,tip:'Share of time as the player closest to the ball'})+(hk.dropshotGames||hp.dropshotGames?row('Dropshot damage / game',hk.dropshot,hp.dropshot,{tip:'Floor damage read from the replay network data'}):''):note(`Re-import replays to analyse them (0 of ${fmt(Math.max(k.games,p.games))})`);
  renderTable();renderStatus();
}
const heroTiles=[['life','Lifetime wins'],['season','Season matches'],['games','Games'],['rate','Winrate']];
function renderHero(k,p){
  const box=$('#hero-stats');
  if(!box.children.length)box.innerHTML=heroTiles.map(([id,label])=>`<div class="stat" id="stat-${id}" tabindex="0"><small>${label}</small><div><b class="k"></b><i>/</i><b class="p"></b></div></div>`).join('');
  const t=state.tracker,season=id=>MODES.reduce((s,m)=>s+(t?.profiles[id].ranks[m.id]?.matches??0),0),view={together:'together',solo:'solo',overall:'all'}[state.view];
  const values={life:[t?.profiles[KATE.id].lifetime.wins,t?.profiles[PLAYER.id].lifetime.wins,0,'',`Account totals from Tracker, ${t?berlin.format(new Date(t.capturedAt)):'not loaded'}`],season:[t&&season(KATE.id),t&&season(PLAYER.id),0,'','This season, six ranked playlists, including games without a saved replay (Tracker)'],games:[k.games,p.games,0,'',`Captured matches, ${view} games: replays, the daily job and the live tab`],rate:[k.games?k.winRate:null,p.games?p.winRate:null,1,'%',`Wins per captured game, ${view} games. Draws count as games.`]};
  for(const [id,[kv,pv,digits,unit,tip]] of Object.entries(values)){const el=$(`#stat-${id}`);el.dataset.tip=tip;if(id==='games'||id==='rate')el.querySelector('small').textContent=`${id==='games'?'Games':'Winrate'} · ${state.view}`;for(const [cls,v] of [['k',kv],['p',pv]])countUp(el.querySelector(`.${cls}`),v??NaN,x=>fmt(x,digits)+(Number.isFinite(x)?unit:''));}
}
function renderResults(a){
  const [k,p]=a.players,wl=x=>x.games?`${x.wins}–${x.losses}${x.draws?`–${x.draws}`:''}`:null,first=r=>r.games?`${r.wins} of ${r.games} won`:'—';
  let html=row('W–L',wl(k),wl(p),{text:true,tip:'Captured matches in this view; a third number counts draws'});
  if(a.scoredFirst.games||a.concededFirst.games)html+=line('After scoring first',first(a.scoredFirst),'Your side scored the first goal')+line('After conceding first',first(a.concededFirst),'The opponents scored the first goal');
  const r=state.results;
  if(r){
    const s=PLAYERS.map(x=>trackerResultSummary(r.profiles[x.id],state.mode)),both=f=>s.map(f),rate=x=>x.lower===null?'—':`${fmt(x.lower,0)}–${fmt(x.upper,0)}%`;
    html+=`<h3 tabindex="0" data-tip="Account-wide activity from Tracker, independent of Together / Solo and the date filter. Session times are collection times, so the window is approximate.">Tracker · ${span(r.start,r.end)}</h3>`;
    html+=state.mode==='all'
      ?row('Matches',...both(x=>x.total),{tip:'Every match on the activity calendar, all modes'})+row('Recorded W–L',...both(x=>`${x.wins}–${x.losses}`),{text:true,tip:'Wins and defeats Tracker attributed to single games'})+row('Winrate range',...both(rate),{text:true,tip:'Unresolved games counted as all losses, then all wins. Not a confidence interval.'})+row('Unresolved',...both(x=>x.unknown),{bar:false,tip:'Calendar games without an attributed result'})+row('Mixed-mode wins',...both(x=>x.unassignedWins),{bar:false,tip:'Grouped wins Tracker could not assign to a mode'})
      :row(`W–L · ${modeName(state.mode)}`,...both(x=>`${x.wins}–${x.losses}`),{text:true})+row('Known winrate',...both(x=>x.knownRate),{unit:'%',digits:1,bar:false,tip:'Attributed results only; the calendar has no mode split'})+row('Grouped, no result',...both(x=>x.grouped),{bar:false});
  }
  $('#results').innerHTML=html;
}
function renderRanks(){
  const sel=state.rankMode,cell=(r,cls)=>r?`<b class="${cls}" data-tip="${esc([r.tier,r.division,Number.isFinite(r.matches)?`${fmt(r.matches)} season matches`:'',{history:'from match history',manual:'entered manually','tracker-import':'Tracker import'}[r.source]].filter(Boolean).join(' · '))}">${esc(r.tier||'Unranked')}<small>${fmt(r.mmr)}</small></b>`:`<b class="${cls}">—</b>`;
  $('#rank-rows').innerHTML=MODES.map(m=>{const pair=PLAYERS.map(p=>state.ranks[p.id]?.[m.id]),gap=pair.every(Boolean)&&pair[0].season&&pair[0].season===pair[1].season?pair[0].mmr-pair[1].mmr:null;
    return `<button class="rank-row${m.id===sel?' on':''}" data-mode="${m.id}" aria-pressed="${m.id===sel}"><span>${m.name}<small>${m.sub}</small></span>${cell(pair[0],'k')}${cell(pair[1],'p')}<em class="${gap>0?'k':gap<0?'p':''}" data-tip="MMR gap, same season only">${gap===null?'—':(gap>0?'+':'')+fmt(gap)}</em></button>`;}).join('');
  const h=state.history;
  $('#rank-note').textContent=`${modeName(sel)} MMR`;
  rankChart({label:`${modeName(sel)} MMR history`,time:true,fmtX:t=>utcDay.format(t),fmtY:v=>fmt(v),empty:'No rank history for this mode.',series:PLAYERS.map(p=>({color:COLOR[p.id],points:(h?.profiles[p.id]?.[sel]?.points??[]).map(([d,v])=>[Date.parse(d+'T00:00:00Z'),v])}))});
}
function renderSpeed(a){
  const rows=a.shared.filter(r=>r.players.some(p=>p.tracked>0&&Number.isFinite(p.speedIntegral))).sort((x,y)=>String(x.date).localeCompare(String(y.date))).slice(-36);
  $('#chart-count').textContent=rows.length?`${rows.length} replays`:'';
  speedChart({label:'Average speed by replay',time:false,fmtX:i=>rows[Math.round(i)]?dateLabel(rows[Math.round(i)]):'',fmtY:v=>fmt(v),empty:'No movement data in this view.',series:PLAYERS.map(base=>({color:COLOR[base.id],points:rows.flatMap((r,i)=>{const q=r.players.find(x=>x.id===base.id);return q?.tracked?[[i,q.speedIntegral/q.tracked]]:[];})}))});
}
function renderStatus(){$('#status').textContent=[`${fmt(state.replays.length)} matches`,state.status].filter(Boolean).join(' · ');}
function tableRows(){return filtered().filter(r=>{const p=pairInfo(r);if(state.scope==='together'&&!p.together)return false;if(state.scope==='against'&&(!p.both||p.together))return false;if(state.scope==='all'&&!p.pair.some(Boolean))return false;if(state.scope==='solo'&&(p.both||!p.pair.some(Boolean)))return false;if(state.tableMode!=='all'&&r.mode!==state.tableMode)return false;return !state.search||`${r.title} ${r.id} ${modeName(r.mode)} ${r.date} ${r.players.map(p=>p.name).join(' ')}`.toLowerCase().includes(state.search);});}
// Reactions follow the same W/L result as the score; draws and head-to-head games stay neutral.
function matchReaction(result){
  if(result!=='W'&&result!=='L')return '';
  const win=result==='W',label=win?'Happy Kate celebrates with a cookie':'Kate gives PLAYER a playful post-match kick';
  return `<img class="match-reaction" src="./assets/match-${win?'win':'loss'}.svg" width="72" height="48" alt="${label}" title="${label}" loading="lazy" decoding="async">`;
}
function renderTable(){
  const rows=tableRows(),pages=Math.max(1,Math.ceil(rows.length/pageSize));state.page=Math.min(state.page,pages-1);
  $$('[data-scope]').forEach(b=>{b.classList.toggle('on',b.dataset.scope===state.scope);b.setAttribute('aria-selected',b.dataset.scope===state.scope);});
  $('#replay-count').textContent=fmt(rows.length);
  $('#replay-rows').innerHTML=rows.slice(state.page*pageSize,(state.page+1)*pageSize).map(r=>{
    const info=pairInfo(r),own=info.pair[0]??info.pair[1],score=own?[r.score[own.team],r.score[1-own.team]]:r.score;
    const result=info.both&&!info.together?'VS':[0,1].includes(r.winnerTeam)?r.winnerTeam===own.team?'W':'L':score[0]>score[1]?'W':score[0]<score[1]?'L':'D';
    const who=info.together?'Together':info.both?'Against':own?.id===KATE.id?'Kate':'PLAYER';
    return `<tr><td><span class="match-outcome"><span class="result ${result==='W'?'win':result==='L'?'loss':''}">${result}</span>${matchReaction(result)}<span class="match-score">${score.join(':')}${r.source==='live'&&!r.capture?.finalSnapshot?' *':''}</span></span></td><td>${esc(modeName(r.mode))}<small>${who}${r.boostWarning?' · limited boost data':''}</small></td><td>${esc(dateLabel(r))}</td><td>${minutes(r.duration)}</td><td>${({live:'Live tab',epic:r.rule===2?'Epic replay':'Epic history',local:'Replay'})[r.source]??'Ballchasing'}</td><td><button class="icon replay-detail" data-id="${esc(r.id)}" aria-label="Details ${esc(dateLabel(r))}">${icon('out')}</button></td></tr>`;
  }).join('')||'<tr><td colspan="6" class="empty">No matches for these filters.</td></tr>';
  $('#table-summary').textContent=rows.length?`${state.page*pageSize+1}–${Math.min((state.page+1)*pageSize,rows.length)} of ${rows.length}`:'';
  $('#page-number').textContent=`${state.page+1}/${pages}`;$('#prev-page').disabled=state.page===0;$('#next-page').disabled=state.page+1>=pages;
}
function showReplay(r){
  if(!r)return;
  const players=PLAYERS.map(base=>{const p=r.players.find(p=>p.id===base.id),name=`<strong class="${base===KATE?'k':'p'}">${esc(base.name)}</strong>`;if(!p)return `<div class="detail-player">${name}<p>Not in this match.</p></div>`;return `<div class="detail-player">${name}${[['Goals / assists',`${fmt(p.goals)} / ${fmt(p.assists)}`],['Shots / saves',`${fmt(p.shots)} / ${fmt(p.saves)}`],['Average speed',`${fmt(p.tracked?p.speedIntegral/p.tracked:null)} uu/s`],['Boost stolen',fmt(p.boostStolen)],['Demos',fmt(p.demos)]].map(([l,v])=>`<div class="detail-stat"><span>${l}</span><b>${v}</b></div>`).join('')}</div>`;}).join('');
  showContent(`${modeName(r.mode)} · ${dateLabel(r)}`,`<p>${r.score.join(' : ')} · ${minutes(r.duration)} analysed · ${pairInfo(r).together?'same team':pairInfo(r).both?'against each other':'solo'}</p>${r.source==='live'?'<p class="warning">Captured live: steals, bumps and playtime need the replay; speed and boost only for your own team. '+(r.capture?.finalSnapshot?'':'Final scoreboard not received; counters are the last values seen. ')+(r.capture?.rosterComplete?'':'Capture started mid-match.')+'</p>':''}${r.boostWarning?'<p class="warning">The source reports packet loss; boost values are excluded.</p>':''}<div class="detail-stats">${players}</div><h3>Bumps between you</h3>${r.bumpAvailable?bumpList(r.bumps):'<p>No bump data from this source.</p>'}<p class="muted">${esc(r.parser??'Ballchasing')} · ${esc(r.id)}</p>${r.sourceUrl?`<a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">Open on Ballchasing ↗</a>`:''}`);
}
function bumpList(events){return events.length?`<div class="event-list">${events.map(e=>`<div><span>${esc(PLAYERS.find(p=>p.id===e.from)?.name??e.from)} → ${esc(PLAYERS.find(p=>p.id===e.to)?.name??e.to)}</span><small>${e.date?esc(e.date)+' · ':''}${minutes(e.time)} · ${fmt(e.confidence*100)}% confidence</small></div>`).join('')}</div>`:'<p>No bumps detected between you.</p>';}
function showTax(){
  const rows=current.shared.filter(r=>pairInfo(r).together&&r.rule===2&&['complete','partial'].includes(r.boost?.status));
  const events=PLAYERS.flatMap(base=>rows.flatMap(r=>(r.boost.tax?.[base.id]??[]).map(e=>({...e,base,row:r}))));
  showContent('Boost tax',`<p>${events.length} pads taken from the teammate while holding more boost, in ${rows.length} shared games.</p><div class="event-list">${events.map(e=>`<div><span class="${e.base===KATE?'k':'p'}">${esc(e.base.name)} · ${esc(dateLabel(e.row))} · ${e.pad} pad</span><small>${fmt(e.takerBoost)} vs ${fmt(e.theirBoost)} boost · cost ${fmt(e.amount)}</small></div>`).join('')}</div>`);
}
function showAbout(){
  const t=state.tracker,c=state.coverage;
  showContent('About the data',`<h3>Matches</h3><p>Replay files you import (analysed in this browser), the nightly job (last 20 matches of PLAYER's account, only while he is offline) and the live tab. Shared rows carry the day only. ${fmt(c.localFiles??0)} local files checked, ${fmt(c.metadataErrors??0)} unreadable, plus ${fmt(c.publicSample??0)} public samples. The sample is not a full account history.</p>
<h3>Tracker</h3><p>Ranks, lifetime and season totals are a dated snapshot read from Tracker profiles${t?`, ${berlin.format(new Date(t.capturedAt))}`:''}. Session times there are collection times, rows carry no teammate, so Tracker cannot tell Together from Solo. Lifetime wins cannot be turned into a winrate.</p>
${t?PLAYERS.map(base=>`<h3 class="${base===KATE?'k':'p'}">${esc(base.name)} · recent Tracker sessions <a href="${esc(t.profiles[base.id].source)}" target="_blank" rel="noreferrer">↗</a></h3><div class="event-list">${t.profiles[base.id].recent.map(s=>`<div><span>${esc(s.label)}</span><small>${esc(s.when)}</small></div>`).join('')}</div>`).join(''):''}
<p class="muted">Replay parser: <a href="https://github.com/rlrml/subtr-actor" target="_blank" rel="noreferrer">subtr-actor 1.5.1</a> (MIT). Setup and data flow: <a href="https://github.com/thePl4yer/duoq-lab#readme" target="_blank" rel="noreferrer">README</a>.</p>`);
}
const outbox={ids:()=>{try{return JSON.parse(localStorage.getItem('duoq.outbox')??'[]');}catch(e){debug('outbox',e);return [];}},set:ids=>localStorage.setItem('duoq.outbox',JSON.stringify([...new Set(ids)].slice(-500)))};
async function share(rows){
  if(!$('#share-publicly').checked){toast('Enable Share results before sending saved matches.');return;}
  const list=rows.filter(r=>!$('#duo-only').checked||pairInfo(r).both);if(!list.length)return;
  outbox.set([...outbox.ids(),...list.map(r=>r.id)]);
  if(sharingBusy){state.status='Sharing in progress; additional matches queued.';renderStatus();return;}
  sharingBusy=true;
  try{const me=await identity();let sent=0;for(let i=0;i<list.length;i+=4)await Promise.all(list.slice(i,i+4).map(async row=>{if(await publish(await seal(row,me.secret))){sent++;outbox.set(outbox.ids().filter(id=>id!==row.id));}}));
    state.status=sent?`${sent}/${list.length} shared directly. Trusted browsers sync within about 30 seconds; no collector needed.`:'No relay reachable; pending matches retry on your next visit.';
  }catch(error){debug('share',error);state.status=`saved here, sharing failed: ${error.message}`;}
  finally{sharingBusy=false;}
  renderStatus();
}
async function addRows(rows){
  rows=rows.map(r=>({...r,players:r.players.filter(p=>PLAYERS.some(b=>b.id===p.id)),bumps:r.bumps.filter(e=>PLAYERS.some(b=>b.id===e.from)&&PLAYERS.some(b=>b.id===e.to))}));
  stored=mergeReplays(stored,rows);state.replays=mergeReplays(state.replays,rows);await saveImports();render();await share(rows);
}
async function importJSON(file){const raw=JSON.parse(await file.text());if(raw.kind==='duoq-lab-backup'){
  if(!Array.isArray(raw.replays)||raw.replays.length>10000)throw Error('Invalid backup.');
  const rows=raw.replays.map(validateSummary);await addRows(rows);
  if(raw.ranks&&typeof raw.ranks==='object'){state.ranks=cleanRanks(raw.ranks);state.season=String(raw.season??'').slice(0,60);await dbWrite('ranks',{ranks:state.ranks,season:state.season});render();}
  return rows.length;
}const array=Array.isArray(raw)?raw:[raw];const rows=array.map(r=>r.schema===1?validateSummary(r):fromBallchasing(r)).filter(r=>r.players.some(p=>PLAYERS.some(b=>b.id===p.id)));await addRows(rows);return rows.length;}
function cleanRanks(raw){const ranks={};for(const base of PLAYERS){ranks[base.id]={};for(const m of MODES){const r=raw[base.id]?.[m.id];if(!r)continue;if(!Number.isFinite(r.mmr)||r.mmr<0||r.mmr>5000)throw Error('Invalid MMR in backup.');ranks[base.id][m.id]={mmr:r.mmr,tier:String(r.tier??'').slice(0,60),division:String(r.division??'').slice(0,30),season:String(r.season??'').slice(0,60),source:r.source==='tracker-import'?'tracker-import':'manual',updatedAt:String(r.updatedAt??'').slice(0,30)};}}return ranks;}
function parseFile(file,hash){return new Promise(async(resolve,reject)=>{const worker=new Worker(new URL('./replay.js',import.meta.url),{type:'module'});activeWorker=worker;const timer=setTimeout(()=>{worker.terminate();reject(Error('Replay analysis timed out.'));},180000);const finish=()=>{clearTimeout(timer);worker.terminate();if(activeWorker===worker)activeWorker=null;};worker.onmessage=({data})=>{if(data.type==='progress')$('#progress-detail').textContent=data.message;if(data.type==='result'){finish();resolve(data.result);}if(data.type==='skip'){finish();resolve(null);}if(data.type==='error'){finish();reject(Error(data.message));}};worker.onerror=e=>{finish();reject(Error(e.message||'The replay worker could not be loaded.'));};const bytes=await file.arrayBuffer();worker.postMessage({bytes,name:file.name,hash},[bytes]);parseFile.cancel=()=>{finish();resolve(null);};});}
async function importFiles(fileList){
  if(importing){toast('Analysis is already running.');return;}
  const files=[...fileList].filter(f=>/\.(replay|json)$/i.test(f.name));if(!files.length){toast('Choose .replay files or a JSON backup.',true);return;}
  importing=true;aborted=false;$('#import-progress').hidden=false;$('#progress-bar').max=files.length;$('#progress-bar').value=0;
  let imported=0,skipped=0,errors=[];
  for(const [i,file] of files.entries()){
    if(aborted)break;
    $('#progress-label').textContent=`${i+1} / ${files.length} · ${file.name}`;
    $('#progress-detail').textContent='Checking file …';
    try{
      if(file.size>64*1024*1024)throw Error('File exceeds 64 MB.');
      if(/\.json$/i.test(file.name)){imported+=await importJSON(file);}else{
        const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        if(state.replays.some(r=>r.hash===hash)){skipped++;continue;}
        const result=await parseFile(file,hash);
        if(result){await addRows([result]);imported++;}else skipped++;
      }
    }catch(e){debug('import',file.name,e);errors.push(`${file.name}: ${String(e.message??e)}`);}
    finally{$('#progress-bar').value=i+1;}
  }
  importing=false;$('#import-progress').hidden=true;$('#replay-files').value='';
  toast(`${aborted?'Cancelled. ':''}${imported} imported · ${skipped} without you or already there · ${errors.length} errors.`,errors.length>0);
  if(errors.length)showContent('Import results',`<p>${imported} replays imported. Successful imports stay saved.</p><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`);
}
function downloadBackup(){const data={kind:'duoq-lab-backup',version:1,exportedAt:new Date().toISOString(),replays:state.replays,ranks:state.ranks,season:state.season};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`duoq-lab-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function fillRankForm(){
  $('#rank-season').value=state.season;
  $('#rank-fields').innerHTML=MODES.map(m=>`<div class="rank-input"><span>${m.name}</span>${PLAYERS.map((p,i)=>{const r=state.ranks[p.id]?.[m.id];return `<input class="${i?'p':'k'}" type="number" min="0" max="5000" step="1" name="${p.id}-${m.id}-mmr" placeholder="MMR" aria-label="${esc(p.name)} ${m.name} MMR" value="${r?.mmr??''}"><input name="${p.id}-${m.id}-tier" aria-label="${esc(p.name)} ${m.name} rank" placeholder="Rank" maxlength="60" value="${esc(r?.tier??'')}">`;}).join('')}</div>`).join('');
}
// The signing library is only needed for the key and for sharing, so it is not loaded at startup.
function showKey(){identity().then(me=>{$('#share-key').textContent=me.key;$('#key-status').textContent='public key for direct pairing';}).catch(e=>{debug('key',e);$('#key-status').textContent='unavailable: '+e.message;});}
let liveSocket=null;
function live(on,quiet=false){
  const button=$('#live-button'),say=(text,mode)=>{button.dataset.tip=text;button.dataset.state=mode;button.querySelector('span').textContent=mode==='off'?'Connect game':mode==='wait'?'Waiting':'Live';};
  localStorage.setItem('duoq.live',on?'1':'0');
  if(!on){liveSocket?.close();liveSocket=null;say('Records each online match when it ends, while this tab is open. Older matches come from the nightly job. Setup: Data & settings.','off');return;}
  const collector=new MatchCollector({speedUnit: $('#live-speed-unit').value,
    onNotice:m=>{debug('live',m);say(m,'on');},
    onDebug:(reason,detail)=>detail===undefined?debug('live','ignored:',reason):debug('live','ignored:',reason,detail),
    onSummary:row=>{debug('live','match captured',{score:row.score,players:row.players.length,speed:row.players.some(p=>p.tracked)});say(`Captured a match (${row.score.join(' : ')}). Click to stop.`,'on');toast(`Match captured: ${row.score.join(' : ')}`);addRows([row]).catch(e=>debug('save',e));}});
  let warned=quiet,failures=0;
  const connect=()=>{
    if(localStorage.getItem('duoq.live')!=='1')return;
    if(!failures)debug('live','connecting to',SOCKET_URL);
    let socket;try{socket=liveSocket=new WebSocket(SOCKET_URL);}catch(e){debug('live',e);say(`The browser refused the connection: ${e.message}`,'off');localStorage.setItem('duoq.live','0');return;}
    let opened=false,messages=0,bad=0;
    socket.onopen=()=>{opened=true;failures=0;debug('live','connected');say('Connected. Waiting for a match to finish. Click to stop.','on');};
    socket.onmessage=e=>{
      if(typeof e.data!=='string'||e.data.length>=1048576)return debug('live','message skipped: not text or over 1 MB',typeof e.data==='string'?e.data.length:typeof e.data);
      let message;try{message=JSON.parse(e.data);}catch(error){if(bad++<3)debug('live','message is not JSON',error,e.data.slice(0,120));return;}
      if(!messages++)debug('live','first message',{Event:message?.Event,Data:typeof message?.Data});
      try{collector.accept(message);}catch(error){debug('live','message failed',message?.Event,error);}
    };
    socket.onerror=()=>{if(opened||!failures)debug('live','socket error (nothing listening on port 49124, or the browser blocked local network access)');};
    socket.onclose=e=>{if(opened||!failures++||failures%60===0)debug('live','closed',{code:e.code,reason:e.reason,clean:e.wasClean,opened,messages,attempts:failures});collector.disconnect();if(liveSocket!==socket)return;const text=opened?'Rocket League closed. Waiting for it to start again. Click to stop.':'Rocket League not found. Start it with the Stats API enabled and allow local network access (Data & settings). Click to stop.';say(text,'wait');if(!opened&&!warned){warned=true;toast(text);}setTimeout(connect,5000);};
  };
  say('Connecting …','wait');connect();
}

$('#upload-button').onclick=$('#import-json-button').onclick=()=>$('#replay-files').click();
$('#replay-files').onchange=e=>importFiles(e.target.files);
$('#live-button').onclick=()=>live(localStorage.getItem('duoq.live')!=='1');
try{const saved=localStorage.getItem('duoq.speed-unit');if(['auto','uu','kmh','mph','mps'].includes(saved))$('#live-speed-unit').value=saved;}catch{}
$('#live-speed-unit').onchange=e=>{localStorage.setItem('duoq.speed-unit',e.target.value);toast('Speed unit saved. Takes effect next time you connect to the game.');};
$('#cancel-import').onclick=()=>{aborted=true;parseFile.cancel?.();};
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();document.body.classList.add('dragging');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});
document.addEventListener('drop',e=>{if(!e.dataTransfer?.files.length)return;e.preventDefault();document.body.classList.remove('dragging');importFiles(e.dataTransfer.files);});
$$('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;state.scope={together:'together',solo:'solo'}[state.view]??'all';state.page=0;render();});
$('#stats-mode-filter').onchange=e=>{state.mode=e.target.value;state.page=0;if(MODES.some(m=>m.id===state.mode))state.rankMode=state.mode;render();};
$('#period-filter').onchange=e=>{state.period=e.target.value;state.page=0;render();};
$('#mode-filter').onchange=e=>{state.tableMode=e.target.value;state.page=0;renderTable();};
$('#replay-search').oninput=e=>{state.search=e.target.value.toLowerCase();state.page=0;renderTable();};
$$('[data-scope]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scope;state.page=0;renderTable();});
$('#prev-page').onclick=()=>{state.page--;renderTable();};$('#next-page').onclick=()=>{state.page++;renderTable();};
$('#replay-rows').onclick=e=>{const b=e.target.closest('.replay-detail');if(b)showReplay(state.replays.find(r=>r.id===b.dataset.id));};
$('#rank-rows').onclick=e=>{const b=e.target.closest('[data-mode]');if(b){state.rankMode=b.dataset.mode;renderRanks();}};
$('#boost').onclick=e=>{if(e.target.closest('[data-action="tax"]'))showTax();};
$('#score').onclick=e=>{if(!e.target.closest('[data-action="bumps"]'))return;const events=current.shared.filter(r=>r.bumpAvailable&&pairInfo(r).both).flatMap(r=>r.bumps.map(e=>({...e,date:dateLabel(r)})));showContent('Bumps',`<p>${events.length} estimated bumps between you in this view. Estimated from car movement; may miss or misassign bumps.</p>${bumpList(events)}`);};
$('#about-button').onclick=showAbout;
document.addEventListener('keydown',e=>{const el=e.target.closest?.('[data-action]');if(el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();el.click();}});
const cookieButton = $('#cookie'), cookieBreak = $('#cookie-break'), cookiePreview = $('#cookie-preview');
function showCookie() {
  if (!cookiePreview.hidden) return;
  if (!cookiePreview.src) cookiePreview.src = './assets/cookie-break.mp4';
  cookiePreview.hidden = false;
  const box = cookiePreview.getBoundingClientRect();
  const shift = Math.min(0, window.innerWidth - 8 - box.right) + Math.max(0, 8 - box.left);
  cookiePreview.style.marginLeft = shift + 'px';
  cookieButton.setAttribute('aria-expanded', 'true');
  cookiePreview.play().catch(() => {});
}
function hideCookie() {
  cookiePreview.pause();
  if (cookiePreview.readyState) cookiePreview.currentTime = 0;
  cookiePreview.hidden = true;
  cookiePreview.style.marginLeft = '';
  cookieButton.setAttribute('aria-expanded', 'false');
}
cookieBreak.onpointerenter = e => { if (e.pointerType === 'mouse') showCookie(); };
cookieBreak.onpointerleave = e => { if (e.pointerType === 'mouse') hideCookie(); };
cookieButton.onfocus = () => { if (cookieButton.matches(':focus-visible')) showCookie(); };
cookieButton.onblur = hideCookie;
cookieButton.onclick = e => {
  if (e.pointerType === 'touch' && !cookiePreview.hidden) hideCookie();
  else showCookie();
  toast('Kate took the boost. You get a cookie. Fair trade? 🍪');
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCookie(); });
document.addEventListener('pointerdown', e => { if (!cookiePreview.hidden && !cookieBreak.contains(e.target)) hideCookie(); });
$('#settings').addEventListener('toggle',e=>{if(e.target.open){fillRankForm();showKey();}});
$('#copy-debug').onclick=()=>{const text=`duoq-lab debug log, ${new Date().toISOString()}\n${navigator.userAgent}\n${debugTrail()||'(empty)'}`;navigator.clipboard.writeText(text).then(()=>toast('Debug log copied. Paste it into the chat.'),e=>{debug('clipboard',e);showContent('Debug log',`<pre class="log">${esc(text)}</pre>`);});};
$('#copy-key').onclick=()=>navigator.clipboard.writeText($('#share-key').textContent).then(()=>toast('Public key copied. The other player can trust it in Sharing.'));
for(const id of ['share-publicly','duo-only']){const el=$('#'+id);try{const saved=localStorage.getItem('duoq.pref.'+id);if(saved!==null)el.checked=saved==='1';}catch{}el.onchange=()=>{localStorage.setItem('duoq.pref.'+id,el.checked?'1':'0');toast('Sharing choice saved. Use Share saved matches to send earlier recordings.');};}
$('#backup-button').onclick=downloadBackup;
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#rank-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),season=$('#rank-season').value.trim();const ranks={};for(const p of PLAYERS){ranks[p.id]={};for(const m of MODES){const mmr=f.get(`${p.id}-${m.id}-mmr`);if(mmr==='')continue;const value=Number(mmr);if(!Number.isFinite(value)||value<0||value>5000){toast('Enter a valid MMR.',true);return;}ranks[p.id][m.id]={mmr:value,tier:String(f.get(`${p.id}-${m.id}-tier`)??''),division:'',season,source:'manual',updatedAt:new Date().toISOString()};}}state.ranks=ranks;state.season=season;try{await dbWrite('ranks',{ranks,season});toast('Ranks saved.');render();}catch(e){debug('ranks',e);toast(e.message,true);}};
$('#tracker-import').onclick=async()=>{try{const id=$('#tracker-player').value;const ranks=trackerRanks(JSON.parse($('#tracker-json').value),id);state.ranks[id]=ranks;await dbWrite('ranks',{ranks:state.ranks,season:state.season});$('#tracker-json').value='';toast('Tracker ranks imported.');render();}catch(e){debug('tracker',e);toast(e.message,true);}};
$('#reset-button').onclick=()=>{showContent('Reset local data?',`<p>Removes your browser imports and manual ranks. Shared results stay in the public dataset. Export a backup first if you want one.</p><button class="button danger" id="confirm-reset">Reset now</button>`);$('#confirm-reset').onclick=async()=>{await dbWrite('replays',[]);await dbWrite('ranks',{ranks:{},season:''});stored=[];state.ranks=state.tracker?trackerDefaultRanks(state.tracker):{};state.season=state.tracker?.season??'';state.replays=(await fetch('./data/seed.json').then(r=>r.json())).map(validateSummary);$('#detail-dialog').close();render();toast('Local data reset.');};};
window.addEventListener('beforeunload',e=>{if(importing){e.preventDefault();e.returnValue='';}});
async function boot(){
  try{
    const get=file=>fetch(`./data/${file}`).then(r=>{if(!r.ok)throw Error(`${file} could not be loaded.`);return r.json();});
    const optional=(file,fallback)=>get(file).catch(e=>{debug('boot',e);return fallback;});
    const [seed,coverage,tracker,results,history]=await Promise.all([get('seed.json'),optional('coverage.json',{}),optional('tracker.json',null),optional('tracker-results.json',null),optional('rank-history.json',null)]);
    Object.assign(state,{replays:seed.map(validateSummary),coverage,tracker,results,history});
    if(tracker){state.ranks=trackerDefaultRanks(tracker);state.season=tracker.season;}
    try{db=await openDB();stored=(await dbRead('replays')??[]).map(validateSummary);const saved=await dbRead('ranks');if(saved?.ranks&&Object.keys(saved.ranks).length){const imported=cleanRanks(saved.ranks);for(const base of PLAYERS)state.ranks[base.id]={...state.ranks[base.id],...imported[base.id]};state.season=saved.season||state.season;}state.replays=mergeReplays(state.replays,stored);}catch(e){debug('storage',e);toast(`Browser storage is unavailable: ${e.message}`,true);}
    try{relayCache=(await dbRead('relay-replays')??[]).map(validateSummary);state.replays=mergeReplays(state.replays,relayCache);}catch(e){debug('relay cache',e);}
    state.status='loading shared dataset';render();
    const retry=()=>{if(!sharingBusy&&$('#share-publicly').checked)return share(stored.filter(r=>outbox.ids().includes(r.id)).slice(0,20));};
    relaySync=startRelaySync({onStatus:message=>{state.status=message;renderStatus();},onRows:async rows=>{relayCache=mergeReplays(relayCache,rows);state.replays=mergeReplays(state.replays,rows);try{await dbWrite('relay-replays',relayCache);}catch(e){debug('relay cache',e);}render();},onRetry:retry,onResend:()=>{if(!$('#share-publicly').checked){toast('Enable Share results first.');return;}const list=stored.filter(r=>!$('#duo-only').checked||pairInfo(r).both);outbox.set([...outbox.ids(),...list.map(r=>r.id)]);toast(`${list.length} saved matches queued. Larger backfills continue in batches while this page stays open.`);return retry();}});
    retry();
    fetchStore().then(rows=>{state.replays=mergeReplays(state.replays,rows);
      for(const r of [...state.replays].reverse())for(const q of r.players)if(q.rank&&MODES.some(m=>m.id===r.mode))(state.ranks[q.id]??={})[r.mode]={mmr:q.rank.mmr,tier:tierName(q.rank.tier),division:`Div ${q.rank.division+1}`,season:'match history',source:'history',updatedAt:r.date};
      state.status='shared dataset loaded';render();
    }).catch(e=>{debug('store',e);state.status='shared dataset unreachable, bundled data shown';renderStatus();});
    if(localStorage.getItem('duoq.live')==='1')live(true,true);
  }catch(e){debug('boot',e);toast(e.message,true);$('#status').textContent='The data could not be loaded.';}
}
boot();
