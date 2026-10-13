import React,{useState,useRef,useEffect} from 'react';
import {Pressable,View,Text,Image,StyleSheet,Animated,FlatList} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {C} from './theme';
import {Icon,type IconName} from './icons';
import {useFocusNode} from './focus';
import type {Title} from '../catalog/types';
import {imageUrl} from '../catalog/service';
export {LinearGradient};
export function Button({id,label,icon,onPress,primary=false,compact=false,disabled=false,onFocus}:{id:string;label:string;icon?:IconName;onPress:()=>void;primary?:boolean;compact?:boolean;disabled?:boolean;onFocus?:()=>void}){
 const [focused,setFocused]=useState(false);const node=useFocusNode(id);
 return <Pressable ref={node.ref as never} testID={id} accessibilityLabel={label} accessibilityRole="button" focusable={!disabled} disabled={disabled}
 onFocus={()=>{setFocused(true);node.remember();onFocus?.();}} onBlur={()=>setFocused(false)} onPress={onPress}
 style={[s.button,compact&&s.compact,compact&&label.length===1&&{paddingHorizontal:3},primary&&s.primary,focused&&s.focused,disabled&&{opacity:0.45}]}>
 {icon&&<Icon name={icon} color={primary||focused?C.bg:C.text} size={compact?19:21}/>}
 <Text numberOfLines={1} style={[s.buttonLabel,(primary||focused)&&{color:C.bg}]}>{label}</Text>
 </Pressable>;
}
export function Artwork({title,kind='poster',style}:{title:Title;kind?:'poster'|'backdrop';style?:any}){
 const [failed,setFailed]=useState(false);const path=kind==='poster'?title.poster:title.backdrop;
 useEffect(()=>setFailed(false),[path]);
 const uri=path?imageUrl(path,kind==='poster'?'w342':'w1280'):undefined;
 return <View style={[{backgroundColor:C.surface,overflow:'hidden'},style]}>
 {uri&&!failed?<Image source={{uri}} resizeMode="cover" onError={()=>setFailed(true)} style={StyleSheet.absoluteFill}/>:<View style={{flex:1,justifyContent:'center',alignItems:'center',padding:16}}><Text style={{color:C.accent,fontSize:28,fontWeight:'700'}}>SNAS</Text><Text style={{color:C.text,fontSize:18,textAlign:'center',marginTop:18}}>{title.title}</Text></View>}
 </View>;
}
export function Meta({title}:{title:Title}){
 const values=[title.year,...title.genres.slice(0,2),title.kind==='tv'?`${title.seasons||'TV'}${title.seasons?' seasons':' series'}`:title.runtime?`${title.runtime} min`:null,title.rating!==null?`TMDB ${title.rating.toFixed(1)}`:null].filter(Boolean);
 return <View style={{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:12}}>{values.map((v,i)=><React.Fragment key={`${i}-${v}`}>
 {i>0&&<View style={{width:3,height:3,borderRadius:0,backgroundColor:C.dim}}/>}<Text style={{fontSize:16,color:C.muted}}>{v}</Text></React.Fragment>)}</View>;
}
export function Card({title,id,onPress,onFocus,progress,wide=false}:{title:Title;id:string;onPress:()=>void;onFocus?:()=>void;progress?:number;wide?:boolean}){
 const [focused,setFocused]=useState(false);const node=useFocusNode(id);const scale=useRef(new Animated.Value(1)).current;
 const focus=(v:boolean)=>{setFocused(v);Animated.timing(scale,{toValue:v?1.035:1,duration:130,useNativeDriver:true}).start();if(v){node.remember();onFocus?.();}};
 return <Pressable ref={node.ref as never} testID={id} accessibilityRole="button" accessibilityLabel={`${title.title}, ${title.year}, ${title.kind==='tv'?'series':'movie'}`} onFocus={()=>focus(true)} onBlur={()=>focus(false)} onPress={onPress} style={{width:wide?250:138,marginRight:20,padding:4}}>
 <Animated.View style={{transform:[{scale}],borderWidth:2,borderColor:focused?C.text:'transparent',borderRadius:0,padding:3}}>
 <Artwork title={title} kind={wide?'backdrop':'poster'} style={{width:wide?236:124,height:wide?133:186,borderRadius:0}}/>
 {progress!==undefined&&<View style={{height:4,backgroundColor:C.line,marginTop:6}}><View style={{height:4,width:(wide?236:124)*Math.max(0,Math.min(1,progress)),backgroundColor:C.accent}}/></View>}
 </Animated.View>
 <Text numberOfLines={1} style={{fontSize:16,color:focused?C.text:C.muted,marginTop:8,fontWeight:focused?'600':'400'}}>{title.title}</Text>
 <Text style={{fontSize:13,color:C.dim,marginTop:4}}>{title.year}  ·  {title.kind==='tv'?'Series':'Film'}</Text>
 </Pressable>;
}
export function Rail({id,title,items,onOpen,onFocus,progress,wide=false}:{id:string;title:string;items:Title[];onOpen:(title:Title)=>void;onFocus?:()=>void;progress?:Record<string,number>;wide?:boolean}){
 const list=useRef<FlatList<Title>>(null);
 if(!items.length)return null;
 return <View style={{marginBottom:28}}><Text style={{fontSize:24,fontWeight:'600',color:C.text,marginLeft:56,marginBottom:14}}>{title}</Text>
 <FlatList ref={list} horizontal data={items} keyExtractor={t=>`${t.kind}-${t.id}`} showsHorizontalScrollIndicator={false} removeClippedSubviews={false} initialNumToRender={9} windowSize={5}
 contentContainerStyle={{paddingLeft:52,paddingRight:56,paddingVertical:6}} getItemLayout={(_,index)=>({length:wide?270:158,offset:(wide?270:158)*index,index})}
 renderItem={({item,index})=><Card id={`${id}-${item.kind}-${item.id}`} title={item} wide={wide} onPress={()=>onOpen(item)} progress={progress?.[`${item.kind}:${item.id}`]} onFocus={()=>{list.current?.scrollToIndex({index,animated:true,viewPosition:0.4});onFocus?.();}}/>}/></View>;
}
export function Empty({title,body,action,label='Explore movies'}:{title:string;body:string;action:()=>void;label?:string}){
 return <View style={{padding:56,justifyContent:'center',flex:1}}><Text style={{color:C.text,fontSize:44,fontWeight:'600',marginBottom:18}}>{title}</Text><Text style={{color:C.muted,fontSize:21,lineHeight:31,maxWidth:630,marginBottom:30}}>{body}</Text><View style={{alignItems:'flex-start'}}><Button id="empty-action" label={label} primary onPress={action}/></View></View>;
}
const s=StyleSheet.create({button:{height:49,borderRadius:0,paddingHorizontal:22,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:C.raised,borderWidth:2,borderColor:'transparent'},compact:{height:40,paddingHorizontal:15},primary:{backgroundColor:C.text},focused:{backgroundColor:C.accent,borderColor:C.text},buttonLabel:{fontSize:17,color:C.text,fontWeight:'600'}});
