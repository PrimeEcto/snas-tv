import React,{useReducer,useState,useEffect,useRef} from 'react';
import {View,Text,Pressable,StyleSheet,BackHandler,ScrollView} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {Catalog} from '../catalog/service';
import type {Title,Episode} from '../catalog/types';
import {createPlayback,playbackReducer,formatTime,type PlaybackState} from '../state/playback';
import type {Library} from '../state/library';
import {Artwork,Button,LinearGradient} from './controls';
import {FocusScope} from './focus';
import {C} from './theme';
type Menu='audio'|'subtitles'|'settings'|'episodes'|null;
export function PlayerScreen({title,episode,position,catalog,preferences,onSave,onExit,onEpisode}:{title:Title;episode?:Episode;position:number;catalog:Catalog;preferences:Library['preferences'];onSave:(s:PlaybackState)=>void;onExit:(s:PlaybackState)=>void;onEpisode:(e:Episode)=>void}){
 const [state,dispatch]=useReducer(playbackReducer,undefined,()=>({...createPlayback(title,episode,position),...preferences}));const [menu,setMenu]=useState<Menu>(null);const [episodes,setEpisodes]=useState<Episode[]>([]);const [error,setError]=useState('');const lastInteraction=useRef(Date.now());const latest=useRef(state);latest.current=state;const saveRef=useRef(onSave);saveRef.current=onSave;
 const reveal=()=>{lastInteraction.current=Date.now();dispatch({type:'controls',visible:true});};
 useTVEventHandler(event=>{if(event.eventKeyAction===1||event.eventType==='focus'||event.eventType==='blur')return;
 if(event.eventType==='playPause')dispatch({type:'toggle'});
 if(event.eventType==='rewind')dispatch({type:'seek',delta:-10});
 if(event.eventType==='fastForward')dispatch({type:'seek',delta:10});
 if(event.eventType!=='back')reveal();
 });
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(menu){setMenu(null);reveal();}else if(state.controls){dispatch({type:'controls',visible:false});}else onExit(latest.current);return true;});return()=>sub.remove();},[menu,state.controls,onExit]);
 useEffect(()=>{let last=Date.now();const timer=setInterval(()=>{const now=Date.now();dispatch({type:'tick',seconds:Math.min(2,(now-last)/1000)});last=now;if(!menu&&latest.current.playing&&now-lastInteraction.current>6000)dispatch({type:'controls',visible:false});},1000);return()=>clearInterval(timer);},[menu]);
 useEffect(()=>{const timer=setInterval(()=>saveRef.current(latest.current),5000);return()=>{clearInterval(timer);saveRef.current(latest.current);};},[]);
 useEffect(()=>{if(!episode)return;let alive=true;catalog.season(title,episode.season).then(e=>{if(alive)setEpisodes(e);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[catalog,title.id,episode?.season]);
 const next=episode?episodes.find(e=>e.number===episode.number+1):undefined;
 const nextStarted=useRef(false);useEffect(()=>{if(state.completed&&next&&!nextStarted.current){nextStarted.current=true;onSave(state);onEpisode(next);}},[state.completed,next,onEpisode,onSave]);
 const open=(m:Menu)=>{reveal();setMenu(m);};
 const selectOption=(value:string)=>{if(menu==='audio')dispatch({type:'audio',value});if(menu==='subtitles')dispatch({type:'subtitles',value});if(menu==='settings')dispatch({type:'speed',value:Number(value)});setMenu(null);reveal();};
 const menuOptions=menu==='audio'?['Original (simulated)','English (simulated)']:menu==='subtitles'?['Off','English (simulated)','Español (simulated)']:menu==='settings'?['0.5','1','1.5','2']:[];
 const selection=menu==='audio'?state.audio:menu==='subtitles'?state.subtitles:String(state.speed);
 return <View style={{flex:1,backgroundColor:C.bg}}>
 <Artwork title={title} kind="backdrop" style={StyleSheet.absoluteFill}/><View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.23)'}]}/>
 <Text style={{position:'absolute',top:33,left:56,fontSize:14,color:C.text,opacity:0.85}}>SNAS · SIMULATED PREVIEW</Text>
 {state.subtitles!=='Off'&&<Text style={{position:'absolute',bottom:state.controls?235:70,alignSelf:'center',paddingHorizontal:20,paddingVertical:10,backgroundColor:'rgba(0,0,0,.7)',color:C.text,fontSize:19,borderRadius:0}}>{state.subtitles} · No media track is playing.</Text>}
 {!state.controls&&!menu&&<Pressable testID="player-reveal" accessibilityLabel="Show playback controls" hasTVPreferredFocus onPress={reveal} style={StyleSheet.absoluteFill}/>}
 <FocusScope active={state.controls&&!menu} initial="player-toggle">
 <LinearGradient colors={['transparent','rgba(12,16,21,0.88)',C.bg]} locations={[0,0.45,1]} style={{position:'absolute',left:0,right:0,bottom:0,height:325}}/>
 <View style={{paddingHorizontal:56,paddingBottom:38,marginTop:'auto'}}>
 <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:17}}><View style={{maxWidth:900}}><Text numberOfLines={1} style={{fontSize:29,color:C.text,fontWeight:'600'}}>{title.title}</Text>{episode&&<Text numberOfLines={1} style={{fontSize:18,color:C.muted,marginTop:7}}>Season {episode.season} · Episode {episode.number} — {episode.title}</Text>}</View><Button id="player-exit" compact icon="close" label="Exit" onPress={()=>onExit(latest.current)}/></View>
 <View style={{height:5,borderRadius:0,backgroundColor:C.line,marginBottom:10}}><View style={{width:`${state.position/state.duration*100}%`,height:5,backgroundColor:C.accent,borderRadius:0}}/></View>
 <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:20}}><Text style={{fontSize:15,color:C.muted}}>{formatTime(state.position)}</Text><Text style={{fontSize:15,color:C.muted}}>{formatTime(state.duration-state.position)} remaining</Text></View>
 <View style={{flexDirection:'row',gap:10,alignItems:'center'}}>
 <Button id="player-rewind" compact icon="rewind" label="−10 sec" onFocus={reveal} onPress={()=>{dispatch({type:'seek',delta:-10});reveal();}}/>
 <Button id="player-toggle" primary icon={state.playing?'pause':'play'} label={state.playing?'Pause':state.completed?'Replay':'Play'} onFocus={reveal} onPress={()=>{dispatch({type:'toggle'});reveal();}}/>
 <Button id="player-forward" compact icon="forward" label="+10 sec" onFocus={reveal} onPress={()=>{dispatch({type:'seek',delta:10});reveal();}}/>
 <View style={{flex:1}}/>
 <Button id="player-audio" compact icon="audio" label="Audio" onFocus={reveal} onPress={()=>open('audio')}/>
 <Button id="player-subtitles" compact icon="subtitles" label="Subtitles" onFocus={reveal} onPress={()=>open('subtitles')}/>
 <Button id="player-settings" compact icon="settings" label="Speed" onFocus={reveal} onPress={()=>open('settings')}/>
 {episode&&<Button id="player-episodes" compact label="Episodes" onFocus={reveal} onPress={()=>open('episodes')}/>}</View>
 {next&&<View style={{alignItems:'flex-end',marginTop:15}}><Button id="player-next" compact icon="next" label="Next episode" onFocus={reveal} onPress={()=>{onSave(state);onEpisode(next);}}/></View>}
 <Text style={{color:C.dim,fontSize:13,marginTop:13}}>This interactive preview simulates playback. Audio and subtitle choices are demonstrations.</Text>
 </View></FocusScope>
 {menu&&<View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(5,8,12,0.72)',alignItems:'flex-end'}]}><View style={{width:460,height:'100%',backgroundColor:C.surface,padding:35}}><FocusScope initial="menu-close"><View style={{alignItems:'flex-start',marginBottom:32}}><Button id="menu-close" compact icon="back" label="Close" onPress={()=>{setMenu(null);reveal();}}/></View><Text style={{fontSize:33,color:C.text,fontWeight:'600',marginBottom:16}}>{menu==='episodes'?'Choose an episode':menu==='settings'?'Playback speed':menu==='audio'?'Audio tracks':'Subtitles'}</Text><Text style={{color:C.muted,fontSize:17,lineHeight:25,marginBottom:25}}>{menu==='episodes'?`Season ${episode?.season}`:'Simulated choices for this preview.'}</Text><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{gap:12}}>
 {menuOptions.map(option=><Button key={option} id={`option-${option}`} label={menu==='settings'?`${option}×`:option} icon={selection===option?'check':undefined} primary={selection===option} onPress={()=>selectOption(option)}/>)}
 {menu==='episodes'&&episodes.map(e=><Button key={e.id} id={`player-episode-${e.number}`} label={`${e.number}. ${e.title}`} primary={e.id===episode?.id} onPress={()=>{onSave(state);onEpisode(e);}}/>)}
 {error&&<Text style={{color:C.error,fontSize:17,lineHeight:25}}>{error}</Text>}</ScrollView></FocusScope></View></View>}
 </View>;
}
