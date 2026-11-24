import {motionToken,prefersReducedMotion,subscribeMotion} from './tokens';

export type HighlightTone='intake'|'active'|'done'|'brand';
export interface HighlightOptions {tone:HighlightTone;background?:string}
export interface HighlightHandle {cancel:()=>void;finished:Promise<void>}
const running=new WeakMap<HTMLElement,()=>void>();
/** Repeat calls restart the full hold/fade on the `::after` overlay without mutating the host's own background-color. */
export function highlight(el:HTMLElement,{tone}:HighlightOptions):HighlightHandle{
  running.get(el)?.();
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  const hold=motionToken('--dur-highlight-hold');
  const duration=motionToken('--dur-highlight');
  const easing=motionToken('--ease-ambient');
  let timer:ReturnType<typeof setTimeout>|undefined,released=false,holding=false;
  const reduced=prefersReducedMotion();
  // The container query can expose the sticky overlay partway through this fade.
  const stickyCell=el.tagName==='TR'?el.querySelector<HTMLElement>(':scope > th:first-child'):null;
  el.setAttribute('data-highlight-tone',tone);
  const animation=reduced?undefined:el.animate([{opacity:1},{opacity:0}],{duration,delay:hold,easing,fill:'both',pseudoElement:'::after'});
  const stickyAnimation=reduced||!stickyCell?undefined:stickyCell.animate([{opacity:1},{opacity:0}],{duration,delay:hold,easing,fill:'both',pseudoElement:'::after'});
  let complete=()=>{};const finished=new Promise<void>(resolve=>{complete=resolve;});
  const cleanup=()=>{if(released)return;released=true;clearTimeout(timer);unsubscribe();animation?.cancel();stickyAnimation?.cancel();el.removeAttribute('data-highlight-tone');running.delete(el);complete();};
  const holdStatic=()=>{if(holding)return;holding=true;animation?.cancel();stickyAnimation?.cancel();clearTimeout(timer);timer=setTimeout(()=>{timer=setTimeout(cleanup,duration);},hold);};
  const unsubscribe=subscribeMotion(()=>{if(document.hidden)cleanup();else if(prefersReducedMotion())holdStatic();});
  running.set(el,cleanup);
  if(reduced)holdStatic();else if(animation)void animation.finished.then(()=>{if(!holding)cleanup();},()=>{if(!holding)cleanup();});
  return {cancel:cleanup,finished};
}
