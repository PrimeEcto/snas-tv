import React,{useState,useEffect,useRef} from 'react';
import {View,Text,ScrollView,FlatList,StyleSheet} from 'react-native';
import {Catalog,demoTitles,movieGenres,tvGenres} from '../catalog/service';
import type {Title,Rail as RailData,Kind} from '../catalog/types';
import type {Library,Progress} from '../state/library';
import {continueWatching} from '../state/library';
import {Artwork,Button,Meta,Rail,Card,LinearGradient,Empty} from './controls';
import {C} from './theme';
import {useFocusTarget} from './focus';
type Props={catalog:Catalog;library:Library;onOpen:(t:Title)=>void;onPlay:(t:Title)=>void;onResume:(p:Progress)=>void;onToggle:(t:Title)=>void;onExplore:()=>void;onDemo:()=>void};
export function HomeScreen(p:Props){
 const [rails,setRails]=useState<RailData[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const scroll=useRef<ScrollView>(null);const rowYs=useRef<Record<string,number>>({});
 const load=()=>{setLoading(true);setError('');p.catalog.home().then(setRails).catch(e=>setError(e.message)).finally(()=>setLoading(false));};
 useEffect(load,[p.catalog]);
 const featured=rails[0]?.items.find(t=>t.id===157336)||rails[0]?.items[0]||demoTitles[0];
 const saved=p.library.watchlist.some(t=>t.id===featured.id&&t.kind===featured.kind);
 const progress=continueWatching(p.library);
 return <ScrollView ref={scroll} style={{flex:1}} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:45}}>
 <View style={{height:418}}>
 <Artwork title={featured} kind="backdrop" style={{position:'absolute',left:310,right:0,top:0,height:470}}/>
 <LinearGradient colors={[C.bg,'rgba(12,16,21,0.82)','rgba(12,16,21,0)']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFill}/>
 <LinearGradient colors={['rgba(12,16,21,0)',C.bg]} start={{x:0,y:0}} end={{x:0,y:1}} style={{position:'absolute',left:0,right:0,top:300,height:170}}/>
 <View style={{paddingLeft:56,paddingTop:53,width:600}}>
 <Text numberOfLines={2} style={{fontSize:57,lineHeight:62,color:C.text,fontWeight:'700',letterSpacing:-1.5,marginBottom:18}}>{featured.title}</Text>
 <Meta title={featured}/>
 <Text numberOfLines={3} style={{fontSize:19,lineHeight:28,color:C.muted,marginTop:19,marginBottom:25,maxWidth:490}}>{featured.overview}</Text>
 <View style={{flexDirection:'row',gap:12}}><Button id="home-play" label="Play preview" icon="play" primary onPress={()=>p.onPlay(featured)}/><Button id="home-details" label="View details" onPress={()=>p.onOpen(featured)}/><Button id="home-save" label={saved?'Saved':'My List'} icon={saved?'check':'plus'} onPress={()=>p.onToggle(featured)}/></View>
 </View></View>
 {error&&<View style={{marginHorizontal:56,marginBottom:24,padding:20,backgroundColor:C.surface,borderRadius:0}}><Text style={{color:C.error,fontSize:18,marginBottom:16}}>{error}</Text><View style={{flexDirection:'row',gap:12}}><Button id="home-retry" label="Try again" onPress={load}/><Button id="home-demo" label="Use sample catalog" onPress={p.onDemo}/></View></View>}
 {loading&&<View style={{marginHorizontal:56,marginBottom:30}}><Text style={{fontSize:23,color:C.muted,marginBottom:20}}>Finding your next watch…</Text><View style={{flexDirection:'row',gap:22}}>{[0,1,2,3,4,5,6].map(n=><View key={n} style={{width:130,height:190,backgroundColor:C.surface,borderRadius:0}}/>)}</View></View>}
 {progress.length>0&&<View onLayout={e=>rowYs.current.continue=e.nativeEvent.layout.y}><Rail id="continue" title="Continue watching" wide items={progress.map(x=>x.title)} progress={Object.fromEntries(progress.map(x=>[`${x.title.kind}:${x.title.id}`,x.position/x.duration]))} onOpen={title=>{const item=progress.find(x=>x.title.id===title.id&&x.title.kind===title.kind);if(item)p.onResume(item);}} onFocus={()=>scroll.current?.scrollTo({y:Math.max(0,(rowYs.current.continue||0)-30),animated:true})}/></View>}
 {rails.map(rail=><View key={rail.id} onLayout={e=>rowYs.current[rail.id]=e.nativeEvent.layout.y}><Rail {...rail} onOpen={p.onOpen} onFocus={()=>scroll.current?.scrollTo({y:Math.max(0,(rowYs.current[rail.id]||0)-28),animated:true})}/></View>)}
 <Text style={{fontSize:14,color:C.dim,marginHorizontal:56,marginTop:20}}>SNAS concept · {p.catalog.mode==='demo'?'Genuine sample catalog':'Live TMDB catalog'} · Simulated playback</Text>
 </ScrollView>;
}
export function BrowseScreen(p:Props & {kind:Kind}){
 const grid=useRef<FlatList<Title>>(null);
 const [genre,setGenre]=useState('All');const [sort,setSort]=useState('popularity.desc');const [items,setItems]=useState<Title[]>([]);const [page,setPage]=useState(1);const [total,setTotal]=useState(1);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [menu,setMenu]=useState<'genre'|'sort'|null>(null);const generation=useRef(0);
 const load=(next=1)=>{const gen=++generation.current;setLoading(true);setError('');p.catalog.discover(p.kind,genre,sort,next).then(result=>{if(gen!==generation.current)return;setItems(old=>next===1?result.items:[...old,...result.items.filter(t=>!old.some(x=>x.id===t.id))]);setPage(next);setTotal(result.totalPages);if(next>1&&result.items.length){const first=result.items[0];setTimeout(()=>{grid.current?.scrollToIndex({index:Math.floor(items.length/7),viewPosition:0.5,animated:true});setTimeout(()=>focusTarget(`browse-${first.kind}-${first.id}`),220);},120);}}).catch(e=>{if(gen===generation.current)setError(e.message);}).finally(()=>{if(gen===generation.current)setLoading(false);});};
 useEffect(()=>{load();return()=>{generation.current++;};},[p.catalog,p.kind,genre,sort]);
 const focusTarget=useFocusTarget();
 useEffect(()=>{const timer=setTimeout(()=>focusTarget(menu?`filter-${menu==='genre'?genre:sort}`:'genre'),180);return()=>clearTimeout(timer);},[menu]);
 const sorts=[['popularity.desc',p.catalog.mode==='demo'?'Curated':'Popular'],[p.kind==='movie'?'primary_release_date.desc':'first_air_date.desc','Newest'],...(p.catalog.mode==='live'?[['vote_average.desc','Highest TMDB rating']]:[]),['original_title.asc','Title A–Z']];
 const sortName=sorts.find(x=>x[0]===sort)?.[1];
 return <View style={{flex:1,paddingHorizontal:56,paddingTop:25}}>
 <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:20}}><Text style={{fontSize:43,color:C.text,fontWeight:'600'}}>{p.kind==='movie'?'Movies':'Series'}</Text><View style={{flexDirection:'row',gap:12}}><Button id="genre" label={`Genre: ${genre}`} compact onPress={()=>setMenu(menu==='genre'?null:'genre')}/><Button id="sort" label={`Sort: ${sortName}`} compact onPress={()=>setMenu(menu==='sort'?null:'sort')}/></View></View>
 {menu&&<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{maxHeight:64}} contentContainerStyle={{gap:10,paddingBottom:20}}>{(menu==='genre'?['All',...Object.keys(p.kind==='movie'?movieGenres:tvGenres)].map(g=>[g,g]):sorts).map(([value,label])=><Button key={value} id={`filter-${value}`} label={label} compact primary={value===(menu==='genre'?genre:sort)} onPress={()=>{if(menu==='genre')setGenre(value);else setSort(value);setMenu(null);}}/>)}</ScrollView>}
 {error&&<View style={{marginBottom:20}}><Text style={{color:C.error,fontSize:18,marginBottom:10}}>{error}</Text><View style={{flexDirection:'row',gap:10}}><Button id="browse-retry" label="Try again" onPress={()=>load(page)}/><Button id="browse-demo" label="Use sample catalog" onPress={p.onDemo}/></View></View>}
 {loading&&<Text style={{color:C.muted,fontSize:18,marginBottom:15}}>Loading catalog…</Text>}
 <FlatList ref={grid} data={items} numColumns={7} keyExtractor={t=>`${t.kind}-${t.id}`} showsVerticalScrollIndicator={false} removeClippedSubviews={false} initialNumToRender={21} windowSize={5} contentContainerStyle={{paddingBottom:24}} renderItem={({item})=><Card title={item} id={`browse-${item.kind}-${item.id}`} onPress={()=>p.onOpen(item)}/>} ListEmptyComponent={!loading&&!error?<Text style={{color:C.muted,fontSize:22,marginTop:50}}>No titles in this category. Choose another genre.</Text>:null} ListFooterComponent={items.length?<View style={{alignItems:'flex-start',marginTop:18}}><Button id="browse-more" label={loading?'Loading…':page<total?'Load more titles':'Back to first title'} onPress={()=>{if(loading)return;if(page<total)load(page+1);else{grid.current?.scrollToOffset({offset:0,animated:true});setTimeout(()=>focusTarget(`browse-${p.kind}-${items[0].id}`),250);}}}/></View>:null}/>
 </View>;
}
export function MyListScreen(p:Props){
 const [section,setSection]=useState<'saved'|'continue'>('saved');const progress=continueWatching(p.library);const items=section==='saved'?p.library.watchlist:progress.map(x=>x.title);
 return <View style={{flex:1,paddingTop:25}}><View style={{marginHorizontal:56,flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:22}}><Text style={{fontSize:43,color:C.text,fontWeight:'600'}}>Your collection</Text><View style={{flexDirection:'row',gap:10}}><Button id="list-saved" label={`My List (${p.library.watchlist.length})`} compact primary={section==='saved'} onPress={()=>setSection('saved')}/><Button id="list-continue" label={`Continue watching (${progress.length})`} compact primary={section==='continue'} onPress={()=>setSection('continue')}/></View></View>
 {!items.length?<Empty title={section==='saved'?'Make it your movie night.':'Your next chapter starts here.'} body={section==='saved'?'Save films and series with My List. Your collection will be waiting when you return.':'Start a preview and your progress will appear here, ready to resume.'} action={p.onExplore}/>:<FlatList style={{marginHorizontal:52}} data={items} numColumns={7} removeClippedSubviews={false} keyExtractor={t=>`${t.kind}-${t.id}`} renderItem={({item})=><Card title={item} id={`list-${item.kind}-${item.id}`} progress={section==='continue'?progress.find(x=>x.title.id===item.id&&x.title.kind===item.kind)!.position/progress.find(x=>x.title.id===item.id&&x.title.kind===item.kind)!.duration:undefined} onPress={()=>{const entry=progress.find(x=>x.title.id===item.id&&x.title.kind===item.kind);if(section==='continue'&&entry)p.onResume(entry);else p.onOpen(item);}}/>}/>}</View>;
}
