import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,captureWorkbenchRead,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016ReopenCommand} from '../../api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {subscribeDrafts} from '../drafts/encrypted-drafts';

type State='idle'|'submitting'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketReopen({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
 const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
 const [reason,setReason]=useState(''),[pending,setPending]=useState<P2016ReopenCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState('');
 const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
 const blocked=state==='submitting'||state==='unknown',navigationBlocked=blocked||Boolean(reason);
 const clear=()=>{generation.current++;request.current?.abort();request.current=null;setReason('');setPending(null);setState('idle');setMessage('');};
 useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>subscribeDrafts(event=>{if(event.principal===principal.principal_id&&['logout','logout-unknown','revoked'].includes(event.reason)&&(event.kind===undefined||event.kind==='ticket'&&(event.id===undefined||event.id===ticketId)))clear();}),[principal.principal_id,ticketId]);
 useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
 const refresh=()=>{void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
 async function send(command:P2016ReopenCommand){
  if(request.current||!workbenchTransportWritable())return;const controller=new AbortController(),token=++generation.current,currentRead=captureWorkbenchRead(controller.signal);request.current=controller;setPending(command);setState('submitting');setMessage('正在提交重开操作…');
  const current=()=>{if(generation.current!==token||controller.signal.aborted)return false;try{currentRead();return true;}catch{return false;}};
  try{
   const result=await api.reopenTicket(ticketId,command,principal.csrf_token,controller.signal);if(!current())return;
   const fresh=await api.ticketCommandContext(ticketId,controller.signal);if(!current())return;
   if(fresh.version<result.ticket_version||fresh.handling_cycle?.id!==result.handling_cycle.id)throw Error('REOPEN_CURRENT_FACTS_UNCONFIRMED');
   setReason('');setPending(null);setState('succeeded');setMessage(fresh.handling_cycle.first_responsibility_event_id===null?'已重开，本轮等待重新承接。':'已重开，当前新轮次已有后续处理。');refresh();
  }catch(error){
   if(!current())return;
   if(error instanceof ApiError){setPending(null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'工单版本或状态已变化，请重新读取后确认新的操作。':'操作被拒绝：'+errorMessage(error));if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else if([403,404].includes(error.status))await clearTicketAuthorization(client,principal.principal_id,ticketId,error);else if(error.status===409)refresh();}
   else{setState('unknown');setMessage('结果未知：原重开操作、版本和原因保持不变，当前不会再次发送。');}
  }finally{if(generation.current===token)request.current=null;}
 }
 const allowed=principal.ticket_reopen_rounds_enabled&&context.data?.allowed_actions.includes('reopen')===true;
 return <section className="ticket-notes ticket-reopen" aria-label="工作人员重开工单">
  <h3>重开同一工单</h3>
  {context.isPending?<p role="status">正在读取重开权限与版本…</p>:context.isError?<p role="alert">{errorMessage(context.error)}</p>:<p>工单版本 {context.data.version}</p>}
  {allowed||pending?<form onSubmit={event=>{event.preventDefault();if(blocked||context.isFetching||!allowed||!context.data||!reason.trim()||reason.trim().length>2000)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'STAFF_REOPEN',note:reason.trim()}));}}>
   <label htmlFor="reopen-reason">重开原因</label><p>请核实同一故障仍需处理。原因仅供获权工作人员协作。</p>
   <textarea id="reopen-reason" maxLength={2000} disabled={blocked||!allowed} value={reason} onChange={event=>setReason(event.target.value)}/>
   <p>重开后保留原处理组，清除当前处理人，等待重新承接。</p>
   <button type="submit" data-action="reopen-ticket" disabled={blocked||context.isFetching||!allowed||!reason.trim()}>重开此工单</button>
  </form>:<p>当前没有重开此工单的权限。</p>}
  {!blocked?<button type="button" onClick={()=>{void context.refetch();}}>重新读取重开权限</button>:null}
  {state!=='idle'?<p data-reopen-state role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</p>:null}
 </section>;
}
