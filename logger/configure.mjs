import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';

export function configureIni(text){
  const eol=text.includes('\r\n')?'\r\n':'\n';
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  const heading='[TAGame.MatchStatsExporter_TA]';
  let start=lines.findIndex(line=>line.trim().toLowerCase()===heading.toLowerCase());
  if(start<0){if(lines.at(-1)!=='')lines.push('');start=lines.length;lines.push(heading);}
  let end=start+1;while(end<lines.length&&!/^\s*\[/.test(lines[end]))end++;
  const settings={PacketSendRate:'10',Port:'0',WebPort:'49124'};
  const section=lines.slice(start+1,end).filter(line=>!/^\s*(PacketSendRate|Port|WebPort)\s*=/i.test(line));
  lines.splice(start+1,end-start-1,...Object.entries(settings).map(([key,value])=>`${key}=${value}`),...section);
  return lines.join(eol).replace(/[\r\n]*$/,'')+eol;
}

export async function configureFile(filename){
  filename=path.resolve(filename);
  if(!['tastatsapi.ini','defaultstatsapi.ini'].includes(path.basename(filename).toLowerCase())||!/[\\/]TAGame[\\/]Config$/i.test(path.dirname(filename)))throw Error('Select only TAStatsAPI.ini or DefaultStatsAPI.ini inside Rocket League/TAGame/Config.');
  await fs.access(path.dirname(filename));
  let bytes=Buffer.alloc(0);
  try{bytes=await fs.readFile(filename);}catch(e){if(e.code!=='ENOENT'||path.basename(filename).toLowerCase()!=='tastatsapi.ini')throw e;}
  let encoding='utf8',bom=Buffer.alloc(0),body=bytes;
  if(bytes[0]===0xff&&bytes[1]===0xfe){encoding='utf16le';bom=bytes.subarray(0,2);body=bytes.subarray(2);}
  else if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf){bom=bytes.subarray(0,3);body=bytes.subarray(3);}
  else if(bytes[0]===0xfe&&bytes[1]===0xff)throw Error('This INI uses UTF-16 big endian. Edit the documented API settings manually; no file was changed.');
  let original;
  try{original=encoding==='utf8'?new TextDecoder('utf-8',{fatal:true}).decode(body):body.toString(encoding);}catch{throw Error('Unsupported INI text encoding. Edit the API settings manually; no file was changed.');}
  if(original.includes('\0'))throw Error('Unsupported INI text encoding. No file was changed.');
  const updated=configureIni(original);
  if(updated===original)return {filename,unchanged:true};
  const backup=bytes.length?filename+'.duoq-backup-'+new Date().toISOString().replaceAll(/[:.]/g,'-'):null;
  if(backup)await fs.writeFile(backup,bytes,{flag:'wx'});
  await fs.writeFile(filename,Buffer.concat([bom,Buffer.from(updated,encoding)]));
  return {filename,backup};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log('DuoQ Rocket League API setup\nClose Rocket League first. This changes only the selected Rocket League Stats API INI file and keeps a backup.\nIt does not start the logger or configure Windows startup.\n');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
    const filename=(await rl.question('Full path to TAGame\\Config\\TAStatsAPI.ini (or DefaultStatsAPI.ini): ')).trim().replace(/^"|"$/g,'');
    const result=await configureFile(filename);
    console.log(result.unchanged?'API settings already configured.':`Saved ${result.filename}${result.backup?'\nBackup: '+result.backup:''}`);
    console.log('Restart Rocket League, then manually run Start Logger.cmd.');
  }finally{rl.close();}
}
