import {validateSummary} from './analysis.js';
export const LIBRARY_API='https://duoq-lab-library-tk.fairy-cat-9312.chatgpt.site/api/replays';
export async function fetchSharedLibrary(){
  const result=[];let offset=0;
  for(let page=0;page<51;page++){
    const response=await fetch(`${LIBRARY_API}?offset=${offset}`,{credentials:'omit',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Shared library unavailable.');const data=await response.json();
    if(!Array.isArray(data.replays))throw Error('Invalid shared library response.');
    result.push(...data.replays.map(validateSummary));if(data.next===null)return result;
    if(!Number.isInteger(data.next)||data.next<=offset)throw Error('Invalid library cursor.');offset=data.next;
  }
  return result;
}
export async function publishSummary(replay){
  const response=await fetch(LIBRARY_API,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(replay),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw Error(data.error??'Public sharing failed.');return validateSummary(data.replay);
}
