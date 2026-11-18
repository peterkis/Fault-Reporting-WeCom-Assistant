import {useLayoutEffect,useState} from 'react';
import {motionToken,useMotionRevision} from '../../motion/tokens';

/** Custom (non-HeroUI) popovers share E4's transition lifecycle without owning focus or business state. */
export function usePopoverPresence(open:boolean){
  const [retained,setRetained]=useState(open),[entering,setEntering]=useState(open),revision=useMotionRevision();
  useLayoutEffect(()=>{
    if(!open){
      setEntering(false);
      if(document.hidden||!retained){setRetained(false);return;}
      // E4 keeps an opacity-only exit even under reduced motion. Public useExitPresence has a different, zero-retention contract.
      const timer=setTimeout(()=>setRetained(false),motionToken('--dur-instant'));return()=>clearTimeout(timer);
    }
    setRetained(true);
    if(retained||document.hidden){setEntering(false);return;}
    // A committed starting style needs two paint opportunities before clearing entering.
    // Geometry consumers must await this attribute AND the transition it subsequently creates.
    setEntering(true);
    const frame=requestAnimationFrame(()=>{const next=requestAnimationFrame(()=>setEntering(false));nested=next;});
    let nested:number|undefined;
    return()=>{cancelAnimationFrame(frame);if(nested!==undefined)cancelAnimationFrame(nested);};
  },[open,revision]);
  return {present:open||retained,attributes:{'data-entering':open&&entering?true:undefined,'data-exiting':!open?true:undefined,'aria-hidden':!open?true:undefined,inert:!open}};
}
