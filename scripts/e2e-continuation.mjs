import assert from 'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';
import{connect,key,source,screenshot,click,waitFor,find,request}from'./device-test.mjs';
await connect();
const results=JSON.parse(readFileSync('research/e2e-results.json','utf8')).filter(r=>r.result==='PASS');
const settle=()=>new Promise(r=>setTimeout(r,600));
async function press(id){await click(id);await settle();}
async function scrollTo(id){for(let i=0;i<15;i++){try{const el=await find(id);if(await request('GET',`/session/${readFileSync('research/appium-session-id.txt','utf8').trim()}/element/${el}/displayed`))return;}catch{}await key(108);await settle();}throw Error(`Remote could not reach ${id}`);}
async function check(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS',name);}catch(e){results.push({name,result:'FAIL',error:e.message});console.log('FAIL',name,e.message.slice(0,180));}finally{writeFileSync('research/e2e-results.json',JSON.stringify(results,null,2));}}
try{
 await waitFor('home-play',30000);await settle();
 if(!(await source()).includes('<text>Saved</text>'))await press('home-save');await press('home-play');await waitFor('player-toggle');await new Promise(r=>setTimeout(r,6200));await key(106);await settle();await press('player-forward');await press('player-exit');await press('nav-Home');
 await check('Watchlist and actual movie progress appear in My List',async()=>{await press('nav-My List');assert.ok((await source()).includes('list-movie-157336'));await press('list-continue');assert.ok((await source()).includes('list-movie-157336'));await screenshot('continue-watching');});
 await check('Movies remote genre selection and page loading',async()=>{await press('nav-Movies');await press('genre');for(let i=0;i<12;i++){await key(106);await new Promise(r=>setTimeout(r,120));}await key(96);await settle();assert.ok((await source()).includes('Genre: Science Fiction'));await press('genre');for(let i=0;i<12;i++)await key(105);await key(96);await settle();await scrollTo('browse-more');await press('browse-more');await settle();assert.ok((await source()).includes('browse-movie-299534'));});
 await check('Remote search, detail return, and empty results',async()=>{await press('nav-Search');for(const c of 'DUNE')await press(`key-${c}`);await waitFor('search-movie-693134');await screenshot('search');await press('search-movie-693134');await key(158);await settle();assert.ok((await source()).includes('results for “DUNE”'));await press('key-clear');for(const c of 'ZZZZZ')await press(`key-${c}`);assert.ok((await source()).includes('No matches this time'));await press('key-clear');});
 await check('Series seasons, episodes and Next Episode',async()=>{await press('nav-Series');await press('browse-tv-66732');await scrollTo('season-2');await screenshot('series-details');await press('season-2');await scrollTo('episode-2-1');await press('episode-2-1');await waitFor('player-episodes');assert.ok((await source()).includes('Season 2'));await screenshot('episode-player');await press('player-next');await settle();assert.ok((await source()).includes('Episode 2'));await press('player-exit');});
 await check('Episode progress joins Continue Watching',async()=>{await press('nav-My List');await press('list-continue');assert.ok((await source()).includes('list-tv-66732'));});
 await press('nav-About');await screenshot('about');
}catch(e){console.error('Stopped at failed scenario:',e.message.slice(0,200));process.exitCode=1;}
