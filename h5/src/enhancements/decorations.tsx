import {useEffect,useRef,useState} from 'react';
import {motion} from 'motion/react';
import {Shine} from '@animate-ui/react/primitives/effects/shine';

export function EntryShine({active}:{active:boolean}){
 const count=useRef(0),[playing,setPlaying]=useState(false);
 useEffect(()=>{
  if(!active||count.current>=3){setPlaying(false);return;}
  let finish:ReturnType<typeof setTimeout>|undefined,next:ReturnType<typeof setTimeout>;
  const play=()=>{count.current+=1;setPlaying(true);finish=setTimeout(()=>{setPlaying(false);if(count.current<3)next=setTimeout(play,8000);},1000);};
  next=setTimeout(play,count.current===0?2000:8000);
  return()=>{clearTimeout(next);clearTimeout(finish);setPlaying(false);};
 },[active]);
 return playing&&active?<Shine key={count.current} className="h5-shine" color="#fff" opacity={0.16} duration={1000} loop={false} data-h5-shine={count.current}/>:null;
}
export function CurrentPulse({active}:{active:boolean}){
 return active?<motion.span className="h5-current-pulse" data-h5-pulse="active" initial={{scale:1,opacity:0.25}} animate={{scale:[1,1.18,1],opacity:[0.25,0.5,0.25]}} transition={{duration:2.8,ease:'easeInOut',repeat:Infinity}}/>:null;
}
