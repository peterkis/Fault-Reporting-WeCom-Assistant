import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {authLost,ApiError,V2_ACCEPT} from '../api/client';
import type {H5Media} from '../api/types';
import {Icon} from './Icon';
import {Button} from './ui/primitives';
export function Material({media,requestRef}:{media:H5Media;requestRef:string}){
 const {t}=useTranslation();
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(false),[playing,setPlaying]=useState(false);
 const controller=useRef<AbortController|null>(null),objectUrl=useRef<string|null>(null),audio=useRef<HTMLAudioElement|null>(null),playAfterLoad=useRef(false);
 const alive=useRef(true);
 const load=async(variant:'PLAYABLE'|'ORIGINAL'='PLAYABLE')=>{
  if(controller.current)return;const abort=new AbortController();controller.current=abort;setLoading(true);setError(false);
  try{const response=await fetch('/api/yixiaoxiu/requests/'+encodeURIComponent(requestRef)+'/media/'+encodeURIComponent(media.media_ref)+'?variant='+variant,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:V2_ACCEPT},signal:abort.signal});
   if(!response.ok){if(response.status===401||response.status===403)authLost.dispatchEvent(new Event('lost'));throw new ApiError(response.status,'MEDIA_UNAVAILABLE');}
   const blob=await response.blob();if(blob.size>40*1024*1024)throw new Error('MEDIA_TOO_LARGE');if(!alive.current)return;
   const next=URL.createObjectURL(blob);if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=next;setUrl(next);
  }catch(reason){if(alive.current&&!(reason instanceof DOMException&&reason.name==='AbortError'))setError(true);}finally{controller.current=null;if(alive.current)setLoading(false);}
 };
 const play=()=>{const element=audio.current;if(!element)return;setError(false);void element.play().catch(()=>{if(alive.current)setError(true);});};
 const toggleVoice=()=>{if(playing){audio.current?.pause();if(audio.current)audio.current.currentTime=0;return;}if(url)play();else{playAfterLoad.current=true;void load();}};
 useEffect(()=>{if(url&&playAfterLoad.current){playAfterLoad.current=false;play();}},[url]);
 useEffect(()=>{alive.current=true;if(media.kind==='IMAGE')void load('ORIGINAL');return()=>{alive.current=false;controller.current?.abort();audio.current?.pause();audio.current?.removeAttribute('src');audio.current?.load();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};},[media.media_ref,requestRef]);
 if(media.kind==='IMAGE')return <div className="material-image">{url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={t('photoAlt')}/></a>:<Button variant="outline" disabled={loading} onClick={()=>void load('ORIGINAL')}><Icon name={error?'refresh':'photo_library'}/><span>{t(loading?'loading':error?'retry':'photos')}</span></Button>}</div>;
 if(media.kind==='VOICE')return <div className="material-voice">
  <Button variant="default" size="icon" className="voice-play-button" disabled={loading||media.playback_status!=='READY'} onClick={toggleVoice} aria-label={t(playing?'voiceStop':error?'retry':'voicePlay')} aria-pressed={playing}><Icon name={playing?'pause':error?'refresh':'play_arrow'}/></Button>
  <div className="voice-material-copy"><strong>{t('voiceLabel')}</strong>{media.playback_status!=='READY'?<small>{t(media.playback_status==='PENDING'?'playbackPending':'playbackUnavailable')}</small>:error?<small className="voice-play-error">{t('voicePlay')}</small>:<span className="voice-material-wave" aria-hidden="true"><Icon name="graphic_eq"/></span>}</div>
  {media.duration_ms!==null&&<small className="voice-duration">{Math.round(media.duration_ms/1000)}s</small>}
  <audio ref={audio} hidden preload="none" src={url??undefined} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>setError(true)} aria-label={t('voiceLabel')}/>
 </div>;
 return <div className="material-av"><div className="inline-row"><Icon name="videocam"/><strong>{t('videoLabel')}</strong>{media.duration_ms!==null&&<small>{Math.round(media.duration_ms/1000)}s</small>}</div>{url?<video controls preload="none" src={url} aria-label={t('videoLabel')}/>:media.playback_status==='READY'?<Button variant="outline" size="sm" disabled={loading} onClick={()=>void load()}><Icon name="play_arrow"/>{t(loading?'loading':error?'retry':'voicePlay')}</Button>:<p>{t(media.playback_status==='PENDING'?'playbackPending':'playbackUnavailable')}</p>}</div>;
}
