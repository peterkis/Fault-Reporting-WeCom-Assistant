import {Ambient} from '../enhancements/Ambient';
import {newExperience,prepareInteractions} from '../experience';
import {lazy,memo,Suspense,useCallback,useMemo,useState} from 'react';
import {useParams} from '../navigation';
import {skipToken,useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {useTranslation} from "../i18n-react";
import {api,ApiError} from '../api/client';
import {detailOptions,timelineOptions,supplementsOptions,queryKeys,firstPage,refreshRequest} from '../api/query';
import type {RequestDetail,H5SupplementPage} from '../api/types';
import {useIdentity,useSession,useSessionStatus} from '../session';
import {useCommand,useCommandActions,useCommandSnapshot} from '../hooks/useCommand';
import {detailReceipt} from '../hooks/detail-command-receipt';
import {formatDate,safePhone,safeAvatarURL,safeMemberLink} from '../lib/utils';
import {reportState,reportTone} from '../lib/report';
import {latestFirst,timelinePresentation} from '../lib/timeline';
import {Icon} from '../components/Icon';
import {Material,MaterialsProvider} from '../components/Materials';
import {ErrorPanel,Loading,RecoveryNotice} from '../components/Common';
import {LazyPanelBoundary} from '../components/LazyPanelBoundary';
import type {DetailActionKind} from '../components/DetailDialogs';
import {Button,ButtonLink,Avatar,Card,CardHeader,CardTitle,CardContent,CardDescription,Badge} from '../components/ui/primitives';
const loadDetailDialogs=()=>{prepareInteractions();return import('../components/DetailDialogs');};
const DetailDialogs=lazy(loadDetailDialogs);

const Overview=memo(function Overview({value}:{value:RequestDetail}){
 const {t,i18n}=useTranslation(),status=reportState(value),h5=value.h5;
 return <Card className="detail-overview"><CardHeader><div className="detail-number"><span>{t('reportNo',{number:value.ticket?.ticket_no||value.intake_no})}</span><Badge variant={reportTone(status)}>{t(status)}</Badge></div><CardTitle>{value.safe_description||t(h5.intent==='CONTACT_REQUEST'?'contactIntent':'noDescription')}</CardTitle><CardDescription>{t('created')} · {formatDate(value.created_epoch_ms,i18n.language)}</CardDescription></CardHeader><CardContent>{value.safe_location&&<p className="location-line"><Icon name="location_on"/>{value.safe_location}</p>}{h5.intent==='CONTACT_REQUEST'&&<Badge variant="warning">{t('intentContact')}</Badge>}</CardContent></Card>;
});
const Handler=memo(function Handler({handler}:{handler:RequestDetail['h5']['handler']}){
 const {t}=useTranslation(),phone=safePhone(handler?.phone),chat=safeMemberLink(handler?.chat_url);
 return <Card className="handler-card"><CardHeader><CardTitle>{t('team')}</CardTitle></CardHeader><CardContent><div className="handler-profile"><Avatar src={safeAvatarURL(handler?.avatar_url)} fallback={handler?.name?.slice(0,1)||'修'} alt={handler?.name||t('team')}/><div><strong>{handler?.name?t('engineer',{name:handler.name}):t('handlerUnknown')}</strong>{handler?.team_name&&<p>{handler.team_name}</p>}</div></div>{(phone||chat)&&<div className="handler-contact-actions">{phone&&<ButtonLink variant="outline" href={phone}><Icon name="call" data-icon="inline-start"/>{t('callEngineer')}</ButtonLink>}{chat&&<ButtonLink variant="secondary" href={chat}><Icon name="chat" data-icon="inline-start"/>{t('contactEngineer')}</ButtonLink>}</div>}</CardContent></Card>;
});
const Materials=memo(function Materials({media,requestRef}:{media:RequestDetail['h5']['media'];requestRef:string}){
 const {t}=useTranslation();if(!media.length)return null;
 return <MaterialsProvider requestRef={requestRef}><Card className="materials-card"><CardHeader><CardTitle>{t('media')}</CardTitle><CardDescription>{t('attachmentCount',{count:media.length})}</CardDescription></CardHeader><CardContent><div className="materials-grid">{media.map(item=><Material key={item.media_ref} media={item} requestRef={requestRef}/>)}</div></CardContent></Card></MaterialsProvider>;
});
const DetailTimeline=memo(function DetailTimeline({requestRef,progress,active}:{requestRef:string;progress:RequestDetail['h5']['public_progress'];active:boolean}){
 const {t,i18n}=useTranslation(),session=useIdentity(),client=useQueryClient();
 const retry=useCallback(()=>void refreshRequest(client,session.recovery_scope,requestRef).catch(()=>undefined),[client,session.recovery_scope,requestRef]);
 // Explicit retries replace history with a fresh entry first page.
 const timeline=useInfiniteQuery(timelineOptions(session.recovery_scope,requestRef));
 const section=useQuery({queryKey:queryKeys.timelineSection(session.recovery_scope,requestRef),queryFn:skipToken});
 const events=useMemo(()=>latestFirst(timeline.data?.pages.flatMap(page=>page.items)??[]),[timeline.data]);
 const unavailable=section.data==='UNAVAILABLE'&&!timeline.data;
 return <Card className="progress-card"><CardHeader><CardTitle>{t('progress')}</CardTitle>{progress?.estimated_epoch_ms&&<Badge variant="blue">{t('estimated',{time:formatDate(progress.estimated_epoch_ms,i18n.language)})}</Badge>}</CardHeader><CardContent>{unavailable?<ErrorPanel error={new ApiError(503,'YXX_UNAVAILABLE')} retry={retry}/>:timeline.isPending?<Loading/>:timeline.isError?<ErrorPanel error={timeline.error} retry={retry}/>:events.length||progress?<ol className="timeline">{progress&&<li className="timeline-public-progress"><span className={"timeline-icon"+(newExperience?" h5-current-node":"")}><Icon name="build"/><Ambient kind="current" active={active&&!timeline.isFetching&&!timeline.isError}/></span><div><div className="timeline-top"><strong>{t('publicProgress')}</strong><time>{formatDate(progress.updated_epoch_ms,i18n.language,true)}</time></div><div className="public-progress"><p>{progress.summary}</p></div></div></li>}{events.map((event,index)=>{const presentation=timelinePresentation(event),title=presentation.titleKey?t(presentation.titleKey):presentation.summary;return <li key={event.event_type+event.occurred_epoch_ms+index}><span className={"timeline-icon"+(newExperience&&index===0&&!progress?" h5-current-node":"")}><Icon name={index===0&&!progress?'build':'check'}/>{index===0&&!progress&&<Ambient kind="current" active={active&&!timeline.isFetching&&!timeline.isError}/>}</span><div><div className="timeline-top"><strong>{title}</strong><time>{formatDate(event.occurred_epoch_ms,i18n.language,true)}</time></div>{presentation.summary!==title&&<p className="timeline-narrative">{presentation.summary}</p>}</div></li>;})}</ol>:<p className="muted">{t('noProgress')}</p>}{timeline.hasNextPage&&<Button variant="link" disabled={timeline.isFetchingNextPage} onClick={()=>void timeline.fetchNextPage()}>{t('more')}</Button>}</CardContent></Card>;
});
const Supplements=memo(function Supplements({value,requestRef}:{value:RequestDetail;requestRef:string}){
 const {t}=useTranslation(),session=useIdentity();
 const supplements=useInfiniteQuery({...supplementsOptions(session.recovery_scope,requestRef),initialData:()=>firstPage<H5SupplementPage>({items:value.supplements,next_cursor:value.supplements_cursor??null})});
 const items=useMemo(()=>supplements.data.pages.flatMap(page=>page.items).filter(item=>item.text),[supplements.data]);
 if(!items.length&&!supplements.hasNextPage)return null;
 return <Card className="supplements-card"><CardHeader><CardTitle>{t('supplement')}</CardTitle></CardHeader><CardContent>{items.map(item=><p key={item.input_revision}>{item.text}</p>)}{supplements.isError&&<ErrorPanel error={supplements.error} retry={()=>void supplements.fetchNextPage()}/>} {supplements.hasNextPage&&<Button variant="link" disabled={supplements.isFetchingNextPage} onClick={()=>void supplements.fetchNextPage()}>{t('more')}</Button>}</CardContent></Card>;
});
const Evaluation=memo(function Evaluation({evaluation}:{evaluation:RequestDetail['h5']['evaluation']}){const {t}=useTranslation();return evaluation.rating!==null?<div className="evaluation-done"><Icon name="verified"/><strong>{t('alreadyEvaluated')}</strong><span>{'★'.repeat(evaluation.rating)}</span>{evaluation.comment&&<p>{evaluation.comment}</p>}</div>:null;});
function DetailActions({value,requestRef}:{value:RequestDetail;requestRef:string}){
 const {t}=useTranslation(),session=useSession(),status=useSessionStatus(),client=useQueryClient(),command=useCommand();
 const [dialog,setDialog]=useState<DetailActionKind|null>(null);
 const disabled=command.blocked||command.syncingRequests.includes(requestRef)||!status.writeReady;
 const refresh=useCallback(async()=>{await refreshRequest(client,session.recovery_scope,requestRef);command.acknowledgeSync(requestRef);},[client,session.recovery_scope,requestRef,command.acknowledgeSync]);
 const refreshAfterCommit=useCallback(async()=>{await refreshRequest(client,session.recovery_scope,requestRef,{afterCommit:true});command.acknowledgeSync(requestRef);},[client,session.recovery_scope,requestRef,command.acknowledgeSync]);
 const urge=()=>{
  const version=value.h5.ticket_version;if(version===null||disabled||!session.h5.can_urge||!value.h5.urge.can_urge)return;
  const id=crypto.randomUUID();void command.run({id,requestRef,execute:()=>api.urge(requestRef,{schema_version:1,client_command_id:id,expected_ticket_version:version},session.csrf_token),recover:()=>api.memberCommand(requestRef,id,'URGE'),confirm:detailReceipt(id,requestRef,'URGE'),success:refreshAfterCommit});
 };
 return <><div className="detail-secondary-actions">{value.can_supplement&&<Button variant="outline" disabled={disabled||!session.can_supplement} onPointerEnter={()=>void loadDetailDialogs().catch(()=>undefined)} onFocus={()=>void loadDetailDialogs().catch(()=>undefined)} data-h5-action="supplement" onClick={()=>setDialog('supplement')}><Icon name="edit_note" data-icon="inline-start"/>{t('supplement')}</Button>}{value.feedback_context?.can_feedback&&<Button variant="link" disabled={disabled} onPointerEnter={()=>void loadDetailDialogs().catch(()=>undefined)} onFocus={()=>void loadDetailDialogs().catch(()=>undefined)} onClick={()=>setDialog('feedback')}>{t('unresolved')}</Button>}</div><Evaluation evaluation={value.h5.evaluation}/><RecoveryNotice command={command} onRefresh={refresh}/><div className="detail-action-bar"><Button variant="warm" disabled={disabled||!session.h5.can_urge||!value.h5.urge.can_urge||value.h5.ticket_version===null} data-h5-action="urge" onClick={urge}><Icon name="notifications_active" data-icon="inline-start"/>{t(value.h5.urge.active?'urged':'urge')}</Button><Button disabled={disabled||!session.h5.can_evaluate||!value.h5.evaluation.can_evaluate} onPointerEnter={()=>void loadDetailDialogs().catch(()=>undefined)} onFocus={()=>void loadDetailDialogs().catch(()=>undefined)} onClick={()=>setDialog('evaluation')}><Icon name="verified" data-icon="inline-start"/>{t('evaluate')}</Button></div>{dialog&&<LazyPanelBoundary key={dialog} onClose={()=>setDialog(null)}><Suspense fallback={<span className="sr-only" role="status">{t('loading')}</span>}><DetailDialogs kind={dialog} value={value} requestRef={requestRef} onClose={()=>setDialog(null)} onCommitted={refreshAfterCommit} onRefresh={refresh}/></Suspense></LazyPanelBoundary>}</>;
}
function ManualRefresh({requestRef}:{requestRef:string}){
 const {t}=useTranslation(),session=useSession(),client=useQueryClient(),actions=useCommandActions(),command=useCommandSnapshot();
 if(!command.syncingRequests.includes(requestRef)||command.synchronizing&&command.requestRef===requestRef)return null;
 return <Button variant="link" onClick={()=>void refreshRequest(client,session.recovery_scope,requestRef).then(()=>actions.acknowledgeSync(requestRef)).catch(()=>undefined)}>{t('refresh')}</Button>;
}
export default function Detail(){
 const session=useIdentity(),status=useSessionStatus(),client=useQueryClient(),{requestRef=''}=useParams();
 const detail=useQuery(detailOptions(session.recovery_scope,requestRef));
 if(detail.isPending)return <Loading/>;
 if(detail.isError)return <div className="detail-page"><ErrorPanel error={detail.error} retry={()=>void refreshRequest(client,session.recovery_scope,requestRef).catch(()=>undefined)}/></div>;
 const value=detail.data;
 return <div className="detail-page"><Overview value={value}/><Handler handler={value.h5.handler}/><Materials media={value.h5.media} requestRef={requestRef}/><DetailTimeline requestRef={requestRef} progress={value.h5.public_progress} active={status.writeReady&&!detail.isFetching&&!(["completed","cancelled","notService"].includes(reportState(value)))}/>{value.safe_clarification&&<Card><CardContent><p>{value.safe_clarification}</p></CardContent></Card>}<Supplements value={value} requestRef={requestRef}/><DetailActions value={value} requestRef={requestRef}/><ManualRefresh requestRef={requestRef}/></div>;
}
