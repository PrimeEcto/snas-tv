import React,{createContext,useContext,useRef,useEffect,useCallback} from 'react';
import {View} from 'react-native';
import {requestFocus} from 'snas-focus';
type Registry={nodes:Map<string,unknown>;last:string;initial:string;active:boolean};
const FocusContext=createContext<Registry|null>(null);
export function FocusScope({active=true,initial,children,autoFocus=true}:{active?:boolean;initial:string;children:React.ReactNode;autoFocus?:boolean}){
 const registry=useRef<Registry>({nodes:new Map(),last:'',initial,active});
 registry.current.initial=initial;registry.current.active=active;
 useEffect(()=>{if(!active||!autoFocus)return;const timer=setTimeout(()=>{
  const r=registry.current;const node=r.nodes.get(r.last)||r.nodes.get(r.initial)||r.nodes.values().next().value;
  requestFocus(node);
 },140);return()=>clearTimeout(timer);},[active,initial]);
 return <FocusContext.Provider value={registry.current}><View style={{flex:1,display:active?'flex':'none'}} pointerEvents={active?'auto':'none'} accessibilityElementsHidden={!active}>{children}</View></FocusContext.Provider>;
}
export function useFocusNode(id:string){
 const context=useContext(FocusContext);
 const nodeRef=useRef<unknown>(null);
 const ref=useCallback((node:unknown)=>{nodeRef.current=node;if(node)context?.nodes.set(id,node);else context?.nodes.delete(id);},[context,id]);
 const remember=()=>{if(context)context.last=id;};
 return {ref,remember};
}

export function useFocusTarget(){
 const context=useContext(FocusContext);
 return (id:string)=>{if(!context?.active)return;requestFocus(context.nodes.get(id));};
}
