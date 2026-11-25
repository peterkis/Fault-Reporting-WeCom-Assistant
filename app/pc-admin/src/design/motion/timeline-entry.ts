import {highlight} from './highlight';
import type {HighlightHandle} from './highlight';
import {trackAnimation} from './lifecycle';
import {motionToken,prefersReducedMotion,subscribeMotion} from './tokens';

export interface TimelineEntryHandle {cancel:()=>void;finished:Promise<void>}

const activeHighlights=new WeakMap<HTMLElement,symbol>();

/** Highlights a timeline entry with the D3 intake tone and marks data-timeline-entry-highlight while active. */
export function highlightTimelineEntry(el:HTMLElement):TimelineEntryHandle{
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  const token=Symbol();
  activeHighlights.set(el,token);
  el.setAttribute('data-timeline-entry-highlight','true');
  const clear=()=>{if(activeHighlights.get(el)===token){activeHighlights.delete(el);el.removeAttribute('data-timeline-entry-highlight');}};
  const handle=highlight(el,{tone:'intake'});
  const finished=handle.finished.then(clear);
  return {cancel:()=>{handle.cancel();clear();},finished};
}

/** D3 arrival: slides down from -shift-md with opacity over --dur-base / --ease-standard while highlighting (intake) from frame 0. */
export function animateTimelineEntry(el:HTMLElement):TimelineEntryHandle{
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  if(prefersReducedMotion())return highlightTimelineEntry(el);
  let cancelled=false;
  el.setAttribute('data-timeline-entry-enter','true');
  const shift=motionToken('--shift-md');
  const phaseHighlight=highlightTimelineEntry(el);
  const animation=trackAnimation(
    el.animate(
      [{transform:`translateY(${-shift}px)`,opacity:0},{transform:'translateY(0)',opacity:1}],
      {duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')},
    ),
    ()=>{el.removeAttribute('data-timeline-entry-enter');},
  );
  const finished=Promise.all([
    animation.finished.catch(()=>{}),
    phaseHighlight.finished,
  ]).then(()=>{});
  return {
    cancel:()=>{
      if(cancelled)return;cancelled=true;
      animation.cancel();el.removeAttribute('data-timeline-entry-enter');
      phaseHighlight.cancel();
    },
    finished,
  };
}

/** Smooth-scrolls (auto under reduced motion) a container to targetTop, then highlights the resolved entries once. */
export function scrollAndHighlightEntries(scroller:HTMLElement,targetTop:number,resolveElements:()=>HTMLElement[]):()=>void{
  if(document.hidden)return()=>{};
  const reduced=prefersReducedMotion();
  const active:HighlightHandle[]=[];
  const runHighlights=()=>{for(const el of resolveElements())active.push(highlightTimelineEntry(el));};
  if(Math.abs(scroller.scrollTop-targetTop)<1){runHighlights();return()=>{for(const h of active)h.cancel();};}
  scroller.scrollTo({top:targetTop,behavior:reduced?'auto':'smooth'});
  if(reduced){runHighlights();return()=>{for(const h of active)h.cancel();};}
  let settled=false,cancelled=false,frame=0,stableFrames=0,lastTop=scroller.scrollTop;
  const stop=()=>{if(settled)return;settled=true;cancelAnimationFrame(frame);clearTimeout(timer);unsubscribe();scroller.removeEventListener('scrollend',onEnd);};
  const finish=()=>{stop();if(!cancelled&&!document.hidden)runHighlights();};
  const onEnd=()=>finish();
  const poll=()=>{
    if(settled)return;
    const top=scroller.scrollTop;
    if(Math.abs(top-lastTop)<0.5)stableFrames++;else{stableFrames=0;lastTop=top;}
    if(stableFrames>=4||Math.abs(top-targetTop)<1){finish();return;}
    frame=requestAnimationFrame(poll);
  };
  const unsubscribe=subscribeMotion(()=>{if(document.hidden)cancel();else if(prefersReducedMotion())finish();});
  const cancel=()=>{if(cancelled)return;cancelled=true;stop();for(const h of active)h.cancel();};
  scroller.addEventListener('scrollend',onEnd,{once:true});
  const timer=setTimeout(finish,motionToken('--dur-return'));
  frame=requestAnimationFrame(poll);
  return cancel;
}
