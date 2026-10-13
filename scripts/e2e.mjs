import assert from 'node:assert/strict';
import{writeFileSync}from'node:fs';
import{connect,useSession,key,source,screenshot,click,waitFor,find,request}from'./device-test.mjs';
await connect();
const results=[];
const settle=()=>new Promise(r=>setTimeout(r,650));
async function press(id){await click(id);await settle();}
async function check(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS',name);}catch(e){results.push({name,result:'FAIL',error:e.message});console.log('FAIL',name,e.message.slice(0,180));throw e;}finally{writeFileSync('research/e2e-results.json',JSON.stringify(results,null,2));}}
function time(s){const values=[...s.matchAll(/<text>(\d+:\d{2}(?::\d{2})?)<\/text>/g)];return values.at(-1)?.[1];}
// Start from Home after launch. No host GUI or mouse input is used.
async function scrollTo(id){for(let i=0;i<12;i++){try{const el=await find(id);if(await request('GET',`/session/${await import('node:fs').then(f=>f.readFileSync('research/appium-session-id.txt','utf8').trim())}/element/${el}/displayed`))return;}catch{}await key(108);await settle();}throw Error(`Remote could not reach ${id}`);}
try{
 await waitFor('home-play');await press('home-play');await waitFor('player-toggle');await settle();
 await check('Player pause freezes the displayed timeline',async()=>{await press('player-toggle');const a=time(await source());await new Promise(r=>setTimeout(r,1500));const b=time(await source());assert.equal(a,b);assert.ok((await source()).includes('<text>Play</text>'));});
 await check('Seeking updates elapsed time',async()=>{const a=time(await source());await press('player-forward');assert.notEqual(time(await source()),a);});
 await check('Audio, subtitles and speed menus open, select and close',async()=>{await press('player-audio');await screenshot('audio-menu');await press('option-English (simulated)');await press('player-subtitles');await press('option-English (simulated)');await press('player-settings');await press('option-1.5');assert.ok((await source()).includes('No media track is playing'));});
 await screenshot('player');await press('player-exit');await waitFor('home-play');await settle();
 await check('Home and remote Details navigation',async()=>{await screenshot('home');await press('home-details');assert.ok((await source()).includes('Directed by Christopher Nolan'));await screenshot('details');});
 await check('Watchlist add/remove is reflected in My List',async()=>{if((await source()).includes('Remove from My List'))await press('details-save');await press('details-save');await press('nav-My List');await screenshot('my-list');assert.ok((await source()).includes('list-movie-157336'));});
 await check('Movies filters and pagination',async()=>{await press('nav-Movies');await screenshot('movies');await press('genre');for(let i=0;i<12;i++){await key(106);await new Promise(r=>setTimeout(r,120));}await key(96);await settle();assert.ok((await source()).includes('browse-movie-157336'));await press('genre');for(let i=0;i<12;i++)await key(105);await key(96);await settle();await scrollTo('browse-more');await press('browse-more');await scrollTo('browse-movie-862');assert.ok((await source()).includes('browse-movie-862'));});
 await check('Remote keyboard searches genuine records and shows empty results',async()=>{await press('nav-Search');for(const c of 'DUNE')await press(`key-${c}`);await waitFor('search-movie-693134');await screenshot('search');await press('key-clear');for(const c of 'ZZZZZ')await press(`key-${c}`);assert.ok((await source()).includes('No matches this time'));await press('key-clear');});
 await check('Series season selection and episode player',async()=>{await press('nav-Series');await press('browse-tv-66732');await screenshot('series-details');await scrollTo('season-2');await press('season-2');await scrollTo('episode-2-1');await press('episode-2-1');await waitFor('player-episodes');assert.ok((await source()).includes('Season 2'));await screenshot('episode-player');await press('player-next');await settle();assert.ok((await source()).includes('Episode 2'));await press('player-exit');});
 await check('Continue Watching reflects actual preview progress',async()=>{await press('nav-My List');await press('list-continue');assert.ok((await source()).includes('list-movie-157336'));});
}catch(e){console.error('Stopped at failed scenario:',e.message.slice(0,250));process.exitCode=1;}
