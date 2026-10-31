import {useEffect,useRef,useState} from 'react';
import {createBackdropRenderer} from './backdrop-renderer';

const PIXEL_BUDGET=550_000;

export default function LoginBackdrop({onReady,onUnavailable}:{onReady:()=>void;onUnavailable:(reason:string)=>void}){
  const canvasRef=useRef<HTMLCanvasElement>(null),callbacks=useRef({onReady,onUnavailable});
  callbacks.current={onReady,onUnavailable};
  const [state,setState]=useState<'loading'|'ready'|'paused'|'fallback'>('loading');
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    let instance:ReturnType<typeof createBackdropRenderer>|null=null,disposed=false,ready=false,failed=false;
    const active=()=>!document.hidden&&navigator.onLine&&matchMedia('(min-width: 801px)').matches;
    const fail=(reason:string)=>{if(disposed||failed)return;failed=true;instance?.destroy();setState('fallback');queueMicrotask(()=>{if(!disposed)callbacks.current.onUnavailable(reason);});};
    const sync=()=>{if(disposed||failed)return;const running=active();if(instance){if(running)instance.resume();else instance.pause();}setState(!running?'paused':ready?'ready':'loading');};
    const resize=()=>{
      if(!instance||disposed||failed)return;
      const host=canvas.parentElement;if(!host)return;
      const width=host.clientWidth,height=host.clientHeight,dpr=Math.max(1,window.devicePixelRatio||1);
      const scale=Math.min(1,Math.sqrt(PIXEL_BUDGET/(width*height*dpr*dpr)));
      instance.resize(Math.max(1,Math.floor(width*scale)),Math.max(1,Math.floor(height*scale)));
      canvas.style.width='100%';canvas.style.height='100%';
    };
    const observer=new ResizeObserver(resize);if(canvas.parentElement)observer.observe(canvas.parentElement);
    const media=matchMedia('(min-width: 801px)');
    document.addEventListener('visibilitychange',sync);window.addEventListener('offline',sync);window.addEventListener('online',sync);media.addEventListener('change',sync);
    instance=createBackdropRenderer(canvas,{onReady:()=>{if(disposed||failed)return;ready=true;sync();queueMicrotask(()=>{if(!disposed&&!failed)callbacks.current.onReady();});},onUnavailable:fail});
    resize();sync();
    return()=>{disposed=true;observer.disconnect();document.removeEventListener('visibilitychange',sync);window.removeEventListener('offline',sync);window.removeEventListener('online',sync);media.removeEventListener('change',sync);instance?.destroy();};
  },[]);
  return <div className="login-atmosphere" data-blob-state={state}><canvas className="login-blob" ref={canvasRef} style={{width:'100%',height:'100%',display:state==='fallback'?'none':'block'}}/></div>;
}
