import {lazy,Suspense,createContext,memo,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useTranslation} from "../i18n-react";
import {authLost,ApiError,V2_ACCEPT,captureAuthGeneration,reportAuthLost} from '../api/client';
import type {RequestDetail} from '../api/types';
import {useSessionStatus} from '../session';
import {Icon} from './Icon';
import {Button} from './ui/primitives';
import {createMaterialQueue} from './material-request-queue';
import {newExperience,prepareInteractions} from '../experience';
import {LazyPanelBoundary} from './LazyPanelBoundary';
const loadImagePreview=()=>{prepareInteractions();return import('../enhancements/ImageViewer');};
const ImagePreview=lazy(loadImagePreview);
type Media=RequestDetail['h5']['media'][number];
type MediaVariant='PLAYABLE'|'ORIGINAL'|'THUMBNAIL';
type Queue=ReturnType<typeof createMaterialQueue>;
const QueueContext=createContext<Queue|null>(null);
export function MaterialsProvider({children,requestRef}:{children:ReactNode;requestRef:string}){
 const queue=useMemo(()=>createMaterialQueue(),[requestRef]);
 useEffect(()=>()=>queue.dispose(),[queue]);
 return <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>;
}
function mediaURL(requestRef:string,mediaRef:string,variant:MediaVariant){
 return '/api/yixiaoxiu/requests/'+encodeURIComponent(requestRef)+'/media/'+encodeURIComponent(mediaRef)+'?variant='+variant;
}
async function boundedBlob(response:Response,limit:number):Promise<Blob>{
 const declared=response.headers.get('content-length');if(declared!==null&&Number(declared)>limit){await response.body?.cancel();throw new ApiError(502,'MEDIA_TOO_LARGE');}
 if(!response.body){const blob=await response.blob();if(blob.size>limit)throw new ApiError(502,'MEDIA_TOO_LARGE');return blob;}
 const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[],type=response.headers.get('content-type')??'application/octet-stream';let total=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>limit){await reader.cancel();throw new ApiError(502,'MEDIA_TOO_LARGE');}const bytes=new Uint8Array(part.value.byteLength);bytes.set(part.value);chunks.push(bytes);}
  return new Blob(chunks,{type});
 }finally{reader.releaseLock();chunks.length=0;}
}
/** Only the negotiated entry DTO carries this field (including null for audio/video). */
export function supportsProgressivePlayback(media:Pick<Media,'kind'|'thumbnail'>):boolean{return media.kind!=='IMAGE'&&media.thumbnail!==undefined;}
/** Legacy playback is requested only by an explicit user action and never sends Range. */
export async function readMediaBlob(requestRef:string,media:Pick<Media,'media_ref'|'kind'>,variant:MediaVariant,signal:AbortSignal):Promise<Blob>{
 const generation=captureAuthGeneration();
 const response=await fetch(mediaURL(requestRef,media.media_ref,variant),{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:V2_ACCEPT},signal});
 if(signal.aborted||generation!==captureAuthGeneration())throw new DOMException('Member scope changed','AbortError');
 if(!response.ok){if(response.status===401||response.status===403)reportAuthLost(generation,signal,response.status);throw new ApiError(response.status,'MEDIA_UNAVAILABLE');}
 const limit=variant==='THUMBNAIL'?160*1024:media.kind==='VIDEO'?20*1024*1024:media.kind==='VOICE'?5*1024*1024:10*1024*1024;
 const blob=await boundedBlob(response,limit);
 if(signal.aborted||generation!==captureAuthGeneration())throw new DOMException('Member scope changed','AbortError');return blob;
}
export const Material=memo(function Material({media,requestRef}:{media:Media;requestRef:string}){
 const {t}=useTranslation(),session=useSessionStatus(),queue=useContext(QueueContext);
 const [preview,setPreview]=useState(false);
 const [url,setUrl]=useState<string|null>(null),[original,setOriginal]=useState(false),[error,setError]=useState(false),[loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[videoActive,setVideoActive]=useState(false);
 const root=useRef<HTMLDivElement|null>(null),controller=useRef<AbortController|null>(null),objectURL=useRef<string|null>(null),audio=useRef<HTMLAudioElement|null>(null),video=useRef<HTMLVideoElement|null>(null),alive=useRef(true),checkingError=useRef(false),playbackGeneration=useRef<number|null>(null),refresher=useRef(session.refresh);refresher.current=session.refresh;
 const clearPlayback=useCallback(()=>{
  playbackGeneration.current=null;
  for(const element of [audio.current,video.current])if(element){element.pause();element.removeAttribute('src');element.load();}
  queue?.setPlayback(media.media_ref,false);
 },[queue,media.media_ref]);
 const playbackError=useCallback(()=>{
  if(!alive.current||checkingError.current||playbackGeneration.current!==captureAuthGeneration())return;
  checkingError.current=true;clearPlayback();setPlaying(false);setVideoActive(false);setError(true);
  // The shared session refresh differentiates a revoked member from a media/network failure.
  void refresher.current().catch(()=>undefined).finally(()=>{checkingError.current=false;});
 },[clearPlayback]);
 const progressive=supportsProgressivePlayback(media);
 const load=useCallback(async(variant:MediaVariant)=>{
  if(controller.current)return;
  const abort=new AbortController();controller.current=abort;setLoading(true);setError(false);
  const read=()=>readMediaBlob(requestRef,media,variant,abort.signal);
  try{
   const blob=queue?await queue.schedule(variant==='THUMBNAIL'?1:0,abort.signal,read):await read();
   if(!alive.current||abort.signal.aborted)return;
   const next=URL.createObjectURL(blob);if(objectURL.current)URL.revokeObjectURL(objectURL.current);objectURL.current=next;setUrl(next);setOriginal(variant==='ORIGINAL');return next;
  }catch(reason){if(alive.current&&!(reason instanceof DOMException&&reason.name==='AbortError'))setError(true);}
  finally{if(controller.current===abort)controller.current=null;if(alive.current)setLoading(false);}
 },[media.media_ref,media.kind,requestRef,queue]);
 useEffect(()=>{
  alive.current=true;
  const elements=[audio.current,video.current];
  const lost=()=>{queue?.dispose();controller.current?.abort();clearPlayback();if(objectURL.current){URL.revokeObjectURL(objectURL.current);objectURL.current=null;}setUrl(null);setPreview(false);};
  authLost.addEventListener('lost',lost);authLost.addEventListener('scope-change',lost);
  return()=>{alive.current=false;authLost.removeEventListener('lost',lost);authLost.removeEventListener('scope-change',lost);controller.current?.abort();for(const element of elements)if(element){element.pause();element.removeAttribute('src');element.load();}clearPlayback();if(objectURL.current){URL.revokeObjectURL(objectURL.current);objectURL.current=null;}};
 },[media.media_ref,requestRef,clearPlayback]);
 useEffect(()=>{const element=video.current;if(!element)return;return()=>{element.pause();element.removeAttribute('src');element.load();};},[videoActive,media.media_ref,requestRef]);
 const thumbnailReady=media.kind==='IMAGE'&&media.thumbnail?.status==='READY';
 useEffect(()=>{
  if(!thumbnailReady||!root.current)return;
  if(typeof IntersectionObserver==='undefined'){void load('THUMBNAIL');return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();void load('THUMBNAIL');}},{rootMargin:'240px'});
  observer.observe(root.current);return()=>observer.disconnect();
 },[thumbnailReady,load]);
 const toggleVoice=()=>{
  const element=audio.current;if(!element)return;
  if(playing){element.pause();element.currentTime=0;queue?.setPlayback(media.media_ref,false);return;}
  setError(false);playbackGeneration.current=captureAuthGeneration();queue?.setPlayback(media.media_ref,true);
  const source=progressive?mediaURL(requestRef,media.media_ref,'PLAYABLE'):url;
  if(source){element.src=source;void element.play().catch(playbackError);return;}
  void load('PLAYABLE').then(next=>{if(!next||!alive.current){queue?.setPlayback(media.media_ref,false);return;}element.src=next;void element.play().catch(playbackError);});
 };
 const startVideo=()=>{
  setError(false);playbackGeneration.current=captureAuthGeneration();queue?.setPlayback(media.media_ref,true);
  if(progressive||url){setVideoActive(true);return;}
  void load('PLAYABLE').then(next=>{if(next&&alive.current)setVideoActive(true);else queue?.setPlayback(media.media_ref,false);});
 };
 if(media.kind==='IMAGE')return <div ref={root} className="material-image">{preview&&url&&<LazyPanelBoundary onClose={()=>setPreview(false)}><Suspense fallback={null}><ImagePreview url={url} original={original} loading={loading} error={error} onOriginal={()=>{controller.current?.abort();controller.current=null;void load('ORIGINAL');}} onClose={()=>setPreview(false)}/></Suspense></LazyPanelBoundary>}{url?<a href={url} target="_blank" rel="noreferrer" onPointerDown={()=>{if(newExperience)void loadImagePreview().catch(()=>undefined);}} onFocus={()=>{if(newExperience)void loadImagePreview().catch(()=>undefined);}} onClick={event=>{if(newExperience){event.preventDefault();setPreview(true);}if(!original){event.preventDefault();controller.current?.abort();controller.current=null;void load('ORIGINAL');}}} aria-label={t('downloadOriginal')}><img src={url} alt={t('photoAlt')} width={320} height={240} loading="lazy" decoding="async" onError={()=>{if(objectURL.current){URL.revokeObjectURL(objectURL.current);objectURL.current=null;}setUrl(null);setOriginal(false);setError(true);}}/></a>:<Button variant="outline" disabled={loading} onClick={()=>{if(newExperience){setPreview(true);void loadImagePreview().catch(()=>undefined);}void load('ORIGINAL');}}><Icon name={error?'refresh':'photo_library'}/><span>{t(loading?'loading':error?'retry':'downloadOriginal')}</span></Button>}</div>;
 if(media.kind==='VOICE')return <div className="material-voice"><Button variant="default" size="icon" className="voice-play-button" disabled={loading||media.playback_status!=='READY'} onClick={toggleVoice} aria-label={t(playing?'voiceStop':error?'retry':'voicePlay')} aria-pressed={playing}><Icon name={playing?'pause':error?'refresh':'play_arrow'}/></Button><div className="voice-material-copy"><strong>{t('voiceLabel')}</strong>{media.playback_status!=='READY'?<small>{t(media.playback_status==='PENDING'?'playbackPending':'playbackUnavailable')}</small>:error?<small className="voice-play-error">{t('voicePlay')}</small>:<span className="voice-material-wave" aria-hidden="true"><Icon name="graphic_eq"/></span>}</div>{media.duration_ms!==null&&<small className="voice-duration">{Math.round(media.duration_ms/1000)}s</small>}<audio ref={audio} hidden preload="none" onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);queue?.setPlayback(media.media_ref,false);}} onEnded={()=>{setPlaying(false);queue?.setPlayback(media.media_ref,false);}} onError={playbackError} aria-label={t('voiceLabel')}/></div>;
 return <div className="material-av"><div className="inline-row"><Icon name="videocam"/><strong>{t('videoLabel')}</strong>{media.duration_ms!==null&&<small>{Math.round(media.duration_ms/1000)}s</small>}</div>{videoActive?<video ref={video} controls autoPlay preload="none" src={progressive?mediaURL(requestRef,media.media_ref,'PLAYABLE'):url??undefined} onPlay={()=>queue?.setPlayback(media.media_ref,true)} onPause={()=>queue?.setPlayback(media.media_ref,false)} onEnded={()=>queue?.setPlayback(media.media_ref,false)} onError={playbackError} aria-label={t('videoLabel')}/>:media.playback_status==='READY'?<Button variant="outline" size="sm" disabled={loading} onClick={startVideo}><Icon name="play_arrow"/>{t(loading?'loading':error?'retry':'voicePlay')}</Button>:<p>{t(media.playback_status==='PENDING'?'playbackPending':'playbackUnavailable')}</p>}</div>;
});
