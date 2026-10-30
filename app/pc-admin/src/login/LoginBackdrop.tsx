import {useEffect,useRef,useState} from 'react';
import {createShader} from 'shaders/js';
import type {ShaderInstance} from 'shaders/js';
import type {ComponentProps} from 'shaders/core/Blob';

const PIXEL_BUDGET=1_100_000;
const cobalt={colorA:'#2864e8',colorB:'#6067dd',colorSpace:'oklab',size:0.46,deformation:0.78,softness:0.14,speed:0.32,seed:7,center:{x:0.63,y:0.42},highlightIntensity:0.3,highlightColor:'#dcecff'} satisfies Partial<ComponentProps>;
const lilac={colorA:'#507fe8',colorB:'#9a83e8',colorSpace:'oklab',size:0.36,deformation:0.68,softness:0.18,speed:0.24,seed:27,center:{x:0.24,y:0.81},highlightIntensity:0.24,highlightColor:'#e5efff'} satisfies Partial<ComponentProps>;
const terminal=new Set(['unsupported','no-adapter','no-device','init-failed','device-lost','out-of-memory','gpu-error','render-failed','limit-exceeded','unrecoverable','rebuild_failed']);

export default function LoginBackdrop({onReady,onUnavailable}:{onReady:()=>void;onUnavailable:(reason:string)=>void}){
  const canvasRef=useRef<HTMLCanvasElement>(null),callbacks=useRef({onReady,onUnavailable});
  callbacks.current={onReady,onUnavailable};
  const [state,setState]=useState<'loading'|'ready'|'paused'|'fallback'>('loading');
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    let instance:ShaderInstance|null=null,disposed=false,ready=false,failed=false;
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
    void createShader(canvas,{components:[{type:'SolidColor',id:'base',props:{color:'#f5f5f2'}},{type:'Blob',id:'cobalt',props:{...cobalt,opacity:0.82}},{type:'Blob',id:'lilac',props:{...lilac,opacity:0.58}}]},
      {colorSpace:'srgb',disableTelemetry:true,observeElement:false,onReady:()=>{if(disposed||failed)return;ready=true;sync();queueMicrotask(()=>{if(!disposed&&!failed)callbacks.current.onReady();});},onError:reason=>{if(terminal.has(reason))fail(reason);}})
      .then(value=>{if(disposed||failed){value.destroy();return;}instance=value;resize();const failure=value.getFailureReason();if(failure)fail(failure);else sync();})
      .catch(()=>fail('init-failed'));
    return()=>{disposed=true;observer.disconnect();document.removeEventListener('visibilitychange',sync);window.removeEventListener('offline',sync);window.removeEventListener('online',sync);media.removeEventListener('change',sync);instance?.destroy();};
  },[]);
  return <div className="login-atmosphere" data-blob-state={state}><canvas className="login-blob" ref={canvasRef} style={{width:'100%',height:'100%',display:state==='fallback'?'none':'block'}}/></div>;
}
