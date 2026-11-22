import {showTrackerResults} from './tracker-results.js';
import {showRankHistory} from './rank-history.js';
import {PLAYERS,MODES,aggregate,pairInfo,fromBallchasing,mergeReplays,validateSummary,trackerRanks,tierName} from './analysis.js';
import {trackerDefaultRanks,showTrackerSnapshot} from './tracker-ui.js';
import {fetchStore,identity,seal,publish} from './store.js';
import {MatchCollector,SOCKET_URL} from './live.js';
import {$,$$,esc,fmt,pairValues,showContent,toast} from './ui.js';
const day=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
const minutes=s=>{if(!Number.isFinite(s))return '—';const value=Math.round(s);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;};
const modeName=id=>MODES.find(m=>m.id===id)?.name??({doubles:'Doubles',duels:'Duels',other:'Other / private'}[id]??id);
const dateLabel=r=>{if(!r.date)return 'No date';const d=new Date(r.date.replace(' ','T'));return isNaN(d)?r.date.slice(0,10):day.format(d);};
let state={replays:[],ranks:{},season:'',coverage:{},view:'together',scope:'together',mode:'all',tableMode:'all',period:'all',search:'',page:0},currentAggregate;
let renderTrackerResults=null;
let stored=[],importing=false,aborted=false,activeWorker=null,db;
const pageSize=8;
async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('duoq-lab',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbRead(key){if(!db)return null;return new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbWrite(key,value){if(!db)throw Error('Local storage is unavailable. Export your data before closing this page.');return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function saveImports(){try{await dbWrite('replays',stored);}catch(e){toast(e.message,true);}}
function filtered(){return state.replays.filter(r=>{if(state.mode!=='all'&&r.mode!==state.mode)return false;if(state.period!=='all'){const d=new Date(r.date?.replace(' ','T'));if(!Number.isFinite(+d)||Date.now()-d>Number(state.period)*86400000)return false;}return true;});}
function render(){
  const a=aggregate(filtered(),state.view);currentAggregate=a;
  const [k,p]=a.players;
  const title={together:'Matches on the same team only',solo:'One player’s games · the other was not in the match',overall:'All available games · together, solo and against each other'}[state.view];
  $('#view-description').textContent=title;
  $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-selected',b.dataset.view===state.view);});
  const stat=(icon,label,value,foot)=>`<article class="stat-card"><div class="stat-top"><span>${icon}</span>${label==='Winrate'?'Winrate · captured sample':label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
  $('#headline-stats').innerHTML=stat('◫',state.view==='together'?'Shared games':'Games in this view',fmt(a.shared.length),`<span class="kate-text">Kate ${fmt(k.games)}</span> · <span class="player-text">P L 4 Y E R ${fmt(p.games)}</span> · captured matches`)+stat('↗','Winrate',state.view==='together'?`${fmt(k.winRate,1)}<small>%</small>`:`<div class="stat-dual">${pairValues(k.winRate,p.winRate,'%',1)}</div>`,state.view==='together'?`${fmt(k.wins)} wins · ${fmt(k.losses)} losses · ${fmt(k.draws)} draws`:`<span class="kate-text">K ${k.wins}W / ${k.losses}L</span> · <span class="player-text">P ${p.wins}W / ${p.losses}L</span>`)+stat('ϟ','Boost stolen',`<div class="stat-dual">${pairValues(k.stealGames?k.boostStolen:null,p.stealGames?p.boostStolen:null)}</div>`,k.stealGames||p.stealGames?`Boost denied to opponents · ${Math.max(k.stealGames,p.stealGames)} analysed matches`:'Re-import replays to analyse steals')+stat('⇄','Bumps between you',a.coverage?`${fmt(a.pairBumps[0]+a.pairBumps[1])}<small>estimated</small>`:'—',a.coverage?`${a.coverage} replays with movement analysis`:state.view==='solo'?'Not applicable in Solo':'Replay files needed for bump analysis');
  $('#bump-values').innerHTML=`<div class="kate-text">${fmt(a.pairBumps[0])}<small>KATE → PLAYER</small></div><div class="player-text">${fmt(a.pairBumps[1])}<small>PLAYER → KATE</small></div>`;
  const bumpSum=(a.pairBumps[0]??0)+(a.pairBumps[1]??0);
  $('#bump-track').innerHTML=a.coverage?`<i style="width:${bumpSum?100*a.pairBumps[0]/bumpSum:50}%"></i><i style="flex:1"></i>`:'';
  $('#bump-note').textContent=a.coverage?`Estimated from movement · ${a.coverage} encounters with bump data. Demos are counted separately.`:state.view==='solo'?'The other player was absent in Solo games. No bumps between these two can occur.':'Bumps need replay files. Import replays to add this analysis.';
  $('#bump-events-button').disabled=!a.coverage;
  const metric=(label,x,y,unit='',digits=0)=>{if(!Number.isFinite(x)&&!Number.isFinite(y))return '';const sum=(x??0)+(y??0);return `<div class="comparison-metric"><div class="metric-label">${label}</div><div class="metric-numbers"><span class="kate-text">${fmt(x,digits)} <small>${unit}</small></span><span class="player-text">${fmt(y,digits)} <small>${unit}</small></span></div><div class="metric-bars"><i style="width:${sum?100*x/sum:50}%"></i><i style="flex:1"></i></div></div>`;};
  $('#boost-comparison').innerHTML=metric('Boost stolen · denied to opponents',k.stealGames?k.boostStolen:null,p.stealGames?p.boostStolen:null,'points')+metric('Stolen large pads',k.stealGames?k.bigStolen:null,p.stealGames?p.bigStolen:null,'large')+metric('Taken from each other while having more boost',k.stealGames?k.taxed:null,p.stealGames?p.taxed:null,'points')+metric('Boost collected per minute',k.bpm,p.bpm,'BPM')+(k.stealGames||p.stealGames?`<div class="metric-small"><span class="kate-text">K ${fmt(k.stealGames?k.smallStolen:null)} small pads stolen</span><span class="player-text">P ${fmt(p.stealGames?p.smallStolen:null)} small pads stolen</span></div>`:'')+`<p class="metric-coverage">Steal analysis: Kate ${k.stealGames}/${k.games} · PLAYER ${p.stealGames}/${p.games} matches.${k.oldGames||p.oldGames?` Older rows only know pickups on the opponent’s side (K ${fmt(k.oldStolen)} / P ${fmt(p.oldStolen)}); re-import those replays to analyse them.`:''}</p>`;
  $('#speed-comparison').innerHTML=metric('Average speed · weighted by tracked playtime',k.avgSpeed,p.avgSpeed,'uu/s')+metric('Time at supersonic speed',k.superPct,p.superPct,'%',1)+metric('Time in the air',k.airPct,p.airPct,'%',1);
  $('#additional-stats').innerHTML=[['Goals','goals'],['Assists','assists'],['Shots','shots'],['Saves','saves'],['Demos','demos']].map(([label,key])=>`<div><h4>${label}</h4><div class="pair-value">${pairValues(k.games?k[key]:null,p.games?p[key]:null)}</div></div>`).join('');
  $('#nav-count').textContent=fmt(state.replays.length);
  const checked=state.coverage.checkedAt?new Date(state.coverage.checkedAt):null;
  $('#data-date').textContent=`${state.replays.length} matches · ${checked?'Dataset checked '+new Intl.DateTimeFormat('en-GB').format(checked):'local snapshot'}`;
  renderRanks();renderChart(a);renderTable();renderSnatches(a);renderHabits(a);renderTrackerResults?.(state);
}
function renderRanks(){
  const symbols=['◈','⇄','◎','⬡','❄','ϟ'];
  $('#rank-rows').innerHTML=MODES.map((m,i)=>{
    const pair=PLAYERS.map(p=>state.ranks[p.id]?.[m.id]);
    const compatible=pair.every(Boolean)&&pair[0].season&&pair[0].season===pair[1].season;
    const gap=compatible?pair[0].mmr-pair[1].mmr:null;
    return `<div class="rank-row"><div class="rank-mode"><span class="mode-icon">${symbols[i]}</span><span>${m.name}<small>${m.sub}</small></span></div>${pair.map((r,j)=>`<div class="rank-number ${j?'player-text':'kate-text'}">${r?`<strong>${esc(r.tier||'Rank unknown')}</strong><small>${fmt(r.mmr)} MMR ${esc(r.division||'')}</small>`:`<strong>—</strong><small>No rank data</small>`}</div>`).join('')}<div class="rank-gap">${gap===null?'—':`${gap>0?'+':''}${fmt(gap)}`}<small>${gap===null?'UNAVAILABLE':gap>0?'KATE AHEAD':gap<0?'PLAYER AHEAD':'TIED'}</small></div></div>`;
  }).join('');
  const all=Object.values(state.ranks).flatMap(Object.values);
  $('#rank-source').textContent=all.length?`Tracker snapshot / manual overrides · ${state.season||'season recorded per entry'} · independent of the replay filter`:'Tracker snapshot · 18 Nov 2026 · browser refresh required';
}
function renderChart(a){
  const rows=a.shared.filter(r=>r.players.some(p=>p.tracked>0&&Number.isFinite(p.speedIntegral))).sort((x,y)=>String(x.date).localeCompare(String(y.date))).slice(-36);
  $('#chart-count').textContent=`${rows.length} REPLAYS`;
  if(!rows.length){$('#speed-chart').innerHTML='<div class="chart-empty">No movement data in this view.</div>';return;}
  const w=900,h=190,left=50,right=26,top=16,bottom=32;
  const x=i=>left+(w-left-right)*(rows.length===1?.5:i/(rows.length-1));
  const y=v=>h-bottom-(v/2300)*(h-bottom-top);
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Average speed by replay, Kate and PLAYER"><defs><linearGradient id="chartfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b5a0ff" stop-opacity=".12"/><stop offset="100%" stop-color="#b5a0ff" stop-opacity="0"/></linearGradient></defs>`;
  for(const v of [0,800,1600,2300])svg+=`<line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" stroke="#2c3340" stroke-dasharray="3 5"/><text x="${left-10}" y="${y(v)+3}" fill="#677687" text-anchor="end" font-size="8">${v}</text>`;
  for(const [index,base] of PLAYERS.entries()){
    let segments=[],segment=[];
    rows.forEach((r,i)=>{const p=r.players.find(p=>p.id===base.id);if(p?.tracked){segment.push([x(i),y(p.speedIntegral/p.tracked),r]);}else if(segment.length){segments.push(segment);segment=[];}});if(segment.length)segments.push(segment);
    for(const points of segments){if(!index&&points.length>1)svg+=`<path d="M ${points.map(p=>p.slice(0,2).join(',')).join(' L ')} L ${points.at(-1)[0]},${h-bottom} L ${points[0][0]},${h-bottom} Z" fill="url(#chartfill)"/>`;svg+=`<polyline fill="none" stroke="${base.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${points.map(p=>p.slice(0,2).join(',')).join(' ')}"/>`;for(const point of points)svg+=`<circle cx="${point[0]}" cy="${point[1]}" r="2.3" fill="${base.color}"><title>${esc(base.name)} · ${esc(dateLabel(point[2]))} · ${fmt((h-bottom-point[1])/(h-bottom-top)*2300)} uu/s</title></circle>`;}
  }
  const labels=[...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])];for(const i of labels)svg+=`<text x="${x(i)}" y="${h-12}" fill="#68798a" text-anchor="middle" font-size="8">${esc(dateLabel(rows[i]))}</text>`;
  $('#speed-chart').innerHTML=svg+'</svg>';
}
function tableRows(){return filtered().filter(r=>{const p=pairInfo(r);if(state.scope==='together'&&!p.together)return false;if(state.scope==='against'&&(!p.both||p.together))return false;if(state.scope==='all'&&!p.pair.some(Boolean))return false;if(state.scope==='solo'&&(p.both||!p.pair.some(Boolean)))return false;if(state.tableMode!=='all'&&r.mode!==state.tableMode)return false;return !state.search||`${r.title} ${r.id} ${modeName(r.mode)} ${r.date} ${r.players.map(p=>p.name).join(' ')}`.toLowerCase().includes(state.search);});}
function renderTable(){
  const rows=tableRows(),pages=Math.max(1,Math.ceil(rows.length/pageSize));state.page=Math.min(state.page,pages-1);
  $('#replay-count').textContent=rows.length;
  $('#replay-rows').innerHTML=rows.slice(state.page*pageSize,(state.page+1)*pageSize).map(r=>{
    const info=pairInfo(r),own=info.pair[0]??info.pair[1],score=own?[r.score[own.team],r.score[1-own.team]]:r.score;
    const result=info.both&&!info.together?'VS':[0,1].includes(r.winnerTeam)?r.winnerTeam===own.team?'W':'L':score[0]>score[1]?'W':score[0]<score[1]?'L':'D';
    const resultClass=result==='L'?'loss':result==='W'?'win':'draw';
    const subtitle=info.together?'Kate + P L 4 Y E R':info.both?'Kate vs P L 4 Y E R':own?.name;
    return `<tr><td><span class="result"><span class="result-label ${resultClass}">${result}</span><span class="score">${score.join(' : ')}${r.source==='live'&&!r.capture?.finalSnapshot?' *':''}</span></span></td><td><strong>${esc(modeName(r.mode))}</strong><small>${esc(subtitle)}${r.boostWarning?' · limited boost data':''}</small></td><td>${esc(dateLabel(r))}<small>${r.dateTimezone==='replay-local'?'Replay time':r.dateTimezone==='day'?'Day only':'Source date'}</small></td><td>${minutes(r.duration)}</td><td><span class="source-label ${r.source==='local'?'local':''}"><i></i>${({live:'LIVE TAB',epic:r.rule===2?'EPIC REPLAY':'EPIC HISTORY',local:'LOCAL ANALYSIS'})[r.source]??'BALLCHASING'}</span></td><td><button class="icon-button replay-detail" data-id="${esc(r.id)}" aria-label="Replay details ${esc(dateLabel(r))}">↗</button></td></tr>`;
  }).join('')||'<tr class="empty-table"><td colspan="6">No replays match these filters.</td></tr>';
  $('#table-summary').textContent=rows.length?`${state.page*pageSize+1}–${Math.min((state.page+1)*pageSize,rows.length)} of ${rows.length} replays`:'0 replays';
  $('#page-number').textContent=`${state.page+1} / ${pages}`;$('#prev-page').disabled=state.page===0;$('#next-page').disabled=state.page+1>=pages;
  const c=state.coverage;
  $('#coverage-note').textContent=`Dataset: ${c.localFiles??0} local files checked; ${c.metadataErrors??0} could not be fully read and ${c.analysisErrors??0} analysis errors. Plus ${c.publicSample??0} public sample replays. Unique match IDs prevent double counting. This is the available replay sample, not a complete account history.`;
  $$('.replay-detail').forEach(b=>b.addEventListener('click',()=>showReplay(state.replays.find(r=>r.id===b.dataset.id))));
}
function renderSnatches(a){
  let card=$('#snatch-card');
  if(!card){card=document.createElement('article');card.id='snatch-card';card.className='snatch-card';$('.workspace-grid').after(card);}
  const kate=PLAYERS[0].id,rows=a.shared.filter(r=>pairInfo(r).together),fresh=rows.filter(r=>r.rule===2&&['complete','partial'].includes(r.boost?.status)),old=rows.filter(r=>r.rule!==2&&['complete','partial'].includes(r.snatches?.status));
  const events=fresh.flatMap(r=>(r.boost.tax?.[kate]??[]).map(e=>({...e,row:r}))),count=events.length+old.reduce((s,r)=>s+(r.snatches.directions?.[kate]?.observedCount??0),0),games=fresh.length+old.length;
  card.innerHTML=`<div class="snatch-icon">ϟ</div><div><div class="eyebrow">THE BOOST TAX · JUST FOR FUN</div><h3>Kate's boost tax</h3><p>Pads Kate took from PLAYER while holding more boost than him.</p></div><div class="snatch-value"><strong>${games?fmt(count):'—'}</strong><small>${games?`${games} shared games analysed`:'Shared games only'}</small></div><button class="icon-button" id="snatch-info" aria-label="About the boost tax">ⓘ</button>`;
  $('#snatch-info').onclick=()=>showContent("Kate's boost tax",`<p>Counted when Kate takes a pad and PLAYER then drives over the empty pad before it respawns, or was under a second from reaching it, and Kate had more boost than he did. The amount is what he would have gained.</p><p>${fmt(count)} in ${games} games. Standard maps only; ${old.length} older games still use the previous rule (within 800 uu, under 50 boost).</p><div class="event-list">${events.map(e=>`<div class="event-line"><span>${esc(dateLabel(e.row))} · ${e.pad} pad · ${e.how==='arrived'?'he arrived at the empty pad':'he was about to reach it'}</span><small>Kate ${fmt(e.takerBoost)} boost · PLAYER ${fmt(e.theirBoost)} · cost him ${fmt(e.amount)}</small></div>`).join('')}</div>`);
}
function renderHabits(a){
  let card=$('#habits-card');
  if(!card){card=document.createElement('article');card.id='habits-card';card.className='panel additional-stats';$('.comparison-section').append(card);}
  const [k,p]=a.habits,row=(label,key,digits=1,unit='')=>`<div><h4>${label}</h4><div class="pair-value">${pairValues(k[key],p[key],unit,digits)}</div></div>`,first=r=>r.games?`${r.wins}/${r.games} won`:'—';
  card.innerHTML=k.games||p.games?row('Whiffs / game','whiffs')+row('Beaten to the ball / game','beaten')+row('50/50s won','fiftyPct',0,'%')+row('Kickoffs taken / game','kickoffs')+row('Passes to the other / game','passes')+row('Time as first man','firstManPct',0,'%')+(k.dropshotGames||p.dropshotGames?row('Dropshot damage / game','dropshot',0):'')+`<div><h4>Scored first / conceded first</h4><div class="pair-value">${first(a.scoredFirst)}<small>/</small>${first(a.concededFirst)}</div></div><p class="metric-coverage">Tendencies from ${Math.max(k.games,p.games)} analysed matches in this view. Under about 30 games these are anecdotes, not coaching.</p>`:'<p class="metric-coverage">Tendencies appear once replays are analysed with the current version.</p>';
}
function showReplay(r){
  if(!r)return;
  const players=PLAYERS.map(base=>{const p=r.players.find(p=>p.id===base.id);if(!p)return `<div class="detail-player"><strong style="color:${base.color}">${esc(base.name)}</strong><p>Not in this match.</p></div>`;return `<div class="detail-player"><strong style="color:${base.color}">${esc(base.name)}</strong>${[['Goals / assists',`${fmt(p.goals)} / ${fmt(p.assists)}`],['Shots / saves',`${fmt(p.shots)} / ${fmt(p.saves)}`],['Average speed',`${fmt(p.tracked?p.speedIntegral/p.tracked:null)} uu/s`],['Boost stolen',`${fmt(p.boostStolen)} points`],['Demos',fmt(p.demos)]].map(([l,v])=>`<div class="detail-stat"><span>${l}</span><b>${v}</b></div>`).join('')}</div>`;}).join('');
  showContent(`${modeName(r.mode)} · ${dateLabel(r)}`,`<p>${r.score.join(' : ')} · ${minutes(r.duration)} analysed playtime · ${pairInfo(r).together?'Same team':pairInfo(r).both?'Against each other':'Solo game'}</p>${r.source==='live'?'<div class="warning-inline">Captured live in the browser tab. Steals, bumps and playtime need the replay; speed and boost are only present for your own team. '+(r.capture?.finalSnapshot?'':'Final scoreboard not received; the score and counters are the last observed values. The winner is confirmed. ')+''+(r.capture?.rosterComplete?'':'Capture started mid-match; an unconfirmed one-player roster is excluded from Solo.')+'</div>':''}${r.boostWarning?'<div class="warning-inline">The source reports packet loss. These boost values are excluded from the boost comparison.</div>':''}<div class="detail-stats">${players}</div><h3>Bumps between you</h3>${r.bumpAvailable?bumpList(r.bumps):'<p>No player-to-player bump data from this source. A local replay file can add the analysis.</p>'}<p class="tiny">${esc(r.parser??'Ballchasing')} · Match ID ${esc(r.id)}${r.dateTimezone==='replay-local'?' · replay date has no timezone':''}</p>${r.sourceUrl?`<a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">Open replay on Ballchasing ↗</a>`:''}`);
}
function bumpList(events){return events.length?`<div class="event-list">${events.map(e=>`<div class="event-line"><span>${esc(PLAYERS.find(p=>p.id===e.from)?.name??e.from)} → ${esc(PLAYERS.find(p=>p.id===e.to)?.name??e.to)}</span><small>${e.date?esc(e.date)+' · ':''}${minutes(e.time)} replay time · ${fmt(e.confidence*100)}% model confidence</small></div>`).join('')}</div><p class="tiny">Estimated from proximity, approach speed and impulse. May miss bumps or assign them incorrectly.</p>`:'<p>No bumps detected between these two players.</p>';}
function showMethod(){showContent('The numbers, explained.',`<ul><li><b>Together / Solo / Overall:</b> both on one team, exactly one of you in the match, or every match of either player.</li><li><b>Winrate:</b> wins divided by captured games in the view; draws stay in the denominator.</li><li><b>Boost stolen:</b> boost you denied an opponent. Counted when you take a pad and an opponent then drives over the empty pad before it respawns, or was under a second from reaching it. The amount is what that car would have gained (pad value, capped by its free tank). Standard maps, replay data only.</li><li><b>Boost tax:</b> the same test against your teammate, counted only when the taker had more boost.</li><li><b>Bumps:</b> estimated by the replay parser from car movement. Demos are separate.</li><li><b>Tendencies:</b> counts from the replay parser (whiffs, 50/50s, kickoffs, passes, first-man time). Small samples; read them as anecdotes.</li><li><b>Speed:</b> weighted by tracked playtime, in uu/s. Top speed is 2,300.</li></ul><h3>Where matches come from</h3><ul><li><b>Replay files</b> you import, analysed in your browser.</li><li><b>Daily job:</b> once a night, only while the account is offline, it reads the last 20 matches from Rocket League’s match history and analyses their replays.</li><li><b>Live tab:</b> results and own-team speed and boost while this page is open during a match.</li></ul><p>Shared results carry the day only, no time. ${esc($('#coverage-note').textContent)}</p><p><a href="https://github.com/rlrml/subtr-actor" target="_blank" rel="noreferrer">Replay parser: subtr-actor 1.5.1 (MIT)</a></p>`);}
const outbox={ids:()=>{try{return JSON.parse(localStorage.getItem('duoq.outbox')??'[]');}catch{return [];}},set:ids=>localStorage.setItem('duoq.outbox',JSON.stringify([...new Set(ids)].slice(-500)))};
async function share(rows){
  if(!$('#share-publicly').checked)return;
  const list=rows.filter(r=>!$('#duo-only').checked||pairInfo(r).both);if(!list.length)return;
  try{const me=await identity();let sent=0;for(const row of list){if(await publish(await seal(row,me.secret)))sent++;outbox.set([...outbox.ids(),row.id]);}
    $('#library-status').textContent=sent?`${sent} result${sent>1?'s':''} sent · appears after the next daily run`:'No relay reachable · will retry on the next visit';
  }catch(error){$('#library-status').textContent=`Saved in this browser · sharing failed: ${error.message}`;}
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
    }catch(e){errors.push(`${file.name}: ${String(e.message??e)}`);}
    finally{$('#progress-bar').value=i+1;}
  }
  importing=false;$('#import-progress').hidden=true;$('#replay-files').value='';$('#folder-files').value='';
  toast(`${aborted?'Cancelled. ':''}${imported} replays imported · ${skipped} without target players / already imported · ${errors.length} errors.`,errors.length>0);
  if(errors.length)showContent('Import results',`<p>${imported} replays imported. Successful imports remain saved.</p><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`);
}
function downloadBackup(){const data={kind:'duoq-lab-backup',version:1,exportedAt:new Date().toISOString(),replays:state.replays,ranks:state.ranks,season:state.season};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`duoq-lab-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function showSettings(tab='ranks'){
  $('#rank-season').value=state.season;
  $('#rank-fields').innerHTML=MODES.map(m=>`<div class="rank-input-row"><strong>${m.name}</strong>${PLAYERS.map((p,i)=>{const r=state.ranks[p.id]?.[m.id];return `<div><label class="${i?'player-text':'kate-text'}">${esc(p.name)}<input type="number" min="0" max="5000" step="1" name="${p.id}-${m.id}-mmr" placeholder="MMR" value="${r?.mmr??''}"></label><input name="${p.id}-${m.id}-tier" aria-label="${esc(p.name)} ${m.name} rank" placeholder="Rank, e.g. Champion I" maxlength="60" value="${esc(r?.tier??'')}"></div>`;}).join('')}</div>`).join('');
  setSettingsTab(tab);$('#settings-dialog').showModal();
}
function setSettingsTab(tab){$$('[data-settings]').forEach(b=>b.classList.toggle('active',b.dataset.settings===tab));$('#ranks-settings').hidden=tab!=='ranks';$('#data-settings').hidden=tab!=='data';if(tab==='data')showKey();}
// The signing library is only needed here and when sharing, so it is not loaded at startup.
function showKey(){showKey=()=>{};identity().then(async me=>{$('#share-key').textContent=me.key;const keys=await fetch('./data/keys.json').then(r=>r.json()).catch(()=>({}));$('#key-status').textContent=keys[me.key]?'· approved':'· not approved yet';}).catch(()=>{});}
$$('.upload-trigger').forEach(b=>b.onclick=()=>$('#replay-files').click());
$('#folder-button').onclick=async()=>{
  if(!window.showDirectoryPicker)return $('#folder-files').click();
  try{let folder=await dbRead('folder');if(!folder||await folder.requestPermission({mode:'read'})!=='granted'){folder=await showDirectoryPicker({id:'duoq-replays',mode:'read'});await dbWrite('folder',folder);}
    const since=await dbRead('folderSync')??0,files=[];for await(const entry of folder.values())if(entry.kind==='file'&&/\.replay$/i.test(entry.name)){const file=await entry.getFile();if(file.lastModified>since)files.push(file);}
    if(!files.length)return toast('No new replays in that folder.');
    await importFiles(files);await dbWrite('folderSync',Date.now());
  }catch(e){if(e.name!=='AbortError')toast(e.message,true);}
};
let liveSocket=null;
function live(on){
  const status=$('#live-status'),top=$('#live-top'),say=text=>{status.textContent=text;top.title=text;};
  localStorage.setItem('duoq.live',on?'1':'0');
  $('#live-button').textContent=on?'Stop capture':'Connect to Rocket League';top.classList.toggle('on',on);top.querySelector('span').textContent=on?'Live':'Connect game';
  if(!on){liveSocket?.close();liveSocket=null;say('Not connected.');return;}
  const collector=new MatchCollector({onNotice:say,onSummary:row=>{say(`Captured a match (${row.score.join(' : ')}).`);addRows([row]);}});
  const connect=()=>{
    if(localStorage.getItem('duoq.live')!=='1')return;
    const socket=liveSocket=new WebSocket(SOCKET_URL);let opened=false;
    socket.onopen=()=>{opened=true;say('Connected. Waiting for a match to finish.');};
    socket.onmessage=e=>{if(typeof e.data==='string'&&e.data.length<1048576)try{collector.accept(JSON.parse(e.data));}catch{}};
    socket.onclose=()=>{collector.disconnect();if(liveSocket!==socket)return;say(opened?'Rocket League closed. Waiting for it to start again.':'Rocket League not found. Allow local network access for this site, enable the Stats API (PacketSendRate=10, WebPort=49124) and start the game.');setTimeout(connect,5000);};
  };
  connect();
}
$('#live-button').onclick=$('#live-top').onclick=()=>live(localStorage.getItem('duoq.live')!=='1');
$('#copy-key').onclick=()=>navigator.clipboard.writeText($('#share-key').textContent).then(()=>toast('Key copied. Send it to the repository owner.'));$('#replay-files').onchange=e=>importFiles(e.target.files);$('#folder-files').onchange=e=>importFiles(e.target.files);
$('#cancel-import').onclick=()=>{aborted=true;parseFile.cancel?.();};
const drop=$('#drop-zone');drop.onclick=()=>$('#replay-files').click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#replay-files').click();}};drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragover');};drop.ondragleave=()=>drop.classList.remove('dragover');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragover');importFiles(e.dataTransfer.files);};

$$('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;state.scope=state.view==='together'?'together':state.view==='solo'?'solo':'all';state.page=0;updateScopeTabs();render();});
$('#stats-mode-filter').onchange=e=>{state.mode=e.target.value;state.page=0;render();};$('#period-filter').onchange=e=>{state.period=e.target.value;state.page=0;render();};$('#mode-filter').onchange=e=>{state.tableMode=e.target.value;state.page=0;renderTable();};$('#replay-search').oninput=e=>{state.search=e.target.value.toLowerCase();state.page=0;renderTable();};
function updateScopeTabs(){$$('[data-scope]').forEach(b=>{b.classList.toggle('active',b.dataset.scope===state.scope);b.setAttribute('aria-selected',b.dataset.scope===state.scope);});}
const soloTab=document.createElement('button');soloTab.textContent='Solo';soloTab.dataset.scope='solo';soloTab.setAttribute('role','tab');$('.tabs').insertBefore(soloTab,$('[data-scope="against"]'));$('[data-scope="all"]').textContent='All';
$$('[data-scope]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scope;state.page=0;updateScopeTabs();renderTable();});$('#prev-page').onclick=()=>{state.page--;renderTable();};$('#next-page').onclick=()=>{state.page++;renderTable();};
$('#settings-button').onclick=()=>showSettings('data');$('#edit-ranks').onclick=()=>showSettings('ranks');$$('[data-settings]').forEach(b=>b.onclick=()=>setSettingsTab(b.dataset.settings));
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#method-button').onclick=showMethod;$$('.method-trigger').forEach(b=>b.onclick=showMethod);
$('#bump-events-button').onclick=()=>{const events=currentAggregate.shared.filter(r=>r.bumpAvailable&&pairInfo(r).both).flatMap(r=>r.bumps.map(e=>({...e,date:dateLabel(r)})));showContent('Bumps in this selection',`<p>${events.length} estimated bumps between these two players.</p>${bumpList(events)}`);};
$('#backup-button').onclick=downloadBackup;$('#import-json-button').onclick=()=>$('#replay-files').click();
$('#rank-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),season=$('#rank-season').value.trim();const ranks={};for(const p of PLAYERS){ranks[p.id]={};for(const m of MODES){const mmr=f.get(`${p.id}-${m.id}-mmr`);if(mmr==='')continue;const value=Number(mmr);if(!Number.isFinite(value)||value<0||value>5000){toast('Enter a valid MMR.',true);return;}ranks[p.id][m.id]={mmr:value,tier:String(f.get(`${p.id}-${m.id}-tier`)??''),division:'',season,source:'manual',updatedAt:new Date().toISOString()};}}state.ranks=ranks;state.season=season;try{await dbWrite('ranks',{ranks,season});toast('Ranks saved.');$('#settings-dialog').close();render();}catch(e){toast(e.message,true);}};
$('#tracker-import').onclick=async()=>{try{const id=$('#tracker-player').value;const ranks=trackerRanks(JSON.parse($('#tracker-json').value),id);state.ranks[id]=ranks;await dbWrite('ranks',{ranks:state.ranks,season:state.season});$('#tracker-json').value='';toast('Tracker ranks imported.');$('#settings-dialog').close();render();}catch(e){toast(e.message,true);}};
$('#reset-button').onclick=()=>{showContent('Reset local data?',`<p>Your browser imports and manually entered ranks will be removed. Results already shared stay in the public dataset. Use Export first if you would like a backup.</p><button class="button danger" id="confirm-reset">Reset now</button>`);$('#confirm-reset').onclick=async()=>{await dbWrite('replays',[]);await dbWrite('ranks',{ranks:{},season:''});stored=[];state.ranks=state.tracker?trackerDefaultRanks(state.tracker):{};state.season=state.tracker?.season??'';state.replays=await fetch('./data/seed.json').then(r=>r.json());$('#detail-dialog').close();$('#settings-dialog').close();render();toast('Local data reset.');};};
$$('[data-nav]').forEach(a=>a.onclick=()=>{$$('[data-nav]').forEach(b=>b.classList.toggle('active',a===b));$('#page-name').textContent=a.textContent.trim().replace(/[◫⇄▷♜0-9]/g,'').trim();});
window.addEventListener('beforeunload',e=>{if(importing){e.preventDefault();e.returnValue='';}});
async function boot(){
  try{const [seed,coverage,tracker]=await Promise.all([fetch('./data/seed.json').then(r=>{if(!r.ok)throw Error('The dataset could not be reached.');return r.json();}),fetch('./data/coverage.json').then(r=>r.json()).catch(()=>({})),fetch('./data/tracker.json').then(r=>r.json()).catch(()=>null)]);state.replays=seed.map(validateSummary);state.coverage=coverage;state.tracker=tracker;
    if(tracker){state.ranks=trackerDefaultRanks(tracker);state.season=tracker.season;showTrackerSnapshot(tracker);}
    try{db=await openDB();stored=(await dbRead('replays')??[]).map(validateSummary);const saved=await dbRead('ranks');if(saved?.ranks&&Object.keys(saved.ranks).length){const imported=cleanRanks(saved.ranks);for(const base of PLAYERS)state.ranks[base.id]={...state.ranks[base.id],...imported[base.id]};state.season=saved.season||state.season;}state.replays=mergeReplays(state.replays,stored);}catch(e){toast(`Browser storage is unavailable: ${e.message}`,true);}
    try{const res=await fetch('./data/tracker-results.json');if(res.ok){renderTrackerResults=showTrackerResults(await res.json(),()=>render());state.view='overall';state.scope='all';updateScopeTabs();}}catch{}
    render();if(tracker)showRankHistory(tracker);
    fetchStore().then(rows=>{state.replays=mergeReplays(state.replays,rows);
      for(const r of [...state.replays].reverse())for(const q of r.players)if(q.rank&&MODES.some(m=>m.id===r.mode))(state.ranks[q.id]??={})[r.mode]={mmr:q.rank.mmr,tier:tierName(q.rank.tier),division:`Div ${q.rank.division+1}`,season:'match history',source:'history',updatedAt:r.date};
      render();$('#library-status').textContent='Shared dataset loaded';
      const have=new Set(rows.map(r=>r.id.toUpperCase())),waiting=outbox.ids().filter(id=>!have.has(id.toUpperCase()));outbox.set(waiting);
      share(stored.filter(r=>waiting.includes(r.id)).slice(0,20));
    }).catch(()=>{$('#library-status').textContent='Shared dataset unreachable · the bundled dataset and local analysis still work';});
    if(localStorage.getItem('duoq.live')==='1')live(true);
  }catch(e){toast(e.message,true);$('#data-date').textContent='The data could not be loaded.';}
}
boot();
