import records from './demo-records.json';
import episodeRecords from './demo-episodes.json';
import type {Title,Episode,Rail,Kind,Page,Detail} from './types';
export const demoTitles:Title[]=records.map(t=>({...t,kind:t.kind as Kind,director:t.director||undefined,seasons:t.seasons||undefined}));
const demoEpisodes=episodeRecords as Record<string,Episode[]>;
export const movieGenres:Record<string,number>={'Action':28,'Adventure':12,'Animation':16,'Comedy':35,'Crime':80,'Documentary':99,'Drama':18,'Family':10751,'Fantasy':14,'History':36,'Horror':27,'Music':10402,'Mystery':9648,'Romance':10749,'Science Fiction':878,'TV Movie':10770,'Thriller':53,'War':10752,'Western':37};
export const tvGenres:Record<string,number>={'Action & Adventure':10759,'Animation':16,'Comedy':35,'Crime':80,'Documentary':99,'Drama':18,'Family':10751,'Kids':10762,'Mystery':9648,'News':10763,'Reality':10764,'Sci-Fi & Fantasy':10765,'Soap':10766,'Talk':10767,'War & Politics':10768,'Western':37};
export function imageUrl(path:string|null,size='w500'):string|undefined{return path&&/^\/[\w.-]+$/.test(path)?`https://image.tmdb.org/t/p/${size}/${path.slice(1)}`:undefined;}
const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
function normalize(raw:any,kind:Kind):Title|null{
 if(!raw||!finite(raw.id)||raw.id<=0||!(raw.title||raw.name))return null;
 const map=kind==='movie'?movieGenres:tvGenres;
 const genres=Array.isArray(raw.genres)?raw.genres.map((g:any)=>g.name).filter(Boolean):(raw.genre_ids||[]).map((id:number)=>Object.keys(map).find(k=>map[k]===id)).filter(Boolean);
 return {id:raw.id,kind,title:raw.title||raw.name,year:(raw.release_date||raw.first_air_date||'').slice(0,4),overview:raw.overview||'',poster:raw.poster_path||null,backdrop:raw.backdrop_path||null,genres,rating:finite(raw.vote_average)&&raw.vote_count>0?raw.vote_average:null,votes:raw.vote_count,runtime:finite(raw.runtime)&&raw.runtime>0?raw.runtime:(raw.episode_run_time?.[0]||null),cast:raw.credits?.cast?.slice(0,8).map((a:any)=>a.name),director:raw.credits?.crew?.find((a:any)=>a.job==='Director')?.name,seasons:raw.number_of_seasons};
}
function pageResult(raw:any,kind?:Kind):Page{
 if(!raw||!Array.isArray(raw.results))throw new Error('TMDB returned an unreadable catalog. Try again.');
 return {items:raw.results.filter((r:any)=>kind||['movie','tv'].includes(r.media_type)).map((r:any)=>normalize(r,kind||r.media_type)).filter(Boolean),page:raw.page||1,totalPages:Math.min(raw.total_pages||1,500)};
}
type Fetcher=(url:string,options?:any)=>Promise<{ok:boolean;status:number;json:()=>Promise<any>}>;
export class Catalog{
 readonly mode:'live'|'demo';private backend:string;private fetcher:Fetcher;
 private cache=new Map<string,{expiry:number,value:Promise<any>}>();
 // No credential ever reaches the device: `backend` is the SNAS catalogue proxy, which
 // holds the TMDB key server-side and forwards these same paths to api.themoviedb.org.
 constructor(backend='',fetcher:Fetcher=fetch){this.backend=backend.trim().replace(/\/+$/,'');this.mode=this.backend?'live':'demo';this.fetcher=fetcher;}
 private request(path:string,params:Record<string,string|number>={}):Promise<any>{
 const query=Object.entries({language:'en-US',...params}).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
 const url=`${this.backend}/${path}?${query}`;const cached=this.cache.get(url);if(cached&&cached.expiry>Date.now())return cached.value;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 const value=(async()=>{try{
 const response=await this.fetcher(url,{headers:{Accept:'application/json'},signal:controller.signal});
 if(response.status===401||response.status===403)throw new Error('Catalog backend refused the request. Try the sample catalog.');
 if(!response.ok)throw new Error(response.status===429?'The catalog is busy. Please try again shortly.':'The catalog backend is unavailable. Please try again.');
 return await response.json();
 }catch(error){this.cache.delete(url);if(error instanceof Error&&/^(Catalog|The catalog)/.test(error.message))throw error;throw new Error('Network connection unavailable. Try again or use the sample catalog.');}finally{clearTimeout(timer);}})();
 this.cache.set(url,{expiry:Date.now()+300000,value});if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value!);return value;
 }
 async home():Promise<Rail[]>{
 if(this.mode==='demo'){
 const movies=demoTitles.filter(t=>t.kind==='movie'),tv=demoTitles.filter(t=>t.kind==='tv');
 return [{id:'spotlight',title:'The evening edit',items:movies.slice(0,12)},{id:'series',title:'One more episode',items:tv},{id:'scifi',title:'Beyond the ordinary',items:movies.filter(t=>t.genres.includes('Science Fiction')||t.genres.includes('Fantasy'))},{id:'drama',title:'Stories that stay with you',items:movies.filter(t=>t.genres.includes('Drama'))},{id:'action',title:'A little adrenaline',items:movies.filter(t=>t.genres.includes('Action')||t.genres.includes('Adventure'))},{id:'family',title:'For everyone on the sofa',items:movies.filter(t=>t.genres.includes('Animation')||t.genres.includes('Family'))},{id:'comedy',title:'A lighter evening',items:demoTitles.filter(t=>t.genres.includes('Comedy'))},{id:'thriller',title:'On the edge of your seat',items:movies.filter(t=>t.genres.includes('Thriller')||t.genres.includes('Crime'))}].filter(r=>r.items.length);
 }
 const queries=[['trending','Trending now','trending/movie/week',{}],['tv','Series worth discovering','trending/tv/week',{}],['acclaimed','Highly rated films','movie/top_rated',{}],['new','Now in cinemas','movie/now_playing',{}],['scifi','Beyond the ordinary','discover/movie',{with_genres:878,sort_by:'popularity.desc'}],['drama','Stories that stay with you','discover/movie',{with_genres:18,sort_by:'vote_count.desc'}],['family','For everyone on the sofa','discover/movie',{with_genres:16,sort_by:'popularity.desc'}],['returning','New and returning series','tv/on_the_air',{}]] as const;
 return Promise.all(queries.map(async([id,title,path,params])=>({id,title,items:pageResult(await this.request(path,params),path.includes('/tv')||path.startsWith('tv/')?'tv':'movie').items})));
 }
 async discover(kind:Kind,genre?:string,sort='popularity.desc',page=1):Promise<Page>{
 page=Math.max(1,Math.min(500,Math.floor(page)||1));
 if(this.mode==='demo'){
 let items=demoTitles.filter(t=>t.kind===kind&&(!genre||genre==='All'||t.genres.includes(genre)));
 if(sort==='primary_release_date.desc'||sort==='first_air_date.desc')items=[...items].sort((a,b)=>b.year.localeCompare(a.year));
 if(sort==='original_title.asc')items=[...items].sort((a,b)=>a.title.localeCompare(b.title));
 return {items:items.slice((page-1)*20,page*20),page,totalPages:Math.max(1,Math.ceil(items.length/20))};
 }
 const params:Record<string,string|number>={page,sort_by:sort,include_adult:'false','vote_count.gte':sort==='vote_average.desc'?100:10};
 const genres=kind==='movie'?movieGenres:tvGenres;if(genre&&genres[genre])params.with_genres=genres[genre];
 return pageResult(await this.request(`discover/${kind}`,params),kind);
 }
 async search(query:string,page=1):Promise<Page>{
 query=query.trim();if(!query)return {items:[],page:1,totalPages:0};
 if(this.mode==='demo'){const items=demoTitles.filter(t=>t.title.toLowerCase().includes(query.toLowerCase()));return{items:items.slice((page-1)*20,page*20),page,totalPages:Math.ceil(items.length/20)};}
 return pageResult(await this.request('search/multi',{query,page:Math.max(1,Math.min(500,page)),include_adult:'false'}));
 }
 async detail(title:Title):Promise<Detail>{
 if(this.mode==='demo'){
 const seasonNumbers=Object.keys(demoEpisodes).filter(k=>k.startsWith(`${title.id}:`)).map(k=>Number(k.split(':')[1])).sort();
 return {...title,episodes:seasonNumbers.length?await this.season(title,seasonNumbers[0]):[],seasonNumbers,related:demoTitles.filter(t=>t.id!==title.id&&t.kind===title.kind&&t.genres.some(g=>title.genres.includes(g))).slice(0,14)};
 }
 const raw=await this.request(`${title.kind}/${title.id}`,{append_to_response:'credits,recommendations,videos'});const record=normalize(raw,title.kind);if(!record)throw new Error('TMDB detail unavailable. Please try again.');
 const seasonNumbers=(raw.seasons||[]).map((s:any)=>s.season_number).filter((n:number)=>n>0);
 return {...record,episodes:seasonNumbers.length?await this.season(record,seasonNumbers[0]):[],seasonNumbers,related:pageResult({results:raw.recommendations?.results||[]},title.kind).items,trailers:raw.videos?.results?.filter((v:any)=>v.type==='Trailer').slice(0,3)};
 }
 async season(title:Title,season:number):Promise<Episode[]>{
 if(this.mode==='demo')return demoEpisodes[`${title.id}:${season}`]||[];
 const raw=await this.request(`tv/${title.id}/season/${season}`);
 return (raw.episodes||[]).filter((e:any)=>e.id&&e.name).map((e:any)=>({id:e.id,season:e.season_number,number:e.episode_number,title:e.name,overview:e.overview||'',runtime:e.runtime||null,still:e.still_path||null}));
 }
}
