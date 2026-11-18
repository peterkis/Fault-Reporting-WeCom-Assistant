import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {loadingTiming,stateDuration} from './state-timing';

/** Old content bypasses loading. Minimum exposure starts at the first painted skeleton frame. */
export function useDelayedLoading(loading:boolean,options=loadingTiming()){
  const {delay,minVisible}=options;
  const [visible,setVisible]=useState(false),[slow,setSlow]=useState(false),[paintedAt,setPaintedAt]=useState<number|null>(null);
  const startedAt=useRef<number|null>(null);
  useEffect(()=>{
    if(!loading){startedAt.current=null;setSlow(false);return;}
    startedAt.current??=performance.now();
    const show=visible?undefined:window.setTimeout(()=>setVisible(true),Math.max(0,delay-(performance.now()-startedAt.current)));
    const slowTimer=window.setTimeout(()=>setSlow(true),Math.max(0,stateDuration('--load-slow')-(performance.now()-startedAt.current)));
    return()=>{window.clearTimeout(show);window.clearTimeout(slowTimer);};
  },[loading,delay,visible]);
  useLayoutEffect(()=>{
    if(!visible)return;
    const frame=requestAnimationFrame(()=>setPaintedAt(performance.now()));
    return()=>cancelAnimationFrame(frame);
  },[visible]);
  useEffect(()=>{
    if(loading||!visible||paintedAt===null)return;
    const timer=window.setTimeout(()=>{setVisible(false);setPaintedAt(null);},Math.ceil(Math.max(0,minVisible-(performance.now()-paintedAt))));
    return()=>window.clearTimeout(timer);
  },[loading,visible,paintedAt,minVisible]);
  return {visible,slow:loading&&slow};
}
