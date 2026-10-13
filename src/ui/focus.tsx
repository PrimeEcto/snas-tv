import React,{createContext,useContext,useRef,useEffect,useCallback} from 'react';
import {View,findNodeHandle} from 'react-native';
import {FocusManager} from '@amazon-devices/react-native-kepler';
type Node={requestTVFocus?:()=>void};
type Registry={nodes:Map<string,Node>;last:string;initial:string;active:boolean};
const FocusContext=createContext<Registry|null>(null);
export function FocusScope({active=true,initial,children,autoFocus=true}:{active?:boolean;initial:string;children:React.ReactNode;autoFocus?:boolean}){
 const registry=useRef<Registry>({nodes:new Map(),last:'',initial,active});
 registry.current.initial=initial;registry.current.active=active;
 useEffect(()=>{if(!active||!autoFocus)return;const timer=setTimeout(()=>{
  const r=registry.current;const node=r.nodes.get(r.last)||r.nodes.get(r.initial)||r.nodes.values().next().value;
  if(node){if(node.requestTVFocus)node.requestTVFocus();else{const tag=findNodeHandle(node as never);if(tag)FocusManager.focus(tag);}}
 },140);return()=>clearTimeout(timer);},[active,initial]);
 return <FocusContext.Provider value={registry.current}><View style={{flex:1,display:active?'flex':'none'}} pointerEvents={active?'auto':'none'} accessibilityElementsHidden={!active}>{children}</View></FocusContext.Provider>;
}
export function useFocusNode(id:string){
 const context=useContext(FocusContext);
 const nodeRef=useRef<Node|null>(null);
 const ref=useCallback((node:Node|null)=>{nodeRef.current=node;if(node)context?.nodes.set(id,node);else context?.nodes.delete(id);},[context,id]);
 const remember=()=>{if(context)context.last=id;};
 return {ref,remember};
}

export function useFocusTarget(){
 const context=useContext(FocusContext);
 return (id:string)=>{if(!context?.active)return;const node=context.nodes.get(id);if(node){if(node.requestTVFocus)node.requestTVFocus();else{const tag=findNodeHandle(node as never);if(tag)FocusManager.focus(tag);}}};
}
