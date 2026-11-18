import fs from 'node:fs/promises';
import path from 'node:path';
import {projectSummary} from './match.mjs';

export class SummaryStore{
  constructor(directory){this.directory=directory;this.filename=path.join(directory,'state.json');this.pending=[];this.sent=[];}
  async open(){
    await fs.mkdir(this.directory,{recursive:true});
    try{
      const info=await fs.stat(this.filename);if(info.size>32*1024*1024)throw Error('Logger state is too large. Back up the logger data folder before resetting it.');
      const state=JSON.parse(await fs.readFile(this.filename,'utf8'));
      if(state.schema!==1||!Array.isArray(state.pending)||!Array.isArray(state.sent)||state.pending.length>10000||state.sent.length>100000)throw Error('Invalid logger state.');
      this.pending=state.pending.map(projectSummary);this.sent=state.sent.filter(id=>typeof id==='string'&&/^[A-F\d-]{32,64}$/.test(id));
    }catch(e){if(e.code!=='ENOENT')throw e;}
    return this;
  }
  async save(){
    const temp=this.filename+'.tmp';
    await fs.writeFile(temp,JSON.stringify({schema:1,pending:this.pending,sent:this.sent})+'\n',{mode:0o600});
    await fs.rename(temp,this.filename);
  }
  async enqueue(input){
    const summary=projectSummary(input);
    if(this.sent.includes(summary.id)||this.pending.some(r=>r.id===summary.id))return false;
    if(this.pending.length>=10000)throw Error('Logger queue is full. Restore the connection before capturing more games.');
    this.pending.push(summary);await this.save();return true;
  }
  async acknowledge(id){this.pending=this.pending.filter(r=>r.id!==id);if(!this.sent.includes(id))this.sent.push(id);this.sent=this.sent.slice(-100000);await this.save();}
}

export async function sendSummary(summary,{endpoint,fetchImpl=fetch}={}){
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(projectSummary(summary)),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Library returned HTTP ${response.status}. The match stays in the retry queue.`);
  const result=await response.json();
  if(result.replay?.id?.toUpperCase()!==summary.id.toUpperCase())throw Error('Library acknowledgement did not match this game.');
}
