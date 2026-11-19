import {useLayoutEffect,useRef} from 'react';
import {motionToken,useReducedMotion} from './tokens';
import {trackAnimation} from './lifecycle';
import './number-roll.css';

/** Set animate=false for scope/filter/view changes. Whole values roll; only the latest target survives. */
export function NumberRoll({value,animate=true}:{value:number;animate?:boolean}){
  const previous=useRef(value),root=useRef<HTMLSpanElement>(null),old=useRef<HTMLSpanElement>(null),next=useRef<HTMLSpanElement>(null);
  const active=useRef<Animation[]>([]);
  const reduced=useReducedMotion();
  useLayoutEffect(()=>{
    const before=previous.current;previous.current=value;
    const host=root.current,leaving=old.current,entering=next.current;
    if(!host||!leaving||!entering)return;
    if(before===value&&active.current.length===0)return;
    for(const animation of active.current)animation.cancel();
    active.current=[];
    if(before===value||!animate||reduced||document.hidden){
      delete leaving.dataset.value;
      host.style.minWidth='';
      return;
    }
    const direction=value>before?1:-1,options={duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')};
    leaving.dataset.value=String(before);
    host.style.minWidth=Math.max(String(before).length,String(value).length)+'ch';
    const leaveAnim=trackAnimation(leaving.animate([{transform:'translateY(0)',opacity:1},{transform:`translateY(${-direction*100}%)`,opacity:0}],options));
    const enterAnim=trackAnimation(entering.animate([{transform:`translateY(${direction*100}%)`,opacity:0},{transform:'translateY(0)',opacity:1}],options));
    active.current=[leaveAnim,enterAnim];
    return()=>{for(const animation of active.current)animation.cancel();active.current=[];};
  },[value,animate,reduced]);
  return <span ref={root} className="ds-number-roll" aria-live="off"><span ref={next} className="ds-number-roll-next" aria-hidden="true" data-value={String(value)}/><span ref={old} className="ds-number-roll-old" aria-hidden="true"/><span className="sr-only">{value}</span></span>;
}
