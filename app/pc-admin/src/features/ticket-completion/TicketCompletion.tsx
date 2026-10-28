import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox,Form as HForm,Label as HLabel,TextArea as HTextArea} from "@heroui/react";
import {ToastFeedback,DraftStatus,DraftFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {DetailActionDialog} from '../../app/DetailPresentation';
import {BoardConflictIntent} from '../board-actions/BoardConflictIntent';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {P2016CompletionCommand,Principal} from '../../api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {useCompletionDraft,EMPTY_COMPLETION} from './use-completion-draft';
import type {CompletionInput} from './use-completion-draft';
import {subscribeDrafts} from '../drafts/encrypted-drafts';

type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketCompletion({ticketId,principal,onBlockedChange,boardMode=false,presentation='inline',onOpenChange}:{ticketId:string;principal:Principal;boardMode?:boolean;presentation?:'inline'|'dialog';onOpenChange?:(open:boolean)=>void;onBlockedChange:(value:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0),settling=useRef(false);
  const [value,setValue]=useState<CompletionInput>(EMPTY_COMPLETION),[pending,setPending]=useState<P2016CompletionCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
  const latest=useRef(value);latest.current=value;
  const clear=()=>{generation.current++;request.current?.abort();request.current=null;setValue(EMPTY_COMPLETION);setPending(null);setState('idle');setMessage('');};
  const sensitiveClear=()=>{if(settling.current){setValue(EMPTY_COMPLETION);setPending(null);}else clear();};
  const draft=useCompletionDraft({ticketId,principal,value,pending,onRestore:copy=>{setValue(copy.pending?copy.value:{...copy.value,confirmed:false});setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('结果未知：请核对原完工操作；原版本、轮次和正文保持不变。');}},onSensitiveClear:sensitiveClear,onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能只读核对原完工操作。');}});
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const completion=useMutation({mutationKey:['ticket-completion',principal.principal_id,ticketId],mutationFn:({command,signal}:{command:P2016CompletionCommand;signal:AbortSignal})=>api.completeTicket(ticketId,command,principal.csrf_token,signal)});
  const receipt=useMutation({mutationKey:['ticket-completion',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.completionReceipt(ticketId,commandId,signal)});
  const blocked=['submitting','checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending),hasInput=Boolean(value.process||value.summary),navigationBlocked=Boolean(boardMode&&pending)||(blocked||hasInput)&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{
    if(!principal.staff_completion_draft_recovery_enabled&&!principal.logout_enabled)return;
    try{return subscribeDrafts(event=>{if(event.principal!==principal.principal_id)return;if(['logout','logout-unknown','revoked'].includes(event.reason)&&(event.kind===undefined||event.kind==='ticket'&&(event.id===undefined||event.id===ticketId)))clear();});}catch{return;}
  },[principal.principal_id,principal.staff_completion_draft_recovery_enabled,principal.logout_enabled,ticketId]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refresh=()=>{void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});void client.invalidateQueries({queryKey:['ticket-round-notifications',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['web-report',principal.principal_id,'ticket',ticketId]});};
  async function authorization(error:ApiError){if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else await clearTicketAuthorization(client,principal.principal_id,ticketId,error);clear();}
  async function send(command:P2016CompletionCommand,checking=false){
    if(request.current)return;const controller=new AbortController(),token=++generation.current;request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原完工操作…':'正在提交完工结果…');
    const current=()=>generation.current===token&&!controller.signal.aborted;
    try{
      try{await draft.prepare(command);}catch{if(current()){setPending(checking?command:null);setState(checking?'unknown':'denied');setMessage(checking?'原操作仍未知；恢复存储不可用，尚未再次发送。':'恢复副本未保存，本次尚未发送；请保留输入并恢复浏览器存储。');}return;}
      if(!current())return;
      const result=await completion.mutateAsync({command,signal:controller.signal});if(!current())return;
      settling.current=true;let cleaned:boolean;try{cleaned=await draft.success(command.client_command_id);}finally{settling.current=false;}if(!current())return;setValue(EMPTY_COMPLETION);setPending(null);setState('succeeded');setMessage((result.replayed?'已完工：已核对原操作结果。':'已完工，本轮工作人员处理已结束。')+(cleaned?'':' 恢复副本清理失败，禁止新提交；请只读核对并重试清理。'));refresh();
    }catch(error){
      if(!current())return;
      if(error instanceof ApiError&&[401,403,404].includes(error.status)){await authorization(error);return;}
      if(error instanceof ApiError){if(!(boardMode&&error.status===409))await draft.knownFailure(command.client_command_id).catch(()=>{});if(!current())return;setPending(boardMode&&error.status===409?command:null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'完工冲突：独立输入已保留，请读取当前版本和轮次后明确新的操作。':'完工被拒绝：'+errorMessage(error));if(error.status===409)refresh();}
      else{setPending(command);setState('unknown');setMessage('结果未知：完工可能已提交。请核对原操作；原操作、版本、轮次和正文保持不变。');}
    }finally{if(request.current===controller)request.current=null;}
  }
  async function checkReceipt(){
    if(request.current||!draft.operationId)return;const controller=new AbortController(),token=++generation.current;request.current=controller;setState('checking');setMessage('正在只读核对原完工操作…');const current=()=>generation.current===token&&!controller.signal.aborted;
    try{
      const result=await receipt.mutateAsync({commandId:draft.operationId,signal:controller.signal});if(!current())return;
      if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：查不到终态收据不代表未提交，请继续只读核对。');refresh();return;}
      const before=latest.current,preserve=Boolean(before.process||before.summary);settling.current=true;let cleaned:boolean;try{cleaned=await draft.success(result.client_command_id,preserve);}finally{settling.current=false;}if(!current())return;
      if(!preserve)setValue(EMPTY_COMPLETION);setPending(null);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已完工：已核对原操作结果。':'已核对原操作失败；请读取工单信息后明确新的操作。')+(preserve?' 较新的未提交输入已保留。':'')+(cleaned?'':' 恢复副本清理失败，禁止新提交；请重试只读核对。'));refresh();
    }catch(error){if(!current())return;if(error instanceof ApiError&&[401,403,404].includes(error.status)){await authorization(error);return;}setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');}
    finally{if(request.current===controller)request.current=null;}
  }
  const cycle=context.data?.handling_cycle,allowed=Boolean(context.data?.allowed_actions.includes('complete')&&cycle?.first_responsibility_event_id&&cycle.staff_completion_event_id===null);
  const canSubmit=allowed&&!blocked&&!(context.isPending||context.isError)&&draft.canSubmit&&value.process.trim()&&value.summary.trim()&&value.confirmed&&value.process.length<=2000&&value.summary.length<=500;
  if(!allowed&&!pending&&!draft.operationId&&!hasInput&&state==='idle'&&context.isSuccess&&!context.isError)return null;
  if(!allowed&&!pending&&!draft.operationId&&!hasInput&&state==='succeeded'&&cycle?.staff_completion_event_id===null)return null;
  if(!allowed&&!pending&&!draft.operationId&&!hasInput&&state==='succeeded')return <section className="ticket-notes ticket-completion workflow-result"><ToastFeedback revision={messageRevision} source="ticket-completion" state={state} className="ticket-completion-state" role="status">{message}</ToastFeedback><p hidden className="ticket-completion-version">工单版本 {context.data?.version}</p></section>;
  const feedback=state!=='idle'&&!(state==='succeeded'&&cycle?.staff_completion_event_id===null)?<ToastFeedback revision={messageRevision} source="ticket-completion" state={state} className="ticket-completion-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null;
  const form=<section data-activity-field="ticket-completion" className="ticket-notes ticket-completion" aria-label="工作人员完工">
    <h3>记录结果并完工</h3>{context.isPending?<p role="status">正在读取可用操作…</p>:context.isError?<p role="alert">{errorMessage(context.error)}</p>:<p hidden className="ticket-completion-version">工单版本 {context.data.version}</p>}
    {cycle?<p>处理轮次 {cycle.cycle_no}</p>:null}
    {allowed||pending||draft.operationId?<HForm onSubmit={event=>{event.preventDefault();if(!canSubmit||!cycle||!context.data)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'STAFF_COMPLETED',handling_cycle_id:cycle.id,internal_process:value.process.trim(),external_summary:value.summary.trim(),external_summary_confirmed:true}));}}><HLabel htmlFor="completion-process">内部处理过程</HLabel><p id="completion-process-audience">必填。仅信息科可见。</p><HTextArea id="completion-process" aria-describedby="completion-process-audience" maxLength={2000} disabled={blocked||!allowed} value={value.process} onChange={event=>setValue(v=>({...v,process:event.target.value}))}/><HLabel htmlFor="completion-summary">报修人可见结果</HLabel><p id="completion-summary-audience">请填写处理结果。报修人可以看到这段内容。</p><HTextArea id="completion-summary" aria-describedby="completion-summary-audience" maxLength={500} disabled={blocked||!allowed} value={value.summary} onChange={event=>setValue(v=>({...v,summary:event.target.value,confirmed:false}))}/><HCheckbox id="completion-confirmed" isSelected={value.confirmed} isDisabled={blocked||!allowed} onChange={event=>setValue(v=>({...v,confirmed:event}))} className="completion-confirmation"><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control>我已确认上述结果可给报修人查看</HCheckbox.Content></HCheckbox>{draft.enabled?<DraftStatus notify={false} data-completion-draft-status role="status">{draft.message}</DraftStatus>:<p>输入仅保留在当前页面；离开前请完成提交或清空输入。</p>}<div className="note-controls"><HButton type="submit" data-action="complete-ticket" isDisabled={!canSubmit} variant="secondary">提交结果并完工</HButton>
        {state==='unknown'&&pending?<HButton type="button" data-action="check-completion" onClick={()=>{void send(pending,true);}} variant="secondary">核对原完工结果</HButton>:null}
        {!pending&&draft.operationId?<HButton type="button" data-action="check-completion-receipt" isDisabled={state==='submitting'||state==='checking'} onClick={()=>{void checkReceipt();}} variant="secondary">核对上次操作</HButton>:null}
        {hasInput&&state!=='submitting'&&state!=='checking'&&(draft.enabled||!pending)?<HButton type="button" data-action="discard-completion-draft" onClick={()=>{if(draft.enabled)void draft.discard();else clear();}} variant="secondary">清空填写内容</HButton>:null}
      </div></HForm>:<p>当前没有本轮完工权限。</p>}
    {!blocked?<HButton type="button" className="workflow-refresh" data-action="refresh-completion" onClick={()=>{void context.refetch();}} variant="secondary">刷新</HButton>:null}

    {boardMode&&state==='conflict'&&pending?<BoardConflictIntent original={pending} onAdopt={current=>{return draft.knownFailure(pending.client_command_id).then(cleaned=>{if(!current())return;if(!cleaned){setMessage('原冲突意图的本地终态清理未确认，原 UUID 和输入继续保留。');return;}setPending(null);setState('idle');setMessage('已保留填写内容，请按工单信息明确新的操作。');refresh();}).catch(()=>{if(current())setMessage('原冲突意图的本地终态清理未确认，您的输入已保留。');});}}/>:null}
  </section>;
  return <>{presentation==='dialog'?<DetailActionDialog blocked={navigationBlocked} attention={state==='unknown'||state==='conflict'||Boolean(draft.operationId)} onOpenChange={onOpenChange}>{form}</DetailActionDialog>:form}{feedback}<DraftFeedback enabled={draft.enabled}>{draft.message}</DraftFeedback></>;
}
