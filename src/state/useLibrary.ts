import {useState,useEffect,useRef,useCallback} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {emptyLibrary,parseLibrary,toggleSaved,saveProgress,type Library} from './library';
import type {Title} from '../catalog/types';
import type {PlaybackState} from './playback';
const KEY='snas.library.v1';
export function useLibrary(){
 const [library,setLibrary]=useState<Library>(emptyLibrary);const [ready,setReady]=useState(false);const [error,setError]=useState('');const writes=useRef(Promise.resolve());
 useEffect(()=>{let alive=true;AsyncStorage.getItem(KEY).then(value=>{if(alive)setLibrary(parseLibrary(value));}).catch(()=>{if(alive)setError('Your saved library could not be loaded. Try restarting SNAS.');}).finally(()=>{if(alive)setReady(true);});return()=>{alive=false;};},[]);
 useEffect(()=>{if(!ready)return;writes.current=writes.current.catch(()=>{}).then(()=>AsyncStorage.setItem(KEY,JSON.stringify(library))).catch(()=>setError('Changes could not be saved on this device.'));},[library,ready]);
 const toggle=useCallback((title:Title)=>setLibrary(l=>toggleSaved(l,title)),[]);
 const save=useCallback((state:PlaybackState)=>setLibrary(l=>({...saveProgress(l,state),preferences:{audio:state.audio,subtitles:state.subtitles,speed:state.speed}})),[]);
 return {library,ready,error,toggle,save};
}
