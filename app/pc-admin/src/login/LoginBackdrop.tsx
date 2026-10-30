import {useEffect,useState} from 'react';
import {Blob,Shader} from 'shaders/react';

const canAnimate=()=>!document.hidden&&navigator.onLine&&matchMedia('(min-width: 801px)').matches;

/** A single bounded generator; the login panel and badge never wait for its GPU. */
export default function LoginBackdrop(){
  const [active,setActive]=useState(canAnimate),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const width=matchMedia('(min-width: 801px)'),update=()=>setActive(canAnimate());
    document.addEventListener('visibilitychange',update);
    window.addEventListener('online',update);window.addEventListener('offline',update);width.addEventListener('change',update);
    update();
    return()=>{document.removeEventListener('visibilitychange',update);window.removeEventListener('online',update);window.removeEventListener('offline',update);width.removeEventListener('change',update);};
  },[]);
  if(failed)return <div data-blob-state="fallback"/>;
  return <Shader className="login-blob" colorSpace="srgb" disableTelemetry
    data-blob-state={!active?'paused':ready?'ready':'loading'}
    style={{display:active?'block':'none',opacity:ready?0.72:0}}
    onReady={()=>setReady(true)} onUnavailable={()=>setFailed(true)}>
    <Blob colorA="#a5c5f7" colorB="#dce9fb" colorSpace="oklab" size={0.31}
      deformation={0.35} softness={0.34} speed={0.15} seed={7}
      highlightIntensity={0.14} highlightColor="#f4f8ff"/>
  </Shader>;
}
