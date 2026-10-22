import {useEffect,useRef,useState} from 'react';
import {motionAllowed,newExperience} from '../experience';
import {decorations} from './loader';

/** Only this decorative leaf subscribes; frames never update the page/form. */
export function Ambient({kind,active}:{kind:'entry'|'current';active:boolean}){
 const root=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[blocked,setBlocked]=useState(false);
 const kit=decorations.use();
 useEffect(()=>{
  const element=root.current;if(!element||!motionAllowed()||typeof IntersectionObserver==='undefined')return;
  let inView=false;
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setVisible(inView&&!document.hidden&&!preference.matches);
  const observer=new IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting);update();});observer.observe(element);
  document.addEventListener('visibilitychange',update);preference.addEventListener('change',update);
  const control=element.parentElement;
  if(kind==='entry')setBlocked(Boolean(control?.matches(':focus-within')||matchMedia('(hover: hover)').matches&&control?.matches(':hover')));
  const hover=(event:PointerEvent)=>{if(event.pointerType==='mouse')setBlocked(true);};
  const block=()=>setBlocked(true),unblock=()=>setBlocked(Boolean(control?.matches(':focus-within,:hover')));
  if(kind==='entry'){control?.addEventListener('pointerenter',hover);control?.addEventListener('pointerleave',unblock);control?.addEventListener('focusin',block);control?.addEventListener('focusout',unblock);control?.addEventListener('pointerdown',block);control?.addEventListener('pointerup',unblock);control?.addEventListener('pointercancel',unblock);}
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);preference.removeEventListener('change',update);control?.removeEventListener('pointerenter',hover);control?.removeEventListener('pointerleave',unblock);control?.removeEventListener('focusin',block);control?.removeEventListener('focusout',unblock);control?.removeEventListener('pointerdown',block);control?.removeEventListener('pointerup',unblock);control?.removeEventListener('pointercancel',unblock);};
 },[kind]);
 const running=visible&&active&&!blocked;
 useEffect(()=>{
  if(!running||kit)return;
  if(typeof requestIdleCallback==='function'){const id=requestIdleCallback(()=>decorations.load(),{timeout:1500});return()=>cancelIdleCallback(id);}
  const id=setTimeout(()=>decorations.load(),250);return()=>clearTimeout(id);
 },[running,kit]);
 if(!newExperience)return null;
 return <span ref={root} aria-hidden="true" className={'h5-ambient h5-ambient-'+kind} data-h5-ambient={kind}>{kit&&(kind==='entry'?<kit.EntryShine active={running}/>:<kit.CurrentPulse active={running}/>)}</span>;
}
