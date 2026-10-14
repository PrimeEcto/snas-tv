import {useEffect,useRef} from 'react';
import {DeviceEventEmitter} from 'react-native';
/**
 * Android key codes mapped onto the TV event names the shared screens already switch on.
 *
 * The D-pad and select codes are in here as well as the media buttons: the player reveals its
 * controls on any key that is not Back, so a viewer whose bar has faded presses an arrow, exactly as
 * they would on a Fire TV remote.
 */
const KEY_NAMES:Record<number,string>={
 4:'back',19:'up',20:'down',21:'left',22:'right',23:'select',66:'select',82:'menu',
 85:'playPause',89:'rewind',90:'fastForward',126:'play',127:'pause',
};
export type TVEvent={eventType:string;eventKeyAction?:number};
/**
 * Android/Fire OS counterpart of the Vega Kepler `useTVEventHandler`.
 *
 * Navigation itself needs nothing from here: on Android the focused view receives the D-pad and
 * select keys natively, so browsing works without any of this. Keys the app must *observe* rather
 * than merely navigate with are a different matter — plain React Native never forwards them to
 * JavaScript, so `MainActivity` reports every key to the device event emitter (see
 * `RemoteKeys.kt`) and this hook turns those reports into the event names callers expect.
 *
 * `eventKeyAction` follows the platform convention the callers already assume: 0 for a key going
 * down, 1 for it coming up.
 */
export function useTVEventHandler(handler:(event:TVEvent)=>void):void{
 const latest=useRef(handler);latest.current=handler;
 useEffect(()=>{
  const emit=(action:number)=>(raw:{keyCode?:number})=>{
   const name=raw&&raw.keyCode!==undefined?KEY_NAMES[raw.keyCode]:undefined;
   if(!name)return;
   try{latest.current({eventType:name,eventKeyAction:action});}catch{}
  };
  const down=DeviceEventEmitter.addListener('keyDown',emit(0));
  const up=DeviceEventEmitter.addListener('keyUp',emit(1));
  return ()=>{down.remove();up.remove();};
 },[]);
}
