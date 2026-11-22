// DOM, formatting and chart helpers shared by the dashboard.
export const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numbers={};
export const fmt=(v,d=0)=>v===null||v===undefined||!Number.isFinite(v)?'—':(numbers[d]??=new Intl.NumberFormat('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d})).format(v);
export const berlin=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'Europe/Berlin'});
// Every caught error and live-connection step: printed to the console as [duoq] and kept for "Copy debug log".
const trail=[];
export function debug(scope,...args){
  const text=args.map(a=>a instanceof Error?`${a.name}: ${a.message}`:a&&typeof a==='object'?JSON.stringify(a)?.slice(0,300):String(a)).join(' ');
  trail.push(`${new Date().toISOString().slice(11,19)} ${scope} ${text}`);if(trail.length>300)trail.shift();
  (args.some(a=>a instanceof Error)?console.warn:console.info)('[duoq]',scope,...args);
}
export const debugTrail=()=>trail.join('\n');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
export function showContent(title,html){$('#detail-title').textContent=title;$('#detail-body').innerHTML=html;$('#detail-dialog').showModal();}
export function toast(message,error=false){const el=$('#toast');el.textContent=message;el.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),error?11000:6500);}
const tipAttr=tip=>tip?` data-tip="${esc(tip)}" tabindex="0"`:'';
// One floating tooltip for every [data-tip]: hover, keyboard focus or tap. Placed next to its element and kept on screen.
export function tooltips(){
  const tip=document.createElement('div');tip.className='tip';tip.id='tip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  let owner=null;
  const hide=()=>{owner?.removeAttribute('aria-describedby');owner=null;tip.hidden=true;};
  const show=el=>{if(owner!==el)hide();owner=el;el.setAttribute('aria-describedby','tip');tip.textContent=el.dataset.tip;tip.hidden=false;
    const r=el.getBoundingClientRect(),above=r.top-tip.offsetHeight-6;
    tip.style.left=`${Math.min(Math.max(8,r.left),innerWidth-tip.offsetWidth-8)}px`;tip.style.top=`${above>=8?above:r.bottom+6}px`;};
  const target=e=>e.target.closest?.('[data-tip]');
  document.addEventListener('pointerover',e=>{if(e.pointerType!=='mouse')return;const el=target(e);el?show(el):hide();});
  document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;const el=target(e);el&&el!==owner?show(el):hide();});
  document.addEventListener('focusin',e=>{const el=target(e);if(el&&e.target.matches(':focus-visible'))show(el);});
  document.addEventListener('focusout',e=>{if(e.target===owner)hide();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
  addEventListener('scroll',hide,{passive:true});
}
// Kate value, PLAYER value and a split bar. Rows with no value on either side are left out.
export function row(label,k,p,{tip='',unit='',digits=0,text=false,bar=!text,action=''}={}){
  const has=v=>text?v!=null&&v!=='—':Number.isFinite(v);
  if(!has(k)&&!has(p))return '';
  const show=v=>text?esc(v??'—'):fmt(v,digits)+(Number.isFinite(v)?unit:'');
  const split=bar&&has(k)&&has(p)&&k+p>0?` style="--k:${(100*k/(k+p)).toFixed(1)}%"`:'';
  return `<div class="row${split?' split':''}${action?' action':''}"${split}${tipAttr(tip)}${action?` data-action="${action}" role="button"${tip?'':' tabindex="0"'}`:''}><span>${label}</span><b class="k">${show(k)}</b><b class="p">${show(p)}</b></div>`;
}
export const line=(label,value,tip='')=>`<div class="row one"${tipAttr(tip)}><span>${label}</span><b>${value}</b></div>`;
export const note=(text,tip='')=>`<p class="note"${tipAttr(tip)}>${text}</p>`;
// Animates a number from its previous value; every element keeps its own last value.
export function countUp(el,to,format){
  const from=Number(el.dataset.v);el.dataset.v=Number.isFinite(to)?to:'';
  if(reduced||!Number.isFinite(to)||!Number.isFinite(from)&&to===0||from===to){el.textContent=format(to);return;}
  const start=Number.isFinite(from)?from:0,t0=performance.now();
  const step=t=>{const q=Math.min(1,(t-t0)/700);el.textContent=format(start+(to-start)*(1-(1-q)**3));if(q<1&&Number(el.dataset.v)===to)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
const niceStep=span=>{const raw=span/3,mag=10**Math.floor(Math.log10(raw||1)),f=raw/mag;return (f<1.5?1:f<3.5?2:f<7.5?5:10)*mag;};
const month=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'}),monthLabel=t=>`${month.format(t)} '${String(new Date(t).getUTCFullYear()).slice(2)}`;
// Line chart drawn at the element's real pixel size, so labels never scale. spec: {series:[{color,name,points:[[x,y]]}],time,fmtX,fmtY,empty}
export function chart(el){
  let spec=null;const height=()=>el.clientHeight||150;
  const at=e=>e.clientX-el.getBoundingClientRect().left;
  el.addEventListener('pointermove',e=>hover(at(e)));el.addEventListener('pointerdown',e=>hover(at(e)));el.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hover(null);});
  let scale=null;
  function draw(){
    if(!spec)return;const pts=spec.series.flatMap(s=>s.points);
    if(!pts.length){el.innerHTML=`<p class="note">${spec.empty}</p>`;scale=null;return;}
    const w=el.clientWidth,h=height(),l=38,r=8,t=8,b=18,xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]);
    let x0=Math.min(...xs),x1=Math.max(...xs);if(x0===x1){x0-=1;x1+=1;}
    const st=niceStep(Math.max(...ys)-Math.min(...ys)||10),y0=Math.floor(Math.min(...ys)/st)*st,y1=Math.ceil(Math.max(...ys)/st)*st||st;
    const X=v=>l+(w-l-r)*(v-x0)/(x1-x0),Y=v=>h-b-(h-b-t)*(v-y0)/(y1-y0||1);scale={X,Y,x0,x1,l,r,w};
    let svg=`<svg width="${w}" height="${h}" role="img" aria-label="${esc(spec.label??'')}">`;
    for(let v=y0;v<=y1+1e-9;v+=st)svg+=`<line x1="${l}" x2="${w-r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${l-6}" y="${Y(v)+4}" text-anchor="end">${spec.fmtY(v)}</text>`;
    const ticks=[];if(spec.time){const d=new Date(x0);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);for(;+d<=x1;d.setUTCMonth(d.getUTCMonth()+1))ticks.push(+d);}else ticks.push(x0,Math.round((x0+x1)/2),x1);
    const every=Math.max(1,Math.ceil(ticks.length*64/(w-l-r)));
    ticks.forEach((v,i)=>{if(i%every===0){const at=X(v),anchor=at<l+30?'start':at>w-r-30?'end':'middle';svg+=`<text x="${at}" y="${h-4}" text-anchor="${anchor}">${esc(spec.time?monthLabel(v):spec.fmtX(v))}</text>`;}});
    for(const s of spec.series)if(s.points.length){
      svg+=`<polyline points="${s.points.map(([x,y])=>`${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" style="stroke:${s.color}"/>`;
      if(s.points.length<=40)svg+=s.points.map(([x,y])=>`<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.5" style="fill:${s.color}"/>`).join('');
    }
    el.innerHTML=svg+'<line class="cross" y1="0" y2="0"/></svg><div class="readout" hidden></div>';
  }
  function hover(px){
    const read=el.querySelector('.readout'),cross=el.querySelector('.cross');if(!read||!scale)return;
    if(px===null||px<scale.l){read.hidden=true;cross.setAttribute('y2',0);return;}
    const x=scale.x0+(px-scale.l)*(scale.x1-scale.x0)/(scale.w-scale.l-scale.r);
    const near=spec.series.map(s=>s.points.reduce((best,q)=>!best||Math.abs(q[0]-x)<Math.abs(best[0]-x)?q:best,null));
    const at=near.find(Boolean);if(!at){read.hidden=true;return;}
    cross.setAttribute('x1',scale.X(at[0]));cross.setAttribute('x2',scale.X(at[0]));cross.setAttribute('y1',4);cross.setAttribute('y2',height()-18);
    read.innerHTML=`<small>${esc(spec.fmtX(at[0]))}</small>`+spec.series.map((s,i)=>near[i]?`<b style="color:${s.color}">${esc(spec.fmtY(near[i][1]))}</b>`:'').join('');
    read.hidden=false;read.style.left=`${Math.min(Math.max(scale.X(at[0])+8,0),scale.w-read.offsetWidth-4)}px`;
  }
  new ResizeObserver(()=>draw()).observe(el);
  return next=>{spec=next;draw();};
}
