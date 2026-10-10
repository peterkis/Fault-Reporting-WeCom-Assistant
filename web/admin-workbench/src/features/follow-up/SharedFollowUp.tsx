import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {DraftError,subscribeDrafts} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {followUpApi,followUpInput,matchesFollowUpResult} from './client';
import type {SharedFollowUpCommand,SharedFollowUpResult,SharedFollowUpView} from './client';
import './follow-up.css';

type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown'|'invalid';
export function SharedFollowUp({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
 const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
 const [input,setInput]=useState(''),[pending,setPending]=useState<SharedFollowUpCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState('');
 const [confirmedResult,setConfirmedResult]=useState<SharedFollowUpResult|null>(null);
 const key=['ticket-follow-up-schedule',principal.principal_id,ticketId] as const;
 const query=useQuery({queryKey:key,queryFn:({signal})=>followUpApi.view(ticketId,signal),enabled:principal.follow_up_schedules_enabled,retry:false});
 const clear=()=>{generation.current++;request.current?.abort();request.current=null;setInput('');setPending(null);setConfirmedResult(null);setState('idle');setMessage('');};
 // There is no T37 raw-recovery capability. Reuse the protocol in its actual disabled mode.
 // The original six-field intent and UUID remain in this component's memory only.
 const draft=useAuthorizedDraft<string,SharedFollowUpCommand>({scope:{principal:principal.principal_id,kind:'ticket',id:ticketId,purpose:'shared-follow-up-schedule'},enabled:false,writeEnabled:false,value:input,pending,emptyValue:'',hasInput:value=>Boolean(value),
  serialise:copy=>JSON.stringify({schema:1,...copy}),decode:()=>{throw new DraftError('DRAFT_DISABLED');},commandId:command=>command.client_command_id,authorize:async()=>false,onAuthorityFailure:clear,
  onRestore:copy=>{setInput(copy.value);setPending(copy.pending);},onOperation:()=>{},onSensitiveClear:()=>setInput('')});
 const commandId=pending?.client_command_id,working=state==='submitting'||state==='checking',blocked=working||Boolean(commandId),navigationBlocked=blocked||Boolean(input);
 useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{
  generation.current++;request.current?.abort();request.current=null;
  if(pending){setState('unknown');setMessage('当前会话已更新；请只读核对原操作，不会再次发送。');}
  else if(confirmedResult){setState('succeeded');setMessage('原操作已确认，请重新读取当前安排。');}
 },[principal.principal_id,principal.csrf_token,principal.authorization_revision]);
 useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
 useEffect(()=>{
  if(!principal.follow_up_schedules_enabled&&!commandId)return;
  try{return subscribeDrafts(event=>{if(event.principal===principal.principal_id&&['logout','logout-unknown','revoked'].includes(event.reason)&&(event.kind===undefined||event.kind==='ticket'&&(event.id===undefined||event.id===ticketId))&&(event.purpose===undefined||event.purpose==='shared-follow-up-schedule'))clear();});}
  catch(error){if(!(error instanceof DraftError&&error.message==='DRAFT_STORAGE_UNAVAILABLE'))throw error;}
 },[principal.principal_id,principal.follow_up_schedules_enabled,ticketId,commandId]);
 const deny=async(error:ApiError)=>{clear();if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else await clearTicketAuthorization(client,principal.principal_id,ticketId,error);};
 useEffect(()=>{if(query.error instanceof ApiError&&[401,403,404].includes(query.error.status))void deny(query.error);},[query.error,principal.principal_id,ticketId]);
 const refresh=()=>{void client.invalidateQueries({queryKey:key});void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
 const authorityRejected=query.error instanceof ApiError&&[401,403,404].includes(query.error.status);
 const view=authorityRejected?undefined:query.data;
 const factsConfirmed=Boolean(view&&(!confirmedResult||view.ticket_version>=confirmedResult.ticket_version&&BigInt(view.schedule_version)>=BigInt(confirmedResult.schedule_version)));
 const readReady=query.isSuccess&&!query.isFetching&&!query.isError&&factsConfirmed;
 async function readLatest(signal:AbortSignal,result:SharedFollowUpResult,current:()=>boolean):Promise<SharedFollowUpView>{
  const fresh=await followUpApi.view(ticketId,signal);
  if(!current())throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');
  if(fresh.ticket_version<result.ticket_version||BigInt(fresh.schedule_version)<BigInt(result.schedule_version))throw Error('FOLLOW_UP_CURRENT_FACTS_UNCONFIRMED');
  client.setQueryData(key,fresh);return fresh;
 }
 async function send(command:SharedFollowUpCommand){
  if(request.current||pending||!workbenchTransportWritable()||!draft.canSubmit)return;
  const controller=new AbortController(),token=++generation.current,currentRead=captureWorkbenchRead(controller.signal);request.current=controller;setPending(command);setState('submitting');setMessage('正在保存共享时间…');let dispatched=false,accepted=false;
  const current=()=>{if(generation.current!==token||controller.signal.aborted)return false;try{currentRead();return true;}catch{return false;}};
  try{
   await draft.prepare(command);if(!current())return;dispatched=true;
   const result=await followUpApi.perform(ticketId,command,principal.csrf_token,controller.signal);accepted=true;if(!current())return;setConfirmedResult(result);
   await draft.success(command.client_command_id);if(!current())return;setPending(null);setInput('');
   await readLatest(controller.signal,result,current);if(!current())return;
   setState('succeeded');setMessage(command.action==='SET'?'已保存共享时间。':'已取消共享时间，历史记录保留。');refresh();
  }catch(error){
   if(!current())return;
   if(error instanceof ApiError&&[401,403,404].includes(error.status))await deny(error);
   else if(accepted){setPending(null);setInput('');setState('succeeded');setMessage('原操作已确认提交，最新安排暂未读回；请重新读取当前资料。');refresh();}
   else if(dispatched&&error instanceof ApiError){await draft.knownFailure(command.client_command_id);if(!current())return;setPending(null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'安排或工单已变化，请重新读取后确认新的操作。':'操作被拒绝：'+errorMessage(error));refresh();}
   else{setState('unknown');setMessage('结果未知：保留原操作，请只读核对；不会再次发送。');}
  }finally{if(generation.current===token)request.current=null;}
 }
 function submit(action:'SET'|'CANCEL'){
  if(!view||!readReady||blocked||!principal.follow_up_schedules_enabled||!view.allowed_actions.includes(action)||!principal.csrf_token||!workbenchTransportWritable())return;
  if(action==='SET'){
   try{const due=followUpInput(input);void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:view.ticket_version,expected_schedule_version:view.schedule_version,reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:due}));}
   catch{setState('invalid');setMessage('请填写有效的北京时间，格式为 YYYY-MM-DD HH:mm:ss。');}
  }else void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:view.ticket_version,expected_schedule_version:view.schedule_version,reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'CANCEL',due_at:null}));
 }
 async function checkOriginal(){
  if(request.current||!pending||!principal.follow_up_schedule_receipt_enabled)return;
  const command=pending,controller=new AbortController(),token=++generation.current,currentRead=captureWorkbenchRead(controller.signal);request.current=controller;setState('checking');setMessage('正在只读核对原操作…');
  const current=()=>{if(generation.current!==token||controller.signal.aborted)return false;try{currentRead();return true;}catch{return false;}};
  try{
   const receipt=await followUpApi.acknowledgement(ticketId,command.client_command_id,controller.signal);if(!current())return;
   client.setQueryData(['ticket-follow-up-ack',principal.principal_id,ticketId,command.client_command_id],receipt);
   if(receipt.state==='UNKNOWN'){setState('unknown');setMessage('原操作尚无可确认终态；请保留原操作，不会再次发送。');return;}
   if(receipt.state==='COMMITTED'&&!matchesFollowUpResult(command,receipt.result))throw Error('FOLLOW_UP_ORIGINAL_RESULT_UNCONFIRMED');
   await draft.success(command.client_command_id);if(!current())return;setPending(null);setInput('');
   if(receipt.state==='FAILED'){setState('denied');setMessage('已核对原操作被拒绝，请读取当前安排后确认新的操作。');refresh();return;}
   setConfirmedResult(receipt.result);setState('succeeded');setMessage('已核对原操作提交成功。');
   // ACK is independent of write/view flags; a later arrangement need not equal the old result.
   if(principal.follow_up_schedules_enabled){try{await readLatest(controller.signal,receipt.result,current);}catch(error){if(!current())return;if(error instanceof ApiError&&[401,403,404].includes(error.status)){await deny(error);return;}setMessage('已核对原操作提交成功，当前安排暂未读回。');}}
   if(current())refresh();
  }catch(error){if(!current())return;if(error instanceof ApiError&&[401,403,404].includes(error.status))await deny(error);else{setState('unknown');setMessage('只读核对尚未完成；原操作仍保留，不会再次发送。');}}
  finally{if(generation.current===token)request.current=null;}
 }
 if(!principal.follow_up_schedules_enabled&&!commandId&&!input&&state==='idle')return null;
 const canSet=principal.follow_up_schedules_enabled&&view?.allowed_actions.includes('SET')===true;
 const canCancel=principal.follow_up_schedules_enabled&&view?.allowed_actions.includes('CANCEL')===true;
 return <section role="region" aria-label="共享下次跟进时间" className="ticket-notes shared-follow-up">
  <h3>共享下次跟进时间</h3><p>北京时间（Asia/Shanghai），由当前处理和沟通责任共同跟进。</p>
  {!principal.follow_up_schedules_enabled?<p>共享时间维护已关闭；仍可核对原操作。</p>:query.isPending?<p role="status">正在读取当前共享时间…</p>:query.isError?<p role="alert">{errorMessage(query.error)}</p>:null}
  {principal.follow_up_schedules_enabled&&view?<>
   {query.isError||!factsConfirmed?<p role="status">以下为最近已确认资料，最新安排仍需重新读取。</p>:null}
   <p>{view.active?<><time>{view.active.due_at}</time>{view.active.is_due?' · 已到期，请跟进':' · 已安排'}</>:'尚无活动的共享时间'}</p>
   {canSet?<form onSubmit={event=>{event.preventDefault();submit('SET');}}><label htmlFor={'follow-up-due-'+ticketId}>下次行动时间（北京时间）</label>
    <input id={'follow-up-due-'+ticketId} name="due_at" type="text" maxLength={19} placeholder="YYYY-MM-DD HH:mm:ss" value={input} disabled={blocked} onChange={event=>setInput(event.target.value)}/>
    <button type="submit" disabled={blocked||!readReady||!input.trim()||!principal.csrf_token||!workbenchTransportWritable()}>设置共享时间</button>
   </form>:<p>当前仅可查看安排与历史。</p>}
   {canCancel?<button type="button" disabled={blocked||!readReady||!principal.csrf_token||!workbenchTransportWritable()} onClick={()=>submit('CANCEL')}>取消共享时间</button>:null}
   {view.history.length?<ol className="shared-follow-up-history">{view.history.map(entry=><li key={entry.ticket_event_id}>{entry.action==='SET'?'已设置':entry.action==='CANCEL'?'已取消':entry.end_reason==='CLOSED'?'关闭后结束':'取消工单后结束'}{entry.due_at?' · '+entry.due_at:''}<span>记录时间 {entry.occurred_at}</span></li>)}</ol>:null}
   {view.history_has_more?<p>显示最近20条记录，仍有更早历史。</p>:null}
  </>:null}
  {commandId?<button type="button" disabled={working||!principal.follow_up_schedule_receipt_enabled} onClick={()=>void checkOriginal()}>只读核对原操作</button>:null}
  {input&&!blocked?<button type="button" onClick={()=>setInput('')}>清空未提交输入</button>:null}
  {principal.follow_up_schedules_enabled&&!blocked?<button type="button" onClick={()=>{void query.refetch();}}>重新读取共享时间</button>:null}
  {state!=='idle'?<p role={['unknown','denied','conflict','invalid'].includes(state)?'alert':'status'}>{message}</p>:null}
 </section>;
}
