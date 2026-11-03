import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {WorkbenchCard} from '../../api/client';

const keyOf=(item:WorkbenchCard)=>item.kind+':'+item.id;
type Arrival={key:string;deferred:boolean};

/** Presentation IDs only: removed or no-longer-readable DTOs never survive a GET. */
export function useBoardArrivals(items:WorkbenchCard[],scope:string,ready:boolean,enabled:boolean){
  const baseline=useRef<{scope:string;keys:Set<string>}|null>(null),scrolling=useRef(0);
  const [state,setState]=useState<{scope:string;arrivals:Arrival[]}>({scope,arrivals:[]});
  useEffect(()=>{
    const onScroll=()=>{scrolling.current=performance.now();};
    window.addEventListener('scroll',onScroll,{capture:true,passive:true});window.addEventListener('wheel',onScroll,{passive:true});
    return()=>{window.removeEventListener('scroll',onScroll,true);window.removeEventListener('wheel',onScroll);};
  },[]);
  const sequence=items.map(item=>keyOf(item)+':'+item.column).join('|');
  useLayoutEffect(()=>{
    const keys=new Set(items.map(keyOf));
    if(!enabled||baseline.current?.scope!==scope){baseline.current=ready&&enabled?{scope,keys}:null;setState({scope,arrivals:[]});return;}
    const old=baseline.current.keys;
    const incoming=items.filter(item=>item.column==='pending'&&!old.has(keyOf(item))).map(keyOf);
    baseline.current={scope,keys:ready?keys:new Set([...old,...keys])};
    // Defer while scrolling or reading below the column top. No automatic jump on idle.
    const deferred=performance.now()-scrolling.current<180||window.scrollY>0||Boolean(document.querySelector('.detail-dialog,.detail-page,[role=dialog]'));
    setState(current=>({scope,arrivals:[...incoming.map(key=>({key,deferred})),...(current.scope===scope?current.arrivals:[])].filter(arrival=>items.some(item=>item.column==='pending'&&keyOf(item)===arrival.key))}));
  },[sequence,scope,ready,enabled]);
  const arrivals=enabled&&state.scope===scope?state.arrivals:[],hidden=new Set(arrivals.filter(item=>item.deferred).map(item=>item.key));
  const promoted=arrivals.filter(item=>!item.deferred).map(item=>item.key),rank=new Map(promoted.map((key,index)=>[key,index]));
  return {
    items:items.filter(item=>!hidden.has(keyOf(item))).sort((a,b)=>(rank.get(keyOf(a))??promoted.length)-(rank.get(keyOf(b))??promoted.length)),
    count:(visible:WorkbenchCard[])=>visible.filter(item=>item.column==='pending'&&hidden.has(keyOf(item))).length,
    reveal:()=>setState(current=>({...current,arrivals:current.arrivals.map(item=>({...item,deferred:false}))})),
    arrivalKeys:promoted,
  };
}
