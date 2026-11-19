import {useLayoutEffect,useRef} from 'react';
import {trackAnimation} from '../../motion/lifecycle';
import {useExitPresence} from '../../motion/presence';
import {motionToken,prefersReducedMotion} from '../../motion/tokens';
import './new-items-chip.css';

export interface NewItemsChipProps {
  count:number;
  direction:'up'|'down';
  noun:string;
  onActivate:()=>void;
  className?:string;
}

/** Floating arrival indicator shared by board columns, work table and (36C) timeline. */
export function NewItemsChip({count,direction,noun,onActivate,className=''}:NewItemsChipProps){
  const visible=count>0;
  const present=useExitPresence(visible,'--dur-fast');
  const button=useRef<HTMLButtonElement>(null);
  const activeAnimation=useRef<Animation|null>(null);
  const last=useRef({count:Math.max(1,count),direction,noun});
  if(visible)last.current={count,direction,noun};

  useLayoutEffect(()=>()=>{
    activeAnimation.current?.cancel();
    activeAnimation.current=null;
  },[]);

  useLayoutEffect(()=>{
    const node=button.current;
    const prev=activeAnimation.current;
    if(!present||!node){
      prev?.cancel();
      activeAnimation.current=null;
      return;
    }
    const interrupted=Boolean(prev&&prev.playState==='running');
    const computed=interrupted?getComputedStyle(node):null;
    prev?.cancel();
    activeAnimation.current=null;
    if(document.hidden||typeof node.animate!=='function')return;
    const reduced=prefersReducedMotion();
    if(!visible&&reduced)return;
    const shift=reduced?0:motionToken('--shift-sm');
    const parsedOpacity=computed?Number(computed.opacity):Number.NaN;
    const computedTransform=computed&&computed.transform!=='none'?computed.transform:'translateY(0)';
    if(visible){
      const fromOpacity=Number.isFinite(parsedOpacity)?parsedOpacity:0;
      const fromTransform=interrupted?computedTransform:`translateY(${shift}px)`;
      const frames:Keyframe[]=reduced
        ?[{opacity:fromOpacity},{opacity:1}]
        :[{transform:fromTransform,opacity:fromOpacity},{transform:'translateY(0)',opacity:1}];
      const animation=trackAnimation(
        node.animate(frames,{duration:motionToken('--dur-fast'),easing:motionToken('--ease-standard')}),
        ()=>{if(activeAnimation.current===animation)activeAnimation.current=null;},
      );
      activeAnimation.current=animation;
    }else{
      const fromOpacity=Number.isFinite(parsedOpacity)?parsedOpacity:1;
      const fromTransform=interrupted?computedTransform:'translateY(0)';
      const frames:Keyframe[]=[{transform:fromTransform,opacity:fromOpacity},{transform:`translateY(${shift}px)`,opacity:0}];
      const animation=trackAnimation(
        node.animate(frames,{duration:motionToken('--dur-fast'),easing:motionToken('--ease-exit')}),
        ()=>{if(activeAnimation.current===animation)activeAnimation.current=null;},
      );
      activeAnimation.current=animation;
    }
  },[visible,present]);

  const shown=visible?{count,direction,noun}:last.current;
  const arrow=shown.direction==='down'?'↓':'↑';
  return <div className={'ds-new-items-chip-region'+(className?' '+className:'')} role="status" data-new-items-chip-region>
    {present?<button ref={button} type="button" className="ds-new-items-chip" data-new-items-chip data-direction={shown.direction} data-exiting={!visible?'true':undefined} aria-hidden={!visible?true:undefined} tabIndex={!visible?-1:undefined} inert={!visible} onClick={()=>{if(visible)onActivate();}} onKeyDown={event=>{if(visible&&(event.key==='Enter'||event.key===' ')&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();onActivate();}}}>{arrow} {shown.count} 条新{shown.noun}</button>:null}
  </div>;
}
