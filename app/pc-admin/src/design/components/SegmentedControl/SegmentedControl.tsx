import {Children,useLayoutEffect,useRef} from 'react';
import type {HTMLAttributes} from 'react';
import {motionToken,prefersReducedMotion} from '../../motion/tokens';
import {trackAnimation} from '../../motion/lifecycle';
import './segmented-control.css';

/** The existing buttons retain their values, handlers, roles and semantic hooks. */
export function SegmentedControl({className='',children,...props}:HTMLAttributes<HTMLDivElement>){
  const root=useRef<HTMLDivElement>(null),slider=useRef<HTMLSpanElement>(null),previous=useRef<{x:number;width:number}|null>(null);
  const lastSelected=useRef<{el:HTMLElement|null;text:string;count:number}>({el:null,text:'',count:-1});
  const activeAnimation=useRef<Animation|null>(null);
  const updateRef=useRef<(animate:boolean,force?:boolean)=>void>(()=>{});
  updateRef.current=(animate:boolean,force=false)=>{
    const host=root.current,background=slider.current;
    if(!host||!background){previous.current=null;lastSelected.current={el:null,text:'',count:-1};return;}
    const selected=host.querySelector<HTMLElement>(':scope > [aria-pressed=true],:scope > [aria-selected=true],:scope > .selected');
    if(!selected){background.hidden=true;previous.current=null;lastSelected.current={el:null,text:'',count:host.childElementCount};return;}
    const text=selected.textContent??'',count=host.childElementCount;
    if(!force&&previous.current&&lastSelected.current.el===selected&&lastSelected.current.text===text&&lastSelected.current.count===count)return;
    lastSelected.current={el:selected,text,count};
    background.hidden=false;
    const container=host.getBoundingClientRect(),rect=selected.getBoundingClientRect(),selectedStyle=getComputedStyle(selected),transform=selectedStyle.transform;
    const scale=transform==='none'?1:new DOMMatrixReadOnly(transform).a;
    const width=rect.width/scale,target={x:rect.left-container.left-(width-rect.width)/2,width},before=previous.current;
    // Also match the pill-shaped view switch's actual inset, height and radius.
    background.style.top=rect.top-container.top-(rect.height/scale-rect.height)/2+'px';
    background.style.height=rect.height/scale+'px';background.style.borderRadius=selectedStyle.borderRadius;
    // Keep subpixel geometry and remove only the button's centred press scale from the measurement.
    if(before&&Math.abs(before.x-target.x)<.01&&Math.abs(before.width-target.width)<.01)return;
    // Sample before cancellation so a rapid second selection continues at the visual position.
    const visual=background.getBoundingClientRect();
    activeAnimation.current?.cancel();activeAnimation.current=null;
    background.style.width=target.width+'px';background.style.transform=`translateX(${target.x}px)`;
    previous.current=target;
    if(!animate||!before||document.hidden||prefersReducedMotion())return;
    const animation=trackAnimation(
      background.animate([{transform:`translateX(${visual.left-container.left}px) scaleX(${visual.width/target.width})`},{transform:`translateX(${target.x}px) scaleX(1)`}],{duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')}),
      ()=>{if(activeAnimation.current===animation)activeAnimation.current=null;},
    );
    activeAnimation.current=animation;
  };
  useLayoutEffect(()=>{updateRef.current(true,false);},[children]);
  useLayoutEffect(()=>{
    const host=root.current;if(!host)return;
    let width=host.clientWidth;
    const resize=new ResizeObserver(()=>{if(host.clientWidth!==width){width=host.clientWidth;updateRef.current(false,true);}});
    resize.observe(host);
    return()=>{resize.disconnect();activeAnimation.current?.cancel();activeAnimation.current=null;};
  },[]);
  return <div ref={root} role="group" {...props} className={'ds-segmented '+className}>{Children.toArray(children).length?<span ref={slider} className="ds-segmented-slider" aria-hidden="true"/>:null}{children}</div>;
}
