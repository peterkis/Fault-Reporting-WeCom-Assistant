import {useLayoutEffect,useRef} from 'react';
import type {RefObject} from 'react';
import {afterFlip} from './flip';
import {motionToken,prefersReducedMotion,subscribeMotion} from './tokens';

export interface RollbackCueOptions {inset?:boolean|undefined}
export interface RollbackCueHandle {cancel:()=>void;finished:Promise<void>}
const running=new WeakMap<HTMLElement,()=>void>();

/** Flashes a 1.5px danger ring that fades over `--dur-return`; repeat calls restart cleanly and restore inline styles. */
export function rollbackCue(el:HTMLElement,options?:RollbackCueOptions):RollbackCueHandle{
  running.get(el)?.();
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  const color=getComputedStyle(document.documentElement).getPropertyValue('--tone-danger-dot').trim();
  if(!color)return {cancel:()=>{},finished:Promise.resolve()};
  const original=el.style.boxShadow,computed=getComputedStyle(el).boxShadow;
  const inset=options?.inset?'inset ':'';
  const base=computed&&computed!=='none'?computed:'';
  const fromShadow=(base?base+', ':'')+inset+'0 0 0 1.5px '+color;
  const toShadow=(base?base+', ':'')+inset+'0 0 0 0px '+color;
  const duration=motionToken('--dur-return');
  let timer:ReturnType<typeof setTimeout>|undefined,holdFrame=0,released=false,holding=false;
  const reduced=prefersReducedMotion();
  el.setAttribute('data-optimistic-rollback','true');
  const animation=reduced?undefined:el.animate([{boxShadow:fromShadow},{boxShadow:toShadow}],{duration,easing:motionToken('--ease-standard')});
  let complete=()=>{};const finished=new Promise<void>(resolve=>{complete=resolve;});
  const cleanup=()=>{
    if(released)return;
    released=true;
    cancelAnimationFrame(holdFrame);
    clearTimeout(timer);
    unsubscribe();
    animation?.cancel();
    el.style.boxShadow=original;
    el.removeAttribute('data-optimistic-rollback');
    running.delete(el);
    complete();
  };
  const hold=()=>{
    if(holding)return;
    holding=true;
    animation?.cancel();
    el.style.boxShadow=fromShadow;
    // Wait for a paint before counting down under reduced motion.
    holdFrame=requestAnimationFrame(()=>{
      holdFrame=requestAnimationFrame(()=>{timer=setTimeout(cleanup,duration);});
    });
  };
  const unsubscribe=subscribeMotion(()=>{if(document.hidden)cleanup();else if(prefersReducedMotion())hold();});
  running.set(el,cleanup);
  if(reduced)hold();else if(animation)void animation.finished.then(()=>{if(!holding)cleanup();},()=>{if(!holding)cleanup();});
  else cleanup();
  return {cancel:cleanup,finished};
}

/**
 * Plays `rollbackCue` once when a rollback event becomes active, surviving cross-column remounts
 * and React StrictMode double-effects while calling `onConsumed` only after natural completion.
 */
export function useOptimisticRollbackCue(
  ref:RefObject<HTMLElement|null>,
  active:boolean,
  token:number,
  onConsumed?:()=>void,
  options?:RollbackCueOptions,
){
  const consumedRef=useRef(onConsumed);
  useLayoutEffect(()=>{consumedRef.current=onConsumed;},[onConsumed]);
  useLayoutEffect(()=>{
    if(!active||token<=0)return;
    const el=ref.current;
    if(!el)return;
    let cancelled=false;
    let handle:RollbackCueHandle|undefined;
    const stopWaiting=afterFlip(el,()=>{
      if(!el.isConnected)return;
      handle=rollbackCue(el,options?.inset?{inset:true}:undefined);
      void handle.finished.then(()=>{if(!cancelled)consumedRef.current?.();});
    });
    return()=>{cancelled=true;stopWaiting();handle?.cancel();};
  },[ref,active,token,options?.inset]);
}
