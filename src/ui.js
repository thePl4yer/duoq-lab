// DOM and formatting helpers shared by the dashboard modules.
export const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numbers={};
export const fmt=(v,d=0)=>v===null||v===undefined||!Number.isFinite(v)?'—':(numbers[d]??=new Intl.NumberFormat('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d})).format(v);
export const berlin=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'Europe/Berlin'});
export const pairText=(a,b)=>`<span class="kate-text">${a}</span><small>/</small><span class="player-text">${b}</span>`;
export const pairValues=(a,b,unit='',digits=0)=>pairText(fmt(a,digits)+(a===null?'':unit),fmt(b,digits)+(b===null?'':unit));
export const pairCell=(label,value)=>`<div><h4>${label}</h4><div class="pair-value">${value}</div></div>`;
export function showContent(title,html){$('#detail-title').textContent=title;$('#detail-body').innerHTML=html;$('#detail-dialog').showModal();}
export function toast(message,error=false){const el=$('#toast');el.textContent=message;el.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),error?11000:6500);}
