import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Slider} from '@heroui/react';
import {ToastFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Download,Image as ImageIcon,Pause,Play,Volume2} from 'lucide-react';
import {ApiError,captureWorkbenchRead,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {attachmentApi,attachmentParentDenied} from './client';
import {webReportApi} from '../web-report/client';
import {mediaThumbnail} from './thumbnail';
import {DetailDialog} from '../../app/DetailDialog';
import {DetailLoading} from '../../app/DetailLoading';
import type {WebReportQuery} from '../web-report/use-web-report';
import type {AttachmentMetadata,AttachmentReason} from '../../../../../contracts/workbench_attachment_contracts';
import type {WorkbenchWebMedia} from '../../../../../contracts/workbench_web_report_contracts';

const labels:Record<AttachmentReason,string>={STORAGE_UNAVAILABLE:'附件存储暂不可用',EXPIRED:'附件已超过保留期限',MISSING:'已保存文件缺失',OVERSIZED:'附件超过10 MiB限制',UNSUPPORTED:'此文件格式不可用',UNTRUSTED:'附件尚未通过可信检查',INTEGRITY_FAILED:'附件完整性校验失败',BUSY:'附件读取正忙，请稍后重新读取'};
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','audio/amr':'amr','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a','audio/mpeg':'mp3','audio/webm':'webm','audio/ogg':'ogg','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
function message(error:unknown):string {if(error instanceof ApiError){const reason=error.code.replace('ATTACHMENT_','');if(Object.hasOwn(labels,reason))return labels[reason as AttachmentReason];if(error.code==='ATTACHMENT_NOT_FOUND')return '该附件已不可读取，请重新读取附件列表。';if(error.code==='ATTACHMENT_TIMEOUT')return '附件读取超时，请重新读取。';if(error.code==='INVALID_RESPONSE')return '附件响应无法安全识别。';}return errorMessage(error);}
type Material={key:string;kind:'IMAGE'|'VIDEO'|'VOICE';name:string;ready:boolean;duration:number|null;legacy?:AttachmentMetadata;web?:WorkbenchWebMedia};
const clock=(seconds:number)=>{const value=Math.max(0,Math.ceil(seconds));return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');};
function Voice({item,url,sender,disabled,onPlay,onDownload}:{item:Material;url:string|undefined;sender:string|null;disabled:boolean;onPlay:()=>void;onDownload:()=>void}){
  const audio=useRef<HTMLAudioElement>(null),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState((item.duration??0)/1000);
  useEffect(()=>{setPlaying(false);setPosition(0);setDuration((item.duration??0)/1000);},[url,item.duration]);
  return <div className={'detail-voice'+(playing?' is-playing':'')}>
    <div className="voice-caption"><strong>{sender??'报修人'}</strong><Volume2 size={15} aria-hidden="true"/><span>报修语音</span></div>
    <div className="voice-controls"><HButton type="button" className="voice-play" isDisabled={disabled||!item.ready} aria-label={playing?'暂停报修语音':'播放报修语音'} onClick={()=>{if(!url){onPlay();return;}if(audio.current?.paused)void audio.current.play().catch(()=>setPlaying(false));else audio.current?.pause();}} variant="secondary">{playing?<Pause size={17}/>:<Play size={17}/>}</HButton>
      <Slider className="voice-progress" aria-label="语音播放进度" minValue={0} maxValue={duration||1} step={.1} value={Math.min(position,duration)} isDisabled={!url||!duration} onChange={value=>{if(typeof value!=='number')return;if(audio.current)audio.current.currentTime=value;setPosition(value);}}><Slider.Track><Slider.Fill/><Slider.Thumb/></Slider.Track></Slider>
      <time aria-label="语音剩余时长">{clock(duration-position)}</time><HButton type="button" className="voice-download icon-button" aria-label="下载报修语音" title="下载语音原件" isDisabled={disabled} onClick={onDownload} variant="secondary"><Download size={16}/></HButton>
    </div>
    {!item.ready?<small>暂无可播放副本，可下载原件。</small>:null}
    {url?<audio ref={audio} src={url} autoPlay preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);setPosition(duration);}} onTimeUpdate={event=>setPosition(event.currentTarget.currentTime)} onLoadedMetadata={event=>{const value=event.currentTarget.duration;if(Number.isFinite(value))setDuration(value);}}/>:null}
  </div>;
}
export function AttachmentSection({principal,kind,id,requested,readReady,reporterName,onOpenChange,web}:{web:WebReportQuery;principal:Principal;kind:'ticket'|'review'|'intake';id:string;requested:{kind:'ticket'|'review'|'intake';id:string};readReady:boolean;reporterName:string|null;onOpenChange:(open:boolean)=>void}){
  const client=useQueryClient(),root=useRef<HTMLElement>(null),request=useRef<AbortController|null>(null),queue=useRef<Promise<unknown>>(Promise.resolve()),alive=useRef(true),generation=useRef(0),urls=useRef(new Set<string>());
  const [visible,setVisible]=useState(false),[thumbs,setThumbs]=useState<Record<string,string>>({}),[preview,setPreview]=useState<{item:Material;url:string}|null>(null),[busy,setBusy]=useState(false),[notice,setNotice,noticeRevision]=useFeedbackState(''),[refreshSerial,setRefreshSerial]=useState(0);
  const legacy=useQuery({queryKey:['attachments',principal.principal_id,kind,id],enabled:readReady,retry:false,gcTime:0,queryFn:({signal})=>serialized(async queuedSignal=>{const combined=AbortSignal.any([signal,queuedSignal]),current=captureWorkbenchRead(combined),value=await attachmentApi.list(kind,id,combined);current();return value;})});
  const [thumbState,setThumbState]=useState<Record<string,'loading'|'failed'>>({}),[metadataSettled,setMetadataSettled]=useState(false),[lastLegacyError,setLastLegacyError]=useState<unknown>(null);
  useEffect(()=>{if(legacy.isError)setLastLegacyError(legacy.error);else if(legacy.isSuccess)setLastLegacyError(null);},[legacy.error,legacy.isError,legacy.isSuccess]);
  useEffect(()=>{if(!legacy.isPending&&(!principal.web_reports_enabled||!web.isPending))setMetadataSettled(true);},[legacy.isPending,web.isPending,principal.web_reports_enabled]);
  const materials:Material[]=[...(legacy.data?.items??[]).map((item,index)=>({key:'legacy:'+item.ref,kind:'IMAGE' as const,name:'报修图片 '+(index+1),ready:item.available,duration:null,legacy:item})),...(principal.web_reports_enabled&&web.data?.applicable?web.data.media:[]).map((item,index)=>({key:'web:'+item.media_ref,kind:item.kind,name:({IMAGE:'现场图片',VIDEO:'现场视频',VOICE:'报修语音'})[item.kind]+' '+(index+1),ready:item.playback_status==='READY',duration:item.duration_ms,web:item}))];
  const keep=(blob:Blob)=>{const url=URL.createObjectURL(blob);urls.current.add(url);return url;};
  const revoke=(url:string)=>{URL.revokeObjectURL(url);urls.current.delete(url);};
  const clear=(abort=true)=>{generation.current++;if(abort)request.current?.abort();for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();setThumbs({});setThumbState({});setPreview(null);setBusy(false);};
  const denied=(error:unknown)=>{if(!(error instanceof ApiError))return false;if(error.status===401){clear();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');return true;}if(attachmentParentDenied(error)&&!error.code.startsWith('YXX_MEDIA_')){clear();void clearItemAuthorization(client,principal.principal_id,kind,id,error);if(requested.kind!==kind||requested.id!==id)void clearItemAuthorization(client,principal.principal_id,requested.kind,requested.id,error);return true;}return false;};
  useEffect(()=>{alive.current=true;const element=root.current,observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))setVisible(true);});if(element)observer.observe(element);return()=>{alive.current=false;generation.current++;request.current?.abort();observer.disconnect();for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();};},[]);
  useEffect(()=>{if(!readReady)clear();},[readReady]);
  useEffect(()=>{denied(legacy.error);},[legacy.error]);
  useEffect(()=>{denied(web.error);},[web.error]);
  useEffect(()=>client.getQueryCache().subscribe(event=>{const q=event.query.queryKey,error=event.query.state.error;if(event.type==='updated'&&q[1]===principal.principal_id&&(q[0]==='detail'||q[0]==='web-report')&&(q[2]===kind&&q[3]===id||q[2]===requested.kind&&q[3]===requested.id)&&error instanceof ApiError&&[401,403,404].includes(error.status))clear();}),[client,principal.principal_id,kind,id,requested.kind,requested.id]);
  const modal=preview!==null&&preview.item.kind!=='VOICE';
  const close=()=>{if(preview)revoke(preview.url);setPreview(null);};
  function serialized<T>(run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const token=generation.current;
    const next=queue.current.catch(()=>{}).then(async()=>{if(!alive.current||token!==generation.current)throw new DOMException('Scope changed','AbortError');const controller=new AbortController();request.current=controller;const timer=window.setTimeout(()=>controller.abort(),20_000);try{return await run(controller.signal);}finally{window.clearTimeout(timer);if(request.current===controller)request.current=null;}});
    queue.current=next;return next;
  };
  const read=async(item:Material,variant:'PLAYABLE'|'ORIGINAL',signal:AbortSignal)=>{const current=captureWorkbenchRead(signal);const blob=item.legacy?await attachmentApi.download(kind,id,item.legacy,signal):item.web?await webReportApi.media(kind,id,item.web,variant,signal):null;current();if(!blob)throw new Error('MEDIA_UNAVAILABLE');return blob;};
  const materialIdentity=materials.map(item=>item.key+':'+item.ready).join('|');
  useEffect(()=>{
    if(!visible||!readReady)return;let disposed=false;const effectGeneration=generation.current;
    // At most 28 thumbnails, 512 KiB each; no audio is fetched until the user plays it.
    void (async()=>{for(const item of materials){if(disposed||effectGeneration!==generation.current)break;if(item.kind==='VOICE'||!item.ready||thumbs[item.key])continue;
      setThumbState(previous=>({...previous,[item.key]:'loading'}));
      try{await serialized(async signal=>{const current=captureWorkbenchRead(signal),token=generation.current,blob=await read(item,'PLAYABLE',signal);if(disposed)return;const thumbnail=await mediaThumbnail(blob,item.kind==='VIDEO',signal);current();if(disposed||!alive.current||token!==generation.current)return;const url=keep(thumbnail);setThumbs(previous=>({...previous,[item.key]:url}));});}
      catch(error){if(!disposed&&alive.current){if(denied(error))break;if(effectGeneration===generation.current)setThumbState(previous=>({...previous,[item.key]:'failed'}));}}
    }})();return()=>{disposed=true;};
  },[visible,readReady,materialIdentity,refreshSerial]);
  useEffect(()=>{const keys=new Set(materials.filter(item=>item.ready).map(item=>item.key));setThumbs(previous=>{const next={...previous};for(const key of Object.keys(next))if(!keys.has(key)){revoke(next[key]!);delete next[key];}return next;});if(preview&&!keys.has(preview.item.key))close();},[materialIdentity]);
  async function open(item:Material,download=false){
    if(!readReady||busy)return;if(!item.ready&&item.web&&!download){close();setPreview({item,url:''});setNotice('');return;}setBusy(true);setNotice('正在安全读取材料…');if(!download)close();const token=generation.current;
    try{await serialized(async signal=>{const blob=await read(item,download?'ORIGINAL':'PLAYABLE',signal);if(!alive.current||token!==generation.current)return;const url=keep(blob);
      if(download){const link=document.createElement('a');link.href=url;link.download=(item.legacy?'report-attachment.':'report-material.')+(extensions[blob.type]??'bin');document.body.append(link);try{link.click();}finally{link.remove();revoke(url);}setNotice('已交给浏览器下载。');}
      else{setPreview({item,url});setNotice('');}
    });}catch(error){if(alive.current&&token===generation.current&&!denied(error)){setNotice(message(error));close();setThumbState(previous=>({...previous,[item.key]:'failed'}));setThumbs(previous=>{const next={...previous},url=next[item.key];if(url)revoke(url);delete next[item.key];return next;});void client.invalidateQueries({queryKey:[item.legacy?'attachments':'web-report',principal.principal_id,kind,id],exact:true});}}
    finally{if(alive.current&&token===generation.current)setBusy(false);}
  }
  async function refreshMaterials(){
    if(!readReady||busy)return;setBusy(true);setNotice('');const token=generation.current;
    try{await queue.current.catch(()=>{});if(!alive.current||token!==generation.current)return;await Promise.all([legacy.refetch(),...(principal.web_reports_enabled?[web.refetch()]:[])]);if(alive.current&&token===generation.current){setThumbState({});setRefreshSerial(value=>value+1);}}
    finally{if(alive.current&&token===generation.current)setBusy(false);}
  }
  const visual=materials.filter(item=>item.kind!=='VOICE'),voices=materials.filter(item=>item.kind==='VOICE');
  const initialLoading=!metadataSettled&&(legacy.isPending||principal.web_reports_enabled&&web.isPending);
  const legacyFailure=legacy.error??lastLegacyError;
  const unavailableFiles=materials.some(item=>item.legacy&&!item.ready);
  return <section ref={root} className="attachment-section detail-attachments" aria-label="报修附件"><h4>附件 {!legacy.isPending&&(!principal.web_reports_enabled||!web.isPending)?<span>{materials.length}</span>:null}</h4>
    {initialLoading&&!materials.length?<DetailLoading label="正在加载报修资料…"/>:null}
    {legacyFailure?<p role="status">{errorMessage(legacyFailure)}</p>:null}
    {!materials.length&&!legacy.isPending&&(!principal.web_reports_enabled||!web.isPending)&&!legacyFailure&&(!principal.web_reports_enabled||!web.error)?<p className="media-empty">{legacy.data?.available||web.data?.applicable?'当前事项没有可读取的已保存附件。':'附件存储暂不可用，当前无法读取原始文件。'}</p>:null}
    {visual.length?<div className="detail-media-grid">{visual.map(item=><HButton key={item.key} type="button" className="detail-media-card" aria-label={(thumbState[item.key]==='failed'?'重试查看':'查看')+item.name} isDisabled={!readReady||busy||(!item.ready&&!item.web)} onClick={()=>{void open(item);}} variant="secondary">{thumbs[item.key]?<img src={thumbs[item.key]} alt={item.name}/>:!item.ready?<span className="media-placeholder"><ImageIcon size={24}/><span>{item.legacy?.reason?labels[item.legacy.reason]:'播放副本正在准备，可下载原件'}</span></span>:thumbState[item.key]==='failed'?<span className="media-placeholder"><ImageIcon size={24}/><span>缩略图暂不可用，点击重试查看</span></span>:<DetailLoading compact label="加载预览…"/>}{item.kind==='VIDEO'?<><span className="media-video-play"><Play size={24}/></span>{item.duration!==null?<time>{clock(item.duration/1000)}</time>:null}</>:null}</HButton>)}</div>:null}
    {voices.map(item=><Voice key={item.key} item={item} sender={reporterName} url={preview?.item.key===item.key?preview.url:undefined} disabled={!readReady||busy} onPlay={()=>{void open(item);}} onDownload={()=>{void open(item,true);}}/>)}
    {legacy.data?.truncated?<p>当前仅显示前20个已关联附件。</p>:null}{notice?<ToastFeedback revision={noticeRevision} source="attachments" state={busy?'loading':undefined} role="status" aria-live="polite">{notice}</ToastFeedback>:null}
    {legacyFailure||unavailableFiles?<HButton type="button" className="media-retry" isDisabled={!readReady||legacy.isFetching||busy} onClick={()=>{void refreshMaterials();}} variant="secondary">重试读取附件</HButton>:null}
    <DetailDialog open={modal} onClose={close} title={preview?.item.name??'报修附件预览'} closeLabel="关闭附件预览" accessibleName="报修附件预览" className="detail-media-dialog" onOpenChange={onOpenChange} actions={preview?<HButton type="button" className="media-download" isDisabled={busy||!readReady} onClick={()=>{void open(preview.item,true);}} variant="secondary"><Download size={16}/>下载原件</HButton>:null}>
      {modal&&preview?(preview.url?(preview.item.kind==='IMAGE'?<img src={preview.url} alt={preview.item.name}/>:<video controls autoPlay playsInline src={preview.url}/>):<p>暂无可预览副本，可下载原件。</p>):null}

    </DetailDialog>
  </section>;
}
