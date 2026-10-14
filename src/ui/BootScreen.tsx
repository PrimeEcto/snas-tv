import React from 'react';
import {View,Text} from 'react-native';
import {C} from './theme';
/**
 * The launch screen: what the viewer sees while the artwork home is about to show is being fetched.
 *
 * It exists because mounting the catalogue screens first means asking the network for a hundred
 * posters at once, and the drop in frames lands on the first thing you look at. Nothing else is
 * mounted until this reports done (see `App`), so the wave has the device to itself.
 *
 * `done` and `total` come straight from the preloader and are counted in images, not titles: a rail
 * can hold the same title twice, and a title with no artwork is never in the count at all.
 */
export function BootScreen({label,done,total}:{label:string;done:number;total:number}){
 const fraction=total>0?Math.max(0,Math.min(1,done/total)):0;
 const detail=total>0?`${done} of ${total} images ready`:'Preparing your library';
 return <View testID="boot-screen" accessibilityLabel={`Loading SNAS: ${detail}`} style={{flex:1,backgroundColor:C.bg,justifyContent:'center',alignItems:'center'}}>
  <Text accessibilityLabel="SNAS" style={{fontSize:62,fontWeight:'800',letterSpacing:6,color:C.text}}>SNAS</Text>
  <Text style={{fontSize:17,color:C.dim,letterSpacing:2,marginTop:12,textTransform:'uppercase'}}>A good story. A great evening.</Text>
  <Text style={{fontSize:21,color:C.muted,marginTop:44}}>{label}</Text>
  <View style={{width:520,height:5,backgroundColor:C.line,marginTop:26}}><View style={{width:520*fraction,height:5,backgroundColor:C.accent}}/></View>
  <Text testID="boot-progress" style={{fontSize:16,color:C.dim,marginTop:14}}>{detail}</Text>
 </View>;
}
