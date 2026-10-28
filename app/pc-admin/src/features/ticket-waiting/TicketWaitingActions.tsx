import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox,Form as HForm,Label as HLabel,TextArea as HTextArea} from "@heroui/react";
import {ToastFeedback,DraftStatus,DraftFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {DetailDialog} from '../../app/DetailDialog';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {WaitingAction,WaitingCommand} from '../../../../../contracts/workbench_waiting_contracts';
import {DraftError} from '../drafts/encrypted-drafts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {useWaitingDraft} from './use-waiting-draft';
import type {WaitingFence} from './use-waiting-draft';

const actions=['request-information','wait-vendor','resume'] as const;
const labels:Record<WaitingAction,string>={'request-information':'等待补充','wait-vendor':'等待厂商',resume:'恢复处理',cancel:'取消工单'};
const reasons:Record<WaitingAction,string>={'request-information':'WAITING_REPORTER','wait-vendor':'WAITING_VENDOR',resume:'RESUME',cancel:'CANCELLED_BY_STAFF'};
type State='idle'|'submitting'|'checking'|'conflict'|'succeeded'|'unknown'|'denied';
interface Job extends WaitingFence {controller:AbortController;mode:'command'|'ack'|'privacy';generation:number}
export function TicketWaitingActions({ticketId,principal,onBlockedChange,otherBlocked=false}:{ticketId:string;principal:Principal;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const [blocked,setBlocked]=useState<Record<WaitingAction,boolean>>({'request-information':false,'wait-vendor':false,resume:false,cancel:false});
  const change=useCallback((action:WaitingAction,value:boolean)=>setBlocked(previous=>previous[action]===value?previous:{...previous,[action]:value}),[]);
  const callbacks=useMemo(()=>({'request-information':(value:boolean)=>change('request-information',value),'wait-vendor':(value:boolean)=>change('wait-vendor',value),resume:(value:boolean)=>change('resume',value),cancel:(value:boolean)=>change('cancel',value)}),[change]);
  const navigationBlocked=Object.values(blocked).some(Boolean);useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  // Each purpose keeps its own recovery hook mounted after its new-write action ends.
  return <>{actions.map(action=><WaitingActionController key={action} action={action} ticketId={ticketId} principal={principal} onBlockedChange={callbacks[action]} otherBlocked={otherBlocked}/>)}</>;
}
export function TicketCancellation(props:{ticketId:string;principal:Principal;itemLabel:string;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  return <WaitingActionController {...props} action="cancel"/>;
}
function WaitingActionController({action,ticketId,principal,onBlockedChange,itemLabel='工单',otherBlocked=false}:{action:WaitingAction;ticketId:string;principal:Principal;itemLabel?:string;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<Job|null>(null),generation=useRef(0),latest=useRef(''),pendingRef=useRef<WaitingCommand|null>(null),opaqueRef=useRef<string|null>(null),storedId=useRef<string|null>(null);
  const [open,setOpen]=useState(false),[note,setNote]=useState(''),[pending,setPending]=useState<WaitingCommand|null>(null),[opaque,setOpaque]=useState<string|null>(null),[confirmed,setConfirmed]=useState(false);
  const [state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[cleanupBlocked,setCleanupBlocked]=useState(false);
  const known=useRef<{id:string;state:'COMMITTED'|'FAILED'}|null>(null);latest.current=note;pendingRef.current=pending;opaqueRef.current=opaque;
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const allowed=principal.ticket_waiting_actions_enabled&&context.data?.allowed_actions.includes(action)===true;
  const clearSensitive=()=>{
    const id=pendingRef.current?.client_command_id??opaqueRef.current??storedId.current;generation.current++;request.current?.controller.abort();request.current=null;
    latest.current='';pendingRef.current=null;opaqueRef.current=id;setNote('');setPending(null);setOpaque(id);setConfirmed(false);
    const terminal=id&&known.current?.id===id?known.current:null;setState(terminal?terminal.state==='COMMITTED'?'succeeded':'denied':id?'unknown':'idle');
    if(terminal)setCleanupBlocked(true);setMessage(id?'上次操作仍需核对。填写内容已停止展示。':'');
  };
  const draft=useWaitingDraft({ticketId,action,principal,value:note,pending,allowed,
    onRestore:copy=>{latest.current=copy.value;pendingRef.current=copy.pending;setOpen(true);setNote(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('结果未知，已恢复您上次的填写内容。请先核对上次操作。');}},
    onOperation:id=>{if(opaqueRef.current&&opaqueRef.current!==id){generation.current++;request.current?.controller.abort();request.current=null;}opaqueRef.current=id;pendingRef.current=null;setOpaque(id);setPending(null);setState(known.current?.id===id?known.current.state==='COMMITTED'?'succeeded':'denied':'unknown');setMessage('上次操作结果尚未确认。请先核对，避免重复提交。');},onSensitiveClear:clearSensitive});
  storedId.current=draft.operationId;
  const originalId=pending?.client_command_id??opaque??draft.operationId,busy=state==='submitting'||state==='checking',blocked=busy||cleanupBlocked||Boolean(originalId)||draft.restoring;
  const navigationBlocked=busy||cleanupBlocked||((Boolean(originalId)||Boolean(note))&&!draft.safeToLeave);
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.controller.abort();},[]);
  const authorizationSnapshot=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.roles]),previousAuthorization=useRef(authorizationSnapshot);
  useEffect(()=>{if(previousAuthorization.current===authorizationSnapshot)return;previousAuthorization.current=authorizationSnapshot;if(request.current)clearSensitive();},[authorizationSnapshot]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const begin=(mode:Job['mode']):Job|null=>{
    if(request.current)return null;const controller=new AbortController(),token=++generation.current,read=captureWorkbenchRead(controller.signal);
    const job:Job={controller,signal:controller.signal,mode,generation:token,requireCurrent:()=>{controller.signal.throwIfAborted();read();const session=client.getQueryData<Principal>(['session']);if(request.current!==job||generation.current!==token||session&&session.principal_id!==principal.principal_id||mode==='command'&&session&&!session.ticket_waiting_actions_enabled)throw new DOMException('WAITING_CHANGED','AbortError');}};request.current=job;return job;
  };
  const current=(job:Job)=>{try{job.requireCurrent();return true;}catch{return false;}};
  const end=(job:Job)=>{if(request.current===job)request.current=null;};
  const refresh=async()=>{void client.invalidateQueries({queryKey:['ticket-round-notifications',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['web-report',principal.principal_id,'ticket',ticketId]});await Promise.all([['ticket-command-context',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id]].map(queryKey=>client.invalidateQueries({queryKey})));};
  const freshRead=async(job:Job)=>{const fresh=await api.bootstrap(job.signal);job.requireCurrent();if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);const ticket=await api.ticketCommandContext(ticketId,job.signal);job.requireCurrent();client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],ticket);return {fresh,ticket};};
  const readDenied=(error:unknown)=>{
    if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'){clearSensitive();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');return true;}
    if(error instanceof ApiError&&[403,404].includes(error.status)){clearSensitive();void clearTicketAuthorization(client,principal.principal_id,ticketId,error);return true;}return false;
  };
  const applyKnown=(id:string,outcome:'COMMITTED'|'FAILED',snapshot:string|null,cleaned:boolean)=>{
    known.current={id,state:outcome};pendingRef.current=null;opaqueRef.current=cleaned?null:id;setPending(null);setOpaque(cleaned?null:id);setCleanupBlocked(!cleaned);
    if(outcome==='COMMITTED'&&snapshot!==null&&latest.current===snapshot){latest.current='';setNote('');setConfirmed(false);setOpen(false);}
    setState(outcome==='COMMITTED'?'succeeded':'denied');setMessage((outcome==='COMMITTED'?'原操作已核对为提交，正在读取工单信息。':'原操作已明确失败，输入保留，请核对工单信息后明确新的操作。')+(cleaned?'':' 恢复标记清理尚未确认，禁止新提交，可继续只读核对。'));
  };
  const submit=async()=>{
    if(!allowed||blocked||otherBlocked||!draft.canSubmit||!note.trim()||note.length>2000||!context.data||(context.isPending||context.isError)||action==='cancel'&&!confirmed)return;
    if(!workbenchTransportWritable()){setMessage('连接仍在核对工单信息，输入已保留。');return;}
    const command:WaitingCommand=Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:reasons[action],note:note.trim(),external_visible:false}),snapshot=note,job=begin('command');if(!job)return;
    setState('submitting');setMessage('正在提交'+labels[action]+'操作…');let sent=false,committed=false,readConfirmed=false;
    try{
      const {fresh,ticket}=await freshRead(job);job.requireCurrent();readConfirmed=true;if(!fresh.ticket_waiting_actions_enabled)throw new DraftError('DRAFT_DISABLED');if(!ticket.allowed_actions.includes(action))throw new ApiError(403,'P2_016_FORBIDDEN');if(ticket.version!==command.expected_version)throw new ApiError(409,'P2_016_VERSION_CONFLICT');
      if(!workbenchTransportWritable())throw new DraftError('WORKBENCH_TRANSPORT_NOT_WRITABLE');await draft.prepare(command,job);job.requireCurrent();setPending(command);pendingRef.current=command;sent=true;
      await api.waitingAction(ticketId,action,command,fresh.csrf_token,job.signal);job.requireCurrent();committed=true;known.current={id:command.client_command_id,state:'COMMITTED'};
      const cleaned=await draft.settle(command.client_command_id,job);job.requireCurrent();applyKnown(command.client_command_id,'COMMITTED',snapshot,cleaned);setMessage(cleaned?'已提交，正在更新工单。':'已提交，本地恢复标记尚未清理，禁止新提交。');await refresh();job.requireCurrent();if(cleaned)setMessage(action==='request-information'?'已记录等待补充。':action==='resume'?'已恢复处理。':action==='cancel'?'工单已取消。':'已记录等待厂商。');
    }catch(error){
      if(!current(job))return;
      if(committed){setCleanupBlocked(true);opaqueRef.current=command.client_command_id;setOpaque(command.client_command_id);setState('succeeded');setMessage('原操作已提交，工单信息或本地清理尚待重新核对。');}
      else if(error instanceof ApiError||!sent){
        if((!readConfirmed||error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')&&readDenied(error))return;
        let cleaned=true;if(sent){known.current={id:command.client_command_id,state:'FAILED'};try{cleaned=await draft.settle(command.client_command_id,job);job.requireCurrent();}catch{if(!current(job))return;cleaned=false;}applyKnown(command.client_command_id,'FAILED',snapshot,cleaned);}else{pendingRef.current=null;setPending(null);}
        setState(error instanceof ApiError&&error.status===409?'conflict':'denied');setMessage(error instanceof ApiError&&error.status===409?'版本冲突：原因已保留，请读取当前版本后明确新的操作。':errorMessage(error));await refresh();
      }else{pendingRef.current=command;setPending(command);setState('unknown');setMessage('结果未知，您的填写内容已保留。请先核对上次操作。');}
    }finally{end(job);}
  };
  const check=async()=>{
    const id=pendingRef.current?.client_command_id??opaqueRef.current??draft.operationId;if(!id||request.current||draft.restoring)return;const snapshot=pendingRef.current?latest.current:null,job=begin('ack');if(!job)return;setState('checking');
    try{await freshRead(job);job.requireCurrent();const result=await api.waitingAcknowledgement(ticketId,action,id,job.signal);job.requireCurrent();if(result.state==='UNKNOWN'){setState('unknown');setMessage('提交结果尚未确认；请先核对上次操作。');return;}known.current={id,state:result.state};const cleaned=await draft.settle(id,job);job.requireCurrent();applyKnown(id,result.state,snapshot,cleaned);await refresh();job.requireCurrent();}
    catch(error){if(!current(job))return;if(readDenied(error))return;const terminal=known.current?.id===id?known.current:null;if(terminal)setCleanupBlocked(true);setState(terminal?terminal.state==='COMMITTED'?'succeeded':'denied':'unknown');setMessage(terminal?'原操作终态已确认，本地清理或工单信息仍须重读；未发送新的操作。':'只读核对暂未完成，未重复提交。');}finally{end(job);}
  };
  const discard=async()=>{if(request.current||busy)return;const copy={value:latest.current,pending:pendingRef.current},job=begin('privacy');if(!job)return;try{await freshRead(job);job.requireCurrent();const cleaned=await draft.dropSensitive(copy,job);if(!cleaned){setCleanupBlocked(true);setMessage('存在不同恢复修订，未删除其内容；当前输入保留。');}}catch(error){if(current(job)&&!readDenied(error))setMessage('敏感副本清理暂未确认，当前输入保留。');}finally{end(job);}};
  if(!allowed&&!originalId&&!note&&!busy&&!draft.restoring&&!message)return null;
  const noteLabel=action==='cancel'?'取消原因':action==='resume'?'恢复原因':'等待原因';
  const form=(allowed||note||originalId)?<HForm aria-label={labels[action]} onSubmit={event=>{event.preventDefault();void submit();}}><HLabel>{noteLabel}<HTextArea aria-label={noteLabel} maxLength={2000} value={note} disabled={blocked||!allowed} onChange={event=>setNote(event.target.value)}/></HLabel><p>{action==='cancel'?'取消原因仅作内部记录，请先核实当前工单。':action==='resume'?'记录已收到的信息或恢复处理的原因；仍由当前处理人继续本轮。':action==='request-information'?'请另行联系报修人，说明需要补充什么。此处仅记录内部等待原因，不会自动发送。':'记录厂商待办及联系情况；保留当前处理人和处理轮次。'}</p>{action==='cancel'?<HCheckbox aria-label="确认取消当前工单" isSelected={confirmed} isDisabled={blocked||!allowed} onChange={event=>setConfirmed(event)}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control>我已核对当前工单并确认取消</HCheckbox.Content></HCheckbox>:null}<div className="note-controls"><HButton type="button" isDisabled={busy} onClick={()=>setOpen(false)} variant="secondary">{action==='cancel'?'暂不取消':'关闭表单'}</HButton>
    <HButton type="submit" className={action==='cancel'?'danger-action':undefined} isDisabled={blocked||otherBlocked||!allowed||!draft.canSubmit||!note.trim()||note.length>2000||(context.isPending||context.isError)||action==='cancel'&&!confirmed} variant="secondary">{action==='cancel'?'确认取消工单':action==='resume'?'确认恢复':'确认等待'}</HButton></div></HForm>:null;
  const recovery=<>
    {draft.enabled?<DraftStatus notify={false} data-waiting-draft-status role="status">{draft.message}</DraftStatus>:null}
    {originalId&&!busy?<HButton type="button" data-action={'check-'+action+'-command'} isDisabled={draft.restoring} onClick={()=>{void check();}} variant="secondary">核对上次操作</HButton>:null}
    {note&&!busy?<HButton type="button" data-action={'discard-'+action+'-draft'} onClick={()=>{void discard();}} variant="secondary">清空填写内容</HButton>:null}

  </>;
  return <section className={'ticket-notes ticket-waiting-actions'+(action==='cancel'?' detail-action-controller detail-cancel-controller':'')} data-waiting-purpose={action} aria-label={labels[action]}>
    {action==='cancel'?<>
      {allowed||originalId||note?<HButton type="button" data-action="cancel" className="cancel-ticket-trigger" isDisabled={busy||otherBlocked&&!originalId} onClick={()=>setOpen(true)} variant="secondary">{originalId?'核对取消':'取消工单'}</HButton>:null}
      <DetailDialog open={open} onClose={()=>setOpen(false)} closeBlocked={busy} title="取消工单" closeLabel="关闭取消窗口" className="detail-action-dialog detail-cancel-dialog">
        <p className="detail-operation-context">{itemLabel}</p>{form}{recovery}
      </DetailDialog>

    </>:<>
      {allowed?<HButton type="button" data-action={action} isDisabled={blocked||otherBlocked} onClick={()=>setOpen(true)} variant="secondary">{labels[action]}</HButton>:null}
      {open?form:null}{recovery}
    </>}
    <DraftFeedback enabled={draft.enabled}>{draft.message}</DraftFeedback>
    {message?<ToastFeedback revision={messageRevision} source={'ticket-waiting-'+action} state={state} className="ticket-waiting-state" role="status">{message}</ToastFeedback>:null}
  </section>;
}
