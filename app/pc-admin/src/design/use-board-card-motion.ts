import {useEffect,useLayoutEffect,useRef} from 'react';

function positions(){
  const result=new Map<string,{x:number;y:number;column:string}>();
  for(const card of document.querySelectorAll<HTMLElement>('.board .ticket-card')){
    const column=card.closest<HTMLElement>('.board-column')?.classList;
    const stage=column?.contains('pending')?'pending':column?.contains('active')?'active':'closed';
    const rect=card.getBoundingClientRect();result.set(card.dataset.kind+':'+card.dataset.itemId,{x:rect.left+scrollX,y:rect.top+scrollY,column:stage});
  }
  return result;
}

/** Animate only a server-confirmed column change, without retaining business DTOs. */
export function useBoardCardMotion(sequence:string,refreshing:boolean,scope:string,arrivalKeys:readonly string[]=[]){
  const previous=useRef(new Map<string,{x:number;y:number;column:string}>());
  const owner=useRef(scope),animations=useRef(new Map<string,Animation>());
  const arrivals=useRef(new Set<string>()),arrivalAnimations=useRef(new Set<Animation>());
  useEffect(()=>{
    // Refresh the origin at the explicit gesture, including after scrolling or expanding a group.
    const capture=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('.board'))previous.current=new Map([...previous.current,...positions()]);};
    const cancel=()=>{for(const animation of animations.current.values())animation.cancel();animations.current.clear();for(const animation of arrivalAnimations.current)animation.cancel();arrivalAnimations.current.clear();};
    const preference=matchMedia('(prefers-reduced-motion: reduce)'),reduce=()=>{if(preference.matches)cancel();};
    document.addEventListener('pointerdown',capture,true);window.addEventListener('keydown',capture,true);preference.addEventListener('change',reduce);
    return()=>{document.removeEventListener('pointerdown',capture,true);window.removeEventListener('keydown',capture,true);preference.removeEventListener('change',reduce);cancel();};
  },[]);
  useLayoutEffect(()=>{
    if(owner.current!==scope){owner.current=scope;previous.current.clear();for(const animation of animations.current.values())animation.cancel();animations.current.clear();for(const animation of arrivalAnimations.current)animation.cancel();arrivalAnimations.current.clear();arrivals.current.clear();}
    const next=positions();
    const token=getComputedStyle(document.documentElement).getPropertyValue('--dur-base').trim();
    const duration=token.endsWith('ms')?parseFloat(token):token.endsWith('s')?parseFloat(token)*1000:NaN;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,newArrivals=new Set(arrivalKeys);
    const styles=getComputedStyle(document.documentElement),highlight=styles.getPropertyValue('--stage-intake-bg').trim(),canvas=styles.getPropertyValue('--bg-canvas').trim();
    for(const card of document.querySelectorAll<HTMLElement>('.board .ticket-card')){
      const key=card.dataset.kind+':'+card.dataset.itemId,old=previous.current.get(key),current=next.get(key);
      if(!reduced&&old&&current&&old.column!==current.column&&Number.isFinite(duration)&&duration>0){
        animations.current.get(key)?.cancel();
        const animation=card.animate([{transform:`translate(${old.x-current.x}px,${old.y-current.y}px)`},{transform:'translate(0,0)'}],{duration,easing:'ease-out'});
        animations.current.set(key,animation);
        const release=()=>{if(animations.current.get(key)===animation)animations.current.delete(key);};
        void animation.finished.then(release,release);
      }
      if(newArrivals.has(key)&&!arrivals.current.has(key)&&!reduced){
        const animation=card.animate([{transform:'translateY(calc(-1 * var(--space-4)))',opacity:0,backgroundColor:highlight},{transform:'translateY(0)',opacity:1,backgroundColor:highlight,offset:0.09},{transform:'translateY(0)',opacity:1,backgroundColor:canvas}],{duration:2000,easing:'ease-out'});
        arrivalAnimations.current.add(animation);const release=()=>arrivalAnimations.current.delete(animation);void animation.finished.then(release,release);
      }
    }
    arrivals.current=newArrivals;
    // A pending GET can remove the old card before the active GET adds it. Keep only its presentation coordinates until the read batch settles.
    previous.current=refreshing?new Map([...previous.current,...next]):next;
  },[sequence,refreshing,scope,arrivalKeys.join('|')]);
}
