import assert from 'node:assert/strict';
import {analyseBoostSnatches,TARGET_IDS} from '../src/snatch-heuristic.js';
const [kate,player]=TARGET_IDS;const id=Steam=>({Steam});
function sample(){const make=(x,boost)=>({Data:{rigid_body:{location:{x,y:0,z:70},linear_velocity:{x:500,y:0,z:0}},boost_amount:boost,is_team_0:true}});return {meta:{team_zero:[{remote_id:id(kate)},{remote_id:id(player)}],team_one:[],game_type:{playlist_id:13},all_headers:[['MapName','Stadium_P'],['MatchGUID','TEST']]},frame_data:{metadata_frames:[0,.05,.1,.15,.2].map(time=>({time})),players:[[id(kate),{frames:Array.from({length:5},()=>make(0,100))}],[id(player),{frames:Array.from({length:5},()=>make(-500,100))}]]},boost_pads:[{pad_id:'p',position:{x:0,y:0,z:70},size:'Big'}],boost_pad_events:[{time:.2,frame:4,pad_id:'p',player:id(kate),player_position:{x:0,y:0,z:70},kind:{PickedUp:{sequence:1}}}]};}
let r=analyseBoostSnatches(sample());assert.equal(r.directions[kate].count,1);assert.equal(r.directions[player].count,0);
let s=sample();s.boost_pad_events.push({...s.boost_pad_events[0]});r=analyseBoostSnatches(s);assert.equal(r.directions[kate].count,1);assert.equal(r.directions[kate].coverage.duplicatePickups,1);
s=sample();s.boost_pad_events[0].kind='Available';assert.equal(analyseBoostSnatches(s).directions[kate].count,0);
s=sample();s.boost_pads=[];r=analyseBoostSnatches(s);assert.equal(r.directions[kate].count,null);assert.equal(r.directions[kate].coverage.unknownPadPickups,1);
s=sample();s.meta.all_headers[0][1]='HoopsStadium_P';s.meta.game_type.playlist_id=27;r=analyseBoostSnatches(s);assert.equal(r.status,'unavailable');assert.equal(r.directions[kate].count,null);
s=sample();s.meta.game_type.playlist_id=29;assert.equal(analyseBoostSnatches(s).status,'not_applicable');
s=sample();s.frame_data.players[1][1].frames[1]='Empty';r=analyseBoostSnatches(s);assert.equal(r.directions[kate].count,0);assert.equal(r.directions[kate].coverage.ignoredRespawnPickups,1);
s=sample();for(const frame of s.frame_data.players[1][1].frames)frame.Data.boost_amount=127.5;assert.equal(analyseBoostSnatches(s).directions[kate].count,0);
s=sample();for(const frame of s.frame_data.players[1][1].frames)frame.Data.rigid_body.linear_velocity.x=-500;assert.equal(analyseBoostSnatches(s).directions[kate].count,0);
console.log('9 focused snatch checks passed');
