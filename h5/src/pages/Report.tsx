import {memo,useEffect,useRef,type ChangeEvent,type PointerEvent} from 'react';
import {useNavigate} from '../navigation';
import {useQueryClient} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {api} from '../api/client';
import type {H5RequestInput} from '../api/types';
import {useSession,useSessionStatus} from '../session';
import {useMediaBusy,useMediaError,useMediaHasVoice,useMediaItems,useMediaRecording,type DraftMedia} from '../hooks/useMedia';
import {useCommand,useCommandActions,useCommandSnapshot} from '../hooks/useCommand';
import {acceptedReceipt,confirmedReceipt} from '../lib/command';
import {hasFaultMaterial,type MediaKind} from '../lib/media';
import {Icon} from '../components/Icon';
import {RecoveryNotice} from '../components/Common';
import {ReportDraftProvider,useReportDraft,useDraftDescription,useDraftLocation,useDraftError} from '../components/ReportDraftProvider';
import {Button,Card,CardHeader,CardTitle,CardContent,Field,FieldLabel,FieldGroup,Textarea,Input,Badge,Alert,AlertDescription} from '../components/ui/primitives';

function resultRef(result:unknown):string|null{
 if(!result||typeof result!=='object')return null;
 if('request_ref'in result&&typeof result.request_ref==='string')return result.request_ref;
 if('result'in result)return resultRef(result.result);
 if('receipt'in result)return resultRef(result.receipt);return null;
}
function useWriteDisabled(){const session=useSession(),status=useSessionStatus(),command=useCommandSnapshot();return command.blocked||!status.writeReady||!session.can_submit;}
function ReadOnlyNotice(){const {t}=useTranslation(),session=useSession(),status=useSessionStatus();return !status.checking&&!session.can_submit?<Alert><AlertDescription>{t('readonly')}</AlertDescription></Alert>:null;}
function Recorder(){
 const {t}=useTranslation(),{media}=useReportDraft(),session=useSession(),disabled=useWriteDisabled()||!session.h5.can_upload;
 const state=useMediaRecording(media),hasVoice=useMediaHasVoice(media),pointer=useRef<number|null>(null);
 const begin=(event:PointerEvent<HTMLButtonElement>)=>{if(disabled||hasVoice)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);pointer.current=event.clientY;void media.start();};
 const release=(event:PointerEvent<HTMLButtonElement>)=>{event.preventDefault();media.release(pointer.current!==null&&pointer.current-event.clientY>64);pointer.current=null;};
 return <Card className="voice-card"><CardContent><span className="voice-kicker">{t('voiceNative')}</span><Button variant="voice" className={state.recording?'is-recording':''} disabled={disabled||hasVoice} onPointerDown={begin} onPointerUp={release} onPointerCancel={()=>{media.release(true);pointer.current=null;}} onPointerMove={event=>{if(pointer.current!==null)media.slide(pointer.current-event.clientY>64);}} onKeyDown={event=>{if((event.key===' '||event.key==='Enter')&&!event.repeat&&!disabled&&!hasVoice){event.preventDefault();void media.start();}}} onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();media.release();}}} aria-label={t('voiceTitle')} aria-pressed={state.recording}><Icon name="mic"/></Button><div className="voice-wave"><Icon name="graphic_eq"/></div><h2>{t(state.cancelling?'voiceCancel':state.recording?'voiceRecording':'voiceTitle',{seconds:state.seconds})}</h2><p className={state.recording?'voice-recording-hint':'voice-idle-hint'}>{t('voiceHint')}</p></CardContent></Card>;
}
function MediaInputs(){
 const {t}=useTranslation(),{media}=useReportDraft(),session=useSession(),disabled=useWriteDisabled()||!session.h5.can_upload;
 const photos=useRef<HTMLInputElement>(null),video=useRef<HTMLInputElement>(null);
 const files=(event:ChangeEvent<HTMLInputElement>,kind:MediaKind)=>{for(const file of Array.from(event.target.files??[]))void media.add(file,kind);event.target.value='';};
 return <><div className="media-actions"><Button variant="media" disabled={disabled} onClick={()=>void media.choosePhotos(()=>photos.current?.click())}><span className="utility-icon utility-orange"><Icon name="document_scanner"/></span><span><strong>{t('photos')}</strong><small>{t('photoHint')}</small></span><Icon className="media-plus" name="add_a_photo"/></Button><Button variant="media" disabled={disabled} onClick={()=>video.current?.click()}><span className="utility-icon utility-blue"><Icon name="videocam"/></span><span><strong>{t('video')}</strong><small>{t('videoHint')}</small></span><Icon className="media-plus" name="mic"/></Button></div><input ref={photos} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event=>files(event,'IMAGE')}/><input ref={video} hidden type="file" accept="video/mp4,video/webm,video/quicktime" capture="environment" onChange={event=>files(event,'VIDEO')}/></>;
}
function DraftErrors(){const {media}=useReportDraft(),faultError=useDraftError(),mediaError=useMediaError(media);return faultError||mediaError?<Alert variant="destructive"><AlertDescription>{faultError||mediaError}</AlertDescription></Alert>:null;}
const DraftMaterial=memo(function DraftMaterial({item,disabled}:{item:DraftMedia;disabled:boolean}){
 const {t}=useTranslation(),{media}=useReportDraft(),audio=useRef<HTMLAudioElement|null>(null),video=useRef<HTMLVideoElement|null>(null);
 useEffect(()=>{const elements=[audio.current,video.current];return()=>{for(const element of elements)if(element){element.pause();element.removeAttribute('src');element.load();}};},[item.id,item.url]);
 return <Card className="draft-media"><CardHeader><CardTitle>{item.kind==='VOICE'?t('voiceReady'):item.name}</CardTitle><Button variant="ghost" size="icon" disabled={disabled} aria-label={t('remove')} onClick={()=>media.remove(item.id)}><Icon name="close"/></Button></CardHeader><CardContent>{item.kind==='IMAGE'&&item.url&&<img src={item.url} alt={t('photoAlt')} decoding="async"/>}{item.kind==='VIDEO'&&item.url&&<video ref={video} controls preload="metadata" src={item.url} aria-label={t('videoLabel')}/>} {item.kind==='VOICE'&&(item.localId?<Button variant="outline" onClick={()=>void media.playNative(item)}><Icon name="play_arrow" data-icon="inline-start"/>{t('voicePlay')}</Button>:<audio ref={audio} controls preload="none" src={item.url??undefined} aria-label={t('voicePlay')}/>)}<div className="upload-state" role="status"><span>{t(item.status==='READY'?'uploaded':item.status==='ERROR'?'uploadFailed':'uploading',{progress:item.progress})}</span>{item.status==='ERROR'&&<Button variant="link" size="sm" disabled={disabled} onClick={()=>media.retry(item.id)}>{t('uploadRetry')}</Button>}</div>{item.status!=='READY'&&item.status!=='ERROR'&&<progress max={100} value={item.progress} aria-label={t('uploading',{progress:item.progress})}/>}</CardContent></Card>;
});
function DraftMaterials(){const {media}=useReportDraft(),items=useMediaItems(media),disabled=useWriteDisabled();return items.length?<div className="draft-media-list">{items.map(item=><DraftMaterial key={item.id} item={item} disabled={disabled}/>)}</div>:null;}
function DescriptionInput(){const {t}=useTranslation(),{draft}=useReportDraft(),description=useDraftDescription(),disabled=useWriteDisabled();return <Card className="text-card"><CardContent><Field><div className="field-heading"><FieldLabel htmlFor="fault-description"><Icon name="edit_note"/>{t('textLabel')}</FieldLabel><span className="counter">{description.length}/2000</span></div><Textarea data-h5-action="description" id="fault-description" value={description} onChange={event=>draft.setDescription(event.target.value)} placeholder={t('textPlaceholder')} maxLength={2000} rows={2} disabled={disabled}/></Field></CardContent></Card>;}
function LocationInput(){const {t}=useTranslation(),{draft}=useReportDraft(),location=useDraftLocation(),disabled=useWriteDisabled();return <Card className="location-card"><CardContent><Field><div className="field-heading"><FieldLabel htmlFor="fault-location"><Icon name="location_on"/>{t('location')}</FieldLabel><Badge variant="blue">{t('optional')}</Badge></div><Input id="fault-location" value={location} maxLength={200} onChange={event=>draft.setLocation(event.target.value)} placeholder={t('locationPlaceholder')} disabled={disabled}/></Field></CardContent></Card>;}
function SubmitActions(){
 const {t}=useTranslation(),{draft,media}=useReportDraft(),session=useSession(),command=useCommandSnapshot(),actions=useCommandActions(),disabled=useWriteDisabled(),mediaBusy=useMediaBusy(media),navigate=useNavigate(),client=useQueryClient();
 const submit=(intent:'FAULT'|'CONTACT_REQUEST')=>{
  draft.setError(null);if(disabled)return;
  if(media.getBusy()){draft.setError(t('uploadRequired'));return;}const items=media.getItems();
  const refs=items.flatMap(item=>item.status==='READY'?[item.ref]:[]),description=draft.getDescription(),location=draft.getLocation();
  if(intent==='FAULT'&&!hasFaultMaterial(description,refs)){draft.setError(t('materialRequired'));return;}
  const id=crypto.randomUUID(),input:H5RequestInput={schema_version:2,client_command_id:id,intent,description:description.trim()||null,location:{text:location.trim()||null,unknown:!location.trim()},media_refs:refs};
  void actions.run({id,execute:()=>api.submit(input,session.csrf_token),recover:()=>api.command(id),confirm:(result,phase)=>phase==='execute'?acceptedReceipt(result,id):confirmedReceipt(result,id),success:result=>{
   media.clear(true);draft.clear();
   void client.invalidateQueries({predicate:query=>query.queryKey[0]==='reports'&&query.queryKey[1]===session.recovery_scope,refetchType:'none'});
   const ref=resultRef(result);navigate(ref?'/requests/'+encodeURIComponent(ref):'/reports');
  }});
 };
 return <div className="submit-actions"><Button size="lg" className="w-full" disabled={disabled||mediaBusy} data-h5-action="submit" onClick={()=>submit('FAULT')}><Icon name="send" data-icon="inline-start"/>{t(command.busy?'submitting':'submit')}</Button><Button variant="warm" className="w-full" disabled={disabled||mediaBusy} onClick={()=>submit('CONTACT_REQUEST')}><Icon name="support_agent" data-icon="inline-start"/>{t('contactMe')}<small>{t('contactMeHint')}</small></Button></div>;
}
function CommandNotice(){const command=useCommand();return <RecoveryNotice command={command}/>;}
function FileFallback(){const {t}=useTranslation(),{media}=useReportDraft(),session=useSession(),disabled=useWriteDisabled()||!session.h5.can_upload,audio=useRef<HTMLInputElement>(null);return <div className="file-fallback"><input ref={audio} hidden type="file" accept="audio/mp4,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/amr" onChange={event=>{for(const file of Array.from(event.target.files??[]))void media.add(file,'VOICE');event.target.value='';}}/><Button variant="link" size="sm" disabled={disabled} onClick={()=>audio.current?.click()}><Icon name="audio_file" data-icon="inline-start"/>{t('audioFile')}</Button><p>{t('noPrivateData')}</p></div>;}
function ReportContents(){const {t}=useTranslation();return <div className="quick-page"><div className="quick-heading"><h1>{t('quickHeading')}</h1><Badge variant="success"><Icon name="bolt"/></Badge></div><ReadOnlyNotice/><Recorder/><MediaInputs/><DraftErrors/><DraftMaterials/><FieldGroup><DescriptionInput/><LocationInput/></FieldGroup><SubmitActions/><CommandNotice/><FileFallback/></div>;}
export default function Report(){return <ReportDraftProvider><ReportContents/></ReportDraftProvider>;}
