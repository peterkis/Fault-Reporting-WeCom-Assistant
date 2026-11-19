import {motionToken,prefersReducedMotion} from './tokens';
import type {DurationToken,EasingToken} from './tokens';
import {finishedAnimation,trackAnimation} from './lifecycle';

export type MotionRect=Pick<DOMRectReadOnly,'left'|'top'>;
const running=new Map<HTMLElement,{animation:Animation;layout:MotionRect;release:()=>void}>();
/** `from`/`to` are viewport rectangles. Re-entry samples the current visual position before cancelling. */
export function flip(el:HTMLElement,from:MotionRect,to:MotionRect,{duration='--dur-base',easing='--ease-standard',lift=false}:{duration?:DurationToken;easing?:EasingToken;lift?:boolean}={}):Animation{
  for(const entry of running.values())if(entry.animation.playState==='finished'||entry.animation.playState==='idle')entry.release();
  const prior=running.get(el),visual=prior?el.getBoundingClientRect():from;
  prior?.animation.cancel();prior?.release();
  const layout=el.getBoundingClientRect();
  // Layout may already have moved to the new destination while the previous effect was running.
  // Remove that layout delta from the sampled visual rect before continuing the old trajectory.
  const origin=prior?{left:visual.left+prior.layout.left-layout.left,top:visual.top+prior.layout.top-layout.top}:from;
  if(document.hidden||prefersReducedMotion()||running.size>=6)return finishedAnimation(el);
  const x=origin.left-to.left,y=origin.top-to.top;
  if(!x&&!y)return finishedAnimation(el);
  const shadow=el.style.boxShadow,zIndex=el.style.zIndex;
  if(lift){el.style.boxShadow='var(--shadow-3)';el.style.zIndex='var(--z-dropdown)';}
  const animation=el.animate([{transform:`translate(${x}px, ${y}px)`},{transform:'translate(0, 0)'}],{duration:motionToken(duration),easing:motionToken(easing)});
  const release=()=>{if(running.get(el)?.animation===animation){running.delete(el);if(lift){el.style.boxShadow=shadow;el.style.zIndex=zIndex;}}};
  running.set(el,{animation,layout:{left:layout.left,top:layout.top},release});
  return trackAnimation(animation,release);
}
