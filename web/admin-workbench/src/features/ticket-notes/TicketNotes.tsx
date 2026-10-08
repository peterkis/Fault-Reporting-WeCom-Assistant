import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {P2016InternalNoteCommand,Principal} from '../../api/client';
import {useNoteDraft} from '../drafts/use-note-draft';

const actionNames:Record<string,string>={queue:'入队',accept:'接单',start:'开始处理','request-information':'请求补充','wait-vendor':'等待厂商',resume:'恢复处理',resolve:'登记解决',complete:'工作人员完工',confirm:'确认恢复',reopen:'重开',cancel:'取消','add-note':'内部备注','transfer-assignment':'转派','take-and-start':'我来处理','accept-for-later':'先接单，稍后处理'};
type NoteState='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketNotes({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [note,setNote]=useState(''),[state,setState]=useState<NoteState>('idle'),[message,setMessage]=useState('');
  const [pending,setPending]=useState<P2016InternalNoteCommand|null>(null);
  const draft=useNoteDraft({scope:{principal:principal.principal_id,kind:'ticket',id:ticketId,purpose:'internal-note'},principal,note,pending,onRestore:value=>{setNote(value.note);setPending(value.pending);if(value.pending){setState('unknown');setMessage('结果未知：已恢复原操作，请核对保存结果。正文和版本保持不变。');}},onSensitiveClear:()=>{request.current?.abort();request.current=null;setNote('');setPending(null);setState('idle');setMessage('');},onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能只读核对原操作。');}});
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
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在保存内部备注…');
    try{await draft.prepare(command);}catch{request.current=null;if(checking){setPending(command);setState('unknown');setMessage('原操作仍未知；恢复存储不可用，已保留原命令，尚未再次发送。');}else{setPending(null);setState('denied');setMessage('恢复副本未保存，原操作尚未发送。请保留输入并恢复浏览器存储后再试。');}return;}
    if(controller.signal.aborted)return;
    mutation.mutate({command,signal:controller.signal});
  };
  const receipt=useMutation({mutationKey:['ticket-internal-note',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.internalNoteReceipt(ticketId,commandId,signal),
    onSuccess:async result=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：未找到终态收据不代表未提交，请继续只读核对。');refresh();return;}const preserveInput=Boolean(note),cleaned=await draft.success(result.client_command_id,preserveInput);if(!preserveInput)setNote('');setPending(null);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已保存：已核对原操作结果。':'已核对原操作失败；请读取当前事实后明确新的操作。')+(preserveInput?' 较新的未提交输入已保留，请读取当前版本后明确提交。':'')+(cleaned?'':' 本地恢复副本清理失败，禁止新提交；请只读核对并重试清理。'));refresh();},
    onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const checkReceipt=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在只读核对原操作…');receipt.mutate({commandId:draft.operationId,signal:controller.signal});};
  if(context.isPending)return <p role="status">正在读取工单动作与版本…</p>;
  if(context.isError)return <section className="ticket-notes"><p role="alert">{errorMessage(context.error)}</p><button type="button" onClick={()=>{void context.refetch();}}>重新读取工单动作</button></section>;
  const allowed=context.data.allowed_actions.includes('add-note');
  return <section className="ticket-notes" aria-label="工单操作">
    <p className="ticket-command-version">工单版本 {context.data.version}</p>
    <p className="ticket-allowed-actions">当前获权动作：{context.data.allowed_actions.map(action=>actionNames[action]??action).join('、')||'无'}</p>
    {allowed||pending||draft.operationId?<form onSubmit={event=>{event.preventDefault();if(!allowed||blocked||!draft.canSubmit||!note.trim()||note.length>2000)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:note.trim(),external_visible:false}),false);}}>
      <label htmlFor="internal-note">内部备注</label><p id="internal-note-audience">仅供获权工作人员协作，不向报修人发送。</p>
      <textarea id="internal-note" aria-label="内部备注" aria-describedby="internal-note-audience" maxLength={2000} value={note} disabled={blocked||!allowed} onChange={event=>setNote(event.target.value)}/>
      {draft.enabled?<p data-draft-status role="status">{draft.message}</p>:null}
      <div className="note-controls"><button type="submit" data-action="save-internal-note" disabled={blocked||!allowed||!draft.canSubmit||!note.trim()||note.length>2000}>保存内部备注</button>
      {state==='unknown'&&pending?<button type="button" data-action="check-internal-note" onClick={()=>send(pending,true)}>核对保存结果</button>:null}
      {!pending&&draft.operationId?<button type="button" data-action="check-expired-note" disabled={state==='submitting'||state==='checking'} onClick={checkReceipt}>只读核对原操作</button>:null}
      {draft.enabled&&Boolean(note)?<button type="button" data-action="discard-note-draft" disabled={state==='submitting'||state==='checking'} onClick={()=>{void draft.discard();}}>丢弃草稿内容</button>:null}
      {!blocked?<button type="button" onClick={()=>{void context.refetch();}}>重新读取工单动作</button>:null}<span>{note.length} / 2000</span></div>
    </form>:<p>当前没有内部备注写入权限。</p>}
    {state!=='idle'?<p className="ticket-note-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</p>:null}
  </section>;
}
