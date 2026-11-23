import {motionToken,prefersReducedMotion} from './tokens';
import type {DurationToken,EasingToken} from './tokens';
import {finishedAnimation,trackAnimation} from './lifecycle';

export type MotionRect=Pick<DOMRectReadOnly,'left'|'top'>;
export interface FlipOptions {
  duration?:DurationToken;
  easing?:EasingToken;
  lift?:boolean;
  fadeOut?:boolean;
  end?:MotionRect;
  scroll?:{x:number;y:number};
}
const running=new Map<HTMLElement,{animation:Animation;layout:MotionRect;scrollX:number;scrollY:number;start:MotionRect;end:MotionRect;lift:boolean;release:()=>void}>();
const flipHostCounts=new WeakMap<HTMLElement,number>();

function acquireFlipHosts(el:HTMLElement):HTMLElement[]{
  if(typeof el.closest!=='function')return [];
  const hosts:HTMLElement[]=[];
  const collapse=el.closest<HTMLElement>('.ds-collapse');
  if(collapse)hosts.push(collapse);
  const disclosure=el.closest<HTMLElement>('.ds-board-group > .disclosure__content');
  if(disclosure)hosts.push(disclosure);
  for(const host of hosts){
    const count=(flipHostCounts.get(host)??0)+1;
    flipHostCounts.set(host,count);
    if(count===1&&host.dataset)host.dataset.motionFlipHost='true';
  }
  return hosts;
}

function releaseFlipHosts(hosts:HTMLElement[]){
  for(const host of hosts){
    const next=(flipHostCounts.get(host)??1)-1;
    if(next<=0){
      flipHostCounts.delete(host);
      if(host.dataset)delete host.dataset.motionFlipHost;
    }else{
      flipHostCounts.set(host,next);
    }
  }
}

/** A child may request the cue before the board registers its FLIP in the same layout pass. */
export function afterFlip(el:HTMLElement,onSettled:()=>void):()=>void{
  let cancelled=false;
  const check=()=>{
    if(cancelled)return;
    const entry=running.get(el);
    if(entry&&entry.animation.playState!=='finished'&&entry.animation.playState!=='idle'){
      // A replacement FLIP cancels its predecessor. Follow the current motion in either case.
      void entry.animation.finished.then(check,check);
      return;
    }
    entry?.release();
    onSettled();
  };
  queueMicrotask(check);
  return ()=>{cancelled=true;};
}

export function getFlipLayout(el:HTMLElement):MotionRect|null{
  const entry=running.get(el);
  if(!entry)return null;
  if(entry.animation.playState==='finished'||entry.animation.playState==='idle'){entry.release();return null;}
  const dx=typeof window==='undefined'?0:(window.scrollX??0)-entry.scrollX;
  const dy=typeof window==='undefined'?0:(window.scrollY??0)-entry.scrollY;
  return {left:entry.layout.left-dx,top:entry.layout.top-dy};
}

/** Reflow shifts the box under an active transform without changing its keyframes. */
export function recordFlipLayout(el:HTMLElement,layout:MotionRect,scroll:{x:number;y:number}){
  const entry=running.get(el);
  if(!entry||entry.animation.playState!=='running')return;
  entry.layout=layout;
  entry.scrollX=scroll.x;
  entry.scrollY=scroll.y;
}

/** The source node can already be detached when a board card remounts in another column. */
export function getFlipPosition(el:HTMLElement):MotionRect|null{
  const layout=getFlipLayout(el);
  const entry=running.get(el);
  if(!layout||!entry)return null;
  const progress=entry.animation.effect?.getComputedTiming().progress??1;
  const p=Number.isFinite(progress)?Math.min(1,Math.max(0,progress)):1;
  return {
    left:layout.left+entry.start.left+(entry.end.left-entry.start.left)*p,
    top:layout.top+entry.start.top+(entry.end.top-entry.start.top)*p,
  };
}

export function hasFreeFlipSlot():boolean{
  if(running.size<6)return true;
  for(const entry of running.values())if(entry.animation.playState==='finished'||entry.animation.playState==='idle')entry.release();
  return running.size<6;
}

export function canStartLiftFlip(el:HTMLElement):boolean{
  if(running.size<6||running.has(el))return true;
  for(const entry of running.values()){
    if(!entry.lift)return true;
    if(entry.animation.playState==='finished'||entry.animation.playState==='idle'){entry.release();return true;}
  }
  return false;
}

/** `from`/`to` are viewport rectangles. Re-entry samples the current visual position before cancelling. */
export function flip(el:HTMLElement,from:MotionRect,to:MotionRect,{duration='--dur-base',easing='--ease-standard',lift=false,fadeOut=false,end,scroll}:FlipOptions={}):Animation{
  const prior=running.get(el);
  if(prior&&(prior.animation.playState==='finished'||prior.animation.playState==='idle'))prior.release();
  const activePrior=running.get(el);
  if(document.hidden||prefersReducedMotion()){activePrior?.animation.cancel();activePrior?.release();return finishedAnimation(el);}
  if(!activePrior&&running.size>=6){
    for(const entry of running.values())if(entry.animation.playState==='finished'||entry.animation.playState==='idle')entry.release();
    if(running.size>=6&&lift){
      const evict=[...running.values()].reverse().find(entry=>!entry.lift);
      if(evict){evict.animation.cancel();evict.release();}
    }
    if(running.size>=6)return finishedAnimation(el);
  }
  // Complete all DOM/layout/scroll/token reads BEFORE mutating styles/attributes to avoid forced reflow.
  const visual=activePrior?el.getBoundingClientRect():from;
  activePrior?.animation.cancel();activePrior?.release();
  if(running.size>=6)return finishedAnimation(el);
  const layout=activePrior?el.getBoundingClientRect():to;
  // Layout may already have moved to the new destination while the previous effect was running.
  // Remove that layout delta from the sampled visual rect before continuing the old trajectory.
  const origin=activePrior?{left:visual.left+activePrior.layout.left-layout.left,top:visual.top+activePrior.layout.top-layout.top}:from;
  const x=origin.left-to.left,y=origin.top-to.top;
  const endX=end?end.left-to.left:0,endY=end?end.top-to.top:0;
  if(!fadeOut&&!x&&!y&&!endX&&!endY)return finishedAnimation(el);
  const durationMs=motionToken(duration);
  const easingValue=motionToken(easing);
  const scrollX=scroll?scroll.x:(typeof window==='undefined'?0:(window.scrollX??0));
  const scrollY=scroll?scroll.y:(typeof window==='undefined'?0:(window.scrollY??0));
  const shadow=el.style.boxShadow,zIndex=el.style.zIndex;
  const hosts=acquireFlipHosts(el);
  if(el.dataset)el.dataset.motionFlipping='true';
  if(lift){el.style.boxShadow='var(--shadow-3)';el.style.zIndex='var(--z-dropdown)';}
  const endTransform=end?`translate(${endX}px, ${endY}px)`:'translate(0, 0)';
  const frames:Keyframe[]=fadeOut
    ?[{transform:`translate(${x}px, ${y}px)`,opacity:1,offset:0},{opacity:1,offset:0.7},{transform:endTransform,opacity:0,offset:1}]
    :[{transform:`translate(${x}px, ${y}px)`},{transform:endTransform}];
  const animation=el.animate(frames,{duration:durationMs,easing:easingValue});
  const release=()=>{if(running.get(el)?.animation===animation){running.delete(el);if(el.dataset)delete el.dataset.motionFlipping;if(lift){el.style.boxShadow=shadow;el.style.zIndex=zIndex;}releaseFlipHosts(hosts);}};
  running.set(el,{animation,layout:{left:layout.left,top:layout.top},scrollX,scrollY,start:{left:x,top:y},end:{left:endX,top:endY},lift,release});
  return trackAnimation(animation,release);
}
