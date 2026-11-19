import {prefersReducedMotion,subscribeMotion} from './tokens';

/** A real, already-finished Animation without adding an effect to the document. */
export function finishedAnimation(el:Element){
  const animation=new Animation(new KeyframeEffect(el,[],{duration:0}),document.timeline);
  animation.finish();return animation;
}
/** Finite animations never resume from stale positions after hiding the tab or reducing motion. */
export function trackAnimation(animation:Animation,cleanup:()=>void=()=>{}){
  let released=false;
  const release=()=>{if(released)return;released=true;unsubscribe();cleanup();};
  const unsubscribe=subscribeMotion(()=>{if(document.hidden||prefersReducedMotion()){animation.finish();release();}});
  void animation.finished.then(release,release);
  return animation;
}
