import {motionToken,prefersReducedMotion} from './tokens';
import {trackAnimation} from './lifecycle';

export type DetailSwitchDirection='next'|'prev';

const STRIP_ATTRS=[
  'id','role','aria-busy','data-skeleton','data-toast-host','data-activity-field',
  'data-presence-banner-anchor','data-presence-editing','data-presence-field-banner',
  'data-presence-banner-host','data-readonly-reason','data-action','data-step-action',
  'data-assignment-history-row','data-loading-status','data-refreshing','data-stale',
  'data-detail-body-enter','data-detail-body-exit','data-new-items-chip-region','data-new-items-chip',
];

function sanitizeClone(root:HTMLElement){
  for(const attr of STRIP_ATTRS)root.removeAttribute(attr);
  for(const node of root.querySelectorAll('*')){
    for(const attr of STRIP_ATTRS)node.removeAttribute(attr);
  }
}

/**
 * Snapshots the outgoing detail body into an inert, aria-hidden clone placed after the live body
 * and animates it out over --dur-fast / --ease-exit. Returns a synchronous cancel/remove function.
 */
export function startDetailBodyExit(stage:HTMLElement,live:HTMLElement,direction:DetailSwitchDirection):()=>void{
  if(document.hidden||prefersReducedMotion())return()=>{};
  if(!live.firstElementChild||live.getBoundingClientRect().height<=0)return()=>{};
  const liveScroll=live.querySelector<HTMLElement>('.detail-body');
  const scrollTop=liveScroll?.scrollTop??0;
  const clone=live.cloneNode(true) as HTMLElement;
  sanitizeClone(clone);
  clone.className='ds-detail-body-exit';
  clone.setAttribute('aria-hidden','true');
  clone.inert=true;
  clone.setAttribute('data-detail-body-exit',direction);
  stage.appendChild(clone);
  const cloneScroll=clone.querySelector<HTMLElement>('.detail-body');
  if(cloneScroll&&scrollTop>0)cloneScroll.scrollTop=scrollTop;
  const shift=motionToken('--shift-md'),offset=direction==='next'?-shift:shift;
  let removed=false;
  const remove=()=>{if(removed)return;removed=true;clone.remove();};
  const animation=trackAnimation(
    clone.animate(
      [{transform:'translateY(0)',opacity:1},{transform:`translateY(${offset}px)`,opacity:0}],
      {duration:motionToken('--dur-fast'),easing:motionToken('--ease-exit'),fill:'forwards'},
    ),
    remove,
  );
  return()=>{animation.cancel();remove();};
}

/**
 * Animates the newly mounted detail body into place: directional translateY+opacity (--dur-base / --ease-standard),
 * or opacity-only fade (--dur-fast / --ease-standard) when transitioning from a 35A DetailSkeleton.
 */
export function startDetailBodyEnter(el:HTMLElement,mode:DetailSwitchDirection|'fade',onComplete?:()=>void):()=>void{
  if(document.hidden||prefersReducedMotion()){onComplete?.();return()=>{};}
  el.setAttribute('data-detail-body-enter',mode);
  let settled=false,cancelled=false;
  const cleanup=()=>{if(settled)return;settled=true;el.removeAttribute('data-detail-body-enter');if(!cancelled)onComplete?.();};
  const shift=motionToken('--shift-md');
  const animation=mode==='fade'
    ?trackAnimation(
      el.animate([{opacity:0},{opacity:1}],{duration:motionToken('--dur-fast'),easing:motionToken('--ease-standard')}),
      cleanup,
    )
    :trackAnimation(
      el.animate(
        [{transform:`translateY(${mode==='next'?shift:-shift}px)`,opacity:0},{transform:'translateY(0)',opacity:1}],
        {duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')},
      ),
      cleanup,
    );
  return()=>{cancelled=true;animation.cancel();cleanup();};
}

/** C1 full-page detail fade: opacity only over --dur-fast / --ease-standard (also allowed under reduced motion). */
export function startFullPageDetailEnter(el:HTMLElement):()=>void{
  if(document.hidden)return()=>{};
  const animation=trackAnimation(
    el.animate([{opacity:0},{opacity:1}],{duration:motionToken('--dur-fast'),easing:motionToken('--ease-standard')}),
  );
  return()=>{animation.cancel();};
}
