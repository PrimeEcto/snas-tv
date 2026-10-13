import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
const base='http://127.0.0.1:4723';
let session='';
export async function request(method,path,body){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok||d.value?.error)throw new Error(JSON.stringify(d.value));return d.value;
}
export async function connect(){const d=await request('POST','/session',{capabilities:{alwaysMatch:{platformName:'Kepler','appium:automationName':'automation-toolkit/JSON-RPC','kepler:device':'vda://default','appium:newCommandTimeout':600}}});session=d.sessionId;writeFileSync('research/appium-session-id.txt',session);return session;}
export function useSession(){session=readFileSync('research/appium-session-id.txt','utf8').trim();}
export const source=()=>request('GET',`/session/${session}/source`);
export const key=code=>request('POST',`/session/${session}/execute/sync`,{script:'jsonrpc: injectInputKeyEvent',args:[[{inputKeyEvent:String(code),holdDuration:100}]]});
export async function screenshot(name){const b64=await request('GET',`/session/${session}/screenshot`);mkdirSync('.impeccable/review',{recursive:true});writeFileSync(`.impeccable/review/${name}.png`,Buffer.from(b64,'base64'));console.log('Saved native screenshot:',name);}
export async function find(id){const el=await request('POST',`/session/${session}/element`,{using:'xpath',value:`//*[@test_id="${id}"]`});return el['element-6066-11e4-a52e-4f735466cecf']||el.ELEMENT;}
export async function focus(id){const el=await find(id);await request('POST',`/session/${session}/execute/sync`,{script:'jsonrpc: setFocus',args:[{elementId:el}]});}
export async function click(id){const el=await find(id);return request('POST',`/session/${session}/element/${el}/click`,{});}
export const disconnect=()=>request('DELETE',`/session/${session}`);
export async function waitFor(id,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){const s=await source();if(s.includes(`test_id="${id}"`))return s;await new Promise(r=>setTimeout(r,250));}throw new Error(`Timed out waiting for ${id}`);}
