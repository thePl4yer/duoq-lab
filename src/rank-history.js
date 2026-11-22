import {PLAYERS,MODES} from './analysis.js';
import {$,esc,fmt,berlin} from './ui.js';
export function showRankHistory(snapshot){
 const panel=document.createElement('section');panel.id='rank-history';panel.className='rank-history panel';
 panel.innerHTML=`<div class="panel-heading"><div><div class="eyebrow">TRACKER NETWORK</div><h2>The ranked journey.</h2></div><select id="rank-history-mode" aria-label="Rank history game mode">${MODES.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select></div><div id="rank-history-content">Loading rank history…</div>`;
 ($('#snatch-card')??$('.workspace-grid')).after(panel);
 let charts=null;
 const render=()=>{if(!charts)return;const mode=$('#rank-history-mode').value;
  $('#rank-history-content').innerHTML=`<div class="rank-history-grid">${PLAYERS.map((p,i)=>{const rank=snapshot.profiles[p.id].ranks[mode],chart=charts.profiles[p.id]?.[mode];return `<article><h3 class="${i?'player-text':'kate-text'}">${esc(p.name)}</h3><p>${fmt(rank.matches)} season matches · ${esc(rank.tier)} ${esc(rank.division)} · ${fmt(rank.mmr)} MMR</p>${chart?`<div class="rank-chart-scroll" tabindex="0" aria-label="Scrollable rank chart"><svg viewBox="${esc(`-30 -5 ${Number(chart.viewBox.split(' ')[2])+40} ${Number(chart.viewBox.split(' ')[3])+10}`)}" role="img" aria-label="${esc(p.name)} ${esc(mode)} MMR history from Tracker"><title>${esc(p.name)} · ${esc(mode)} · Tracker MMR history</title>${chart.grid.map(d=>`<path d="${esc(d)}" fill="none" stroke="#323b47"/>`).join('')}<g transform="${esc(chart.transform)}"><path d="${esc(chart.d)}" fill="none" stroke="${p.color}" stroke-width="2.5"/></g>${chart.labels.join('')}</svg></div><a href="${esc(chart.source)}" target="_blank" rel="noreferrer">Open interactive history on Tracker ↗</a>`:'<p>History unavailable.</p>'}</article>`;}).join('')}</div><p class="rank-history-note">Static traces from Tracker’s charts, captured ${berlin.format(new Date(charts.capturedAt))}. Season matches include games without saved replays; these figures ignore the Together / Solo and replay filters.</p>`;
 };
 $('#rank-history-mode').onchange=render;
 // The chart file is large, so it is fetched only when the panel comes near the screen.
 const load=async()=>{try{const response=await fetch('./data/rank-charts.json');if(!response.ok)throw Error();charts=await response.json();render();}catch{$('#rank-history-content').textContent='Rank history could not be loaded. Open either Tracker profile to view the latest history.';}};
 if(!('IntersectionObserver' in window))return load();
 const near=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){near.disconnect();load();}},{rootMargin:'400px 0px'});near.observe(panel);
}
