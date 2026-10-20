import{useEffect,useRef,useState}from'react';
import{useTranslation}from'react-i18next';
import{authLost,ApiError,V2_ACCEPT}from'../api/client';
import type{H5Media}from'../api/types';
import{Icon}from'./Icon';
import{Button}from'./ui/primitives';
export function Material({media,requestRef}:{media:H5Media;requestRef:string}){
 const{t}=useTranslation();const[url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(false);const controller=useRef<AbortController|null>(null),objectUrl=useRef<string|null>(null);const alive=useRef(true);
 const load=async(variant:'PLAYABLE'|'ORIGINAL'='PLAYABLE')=>{
  if(controller.current)return;const abort=new AbortController();controller.current=abort;setLoading(true);setError(false);
  try{const response=await fetch('/api/yixiaoxiu/requests/'+encodeURIComponent(requestRef)+'/media/'+encodeURIComponent(media.media_ref)+'?variant='+variant,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:V2_ACCEPT},signal:abort.signal});
   if(!response.ok){if(response.status===401||response.status===403)authLost.dispatchEvent(new Event('lost'));throw new ApiError(response.status,'MEDIA_UNAVAILABLE');}
   const blob=await response.blob();if(blob.size>40*1024*1024)throw new Error('MEDIA_TOO_LARGE');if(!alive.current)return;const next=URL.createObjectURL(blob);if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=next;setUrl(next);
  }catch(reason){if(alive.current&&!(reason instanceof DOMException&&reason.name==='AbortError'))setError(true);}finally{controller.current=null;if(alive.current)setLoading(false);}
 };
 useEffect(()=>{alive.current=true;if(media.kind==='IMAGE')void load('ORIGINAL');return()=>{alive.current=false;controller.current?.abort();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};},[media.media_ref,requestRef]);
 if(media.kind==='IMAGE')return <div className="material-image">{url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={t('photoAlt')}/></a>:<Button variant="outline" disabled={loading} onClick={()=>void load('ORIGINAL')}><Icon name={error?'refresh':'photo_library'}/><span>{t(loading?'loading':error?'retry':'photos')}</span></Button>}</div>;
 return <div className="material-av"><div className="inline-row"><Icon name={media.kind==='VOICE'?'mic':'videocam'}/><strong>{t(media.kind==='VOICE'?'voiceLabel':'videoLabel')}</strong>{media.duration_ms!==null&&<small>{Math.round(media.duration_ms/1000)}s</small>}</div>{url?(media.kind==='VOICE'?<audio controls src={url} aria-label={t('voicePlay')}/>:<video controls preload="none" src={url} aria-label={t('videoLabel')}/>):media.playback_status==='READY'?<Button variant="outline" size="sm" disabled={loading} onClick={()=>void load()}><Icon name="play_arrow"/>{t(loading?'loading':error?'retry':'voicePlay')}</Button>:<p>{t(media.playback_status==='PENDING'?'playbackPending':'playbackUnavailable')}</p>}</div>;
}
