import {createPortal} from 'react-dom';
import {Button as HButton} from '../../design/components/Button/Button';
import {Form as HForm,Label as HLabel,TextArea as HTextArea} from "@heroui/react";
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {Lock,RefreshCw} from 'lucide-react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {P2016InternalNoteCommand,Principal} from '../../api/client';
import {useNoteDraft} from '../drafts/use-note-draft';

type NoteState='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketNotes({ticketId,principal,onBlockedChange,actionsTarget}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void;actionsTarget:HTMLElement|null}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [note,setNote]=useState(''),[state,setState]=useState<NoteState>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
  const [pending,setPending]=useState<P2016InternalNoteCommand|null>(null);
  const draft=useNoteDraft({scope:{principal:principal.principal_id,kind:'ticket',id:ticketId,purpose:'internal-note'},principal,note,pending,onRestore:value=>{setNote(value.note);setPending(value.pending);if(value.pending){setState('unknown');setMessage('结果未确认：网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。');}},onSensitiveClear:()=>{request.current?.abort();request.current=null;setNote('');setPending(null);setState('idle');setMessage('');},onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能核对上次操作。');}});
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
    onSuccess:async(result,variables)=>{const cleaned=await draft.success(variables.command.client_command_id);setPending(null);setNote('');setState('succeeded');setMessage((result.replayed?'已保存：已核对原操作结果。':'已保存内部备注。')+(cleaned?'':' 草稿未能清空：为避免重复提交，暂时只能查看。点击重试。'));refresh();},
    onError:(error,variables)=>{
      if(error instanceof ApiError){setPending(null);void draft.knownFailure(variables.command.client_command_id).catch(()=>{});setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'内容已被他人更新：你的修改还在，查看最新内容后再保存。':('保存被拒绝：'+errorMessage(error)));if(error.status===409)refresh();}
      else {setPending(variables.command);setState('unknown');setMessage('结果未确认：网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。');}
    },onSettled:()=>{request.current=null;},
  });
  const send=async(command:P2016InternalNoteCommand,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('网络未就绪：网络恢复前不会提交，你的输入已保留。');return;}
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在保存内部备注…');
    try{await draft.prepare(command);}catch{request.current=null;if(checking){setPending(command);setState('unknown');setMessage('结果未确认：本机草稿暂时无法保存，没有重复提交。点击「核对结果」。');}else{setPending(null);setState('denied');setMessage('草稿未能保存：本次没有提交，你的输入还在。检查浏览器存储后重试。');}return;}
    if(controller.signal.aborted)return;
    mutation.mutate({command,signal:controller.signal});
  };
  const receipt=useMutation({mutationKey:['ticket-internal-note',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.internalNoteReceipt(ticketId,commandId,signal),
    onSuccess:async result=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：未找到终态收据不代表未提交，请继续只读核对。');refresh();return;}const preserveInput=Boolean(note),cleaned=await draft.success(result.client_command_id,preserveInput);if(!preserveInput)setNote('');setPending(null);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已保存：已核对原操作结果。':'已核对原操作失败；请读取工单信息后明确新的操作。')+(preserveInput?' 你后来输入的内容还在，确认后再提交。':'')+(cleaned?'':' 草稿未能清空：为避免重复提交，暂时只能查看。点击重试。'));refresh();},
    onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const checkReceipt=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在核对上次操作…');receipt.mutate({commandId:draft.operationId,signal:controller.signal});};
  if(context.isPending)return <p role="status">正在加载…</p>;
  if(context.isError&&!context.data)return <section data-activity-field="internal-note" className="ticket-notes"><p role="alert">{errorMessage(context.error)}</p>{actionsTarget?createPortal(<HButton type="button" onClick={()=>{void context.refetch();}} tone="ghost"><RefreshCw aria-hidden="true"/>刷新可用操作</HButton>,actionsTarget):null}</section>;
  if(!context.data)return <p role="status">正在加载…</p>;
  const allowed=context.data.allowed_actions.includes('add-note');
  const routineDraft=!note&&!pending&&!draft.operationId&&(draft.message===''||draft.message==='草稿仅在当前浏览器恢复，最长24小时。');
  return <section data-activity-field="internal-note" className="ticket-notes detail-note-composer" aria-label="工单操作">
    <div className="note-composer-body">
    {context.isError?<p role="status">动作读取失败；最近确认资料和输入已保留，请重新读取后提交新的操作。</p>:null}
    <p hidden className="ticket-command-version">工单版本 {context.data.version}</p>
    {allowed||pending||draft.operationId?<HForm onSubmit={event=>{event.preventDefault();if(!allowed||blocked||!draft.canSubmit||!note.trim()||note.length>2000)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:note.trim(),external_visible:false}),false);}}><div className="ds-note-composer-row"><div className="ds-note-input" data-presence-banner-anchor><HLabel htmlFor="internal-note" title={'仅信息科可见，不向报修人发送。'+(draft.enabled&&routineDraft?draft.message:'')}><Lock size={13}/>内部备注 · 仅信息科可见</HLabel><p id="internal-note-audience" className="sr-only">仅信息科可见，不向报修人发送。</p><div className="note-entry"><HTextArea onKeyDown={event=>{if(event.key==='Enter'&&event.ctrlKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} id="internal-note" aria-label="内部备注" aria-describedby="internal-note-audience" placeholder="记录处理进展或需要同事知道的信息…" rows={2} maxLength={2000} value={note} disabled={blocked||!allowed} onChange={event=>setNote(event.target.value)}/><div className="ds-note-bottom"><span className="ds-closure-draft ds-note-draft">{draft.enabled?<DraftStatus inlineText data-draft-status role="status">{draft.message}</DraftStatus>:null}{draft.enabled&&Boolean(note)?<>{routineDraft?null:<span aria-hidden="true" className="ds-closure-draft-separator">·</span>}<HButton type="button" data-action="discard-note-draft" className="ds-closure-discard" isDisabled={state==='submitting'||state==='checking'} onClick={()=>{void draft.discard();}} tone="ghost">清空</HButton></>:null}</span><span className="ds-note-counter" data-note-count>{note.length} / 2000</span><HButton type="submit" data-action="save-internal-note" isDisabled={blocked||!allowed||!draft.canSubmit||!note.trim()||note.length>2000} tone="secondary" aria-keyshortcuts="Control+Enter">保存 <kbd>Ctrl ↵</kbd></HButton></div></div></div></div><div className="note-controls">
      {state==='unknown'&&pending?<HButton type="button" data-action="check-internal-note" onClick={()=>send(pending,true)} tone="secondary">重新提交</HButton>:null}
      {!pending&&draft.operationId?<HButton type="button" data-action="check-expired-note" isDisabled={state==='submitting'||state==='checking'} onClick={checkReceipt} tone="secondary">核对结果</HButton>:null}
      {!blocked&&actionsTarget?createPortal(<HButton type="button" onClick={()=>{void context.refetch();}} tone="ghost"><RefreshCw aria-hidden="true"/>刷新可用操作</HButton>,actionsTarget):null}</div></HForm>:<p>当前没有内部备注写入权限。</p>}
    {state!=='idle'?<ToastFeedback revision={messageRevision} source="ticket-notes" state={state} className="ticket-note-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
  </div></section>;
}
