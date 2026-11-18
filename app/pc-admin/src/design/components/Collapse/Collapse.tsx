import {useLayoutEffect,useRef} from 'react';
import type {HTMLAttributes} from 'react';
import {useExitPresence} from '../../motion/presence';
import './collapse.css';

/** One grid track expands the whole block. Children are never given per-row entrance effects. */
export function Collapse({expanded,children,className='',...props}:HTMLAttributes<HTMLDivElement>&{expanded:boolean}){
  const present=useExitPresence(expanded,'--dur-base'),root=useRef<HTMLDivElement>(null);
  const first=useRef(true);
  useLayoutEffect(()=>{
    const node=root.current;if(!node){first.current=false;return;}
    // Establish 0fr after insertion, then transition. First expanded render is already at its end state.
    if(first.current){node.dataset.expanded=String(expanded);first.current=false;return;}
    if(expanded){getComputedStyle(node).gridTemplateRows;node.dataset.expanded='true';}
    else node.dataset.expanded='false';
  },[expanded,present]);
  return present?<div {...props} ref={root} className={'ds-collapse '+className} inert={!expanded} data-expanded="false"><div className="ds-collapse-inner">{children}</div></div>:null;
}

/** Keep the existing lucide direction hooks while one stable path rotates with its container. */
export function CollapseChevron({expanded,from='down',size=14}:{expanded:boolean;from?:'down'|'right';size?:number}){
  const direction=from==='right'?(expanded?'down':'right'):(expanded?'up':'down');
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={'lucide lucide-chevron-'+direction} aria-hidden="true"><path d={from==='right'?'m9 18 6-6-6-6':'m6 9 6 6 6-6'}/></svg>;
}
