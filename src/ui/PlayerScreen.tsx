import React,{useReducer,useState,useEffect,useRef,useCallback} from 'react';
import {View,Text,Pressable,StyleSheet,BackHandler,ScrollView,ActivityIndicator} from 'react-native';
import {useTVEventHandler} from 'snas-tv';
import {PlayerSurface} from 'snas-player';
import {loadWatch,subtitleUrl,type WatchResult} from '../player';
import {Catalog} from '../catalog/service';
import type {Title,Episode} from '../catalog/types';
import {ASPECT_LABELS,ASPECT_MODES,ASPECT_NOTES,createPlayback,playbackReducer,formatTime,resizeModeFor,validAspect,type PlaybackState} from '../state/playback';
import type {Library} from '../state/library';
import {Artwork,Button,LinearGradient} from './controls';
import {FocusScope} from './focus';
import {C} from './theme';
type Menu='audio'|'subtitles'|'quality'|'aspect'|'settings'|'episodes'|null;
/** How long a stream may sit before the player before the preview clock takes the screen back. */
const STREAM_WAIT_MS=25000;
// 1080p is the default because it is what a Fire TV stick renders natively; anything higher is a
// deliberate choice from the quality menu, since 2160p costs decode headroom for no visible gain.
const DEFAULT_QUALITY='1080p';
/** Highest first, so the menu reads the way a viewer expects and the default falls out of it. */
function byQuality(sources:WatchResult['sources']){return [...sources].sort((a,b)=>(Number.parseInt(b.quality,10)||0)-(Number.parseInt(a.quality,10)||0));}
function defaultQuality(sources:WatchResult['sources']){const sorted=byQuality(sources);return (sorted.find(s=>s.quality===DEFAULT_QUALITY)??sorted[0])?.quality??'';}
export function PlayerScreen({title,episode,position,catalog,preferences,onSave,onExit,onEpisode}:{title:Title;episode?:Episode;position:number;catalog:Catalog;preferences:Library['preferences'];onSave:(s:PlaybackState)=>void;onExit:(s:PlaybackState)=>void;onEpisode:(e:Episode)=>void}){
 const [state,dispatch]=useReducer(playbackReducer,undefined,()=>({...createPlayback(title,episode,position),...preferences}));const [menu,setMenu]=useState<Menu>(null);const [episodes,setEpisodes]=useState<Episode[]>([]);const [error,setError]=useState('');
 // Playback itself: the sources the backend returned, the one actually selected, and the state of
 // the platform surface. `live` flips once a real media element reports a clock of its own.
 const [media,setMedia]=useState<WatchResult|null>(null);const [streamError,setStreamError]=useState('');const [quality,setQuality]=useState('');const [subtitleId,setSubtitleId]=useState('');const [seek,setSeek]=useState<{target:number;serial:number}|null>(null);const [live,setLive]=useState(false);const [slow,setSlow]=useState(false);
 const lastInteraction=useRef(Date.now());const latest=useRef(state);latest.current=state;const saveRef=useRef(onSave);saveRef.current=onSave;const resumeAt=useRef(position);const resumed=useRef(false);
 const reveal=()=>{lastInteraction.current=Date.now();dispatch({type:'controls',visible:true});};
 // Reading this session's identity into scalars first keeps the effects below honest about what they
 // depend on, so a re-render with the same title and episode never refetches the stream.
 const {id:titleId,kind:titleKind,title:titleName,year:titleYear}=title;
 const episodeSeason=episode?.season;const episodeNumber=episode?.number;const preferredSubtitle=preferences.subtitles;
 // Ask the backend for playable sources and the subtitle menu whenever the title or episode changes.
 // A failure is shown on screen and leaves the preview timeline in place, so the screen always works.
 useEffect(()=>{let alive=true;setMedia(null);setStreamError('');setLive(false);setQuality('');setSubtitleId('');resumed.current=false;
  loadWatch({id:titleId,kind:titleKind,title:titleName,year:titleYear},episodeSeason!==undefined&&episodeNumber!==undefined?{season:episodeSeason,number:episodeNumber}:undefined).then(result=>{if(!alive)return;
   if(!result){setStreamError('No playable source came back for this title.');return;}
   setMedia(result);setQuality(defaultQuality(result.sources));
   // A subtitle choice is remembered across sessions, but only when this release actually offers it.
   const wanted=preferredSubtitle;
   setSubtitleId(wanted&&result.subtitleGroups.some(g=>g.language===wanted)?wanted:'');
  }).catch(()=>{if(alive)setStreamError('The stream could not be reached.');});
  return()=>{alive=false;};},[titleId,titleKind,titleName,titleYear,episodeSeason,episodeNumber,preferredSubtitle]);
 const selected=media?.sources.find(s=>s.quality===quality)??media?.sources[0];
 const subtitleUri=media&&subtitleId?subtitleUrl(subtitleId,title.id,title.kind):undefined;
 // Nothing has decoded yet, so there is no clock to show: the source is still being found, or the
 // player is still opening it. The preview tick is held back until the surface reports, because
 // otherwise the bar climbs immediately and then snaps back to the stream's own position.
 const loading=!streamError&&!live&&(media===null||!!selected);
 // The wait is bounded: a stream that never reports must not leave the viewer on a spinner for
 // good, and what follows it is the same preview clock this screen already falls back to.
 const buffering=loading&&!slow;
 // The surface is the authority while it decodes: its clock replaces the tick, and its first report
 // is what resumes a partially watched title at the position the library saved for it.
 const onProgress=useCallback((progress:{position:number;duration:number})=>{setLive(true);dispatch({type:'media',position:progress.position,duration:progress.duration});
  if(!resumed.current){resumed.current=true;if(resumeAt.current>5)setSeek(old=>({target:resumeAt.current,serial:(old?.serial??0)+1}));}},[]);
 const onEnded=useCallback(()=>dispatch({type:'media',position:latest.current.duration,duration:latest.current.duration}),[]);
 const onStreamError=useCallback((message:string)=>{setStreamError(message);setLive(false);},[]);
 const jump=useCallback((delta:number)=>{const target=Math.max(0,Math.min(latest.current.duration,latest.current.position+delta));dispatch({type:'seek',delta});setSeek(old=>({target,serial:(old?.serial??0)+1}));lastInteraction.current=Date.now();dispatch({type:'controls',visible:true});},[]);
 useTVEventHandler(event=>{if(event.eventKeyAction===1||event.eventType==='focus'||event.eventType==='blur')return;
 if(event.eventType==='playPause')dispatch({type:'toggle'});
 if(event.eventType==='rewind')jump(-10);
 if(event.eventType==='fastForward')jump(10);
 if(event.eventType!=='back')reveal();
 });
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(menu){setMenu(null);reveal();}else if(state.controls){dispatch({type:'controls',visible:false});}else onExit(latest.current);return true;});return()=>sub.remove();},[menu,state.controls,onExit]);
 useEffect(()=>{if(!loading){setSlow(false);return;}const timer=setTimeout(()=>setSlow(true),STREAM_WAIT_MS);return()=>clearTimeout(timer);},[loading]);
 // Two clocks, never both: a live surface reports its own position, and while the source is being
 // loaded neither runs, so the preview tick is only a fallback for when nothing is decoding at all
 // (no source, no network, or a platform without a player).
 useEffect(()=>{if(live||buffering)return;let last=Date.now();const timer=setInterval(()=>{const now=Date.now();dispatch({type:'tick',seconds:Math.min(2,(now-last)/1000)});last=now;},1000);return()=>clearInterval(timer);},[live,buffering]);
 useEffect(()=>{const timer=setInterval(()=>{if(!menu&&latest.current.playing&&Date.now()-lastInteraction.current>6000)dispatch({type:'controls',visible:false});},1000);return()=>clearInterval(timer);},[menu]);
 useEffect(()=>{const timer=setInterval(()=>saveRef.current(latest.current),5000);return()=>{clearInterval(timer);saveRef.current(latest.current);};},[]);
 useEffect(()=>{if(episodeSeason===undefined)return;let alive=true;catalog.season(title,episodeSeason).then(e=>{if(alive)setEpisodes(e);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[catalog,title,episodeSeason]);
 const next=episode?episodes.find(e=>e.number===episode.number+1):undefined;
 const nextStarted=useRef(false);useEffect(()=>{if(state.completed&&next&&!nextStarted.current){nextStarted.current=true;onSave(latest.current);onEpisode(next);}},[state.completed,next,onEpisode,onSave]);
 const open=(m:Menu)=>{reveal();setMenu(m);};
 const selectOption=(value:string)=>{
  if(menu==='audio')dispatch({type:'audio',value});
  if(menu==='subtitles'){setSubtitleId(value==='Off'?'':value);dispatch({type:'subtitles',value});}
  if(menu==='quality')setQuality(value);
  if(menu==='settings')dispatch({type:'speed',value:Number(value)});
  if(menu==='aspect'&&validAspect(value))dispatch({type:'aspect',value});
  setMenu(null);reveal();
 };
 const audioOptions=media?['Original']:['Original (simulated)','English (simulated)'];
 const subtitleOptions=media?['Off',...media.subtitleGroups.map(g=>g.language)]:['Off','English (simulated)','Español (simulated)'];
 const qualityOptions=media?byQuality(media.sources).map(s=>s.quality):['Auto (simulated)'];
 const menuOptions:string[]=menu==='audio'?audioOptions:menu==='subtitles'?subtitleOptions:menu==='quality'?qualityOptions:menu==='settings'?['0.5','1','1.5','2']:menu==='aspect'?[...ASPECT_MODES]:[];
 const selection=menu==='audio'?state.audio:menu==='subtitles'?state.subtitles:menu==='quality'?quality:menu==='aspect'?state.aspect:String(state.speed);
 const menuTitle=menu==='episodes'?'Choose an episode':menu==='settings'?'Playback speed':menu==='quality'?'Stream quality':menu==='audio'?'Audio tracks':menu==='aspect'?'Screen fit':'Subtitles';
 const menuNote=menu==='episodes'?`Season ${episode?.season}`:media&&menu==='subtitles'?`${media.subtitleCount} subtitles in ${media.subtitleGroups.length} languages, served as WebVTT.`:media&&menu==='quality'?'Each quality is a separate stream from the same server.':menu==='aspect'?'These streams are wider than a 16:9 screen — the choice is remembered for every title.':'Simulated choices for this preview.';
 const footer=live?`Streaming ${selected?.quality??''} from the SNAS backend${media?.provider?` · ${media.provider}`:''}.`:buffering?`Waiting for the ${selected?.quality??''} stream to start.`:streamError||'This interactive preview simulates playback. Audio and subtitle choices are demonstrations.';
 return <View style={{flex:1,backgroundColor:C.bg}}>
 {selected?<PlayerSurface uri={selected.url} headers={media?.headers} subtitleUri={subtitleUri} paused={!state.playing} rate={state.speed} resizeMode={resizeModeFor(state.aspect)} seekTo={live&&seek?seek.target:undefined} style={StyleSheet.absoluteFill} onProgress={onProgress} onEnded={onEnded} onError={onStreamError}/>:<Artwork title={title} kind="backdrop" style={StyleSheet.absoluteFill}/>}
 {!selected&&<View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.23)'}]}/>}
 {buffering&&<View testID="player-buffering" accessibilityLabel={`Loading the ${selected?.quality??''} stream`} pointerEvents="none" style={{position:'absolute',left:0,right:0,top:0,bottom:0,justifyContent:'center',alignItems:'center'}}><ActivityIndicator size="large" color={C.accent}/><Text style={{fontSize:19,color:C.text,marginTop:20}}>Loading {selected?.quality??'the stream'}…</Text></View>}
 <Text style={{position:'absolute',top:33,left:56,fontSize:14,color:C.text,opacity:0.85}}>{live?`SNAS · LIVE · ${selected?.quality??''}`:buffering?'SNAS · LOADING':'SNAS · SIMULATED PREVIEW'}</Text>
 {streamError&&<Text testID="player-error" style={{position:'absolute',top:58,left:56,fontSize:15,color:C.error,maxWidth:820}}>{streamError}</Text>}
 {!live&&!buffering&&state.subtitles!=='Off'&&<Text style={{position:'absolute',bottom:state.controls?235:70,alignSelf:'center',paddingHorizontal:20,paddingVertical:10,backgroundColor:'rgba(0,0,0,.7)',color:C.text,fontSize:19,borderRadius:0}}>{state.subtitles} · No media track is playing.</Text>}
 {!state.controls&&!menu&&<Pressable testID="player-reveal" accessibilityLabel="Show playback controls" hasTVPreferredFocus onPress={reveal} style={StyleSheet.absoluteFill}/>}
 <FocusScope active={state.controls&&!menu} initial="player-toggle">
 <LinearGradient colors={['transparent','rgba(12,16,21,0.88)',C.bg]} locations={[0,0.45,1]} style={{position:'absolute',left:0,right:0,bottom:0,height:325}}/>
 <View style={{paddingHorizontal:56,paddingBottom:38,marginTop:'auto'}}>
 <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:17}}><View style={{maxWidth:900}}><Text numberOfLines={1} style={{fontSize:29,color:C.text,fontWeight:'600'}}>{title.title}</Text>{episode&&<Text numberOfLines={1} style={{fontSize:18,color:C.muted,marginTop:7}}>Season {episode.season} · Episode {episode.number} — {episode.title}</Text>}</View><Button id="player-exit" compact icon="close" label="Exit" onPress={()=>onExit(latest.current)}/></View>
 {buffering?<View style={{flexDirection:'row',alignItems:'center',gap:13,marginBottom:25}}><ActivityIndicator size="small" color={C.accent}/><Text style={{fontSize:15,color:C.muted}}>The timeline appears when the stream is ready.</Text></View>:<>
 <View style={{height:5,borderRadius:0,backgroundColor:C.line,marginBottom:10}}><View style={{width:`${state.position/state.duration*100}%`,height:5,backgroundColor:C.accent,borderRadius:0}}/></View>
 <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:20}}><Text testID="player-position" style={{fontSize:15,color:C.muted}}>{formatTime(state.position)}</Text><Text style={{fontSize:15,color:C.muted}}>{formatTime(state.duration-state.position)} remaining</Text></View>
 </>}
 <View style={{flexDirection:'row',gap:10,alignItems:'center'}}>
 <Button id="player-rewind" compact icon="rewind" label="−10 sec" onFocus={reveal} onPress={()=>jump(-10)}/>
 <Button id="player-toggle" primary icon={state.playing?'pause':'play'} label={state.playing?'Pause':state.completed?'Replay':'Play'} onFocus={reveal} onPress={()=>{dispatch({type:'toggle'});reveal();}}/>
 <Button id="player-forward" compact icon="forward" label="+10 sec" onFocus={reveal} onPress={()=>jump(10)}/>
 <View style={{flex:1}}/>
 <Button id="player-audio" compact icon="audio" label="Audio" onFocus={reveal} onPress={()=>open('audio')}/>
 <Button id="player-subtitles" compact icon="subtitles" label="Subtitles" onFocus={reveal} onPress={()=>open('subtitles')}/>
 <Button id="player-quality" compact label={selected?.quality??'Quality'} onFocus={reveal} onPress={()=>open('quality')}/>
 <Button id="player-aspect" compact label={ASPECT_LABELS[state.aspect]} onFocus={reveal} onPress={()=>open('aspect')}/>
 <Button id="player-settings" compact icon="settings" label="Speed" onFocus={reveal} onPress={()=>open('settings')}/>
 {episode&&<Button id="player-episodes" compact label="Episodes" onFocus={reveal} onPress={()=>open('episodes')}/>}</View>
 {next&&<View style={{alignItems:'flex-end',marginTop:15}}><Button id="player-next" compact icon="next" label="Next episode" onFocus={reveal} onPress={()=>{onSave(state);onEpisode(next);}}/></View>}
 <Text style={{color:live||buffering?C.dim:C.error,fontSize:13,marginTop:13}}>{footer}</Text>
 </View></FocusScope>
 {menu&&<View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(5,8,12,0.72)',alignItems:'flex-end'}]}><View style={{width:460,height:'100%',backgroundColor:C.surface,padding:35}}><FocusScope initial="menu-close"><View style={{alignItems:'flex-start',marginBottom:32}}><Button id="menu-close" compact icon="back" label="Close" onPress={()=>{setMenu(null);reveal();}}/></View><Text style={{fontSize:33,color:C.text,fontWeight:'600',marginBottom:16}}>{menuTitle}</Text><Text style={{color:C.muted,fontSize:17,lineHeight:25,marginBottom:25}}>{menuNote}</Text><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{gap:12}}>
 {menuOptions.map(option=><Button key={option} id={`option-${option}`} label={menu==='settings'?`${option}×`:menu==='subtitles'&&media&&subtitleId===option?`${option.toUpperCase()} — on`:menu==='subtitles'&&media?option.toUpperCase():menu==='aspect'&&validAspect(option)?`${ASPECT_LABELS[option]} — ${ASPECT_NOTES[option]}`:option} icon={selection===option?'check':undefined} primary={selection===option} onPress={()=>selectOption(option)}/>)}
 {menu==='episodes'&&episodes.map(e=><Button key={e.id} id={`player-episode-${e.number}`} label={`${e.number}. ${e.title}`} primary={e.id===episode?.id} onPress={()=>{onSave(state);onEpisode(e);}}/>)}
 {error&&<Text style={{color:C.error,fontSize:17,lineHeight:25}}>{error}</Text>}</ScrollView></FocusScope></View></View>}
 </View>;
}
