import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Form as HForm,Label as HLabel,TextArea as HTextArea} from "@heroui/react";
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {Lock} from 'lucide-react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {P2016InternalNoteCommand,Principal} from '../../api/client';
import {useNoteDraft} from '../drafts/use-note-draft';

type NoteState='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketNotes({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [note,setNote]=useState(''),[state,setState]=useState<NoteState>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
  const [pending,setPending]=useState<P2016InternalNoteCommand|null>(null);
  const draft=useNoteDraft({scope:{principal:principal.principal_id,kind:'ticket',id:ticketId,purpose:'internal-note'},principal,note,pending,onRestore:value=>{setNote(value.note);setPending(value.pending);if(value.pending){setState('unknown');setMessage('结果未知：已恢复原操作，请核对保存结果。正文和版本保持不变。');}},onSensitiveClear:()=>{request.current?.abort();request.current=null;setNote('');setPending(null);setState('idle');setMessage('');},onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能核对上次操作。');}});
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const blocked=['submitting','checking','unknown'].includes(state);
  const navigationBlocked=(blocked||(draft.enabled&&Boolean(note)))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{
    if(!navigationBlocked)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[navigationBlocked]);
  const refresh=()=>{
    void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});
    void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});
    void client.invalidateQueries({queryKey:['board',principal.principal_id]});
  };
  const mutation=useMutation({mutationKey:['ticket-internal-note',principal.principal_id,ticketId],
    mutationFn:({command,signal}:{command:P2016InternalNoteCommand;signal:AbortSignal})=>api.addInternalNote(ticketId,command,principal.csrf_token,signal),
    onSuccess:async(result,variables)=>{const cleaned=await draft.success(variables.command.client_command_id);setPending(null);setNote('');setState('succeeded');setMessage((result.replayed?'已保存：已核对原操作结果。':'已保存内部备注。')+(cleaned?'':' 本地恢复副本清理失败，禁止新提交；请只读核对并重试清理。'));refresh();},
    onError:(error,variables)=>{
      if(error instanceof ApiError){setPending(null);void draft.knownFailure(variables.command.client_command_id).catch(()=>{});setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'保存冲突：内容已保留，请重新读取版本后确认新的操作。':('保存被拒绝：'+errorMessage(error)));if(error.status===409)refresh();}
      else {setPending(variables.command);setState('unknown');setMessage('结果未知：请求可能已保存。请核对原操作结果，正文和版本保持不变。');}
    },onSettled:()=>{request.current=null;},
  });
  const send=async(command:P2016InternalNoteCommand,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，新操作尚未准备或发送；输入已保留，请重新读取。');return;}
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在保存内部备注…');
    try{await draft.prepare(command);}catch{request.current=null;if(checking){setPending(command);setState('unknown');setMessage('原操作仍未知；恢复存储不可用，已保留原命令，尚未再次发送。');}else{setPending(null);setState('denied');setMessage('恢复副本未保存，原操作尚未发送。请保留输入并恢复浏览器存储后再试。');}return;}
    if(controller.signal.aborted)return;
    mutation.mutate({command,signal:controller.signal});
  };
  const receipt=useMutation({mutationKey:['ticket-internal-note',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.internalNoteReceipt(ticketId,commandId,signal),
    onSuccess:async result=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：未找到终态收据不代表未提交，请继续只读核对。');refresh();return;}const preserveInput=Boolean(note),cleaned=await draft.success(result.client_command_id,preserveInput);if(!preserveInput)setNote('');setPending(null);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已保存：已核对原操作结果。':'已核对原操作失败；请读取工单信息后明确新的操作。')+(preserveInput?' 较新的未提交输入已保留，请读取当前版本后明确提交。':'')+(cleaned?'':' 本地恢复副本清理失败，禁止新提交；请只读核对并重试清理。'));refresh();},
    onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const checkReceipt=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在核对上次操作…');receipt.mutate({commandId:draft.operationId,signal:controller.signal});};
  if(context.isPending)return <p role="status">正在读取工单动作与版本…</p>;
  if(context.isError&&!context.data)return <section data-activity-field="internal-note" className="ticket-notes"><p role="alert">{errorMessage(context.error)}</p><HButton type="button" onClick={()=>{void context.refetch();}} variant="secondary">重新读取工单动作</HButton></section>;
  if(!context.data)return <p role="status">正在重新核验工单动作…</p>;
  const allowed=context.data.allowed_actions.includes('add-note');
  return <section data-activity-field="internal-note" className="ticket-notes detail-note-composer" aria-label="工单操作">
    <div className="note-composer-body">
    {context.isError?<p role="status">动作读取失败；最近确认资料和输入已保留，请重新读取后提交新的操作。</p>:null}
    <p hidden className="ticket-command-version">工单版本 {context.data.version}</p>
    {allowed||pending||draft.operationId?<HForm onSubmit={event=>{event.preventDefault();if(!allowed||blocked||!draft.canSubmit||!note.trim()||note.length>2000)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:note.trim(),external_visible:false}),false);}}><HLabel htmlFor="internal-note"><Lock size={19}/>内部备注</HLabel><p id="internal-note-audience">仅信息科可见，不向报修人发送。</p><div className="note-entry"><HTextArea id="internal-note" aria-label="内部备注" aria-describedby="internal-note-audience" placeholder="记录处理进展或需要同事知道的信息…" rows={2} maxLength={2000} value={note} disabled={blocked||!allowed} onChange={event=>setNote(event.target.value)}/><HButton type="submit" data-action="save-internal-note" isDisabled={blocked||!allowed||!draft.canSubmit||!note.trim()||note.length>2000} variant="secondary">保存内部备注</HButton></div>{draft.enabled?<DraftStatus data-draft-status role="status">{draft.message}</DraftStatus>:null}<div className="note-controls">
      {state==='unknown'&&pending?<HButton type="button" data-action="check-internal-note" onClick={()=>send(pending,true)} variant="secondary">核对保存结果</HButton>:null}
      {!pending&&draft.operationId?<HButton type="button" data-action="check-expired-note" isDisabled={state==='submitting'||state==='checking'} onClick={checkReceipt} variant="secondary">核对上次操作</HButton>:null}
      {draft.enabled&&Boolean(note)?<HButton type="button" data-action="discard-note-draft" isDisabled={state==='submitting'||state==='checking'} onClick={()=>{void draft.discard();}} variant="secondary">丢弃草稿内容</HButton>:null}
      {!blocked?<HButton type="button" onClick={()=>{void context.refetch();}} variant="secondary">重新读取工单动作</HButton>:null}<span>{note.length} / 2000</span></div></HForm>:<p>当前没有内部备注写入权限。</p>}
    {state!=='idle'?<ToastFeedback revision={messageRevision} source="ticket-notes" state={state} className="ticket-note-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
  </div></section>;
}
