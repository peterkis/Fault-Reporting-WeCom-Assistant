import {BoardConflictIntent} from '../board-actions/BoardConflictIntent';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016ConversationHandlingCommand,P2016ConversationHandlingAction} from '../../api/client';
import {useConversationHandlingDraft} from './use-conversation-handling-draft';
import type {ConversationHandlingIntent} from './use-conversation-handling-draft';

type Selection=P2016ConversationHandlingCommand['sessions'];
type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
const actions=['take-and-start-with-conversations','accept-for-later-with-conversations'] as const;
export function TicketConversationHandling({ticketId,principal,onBlockedChange,boardMode=false}:{ticketId:string;principal:Principal;boardMode?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[pending,setPending]=useState<ConversationHandlingIntent|null>(null);
  const [choice,setChoice]=useState<P2016ConversationHandlingCommand['communication_choice']>('TAKE_SELECTED'),[selected,setSelected]=useState<Selection>([]),[cursor,setCursor]=useState<string|null>(null);
  const draft=useConversationHandlingDraft({ticketId,principal,value:{choice,sessions:selected},pending,onRestore:value=>{setChoice(value.choice);setSelected(value.sessions);setPending(value.pending);if(value.pending){setState('unknown');setMessage('结果未知：已恢复原操作，请核对原动作与版本。');}},onSensitiveClear:()=>{request.current?.abort();request.current=null;setChoice('TAKE_SELECTED');setSelected([]);setPending(null);setState('idle');setMessage('');},onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能只读核对原操作。');}});
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  // Each page is bounded to 20. Only explicitly selected identities and original versions cross pages.
  const related=useQuery({queryKey:['ticket-related-conversations',principal.principal_id,ticketId,cursor],queryFn:({signal})=>api.relatedConversations(ticketId,cursor,signal),gcTime:0});
  const blocked=['submitting','checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending);
  const navigationBlocked=Boolean(boardMode&&pending)||(blocked||(draft.enabled&&(selected.length>0||choice==='RETAIN_CURRENT')))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refresh=()=>{for(const key of [['ticket-command-context',principal.principal_id,ticketId],['ticket-related-conversations',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id]])void client.invalidateQueries({queryKey:key});};
  const mutation=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],
    mutationFn:({intent,signal}:{intent:ConversationHandlingIntent;signal:AbortSignal})=>api.handleConversations(ticketId,intent.action,intent.command,principal.csrf_token,signal),
    onSuccess:async(_result,variables)=>{const cleaned=await draft.settle(variables.intent.command.client_command_id);setPending(null);setSelected([]);setState('succeeded');setMessage((variables.intent.action==='accept-for-later-with-conversations'?'已接单，沟通责任已按选择处理。':'已开始处理，沟通责任已按选择处理。')+(cleaned?'':' 本地副本清理尚未确认，禁止新操作。'));refresh();},
    onError:async(error,variables)=>{if(error instanceof ApiError){setPending(boardMode&&error.status===409?variables.intent:null);if(!(boardMode&&error.status===409))await draft.knownFailure(variables.intent.command.client_command_id).catch(()=>{});setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'操作冲突：原会话选择保留，请重新读取并确认版本。':'操作被拒绝：'+errorMessage(error));if(error.status===409)refresh();}else{setPending(variables.intent);setState('unknown');setMessage('结果未知：请核对原操作；原动作、工单版本、会话选择及版本保持不变。');}},
    onSettled:()=>{request.current=null;},
  });
  const send=async(intent:ConversationHandlingIntent,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，新操作尚未准备或发送；选择已保留，请重新读取。');return;}
    if(request.current)return;const controller=new AbortController();request.current=controller;setPending(intent);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在提交处理操作…');try{await draft.prepare(intent);}catch{request.current=null;if(checking){setState('unknown');setMessage('原操作仍未知，恢复存储不可用，尚未再次发送。');}else{setPending(null);setState('denied');setMessage('恢复副本尚未保存，操作尚未发送。');}return;}if(!controller.signal.aborted)mutation.mutate({intent,signal:controller.signal});};
  const acknowledgement=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.conversationHandlingAcknowledgement(ticketId,commandId,signal),
    onSuccess:async(result,variables)=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知，未找到终态不代表未提交；请继续只读核对。');refresh();return;}const cleaned=await draft.settle(variables.commandId);setPending(null);setSelected([]);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已核对原操作结果：已提交。':'已核对原操作失败，请读取当前事实后明确新的操作。')+(cleaned?'':' 本地副本清理尚未确认，禁止新操作。'));refresh();},onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const checkAcknowledgement=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在只读核对原操作…');acknowledgement.mutate({commandId:draft.operationId,signal:controller.signal});};
  const submit=(action:P2016ConversationHandlingAction)=>{
    if(blocked||!draft.canSubmit||context.isFetching||related.isFetching||!context.data?.allowed_actions.includes(action)||(choice==='TAKE_SELECTED'&&!selected.length))return;
    void send(Object.freeze({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:context.data.resolver_team_id,communication_choice:choice,sessions:Object.freeze(choice==='RETAIN_CURRENT'?[]:selected.map(row=>Object.freeze({...row})))})}),false);
  };
  const toggle=(sessionId:string,version:string,allowed:boolean)=>{
    if(blocked)return;
    setSelected(previous=>{if(previous.some(row=>row.session_id===sessionId))return previous.filter(row=>row.session_id!==sessionId);if(!allowed||previous.length>=8)return previous;return [...previous,{session_id:sessionId,expected_row_version:Number(version)}];});
  };
  const allowed=context.data?.allowed_actions??[];
  // The purpose hook must also mount on refresh when only an old pending/opaque operation remains.
  if(principal.ticket_takeover_enabled&&!actions.some(action=>allowed.includes(action))&&!pending&&!draft.operationId&&state==='idle'&&selected.length===0&&choice!=='RETAIN_CURRENT')return null;
  return <section className="ticket-notes ticket-conversation-handling" aria-label="本人承接工单与沟通">
    {context.isPending?<p role="status">正在读取工单处理权限与版本…</p>:context.isError?<p role="alert">{errorMessage(context.error)}</p>:<p>工单版本 {context.data.version}{context.data.handling_cycle?' · 处理轮次 '+context.data.handling_cycle.cycle_no:''}</p>}
    <fieldset disabled={blocked||draft.status==='loading'}><legend>沟通责任</legend>
      <label><input type="radio" name={'communication-'+ticketId} value="TAKE_SELECTED" checked={choice==='TAKE_SELECTED'} onChange={()=>setChoice('TAKE_SELECTED')}/>同时承接下方明确选择的沟通会话</label>
      <label><input type="radio" name={'communication-'+ticketId} value="RETAIN_CURRENT" data-action="retain-current-communicator" checked={choice==='RETAIN_CURRENT'} onChange={()=>setChoice('RETAIN_CURRENT')}/>保留当前沟通人</label>
    </fieldset>
    {related.isPending?<p role="status">正在读取真实关联沟通会话…</p>:related.isError?<p role="alert">{errorMessage(related.error)}</p>:<>
      <p>已选择 {selected.length} 个会话（最多 8 个）。</p>
      <ul className="conversation-choices">{related.data.items.map(row=>{const selection=selected.find(item=>item.session_id===row.session_id),stale=selection&&String(selection.expected_row_version)!==row.session_row_version;return <li key={row.session_id}><label><input type="checkbox" data-session-choice={row.session_id} checked={Boolean(selection)} disabled={blocked||draft.status==='loading'||choice==='RETAIN_CURRENT'||(!selection&&(!row.take_allowed||selected.length>=8))} onChange={()=>toggle(row.session_id,row.session_row_version,row.take_allowed)}/><span>{row.conversation_principal_name??'尚未分配沟通人'}<small>会话 {row.session_id} · 版本 {row.session_row_version}{stale?' · 已变更，请取消后重新选择':''}{!row.take_allowed?' · 当前不可承接':''}</small></span></label></li>;})}</ul>
      {!related.data.items.length?<p>当前页没有可读的关联会话。可明确选择保留当前沟通责任。</p>:null}
      <div className="note-controls">{cursor?<button type="button" disabled={blocked||related.isFetching} onClick={()=>setCursor(null)}>回到首批会话</button>:null}{related.data.next_cursor?<button type="button" disabled={blocked||related.isFetching} onClick={()=>setCursor(related.data.next_cursor)}>下一批关联会话</button>:null}</div>
    </>}
    {draft.enabled?<p data-conversation-draft-status role="status">{draft.message}</p>:null}
    <div className="note-controls">{actions.filter(action=>allowed.includes(action)).map(action=><button type="button" key={action} data-action={action} disabled={blocked||!draft.canSubmit||context.isFetching||related.isFetching||related.isError||(choice==='TAKE_SELECTED'&&!selected.length)} onClick={()=>submit(action)}>{action==='take-and-start-with-conversations'?'我来处理':'先接单，稍后处理'}</button>)}
      {state==='unknown'&&pending?<button type="button" data-action="check-conversation-handling" onClick={()=>{void send(pending,true);}}>核对原操作结果</button>:null}
      {!pending&&draft.operationId?<button type="button" data-action="check-expired-conversation-handling" disabled={state==='submitting'||state==='checking'} onClick={checkAcknowledgement}>只读核对原操作</button>:null}
      {draft.enabled&&(selected.length>0||choice==='RETAIN_CURRENT')?<button type="button" data-action="discard-conversation-handling-draft" disabled={state==='submitting'||state==='checking'} onClick={()=>{void draft.discard();}}>丢弃选择内容</button>:null}
      {!blocked?<button type="button" onClick={refresh}>重新读取工单与会话</button>:null}
    </div>
    {!context.isPending&&!context.isError&&!actions.some(action=>allowed.includes(action))&&!pending?<p>当前没有可用的本人承接动作。</p>:null}
    {state!=='idle'?<p className="conversation-handling-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</p>:null}
    {boardMode&&state==='conflict'&&pending?<BoardConflictIntent original={pending} onAdopt={current=>{void draft.knownFailure(pending.command.client_command_id).then(()=>{if(!current())return;setPending(null);setState('idle');setMessage('已保留填写内容，请按当前事实明确新的操作。');refresh();}).catch(()=>{if(current())setMessage('原冲突意图的本地终态清理未确认，原 UUID 和输入继续保留。');});}}/>:null}
  </section>;
}
