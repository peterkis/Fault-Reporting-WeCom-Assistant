import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {WaitingCommand} from '../../../../../contracts/workbench_waiting_contracts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError} from '../drafts/encrypted-drafts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function decode(text:string){
  const input:unknown=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))throw new DraftError('DRAFT_CORRUPT');
  const value=input as Record<string,unknown>;
  if(Object.keys(value).length!==3||value.schema!==1||typeof value.note!=='string'||value.note.length>2000)throw new DraftError('DRAFT_CORRUPT');
  let pending:WaitingCommand|null=null;
  if(value.pending!==null){
    if(!value.pending||typeof value.pending!=='object'||Array.isArray(value.pending))throw new DraftError('DRAFT_CORRUPT');
    const command=value.pending as Record<string,unknown>;
    if(Object.keys(command).length!==5||typeof command.client_command_id!=='string'||!UUID.test(command.client_command_id)||typeof command.expected_version!=='number'||!Number.isSafeInteger(command.expected_version)||command.expected_version<1||command.expected_version>2147483647||typeof command.reason_code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(command.reason_code)||typeof command.note!=='string'||!command.note.trim()||command.note.length>2000||command.external_visible!==false)throw new DraftError('DRAFT_CORRUPT');
    pending=Object.freeze({client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:command.reason_code,note:command.note,external_visible:false});
  }
  return {value:value.note,pending};
}

export function TicketWaitingActions({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0),latestNote=useRef('');
  const [open,setOpen]=useState(false),[note,setNote]=useState(''),[pending,setPending]=useState<WaitingCommand|null>(null),[opaque,setOpaque]=useState<string|null>(null);
  const [state,setState]=useState<'idle'|'submitting'|'conflict'|'succeeded'|'unknown'|'denied'>('idle'),[message,setMessage]=useState(''),[cleanupBlocked,setCleanupBlocked]=useState(false);latestNote.current=note;
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const enabled=principal.ticket_waiting_action_draft_recovery_enabled,allowed=principal.ticket_waiting_actions_enabled&&context.data?.allowed_actions.includes('request-information')===true;
  const clear=()=>{generation.current++;request.current?.abort();request.current=null;setNote('');setPending(null);setState('idle');};
  const draft=useAuthorizedDraft<string,WaitingCommand>({
    scope:{principal:principal.principal_id,kind:'ticket',id:ticketId,purpose:'waiting-requester'},enabled,writeEnabled:enabled&&allowed,value:note,pending,emptyValue:'',hasInput:value=>Boolean(value),serialise:copy=>JSON.stringify({schema:1,note:copy.value,pending:copy.pending}),decode,commandId:command=>command.client_command_id,
    authorize:async signal=>{const current=captureWorkbenchRead(signal),fresh=await api.bootstrap(signal);current();if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);const ticket=await api.ticketCommandContext(ticketId,signal);current();client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],ticket);return fresh.ticket_waiting_action_draft_recovery_enabled&&fresh.ticket_waiting_actions_enabled&&ticket.allowed_actions.includes('request-information');},
    onAuthorityFailure:error=>{if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'){clear();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');}else if(error instanceof ApiError&&[403,404].includes(error.status)){clear();void clearTicketAuthorization(client,principal.principal_id,ticketId,error);}},
    onRestore:copy=>{setOpen(true);setNote(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('原操作仍未知，原正文、UUID和版本已保留；只能只读核对。');}},onOperation:id=>{setOpaque(id);setState('unknown');setMessage('原操作 '+id+' 仍未知，不能生成新的提交。');},onSensitiveClear:clear,
  });
  const busy=state==='submitting',blocked=busy||cleanupBlocked||state==='unknown'||Boolean(pending||opaque);
  const navigationBlocked=busy||((blocked||Boolean(note))&&!draft.safeToLeave);
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refresh=async()=>{await Promise.all([['ticket-command-context',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id]].map(queryKey=>client.invalidateQueries({queryKey})));};
  const submit=async()=>{
    if(request.current||!allowed||blocked||!draft.canSubmit||!note.trim()||note.length>2000||!context.data)return;
    if(!workbenchTransportWritable()){setMessage('连接仍在核对当前事实，输入已保留。');return;}
    const command:WaitingCommand=Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WAITING_REPORTER',note:note.trim(),external_visible:false});
    const controller=new AbortController(),token=++generation.current,current=captureWorkbenchRead(controller.signal),snapshot=note;
    const requireCurrent=()=>{current();if(generation.current!==token||request.current!==controller)throw new DOMException('WAITING_CHANGED','AbortError');};
    request.current=controller;setState('submitting');setMessage('正在提交等待报修人操作…');let sent=false,known=false;
    try{
      const fresh=await api.bootstrap(controller.signal);requireCurrent();if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      if(!fresh.ticket_waiting_actions_enabled)throw new DraftError('DRAFT_DISABLED');
      const ticket=await api.ticketCommandContext(ticketId,controller.signal);requireCurrent();client.setQueryData(['session'],fresh);client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],ticket);
      if(!ticket.allowed_actions.includes('request-information'))throw new ApiError(403,'P2_016_FORBIDDEN');if(ticket.version!==command.expected_version)throw new ApiError(409,'P2_016_VERSION_CONFLICT');
      await draft.prepare(command);requireCurrent();setPending(command);sent=true;
      await api.waitForReporter(ticketId,command,fresh.csrf_token,controller.signal);requireCurrent();known=true;setState('succeeded');setCleanupBlocked(true);
      const cleaned=await draft.success(command.client_command_id,true);requireCurrent();setCleanupBlocked(!cleaned);setPending(null);setOpaque(null);if(latestNote.current===snapshot)setNote('');setMessage(cleaned?'已等待报修人，正在读取当前工单事实。':'已提交，但本地恢复标记清理未完成，暂不允许新提交。');await refresh();requireCurrent();
    }catch(error){
      try{requireCurrent();}catch{return;}
      if(known){setState('succeeded');setMessage('原操作已提交，当前事实或本地清理尚待重新核对。');}
      else if(error instanceof ApiError||!sent){if(sent){const cleaned=await draft.success(command.client_command_id,true);requireCurrent();setCleanupBlocked(!cleaned);}setPending(null);setState(error instanceof ApiError&&error.status===409?'conflict':'denied');setMessage(error instanceof ApiError&&error.status===409?'版本冲突：原因已保留，请读取当前版本后明确新的操作。':errorMessage(error));await refresh();}
      else{setPending(command);setState('unknown');setMessage('结果未知，原正文、UUID和版本保持；不能自动重新提交。');}
    }finally{if(request.current===controller)request.current=null;}
  };
  if(!principal.ticket_waiting_actions_enabled&&!pending&&!opaque&&!note)return null;
  return <section className="ticket-notes ticket-waiting-actions" aria-label="等待与恢复">
    {allowed?<button type="button" data-action="request-information" disabled={blocked} onClick={()=>setOpen(true)}>等待报修人</button>:null}
    {open&&(allowed||note||pending||opaque)?<form aria-label="等待报修人" onSubmit={event=>{event.preventDefault();void submit();}}>
      <label>等待原因<textarea aria-label="等待原因" maxLength={2000} value={note} disabled={blocked||!allowed} onChange={event=>setNote(event.target.value)}/></label>
      <p>仅记录内部等待原因，保留当前处理与沟通责任及本轮。</p>
      {draft.enabled?<p role="status">{draft.message}</p>:null}
      <button type="submit" disabled={blocked||!allowed||!draft.canSubmit||!note.trim()||note.length>2000||context.isFetching}>确认等待</button>
      <button type="button" disabled={blocked} onClick={()=>{setOpen(false);}}>关闭表单</button>
    </form>:null}
    {message?<p className="ticket-waiting-state" role="status">{message}</p>:null}
  </section>;
}
