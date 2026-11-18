import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=['README.md','main.mjs','match.mjs','store.mjs','configure.mjs','Start Logger.cmd','Configure API.cmd','logger.config.json'];
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
// Standard ZIP "store" entries keep this small download dependency-free. The
// allowlist excludes all runtime queues and local platform-ID configuration.
export async function packageLogger(destination){
  const parts=[],central=[];let offset=0;
  for(const file of files){
    const name=Buffer.from('duoq-logger/'+file),data=file==='logger.config.json'?Buffer.from('{"aliases":{}}\n'):await fs.readFile(path.join(root,'logger',file));
    const crc=crc32(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x5c21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(0x5c21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    parts.push(header,name,data);central.push(directory,name);offset+=header.length+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,Buffer.concat([...parts,directory,end]));
  return destination;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await packageLogger(path.resolve(process.argv[2]??path.join(root,'dist/downloads/duoq-logger.zip'))));
