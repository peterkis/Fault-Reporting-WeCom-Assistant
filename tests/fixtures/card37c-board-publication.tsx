// The production bridge renders null. ReactDOM only needs an event-capable fragment
// to commit its effects, so this check needs neither layout emulation nor Chrome.
import {useEffect,useState,act} from 'react';
import {createRoot} from 'react-dom/client';
import {DOMParser} from '@xmldom/xmldom';
import type {Principal,WorkbenchCard} from '../../app/pc-admin/src/api/client';
import {HoverCardsBoardBridge,HoverCardsStoreProvider,useHoverCardsStore} from '../../app/pc-admin/src/features/hover-cards/hover-card-store';

export async function countBoardPublications(principal:Principal){
  const doc=new DOMParser().parseFromString('<html><body/></html>','text/html');
  const container=doc.createDocumentFragment();
  for(const node of [doc,container]){
    const events=new EventTarget();
    Object.assign(node,{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  }
  Object.defineProperty(doc,'defaultView',{value:{document:doc,HTMLIFrameElement:class {}}});
  const items:WorkbenchCard[]=[],filter=()=>{};
  const published=new Set<object>();
  function Observer(){
    const board=useHoverCardsStore()?.board;
    const [stop,setStop]=useState(false);
    useEffect(()=>{
      if(!board?.hasBoard)return;
      published.add(board);
      if(published.size>=8)setStop(true); // Bound a broken publisher; never spin until the test times out.
    },[board]);
    return stop?null:<HoverCardsBoardBridge items={items} range="all" now={1} searchMode={false} handledDates={null} onFilterByPerson={filter}/>;
  }
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:doc.defaultView});
  try{
    const root=createRoot(container);
    try{
      await act(()=>root.render(<HoverCardsStoreProvider principal={principal}><Observer/></HoverCardsStoreProvider>));
      return published.size;
    }finally{await act(()=>root.unmount());}
  }finally{
    if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');
  }
}
