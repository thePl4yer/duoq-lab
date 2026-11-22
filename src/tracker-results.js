import {PLAYERS,MODES} from './analysis.js';
import {esc,fmt,pairText,pairCell,showContent} from './ui.js';
const modeIds={'Ranked Standard 3v3':'standard','Ranked Doubles 2v2':'doubles',Hoops:'hoops',Dropshot:'dropshot',Snowday:'snowday',Rumble:'rumble',Multiple:'unassigned'};
const span=(start,end)=>{const [a,b]=[start,end].map(d=>new Date(d+'T12:00:00Z'));if(isNaN(a)||isNaN(b))return `${start} to ${end}`;const m=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'});return m.format(a)===m.format(b)?`${a.getUTCDate()}–${b.getUTCDate()} ${m.format(b)}`:`${a.getUTCDate()} ${m.format(a)} – ${b.getUTCDate()} ${m.format(b)}`;};
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
 const range=span(data.start,data.end),dates=[...new Set(PLAYERS.flatMap(p=>data.profiles[p.id].daily.map(d=>d.date)))].sort(),count=(p,date)=>data.profiles[p.id].daily.find(d=>d.date===date)?.matches;
 section.innerHTML=`<div class="panel-heading"><div><div class="eyebrow">ACCOUNT ACTIVITY · TRACKER · ${esc(range.toUpperCase())}</div><h2>Beyond the replay folder.</h2></div><div class="tracker-results-tools"><select id="results-source" aria-label="Results source"><option value="tracker">Tracker estimates</option><option value="captured">Captured matches</option></select><button class="icon-button" id="tracker-results-info" aria-label="About the Tracker estimates">ⓘ</button></div></div><div class="pair-grid" id="tracker-results-detail"></div><details class="tracker-daily"><summary>Daily match counts</summary><div class="event-list">${dates.map(d=>`<div class="event-line"><span>${esc(d)}</span><small>${pairText(fmt(count(PLAYERS[0],d)),fmt(count(PLAYERS[1],d)))}</small></div>`).join('')}</div></details>`;
 document.querySelector('.view-controls').before(section);
 section.querySelector('select').onchange=e=>onChange(e.target.value);
 section.querySelector('#tracker-results-info').onclick=()=>showContent('Tracker estimates',`<p>Tracker calendar: ${esc(data.start)} to ${esc(data.end)}. Sessions use relative collection times, so their alignment to this calendar window is approximate. This is a dated snapshot, including games without uploaded replays. The date-range filter at the top applies to captured matches; this Tracker window stays fixed.</p><p>The range allows unresolved results to be either wins or losses; it is not a statistical confidence interval. Recorded wins are not divided by season or lifetime totals. Mixed-mode wins stay unassigned. For a single mode only attributed outcomes count; full mode winrate is unavailable because the daily denominator has no mode split.</p><p>Tracker cannot identify Together / Solo games. Boost, speed and bump metrics still use captured matches. Captured ${esc(data.capturedAt.slice(0,10))}.</p><p>${PLAYERS.map(p=>`<a href="${esc(data.profiles[p.id].source)}" target="_blank" rel="noreferrer">${esc(p.name)} sessions on Tracker ↗</a>`).join(' · ')}</p>`);
 return function render(state){
  const tracker=section.querySelector('select').value==='tracker',all=state.mode==='all';
  const summaries=PLAYERS.map(p=>trackerResultSummary(data.profiles[p.id],state.mode)),both=f=>pairText(...summaries.map(f)),wl=s=>`${fmt(s.wins)}–${fmt(s.losses)}`;
  section.querySelector('#tracker-results-detail').innerHTML=(all?[['Calendar matches',both(s=>fmt(s.total))],['Recorded W–L',both(wl)],['Winrate range',both(s=>s.lower===null?'—':`${fmt(s.lower,1)}–${fmt(s.upper,1)}%`)],['Unresolved',both(s=>fmt(s.unknown))],['Mixed-mode wins',both(s=>fmt(s.unassignedWins))]]
   :[[`Recorded W–L · ${esc(MODES.find(m=>m.id===state.mode)?.name??state.mode)}`,both(wl)],['Known-result winrate',both(s=>s.knownRate===null?'—':`${fmt(s.knownRate,1)}%`)],['Grouped, no result',both(s=>fmt(s.grouped))],['Mixed-mode wins',both(s=>fmt(s.unassignedWins))]]).map(([label,value])=>pairCell(label,value)).join('');
  if(!tracker)return;
  const cards=document.querySelectorAll('#headline-stats .stat-card');
  const available=state.view==='overall';
  const pair=values=>`<div class="stat-dual">${pairText(...values)}</div>`;
  cards[0].innerHTML=`<div class="stat-top">Tracker matches · ${esc(range)}</div><div class="stat-value">${available?pair(summaries.map(s=>state.mode==='all'?fmt(s.total):'—')):'—'}</div><div class="stat-foot">${available?(state.mode==='all'?'Kate / PLAYER · activity calendar, all modes':'Daily calendar has no per-mode total. See attributed outcomes above.'):'Tracker has no teammate IDs. Choose Overall, or Captured matches for Together / Solo.'}</div>`;
  cards[1].innerHTML=`<div class="stat-top">${state.mode==='all'?'Winrate · Tracker estimate range':'Winrate · Tracker known results'}</div><div class="stat-value">${available?pair(summaries.map(s=>state.mode==='all'?(s.lower===null?'—':`${fmt(s.lower,1)}–${fmt(s.upper,1)}%`):(s.knownRate===null?'—':`${fmt(s.knownRate,1)}%`))):'—'}</div><div class="stat-foot">${available?(state.mode==='all'?'Unresolved outcomes widen the range. Approximate collection window.':'Only attributed W / L; mixed wins and grouped outcomes excluded. See coverage above.'):'Together / Solo requires captured rosters. No Tracker co-play estimate is invented.'}</div>`;
  cards[2].querySelector('.stat-top').textContent='Boost stolen · captured sample';cards[3].querySelector('.stat-top').textContent='Bumps · captured sample';
 };
}
