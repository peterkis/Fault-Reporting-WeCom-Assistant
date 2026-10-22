import {hasNativePreviewWork,waitNativePreviewStops,nativeCapture,type NativeCaptureWork} from './wecom-registration';
type Wecom=typeof import('../lib/wecom');
interface Snapshot {starting:boolean;recording:boolean;seconds:number;cancelling:boolean}
interface CaptureOptions {
 canClear:boolean;canWecom:boolean;current:()=>boolean;getSdk:()=>Promise<Wecom>;
 update:(value:Partial<Snapshot>)=>void;error:(key:string,tone?:'error'|'info',id?:string)=>void;
 save:(localId:string|null,blob:Blob|null,duration:number)=>string|null;
 transcribe:(id:string,localId:string,sdk:Wecom)=>void;done:()=>void;
}
export interface VoiceCapture {start:()=>Promise<void>;release:(cancel?:boolean)=>void;slide:(cancel:boolean)=>void}
const aborted=()=>new DOMException('Aborted','AbortError');
function waiting<T>(task:Promise<T>,signal:AbortSignal,bounded=false):Promise<T>{
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(result:{ok:true;value:T}|{ok:false;reason:unknown})=>{if(done)return;done=true;if(timer!==null)clearTimeout(timer);signal.removeEventListener('abort',cancel);if(result.ok)resolve(result.value);else reject(result.reason);};
  const cancel=()=>finish({ok:false,reason:aborted()}),timer=bounded?setTimeout(()=>finish({ok:false,reason:new Error('nativeCaptureTimeout')}),5000):null;
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();void task.then(value=>finish({ok:true,value}),reason=>finish({ok:false,reason}));
 });
}
let endSdk:Wecom|null=null;
const endedIds=new Set<string>();
/** Owns one real native start/stop. A canceled waiter never releases this slot. */
function nativeWork(sdkTask:Promise<Wecom>,active:()=>boolean){
 let sdk:Wecom|null=null,started=false,startSettled=false,stopped=false,naturallyEnded=false,requested=false,failedStop=false,stopping:Promise<string|null>|null=null;
 let complete:(id:string|null)=>void=()=>{};
 const result=new Promise<string|null>(resolve=>{complete=resolve;});
 const finish=(id:string|null)=>{if(!stopped){stopped=true;if(id){endedIds.add(id);if(endedIds.size>8){const first=endedIds.values().next().value;if(first!==undefined)endedIds.delete(first);}}complete(id);}if(startSettled&&!stopping&&(!failedStop||naturallyEnded)&&nativeCapture.current===work)nativeCapture.current=null;};
 const stop=():Promise<string|null>=>{
  requested=true;if(stopping)return stopping;if(!startSettled)return ready.then(()=>stop());if(stopped&&(!failedStop||naturallyEnded))return result;
  if(!started)return result;
  const device=sdk;if(!device)return Promise.reject(aborted());
  const task=device.stopRecord().then(value=>{stopping=null;failedStop=false;finish(value.localId);return value.localId;},reason=>{stopping=null;failedStop=true;if(naturallyEnded)finish(null);throw reason;});stopping=task;return task;
 };
 const work:NativeCaptureWork={stop,end:localId=>{naturallyEnded=true;finish(localId);}};
 const ready=(async()=>{
  sdk=await sdkTask;if(!active()){startSettled=true;finish(null);return;}
  const previous=nativeCapture.current;if(previous){await previous.stop();if(!active()){startSettled=true;finish(null);return;}}
  if(endSdk!==sdk){endSdk=sdk;sdk.onVoiceRecordEnd(event=>{if(!endedIds.has(event.localId))nativeCapture.current?.end(event.localId);});}
  nativeCapture.current=work;
  await sdk.startRecord();started=true;startSettled=true;if(stopped)finish(null);else if(requested||!active())void stop().catch(()=>undefined);
 })().catch(reason=>{startSettled=true;finish(null);throw reason;});
 void ready.catch(()=>undefined);
 return{ready,result,stop,getSdk:()=>sdk,isStarted:()=>started};
}
export function createVoiceCapture(options:CaptureOptions):VoiceCapture{
 const abort=new AbortController();let released=false,cancelled=false,sliding=false,finished=false,ready=false,stopping=false,interrupted=false,nativeEligible=false,auxiliaryAvailable=true,started=0,ended:number|null=null,itemId:string|null=null;
 let stream:MediaStream|null=null,recorder:MediaRecorder|null=null,voice:ReturnType<typeof nativeWork>|null=null,interval:ReturnType<typeof setInterval>|null=null,timer:ReturnType<typeof setTimeout>|null=null,stopTimer:ReturnType<typeof setTimeout>|null=null;
 const chunks:Blob[]=[],tracks:MediaStreamTrack[]=[];
 const current=()=>options.current()&&!released&&!cancelled;
 const clearClock=()=>{if(interval!==null)clearInterval(interval);if(timer!==null)clearTimeout(timer);if(stopTimer!==null)clearTimeout(stopTimer);interval=null;timer=null;stopTimer=null;};
 const cleanStream=()=>{for(const track of tracks){track.removeEventListener?.('mute',interrupt);track.removeEventListener?.('ended',interrupt);track.stop();}tracks.length=0;stream=null;};
 const done=()=>{if(finished)return;finished=true;clearClock();options.update({starting:false,recording:false,cancelling:false});options.done();};
 const optionalFailure=()=>{if(!cancelled)options.error('voice:transcriptUnavailable','info',itemId??undefined);};
 const stopNative=()=>{if(!voice)return;void waiting(voice.stop(),abort.signal,true).catch(reason=>{if(!(reason instanceof DOMException&&reason.name==='AbortError'))optionalFailure();});};
 const transcribe=(id:string,work:ReturnType<typeof nativeWork>)=>{void work.result.then(localId=>{const sdk=work.getSdk();if(localId&&sdk&&!cancelled)options.transcribe(id,localId,sdk);});};
 function interrupt(){if(finished||stopping)return;interrupted=true;options.error('voice:interrupted');release(true);}
 const finalizeBrowser=()=>{
  cleanStream();if(!cancelled&&!interrupted&&ended!==null){const blob=new Blob(chunks,{type:recorder?.mimeType??''});if(!blob.size&&ended-started>=2000)options.error('voice:finishFailed');else itemId=options.save(null,blob,ended-started);if(itemId&&voice){if(nativeEligible)transcribe(itemId,voice);else optionalFailure();}}
  chunks.length=0;if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;}done();
 };
 const finishLegacy=(localId:string|null)=>{if(finished)return;if(!cancelled&&localId&&ended!==null){itemId=options.save(localId,null,ended-started);const sdk=voice?.getSdk();if(itemId&&sdk)options.transcribe(itemId,localId,sdk);}done();};
 function release(cancel=false){
  if(released){if(cancel){cancelled=true;abort.abort();if(recorder)finalizeBrowser();else done();}return;}released=true;cancelled=cancelled||cancel||sliding;ended=ready?performance.now():null;nativeEligible=auxiliaryAvailable&&(voice?.isStarted()??false);clearClock();options.update({starting:false,recording:false,cancelling:false});
  if(!ready){abort.abort();if(voice)void voice.stop().catch(()=>undefined);cleanStream();if(!cancelled)options.error('voice:tooShort','info');done();return;}
  stopping=true;
  if(recorder){stopNative();if(!cancelled)stopTimer=setTimeout(()=>{interrupted=true;cancelled=true;abort.abort();options.error('voice:finishFailed');finalizeBrowser();},5000);try{if(recorder.state==='recording')recorder.stop();else{interrupted=true;if(!cancelled)options.error('voice:interrupted');finalizeBrowser();}}catch{interrupted=true;if(!cancelled)options.error('voice:interrupted');finalizeBrowser();}cleanStream();if(cancelled){abort.abort();finalizeBrowser();}}
  else if(voice)void waiting(voice.stop(),abort.signal,true).then(finishLegacy,()=>{if(!cancelled)options.error('voice:finishFailed');done();});
  else done();
 }
 const clock=(preparing=false)=>{ready=true;started=performance.now();options.update({starting:preparing,recording:!preparing});interval=setInterval(()=>options.update({seconds:Math.floor((performance.now()-started)/1000)}),1000);timer=setTimeout(()=>release(),60_000);};
 const start=async()=>{
  let stage:'PREVIEW'|'PERMISSION'|'BROWSER'|'SDK'|'NATIVE'='PREVIEW';
  try{
   const old=nativeCapture.current;
   if(hasNativePreviewWork()||old)await waiting(Promise.all([waitNativePreviewStops(abort.signal),...(old?[old.stop()]:[])]),abort.signal,true);
   if(!current())throw aborted();
   const sdkTask=options.canWecom?options.getSdk():null;if(sdkTask)void sdkTask.catch(()=>undefined);
   if(options.canClear){
    stage='PERMISSION';const permission=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,sampleRate:{ideal:48_000},channelCount:{ideal:1}}}).then(value=>{if(!current()){value.getTracks().forEach(track=>track.stop());throw aborted();}return value;});
    stream=await waiting(permission,abort.signal);if(!current())throw aborted();tracks.push(...stream.getTracks());stage='BROWSER';
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value));recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:128_000});
    for(const track of tracks){track.addEventListener?.('mute',interrupt);track.addEventListener?.('ended',interrupt);if(track.muted||track.readyState==='ended')throw new Error('interrupted');}
    recorder.ondataavailable=event=>{if(!cancelled&&event.data.size)chunks.push(event.data);};recorder.onerror=interrupt;recorder.onstop=()=>{if(!stopping){interrupted=true;cancelled=true;options.error('voice:interrupted');released=true;clearClock();stopNative();}finalizeBrowser();};
    recorder.start();clock(sdkTask!==null);
    // Keep clear capture immediate, but invite speech only once ASR has really started or safely degraded.
    if(sdkTask){voice=nativeWork(sdkTask,()=>current()&&auxiliaryAvailable);const work=voice;void waiting(work.ready,abort.signal,true).then(()=>{if(current())options.update({starting:false,recording:true});},()=>{auxiliaryAvailable=false;void work.stop().catch(()=>undefined);optionalFailure();if(current())options.update({starting:false,recording:true});});}
   }else{
    if(!options.canWecom){options.error('voice:browserUnavailable');done();return;}
    stage='SDK';const sdk=await waiting(sdkTask??options.getSdk(),abort.signal,true);if(!current())throw aborted();stage='NATIVE';voice=nativeWork(Promise.resolve(sdk),current);await waiting(voice.ready,abort.signal,true);if(!current())throw aborted();clock();
    const work=voice;void work.result.then(localId=>{if(!released&&options.current()){released=true;ended=performance.now();clearClock();finishLegacy(localId);}});
   }
  }catch(reason){
   const isAbort=reason instanceof DOMException&&reason.name==='AbortError';cancelled=true;released=true;abort.abort();if(voice)void voice.stop().catch(()=>undefined);cleanStream();
   if(!isAbort&&options.current())options.error(stage==='PREVIEW'?'voice:previewStopFailed':stage==='SDK'?'voice:setupFailed':stage==='NATIVE'?'voice:nativeStartFailed':stage==='PERMISSION'&&reason!==null&&typeof reason==='object'&&'name'in reason&&(reason.name==='NotAllowedError'||reason.name==='SecurityError')?'voice:browserDenied':'voice:browserFailed');done();
  }
 };
 return{start,release,slide:(cancel:boolean)=>{if(!released){sliding=cancel;options.update({cancelling:cancel});}}};
}
