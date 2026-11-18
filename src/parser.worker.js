import init,{get_stats_timeline_json,get_replay_meta,get_replay_frames_data} from '../vendor/rl_replay_subtr_actor.js';
import {fromTimeline,PLAYERS,remoteId} from './analysis.js';
import {analyseBoostSnatches} from './snatch-heuristic.js';
let ready;
self.onmessage=async({data})=>{
  const {bytes,name,hash}=data;
  try{
    ready??=init();await ready;
    const metadata=get_replay_meta(new Uint8Array(bytes)).replay_meta;
    if(![...(metadata.team_zero??[]),...(metadata.team_one??[])].some(p=>PLAYERS.some(b=>b.id===remoteId(p.remote_id)))){self.postMessage({type:'skip'});return;}
    self.postMessage({type:'progress',message:'Analysing movement, boost and bumps …'});
    const result=JSON.parse(new TextDecoder().decode(get_stats_timeline_json(new Uint8Array(bytes),false)));
    const summary=fromTimeline(result,name,hash);
    summary.players=summary.players.filter(p=>PLAYERS.some(b=>b.id===p.id));
    summary.bumps=summary.bumps.filter(e=>PLAYERS.some(b=>b.id===e.from)&&PLAYERS.some(b=>b.id===e.to));
    if(summary.players.length===2&&summary.players[0].team===summary.players[1].team){
      self.postMessage({type:'progress',message:'Calculating the boost tax estimate …'});
      try{summary.snatches=analyseBoostSnatches(get_replay_frames_data(new Uint8Array(bytes)));}catch{summary.snatches={status:'unavailable',reason:'frame_analysis_failed'};}
    }
    self.postMessage({type:'result',result:summary});
  }catch(error){self.postMessage({type:'error',message:String(error?.message??error).slice(0,500)});}
};
