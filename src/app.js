import {PLAYERS,MODES,aggregate,pairInfo,fromBallchasing,mergeReplays,validateSummary,trackerRanks} from './analysis.js';
import {trackerDefaultRanks,showTrackerSnapshot} from './tracker-ui.js';
import {fetchSharedLibrary,publishSummary} from './shared-library.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=0)=>v===null||v===undefined||!Number.isFinite(v)?'—':new Intl.NumberFormat('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d}).format(v);
const minutes=s=>{if(!Number.isFinite(s))return '—';const value=Math.round(s);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;};
const modeName=id=>MODES.find(m=>m.id===id)?.name??({doubles:'Doubles',duels:'Duels',other:'Other / private'}[id]??id);
const dateLabel=r=>{if(!r.date)return 'No date';const d=new Date(r.date.replace(' ','T'));return isNaN(d)?r.date.slice(0,10):new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);};
let state={replays:[],ranks:{},season:'',coverage:{},view:'together',scope:'together',mode:'all',tableMode:'all',period:'all',search:'',page:0},currentAggregate;
let stored=[],importing=false,aborted=false,activeWorker=null,db;
const pageSize=8;
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),error?11000:6500);}
async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('duoq-lab',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbRead(key){if(!db)return null;return new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbWrite(key,value){if(!db)throw Error('Local storage is unavailable. Export your data before closing this page.');return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function saveImports(){try{await dbWrite('replays',stored);}catch(e){toast(e.message,true);}}
function filtered(){return state.replays.filter(r=>{if(state.mode!=='all'&&r.mode!==state.mode)return false;if(state.period!=='all'){const d=new Date(r.date?.replace(' ','T'));if(!Number.isFinite(+d)||Date.now()-d>Number(state.period)*86400000)return false;}return true;});}
function pairValues(a,b,unit='',digits=0){return `<span class="kate-text">${fmt(a,digits)}${a===null?'':unit}</span><small>/</small><span class="player-text">${fmt(b,digits)}${b===null?'':unit}</span>`;}
function render(){
  const a=aggregate(filtered(),state.view);currentAggregate=a;
  const [k,p]=a.players;
  const title={together:'Matches on the same team only',solo:'One player’s games · the other was not in the match',overall:'All available games · together, solo and against each other'}[state.view];
  $('#view-description').textContent=title;
  $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-selected',b.dataset.view===state.view);});
  const stat=(icon,label,value,foot)=>`<article class="stat-card"><div class="stat-top"><span>${icon}</span>${label==='Winrate'?'Winrate · captured sample':label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
  $('#headline-stats').innerHTML=stat('◫',state.view==='together'?'Shared games':'Games in this view',fmt(a.shared.length),`<span class="kate-text">Kate ${fmt(k.games)}</span> · <span class="player-text">P L 4 Y E R ${fmt(p.games)}</span> · captured matches`)+stat('↗','Winrate',state.view==='together'?`${fmt(k.winRate,1)}<small>%</small>`:`<div class="stat-dual">${pairValues(k.winRate,p.winRate,'%',1)}</div>`,state.view==='together'?`${fmt(k.wins)} wins · ${fmt(k.losses)} losses · ${fmt(k.draws)} draws`:`<span class="kate-text">K ${k.wins}W / ${k.losses}L</span> · <span class="player-text">P ${p.wins}W / ${p.losses}L</span>`)+stat('ϟ','Boost stolen',`<div class="stat-dual">${pairValues(k.boostGames?k.boostStolen:null,p.boostGames?p.boostStolen:null)}</div>`,`Boost points · <span class="kate-text">Kate</span> / <span class="player-text">P L 4 Y E R</span>`)+stat('⇄','Bumps between you',a.coverage?`${fmt(a.pairBumps[0]+a.pairBumps[1])}<small>estimated</small>`:'—',a.coverage?`${a.coverage} replays with movement analysis`:state.view==='solo'?'Not applicable in Solo':'Replay files needed for bump analysis');
  $('#bump-values').innerHTML=`<div class="kate-text">${fmt(a.pairBumps[0])}<small>KATE → PLAYER</small></div><div class="player-text">${fmt(a.pairBumps[1])}<small>PLAYER → KATE</small></div>`;
  const bumpSum=(a.pairBumps[0]??0)+(a.pairBumps[1]??0);
  $('#bump-track').innerHTML=a.coverage?`<i style="width:${bumpSum?100*a.pairBumps[0]/bumpSum:50}%"></i><i style="flex:1"></i>`:'';
  $('#bump-note').textContent=a.coverage?`Estimated from movement · ${a.coverage} encounters with bump data. Demos are counted separately.`:state.view==='solo'?'The other player was absent in Solo games. No bumps between these two can occur.':'Ballchasing does not provide ordinary bumps between specific players. Local replay files add this analysis.';
  $('#bump-events-button').disabled=!a.coverage;
  const metric=(label,x,y,unit='',digits=0)=>{const sum=(x??0)+(y??0);return `<div class="comparison-metric"><div class="metric-label">${label}</div><div class="metric-numbers"><span class="kate-text">${fmt(x,digits)} <small>${unit}</small></span><span class="player-text">${fmt(y,digits)} <small>${unit}</small></span></div><div class="metric-bars"><i style="width:${sum?100*x/sum:50}%"></i><i style="flex:1"></i></div></div>`;};
  $('#boost-comparison').innerHTML=metric('Boost stolen · opponent’s half',k.boostGames?k.boostStolen:null,p.boostGames?p.boostStolen:null,'points')+metric('Boost collected per minute',k.bpm,p.bpm,'BPM')+metric('Stolen large / small pads',k.boostGames?k.bigStolen:null,p.boostGames?p.bigStolen:null,'large pads')+`<div class="metric-small"><span class="kate-text">K ${fmt(k.boostGames?k.smallStolen:null)} small pads</span><span class="player-text">P ${fmt(p.boostGames?p.smallStolen:null)} small pads</span></div><p class="metric-coverage">Reliable boost data: Kate ${k.boostGames}/${k.games} · PLAYER ${p.boostGames}/${p.games} matches. Missing live data and flagged packet loss are excluded.</p>`;
  $('#speed-comparison').innerHTML=metric('Average speed · weighted by tracked playtime',k.avgSpeed,p.avgSpeed,'uu/s')+metric('Time at supersonic speed',k.superPct,p.superPct,'%',1)+metric('Time in the air',k.airPct,p.airPct,'%',1);
  $('#additional-stats').innerHTML=[['Goals','goals'],['Assists','assists'],['Shots','shots'],['Saves','saves'],['Demos','demos']].map(([label,key])=>`<div><h4>${label}</h4><div class="pair-value">${pairValues(k.games?k[key]:null,p.games?p[key]:null)}</div></div>`).join('');
  $('#nav-count').textContent=fmt(state.replays.length);
  const checked=state.coverage.checkedAt?new Date(state.coverage.checkedAt):null;
  $('#data-date').textContent=`${state.replays.length} matches · ${checked?'Dataset checked '+new Intl.DateTimeFormat('en-GB').format(checked):'local snapshot'}`;
  renderRanks();renderChart(a);renderTable();renderSnatches(a);
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
    return `<tr><td><span class="result"><span class="result-label ${resultClass}">${result}</span><span class="score">${score.join(' : ')}${r.source==='live'&&!r.capture?.finalSnapshot?' *':''}</span></span></td><td><strong>${esc(modeName(r.mode))}</strong><small>${esc(subtitle)}${r.boostWarning?' · limited boost data':''}</small></td><td>${esc(dateLabel(r))}<small>${r.dateTimezone==='replay-local'?'Replay time':'Source date'}</small></td><td>${minutes(r.duration)}</td><td><span class="source-label ${r.source==='local'?'local':''}"><i></i>${r.source==='live'?'LIVE LOGGER':r.community?'COMMUNITY':r.source==='local'?'LOCAL ANALYSIS':'BALLCHASING'}</span></td><td><button class="icon-button replay-detail" data-id="${esc(r.id)}" aria-label="Replay details ${esc(dateLabel(r))}">↗</button></td></tr>`;
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
  const eligible=a.shared.filter(r=>pairInfo(r).together&&['complete','partial'].includes(r.snatches?.status));
  const count=eligible.reduce((s,r)=>s+(r.snatches.directions?.[PLAYERS[0].id]?.observedCount??0),0);
  card.innerHTML=`<div class="snatch-icon">ϟ</div><div><div class="eyebrow">THE BOOST TAX · JUST FOR FUN</div><h3>Kate's boost tax</h3><p>A small contribution to Kate’s boost fund · estimated.</p></div><div class="snatch-value"><strong>${eligible.length?'≥ '+fmt(count):'—'}</strong><small>${eligible.length?`observed · ${eligible.length} partly covered games`:'Shared games only'}</small></div><button class="icon-button" id="snatch-info" aria-label="About the boost tax estimate">ⓘ</button>`;
  $('#snatch-info').onclick=()=>showContent("Kate's boost tax",`<p>A playful estimate: Kate collects a reported boost pad while PLAYER has less than 50 boost, is within 800 uu of the pad and is driving towards it above 300 uu/s (directional alignment above 0.6). Vehicle samples must be no more than 0.15 seconds old.</p><p>At least ${fmt(count)} situations in ${eligible.length} partly covered games in this view. Unresolved pad geometry and missing states remain unknown. Hoops geometry is currently excluded; Dropshot has no regular pads and is not applicable.</p><p>This does not prove intent or that the pad belonged to PLAYER. It is separate from the regular boost stolen statistic.</p><div class="event-list">${eligible.flatMap(r=>(r.snatches.directions?.[PLAYERS[0].id]?.events??[]).map(e=>`<div class="event-line"><span>${esc(dateLabel(r))} · ${minutes(e.time)}</span><small>PLAYER ${fmt(e.teammateBoostPercent)} Boost · ${fmt(e.teammateDistance)} uu away</small></div>`)).join('')}</div>`);
}
function showContent(title,html){$('#detail-title').textContent=title;$('#detail-body').innerHTML=html;$('#detail-dialog').showModal();}
function showReplay(r){
  if(!r)return;
  const players=PLAYERS.map(base=>{const p=r.players.find(p=>p.id===base.id);if(!p)return `<div class="detail-player"><strong style="color:${base.color}">${esc(base.name)}</strong><p>Not in this match.</p></div>`;return `<div class="detail-player"><strong style="color:${base.color}">${esc(base.name)}</strong>${[['Goals / assists',`${fmt(p.goals)} / ${fmt(p.assists)}`],['Shots / saves',`${fmt(p.shots)} / ${fmt(p.saves)}`],['Average speed',`${fmt(p.tracked?p.speedIntegral/p.tracked:null)} uu/s`],['Boost stolen',`${fmt(p.boostStolen)} points`],['Demos',fmt(p.demos)]].map(([l,v])=>`<div class="detail-stat"><span>${l}</span><b>${v}</b></div>`).join('')}</div>`;}).join('');
  showContent(`${modeName(r.mode)} · ${dateLabel(r)}`,`<p>${r.score.join(' : ')} · ${minutes(r.duration)} analysed playtime · ${pairInfo(r).together?'Same team':pairInfo(r).both?'Against each other':'Solo game'}</p>${r.source==='live'?'<div class="warning-inline">Captured by the manual Rocket League logger. Movement, boost, bumps and playtime are unavailable; they are not counted as zero. '+(r.capture?.finalSnapshot?'':'Final scoreboard not received; the score and counters are the last observed values. The winner is confirmed. ')+''+(r.capture?.rosterComplete?'':'Capture started mid-match; an unconfirmed one-player roster is excluded from Solo.')+'</div>':''}${r.boostWarning?'<div class="warning-inline">The source reports packet loss. These boost values are excluded from the boost comparison.</div>':''}<div class="detail-stats">${players}</div><h3>Bumps between you</h3>${r.bumpAvailable?bumpList(r.bumps):'<p>No player-to-player bump data from this source. A local replay file can add the analysis.</p>'}<p class="tiny">${esc(r.parser??'Ballchasing')} · Match ID ${esc(r.id)}${r.dateTimezone==='replay-local'?' · replay date has no timezone':''}</p>${r.sourceUrl?`<a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">Open replay on Ballchasing ↗</a>`:''}`);
}
function bumpList(events){return events.length?`<div class="event-list">${events.map(e=>`<div class="event-line"><span>${esc(PLAYERS.find(p=>p.id===e.from)?.name??e.from)} → ${esc(PLAYERS.find(p=>p.id===e.to)?.name??e.to)}</span><small>${e.date?esc(e.date)+' · ':''}${minutes(e.time)} replay time · ${fmt(e.confidence*100)}% model confidence</small></div>`).join('')}</div><p class="tiny">Estimated from proximity, approach speed and impulse. May miss bumps or assign them incorrectly.</p>`:'<p>No bumps detected between these two players.</p>';}
function showMethod(){showContent('The numbers, explained.',`<h3>Three views</h3><ul><li><b>Together:</b> both Steam IDs on the same team.</li><li><b>Solo:</b> exactly one target player in the replay; the other was not in the match.</li><li><b>Overall:</b> all available games for either player, including games against each other. Each player has their own sample and winrate.</li></ul><h3>What the numbers mean</h3><ul><li>Winrate = wins divided by analysed games in the selected view. Draws stay in the denominator. Saved replays may favour memorable or successful games.</li><li>Speed is weighted by tracked playtime, in Unreal Units per second. The regular top speed is 2,300 uu/s.</li><li>Boost stolen means boost collected in the opponent’s half. It is not assigned to a particular teammate. Large / small pads and collected amounts are derived from replay events.</li><li>The parser estimates bumps from vehicle movement. Demos are separate. Bump timestamps follow the replay file timeline.</li><li>The boost tax is a separate, playful heuristic. The card’s information button explains the criteria.</li><li>Games are counted by match GUID, with replay ID as a fallback. Local movement analysis replaces the same game’s public record.</li></ul><h3>Manual live logger</h3><p>Live matches use the official local Rocket League Game Data API. The logger is started manually, reads only that local socket, and publishes completed target-player summaries. No account login or replay file is needed. Movement and boost values stay unknown. Matches first seen mid-game are not classified as Solo unless roster coverage is complete. A later replay upgrades the same Match GUID without double counting.</p><h3>Sources & coverage</h3><p>${esc($('#coverage-note').textContent)}</p><p>Tracker snapshot captured 18 Nov 2026; browser refresh required. Tracker groups sessions and lacks teammate IDs / complete losses. Exact shared winrate comes from the verified replay sample. Manual entries and JSON imports retain their source and season. MMR gaps require a matching period.</p><p>Original files are parsed locally. With public sharing enabled, compact results are stored in the shared library and visible to all visitors. Unshared imports and manual ranks stay in this browser. Exports include results and ranks; clearing browser data does not remove public entries. The initial dataset is also public.</p><p><a href="https://github.com/rlrml/subtr-actor" target="_blank" rel="noreferrer">Replay parser: subtr-actor 1.5.1 (MIT)</a> · <a href="https://ballchasing.com/doc/api" target="_blank" rel="noreferrer">Ballchasing API</a></p>`);}
async function addRows(rows){
  rows=rows.map(r=>({...r,players:r.players.filter(p=>PLAYERS.some(b=>b.id===p.id)),bumps:r.bumps.filter(e=>PLAYERS.some(b=>b.id===e.from)&&PLAYERS.some(b=>b.id===e.to))}));
  stored=mergeReplays(stored,rows);state.replays=mergeReplays(state.replays,rows);await saveImports();render();
  if($('#share-publicly').checked){
    for(const row of rows){try{const shared=await publishSummary(row);state.replays=mergeReplays(state.replays,[shared]);stored=mergeReplays(stored,[shared]);$('#library-status').textContent='Public library synced · visible to all visitors';}catch(error){$('#library-status').textContent=`Saved in this browser · public sync failed: ${error.message}`;$('#retry-share').hidden=false;}}
    await saveImports();render();
  }
}
async function importJSON(file){const raw=JSON.parse(await file.text());if(raw.kind==='duoq-lab-backup'){
  if(!Array.isArray(raw.replays)||raw.replays.length>10000)throw Error('Invalid backup.');
  const rows=raw.replays.map(validateSummary);await addRows(rows);
  if(raw.ranks&&typeof raw.ranks==='object'){state.ranks=cleanRanks(raw.ranks);state.season=String(raw.season??'').slice(0,60);await dbWrite('ranks',{ranks:state.ranks,season:state.season});render();}
  return rows.length;
}const array=Array.isArray(raw)?raw:[raw];const rows=array.map(r=>r.schema===1?validateSummary(r):fromBallchasing(r)).filter(r=>r.players.some(p=>PLAYERS.some(b=>b.id===p.id)));await addRows(rows);return rows.length;}
function cleanRanks(raw){const ranks={};for(const base of PLAYERS){ranks[base.id]={};for(const m of MODES){const r=raw[base.id]?.[m.id];if(!r)continue;if(!Number.isFinite(r.mmr)||r.mmr<0||r.mmr>5000)throw Error('Invalid MMR in backup.');ranks[base.id][m.id]={mmr:r.mmr,tier:String(r.tier??'').slice(0,60),division:String(r.division??'').slice(0,30),season:String(r.season??'').slice(0,60),source:r.source==='tracker-import'?'tracker-import':'manual',updatedAt:String(r.updatedAt??'').slice(0,30)};}}return ranks;}
function parseFile(file,hash){return new Promise(async(resolve,reject)=>{const worker=new Worker(new URL('./parser.worker.js',import.meta.url),{type:'module'});activeWorker=worker;const timer=setTimeout(()=>{worker.terminate();reject(Error('Replay analysis timed out.'));},180000);const finish=()=>{clearTimeout(timer);worker.terminate();if(activeWorker===worker)activeWorker=null;};worker.onmessage=({data})=>{if(data.type==='progress')$('#progress-detail').textContent=data.message;if(data.type==='result'){finish();resolve(data.result);}if(data.type==='skip'){finish();resolve(null);}if(data.type==='error'){finish();reject(Error(data.message));}};worker.onerror=e=>{finish();reject(Error(e.message||'The replay worker could not be loaded.'));};const bytes=await file.arrayBuffer();worker.postMessage({bytes,name:file.name,hash},[bytes]);parseFile.cancel=()=>{finish();resolve(null);};});}
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
function setSettingsTab(tab){$$('[data-settings]').forEach(b=>b.classList.toggle('active',b.dataset.settings===tab));$('#ranks-settings').hidden=tab!=='ranks';$('#data-settings').hidden=tab!=='data';}
$$('.upload-trigger').forEach(b=>b.onclick=()=>$('#replay-files').click());
$('#folder-button').onclick=()=>$('#folder-files').click();$('#replay-files').onchange=e=>importFiles(e.target.files);$('#folder-files').onchange=e=>importFiles(e.target.files);
$('#cancel-import').onclick=()=>{aborted=true;parseFile.cancel?.();};
const drop=$('#drop-zone');drop.onclick=()=>$('#replay-files').click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#replay-files').click();}};drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragover');};drop.ondragleave=()=>drop.classList.remove('dragover');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragover');importFiles(e.dataTransfer.files);};
$('#retry-share').onclick=async()=>{const pending=stored.filter(r=>!r.community);if(!pending.length){$('#retry-share').hidden=true;return;}await addRows(pending);};
$$('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;state.scope=state.view==='together'?'together':state.view==='solo'?'solo':'all';state.page=0;updateScopeTabs();render();});
$('#stats-mode-filter').onchange=e=>{state.mode=e.target.value;state.page=0;render();};$('#period-filter').onchange=e=>{state.period=e.target.value;state.page=0;render();};$('#mode-filter').onchange=e=>{state.tableMode=e.target.value;state.page=0;renderTable();};$('#replay-search').oninput=e=>{state.search=e.target.value.toLowerCase();state.page=0;renderTable();};
function updateScopeTabs(){$$('[data-scope]').forEach(b=>{b.classList.toggle('active',b.dataset.scope===state.scope);b.setAttribute('aria-selected',b.dataset.scope===state.scope);});}
const soloTab=document.createElement('button');soloTab.textContent='Solo';soloTab.dataset.scope='solo';soloTab.setAttribute('role','tab');$('.tabs').insertBefore(soloTab,$('[data-scope="against"]'));$('[data-scope="all"]').textContent='All';
$$('[data-scope]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scope;state.page=0;updateScopeTabs();renderTable();});$('#prev-page').onclick=()=>{state.page--;renderTable();};$('#next-page').onclick=()=>{state.page++;renderTable();};
$('#settings-button').onclick=()=>showSettings('data');$('#edit-ranks').onclick=()=>showSettings('ranks');$$('[data-settings]').forEach(b=>b.onclick=()=>setSettingsTab(b.dataset.settings));
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#method-button').onclick=showMethod;$$('.method-trigger').forEach(b=>b.onclick=showMethod);
$('#bump-events-button').onclick=()=>{const events=currentAggregate.shared.filter(r=>r.bumpAvailable&&pairInfo(r).both).flatMap(r=>r.bumps.map(e=>({...e,date:dateLabel(r)})));showContent('Bumps in this selection',`<p>${events.length} estimated bumps between these two players.</p>${bumpList(events)}`);};
$('#export-button').onclick=downloadBackup;$('#backup-button').onclick=downloadBackup;$('#import-json-button').onclick=()=>$('#replay-files').click();
$('#rank-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),season=$('#rank-season').value.trim();const ranks={};for(const p of PLAYERS){ranks[p.id]={};for(const m of MODES){const mmr=f.get(`${p.id}-${m.id}-mmr`);if(mmr==='')continue;const value=Number(mmr);if(!Number.isFinite(value)||value<0||value>5000){toast('Enter a valid MMR.',true);return;}ranks[p.id][m.id]={mmr:value,tier:String(f.get(`${p.id}-${m.id}-tier`)??''),division:'',season,source:'manual',updatedAt:new Date().toISOString()};}}state.ranks=ranks;state.season=season;try{await dbWrite('ranks',{ranks,season});toast('Ranks saved.');$('#settings-dialog').close();render();}catch(e){toast(e.message,true);}};
$('#tracker-import').onclick=async()=>{try{const id=$('#tracker-player').value;const ranks=trackerRanks(JSON.parse($('#tracker-json').value),id);state.ranks[id]=ranks;await dbWrite('ranks',{ranks:state.ranks,season:state.season});$('#tracker-json').value='';toast('Tracker ranks imported.');$('#settings-dialog').close();render();}catch(e){toast(e.message,true);}};
$('#reset-button').onclick=()=>{showContent('Reset local data?',`<p>Your browser imports and manually entered ranks will be removed. Already published shared-library records remain public. Use Export first if you would like a backup.</p><button class="button danger" id="confirm-reset">Reset now</button>`);$('#confirm-reset').onclick=async()=>{await dbWrite('replays',[]);await dbWrite('ranks',{ranks:{},season:''});stored=[];state.ranks=state.tracker?trackerDefaultRanks(state.tracker):{};state.season=state.tracker?.season??'';state.replays=await fetch('./data/seed.json').then(r=>r.json());$('#detail-dialog').close();$('#settings-dialog').close();render();toast('Local data reset.');};};
$$('[data-nav]').forEach(a=>a.onclick=()=>{$$('[data-nav]').forEach(b=>b.classList.toggle('active',a===b));$('#page-name').textContent=a.textContent.trim().replace(/[◫⇄▷♜0-9]/g,'').trim();});
window.addEventListener('beforeunload',e=>{if(importing){e.preventDefault();e.returnValue='';}});
async function boot(){
  try{const [seed,coverage,tracker]=await Promise.all([fetch('./data/seed.json').then(r=>{if(!r.ok)throw Error('The dataset could not be reached.');return r.json();}),fetch('./data/coverage.json').then(r=>r.json()).catch(()=>({})),fetch('./data/tracker.json').then(r=>r.json()).catch(()=>null)]);state.replays=seed.map(validateSummary);state.coverage=coverage;state.tracker=tracker;
    if(tracker){state.ranks=trackerDefaultRanks(tracker);state.season=tracker.season;showTrackerSnapshot(tracker);}
    try{db=await openDB();stored=(await dbRead('replays')??[]).map(validateSummary);const saved=await dbRead('ranks');if(saved?.ranks&&Object.keys(saved.ranks).length){const imported=cleanRanks(saved.ranks);for(const base of PLAYERS)state.ranks[base.id]={...state.ranks[base.id],...imported[base.id]};state.season=saved.season||state.season;}state.replays=mergeReplays(state.replays,stored);}catch(e){toast(`Browser storage is unavailable: ${e.message}`,true);}
    render();
    fetchSharedLibrary().then(rows=>{state.replays=mergeReplays(state.replays,rows);render();$('#library-status').textContent='Public library connected · uploads can be shared with everyone';}).catch(()=>{$('#library-status').textContent='Public library temporarily unavailable · the included dataset and local analysis still work';});
  }catch(e){toast(e.message,true);$('#data-date').textContent='The data could not be loaded.';}
}
boot();
