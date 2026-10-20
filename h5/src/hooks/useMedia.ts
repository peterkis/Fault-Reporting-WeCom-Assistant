import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type {Bootstrap} from '../api/types';
import {validateMedia,measureDuration,type MediaKind,type MediaCandidate} from '../lib/media';
type Wecom=typeof import('@wecom/jssdk');
export interface DraftMedia extends MediaCandidate {id:string;file:Blob|null;localId:string|null;url:string|null;name:string;progress:number;status:'QUEUED'|'UPLOADING'|'READY'|'ERROR';ref:string|null;controller:AbortController|null}
export function useMedia(bootstrap:Bootstrap,onTranscript:(text:string)=>void){
  const {t}=useTranslation();
  const [items,setItems]=useState<DraftMedia[]>([]);
  const current=useRef<DraftMedia[]>([]);const alive=useRef(true);const queue=useRef(Promise.resolve());const sdk=useRef<Wecom|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [recording,setRecording]=useState(false);const [seconds,setSeconds]=useState(0);const [cancelling,setCancelling]=useState(false);
  const record=useRef<{started:number;cancel:boolean;released:boolean;media:MediaRecorder|null;stream:MediaStream|null;timer:number|null;interval:number|null;stopping:boolean;ready:boolean}|null>(null);
  const native=bootstrap.h5.sdk.enabled&&/wxwork/i.test(navigator.userAgent);
  const update=(next:DraftMedia[])=>{current.current=next;if(alive.current)setItems(next);};
  const patch=(id:string,value:Partial<DraftMedia>)=>update(current.current.map(item=>item.id===id?{...item,...value}:item));
  const getSdk=async()=>{
    if(sdk.current)return sdk.current;
    if(!native||!bootstrap.h5.sdk.corp_id)throw new Error('voiceUnavailable');
    const ww=await import('../lib/wecom');
    ww.register({corpId:bootstrap.h5.sdk.corp_id,...(bootstrap.h5.sdk.agent_id?{agentId:bootstrap.h5.sdk.agent_id}:{}),jsApiList:['startRecord','stopRecord','onVoiceRecordEnd','playVoice','stopVoice','uploadVoice','translateVoice','chooseImage','uploadImage','getLocalImgData'],getConfigSignature:url=>api.signature(url,'CORP',bootstrap.csrf_token),getAgentConfigSignature:url=>api.signature(url,'AGENT',bootstrap.csrf_token)});
    sdk.current=ww;return ww;
  };
  const upload=(id:string)=>{
    queue.current=queue.current.catch(()=>undefined).then(async()=>{
      const item=current.current.find(value=>value.id===id);if(!item||!alive.current||item.status==='READY')return;
      const controller=new AbortController();patch(id,{status:'UPLOADING',progress:0,controller});
      try{
        const reservation=item.ref?{media_ref:item.ref}:await api.reserve({schema_version:1,client_command_id:item.id,kind:item.kind,mime_type:item.mimeType.split(';')[0]!.trim().toLowerCase(),byte_size:item.byteSize,duration_ms:item.durationMs},bootstrap.csrf_token);
        if(!alive.current||!current.current.some(value=>value.id===id)){await api.cancelUpload(reservation.media_ref,bootstrap.csrf_token,item.id).catch(()=>undefined);return;}
        patch(id,{ref:reservation.media_ref});
        if(item.localId){const ww=await getSdk();const uploaded=item.kind==='VOICE'?await ww.uploadVoice({localId:item.localId,isShowProgressTips:false}):await ww.uploadImage({localId:item.localId,isShowProgressTips:false});if(controller.signal.aborted)return;await api.importWecom(reservation.media_ref,uploaded.serverId,bootstrap.csrf_token,item.id);}
        else if(item.file)await api.upload(reservation.media_ref,item.file,bootstrap.csrf_token,item.id,controller.signal,progress=>patch(id,{progress}));
        if(alive.current&&current.current.some(value=>value.id===id))patch(id,{status:'READY',progress:100,controller:null});
      }catch(reason){if(alive.current&&current.current.some(value=>value.id===id)&&!(reason instanceof DOMException&&reason.name==='AbortError'))patch(id,{status:'ERROR',controller:null});}
    });
  };
  const add=async(file:File,kind:MediaKind)=>{
    try{
      const duration=await measureDuration(file,kind);if(!alive.current)return;
      const candidate={kind,byteSize:file.size,mimeType:file.type,durationMs:duration};const invalid=validateMedia(candidate,current.current,bootstrap.h5.limits);
      if(invalid){setError(t(invalid));return;}
      const id=crypto.randomUUID();update([...current.current,{...candidate,id,file,localId:null,url:URL.createObjectURL(file),name:file.name,progress:0,status:'QUEUED',ref:null,controller:null}]);upload(id);
    }catch{if(alive.current)setError(t('mediaInvalid'));}
  };
  const remove=(id:string)=>{
    const item=current.current.find(value=>value.id===id);if(!item)return;item.controller?.abort();if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);if(item.localId&&item.kind==='VOICE')void sdk.current?.stopVoice({localId:item.localId}).catch(()=>undefined);
    update(current.current.filter(value=>value.id!==id));if(item.ref)void api.cancelUpload(item.ref,bootstrap.csrf_token,item.id).catch(()=>undefined);
  };
  const choosePhotos=async(fallback:()=>void)=>{
    if(!native){fallback();return;}
    try{const ww=await getSdk();const result=await ww.chooseImage({count:Math.max(1,bootstrap.h5.limits.image_count-current.current.filter(item=>item.kind==='IMAGE').length),sizeType:[ww.SizeType.original],sourceType:[ww.SourceType.camera,ww.SourceType.album],isSaveToAlbum:false});
      for(const localId of result.localIds){
        if(!alive.current)return;
        const candidate:MediaCandidate={kind:'IMAGE',byteSize:null,mimeType:'image/jpeg',durationMs:null};
        const invalid=validateMedia(candidate,current.current,bootstrap.h5.limits);if(invalid){setError(t(invalid));break;}
        const id=crypto.randomUUID();let url:string|null=null;
        try{const local=await ww.getLocalImgData({localId});url=local.localData.replace(/^data:image\/jgp/,'data:image/jpeg');}catch{/* preview is optional */}
        update([...current.current,{...candidate,id,file:null,localId,url,name:t('photos'),progress:0,status:'QUEUED',ref:null,controller:null}]);upload(id);
      }
    }catch{setError(t('mediaInvalid'));fallback();}
  };
  const saveVoice=(localId:string|null,blob:Blob|null,duration:number)=>{
    if(!alive.current)return;
    const candidate:MediaCandidate={kind:'VOICE',byteSize:blob?.size??null,mimeType:blob?.type??'audio/amr',durationMs:Math.min(60_000,Math.max(1,duration))};
    const invalid=validateMedia(candidate,current.current,bootstrap.h5.limits);if(invalid){setError(t(invalid));return;}
    const id=crypto.randomUUID();update([...current.current,{...candidate,id,file:blob,localId,url:blob?URL.createObjectURL(blob):null,name:t('voiceLabel'),progress:0,status:'QUEUED',ref:null,controller:null}]);upload(id);
    if(localId)void getSdk().then(ww=>ww.translateVoice({localId,isShowProgressTips:false})).then(result=>{if(alive.current&&current.current.some(item=>item.id===id)&&result.translateResult)onTranscript(result.translateResult);}).catch(()=>{/* optional transcript never blocks submission */});
  };
  const stop=async(cancel=false)=>{
    const state=record.current;if(!state||state.stopping)return;state.released=true;state.cancel=state.cancel||cancel;if(!state.ready)return;state.stopping=true;
    if(state.timer)clearTimeout(state.timer);if(state.interval)clearInterval(state.interval);
    setRecording(false);setCancelling(false);
    if(state.media){state.media.stop();state.stream?.getTracks().forEach(track=>track.stop());}
    else if(native){
      try{const ww=await getSdk();const result=await ww.stopRecord();if(!state.cancel&&alive.current)saveVoice(result.localId,null,performance.now()-state.started);}catch{if(alive.current&&!state.cancel)setError(t('voiceFailed'));}
    }
    if(record.current===state)record.current=null;
  };
  const start=async()=>{
    if(record.current||current.current.some(item=>item.kind==='VOICE'))return;
    setError(null);setSeconds(0);
    const state={started:performance.now(),cancel:false,released:false,media:null as MediaRecorder|null,stream:null as MediaStream|null,timer:null as number|null,interval:null as number|null,stopping:false,ready:false};record.current=state;
    try{
      if(native){const ww=await getSdk();await ww.startRecord();if(state.released||!alive.current){await ww.stopRecord();if(record.current===state)record.current=null;return;}ww.onVoiceRecordEnd(event=>{if(record.current!==state||state.stopping)return;state.stopping=true;if(state.interval)clearInterval(state.interval);if(state.timer)clearTimeout(state.timer);record.current=null;setRecording(false);if(!state.cancel)saveVoice(event.localId,null,60_000);});}
      else{
        if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('voiceUnavailable');
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});state.stream=stream;if(state.released||!alive.current){stream.getTracks().forEach(track=>track.stop());if(record.current===state)record.current=null;return;}
        const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value));const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);state.media=recorder;const chunks:Blob[]=[];
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());if(!state.cancel&&alive.current)saveVoice(null,new Blob(chunks,{type:recorder.mimeType}),performance.now()-state.started);};
        recorder.start();
      }
      state.ready=true;state.started=performance.now();if(!alive.current)return;setRecording(true);state.interval=window.setInterval(()=>setSeconds(Math.floor((performance.now()-state.started)/1000)),200);state.timer=window.setTimeout(()=>void stop(false),60_000);
    }catch{if(alive.current&&!state.cancel)setError(t('voiceFailed'));state.stream?.getTracks().forEach(track=>track.stop());if(record.current===state)record.current=null;setRecording(false);}
  };
  const release=(cancel=false)=>{const state=record.current;if(!state)return;state.released=true;state.cancel=state.cancel||cancel;if(state.ready)void stop(cancel);};
  const slide=(cancel:boolean)=>{if(record.current){record.current.cancel=cancel;setCancelling(cancel);}};
  const playNative=async(item:DraftMedia)=>{if(item.localId)try{const ww=await getSdk();await ww.playVoice({localId:item.localId});}catch{setError(t('playbackUnavailable'));}};
  const clear=(bound=false)=>{for(const item of current.current){item.controller?.abort();if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);if(item.localId&&item.kind==='VOICE')void sdk.current?.stopVoice({localId:item.localId}).catch(()=>undefined);if(!bound&&item.ref)void api.cancelUpload(item.ref,bootstrap.csrf_token,item.id).catch(()=>undefined);}update([]);};
  useEffect(()=>{alive.current=true;const hide=()=>{if(document.visibilityState!=='visible'){const state=record.current;if(state){state.cancel=true;state.released=true;void stop(true);}}};document.addEventListener('visibilitychange',hide);return()=>{alive.current=false;document.removeEventListener('visibilitychange',hide);const state=record.current;if(state){state.cancel=true;state.released=true;if(state.timer)clearTimeout(state.timer);if(state.interval)clearInterval(state.interval);if(state.media?.state==='recording')state.media.stop();else void sdk.current?.stopRecord().catch(()=>undefined);state.stream?.getTracks().forEach(track=>track.stop());}for(const item of current.current){item.controller?.abort();if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);if(item.localId&&item.kind==='VOICE')void sdk.current?.stopVoice({localId:item.localId}).catch(()=>undefined);}current.current=[];};},[]);
  return{items,error,setError,add,remove,choosePhotos,retry:upload,recording,seconds,cancelling,start,release,slide,playNative,clear,native};
}
