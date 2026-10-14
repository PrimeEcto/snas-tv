import React,{useState,useEffect,useRef} from 'react';
import {View,Text,FlatList} from 'react-native';
import {Catalog} from '../catalog/service';
import type {Title} from '../catalog/types';
import {Button,Card} from './controls';
import {C} from './theme';
export function SearchScreen({catalog,onOpen,onDemo}:{catalog:Catalog;onOpen:(t:Title)=>void;onDemo:()=>void}){
 const [query,setQuery]=useState('');const [items,setItems]=useState<Title[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [page,setPage]=useState(1);const [total,setTotal]=useState(1);const generation=useRef(0);
 const search=(next=1)=>{const gen=++generation.current;setLoading(true);setError('');catalog.search(query,next).then(result=>{if(gen!==generation.current)return;setItems(old=>next===1?result.items:[...old,...result.items]);setPage(next);setTotal(result.totalPages);}).catch(e=>{if(gen===generation.current)setError(e.message);}).finally(()=>{if(gen===generation.current)setLoading(false);});};
 useEffect(()=>{generation.current++;const timer=setTimeout(()=>search(),350);return()=>{clearTimeout(timer);generation.current++;};},[query,catalog]);
 return <View style={{flex:1,paddingHorizontal:56,paddingTop:25}}><Text style={{color:C.text,fontSize:42,fontWeight:'600',marginBottom:22}}>Find your next story.</Text>
 <View style={{flex:1,flexDirection:'row',gap:35}}><View style={{width:305}}>
 <View testID="search-input" accessibilityLabel={`Search query: ${query||'empty'}`} style={{height:52,justifyContent:'center',backgroundColor:C.surface,borderRadius:0,paddingHorizontal:15,marginBottom:18,borderWidth:1,borderColor:C.line}}><Text numberOfLines={1} style={{color:query?C.text:C.dim,fontSize:22}}>{query||'Movies, series…'}</Text></View>
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:7}}>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map(char=><View key={char} style={{width:44}}><Button id={`key-${char}`} compact label={char} onPress={()=>setQuery(q=>q+char)}/></View>)}</View>
 <View style={{flexDirection:'row',gap:8,marginTop:13}}><Button id="key-space" compact label="Space" onPress={()=>setQuery(q=>q+' ')}/><Button id="key-delete" compact label="Delete" onPress={()=>setQuery(q=>q.slice(0,-1))}/><Button id="key-clear" compact label="Clear" onPress={()=>setQuery('')}/></View>
 <View style={{marginTop:15}}><Button id="search-submit" label="Search" primary icon="search" onPress={()=>search()}/></View>
 <Text style={{color:C.dim,fontSize:14,lineHeight:21,marginTop:20}}>{catalog.mode==='demo'?'Searching the genuine sample catalog. Configure TMDB for the full library.':'Searching movies and series on TMDB.'}</Text>
 </View><View style={{flex:1}}>
 <Text style={{color:C.muted,fontSize:18,marginBottom:15}}>{loading?'Searching…':!query.trim()?'Enter a title to begin.':`${items.length} results for “${query.trim()}”`}</Text>
 {error&&<View><Text style={{color:C.error,fontSize:18,lineHeight:27,marginBottom:18}}>{error}</Text><Button id="search-retry" label="Try again" onPress={()=>search()}/><View style={{marginTop:10}}><Button id="search-demo" label="Use sample catalog" onPress={onDemo}/></View></View>}
 {!loading&&!error&&query.trim()&&!items.length&&<Text style={{color:C.muted,fontSize:23,lineHeight:32,marginTop:40}}>No matches this time. Try a shorter title or a different spelling.</Text>}
 <FlatList data={items} numColumns={4} removeClippedSubviews={false} keyExtractor={t=>`${t.kind}-${t.id}`} renderItem={({item})=><Card title={item} id={`search-${item.kind}-${item.id}`} onPress={()=>onOpen(item)}/>} showsVerticalScrollIndicator={false} ListFooterComponent={page<total?<Button id="search-more" label="More results" disabled={loading} onPress={()=>search(page+1)}/>:null}/>
 </View></View></View>;
}
