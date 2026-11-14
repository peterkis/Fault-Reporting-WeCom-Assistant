import {StepEntry,useNextStep} from '../../design/components/Drawer/NextStep';
import {shortCode} from '../../app/short-code';
import {RadioGroup as HRadioGroup,Radio as HRadio} from "@heroui/react";
import {Button as HButton} from '../../design/components/Button/Button';
import {Checkbox as HCheckbox,Fieldset as HFieldset,Label as HLabel,ListBox} from "@heroui/react";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {ToastFeedback,DraftStatus,DraftFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {DialogAlert,DialogDraftAlert,useDialogToast} from '../../app/DialogFeedback';
import {DetailDialog} from '../../app/DetailDialog';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016AssignmentAction,P2016AssignmentCommand} from '../../api/client';
import {useAssignmentDraft,EMPTY_ASSIGNMENT} from './use-assignment-draft';
import type {AssignmentIntent,AssignmentInput} from './use-assignment-draft';

export function TicketAssignment({ticketId,principal,onBlockedChange,itemLabel='工单',otherBlocked=false}:{ticketId:string;principal:Principal;itemLabel?:string;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const step=useNextStep();
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
  const [open,setOpen]=useState(false);
  const [pending,setPending]=useState<AssignmentIntent|null>(null);
  // Codex review: a settled operation whose draft could not be cleared keeps 「核对结果」, which reads the receipt and clears again.
  const [cleanupFailed,setCleanupFailed]=useState(false);
  // Codex review: the outcome already confirmed while the cleanup is pending; a later lookup that fails or finds no receipt keeps it.
  const settled=useRef<{id:string;state:'succeeded'|'conflict';text:string}|null>(null);
  const [team,setTeam]=useState(''),[person,setPerson]=useState(''),[choice,setChoice]=useState<P2016AssignmentCommand['communication_choice']|null>(null),[selected,setSelected]=useState<P2016AssignmentCommand['sessions']>([]),[cursor,setCursor]=useState<string|null>(null),[state,setState]=useState<'idle'|'submitting'|'unknown'|'conflict'|'denied'|'succeeded'>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const targets=useQuery({queryKey:['ticket-assignment-targets',principal.principal_id,ticketId,team,person],queryFn:({signal})=>api.assignmentTargets(ticketId,team||null,signal,person||null),enabled:context.isSuccess&&!(context.isPending||context.isError)&&context.data.allowed_actions.some(action=>action==='assign'||action==='transfer-assignment'),gcTime:0});
  const related=useQuery({queryKey:['ticket-related-conversations',principal.principal_id,ticketId,cursor],queryFn:({signal})=>api.relatedConversations(ticketId,cursor,signal),gcTime:0});
  const setInput=(value:AssignmentInput)=>{setTeam(value.team);setPerson(value.person);setChoice(value.choice);setSelected(value.sessions);};
  const draft=useAssignmentDraft({ticketId,principal,value:{team,person,choice,sessions:selected},pending,onRestore:copy=>{setOpen(true);setInput(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage((draft.enabled?'结果未确认：网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。':'结果未确认：网络中断，暂不确定是否已提交。点击「重新提交」，会按原操作编号提交，已提交的不会重复办理。'));}},onSensitiveClear:()=>{generation.current++;request.current?.abort();request.current=null;setInput(EMPTY_ASSIGNMENT);setPending(null);setOpen(false);setState('idle');setMessage('');},onOperation:()=>{setOpen(true);setPending(null);setState('unknown');setMessage('结果未知：当前敏感内容不可用，只能核对上次操作。');}});
  const busy=state==='submitting'||state==='unknown',blocked=busy||cleanupFailed||draft.restorationBlocked,navigationBlocked=busy||(draft.enabled&&Boolean(team||person||choice||selected.length)&&!draft.safeToLeave);
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refresh=()=>{for(const key of [['ticket-command-context',principal.principal_id,ticketId],['ticket-related-conversations',principal.principal_id,ticketId],['ticket-assignment-targets',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id],['ticket-round-notifications',principal.principal_id,ticketId],['web-report',principal.principal_id,'ticket',ticketId]])void client.invalidateQueries({queryKey:key});};
  const mutation=useMutation({mutationKey:['ticket-assignment',principal.principal_id,ticketId],mutationFn:({intent,signal}:{intent:AssignmentIntent;signal:AbortSignal;token:number})=>api.assignTicket(ticketId,intent.action,intent.command,principal.csrf_token,signal),
    onSuccess:async(_result,variables)=>{if(variables.token!==generation.current)return;settlingOwn.current=true;let cleaned=false;try{cleaned=await draft.settle(variables.intent.command.client_command_id);}finally{settlingOwn.current=false;}if(variables.token!==generation.current)return;if(replacedBy(variables.intent.command.client_command_id,cleaned,'责任已交接'))return;settled.current=cleaned?null:{id:variables.intent.command.client_command_id,state:'succeeded',text:'责任已交接'};setCleanupFailed(!cleaned);setInput(EMPTY_ASSIGNMENT);setPending(null);setState('succeeded');setMessage('责任已交接，正在读取工单信息。'+(cleaned?'':' 草稿未能清空：为避免重复提交，暂时只能查看。点击「核对结果」再次清除。'));refresh();if(cleaned)setOpen(false);},
    onError:async(error,variables)=>{if(variables.token!==generation.current)return;if(error instanceof ApiError){setPending(null);await draft.knownFailure(variables.intent.command.client_command_id).catch(()=>{});if(variables.token!==generation.current)return;setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'操作冲突，请重新读取工单与目标后明确确认。':errorMessage(error));if(error.status===409)refresh();}else{setPending(variables.intent);setState('unknown');setMessage((draft.enabled?'结果未确认：网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。':'结果未确认：网络中断，暂不确定是否已提交。点击「重新提交」，会按原操作编号提交，已提交的不会重复办理。'));}},onSettled:()=>{request.current=null;}});
  const acknowledgement=useMutation({mutationKey:['ticket-assignment-ack',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.assignmentAcknowledgement(ticketId,commandId,signal),onSuccess:async(result,variables)=>{if(!mine(variables.signal))return;if(stale(variables.commandId))return;if(result.state==='UNKNOWN'){if(keepSettled(variables.commandId))return;setState('unknown');setMessage('结果仍未知，未找到终态不代表未提交；请继续只读核对。');return;}settlingOwn.current=true;let cleaned=false;try{cleaned=await draft.settle(variables.commandId);}finally{settlingOwn.current=false;}if(!mine(variables.signal))return;if(replacedBy(variables.commandId,cleaned,result.state==='COMMITTED'?'上次操作已提交':'上次操作没有成功'))return;settled.current=cleaned?null:{id:variables.commandId,state:result.state==='COMMITTED'?'succeeded':'conflict',text:result.state==='COMMITTED'?'已提交':'上次操作没有成功'};setCleanupFailed(!cleaned);setInput(EMPTY_ASSIGNMENT);setPending(null);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已核对原操作结果：已提交。':'已核对原操作失败，请读取工单信息后明确新的操作。')+(cleaned?'':' 草稿未能清空：为避免重复提交，暂时只能查看。点击「核对结果」再次清除。'));refresh();if(cleaned)setOpen(false);},onError:(_error,variables)=>{if(!mine(variables.signal))return;if(stale(variables.commandId))return;if(keepSettled(variables.commandId))return;setState('unknown');setMessage('只读核对失败，原操作仍未知；未发送新的操作。');},onSettled:(_result,_error,variables)=>{if(lookup.current?.controller.signal===variables.signal)lookup.current=null;if(request.current?.signal===variables.signal)request.current=null;}});
  // Codex review: once the shared operation is gone (another tab cleared it), the lock and the kept outcome end here too.
  useEffect(()=>{if(!cleanupFailed||pending||draft.operationId)return;const known=settled.current;settled.current=null;setCleanupFailed(false);if(known)setMessage(known.text+'；草稿已清空。');},[cleanupFailed,pending,draft.operationId]);
  // Codex review: the kept outcome is reused only for the operation it belongs to.
  // Codex review: when another tab has already put a new operation in the shared draft, this outcome is reported as the earlier
  // operation's and the page moves on to the new one instead of offering to clear the old one again.
  const replacedBy=(commandId:string,cleaned:boolean,text:string)=>{const now=draft.currentOperation();if(cleaned||!now||now===commandId)return false;settled.current=null;setCleanupFailed(false);setInput(EMPTY_ASSIGNMENT);setPending(null);setState('unknown');setMessage('操作尾号 '+shortCode(commandId,[now])+'：'+text+'。另一个页面已开始新的派单操作，点击「核对结果」查看新操作。');refresh();return true;};
  // A lookup that returns after another tab replaced its operation says only that, never the old result beside the new one.
  const stale=(commandId:string)=>{const now=draft.currentOperation();if(!now||now===commandId||pending?.command.client_command_id===commandId)return false;settled.current=null;setCleanupFailed(false);setState('unknown');setMessage('另一个页面已开始新的派单操作，点击「核对结果」查看新操作。');return true;};
  // Codex review: a lookup's callbacks act only while it is still this form's request (not cancelled or replaced).
  const mine=(signal:AbortSignal)=>!signal.aborted&&request.current?.signal===signal;
  // When the shared draft moves to another operation, a lookup still running for the earlier one is cancelled.
  // The lookup's operation belongs to its own controller and ends with it, so a finished lookup never cancels a later submit.
  // Another page replacing the operation, or clearing one restored only by its number, cancels a lookup still running; this
  // form clearing its own draft (settlingOwn) does not.
  const lookup=useRef<{id:string;controller:AbortController}|null>(null),settlingOwn=useRef(false);
  useEffect(()=>{const running=lookup.current;if(!running||request.current!==running.controller||settlingOwn.current||draft.operationId===running.id)return;
    if(!draft.operationId&&pending)return;
    running.controller.abort();request.current=null;lookup.current=null;settled.current=null;setCleanupFailed(false);
    if(draft.operationId){setState('unknown');setMessage('另一个页面已开始新的派单操作，点击「核对结果」查看新操作。');}else{setState('idle');setMessage('上次的派单操作已在另一个页面处理完，草稿已清空。');}
  },[draft.operationId]);
  const keepSettled=(commandId:string)=>{const known=settled.current;if(!known||known.id!==commandId)return false;setState(known.state);setMessage(known.text+'；这次没有核对完成，草稿仍未清空：为避免重复提交，暂时只能查看。稍后再点击「核对结果」。');return true;};
  const send=async(intent:AssignmentIntent,checking=false)=>{if(request.current||(!checking&&!workbenchTransportWritable()))return;const controller=new AbortController(),token=generation.current;request.current=controller;setPending(intent);setState('submitting');setMessage(checking?'正在核对原操作结果…':'正在提交责任交接…');try{await draft.prepare(intent);}catch{request.current=null;setState(checking?'unknown':'denied');setMessage('恢复存储尚未准备，本次未发送新的操作。');return;}if(!controller.signal.aborted&&generation.current===token)mutation.mutate({intent,signal:controller.signal,token});};
  const check=()=>{const commandId=pending?.command.client_command_id??draft.operationId;if(request.current||!commandId)return;if(!draft.enabled&&pending){void send(pending,true);return;}const controller=new AbortController();request.current=controller;lookup.current={id:commandId,controller};setState('submitting');setMessage('正在核对上次操作…');acknowledgement.mutate({commandId,signal:controller.signal});};
  const allowed=context.data?.allowed_actions??[],action:P2016AssignmentAction=allowed.includes('assign')?'assign':'transfer-assignment';
  const submit=()=>{if(blocked||otherBlocked||!draft.canSubmit||request.current||!context.data||!allowed.includes(action)||(context.isPending||context.isError)||(targets.isPending||targets.isError)||!workbenchTransportWritable()||!choice||(choice==='TRANSFER_SELECTED'&&(!selected.length||related.isPending||related.isError))||!team||!targets.data?.items.some(item=>item.principal_id===person))return;
    void send(Object.freeze({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:action==='assign'?'WORKBENCH_ASSIGN':'WORKBENCH_TRANSFER',target_principal_id:person,resolver_team_id:team,communication_choice:choice,sessions:Object.freeze(choice==='RETAIN_CURRENT'?[]:selected.map(row=>Object.freeze({...row})))} )}));};
  // Card 34A: while the form is open as a modal, its own outcome and draft notices show inside it; only later ones become page
  // toasts. Inside the next-step card the same form opens inline in the drawer, not as a modal, and keeps its toasts.
  const modalOpen=open&&!step,messageToast=useDialogToast(modalOpen,messageRevision),draftToast=useDialogToast(modalOpen,draft.message);
  const toggle=(sessionId:string,version:string,permitted:boolean)=>{if(blocked)return;setSelected(previous=>previous.some(row=>row.session_id===sessionId)?previous.filter(row=>row.session_id!==sessionId):permitted&&previous.length<8?[...previous,{session_id:sessionId,expected_row_version:Number(version)}]:previous);};
  if(!allowed.includes(action)&&!pending&&!draft.operationId&&!team&&!person&&!choice&&!selected.length&&state==='idle'&&context.isSuccess&&!context.isError)return null;
  return <section className="ticket-notes ticket-assignment detail-action-controller" aria-label="工单派单与转派">
    {allowed.includes(action)||pending||draft.operationId||team||person||choice||selected.length?<StepEntry action="assign" label={pending||draft.operationId?'核对派单':action==='assign'?'派单给…':'转交'} fallbackTone={'secondary'}>{(tone,text)=><HButton type="button" data-action="open-assignment" isDisabled={state==='submitting'||otherBlocked&&!pending&&!draft.operationId} onClick={()=>setOpen(true)} tone={tone}>{text}</HButton>}</StepEntry>:null}
    {context.isError&&!open?<HButton type="button" onClick={()=>{void context.refetch();}} tone="secondary">重试读取派单权限</HButton>:null}
    <DetailDialog open={open} onClose={()=>setOpen(false)} closeBlocked={state==='submitting'} title="派单" closeLabel="关闭派单窗口" className="detail-action-dialog detail-assignment-dialog">
    <p className="detail-operation-context">{itemLabel}</p>
    {context.isError||targets.isError?<p role="alert">{errorMessage(context.error??targets.error)}</p>:null}
    <WorkbenchSelect label={<>处理组</>} value={team} isDisabled={blocked||(targets.isPending||targets.isError)} onChange={event=>{setTeam(event);setPerson('');}}><ListBox.Item id="" textValue={"请选择处理组"}>请选择处理组<ListBox.ItemIndicator/></ListBox.Item>{targets.data?.resolver_teams.map(group=><ListBox.Item key={group.team_id} id={group.team_id} textValue={String(group.display_name)}>{group.display_name}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
    <WorkbenchSelect label={<>处理人</>} value={person} isDisabled={blocked||!team||(targets.isPending||targets.isError)} onChange={event=>setPerson(event)}><ListBox.Item id="" textValue={"请选择处理同事"}>请选择处理同事<ListBox.ItemIndicator/></ListBox.Item>{targets.data?.items.map(item=><ListBox.Item key={item.principal_id} id={item.principal_id} textValue={String(item.display_name)}>{item.display_name}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
    <HRadioGroup className="workbench-radio-group" name={'assignment-communication-'+ticketId} value={choice??''} onChange={next=>{if(next==="RETAIN_CURRENT"){setChoice('RETAIN_CURRENT');}if(next==="TRANSFER_SELECTED"){setChoice('TRANSFER_SELECTED');}}} isDisabled={blocked}><HLabel>沟通责任</HLabel><HRadio value={"RETAIN_CURRENT"}><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>保留当前沟通责任</HRadio.Content></HRadio><HRadio value={"TRANSFER_SELECTED"}><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>将下方明确选择的沟通交给承接同事</HRadio.Content></HRadio></HRadioGroup>
    {choice==='TRANSFER_SELECTED'?<>
      {related.isError?<p role="alert">{errorMessage(related.error)}</p>:null}
      <p>已选择 {selected.length} 个会话（最多 8 个）。</p>
      <ul className="conversation-choices">{related.data?.items.map((row,index)=><li key={row.session_id}><HCheckbox data-session-choice={row.session_id} isSelected={selected.some(item=>item.session_id===row.session_id)} isDisabled={blocked||(!selected.some(item=>item.session_id===row.session_id)&&(!row.take_allowed||selected.length>=8))} onChange={()=>toggle(row.session_id,row.session_row_version,row.take_allowed)}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control>关联会话 {index+1}· {row.conversation_principal_name??'尚未分配沟通人'}<small>{!row.take_allowed?'当前不能转交。':''}{selected.some(item=>item.session_id===row.session_id&&String(item.expected_row_version)!==row.session_row_version)?'内容已变化，请重新选择。':''}</small></HCheckbox.Content></HCheckbox></li>)}</ul>
      {cursor?<HButton type="button" isDisabled={blocked||(related.isPending||related.isError)} onClick={()=>setCursor(null)} tone="secondary">回到首批会话</HButton>:null}
      {related.data?.next_cursor?<HButton type="button" isDisabled={blocked||(related.isPending||related.isError)} onClick={()=>setCursor(related.data.next_cursor)} tone="secondary">下一批关联会话</HButton>:null}
    </>:null}
    <p>责任交接不会接单或开始处理；沟通责任按明确选择处理。</p>
    {draft.enabled?<DraftStatus notify={false} data-assignment-draft-status role="status">{draft.message}</DraftStatus>:null}
    {modalOpen&&draft.enabled?<DialogDraftAlert>{draft.message}</DialogDraftAlert>:null}{modalOpen&&message?<DialogAlert source="ticket-assignment" state={state} role={['unknown','denied','conflict'].includes(state)?'alert':'status'}>{message}</DialogAlert>:null}
    <HButton type="button" data-action={action} isDisabled={blocked||otherBlocked||!draft.canSubmit||context.isPending||context.isError||targets.isPending||targets.isError||!allowed.includes(action)||!team||!person||!choice||(choice==='TRANSFER_SELECTED'&&(!selected.length||related.isPending||related.isError))} onClick={submit} tone={step?'secondary':'primary'}>{action==='assign'?'确认派单':'确认转派'}</HButton>
    {(state==='unknown'||cleanupFailed)&&(pending||draft.operationId)?<HButton type="button" data-action="check-assignment-command" onClick={check} tone="secondary">{!draft.enabled&&pending?'重新提交':'核对结果'}</HButton>:null}
    {draft.enabled&&Boolean(team||person||choice||selected.length)&&!blocked?<HButton type="button" data-action="discard-assignment-draft" onClick={()=>{void draft.discard();}} tone="secondary">丢弃选择内容</HButton>:null}

    </DetailDialog><DraftFeedback enabled={draft.enabled&&draftToast}>{draft.message}</DraftFeedback>{message?<ToastFeedback enabled={messageToast} revision={messageRevision} source="ticket-assignment" state={state} role={['unknown','denied','conflict'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}

  </section>;
}
