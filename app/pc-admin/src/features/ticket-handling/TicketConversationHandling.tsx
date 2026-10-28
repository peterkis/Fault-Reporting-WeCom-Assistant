import {RadioGroup as HRadioGroup,Radio as HRadio} from "@heroui/react";
import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox,Fieldset as HFieldset,Label as HLabel} from "@heroui/react";
import {ToastFeedback,DraftStatus,DraftFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {DetailDialog} from '../../app/DetailDialog';
import {ChevronDown} from 'lucide-react';
import {BoardConflictIntent} from '../board-actions/BoardConflictIntent';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016ConversationHandlingCommand,P2016ConversationHandlingAction} from '../../api/client';
import {useConversationHandlingDraft} from './use-conversation-handling-draft';
import type {ConversationHandlingIntent} from './use-conversation-handling-draft';

type Selection=P2016ConversationHandlingCommand['sessions'];
type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketConversationHandling({ticketId,principal,onBlockedChange,boardMode=false,otherBlocked=false}:{ticketId:string;principal:Principal;boardMode?:boolean;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[pending,setPending]=useState<ConversationHandlingIntent|null>(null);
  const [choice,setChoice]=useState<P2016ConversationHandlingCommand['communication_choice']>('TAKE_SELECTED'),[selected,setSelected]=useState<Selection>([]),[cursor,setCursor]=useState<string|null>(null);
  const [manualSelection,setManualSelection]=useState(false),[open,setOpen]=useState(false),[needsReview,setNeedsReview]=useState(false);
  const draft=useConversationHandlingDraft({ticketId,principal,value:{choice,sessions:selected},pending,onRestore:value=>{setOpen(true);setNeedsReview(true);setChoice(value.choice);setSelected(value.sessions);setPending(value.pending);if(value.pending){setState('unknown');setMessage('结果未知：已恢复原操作，请核对原动作与版本。');}},onSensitiveClear:()=>{request.current?.abort();request.current=null;setChoice('TAKE_SELECTED');setSelected([]);setPending(null);setOpen(false);setNeedsReview(false);setState('idle');setMessage('');},onOperation:()=>{setOpen(true);setNeedsReview(true);setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能核对上次操作。');}});
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  // Each page is bounded to 20. Only explicitly selected identities and original versions cross pages.
  const related=useQuery({queryKey:['ticket-related-conversations',principal.principal_id,ticketId,cursor],queryFn:({signal})=>api.relatedConversations(ticketId,cursor,signal),gcTime:0});
  const blocked=['submitting','checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending);
  const navigationBlocked=Boolean(boardMode&&pending)||(blocked||(draft.enabled&&(selected.length>0||choice==='RETAIN_CURRENT')))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refresh=()=>{for(const key of [['ticket-command-context',principal.principal_id,ticketId],['ticket-related-conversations',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id],['ticket-round-notifications',principal.principal_id,ticketId],['web-report',principal.principal_id,'ticket',ticketId]])void client.invalidateQueries({queryKey:key});};
  const mutation=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],
    mutationFn:({intent,signal}:{intent:ConversationHandlingIntent;signal:AbortSignal})=>api.handleConversations(ticketId,intent.action,intent.command,principal.csrf_token,signal),
    onSuccess:async(_result,variables)=>{const cleaned=await draft.settle(variables.intent.command.client_command_id);setPending(null);setSelected([]);setState('succeeded');if(cleaned){setOpen(false);setNeedsReview(false);setManualSelection(false);}setMessage((variables.intent.action==='accept-for-later-with-conversations'?'已接单，沟通责任已按选择处理。':'已开始处理，沟通责任已按选择处理。')+(cleaned?'':' 本地副本清理尚未确认，禁止新操作。'));refresh();},
    onError:async(error,variables)=>{if(error instanceof ApiError){setPending(boardMode&&error.status===409?variables.intent:null);if(!(boardMode&&error.status===409))await draft.knownFailure(variables.intent.command.client_command_id).catch(()=>{});setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'操作冲突：原会话选择保留，请重新读取并确认版本。':'操作被拒绝：'+errorMessage(error));if(error.status===409)refresh();}else{setPending(variables.intent);setState('unknown');setMessage('结果未知：请核对原操作；原动作、工单版本、会话选择及版本保持不变。');}},
    onSettled:()=>{request.current=null;},
  });
  const send=async(intent:ConversationHandlingIntent,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，新操作尚未准备或发送；选择已保留，请重新读取。');return;}
    if(request.current)return;const controller=new AbortController();request.current=controller;setPending(intent);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在提交处理操作…');try{await draft.prepare(intent);}catch{request.current=null;if(checking){setState('unknown');setMessage('原操作仍未知，恢复存储不可用，尚未再次发送。');}else{setPending(null);setState('denied');setMessage('恢复副本尚未保存，操作尚未发送。');}return;}if(!controller.signal.aborted)mutation.mutate({intent,signal:controller.signal});};
  const acknowledgement=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.conversationHandlingAcknowledgement(ticketId,commandId,signal),
    onSuccess:async(result,variables)=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知，未找到终态不代表未提交；请继续只读核对。');refresh();return;}const cleaned=await draft.settle(variables.commandId);setPending(null);setSelected([]);setState(result.state==='COMMITTED'?'succeeded':'conflict');if(cleaned){setOpen(false);setNeedsReview(false);setManualSelection(false);}setMessage((result.state==='COMMITTED'?'已核对原操作结果：已提交。':'已核对原操作失败，请读取工单信息后明确新的操作。')+(cleaned?'':' 本地副本清理尚未确认，禁止新操作。'));refresh();},onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const checkAcknowledgement=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在核对上次操作…');acknowledgement.mutate({commandId:draft.operationId,signal:controller.signal});};
  const submit=(action:P2016ConversationHandlingAction)=>{
    // Clicking the named combined action explicitly selects this sole current Session.
    // Rendering the shortcut never assigns responsibility or submits a command.
    const sessions=simpleSession?[{session_id:simpleSession.session_id,expected_row_version:Number(simpleSession.session_row_version)}]:selected;
    if(blocked||otherBlocked||!draft.canSubmit||(context.isPending||context.isError)||related.isPending||related.isError||!context.data?.allowed_actions.includes(action)||(!noSessions&&choice==='TAKE_SELECTED'&&!sessions.length))return;
    const communicationChoice=noSessions?'RETAIN_CURRENT':choice;
    if(noSessions)setChoice('RETAIN_CURRENT');
    if(simpleSession)setSelected(sessions);
    void send(Object.freeze({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:context.data.resolver_team_id,communication_choice:communicationChoice,sessions:Object.freeze(communicationChoice==='RETAIN_CURRENT'?[]:sessions.map(row=>Object.freeze({...row})))})}),false);
  };
  const toggle=(sessionId:string,version:string,allowed:boolean)=>{
    if(blocked)return;
    setSelected(previous=>{if(previous.some(row=>row.session_id===sessionId))return previous.filter(row=>row.session_id!==sessionId);if(!allowed||previous.length>=8)return previous;return [...previous,{session_id:sessionId,expected_row_version:Number(version)}];});
  };
  const allowed=context.data?.allowed_actions??[];
  const noSessions=related.isSuccess&&!related.isError&&!cursor&&related.data.items.length===0&&!related.data.next_cursor&&selected.length===0;
  const onlySession=related.isSuccess&&!related.isError&&!cursor&&!related.data.next_cursor&&related.data.items.length===1?related.data.items[0]:undefined;
  const simpleSession=!draft.enabled&&!boardMode&&!manualSelection&&state==='idle'&&choice==='TAKE_SELECTED'&&selected.length===0&&allowed.includes('take-and-start-with-conversations')&&onlySession?.take_allowed&&((onlySession.conversation_principal_id===null&&onlySession.assignment_status!=='ASSIGNED')||onlySession.conversation_principal_id===principal.principal_id)?onlySession:undefined;
  const originalId=pending?.command.client_command_id??draft.operationId;
  const canStart=allowed.includes('take-and-start-with-conversations');
  const direct=Boolean((simpleSession||noSessions)&&!manualSelection&&!needsReview&&!originalId&&state!=='conflict');
  useEffect(()=>{if(state==='unknown'||boardMode&&state==='conflict'&&pending)setOpen(true);},[state,boardMode,pending]);
  // Old purposes remain readable/recoverable, but no new accept-for-later action is offered.
  if(!canStart&&!originalId&&state==='idle'&&selected.length===0&&choice!=='RETAIN_CURRENT'&&context.isSuccess&&!context.isError)return null;
  if(!canStart&&!originalId&&state==='succeeded'&&context.data?.handling_cycle?.staff_completion_event_id)return null;
  if(!canStart&&!originalId&&state==='succeeded')return <section className="ticket-notes ticket-conversation-handling workflow-result detail-action-controller"><ToastFeedback revision={messageRevision} source="ticket-conversation-handling" state={state} className="conversation-handling-state" role="status">{message}</ToastFeedback></section>;
  const openOptions=()=>{setManualSelection(true);setOpen(true);};
  return <section data-activity-field="ticket-handling" className="ticket-notes ticket-conversation-handling detail-action-controller" aria-label="本人承接工单与沟通">
    {simpleSession&&!originalId?<p className="detail-action-hint">接单后同时负责回复</p>:null}
    <div className="note-controls">
      {originalId?<HButton type="button" data-action="open-conversation-handling-recovery" isDisabled={state==='submitting'||state==='checking'} onClick={()=>setOpen(true)} variant="secondary">核对接单</HButton>:canStart?<>
        {simpleSession?<HButton type="button" className="icon-button" aria-label="接单选项" title="接单选项" isDisabled={blocked||otherBlocked} onClick={openOptions} variant="secondary"><ChevronDown size={16}/></HButton>:null}
        <HButton type="button" className="take-and-start" data-action="take-and-start-with-conversations" isDisabled={blocked||otherBlocked||context.isPending||context.isError||related.isPending||related.isError||draft.status==='loading'} onClick={()=>{if(direct)submit('take-and-start-with-conversations');else setOpen(true);}} variant="secondary">接单</HButton>
      </>:null}
    </div>
    <DetailDialog open={open} onClose={()=>setOpen(false)} closeBlocked={state==='submitting'||state==='checking'} title="接单选项" closeLabel="关闭接单选项" className="detail-action-dialog detail-accept-dialog">
      {context.isPending?<p role="status">正在读取可用操作…</p>:context.isError?<p role="alert">{errorMessage(context.error)}</p>:null}
      {noSessions?<p>接单后由您开始处理，当前没有需要接管的在线会话。</p>:<HRadioGroup className="workbench-radio-group" name={'communication-'+ticketId} value={choice??''} onChange={next=>{if(next==="TAKE_SELECTED"){setChoice('TAKE_SELECTED');}if(next==="RETAIN_CURRENT"){setChoice('RETAIN_CURRENT');}}} isDisabled={blocked||draft.status==='loading'}><HLabel>在线沟通由谁负责</HLabel><HRadio value={"TAKE_SELECTED"}><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>同时负责所选会话的回复</HRadio.Content></HRadio><HRadio value={"RETAIN_CURRENT"} data-action="retain-current-communicator"><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>保留当前沟通人</HRadio.Content></HRadio></HRadioGroup>}
      {related.isPending?<p role="status">正在读取关联会话…</p>:related.isError?<p role="alert">{errorMessage(related.error)}</p>:<>
        {!noSessions?<p>已选择 {selected.length} 个会话（最多 8 个）。</p>:null}
        <ul className="conversation-choices">{related.data.items.map((row,index)=>{const selection=selected.find(item=>item.session_id===row.session_id),stale=selection&&String(selection.expected_row_version)!==row.session_row_version;return <li key={row.session_id}><HCheckbox data-session-choice={row.session_id} isSelected={Boolean(selection)} isDisabled={blocked||draft.status==='loading'||choice==='RETAIN_CURRENT'||(!selection&&(!row.take_allowed||selected.length>=8))} onChange={()=>toggle(row.session_id,row.session_row_version,row.take_allowed)}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control><span>关联会话 {index+1} · {row.conversation_principal_name??'尚未分配沟通人'}<small>{stale?'内容已变化，请重新选择。':!row.take_allowed?'当前不能接管回复。':'接单后由您回复。'}</small></span></HCheckbox.Content></HCheckbox></li>;})}</ul>
        <div className="note-controls">{cursor?<HButton type="button" isDisabled={blocked||related.isPending||related.isError} onClick={()=>setCursor(null)} variant="secondary">回到首批会话</HButton>:null}{related.data.next_cursor?<HButton type="button" isDisabled={blocked||related.isPending||related.isError} onClick={()=>setCursor(related.data.next_cursor)} variant="secondary">下一批关联会话</HButton>:null}</div>
      </>}
      {draft.enabled?<DraftStatus notify={false} data-conversation-draft-status role="status">{draft.message}</DraftStatus>:null}
      <div className="note-controls">
        {canStart?<HButton type="button" className="take-and-start" data-action="confirm-conversation-handling" isDisabled={blocked||otherBlocked||!draft.canSubmit||context.isPending||context.isError||related.isPending||related.isError||!noSessions&&choice==='TAKE_SELECTED'&&!selected.length} onClick={()=>submit('take-and-start-with-conversations')} variant="secondary">确认接单并开始处理</HButton>:null}
        {state==='unknown'&&pending?<HButton type="button" data-action="check-conversation-handling" onClick={()=>{void send(pending,true);}} variant="secondary">核对原操作结果</HButton>:null}
        {!pending&&draft.operationId?<HButton type="button" data-action="check-expired-conversation-handling" isDisabled={state==='submitting'||state==='checking'} onClick={checkAcknowledgement} variant="secondary">核对上次操作</HButton>:null}
        {draft.enabled&&(selected.length>0||choice==='RETAIN_CURRENT')?<HButton type="button" data-action="discard-conversation-handling-draft" isDisabled={state==='submitting'||state==='checking'} onClick={()=>{void draft.discard();}} variant="secondary">丢弃选择内容</HButton>:null}
        {!blocked?<HButton type="button" data-action="refresh-conversation-handling" onClick={refresh} variant="secondary">刷新</HButton>:null}
      </div>
      {boardMode&&state==='conflict'&&pending?<BoardConflictIntent original={pending} onAdopt={current=>draft.knownFailure(pending.command.client_command_id).then(cleaned=>{if(!current())return;if(!cleaned){setMessage('原冲突意图的本地终态清理未确认，原 UUID 和会话选择继续保留。');return;}setPending(null);setState('idle');setMessage('已保留会话选择，请核对当前可选会话和版本后明确新的操作。');refresh();}).catch(()=>{if(current())setMessage('原冲突意图的本地终态清理未确认，原 UUID 和会话选择继续保留。');})}/>:null}
    </DetailDialog>
      {state!=='idle'?<ToastFeedback revision={messageRevision} source="ticket-conversation-handling" state={state} className="conversation-handling-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
    <DraftFeedback enabled={draft.enabled}>{draft.message}</DraftFeedback>

    {!open&&(context.isError||related.isError)?<HButton type="button" onClick={refresh} variant="secondary">重试读取接单选项</HButton>:null}
  </section>;
}
