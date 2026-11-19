import test from 'node:test';
import assert from 'node:assert/strict';
import {trackerResultSummary} from '../src/tracker-results.js';
test('Calendar denominator includes absent replays; mixed wins are counted once overall and never assigned to modes',()=>{
 const profile={daily:[{matches:20}],sessions:[{relative:'2 hours ago',rows:[{playlist:'Hoops',result:'3 Wins'},{playlist:'Multiple',result:'4 Wins MVP'},{playlist:'Hoops',result:'Defeat'},{playlist:'Rumble',result:'7 Matches'}]}]};
 const all=trackerResultSummary(profile);assert.equal(all.total,20);assert.equal(all.wins,7);assert.equal(all.lower,35);assert.equal(all.upper,95);assert.equal(all.unknown,12);
 const hoops=trackerResultSummary(profile,'hoops');assert.equal(hoops.wins,3);assert.equal(hoops.denominator,null);assert.equal(hoops.knownRate,75);assert.equal(hoops.unassignedWins,4);
 const rumble=trackerResultSummary(profile,'rumble');assert.equal(rumble.grouped,7);assert.equal(rumble.knownRate,null);assert.equal(rumble.losses,0);
});
test('Contradictory coverage and absent records never produce an invented winrate',()=>{
 assert.equal(trackerResultSummary({daily:[{matches:1}],sessions:[{relative:'1 day ago',rows:[{playlist:'Hoops',result:'3 Wins'}]}]}).lower,null);
 assert.equal(trackerResultSummary({daily:[],sessions:[]}).lower,null);
 assert.equal(trackerResultSummary({daily:[{matches:20}],sessions:[{relative:'1 week ago',rows:[{playlist:'Hoops',result:'8 Wins'}]}]}).wins,0);
});
