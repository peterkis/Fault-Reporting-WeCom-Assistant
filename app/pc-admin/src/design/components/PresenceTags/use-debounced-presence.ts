import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {WorkbenchActivityPerson} from '../../../../../../contracts/workbench_activity_contracts';
import {withPresentationKeys} from '../../presentation-keys';
import {motionToken,prefersReducedMotion} from '../../motion/tokens';

export const PRESENCE_LEAVE_DEBOUNCE_MS=300;
const EMPTY:readonly WorkbenchActivityPerson[]=Object.freeze([]);

function personSignature(people:readonly WorkbenchActivityPerson[]):string{
  return people.map(person=>person.display_name+'\u0000'+person.mode+'\u0000'+(person.field??'')).join('\u0001');
}

function sameDisplayed(a:readonly WorkbenchActivityPerson[],b:readonly WorkbenchActivityPerson[]):boolean{
  if(a.length!==b.length)return false;
  return a.every((person,index)=>{const other=b[index];return other!==undefined&&person.display_name===other.display_name&&person.mode===other.mode&&person.field===other.field;});
}

interface RetainedPerson {
  person:WorkbenchActivityPerson;
  order:number;
  leaving:boolean;
  timer:ReturnType<typeof setTimeout>|null;
}

/**
 * Display-layer 300ms presence debounce (D4). When someone disappears, keeps them present for 300ms;
 * returning within 300ms cancels removal with no exit or re-enter. Leaving beyond 300ms hands off to
 * useExitPresence('--dur-fast') in PresenceTags.
 */
export function useDebouncedPresence(people:readonly WorkbenchActivityPerson[]):readonly WorkbenchActivityPerson[]{
  const signature=personSignature(people);
  const [displayed,setDisplayed]=useState<readonly WorkbenchActivityPerson[]>(()=>people.length?people:EMPTY);
  const retainedRef=useRef<Map<string,RetainedPerson>|null>(null);
  if(retainedRef.current===null){
    retainedRef.current=new Map(withPresentationKeys(people).map(({key,item},order)=>[key,{person:item,order,leaving:false,timer:null}]));
  }
  useLayoutEffect(()=>{
    const map=retainedRef.current!;
    const publish=()=>{
      const next=[...map.values()]
        .sort((a,b)=>(a.person.mode==='EDITING'?0:1)-(b.person.mode==='EDITING'?0:1)||a.order-b.order)
        .map(entry=>entry.person);
      const result=next.length?next:EMPTY;
      setDisplayed(current=>sameDisplayed(current,result)?current:result);
    };
    const keyed=withPresentationKeys(people),incoming=new Map(keyed.map(({key,item},order)=>[key,{person:item,order}]));
    let changed=false;
    for(const [key,entry] of incoming){
      const existing=map.get(key);
      if(existing){
        if(existing.timer!==null){clearTimeout(existing.timer);existing.timer=null;}
        if(existing.leaving||existing.person.mode!==entry.person.mode||existing.person.field!==entry.person.field||existing.order!==entry.order){
          existing.person=entry.person;existing.order=entry.order;existing.leaving=false;changed=true;
        }
      }else{
        map.set(key,{person:entry.person,order:entry.order,leaving:false,timer:null});changed=true;
      }
    }
    for(const [key,existing] of [...map]){
      if(incoming.has(key))continue;
      if(typeof document!=='undefined'&&document.hidden){
        if(existing.timer!==null)clearTimeout(existing.timer);
        map.delete(key);changed=true;
      }else if(!existing.leaving){
        existing.leaving=true;
        existing.timer=setTimeout(()=>{
          existing.timer=null;
          map.delete(key);
          publish();
        },PRESENCE_LEAVE_DEBOUNCE_MS);
      }
    }
    if(changed)publish();
  },[signature]);
  useEffect(()=>{
    const onVisibility=()=>{
      if(!document.hidden)return;
      const map=retainedRef.current;if(!map)return;
      let flushed=false;
      for(const [key,entry] of [...map]){
        if(entry.leaving){if(entry.timer!==null)clearTimeout(entry.timer);map.delete(key);flushed=true;}
      }
      if(flushed){
        const next=[...map.values()]
          .sort((a,b)=>(a.person.mode==='EDITING'?0:1)-(b.person.mode==='EDITING'?0:1)||a.order-b.order)
          .map(entry=>entry.person);
        setDisplayed(next.length?next:EMPTY);
      }
    };
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[]);
  useEffect(()=>()=>{
    const map=retainedRef.current;if(!map)return;
    for(const entry of map.values())if(entry.timer!==null){clearTimeout(entry.timer);entry.timer=null;}
  },[]);
  return displayed;
}

/** Marks view ↔ edit transitions on a card outline so box-shadow uses --dur-base, while appear/disappear stays --dur-fast. */
export function usePresenceModeTransition(mode:'viewing'|'editing'|undefined):'mode'|undefined{
  const previousRef=useRef(mode);
  const [switching,setSwitching]=useState(false);
  useLayoutEffect(()=>{
    const previous=previousRef.current;previousRef.current=mode;
    if(!previous||!mode||previous===mode){setSwitching(false);return;}
    if(document.hidden||prefersReducedMotion()){setSwitching(false);return;}
    setSwitching(true);
    const timer=setTimeout(()=>setSwitching(false),motionToken('--dur-base'));
    return()=>clearTimeout(timer);
  },[mode]);
  return switching&&mode?'mode':undefined;
}
