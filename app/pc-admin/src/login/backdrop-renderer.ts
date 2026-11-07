import {createGpuUniformsMap,rootPassthrough,shaderRendererGPU} from 'shaders/core';
import type {GpuShaderDefinition} from 'shaders/core';
import SolidColor from 'shaders/core/SolidColor';
import Blob from 'shaders/core/Blob';
import type {ComponentProps} from 'shaders/core/Blob';

const cobalt={colorA:'#2864e8',colorB:'#6067dd',colorSpace:'oklab',size:0.46,deformation:0.78,softness:0.14,speed:0.32,seed:7,center:{x:0.63,y:0.42},highlightIntensity:0.3,highlightColor:'#dcecff'} satisfies Partial<ComponentProps>;
const lilac={colorA:'#507fe8',colorB:'#9a83e8',colorSpace:'oklab',size:0.36,deformation:0.68,softness:0.18,speed:0.24,seed:27,center:{x:0.24,y:0.81},highlightIntensity:0.24,highlightColor:'#e5efff'} satisfies Partial<ComponentProps>;
const layers:ReadonlyArray<{id:string;definition:GpuShaderDefinition;props:Record<string,unknown>;opacity:number}>=[{id:'base',definition:SolidColor,props:{color:'#f5f5f2'},opacity:1},{id:'cobalt',definition:Blob,props:cobalt,opacity:0.82},{id:'lilac',definition:Blob,props:lilac,opacity:0.58}];

/** The fixed login composition needs the core's per-renderer cap, which the JS wrapper omits. */
export function createBackdropRenderer(canvas:HTMLCanvasElement,{onReady,onUnavailable}:{onReady:()=>void;onUnavailable:(reason:string)=>void}){
  type Renderer=ReturnType<typeof shaderRendererGPU>;
  type PreparedRenderer=Renderer&{desktopLoginPreparationVersion:1;prepareAsync():Promise<void>};
  const hasPreparation=(value:Renderer):value is PreparedRenderer=>{
    const version:unknown=Reflect.get(value,'desktopLoginPreparationVersion'),prepare:unknown=Reflect.get(value,'prepareAsync');
    return version===1&&typeof prepare==='function';
  };
  let current:Renderer|null=null,destroyed=false,failed=false,paused=false,ready=false,readyNotified=false,preparing=false,sizeEpoch=0;
  let preparation:AbortController|null=null;
  let dimensions:{width:number;height:number}|null=null,rebuilds=0,lastLossAt=0,nextBuildReason='init-failed';
  const cancelPreparation=()=>{const previous=preparation;preparation=null;previous?.abort();};
  const active=()=>!document.hidden&&navigator.onLine&&matchMedia('(min-width: 801px)').matches;
  // A previous generation's covered ready scene may still hold animation paused.
  const canRun=()=>active()&&(!paused||!ready);
  const notifyReady=()=>{if(!destroyed&&!failed&&current&&ready&&!readyNotified&&active()){readyNotified=true;onReady();}};
  const suspend=()=>{
    const candidate=current;if(!candidate)return;
    if(!active()&&(preparing||!candidate.isInitialized())){
      cancelPreparation();preparing=false;
      current=null;ready=false;readyNotified=false;
      // Abort before acquireRoot resumes. The late await below releases only this candidate's lease.
      candidate.cleanup();return;
    }
    // Public lock also cancels pending on-demand drawing. Its documented clock reset is accepted
    // for this decorative Blob background only; no local player, badge or SDK iframe is touched.
    candidate.setFrameLocked(true);candidate.stopAnimation();
  };
  const activate=()=>{
    const candidate=current;if(destroyed||failed||!candidate||!candidate.isInitialized())return;
    if(!canRun()){suspend();return;}
    if(preparing){notifyReady();return;}
    if(dimensions)candidate.resize(dimensions.width,dimensions.height);
    candidate.setFrameLocked(false);notifyReady();
    if(current===candidate&&canRun())candidate.startAnimation();else suspend();
  };
  const unavailable=(reason:string)=>{
    if(destroyed||failed)return;failed=true;cancelPreparation();
    const previous=current;current=null;previous?.cleanup();onUnavailable(reason);
  };
  const build=async(errorReason:string)=>{
    nextBuildReason=errorReason;
    if(destroyed||failed||current||!active())return;
    let renderer:Renderer|null=null,controller:AbortController|null=null,completed=false;
    const tasks:Promise<void>[]=[];
    try{
      renderer=shaderRendererGPU();const candidate=renderer;current=candidate;ready=false;readyNotified=false;preparing=true;
      controller=new AbortController();preparation=controller;const signal=controller.signal;
      const valid=()=>!signal.aborted&&!destroyed&&!failed&&current===candidate;
      const waitPending=(pending:Promise<unknown>):Promise<boolean>=>new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(ok:boolean)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);resolve(ok);};
        const abort=()=>finish(false);signal.addEventListener('abort',abort,{once:true});
        void pending.then(()=>finish(valid()),error=>{if(!valid()){finish(false);return;}if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(error);});
        if(!valid())abort();
      });
      let sizedEpoch=-1;
      const waitForSizing=async()=>{
        while(valid()&&active()){
          if(sizedEpoch===sizeEpoch)return true;
          const epoch=sizeEpoch;if(dimensions)candidate.resize(dimensions.width,dimensions.height);
          // The core queues its real sizing callback first; this callback follows it.
          const sized=await new Promise<boolean>(resolve=>{
            let id=0,settled=false;
            const finish=(ok:boolean)=>{if(settled)return;settled=true;if(id)cancelAnimationFrame(id);signal.removeEventListener('abort',abort);resolve(ok);};
            const abort=()=>finish(false);signal.addEventListener('abort',abort,{once:true});
            id=requestAnimationFrame(()=>finish(valid()&&active()&&epoch===sizeEpoch));
            if(!valid()||!active())abort();
          });
          if(sized){sizedEpoch=epoch;return true;}
        }
        return false;
      };
      candidate.setFrameLocked(true);
      candidate.setOnReady(()=>{
        if(destroyed||failed||current!==candidate)return;
        ready=true;notifyReady();if(!canRun())suspend();
      });
      candidate.setOnUnavailable(reason=>{if(current===candidate)unavailable(reason);});
      candidate.setOnDeviceLost(()=>{
        if(destroyed||failed||current!==candidate)return;
        const now=Date.now();if(now-lastLossAt>60_000)rebuilds=0;lastLossAt=now;
        if(++rebuilds>3){unavailable('unrecoverable');return;}
        cancelPreparation();current=null;candidate.cleanup();void build('rebuild_failed');
      });
      await candidate.initialize({canvas,resizeTarget:canvas,colorSpace:'srgb',observeElement:false,enablePerformanceTracking:false});
      if(!valid()||!active())return;
      candidate.setFrameRateCap(30);
      candidate.registerNode('shader-root',rootPassthrough.fragment,null,null,{},rootPassthrough);
      for(const [renderOrder,layer]of layers.entries()){
        const supplied:Record<string,unknown>=layer.props;
        const values=Object.fromEntries(Object.entries(layer.definition.props).map(([key,setting])=>[key,supplied[key]===undefined?setting.default:supplied[key]]));
        const uniforms=createGpuUniformsMap(layer.definition,values,layer.id);
        candidate.registerNode(layer.id,layer.definition.fragment,'shader-root',{id:layer.id,renderOrder,blendMode:'normal',opacity:layer.opacity},uniforms,layer.definition);
      }
      errorReason='pipeline-prepare-failed';
      if(!hasPreparation(candidate))throw new Error('DESKTOP_LOGIN_PREPARE_CAPABILITY_MISSING');
      for(;;){
        if(!await waitForSizing()||!valid()||!active())return;
        const epoch=sizeEpoch,pending=candidate.prepareAsync();tasks.push(pending);void pending.catch(()=>{});
        if(!await waitPending(pending)||!valid()||!active())return;
        if(epoch===sizeEpoch)break;
      }
      // Preparation never reports readiness. N3's normal loop owns first draw and its failure budget.
      preparing=false;completed=true;activate();
    }catch{
      if(!destroyed&&!failed&&(renderer===null||current===renderer))unavailable(errorReason);
      else renderer?.cleanup();
    }finally{
      if(preparation===controller){preparation=null;preparing=false;}
      controller?.abort();
      if(!completed&&renderer){
        const owned=renderer;
        if(current===owned){current=null;ready=false;readyNotified=false;}
        owned.cleanup();
        // Native createRenderPipelineAsync is not abortable. Drop the obsolete generation again
        // after it settles; no late callback can draw or release the new candidate's lease.
        void Promise.allSettled(tasks).then(()=>{owned.cleanup();tasks.length=0;});
      }
    }
  };
  void build('init-failed');
  return {
    resize(width:number,height:number){
      if(!dimensions||dimensions.width!==width||dimensions.height!==height)sizeEpoch++;
      dimensions={width,height};if(destroyed||failed)return;
      if(!active()){suspend();return;}
      if(!preparing&&current?.isInitialized()&&canRun())current.resize(width,height);
    },
    pause(){
      paused=true;if(destroyed||failed)return;
      // Visible cover holds allow a replacement generation to prepare exactly its first frame.
      if(!active())suspend();else if(!current)void build(nextBuildReason);else if(!ready)activate();else suspend();
    },
    resume(){paused=false;if(destroyed||failed)return;if(!current)void build(nextBuildReason);else activate();},
    destroy(){if(destroyed)return;destroyed=true;cancelPreparation();const previous=current;current=null;previous?.cleanup();}
  };
}
