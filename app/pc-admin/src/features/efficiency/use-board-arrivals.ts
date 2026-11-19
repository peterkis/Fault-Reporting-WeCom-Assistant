import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {WorkbenchCard} from '../../api/client';

const keyOf=(item:WorkbenchCard)=>item.kind+':'+item.id;
const groupOf=(item:WorkbenchCard)=>item.column==='pending'?(item.kind!=='ticket'?0:1):item.column==='active'?2:(item.closure?.kind==='COMPLETED'?3:4);
const EMPTY_KEYS:readonly string[]=[];

/**
 * Presentation IDs only: removed or no-longer-readable DTOs never survive a GET.
 * Card 36B drops Card 16 deferral: new items always land in place while keeping
 * top promotion inside the pending group (when not frozen) and reporting newly arrived keys
 * on the same commit so board/list motion measures their final landing position.
 */
export function useBoardArrivals(items:WorkbenchCard[],scope:string,ready:boolean,enabled:boolean,promotePending:boolean){
  const baseline=useRef<{scope:string;keys:Set<string>;intakes:Set<string>}|null>(null);
  const [state,setState]=useState<{scope:string;promoted:string[];arrived:string[]}>({scope,promoted:[],arrived:[]});
  const computed=useMemo(()=>{
    const sequence=items.map(item=>keyOf(item)+':'+item.column).join('|');
    const presentKeys=new Set(items.map(keyOf));
    const pendingKeys=new Set<string>();
    for(const item of items)if(item.column==='pending')pendingKeys.add(keyOf(item));
    // Pure read of committed baseline (never mutated during render -> React StrictMode safe).
    const hasBaseline=enabled&&baseline.current?.scope===scope;
    const incoming=hasBaseline&&baseline.current
      ?items.filter(item=>!baseline.current!.keys.has(keyOf(item))&&!baseline.current!.intakes.has(item.intake_id))
      :[];
    const prevPromoted=enabled&&state.scope===scope?state.promoted:[];
    const prevArrived=enabled&&state.scope===scope?state.arrived:[];
    const incomingPending=promotePending?incoming.filter(item=>item.column==='pending').map(keyOf):[];
    const incomingAll=incoming.map(keyOf);
    const incomingPendingSet=new Set(incomingPending);
    const prevArrivedSet=new Set(prevArrived);
    const promoted=enabled&&promotePending
      ?[...incomingPending,...prevPromoted.filter(key=>!incomingPendingSet.has(key))].filter(key=>pendingKeys.has(key))
      :[];
    const nextArrived=enabled
      ?[...prevArrived.filter(key=>presentKeys.has(key)),...incomingAll.filter(key=>!prevArrivedSet.has(key))]
      :[];
    const arrived=nextArrived.length===0?EMPTY_KEYS:nextArrived.length===prevArrived.length&&nextArrived.every((key,index)=>key===prevArrived[index])?prevArrived:nextArrived;
    let sorted=items;
    if(promoted.length){
      const rank=new Map(promoted.map((key,index)=>[key,index]));
      sorted=[...items].sort((a,b)=>{
        const ga=groupOf(a),gb=groupOf(b);
        if(ga!==gb)return ga-gb;
        return (rank.get(keyOf(a))??promoted.length)-(rank.get(keyOf(b))??promoted.length);
      });
    }
    return {sequence,promoted,arrived,sorted,pendingKeys};
  },[items,scope,enabled,promotePending,state]);

  useLayoutEffect(()=>{
    const keys=new Set(items.map(keyOf)),intakes=new Set(items.map(item=>item.intake_id));
    if(!enabled||baseline.current?.scope!==scope){
      baseline.current=ready&&enabled?{scope,keys,intakes}:null;
      setState(current=>current.scope===scope&&current.promoted.length===0&&current.arrived.length===0?current:{scope,promoted:[],arrived:[]});
      return;
    }
    const oldKeys=baseline.current.keys,oldIntakes=baseline.current.intakes;
    baseline.current={
      scope,
      keys:ready?keys:new Set([...oldKeys,...keys]),
      intakes:ready?intakes:new Set([...oldIntakes,...intakes]),
    };
    setState(current=>{
      const currentPromoted=current.scope===scope?current.promoted:[];
      const currentArrived=current.scope===scope?current.arrived:[];
      const nextPromoted=promotePending?computed.promoted:currentPromoted.filter(key=>computed.pendingKeys.has(key));
      const nextArrived=computed.arrived===EMPTY_KEYS?[]:[...computed.arrived];
      if(current.scope===scope&&nextPromoted.length===currentPromoted.length&&nextArrived.length===currentArrived.length&&nextPromoted.every((key,index)=>key===currentPromoted[index])&&nextArrived.every((key,index)=>key===currentArrived[index]))return current;
      return {scope,promoted:nextPromoted,arrived:nextArrived};
    });
  },[computed.sequence,scope,ready,enabled,promotePending]);

  return {items:computed.sorted,arrivalKeys:computed.arrived};
}
