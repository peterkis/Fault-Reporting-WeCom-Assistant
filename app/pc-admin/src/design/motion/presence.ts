import {useLayoutEffect,useState} from 'react';
import {motionToken,prefersReducedMotion,useMotionRevision} from './tokens';
import type {DurationToken} from './tokens';

/** Render while true. Reappearance cancels the pending unmount; hidden/reduced means zero retention. */
export function useExitPresence(present:boolean,durationToken:DurationToken):boolean{
  const [retained,setRetained]=useState(present),revision=useMotionRevision();
  useLayoutEffect(()=>{
    if(present){setRetained(true);return;}
    if(document.hidden||prefersReducedMotion()){setRetained(false);return;}
    const timer=setTimeout(()=>setRetained(false),motionToken(durationToken));
    return()=>clearTimeout(timer);
  },[present,durationToken,revision]);
  return present||retained;
}
