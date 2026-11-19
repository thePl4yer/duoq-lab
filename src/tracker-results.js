import {PLAYERS,MODES} from './analysis.js';
const modeIds={'Ranked Standard 3v3':'standard','Ranked Doubles 2v2':'doubles',Hoops:'hoops',Dropshot:'dropshot',Snowday:'snowday',Rumble:'rumble',Multiple:'unassigned'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n);
export function trackerResultSummary(profile,mode='all'){
 const total=profile.daily.reduce((n,d)=>n+d.matches,0),buckets={};
 for(const s of profile.sessions){if(!/^\d+ (hours?|days?) ago$/.test(s.relative)||(/days?/.test(s.relative)&&parseInt(s.relative)>6))continue;
  for(const r of s.rows){const id=modeIds[r.playlist]??'unassigned';const b=buckets[id]??={wins:0,losses:0,grouped:0};
   if(/^Win\b/.test(r.result))b.wins++;else if(/^Defeat\b/.test(r.result))b.losses++;else if(/^\d+ Wins\b/.test(r.result))b.wins+=parseInt(r.result);else if(/^\d+ Matches\b/.test(r.result))b.grouped+=parseInt(r.result);
  }
 }
 const sum=key=>Object.values(buckets).reduce((n,b)=>n+b[key],0);
 const b=mode==='all'?{wins:sum('wins'),losses:sum('losses'),grouped:sum('grouped')}:buckets[mode]??{wins:0,losses:0,grouped:0};
 // The activity calendar has no playlist breakdown. Never allocate its remaining games or mixed wins to a mode.
 const denominator=mode==='all'?total:null;
 const valid=total>0&&sum('wins')+sum('losses')<=total;
 return {...b,total,denominator,buckets,unassignedWins:buckets.unassigned?.wins??0,lower:valid&&mode==='all'?100*b.wins/total:null,upper:valid&&mode==='all'?100*(total-b.losses)/total:null,unknown:mode==='all'&&valid?total-b.wins-b.losses:null,knownRate:b.wins+b.losses?100*b.wins/(b.wins+b.losses):null};
}
export function showTrackerResults(data,onChange){
 const section=document.createElement('section');section.id='tracker-results';section.className='tracker-results panel';
 section.innerHTML=`<div class="panel-heading"><div><div class="eyebrow">ACCOUNT ACTIVITY / TRACKER NETWORK</div><h2>Beyond the replay folder.</h2></div><label>Results source<select id="results-source" aria-label="Results source"><option value="tracker">Tracker estimates</option><option value="captured">Captured matches</option></select></label></div><p>Tracker calendar: ${esc(data.start)} to ${esc(data.end)}. Sessions use relative collection times, so their alignment to this calendar window is approximate. This is a dated snapshot, including games without uploaded replays. The date-range filter at the top applies to captured matches; this Tracker window stays fixed.</p><div id="tracker-results-detail"></div>`;
 document.querySelector('.view-controls').before(section);
 section.querySelector('select').onchange=e=>onChange(e.target.value);
 return function render(state){
  const tracker=section.querySelector('select').value==='tracker';
  section.querySelector('#tracker-results-detail').innerHTML=`<div class="tracker-results-grid">${PLAYERS.map(p=>{const s=trackerResultSummary(data.profiles[p.id],state.mode);return `<article><h3 style="color:${p.color}">${esc(p.name)}</h3><p><b>${fmt(s.total)}</b> calendar matches · all modes</p><p>${fmt(s.wins)} recorded wins / ${fmt(s.losses)} recorded defeats${state.mode==='all'?'':` · ${esc(MODES.find(m=>m.id===state.mode)?.name??state.mode)}`}</p><p>${fmt(s.unassignedWins)} mixed-mode wins kept separate${state.mode==='all'?' (included once in the all-mode total)':''}.</p>${state.mode==='all'?`<p>${s.lower===null?'Window mismatch: winrate unavailable.':`Estimated winrate range: <b>${fmt(s.lower)}–${fmt(s.upper)}%</b>. ${fmt(s.unknown)} outcomes remain unresolved.`}</p>`:`<p>${s.knownRate===null?'No individually attributed outcomes.':`Known-result winrate: ${fmt(s.knownRate)}% (${fmt(s.wins+s.losses)} attributed outcomes).`} ${fmt(s.grouped)} grouped matches have no individual result. Full mode winrate is unavailable: the daily denominator has no mode split.</p>`}<details><summary>Daily match counts</summary><ul>${data.profiles[p.id].daily.map(d=>`<li>${esc(d.date)}: ${fmt(d.matches)} matches</li>`).join('')}</ul></details><a href="${esc(data.profiles[p.id].source)}" target="_blank" rel="noreferrer">Inspect Tracker sessions</a></article>`;}).join('')}</div><p class="tracker-results-note">The range allows unresolved results to be either wins or losses; it is not a statistical confidence interval. Recorded wins are not divided by season or lifetime totals. Mixed-mode wins stay unassigned. Tracker cannot identify Together / Solo games. Boost, speed and bump metrics below still use captured matches. Captured ${esc(data.capturedAt.slice(0,10))}.</p>`;
  if(!tracker)return;
  const cards=document.querySelectorAll('#headline-stats .stat-card');
  const available=state.view==='overall';
  const summaries=PLAYERS.map(p=>trackerResultSummary(data.profiles[p.id],state.mode));
  const pair=values=>`<div class="stat-dual"><span class="kate-text">${values[0]}</span><small>/</small><span class="player-text">${values[1]}</span></div>`;
  cards[0].innerHTML=`<div class="stat-top">Tracker matches · 13–19 Nov</div><div class="stat-value">${available?pair(summaries.map(s=>state.mode==='all'?fmt(s.total):'—')):'—'}</div><div class="stat-foot">${available?(state.mode==='all'?'Kate / PLAYER · activity calendar, all modes':'Daily calendar has no per-mode total. See attributed outcomes above.'):'Tracker has no teammate IDs. Choose Overall, or Captured matches for Together / Solo.'}</div>`;
  cards[1].innerHTML=`<div class="stat-top">${state.mode==='all'?'Winrate · Tracker estimate range':'Winrate · Tracker known results'}</div><div class="stat-value">${available?pair(summaries.map(s=>state.mode==='all'?(s.lower===null?'—':`${fmt(s.lower)}–${fmt(s.upper)}%`):(s.knownRate===null?'—':`${fmt(s.knownRate)}%`))):'—'}</div><div class="stat-foot">${available?(state.mode==='all'?'Unresolved outcomes widen the range. Approximate collection window.':'Only attributed W / L; mixed wins and grouped outcomes excluded. See coverage above.'):'Together / Solo requires captured rosters. No Tracker co-play estimate is invented.'}</div>`;
  cards[2].querySelector('.stat-top').textContent='Boost stolen · captured sample';cards[3].querySelector('.stat-top').textContent='Bumps · captured sample';
 };
}
