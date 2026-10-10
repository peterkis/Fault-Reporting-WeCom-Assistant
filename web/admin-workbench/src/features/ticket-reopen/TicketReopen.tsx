import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,captureWorkbenchRead,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016ReopenCommand} from '../../api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {DraftError,subscribeDrafts} from '../drafts/encrypted-drafts';
import {useReopenDraft} from './use-reopen-draft';

type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketReopen({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
 const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0),settling=useRef(false);
 const [reason,setReason]=useState(''),[pending,setPending]=useState<P2016ReopenCommand|null>(null),[opaque,setOpaque]=useState<string|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState('');
 const clear=()=>{generation.current++;request.current?.abort();request.current=null;setReason('');setPending(null);setOpaque(null);setState('idle');setMessage('');};
 const draft=useReopenDraft({ticketId,principal,reason,pending,
  onRestore:copy=>{setReason(copy.value);setPending(copy.pending);if(copy.pending){setOpaque(copy.pending.client_command_id);setState('unknown');setMessage('已恢复原操作；结果仍未知，请只读核对，不会再次发送。');}},
  onOperation:id=>{if(!settling.current){setOpaque(id);setState('unknown');setMessage('原操作仍未知，请只读核对；敏感内容不可用不代表操作失败。');}},
  onSensitiveClear:()=>{if(!settling.current){setReason('');setPending(null);}},
 });
 const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal),enabled:principal.ticket_reopen_rounds_enabled||draft.enabled});
 const commandId=opaque??pending?.client_command_id??draft.operationId;
 const blocked=state==='submitting'||state==='checking'||state==='unknown'||Boolean(commandId),navigationBlocked=blocked||Boolean(reason)&&!draft.safeToLeave;
 useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{
  if(!draft.enabled&&!principal.ticket_reopen_rounds_enabled)return;
  try{return subscribeDrafts(event=>{if(event.principal===principal.principal_id&&['logout','logout-unknown','revoked'].includes(event.reason)&&(event.kind===undefined||event.kind==='ticket'&&(event.id===undefined||event.id===ticketId))&&(event.purpose===undefined||event.purpose==='staff-reopen'))clear();});}
  // The shared hook owns the visible storage failure and its new-submit fence.
  catch(error){if(!(error instanceof DraftError&&error.message==='DRAFT_STORAGE_UNAVAILABLE'))throw error;}
 },[draft.enabled,principal.ticket_reopen_rounds_enabled,principal.principal_id,ticketId]);
 useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
 const refresh=()=>{void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
 const deny=async(error:ApiError)=>{if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else await clearTicketAuthorization(client,principal.principal_id,ticketId,error);};
 async function settle(id:string){settling.current=true;try{return await draft.success(id);}finally{settling.current=false;}}
 async function send(command:P2016ReopenCommand){
  if(request.current||!workbenchTransportWritable()||!draft.canSubmit)return;const controller=new AbortController(),token=++generation.current,currentRead=captureWorkbenchRead(controller.signal);request.current=controller;setPending(command);setState('submitting');setMessage('正在提交重开操作…');let dispatched=false,postAccepted=false;
  const current=()=>{if(generation.current!==token||controller.signal.aborted)return false;try{currentRead();return true;}catch{return false;}};
  try{
   await draft.prepare(command);if(!current())return;dispatched=true;
   const result=await api.reopenTicket(ticketId,command,principal.csrf_token,controller.signal);postAccepted=true;if(!current())return;
   const fresh=await api.ticketCommandContext(ticketId,controller.signal);if(!current())return;
   if(fresh.version<result.ticket_version||fresh.handling_cycle?.id!==result.handling_cycle.id)throw Error('REOPEN_CURRENT_FACTS_UNCONFIRMED');
   client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],fresh);
   const cleaned=await settle(command.client_command_id);if(!current())return;
   setReason('');setPending(null);setOpaque(cleaned?null:command.client_command_id);setState(cleaned?'succeeded':'unknown');setMessage((fresh.handling_cycle.first_responsibility_event_id===null?'已重开，本轮等待重新承接。':'已重开，当前新轮次已有后续处理。')+(cleaned?'':' 恢复清理尚未确认，请只读核对原操作。'));refresh();
  }catch(error){
   if(!current())return;
   if(dispatched&&error instanceof ApiError&&[401,403,404].includes(error.status))await deny(error);
   else if(dispatched&&!postAccepted&&error instanceof ApiError){await draft.knownFailure(command.client_command_id).catch(()=>{});if(!current())return;setPending(null);setOpaque(null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'工单版本或状态已变化，请重新读取后确认新的操作。':'操作被拒绝：'+errorMessage(error));if(error.status===409)refresh();}
   else{setOpaque(command.client_command_id);setState('unknown');setMessage(dispatched?'结果未知：保留原操作，不会再次发送。请只读核对。':'尚未发送：恢复副本未确认，不能发起新操作，请保留原 UUID 只读核对。');}
  }finally{if(generation.current===token)request.current=null;}
 }
 async function checkOriginal(){
  if(request.current||!commandId)return;const id=commandId,command=pending,controller=new AbortController(),token=++generation.current,currentRead=captureWorkbenchRead(controller.signal);request.current=controller;setState('checking');setMessage('正在只读核对原重开操作…');
  const current=()=>{if(generation.current!==token||controller.signal.aborted)return false;try{currentRead();return true;}catch{return false;}};
  try{
   const receipt=await api.reopenReceipt(ticketId,id,controller.signal);if(!current())return;
   if(receipt.state==='UNKNOWN'){setState('unknown');setMessage('结果未知：保留原操作，尚无可确认的终态，不会再次发送。');return;}
   const fresh=await api.ticketCommandContext(ticketId,controller.signal);if(!current())return;client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],fresh);
   if(receipt.state==='COMMITTED'&&(command&&receipt.result.ticket_version!==command.expected_version+1||fresh.version<receipt.result.ticket_version||fresh.handling_cycle?.id!==receipt.result.handling_cycle.id))throw Error('REOPEN_CURRENT_FACTS_UNCONFIRMED');
   const cleaned=await settle(id);if(!current())return;setReason('');setPending(null);setOpaque(cleaned?null:id);
   if(!cleaned){setState('unknown');setMessage('已读到原操作终态，但恢复清理尚未确认；只读核对同一 UUID，不发起新操作。');return;}
   setState(receipt.state==='FAILED'?'denied':'succeeded');setMessage(receipt.state==='FAILED'?'已核对原操作被拒绝；已读取当前权限与版本，请明确发起新的操作。':fresh.handling_cycle?.first_responsibility_event_id===null?'已核对：原操作已重开，本轮等待重新承接。':'已核对：原操作已重开，当前轮次已有后续处理。');refresh();
  }catch(error){if(!current())return;if(error instanceof ApiError&&[401,403,404].includes(error.status))await deny(error);else{setState('unknown');setMessage('结果未知：只读核对尚未完成，保留原操作，不会再次发送。');}}
  finally{if(generation.current===token)request.current=null;}
 }
 const allowed=principal.ticket_reopen_rounds_enabled&&context.data?.allowed_actions.includes('reopen')===true,loading=context.isPending||draft.status==='loading'||draft.probing;
 if(!principal.ticket_reopen_rounds_enabled&&!commandId&&!draft.enabled)return null;
 return <section className="ticket-notes ticket-reopen" aria-label="工作人员重开工单">
  <h3>重开同一工单</h3>
  {loading?<p role="status">正在读取重开权限与版本…</p>:context.isError?<p role="alert">{errorMessage(context.error)}</p>:context.data?<p>工单版本 {context.data.version}</p>:null}
  {principal.ticket_reopen_rounds_enabled&&!context.isFetching&&!context.isError&&context.data?.reopen_follow_up?<p data-reopen-follow-up role="status">{context.data.reopen_follow_up.is_previous_handler?'上轮由您处理，':'原处理组保留，'}{context.data.reopen_follow_up.origin==='WEB_REPORTER'?'报修人反馈仍未解决；':'工作人员已重开同一工单；'}等待重新承接。</p>:null}
  {allowed?<form onSubmit={event=>{event.preventDefault();if(blocked||loading||context.isFetching||!draft.canSubmit||!context.data||!reason.trim()||reason.trim().length>2000)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'STAFF_REOPEN',note:reason.trim()}));}}>
   <label htmlFor="reopen-reason">重开原因</label><p>请核实同一故障仍需处理。原因仅供获权工作人员协作。</p>
   <textarea id="reopen-reason" maxLength={2000} disabled={blocked||loading} value={reason} onChange={event=>setReason(event.target.value)}/>
   <p>重开后保留原处理组，清除当前处理人，等待重新承接。</p>
   <button type="submit" data-action="reopen-ticket" disabled={blocked||loading||context.isFetching||!draft.canSubmit||!reason.trim()}>重开此工单</button>
  </form>:<p>当前没有重开此工单的权限。</p>}
  {commandId?<button type="button" data-action="check-reopen-command" disabled={state==='checking'||state==='submitting'||loading||context.isError} onClick={()=>void checkOriginal()}>只读核对原重开操作</button>:null}
  {draft.enabled?<p data-reopen-draft-status role="status">{draft.message}</p>:null}
  {reason&&!commandId&&draft.enabled?<button type="button" disabled={state==='submitting'||state==='checking'} onClick={()=>void draft.discard()}>清空恢复草稿</button>:null}
  {!blocked?<button type="button" onClick={()=>{void context.refetch();}}>重新读取重开权限</button>:null}
  {state!=='idle'?<p data-reopen-state role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</p>:null}
 </section>;
}
