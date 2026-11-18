import { getDb } from '@/db';
import { replays } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { sanitizeReplay } from '@/lib/sanitize';
import { mergeStoredSummary } from '@/lib/merge-summary';
export const dynamic = 'force-dynamic';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
export function OPTIONS(){return new Response(null,{status:204,headers});}
export async function GET(request:Request){
  try{
    const offset=Math.max(0,Math.min(10000,Number(new URL(request.url).searchParams.get('offset'))||0));
    const rows=await getDb().select().from(replays).orderBy(desc(replays.createdAt)).limit(200).offset(offset);
    return reply({replays:rows.map(r=>JSON.parse(r.summary)),next:rows.length===200?offset+200:null});
  }catch{return reply({error:'The shared library could not be read.'},503);}
}
export async function POST(request:Request){
  try{
    if(!(request.headers.get('content-type')??'').includes('application/json'))return reply({error:'JSON required.'},415);
    const reader=request.body?.getReader();if(!reader)return reply({error:'Missing summary.'},400);
    let text='',length=0;const decoder=new TextDecoder();
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>98304){await reader.cancel();return reply({error:'Summary too large.'},413);}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();
    const record=sanitizeReplay(JSON.parse(text));const db=getDb();
    await db.insert(replays).values({id:record.id,summary:JSON.stringify(record),createdAt:new Date().toISOString()}).onConflictDoNothing();
    for(let attempt=0;attempt<3;attempt++){
      const current=(await db.select().from(replays).where(eq(replays.id,record.id)).limit(1))[0];
      const merged=JSON.stringify(mergeStoredSummary(JSON.parse(current.summary),record));
      if(merged===current.summary)break;
      const changed=await db.update(replays).set({summary:merged}).where(and(eq(replays.id,record.id),eq(replays.summary,current.summary))).returning({id:replays.id});
      if(changed.length)break;
    }
    const saved=await db.select().from(replays).where(eq(replays.id,record.id)).limit(1);
    return reply({replay:JSON.parse(saved[0].summary)},201);
  }catch(error){return reply({error:error instanceof Error?error.message:'Invalid replay summary.'},400);}
}
