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
}
const running=new Map<HTMLElement,{animation:Animation;layout:MotionRect;scrollX:number;scrollY:number;lift:boolean;release:()=>void}>();

export function getFlipLayout(el:HTMLElement):MotionRect|null{
  const entry=running.get(el);
  if(!entry)return null;
  if(entry.animation.playState==='finished'||entry.animation.playState==='idle'){entry.release();return null;}
  const dx=typeof window==='undefined'?0:(window.scrollX??0)-entry.scrollX;
  const dy=typeof window==='undefined'?0:(window.scrollY??0)-entry.scrollY;
  return {left:entry.layout.left-dx,top:entry.layout.top-dy};
}

export function hasFreeFlipSlot():boolean{
  for(const entry of running.values())if(entry.animation.playState==='finished'||entry.animation.playState==='idle')entry.release();
  return running.size<6;
}

/** `from`/`to` are viewport rectangles. Re-entry samples the current visual position before cancelling. */
export function flip(el:HTMLElement,from:MotionRect,to:MotionRect,{duration='--dur-base',easing='--ease-standard',lift=false,fadeOut=false,end}:FlipOptions={}):Animation{
  for(const entry of running.values())if(entry.animation.playState==='finished'||entry.animation.playState==='idle')entry.release();
  const prior=running.get(el);
  if(document.hidden||prefersReducedMotion()){prior?.animation.cancel();prior?.release();return finishedAnimation(el);}
  if(!prior&&running.size>=6){
    if(lift){
      const evict=[...running.values()].reverse().find(entry=>!entry.lift);
      if(evict){evict.animation.cancel();evict.release();}
    }
    if(running.size>=6)return finishedAnimation(el);
  }
  const visual=prior?el.getBoundingClientRect():from;
  prior?.animation.cancel();prior?.release();
  if(running.size>=6)return finishedAnimation(el);
  const layout=prior?el.getBoundingClientRect():to;
  // Layout may already have moved to the new destination while the previous effect was running.
  // Remove that layout delta from the sampled visual rect before continuing the old trajectory.
  const origin=prior?{left:visual.left+prior.layout.left-layout.left,top:visual.top+prior.layout.top-layout.top}:from;
  const x=origin.left-to.left,y=origin.top-to.top;
  const endX=end?end.left-to.left:0,endY=end?end.top-to.top:0;
  if(!fadeOut&&!x&&!y&&!endX&&!endY)return finishedAnimation(el);
  const shadow=el.style.boxShadow,zIndex=el.style.zIndex;
  if(el.dataset)el.dataset.motionFlipping='true';
  if(lift){el.style.boxShadow='var(--shadow-3)';el.style.zIndex='var(--z-dropdown)';}
  const endTransform=end?`translate(${endX}px, ${endY}px)`:'translate(0, 0)';
  const frames:Keyframe[]=fadeOut
    ?[{transform:`translate(${x}px, ${y}px)`,opacity:1,offset:0},{opacity:1,offset:0.7},{transform:endTransform,opacity:0,offset:1}]
    :[{transform:`translate(${x}px, ${y}px)`},{transform:endTransform}];
  const animation=el.animate(frames,{duration:motionToken(duration),easing:motionToken(easing)});
  const release=()=>{if(running.get(el)?.animation===animation){running.delete(el);if(el.dataset)delete el.dataset.motionFlipping;if(lift){el.style.boxShadow=shadow;el.style.zIndex=zIndex;}}};
  const scrollX=typeof window==='undefined'?0:(window.scrollX??0);
  const scrollY=typeof window==='undefined'?0:(window.scrollY??0);
  running.set(el,{animation,layout:{left:layout.left,top:layout.top},scrollX,scrollY,lift,release});
  return trackAnimation(animation,release);
}
