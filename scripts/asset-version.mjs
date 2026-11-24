import {createHash} from 'node:crypto';

// A change to any module invalidates the whole browser module graph, including its worker.
export function assetVersion(entries){
 const hash=createHash('sha256');
 for(const [name,content] of [...entries].sort(([a],[b])=>a.localeCompare(b)))hash.update(name).update('\0').update(content).update('\0');
 return hash.digest('hex').slice(0,12);
}
