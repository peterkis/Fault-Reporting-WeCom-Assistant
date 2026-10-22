import {useEffect,useState} from 'react';
import {motionAllowed} from '../experience';
type Props={kind:'entry'|'current';active:boolean};
/** The small scheduler itself is optional; neither it nor Motion gates readiness. */
export function Ambient(props:Props){return motionAllowed()?<DeferredAmbient {...props}/>:null;}
function DeferredAmbient(props:Props){
 const [runtime,setRuntime]=useState<typeof import('./AmbientRuntime')|null>(null);
 useEffect(()=>{
  if(!props.active||runtime)return;
  let alive=true,id:number|undefined;
  const load=()=>{if(!document.hidden&&motionAllowed())void import('./AmbientRuntime').then(value=>{if(alive)setRuntime(value);},()=>{});};
  const cancel=()=>{if(id!==undefined){if(typeof cancelIdleCallback==='function')cancelIdleCallback(id);else clearTimeout(id);id=undefined;}};
  const schedule=()=>{cancel();if(!document.hidden)id=typeof requestIdleCallback==='function'?requestIdleCallback(load,{timeout:1500}):window.setTimeout(load,250);};
  schedule();document.addEventListener('visibilitychange',schedule);
  return()=>{alive=false;cancel();document.removeEventListener('visibilitychange',schedule);};
 },[props.active,runtime]);
 return runtime?<runtime.Ambient {...props}/>:null;
}
