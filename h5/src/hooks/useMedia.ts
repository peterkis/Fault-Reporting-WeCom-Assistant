import {useEffect,useRef,useSyncExternalStore} from 'react';
import {useTranslation} from 'react-i18next';
import {api,authLost} from '../api/client';
import type {Bootstrap} from '../api/types';
import {validateMedia,type MediaKind,type MediaCandidate} from '../lib/media';
import {registeredWecom,markNativePreview,stopNativePreview} from './wecom-registration';
import type {VoiceCapture} from './voice-capture';
type Wecom=typeof import('../lib/wecom');
interface DraftMediaBase extends MediaCandidate {id:string;file:Blob|null;localId:string|null;url:string|null;name:string}
type UploadStage='RESERVE'|'SDK_READY'|'NATIVE_UPLOAD'|'SERVER_IMPORT'|'BINARY_UPLOAD';
type UploadCode='INPUT_REJECTED'|'AUTH_REQUIRED'|'FORBIDDEN'|'EXPIRED'|'BUSY'|'UNAVAILABLE'|'NETWORK'|'SDK_FAILED'|'UPLOAD_FAILED';
const uploadMessages={INPUT_REJECTED:'voice:uploadInvalid',AUTH_REQUIRED:'voice:uploadSignIn',FORBIDDEN:'voice:uploadForbidden',EXPIRED:'voice:uploadExpired',BUSY:'voice:uploadBusy',UNAVAILABLE:'voice:uploadUnavailable',NETWORK:'voice:uploadNetwork',SDK_FAILED:'voice:nativeUploadFailed',UPLOAD_FAILED:'voice:uploadFailed'} as const satisfies Record<UploadCode,string>;
export interface MediaUploadFailure {readonly stage:UploadStage;readonly code:UploadCode;readonly messageKey:typeof uploadMessages[UploadCode]}
export type VoiceTranscriptEvent={type:'BEGIN';id:string}|{type:'READY';id:string;text:string}|{type:'REMOVE';id:string};
export type DraftMedia=DraftMediaBase & (
 | {status:'QUEUED';progress:0;ref:string|null;controller:null}
 | {status:'RESERVING';progress:0;ref:string|null;controller:AbortController}
 | {status:'UPLOADING';progress:number;ref:string;controller:AbortController}
 | {status:'READY';progress:100;ref:string;controller:null}
 | {status:'ERROR';progress:number;ref:string|null;controller:null;failure:MediaUploadFailure}
);
interface RecordingSnapshot {canClear:boolean;canWecom:boolean;starting:boolean;recording:boolean;seconds:number;cancelling:boolean}
interface RecordingSession {capture:VoiceCapture|null;released:boolean;cancel:boolean;sliding:boolean}
type Listener=()=>void;
function uploadFailure(stage:UploadStage,reason:unknown):MediaUploadFailure{
 const status=reason!==null&&typeof reason==='object'&&'status'in reason&&typeof reason.status==='number'?reason.status:null;
 const code:UploadCode=status===401?'AUTH_REQUIRED':status===403?'FORBIDDEN':status===409||status===410?'EXPIRED':status===429?'BUSY':status!==null&&[400,413,415,422].includes(status)?'INPUT_REJECTED':status!==null&&status>=500?'UNAVAILABLE':status===0||status===408||reason instanceof TypeError?'NETWORK':stage==='SDK_READY'||stage==='NATIVE_UPLOAD'?'SDK_FAILED':'UPLOAD_FAILED';
 return {stage,code,messageKey:uploadMessages[code]};
}

export function createMediaController(getBootstrap:()=>Bootstrap,transcript:(event:VoiceTranscriptEvent)=>void,message:(key:string)=>string){
 const native=()=>getBootstrap().h5.sdk.enabled&&/wxwork/i.test(navigator.userAgent);
 const canClear=typeof navigator!=='undefined'&&Boolean(navigator.mediaDevices?.getUserMedia)&&typeof MediaRecorder!=='undefined',canWecom=typeof navigator!=='undefined'&&native();
 let items:DraftMedia[]=[],itemIds:readonly string[]=[],error:string|null=null,errorTone:'error'|'info'='error',recording:RecordingSnapshot={canClear,canWecom,starting:false,recording:false,seconds:0,cancelling:false};
 let alive=true,queue=Promise.resolve(),record:RecordingSession|null=null,lastCapture:VoiceCapture|null=null,admitting=0;
 let playbackAttempt=0,playbackPending:string|null=null;
 const listeners=new Set<Listener>(),pendingMeasurements=new Set<()=>void>();
 const progressTimers=new Map<string,ReturnType<typeof setTimeout>>(),progressValues=new Map<string,number>(),lastProgress=new Map<string,number>();
 const emit=()=>{if(items.length!==itemIds.length||items.some((item,index)=>item.id!==itemIds[index]))itemIds=items.map(item=>item.id);if(alive)for(const listener of listeners)listener();};
 const subscribe=(listener:Listener)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
 const replace=(id:string,update:(item:DraftMedia)=>DraftMedia)=>{items=items.map(item=>item.id===id?update(item):item);emit();};
 const setError=(value:string|null,tone:'error'|'info'='error')=>{error=value;errorTone=tone;emit();};
 const setRecording=(value:Partial<RecordingSnapshot>)=>{recording={...recording,...value};emit();};
 const getSdk=async()=>{const value=await registeredWecom(getBootstrap());if(!alive)throw new DOMException('Aborted','AbortError');return value;};
 const cancelProgress=(id:string)=>{const timer=progressTimers.get(id);if(timer)clearTimeout(timer);progressTimers.delete(id);progressValues.delete(id);lastProgress.delete(id);};
 const publishProgress=(id:string,value:number)=>{lastProgress.set(id,performance.now());replace(id,item=>item.status==='UPLOADING'?{...item,progress:value}:item);};
 const progress=(id:string,value:number)=>{
  if(!alive)return;
  const elapsed=performance.now()-(lastProgress.get(id)??0);
  if(value===100||elapsed>=100){const timer=progressTimers.get(id);if(timer)clearTimeout(timer);progressTimers.delete(id);progressValues.delete(id);publishProgress(id,value);return;}
  progressValues.set(id,value);
  if(!progressTimers.has(id))progressTimers.set(id,setTimeout(()=>{progressTimers.delete(id);const latest=progressValues.get(id);progressValues.delete(id);if(latest!==undefined&&alive)publishProgress(id,latest);},100-elapsed));
 };
 const upload=(id:string)=>{
  queue=queue.catch(()=>undefined).then(async()=>{
   const item=items.find(value=>value.id===id);if(!item||!alive||item.status==='READY')return;
   const controller=new AbortController(),bootstrap=getBootstrap();
   let stage:UploadStage='RESERVE';
   replace(id,value=>{if(value.status==='ERROR'){const {failure:_failure,...base}=value;return {...base,status:'RESERVING',progress:0,controller};}return {...value,status:'RESERVING',progress:0,controller};});
   try{
    const reservation=item.ref?{media_ref:item.ref}:await api.reserve({schema_version:1,client_command_id:item.id,kind:item.kind,mime_type:item.mimeType.split(';')[0]?.trim().toLowerCase()??'',byte_size:item.byteSize,duration_ms:item.durationMs},bootstrap.csrf_token,controller.signal);
    if(!alive||controller.signal.aborted||!items.some(value=>value.id===id)){await api.cancelUpload(reservation.media_ref,bootstrap.csrf_token,item.id).catch(()=>undefined);return;}
    replace(id,value=>({...value,status:'UPLOADING',progress:0,controller,ref:reservation.media_ref}));
    if(item.localId){
     stage='SDK_READY';const ww=await getSdk();if(controller.signal.aborted)return;
     stage='NATIVE_UPLOAD';
     const uploaded=item.kind==='VOICE'?await ww.uploadVoice({localId:item.localId,isShowProgressTips:false}):await ww.uploadImage({localId:item.localId,isShowProgressTips:false});
     if(!alive||controller.signal.aborted)return;
     stage='SERVER_IMPORT';
     await api.importWecom(reservation.media_ref,uploaded.serverId,bootstrap.csrf_token,item.id,controller.signal);
    }else if(item.file){stage='BINARY_UPLOAD';await api.upload(reservation.media_ref,item.file,bootstrap.csrf_token,item.id,controller.signal,value=>progress(id,value));}
    else throw new Error('mediaInvalid');
    cancelProgress(id);
    if(alive&&items.some(value=>value.id===id))replace(id,value=>({...value,status:'READY',progress:100,controller:null,ref:reservation.media_ref}));
   }catch(reason){
    cancelProgress(id);
    if(alive&&!controller.signal.aborted&&items.some(value=>value.id===id)&&!(reason instanceof DOMException&&reason.name==='AbortError'))replace(id,value=>({...value,status:'ERROR',controller:null,failure:uploadFailure(stage,reason)}));
   }
  });
 };
 const measure=(file:Blob,kind:MediaKind):Promise<number|null>=>{
  if(kind==='IMAGE')return Promise.resolve(null);
  return new Promise((resolve,reject)=>{
   const element=document.createElement(kind==='VIDEO'?'video':'audio'),url=URL.createObjectURL(file);let finished=false;
   const done=(duration:number|null,aborted=false)=>{
    if(finished)return;finished=true;clearTimeout(timer);pendingMeasurements.delete(cancel);
    element.onloadedmetadata=null;element.onerror=null;element.removeAttribute('src');element.load();URL.revokeObjectURL(url);
    emit();
    if(aborted)reject(new DOMException('Aborted','AbortError'));else if(duration===null)reject(new Error('mediaInvalid'));else resolve(duration);
   };
   const cancel=()=>done(null,true),timer=setTimeout(()=>done(null),10_000);pendingMeasurements.add(cancel);emit();
   element.preload='metadata';element.onloadedmetadata=()=>done(Number.isFinite(element.duration)?Math.ceil(element.duration*1000):null);element.onerror=()=>done(null);element.src=url;
  });
 };
 const add=async(file:File,kind:MediaKind)=>{
  if(!alive)return;admitting+=1;emit();
  try{
   const duration=await measure(file,kind);if(!alive)return;
   const candidate={kind,byteSize:file.size,mimeType:file.type,durationMs:duration},invalid=validateMedia(candidate,items,getBootstrap().h5.limits);
   if(invalid){setError(message(invalid));return;}
   const id=crypto.randomUUID();items=[...items,{...candidate,id,file,localId:null,url:URL.createObjectURL(file),name:file.name,progress:0,status:'QUEUED',ref:null,controller:null}];emit();upload(id);
  }catch{if(alive)setError(message('mediaInvalid'));}finally{admitting-=1;emit();}
 };
 const remove=(id:string)=>{
  const item=items.find(value=>value.id===id);if(!item)return;
  cancelProgress(id);item.controller?.abort();if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);
  if(playbackPending===id){playbackAttempt+=1;playbackPending=null;}
  if(item.kind==='VOICE')lastCapture?.release(true);
  if(item.localId&&item.kind==='VOICE')stopNativePreview(item.localId);
  if(item.kind==='VOICE')transcript({type:'REMOVE',id});
  items=items.filter(value=>value.id!==id);emit();
  if(item.ref)void api.cancelUpload(item.ref,getBootstrap().csrf_token,item.id).catch(()=>undefined);
 };
 const choosePhotos=async(fallback:()=>void)=>{
  if(!native()){fallback();return;}
  admitting+=1;emit();
  try{
   const ww=await getSdk(),result=await ww.chooseImage({count:Math.max(1,getBootstrap().h5.limits.image_count-items.filter(item=>item.kind==='IMAGE').length),sizeType:[ww.SizeType.original],sourceType:[ww.SourceType.camera,ww.SourceType.album],isSaveToAlbum:false});
   for(const localId of result.localIds){
    if(!alive)return;
    const candidate:MediaCandidate={kind:'IMAGE',byteSize:null,mimeType:'image/jpeg',durationMs:null},invalid=validateMedia(candidate,items,getBootstrap().h5.limits);
    if(invalid){setError(message(invalid));break;}
    const id=crypto.randomUUID();let url:string|null=null;
    try{const local=await ww.getLocalImgData({localId});url=local.localData.replace(/^data:image\/jgp/,'data:image/jpeg');}catch{/* Preview is optional. */}
    if(!alive)return;
    items=[...items,{...candidate,id,file:null,localId,url,name:message('photos'),progress:0,status:'QUEUED',ref:null,controller:null}];emit();upload(id);
   }
  }catch{if(alive){setError(message('mediaInvalid'));fallback();}}finally{admitting-=1;emit();}
 };
 const saveVoice=(localId:string|null,blob:Blob|null,duration:number):string|null=>{
  if(!alive)return null;
  if(!Number.isFinite(duration)){setError(message('mediaInvalid'));return null;}
  if(duration<2000){setError(message('voice:tooShort'),'info');return null;}
  const candidate:MediaCandidate={kind:'VOICE',byteSize:blob?.size??null,mimeType:blob?.type??'audio/amr',durationMs:Math.min(60_000,Math.round(duration))},invalid=validateMedia(candidate,items,getBootstrap().h5.limits);
  if(invalid){setError(message(invalid));return null;}
  const id=crypto.randomUUID();transcript({type:'BEGIN',id});items=[...items,{...candidate,id,file:blob,localId,url:blob?URL.createObjectURL(blob):null,name:message('voiceLabel'),progress:0,status:'QUEUED',ref:null,controller:null}];emit();upload(id);
  return id;
 };
 const transcribe=(id:string,localId:string,ww:Wecom)=>{
  if(!alive||!items.some(item=>item.id===id))return;
  void ww.translateVoice({localId,isShowProgressTips:false}).then(result=>{if(alive&&items.some(item=>item.id===id)&&result.translateResult)transcript({type:'READY',id,text:result.translateResult});}).catch(()=>{if(alive&&items.some(item=>item.id===id))setError(message('voice:transcriptUnavailable'),'info');});
 };
 const start=async()=>{
  if(record||items.some(item=>item.kind==='VOICE')||!alive)return;
  setError(null);setRecording({seconds:0,starting:true});
  const state:RecordingSession={capture:null,released:false,cancel:false,sliding:false};record=state;emit();
  try{
   const {createVoiceCapture}=await import('./voice-capture');
   if(!alive||record!==state||state.released)return;
   const capture=createVoiceCapture({canClear,canWecom,current:()=>alive&&record===state,getSdk,update:value=>{if(alive&&record===state)setRecording(value);},
    error:(key,tone,id)=>{if(alive&&(record===state||id&&items.some(item=>item.id===id)))setError(message(key),tone);},save:(localId,blob,duration)=>alive&&record===state?saveVoice(localId,blob,duration):null,transcribe,done:()=>{if(record===state){record=null;emit();}}});
   state.capture=capture;lastCapture=capture;if(state.sliding)capture.slide(true);await capture.start();
  }catch{if(alive&&record===state){if(!state.cancel)setError(message('voice:browserFailed'));record=null;setRecording({starting:false,recording:false,cancelling:false});}}
 };
 const release=(cancel=false)=>{const state=record;if(!state)return;state.released=true;state.cancel=state.cancel||cancel||state.sliding;if(state.capture)state.capture.release(state.cancel);else{record=null;setRecording({starting:false,recording:false,cancelling:false});if(alive&&!state.cancel)setError(message('voice:tooShort'),'info');}};
 const slide=(cancel:boolean)=>{if(record){record.sliding=cancel;record.capture?.slide(cancel);if(!record.capture)setRecording({cancelling:cancel});}};
 const playNative=async(item:DraftMedia)=>{
  if(!item.localId||!alive||!items.some(value=>value.id===item.id)||playbackPending===item.id)return;
  const attempt=++playbackAttempt;playbackPending=item.id;
  try{const ww=await getSdk();if(!alive||attempt!==playbackAttempt||!items.some(value=>value.id===item.id))return;markNativePreview(ww,item.localId);await ww.playVoice({localId:item.localId});}catch{if(alive&&attempt===playbackAttempt)setError(message('playbackUnavailable'));}finally{if(attempt===playbackAttempt)playbackPending=null;}
 };
 const clear=(bound=false)=>{
  playbackAttempt+=1;playbackPending=null;
  release(true);lastCapture?.release(true);
  for(const item of items){cancelProgress(item.id);item.controller?.abort();if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);if(item.kind==='VOICE')transcript({type:'REMOVE',id:item.id});if(item.localId&&item.kind==='VOICE')stopNativePreview(item.localId);if(!bound&&item.ref)void api.cancelUpload(item.ref,getBootstrap().csrf_token,item.id).catch(()=>undefined);}
  items=[];emit();
 };
 const hide=()=>{if(document.visibilityState!=='visible')release(true);};
 const scopeChanged=()=>dispose();
 const mount=()=>{alive=true;document.addEventListener('visibilitychange',hide);authLost.addEventListener('lost',scopeChanged);authLost.addEventListener('scope-change',scopeChanged);};
 const dispose=()=>{
  alive=false;document.removeEventListener('visibilitychange',hide);authLost.removeEventListener('lost',scopeChanged);authLost.removeEventListener('scope-change',scopeChanged);for(const cancel of pendingMeasurements)cancel();
  release(true);lastCapture?.release(true);lastCapture=null;record=null;
  // Navigation can leave a POST pending/UNKNOWN. Its ready refs must survive for binding/recovery.
  // Unbound files retain their original bounded expiry; only explicit remove cancels a draft upload.
  clear(true);recording={...recording,starting:false,recording:false,seconds:0,cancelling:false};listeners.clear();
 };
 return {subscribe,getItems:()=>items,getItemIds:()=>itemIds,getItem:(id:string)=>items.find(item=>item.id===id)??null,getError:()=>error,getErrorTone:()=>errorTone,getRecording:()=>recording,getBusy:()=>alive&&(admitting>0||pendingMeasurements.size>0||record!==null||recording.recording||items.some(item=>item.status!=='READY')),getHasVoice:()=>items.some(item=>item.kind==='VOICE'),getNative:native,setError,add,remove,choosePhotos,retry:upload,start,release,slide,playNative,clear,mount,dispose};
}
export type MediaController=ReturnType<typeof createMediaController>;
/** The controller is stable. Components subscribe only to the slice they display. */
export function useMedia(bootstrap:Bootstrap,onTranscript:(event:VoiceTranscriptEvent)=>void):MediaController{
 const {t}=useTranslation(),current=useRef({bootstrap,onTranscript,t});current.current={bootstrap,onTranscript,t};
 const controller=useRef<MediaController|null>(null);
 if(!controller.current)controller.current=createMediaController(()=>current.current.bootstrap,text=>current.current.onTranscript(text),key=>current.current.t(key));
 const value=controller.current;useEffect(()=>{value.mount();return()=>value.dispose();},[value]);return value;
}
export function useMediaItemIds(controller:MediaController){return useSyncExternalStore(controller.subscribe,controller.getItemIds,controller.getItemIds);}
export function useMediaItem(controller:MediaController,id:string){const snapshot=()=>controller.getItem(id);return useSyncExternalStore(controller.subscribe,snapshot,snapshot);}
export function useMediaRecording(controller:MediaController){return useSyncExternalStore(controller.subscribe,controller.getRecording,controller.getRecording);}
export function useMediaError(controller:MediaController){return useSyncExternalStore(controller.subscribe,controller.getError,controller.getError);}
export function useMediaErrorTone(controller:MediaController){return useSyncExternalStore(controller.subscribe,controller.getErrorTone,controller.getErrorTone);}
export function useMediaBusy(controller:MediaController){return useSyncExternalStore(controller.subscribe,controller.getBusy,controller.getBusy);}
export function useMediaHasVoice(controller:MediaController){return useSyncExternalStore(controller.subscribe,controller.getHasVoice,controller.getHasVoice);}
