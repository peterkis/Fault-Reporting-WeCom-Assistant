import {motionToken,prefersReducedMotion,subscribeMotion} from './tokens';

export interface ReturnCueHandle {cancel:()=>void;finished:Promise<void>}
const running=new WeakMap<HTMLElement,()=>void>();
const pendingScroll=new WeakMap<HTMLElement,()=>void>();

/** Repeat calls restart the full hold/fade. Cancelling or finishing restores inline background and clears data-return-cue. */
export function returnCue(el:HTMLElement):ReturnCueHandle{
  pendingScroll.get(el)?.();
  running.get(el)?.();
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  const original=el.style.backgroundColor,background=getComputedStyle(el).backgroundColor;
  const color=getComputedStyle(document.documentElement).getPropertyValue('--brand-subtle').trim();
  const duration=motionToken('--dur-return');
  let timer:ReturnType<typeof setTimeout>|undefined,holdFrame=0,released=false,holding=false;
  const reduced=prefersReducedMotion();
  el.setAttribute('data-return-cue','true');
  const animation=reduced?undefined:el.animate([{backgroundColor:color},{backgroundColor:background}],{duration,easing:motionToken('--ease-standard')});
  let complete=()=>{};const finished=new Promise<void>(resolve=>{complete=resolve;});
  const cleanup=()=>{
    if(released)return;
    released=true;
    cancelAnimationFrame(holdFrame);
    clearTimeout(timer);
    unsubscribe();
    animation?.cancel();
    el.style.backgroundColor=original;
    el.removeAttribute('data-return-cue');
    running.delete(el);
    complete();
  };
  const hold=()=>{
    if(holding)return;
    holding=true;
    animation?.cancel();
    el.style.backgroundColor=color;
    // The board needs a paint opportunity before the visible hold starts counting down.
    holdFrame=requestAnimationFrame(()=>{
      holdFrame=requestAnimationFrame(()=>{timer=setTimeout(cleanup,duration);});
    });
  };
  const unsubscribe=subscribeMotion(()=>{if(document.hidden)cleanup();else if(prefersReducedMotion())hold();});
  running.set(el,cleanup);
  if(reduced)hold();else if(animation)void animation.finished.then(()=>{if(!holding)cleanup();},()=>{if(!holding)cleanup();});
  return {cancel:cleanup,finished};
}

function scrollableAncestors(el:HTMLElement):HTMLElement[]{
  const list:HTMLElement[]=[];
  for(let node=el.parentElement;node&&node!==document.documentElement;node=node.parentElement){
    const overflow=getComputedStyle(node).overflowY;
    if((overflow==='auto'||overflow==='scroll'||overflow==='overlay')&&node.scrollHeight>node.clientHeight+1)list.push(node);
  }
  return list;
}

function isOutOfView(el:HTMLElement,ancestors:readonly HTMLElement[]):boolean{
  const rect=el.getBoundingClientRect();
  if(rect.width===0&&rect.height===0)return false;
  const topbar=document.querySelector<HTMLElement>('.topbar');
  const viewportTop=topbar&&getComputedStyle(topbar).position==='sticky'?Math.max(0,topbar.getBoundingClientRect().bottom):0;
  if(rect.top<viewportTop-1||rect.bottom>window.innerHeight+1)return true;
  for(const ancestor of ancestors){
    const box=ancestor.getBoundingClientRect();
    const thead=ancestor.classList.contains('ds-work-table-wrap')?ancestor.querySelector<HTMLElement>('thead'):null;
    const top=thead?Math.max(box.top,thead.getBoundingClientRect().bottom):box.top;
    if(rect.top<top-1||rect.bottom>box.bottom+1)return true;
  }
  return false;
}

/** Scrolls an off-screen card/row into view first (smooth, or auto under reduced motion), then plays returnCue. */
export function scrollIntoViewAndReturnCue(el:HTMLElement):ReturnCueHandle{
  pendingScroll.get(el)?.();
  running.get(el)?.();
  if(document.hidden)return {cancel:()=>{},finished:Promise.resolve()};
  const ancestors=scrollableAncestors(el);
  if(!isOutOfView(el,ancestors))return returnCue(el);
  const reduced=prefersReducedMotion();
  el.scrollIntoView({block:'center',behavior:reduced?'auto':'smooth'});
  if(reduced)return returnCue(el);
  let settled=false,cancelled=false,frame=0,stableFrames=0,lastTop=el.getBoundingClientRect().top,activeCue:ReturnCueHandle|null=null;
  let resolveDone=()=>{};const finished=new Promise<void>(resolve=>{resolveDone=resolve;});
  const targets:EventTarget[]=[window,...ancestors];
  const stopWaiting=()=>{
    if(settled)return;settled=true;
    cancelAnimationFrame(frame);clearTimeout(timer);unsubscribe();pendingScroll.delete(el);
    for(const target of targets)target.removeEventListener('scrollend',onScrollEnd);
  };
  const startCue=()=>{
    stopWaiting();
    if(cancelled||!el.isConnected||document.hidden){resolveDone();return;}
    activeCue=returnCue(el);
    void activeCue.finished.then(resolveDone);
  };
  const onScrollEnd=()=>startCue();
  const poll=()=>{
    if(settled)return;
    const top=el.getBoundingClientRect().top;
    if(Math.abs(top-lastTop)<0.5)stableFrames++;else{stableFrames=0;lastTop=top;}
    if(stableFrames>=4){startCue();return;}
    frame=requestAnimationFrame(poll);
  };
  const cancel=()=>{
    if(cancelled)return;cancelled=true;
    stopWaiting();
    if(activeCue)activeCue.cancel();else resolveDone();
  };
  const unsubscribe=subscribeMotion(()=>{if(document.hidden)cancel();else if(prefersReducedMotion())startCue();});
  for(const target of targets)target.addEventListener('scrollend',onScrollEnd,{once:true});
  const timer=setTimeout(startCue,motionToken('--dur-return'));
  frame=requestAnimationFrame(poll);
  pendingScroll.set(el,cancel);
  return {cancel,finished};
}
