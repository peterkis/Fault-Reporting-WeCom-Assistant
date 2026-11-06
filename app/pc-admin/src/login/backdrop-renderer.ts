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
  type Context=NonNullable<ReturnType<Renderer['getInternalRenderer']>>;
  type Root=Context['root'];
  type Factory=Root['createRenderPipeline'];
  type Descriptor=Parameters<Factory>[0];
  type Pipeline=ReturnType<Factory>;
  type Preparation={controller:AbortController;wake:()=>void;cancelFrame:()=>void};
  let current:Renderer|null=null,destroyed=false,failed=false,paused=false,preparing=true;
  let preparation:Preparation|null=null,sizeEpoch=0;
  let dimensions:{width:number;height:number}|null=null,rebuilds=0,lastLossAt=0;
  const cancelPreparation=()=>{const previous=preparation;preparation=null;previous?.controller.abort();};
  const unavailable=(reason:string)=>{
    if(destroyed||failed)return;failed=true;cancelPreparation();
    const previous=current;current=null;previous?.cleanup();onUnavailable(reason);
  };
  const build=async(errorReason:string)=>{
    let renderer:Renderer|null=null,own:Preparation|null=null;
    try{
      renderer=shaderRendererGPU();const candidate=renderer;current=candidate;preparing=true;
      const controller=new AbortController(),signal=controller.signal;
      let wake:()=>void=()=>{},cancelFrame:()=>void=()=>{},naturalReady=false,sizedEpoch=-1;
      own={controller,wake:()=>wake(),cancelFrame:()=>cancelFrame()};preparation=own;
      const valid=()=>!signal.aborted&&!destroyed&&!failed&&current===candidate;
      // A previous generation's ready cover hold must not prevent this generation's first frame.
      const active=()=>(!paused||!naturalReady)&&!document.hidden&&navigator.onLine&&matchMedia('(min-width: 801px)').matches;
      const waitUntilActive=():Promise<boolean>=>{
        if(!valid()||active())return Promise.resolve(valid());
        return new Promise(resolve=>{
          const check=()=>{if(valid()&&!active())return;signal.removeEventListener('abort',check);wake=()=>{};resolve(valid());};
          wake=check;signal.addEventListener('abort',check,{once:true});check();
        });
      };
      const waitPending=(pending:Promise<unknown>):Promise<boolean>=>new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(ok:boolean)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);resolve(ok);};
        const abort=()=>finish(false);
        signal.addEventListener('abort',abort,{once:true});
        void pending.then(()=>finish(valid()),error=>{if(!valid()){finish(false);return;}if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(error);});
        if(!valid())abort();
      });
      const yieldPreparationTask=():Promise<boolean>=>{
        if(!valid())return Promise.resolve(false);
        return new Promise((resolve,reject)=>{
          const channel=new MessageChannel();let settled=false;
          const cleanup=()=>{channel.port1.onmessage=null;channel.port1.close();channel.port2.close();signal.removeEventListener('abort',abort);};
          const finish=(ok:boolean)=>{if(settled)return;settled=true;cleanup();resolve(ok);};
          const abort=()=>finish(false);
          channel.port1.onmessage=()=>finish(valid());
          signal.addEventListener('abort',abort,{once:true});
          if(!valid()){abort();return;}
          try{channel.port2.postMessage(null);}
          catch(error){if(!settled){settled=true;cleanup();reject(error);}}
        });
      };
      const waitForSizing=async()=>{
        while(valid()){
          if(!await waitUntilActive())return false;
          if(sizedEpoch===sizeEpoch)return true;
          const epoch=sizeEpoch;
          if(dimensions)candidate.resize(dimensions.width,dimensions.height);
          // Core resize enqueues its sizing callback first. This owned callback follows it.
          const sized=await new Promise<boolean>(resolve=>{
            let id=0,settled=false;
            const finish=(ok:boolean)=>{if(settled)return;settled=true;if(id)cancelAnimationFrame(id);signal.removeEventListener('abort',abort);cancelFrame=()=>{};resolve(ok);};
            const abort=()=>finish(false);
            cancelFrame=abort;signal.addEventListener('abort',abort,{once:true});
            id=requestAnimationFrame(()=>finish(valid()&&active()&&epoch===sizeEpoch));
            if(!valid()||!active())abort();
          });
          if(sized){sizedEpoch=epoch;return true;}
        }
        return false;
      };
      controller.signal.addEventListener('abort',()=>{cancelFrame();wake();},{once:true});
      // Lock before initialize or node registration can schedule an ordinary first draw.
      candidate.setFrameLocked(true);
      candidate.setOnReady(()=>{if(!destroyed&&!failed&&current===candidate){naturalReady=true;onReady();}});
      candidate.setOnUnavailable(reason=>{if(current===candidate)unavailable(reason);});
      candidate.setOnDeviceLost(()=>{
        if(destroyed||failed||current!==candidate)return;
        const now=Date.now();if(now-lastLossAt>60_000)rebuilds=0;lastLossAt=now;
        if(++rebuilds>3){unavailable('unrecoverable');return;}
        cancelPreparation();current=null;candidate.cleanup();void build('rebuild_failed');
      });
      await candidate.initialize({canvas,resizeTarget:canvas,colorSpace:'srgb',observeElement:false,enablePerformanceTracking:false});
      if(!valid())return;
      candidate.setFrameRateCap(30);
      if(dimensions)candidate.resize(dimensions.width,dimensions.height);
      candidate.registerNode('shader-root',rootPassthrough.fragment,null,null,{},rootPassthrough);
      for(const [renderOrder,layer]of layers.entries()){
        const supplied:Record<string,unknown>=layer.props;
        const values=Object.fromEntries(Object.entries(layer.definition.props).map(([key,setting])=>[key,supplied[key]===undefined?setting.default:supplied[key]]));
        const uniforms=createGpuUniformsMap(layer.definition,values,layer.id);
        candidate.registerNode(layer.id,layer.definition.fragment,'shader-root',{id:layer.id,renderOrder,blendMode:'normal',opacity:layer.opacity},uniforms,layer.definition);
      }
      do{
        if(!await waitForSizing()||!valid())return;
        if(!active()||sizedEpoch!==sizeEpoch)continue;
        // Move synchronous WGSL preparation out of the sizing rAF's microtask phase.
        if(!await yieldPreparationTask()||!valid())return;
      }while(!active()||sizedEpoch!==sizeEpoch);
      const context=candidate.getInternalRenderer();if(!context)throw new Error('pipeline-context-unavailable');
      const root=context.root,original=root.createRenderPipeline,oldOwn=Object.getOwnPropertyDescriptor(root,'createRenderPipeline');
      const tasks:Promise<void>[]=[];let initializerThrew=false;
      function observed(this:Root,descriptor:Descriptor):Pipeline{
        const pipeline=original.call(this,descriptor);
        try{const pending=pipeline.initAsync();void pending.catch(()=>{});tasks.push(pending);}
        catch(error){initializerThrew=true;throw error;}
        return pipeline;
      }
      let probe:Promise<void>;
      errorReason='pipeline-async-failed';
      // The default root is page-shared: shadow only this synchronous call, never an await.
      try{
        Object.defineProperty(root,'createRenderPipeline',{value:observed,configurable:true,writable:true,enumerable:oldOwn?.enumerable??false});
        probe=candidate.renderSyntheticFrame(0,{waitForGpu:false});void probe.catch(()=>{});
      }finally{
        if(oldOwn)Object.defineProperty(root,'createRenderPipeline',oldOwn);
        else if(!Reflect.deleteProperty(root,'createRenderPipeline'))throw new Error('pipeline-factory-restore-failed');
        if(root.createRenderPipeline!==original)throw new Error('pipeline-factory-restore-failed');
      }
      if(initializerThrew)throw new Error('pipeline-async-start-failed');
      if(!await waitPending(Promise.all([probe,...tasks])))return;
      if(!valid())return;
      if(!naturalReady){
        if(tasks.length===0)throw new Error('pipeline-async-not-captured');
        // Defer a resize during native compilation until all real pipeline jobs are done.
        do{
          if(!await waitForSizing()||!valid()||candidate.getInternalRenderer()?.root!==context.root)return;
        }while(!active()||sizedEpoch!==sizeEpoch);
        if(!await waitPending(candidate.renderSyntheticFrame(0,{waitForGpu:false})))return;
        if(!valid())return;
        if(!naturalReady)throw new Error('pipeline-first-frame-failed');
      }
      // onReady can already have paused the native-covered scene; never await presented here.
      preparing=false;candidate.setFrameLocked(false);
      if(paused)candidate.stopAnimation();else candidate.startAnimation();
    }catch{
      if(!destroyed&&!failed&&(renderer===null||current===renderer))unavailable(errorReason);
      else renderer?.cleanup();
    }finally{
      if(own){own.controller.abort();if(preparation===own)preparation=null;}
    }
  };
  void build('init-failed');
  return {
    resize(width:number,height:number){
      if(!dimensions||dimensions.width!==width||dimensions.height!==height)sizeEpoch++;
      dimensions={width,height};
      if(!destroyed&&!failed&&!preparing&&current?.isInitialized())current.resize(width,height);
    },
    pause(){paused=true;preparation?.cancelFrame();current?.stopAnimation();},
    resume(){paused=false;preparation?.wake();if(!destroyed&&!failed&&!preparing&&current?.isInitialized())current.startAnimation();},
    destroy(){if(destroyed)return;destroyed=true;cancelPreparation();const previous=current;current=null;previous?.cleanup();}
  };
}
