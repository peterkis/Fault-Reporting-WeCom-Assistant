import {motionToken,prefersReducedMotion,subscribeMotion} from './tokens';

export type HighlightTone='intake'|'active'|'done'|'brand';
export interface HighlightHandle {cancel:()=>void;finished:Promise<void>}
const running=new WeakMap<HTMLElement,()=>void>();
/** Repeat calls restart the full hold/fade. Cancelling or finishing restores the original inline background. */
export function highlight(el:HTMLElement,{tone}:{tone:HighlightTone}):HighlightHandle{
  running.get(el)?.();
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  const original=el.style.backgroundColor,background=getComputedStyle(el).backgroundColor;
  const color=getComputedStyle(document.documentElement).getPropertyValue(tone==='brand'?'--brand-subtle':`--stage-${tone}-bg`).trim();
  const duration=motionToken('--dur-highlight');
  let timer:ReturnType<typeof setTimeout>|undefined,released=false,holding=false;
  const reduced=prefersReducedMotion();
  const animation=reduced?undefined:el.animate([{backgroundColor:color},{backgroundColor:background}],{duration,easing:motionToken('--ease-standard')});
  let complete=()=>{};const finished=new Promise<void>(resolve=>{complete=resolve;});
  const cleanup=()=>{if(released)return;released=true;clearTimeout(timer);unsubscribe();animation?.cancel();el.style.backgroundColor=original;running.delete(el);complete();};
  const hold=()=>{if(holding)return;holding=true;animation?.cancel();el.style.backgroundColor=color;clearTimeout(timer);timer=setTimeout(cleanup,duration);};
  const unsubscribe=subscribeMotion(()=>{if(document.hidden)cleanup();else if(prefersReducedMotion())hold();});
  running.set(el,cleanup);
  if(reduced)hold();else if(animation)void animation.finished.then(()=>{if(!holding)cleanup();},()=>{if(!holding)cleanup();});
  return {cancel:cleanup,finished};
}
