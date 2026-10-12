import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {WaitingAction,WaitingCommand} from '../../../../../contracts/workbench_waiting_contracts';
import {DraftError} from '../drafts/encrypted-drafts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {useWaitingDraft} from './use-waiting-draft';
import type {WaitingFence} from './use-waiting-draft';

const actions=['request-information','wait-vendor','resume','cancel'] as const;
const labels:Record<WaitingAction,string>={'request-information':'等待报修人','wait-vendor':'等待厂商',resume:'恢复处理',cancel:'取消工单'};
const reasons:Record<WaitingAction,string>={'request-information':'WAITING_REPORTER','wait-vendor':'WAITING_VENDOR',resume:'RESUME',cancel:'CANCELLED_BY_STAFF'};
type State='idle'|'submitting'|'checking'|'conflict'|'succeeded'|'unknown'|'denied';
interface Job extends WaitingFence {controller:AbortController;mode:'command'|'ack'|'privacy';generation:number}
export function TicketWaitingActions({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const [blocked,setBlocked]=useState<Record<WaitingAction,boolean>>({'request-information':false,'wait-vendor':false,resume:false,cancel:false});
  const change=useCallback((action:WaitingAction,value:boolean)=>setBlocked(previous=>previous[action]===value?previous:{...previous,[action]:value}),[]);
  const callbacks=useMemo(()=>({'request-information':(value:boolean)=>change('request-information',value),'wait-vendor':(value:boolean)=>change('wait-vendor',value),resume:(value:boolean)=>change('resume',value),cancel:(value:boolean)=>change('cancel',value)}),[change]);
  const navigationBlocked=Object.values(blocked).some(Boolean);useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  // Each purpose keeps its own recovery hook mounted after its new-write action ends.
  return <>{actions.map(action=><WaitingActionController key={action} action={action} ticketId={ticketId} principal={principal} onBlockedChange={callbacks[action]}/>)}</>;
}
function WaitingActionController({action,ticketId,principal,onBlockedChange}:{action:WaitingAction;ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<Job|null>(null),generation=useRef(0),latest=useRef(''),pendingRef=useRef<WaitingCommand|null>(null),opaqueRef=useRef<string|null>(null),storedId=useRef<string|null>(null);
  const [open,setOpen]=useState(false),[note,setNote]=useState(''),[pending,setPending]=useState<WaitingCommand|null>(null),[opaque,setOpaque]=useState<string|null>(null),[confirmed,setConfirmed]=useState(false);
  const [state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[cleanupBlocked,setCleanupBlocked]=useState(false);
  const known=useRef<{id:string;state:'COMMITTED'|'FAILED'}|null>(null);latest.current=note;pendingRef.current=pending;opaqueRef.current=opaque;
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const allowed=principal.ticket_waiting_actions_enabled&&context.data?.allowed_actions.includes(action)===true;
  const clearSensitive=()=>{
    const id=pendingRef.current?.client_command_id??opaqueRef.current??storedId.current;generation.current++;request.current?.controller.abort();request.current=null;
    latest.current='';pendingRef.current=null;opaqueRef.current=id;setNote('');setPending(null);setOpaque(id);setConfirmed(false);
    const terminal=id&&known.current?.id===id?known.current:null;setState(terminal?terminal.state==='COMMITTED'?'succeeded':'denied':id?'unknown':'idle');
    if(terminal)setCleanupBlocked(true);setMessage(id?'原操作 '+id+' 仍须只读核对；敏感内容已停止展示。':'');
  };
  const draft=useWaitingDraft({ticketId,action,principal,value:note,pending,allowed,
    onRestore:copy=>{latest.current=copy.value;pendingRef.current=copy.pending;setOpen(true);setNote(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('结果未知，原正文、UUID和版本已恢复；只能只读核对。');}},
    onOperation:id=>{if(opaqueRef.current&&opaqueRef.current!==id){generation.current++;request.current?.controller.abort();request.current=null;}opaqueRef.current=id;pendingRef.current=null;setOpaque(id);setPending(null);setState(known.current?.id===id?known.current.state==='COMMITTED'?'succeeded':'denied':'unknown');setMessage('原操作 '+id+' 仍须只读核对，不能生成新的提交。');},onSensitiveClear:clearSensitive});
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
  const refresh=async()=>{await Promise.all([['ticket-command-context',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id]].map(queryKey=>client.invalidateQueries({queryKey})));};
  const freshRead=async(job:Job)=>{const fresh=await api.bootstrap(job.signal);job.requireCurrent();if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);const ticket=await api.ticketCommandContext(ticketId,job.signal);job.requireCurrent();client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],ticket);return {fresh,ticket};};
  const readDenied=(error:unknown)=>{
    if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'){clearSensitive();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');return true;}
    if(error instanceof ApiError&&[403,404].includes(error.status)){clearSensitive();void clearTicketAuthorization(client,principal.principal_id,ticketId,error);return true;}return false;
  };
  const applyKnown=(id:string,outcome:'COMMITTED'|'FAILED',snapshot:string|null,cleaned:boolean)=>{
    known.current={id,state:outcome};pendingRef.current=null;opaqueRef.current=cleaned?null:id;setPending(null);setOpaque(cleaned?null:id);setCleanupBlocked(!cleaned);
    if(outcome==='COMMITTED'&&snapshot!==null&&latest.current===snapshot){latest.current='';setNote('');setConfirmed(false);}
    setState(outcome==='COMMITTED'?'succeeded':'denied');setMessage((outcome==='COMMITTED'?'原操作已核对为提交，正在读取当前工单事实。':'原操作已明确失败，输入保留，请核对当前事实后明确新的操作。')+(cleaned?'':' 恢复标记清理尚未确认，禁止新提交，可继续只读核对。'));
  };
  const submit=async()=>{
    if(!allowed||blocked||!draft.canSubmit||!note.trim()||note.length>2000||!context.data||context.isFetching||action==='cancel'&&!confirmed)return;
    if(!workbenchTransportWritable()){setMessage('连接仍在核对当前事实，输入已保留。');return;}
    const command:WaitingCommand=Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:reasons[action],note:note.trim(),external_visible:false}),snapshot=note,job=begin('command');if(!job)return;
    setState('submitting');setMessage('正在提交'+labels[action]+'操作…');let sent=false,committed=false,readConfirmed=false;
    try{
      const {fresh,ticket}=await freshRead(job);job.requireCurrent();readConfirmed=true;if(!fresh.ticket_waiting_actions_enabled)throw new DraftError('DRAFT_DISABLED');if(!ticket.allowed_actions.includes(action))throw new ApiError(403,'P2_016_FORBIDDEN');if(ticket.version!==command.expected_version)throw new ApiError(409,'P2_016_VERSION_CONFLICT');
      if(!workbenchTransportWritable())throw new DraftError('WORKBENCH_TRANSPORT_NOT_WRITABLE');await draft.prepare(command,job);job.requireCurrent();setPending(command);pendingRef.current=command;sent=true;
      await api.waitingAction(ticketId,action,command,fresh.csrf_token,job.signal);job.requireCurrent();committed=true;known.current={id:command.client_command_id,state:'COMMITTED'};
      const cleaned=await draft.settle(command.client_command_id,job);job.requireCurrent();applyKnown(command.client_command_id,'COMMITTED',snapshot,cleaned);setMessage(cleaned?'已'+labels[action]+'，正在读取当前工单事实。':'已提交，本地恢复标记尚未清理，禁止新提交。');await refresh();job.requireCurrent();
    }catch(error){
      if(!current(job))return;
      if(committed){setCleanupBlocked(true);opaqueRef.current=command.client_command_id;setOpaque(command.client_command_id);setState('succeeded');setMessage('原操作已提交，当前事实或本地清理尚待重新核对。');}
      else if(error instanceof ApiError||!sent){
        if((!readConfirmed||error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')&&readDenied(error))return;
        let cleaned=true;if(sent){known.current={id:command.client_command_id,state:'FAILED'};try{cleaned=await draft.settle(command.client_command_id,job);job.requireCurrent();}catch{if(!current(job))return;cleaned=false;}applyKnown(command.client_command_id,'FAILED',snapshot,cleaned);}else{pendingRef.current=null;setPending(null);}
        setState(error instanceof ApiError&&error.status===409?'conflict':'denied');setMessage(error instanceof ApiError&&error.status===409?'版本冲突：原因已保留，请读取当前版本后明确新的操作。':errorMessage(error));await refresh();
      }else{pendingRef.current=command;setPending(command);setState('unknown');setMessage('结果未知，原正文、UUID和版本保持；不能自动重新提交。');}
    }finally{end(job);}
  };
  const check=async()=>{
    const id=pendingRef.current?.client_command_id??opaqueRef.current??draft.operationId;if(!id||request.current||draft.restoring)return;const snapshot=pendingRef.current?latest.current:null,job=begin('ack');if(!job)return;setState('checking');
    try{await freshRead(job);job.requireCurrent();const result=await api.waitingAcknowledgement(ticketId,action,id,job.signal);job.requireCurrent();if(result.state==='UNKNOWN'){setState('unknown');setMessage('没有终态回执不代表未提交；原 UUID 仍须只读核对。');return;}known.current={id,state:result.state};const cleaned=await draft.settle(id,job);job.requireCurrent();applyKnown(id,result.state,snapshot,cleaned);await refresh();job.requireCurrent();}
    catch(error){if(!current(job))return;if(readDenied(error))return;const terminal=known.current?.id===id?known.current:null;if(terminal)setCleanupBlocked(true);setState(terminal?terminal.state==='COMMITTED'?'succeeded':'denied':'unknown');setMessage(terminal?'原操作终态已确认，本地清理或当前事实仍须重读；未发送新的操作。':'只读核对暂未完成，原 UUID 保留；未发送新的操作。');}finally{end(job);}
  };
  const discard=async()=>{if(request.current||busy)return;const copy={value:latest.current,pending:pendingRef.current},job=begin('privacy');if(!job)return;try{await freshRead(job);job.requireCurrent();const cleaned=await draft.dropSensitive(copy,job);if(!cleaned){setCleanupBlocked(true);setMessage('存在不同恢复修订，未删除其内容；当前输入保留。');}}catch(error){if(current(job)&&!readDenied(error))setMessage('敏感副本清理暂未确认，当前输入保留。');}finally{end(job);}};
  if(!allowed&&!originalId&&!note&&!busy&&!draft.restoring)return null;
  return <section className="ticket-notes ticket-waiting-actions" data-waiting-purpose={action} aria-label={labels[action]}>
    {allowed?<button type="button" data-action={action} disabled={blocked} onClick={()=>setOpen(true)}>{labels[action]}</button>:null}
    {open&&(allowed||note||originalId)?<form aria-label={labels[action]} onSubmit={event=>{event.preventDefault();void submit();}}>
      <label>{action==='cancel'?'取消原因':'等待原因'}<textarea aria-label={action==='cancel'?'取消原因':'等待原因'} maxLength={2000} value={note} disabled={blocked||!allowed} onChange={event=>setNote(event.target.value)}/></label>
      <p>{action==='cancel'?'仅取消当前合法状态的工单，内部原因留档；与撤派、退回和完工分别操作。':'仅记录内部原因，保留当前处理与沟通责任及本轮。'}</p>
      {action==='cancel'?<label><input type="checkbox" aria-label="确认取消当前工单" checked={confirmed} disabled={blocked||!allowed} onChange={event=>setConfirmed(event.target.checked)}/>我已核对当前工单并确认取消</label>:null}
      <button type="submit" disabled={blocked||!allowed||!draft.canSubmit||!note.trim()||note.length>2000||context.isFetching||action==='cancel'&&!confirmed}>{action==='cancel'?'确认取消工单':action==='resume'?'确认恢复':'确认等待'}</button>
      <button type="button" disabled={busy} onClick={()=>setOpen(false)}>关闭表单</button>
    </form>:null}
    {draft.enabled?<p role="status">{draft.message}</p>:null}
    {originalId&&!busy?<button type="button" data-action={'check-'+action+'-command'} disabled={draft.restoring} onClick={()=>{void check();}}>只读核对原操作</button>:null}
    {note&&!busy?<button type="button" data-action={'discard-'+action+'-draft'} onClick={()=>{void discard();}}>清除敏感填写内容</button>:null}
    {message?<p className="ticket-waiting-state" role="status">{message}</p>:null}
  </section>;
}
