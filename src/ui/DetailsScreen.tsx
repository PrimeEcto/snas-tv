import React,{useState,useEffect,useRef} from 'react';
import {View,Text,ScrollView,Pressable,Image,StyleSheet} from 'react-native';
import {Catalog,imageUrl} from '../catalog/service';
import type {Title,Episode,Detail} from '../catalog/types';
import type {Library} from '../state/library';
import {continueWatching} from '../state/library';
import {Artwork,Button,Meta,Rail,LinearGradient} from './controls';
import {C} from './theme';
import {useFocusNode} from './focus';
function EpisodeCard({episode,title,onSelect,onFocus}:{episode:Episode;title:Title;onSelect:()=>void;onFocus:()=>void}){
 const [focused,setFocused]=useState(false);const node=useFocusNode(`episode-${episode.season}-${episode.number}`);const [failed,setFailed]=useState(false);
 return <Pressable ref={node.ref as never} testID={`episode-${episode.season}-${episode.number}`} accessibilityRole="button" accessibilityLabel={`Play season ${episode.season} episode ${episode.number}: ${episode.title}`} onFocus={()=>{setFocused(true);node.remember();onFocus();}} onBlur={()=>setFocused(false)} onPress={onSelect} style={{width:278,marginRight:20,padding:5,borderWidth:2,borderColor:focused?C.text:'transparent',borderRadius:0}}>
 {episode.still&&!failed?<Image source={{uri:imageUrl(episode.still,'w300')}} onError={()=>setFailed(true)} style={{width:264,height:149,borderRadius:0}}/>:<Artwork title={title} kind="backdrop" style={{width:264,height:149,borderRadius:0}}/>}
 <Text numberOfLines={2} style={{fontSize:17,lineHeight:23,color:C.text,marginTop:12,fontWeight:'600'}}>{episode.number}. {episode.title}</Text><Text style={{fontSize:14,color:C.dim,marginTop:5}}>{episode.runtime?`${episode.runtime} min`:'Duration unavailable'}</Text></Pressable>;
}
export function DetailsScreen({catalog,title,library,onPlay,onToggle,onBack,onOpen,onDemo}:{catalog:Catalog;title:Title;library:Library;onPlay:(t:Title,e?:Episode)=>void;onToggle:(t:Title)=>void;onBack:()=>void;onOpen:(t:Title)=>void;onDemo:()=>void}){
 const [detail,setDetail]=useState<Detail>({...title,episodes:[],related:[],seasonNumbers:[]});const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [season,setSeason]=useState(1);const [episodes,setEpisodes]=useState<Episode[]>([]);const [selected,setSelected]=useState<Episode|undefined>();const generation=useRef(0);const scroll=useRef<ScrollView>(null);const episodeY=useRef(0);
 const load=()=>{const gen=++generation.current;setLoading(true);setError('');catalog.detail(title).then(d=>{if(gen!==generation.current)return;setDetail(d);setEpisodes(d.episodes);setSeason(d.seasonNumbers[0]||1);const last=continueWatching(library).find(p=>p.title.id===title.id&&p.title.kind===title.kind);setSelected(last?.episode||d.episodes[0]);}).catch(e=>{if(gen===generation.current)setError(e.message);}).finally(()=>{if(gen===generation.current)setLoading(false);});};
 useEffect(()=>{load();return()=>{generation.current++;};},[catalog,title.id,title.kind]);
 const changeSeason=(number:number)=>{const gen=++generation.current;setSeason(number);setLoading(true);setError('');catalog.season(title,number).then(e=>{if(gen!==generation.current)return;setEpisodes(e);setSelected(e[0]);}).catch(e=>{if(gen===generation.current)setError(e.message);}).finally(()=>{if(gen===generation.current)setLoading(false);});};
 const saved=library.watchlist.some(t=>t.id===title.id&&t.kind===title.kind);const resume=continueWatching(library).find(p=>p.title.id===title.id&&p.title.kind===title.kind&&(!selected||p.episode?.id===selected.id));
 return <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={{paddingBottom:45}} showsVerticalScrollIndicator={false}>
 <View style={{minHeight:455}}><Artwork title={detail} kind="backdrop" style={{position:'absolute',left:340,right:0,top:0,height:480}}/>
 <LinearGradient colors={[C.bg,'rgba(12,16,21,0.87)','rgba(12,16,21,0)']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFill}/><LinearGradient colors={['transparent',C.bg]} style={{position:'absolute',left:0,right:0,bottom:-30,height:150}}/>
 <View style={{paddingHorizontal:56,paddingTop:20}}><View style={{alignItems:'flex-start',marginBottom:25}}><Button id="details-back" icon="back" label="Back" compact onPress={onBack}/></View>
 <Text numberOfLines={2} style={{fontSize:52,lineHeight:59,fontWeight:'700',color:C.text,maxWidth:650,marginBottom:15}}>{detail.title}</Text><Meta title={detail}/>
 <Text style={{fontSize:18,lineHeight:27,color:C.muted,width:650,marginTop:18,marginBottom:22}}>{detail.overview||'A synopsis is not available for this title.'}</Text>
 {selected&&<Text numberOfLines={1} style={{color:C.accent,fontSize:17,marginBottom:16}}>S{selected.season} · E{selected.number} — {selected.title}</Text>}
 <View style={{flexDirection:'row',gap:12,marginBottom:25}}><Button id="details-play" icon="play" primary label={resume?'Resume preview':title.kind==='tv'&&selected?'Play episode preview':'Play preview'} onPress={()=>onPlay(detail,selected)}/><Button id="details-save" icon={saved?'check':'plus'} label={saved?'Remove from My List':'Add to My List'} onPress={()=>onToggle(detail)}/></View></View></View>
 {loading&&<Text style={{fontSize:18,color:C.muted,marginHorizontal:56,marginBottom:20}}>Loading details…</Text>}
 {error&&<View style={{marginHorizontal:56,marginBottom:24}}><Text style={{color:C.error,fontSize:18,marginBottom:12}}>{error}</Text><View style={{flexDirection:'row',gap:10}}><Button id="details-retry" label="Try again" onPress={load}/><Button id="details-demo" label="Use sample catalog" onPress={onDemo}/></View></View>}
 {title.kind==='tv'&&<View onLayout={e=>episodeY.current=e.nativeEvent.layout.y}>
 <View style={{marginHorizontal:56,flexDirection:'row',alignItems:'center',gap:15,marginBottom:18}}><Text style={{fontSize:25,color:C.text,fontWeight:'600'}}>Episodes</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10}}>{detail.seasonNumbers.map(n=><Button key={n} id={`season-${n}`} label={`Season ${n}`} compact primary={n===season} onPress={()=>changeSeason(n)}/>)}</ScrollView></View>
 {episodes.length?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingLeft:51,paddingRight:56,paddingBottom:20}}>{episodes.map(e=><EpisodeCard key={e.id} episode={e} title={detail} onSelect={()=>onPlay(detail,e)} onFocus={()=>{setSelected(e);scroll.current?.scrollTo({y:Math.max(0,episodeY.current-30),animated:true});}}/>)}</ScrollView>:!loading&&<Text style={{color:C.muted,fontSize:18,marginHorizontal:56,marginBottom:25}}>Episode metadata is unavailable in this sample. Connect TMDB for all seasons.</Text>}
 {selected?.overview&&<Text style={{fontSize:18,lineHeight:27,color:C.muted,marginHorizontal:56,marginBottom:28,maxWidth:900}}>{selected.overview}</Text>}</View>}
 {detail.cast?.length?<View style={{paddingHorizontal:56,marginTop:15,marginBottom:28}}><Text style={{fontSize:25,color:C.text,fontWeight:'600',marginBottom:12}}>The people behind the story</Text><Text style={{fontSize:18,lineHeight:29,color:C.muted}}>{detail.cast.join('  ·  ')}</Text>{detail.director&&<Text style={{fontSize:17,color:C.dim,marginTop:10}}>Directed by {detail.director}</Text>}</View>:null}
 {detail.related.length>0&&<Rail id="related" title="Stay in this world" items={detail.related} onOpen={onOpen}/>}
 {detail.trailers?.length?<View style={{marginHorizontal:56}}><Text style={{fontSize:24,color:C.text,marginBottom:10}}>Promotional videos</Text>{detail.trailers.map(v=><Text key={v.key} style={{color:C.muted,fontSize:17,lineHeight:26}}>{v.name} · {v.site} (metadata only)</Text>)}</View>:null}
 </ScrollView>;
}
