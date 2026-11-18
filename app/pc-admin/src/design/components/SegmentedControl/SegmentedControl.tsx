import {Children,useLayoutEffect,useRef} from 'react';
import type {HTMLAttributes} from 'react';
import {motionToken,prefersReducedMotion} from '../../motion/tokens';
import {trackAnimation} from '../../motion/lifecycle';
import './segmented-control.css';

/** The existing buttons retain their values, handlers, roles and semantic hooks. */
export function SegmentedControl({className='',children,...props}:HTMLAttributes<HTMLDivElement>){
  const root=useRef<HTMLDivElement>(null),slider=useRef<HTMLSpanElement>(null),previous=useRef<{x:number;width:number}|null>(null);
  useLayoutEffect(()=>{
    const host=root.current,background=slider.current;if(!host||!background){previous.current=null;return;}
    const update=(animate:boolean)=>{
      const selected=host.querySelector<HTMLElement>(':scope > [aria-pressed=true],:scope > [aria-selected=true],:scope > .selected');
      if(!selected){background.hidden=true;previous.current=null;return;}
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
      for(const animation of background.getAnimations())animation.cancel();
      background.style.width=target.width+'px';background.style.transform=`translateX(${target.x}px)`;
      previous.current=target;
      if(!animate||!before||document.hidden||prefersReducedMotion())return;
      trackAnimation(background.animate([{transform:`translateX(${visual.left-container.left}px) scaleX(${visual.width/target.width})`},{transform:`translateX(${target.x}px) scaleX(1)`}],{duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')}));
    };
    update(true);
    let width=host.clientWidth;
    const resize=new ResizeObserver(()=>{if(host.clientWidth!==width){width=host.clientWidth;update(false);}});resize.observe(host);
    return()=>resize.disconnect();
  },[children]);
  return <div ref={root} role="group" {...props} className={'ds-segmented '+className}>{Children.toArray(children).length?<span ref={slider} className="ds-segmented-slider" aria-hidden="true"/>:null}{children}</div>;
}
