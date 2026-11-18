import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';

const [operation,...args]=process.argv.slice(2);
const {values}=parseArgs({args,options:{file:{type:'string'},api:{type:'string'}}});
if(!['export','import'].includes(operation)||!values.file){
  throw Error('Usage: node scripts/library-transfer.mjs export --file backups/library.json [--api URL]\n       node scripts/library-transfer.mjs import --file FILE --api URL');
}
if(operation==='import'&&!values.api)throw Error('Import requires an explicit --api target URL.');
const endpoint=new URL(values.api??'https://duoq-lab-library-tk.fairy-cat-9312.chatgpt.site/api/replays');
if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))){
  throw Error('Use HTTPS or a loopback HTTP development endpoint.');
}
if(endpoint.username||endpoint.password)throw Error('Do not put credentials in the API URL.');
const filename=path.resolve(values.file);
if(operation==='export'){
  const replays=[];
  let offset=0;
  while(true){
    const url=new URL(endpoint);url.searchParams.set('offset',offset);
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`Export failed: HTTP ${response.status}.`);
    const data=await response.json();
    if(!Array.isArray(data.replays))throw Error('Invalid library response.');
    replays.push(...data.replays);
    if(data.next===null)break;
    if(!Number.isInteger(data.next)||data.next<=offset||data.next>10000)throw Error('Unsupported library cursor; export stopped without writing a partial file.');
    offset=data.next;
  }
  await fs.mkdir(path.dirname(filename),{recursive:true});
  await fs.writeFile(filename,JSON.stringify({kind:'duoq-shared-library-backup',schema:1,exportedAt:new Date().toISOString(),source:endpoint.href,replays},null,2)+'\n',{flag:'wx'});
  console.log(`Exported ${replays.length} public summaries to ${values.file}.`);
}else{
  const input=JSON.parse(await fs.readFile(filename,'utf8'));
  const rows=Array.isArray(input)?input:input.replays;
  if(!Array.isArray(rows)||rows.some(r=>r?.schema!==1||typeof r.id!=='string'))throw Error('Expected a DuoQ summary array or backup with a replays array.');
  let completed=0;
  for(const row of rows){
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row),signal:AbortSignal.timeout(20000)});
    if(!response.ok){const detail=await response.text();throw Error(`Import stopped after ${completed}/${rows.length} summaries: HTTP ${response.status} ${detail.slice(0,200)}. Existing records remain saved; rerun to resume.`);}
    completed++;
  }
  console.log(`Imported or matched ${completed} summaries at ${endpoint.origin}${endpoint.pathname}.`);
}
