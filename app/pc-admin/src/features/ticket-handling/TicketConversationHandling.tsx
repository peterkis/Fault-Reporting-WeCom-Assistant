import {ErrorState} from '../../design/components/ErrorState/ErrorState';
import {DetailLoading} from '../../app/DetailLoading';
import {StepEntry,useNextStep} from '../../design/components/Drawer/NextStep';
import {RadioGroup as HRadioGroup,Radio as HRadio} from "@heroui/react";
import {Button as HButton} from '../../design/components/Button/Button';
import {Checkbox as HCheckbox,Fieldset as HFieldset,Label as HLabel} from "@heroui/react";
import {ToastFeedback,DraftStatus,DraftFeedback,showErrorActionToast,showSuccessToast,showUndoToast,useFeedbackState} from '../../app/ToastFeedback';
import {DialogAlert,DialogDraftAlert,useDialogToast} from '../../app/DialogFeedback';
import {DetailDialog} from '../../app/DetailDialog';
import {ChevronDown} from 'lucide-react';
import {BoardConflictIntent} from '../board-actions/BoardConflictIntent';
import {SelectedSessions,useSeenSessions} from '../../app/SelectedSessions';
import {useFullNumbers} from '../../app/FullNumbers';
import {shortCodes} from '../../app/short-code';
import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,UnconfirmedClaimReplay,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016ConversationHandlingCommand,P2016ConversationHandlingAction,WorkbenchCard} from '../../api/client';
import {useConversationHandlingDraft} from './use-conversation-handling-draft';
import type {ConversationHandlingIntent} from './use-conversation-handling-draft';
import {markSelfWrite} from '../../design/motion/self-write';
import {OPTIMISTIC_UNKNOWN_TIMEOUT_MS} from '../optimistic/constants';
import {nowShanghaiLocalString} from '../optimistic/overlay';
import {beginOptimisticOverlay,captureDisplayedCardPosition,confirmOptimisticOverlay,getDisplayedCard,markOptimisticUnknown,optimisticItemKey,removeOptimisticOverlay,triggerRollbackCue} from '../optimistic/store';
import type {CardPositionAnchor} from '../optimistic/store';
import {canUndoClaim,currentUserDisplayName,executeClaimUndo,lookupClaimWinnerName} from '../optimistic/undo-actions';
import {dispatchConversationClaim,forgetRecoveredCommand,useCommandRecovery} from '../optimistic/command-recovery';

type Selection=P2016ConversationHandlingCommand['sessions'];
type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
type ConvOptimisticMeta={active:boolean;instantClaim:boolean;commandId:string;itemSnapshot:WorkbenchCard|null;restorePosition:CardPositionAnchor|undefined};
type ConvMutationVars={intent:ConversationHandlingIntent;checking:boolean;controller:AbortController;signal:AbortSignal;timerRef:{id:number|undefined};timedOutRef:{current:boolean};meta:ConvOptimisticMeta};

export function TicketConversationHandling({ticketId,principal,onBlockedChange,boardMode=false,otherBlocked=false}:{ticketId:string;principal:Principal;boardMode?:boolean;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),navigate=useNavigate(),location=useLocation(),request=useRef<AbortController|null>(null);
  const fullNumbers=useFullNumbers(),sessionsSeen=useSeenSessions();
  const [state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[pending,setPending]=useState<ConversationHandlingIntent|null>(null),[suppressToast,setSuppressToast]=useState(false);
  const [choice,setChoice]=useState<P2016ConversationHandlingCommand['communication_choice']>('TAKE_SELECTED'),[selected,setSelected]=useState<Selection>([]),[cursor,setCursor]=useState<string|null>(null);
  const [manualSelection,setManualSelection]=useState(false),[open,setOpen]=useState(false),[needsReview,setNeedsReview]=useState(false);
  const draft=useConversationHandlingDraft({ticketId,principal,value:{choice,sessions:selected},pending,onRestore:value=>{setOpen(true);setNeedsReview(true);setChoice(value.choice);setSelected(value.sessions);setPending(value.pending);if(value.pending){setState('unknown');setMessage('结果未确认：网络中断，暂不确定是否已提交。点击「重新提交」，会按原操作编号提交，已提交的不会重复办理。');}},onSensitiveClear:()=>{request.current?.abort();request.current=null;setChoice('TAKE_SELECTED');setSelected([]);setPending(null);setOpen(false);setNeedsReview(false);setState('idle');setMessage('');},onOperation:()=>{setOpen(true);setNeedsReview(true);setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能核对上次操作。');},onOperationCleared:()=>{request.current?.abort();request.current=null;setPending(null);setState('idle');setMessage('');}});
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  // Each page is bounded to 20. Only explicitly selected identities and original versions cross pages.
  const related=useQuery({queryKey:['ticket-related-conversations',principal.principal_id,ticketId,cursor],queryFn:({signal})=>api.relatedConversations(ticketId,cursor,signal),gcTime:0});
  sessionsSeen.remember(related.data?.items);
  const sessionCodes=shortCodes([...(related.data?.items??[]).map(row=>row.session_id),...selected.map(row=>row.session_id),...sessionsSeen.seen.current.keys()]);
  const temporaryRelatedFailure=related.isError&&!(related.error instanceof ApiError&&[401,403,404].includes(related.error.status));
  const scope={principal:principal.principal_id,kind:'ticket',itemId:ticketId};
  const held=useCommandRecovery(scope,'conversation');
  const recovered=held?.unknown&&held.intent.purpose==='conversation'?held.intent:null;
  const receiptId=draft.enabled?(draft.operationId??recovered?.id):null;
  const replay=state==='unknown'&&pending?pending:!draft.enabled?recovered?.replay:undefined;
  const blocked=Boolean(held)||draft.restoring||draft.restorationBlocked||['submitting','checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending);
  const memoryOnly=Boolean(recovered&&recovered.id!==draft.operationId);
  const navigationBlocked=memoryOnly||state==='submitting'||Boolean(boardMode&&pending)||(['checking','unknown'].includes(state)||Boolean(pending)||Boolean(draft.operationId)||(draft.enabled&&(selected.length>0||choice==='RETAIN_CURRENT'||draft.hasUnsavedInput())))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refreshQueries=(afterReturn?:Promise<void>)=>{
    for(const key of [['ticket-command-context',principal.principal_id,ticketId],['ticket-related-conversations',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['ticket-round-notifications',principal.principal_id,ticketId],['web-report',principal.principal_id,'ticket',ticketId]])void client.invalidateQueries({queryKey:key});
    const refreshBoard=()=>client.invalidateQueries({queryKey:['board',principal.principal_id]});
    if(afterReturn)void afterReturn.then(refreshBoard);else void refreshBoard();
  };
  const refresh=()=>refreshQueries();
  const mutation=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],
    mutationFn:({intent,signal,checking}:ConvMutationVars)=>dispatchConversationClaim(scope,intent,draft.enabled,signal,
      ()=>api.handleConversations(ticketId,intent.action,intent.command,principal.csrf_token,signal,checking)),
    onSuccess:async(result,variables)=>{
      if(variables.timerRef.id!==undefined)window.clearTimeout(variables.timerRef.id);
      if(variables.timedOutRef.current)return;
      const snap=variables.meta.itemSnapshot;
      markSelfWrite(principal.principal_id,{kind:'ticket',id:ticketId,...(snap?.intake_id?{intakeId:snap.intake_id}:{})});
      if(variables.checking){
        removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
      }else if(variables.meta.active){
        confirmOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
      }
      const cleaned=await draft.settle(variables.intent.command.client_command_id);
      setPending(null);setSelected([]);setState('succeeded');
      if(cleaned){setOpen(false);setNeedsReview(false);setManualSelection(false);}
      setMessage((variables.intent.action==='accept-for-later-with-conversations'?'已接单，沟通责任已按选择处理。':'已开始处理，沟通责任已按选择处理。')+(cleaned?'':' 草稿未能清空：为避免重复提交，暂时只能查看。点击重试。'));
      refresh();
      if(variables.meta.active&&cleaned&&!variables.checking&&!result.replayed){
        setSuppressToast(true);
        const numberLabel=snap?.number??'';
        const toastMsg=(numberLabel?numberLabel+' ':'')+'已移到「处理中」';
        void (async()=>{
          let allowUndo=false;
          if(principal.ticket_return_to_dispatch_enabled&&principal.roles.some(r=>['ADMIN','DISPATCHER','HANDLER'].includes(r))){
            try{
              const freshCtx=await api.ticketCommandContext(ticketId,AbortSignal.timeout(3000));
              client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],freshCtx);
              allowUndo=freshCtx.version===result.ticket_version&&freshCtx.assignee_id===principal.principal_id&&canUndoClaim(principal,freshCtx.allowed_actions);
            }catch{
              allowUndo=false;
            }
          }
          if(allowUndo&&snap){
            showUndoToast({
              id:'claim:'+ticketId,
              source:'ticket-conversation-handling',
              title:'已领取',
              message:toastMsg,
              onUndo:()=>executeClaimUndo({
                principal,
                client,
                item:snap,
                committedVersion:result.ticket_version,
                restorePosition:variables.meta.restorePosition,
                onOpenItem:()=>navigate('/items/ticket/'+ticketId+location.search),
              }),
            });
          }else{
            showSuccessToast({id:'claim:'+ticketId,source:'ticket-conversation-handling',title:'已领取',message:toastMsg});
          }
        })();
      }else{
        setSuppressToast(false);
      }
    },
    onError:async(error,variables)=>{
      if(variables.timerRef.id!==undefined)window.clearTimeout(variables.timerRef.id);
      if(variables.timedOutRef.current)return;
      const snap=variables.meta.itemSnapshot;
      if(error instanceof UnconfirmedClaimReplay){
        setSelected([]);setChoice('TAKE_SELECTED');setPending(null);setSuppressToast(false);setState('unknown');
        setMessage(draft.enabled?'原操作仍待核对；请只读核对。':'原操作仍待核对；本次未能确认结果。');
        refresh();
        if(draft.enabled)await draft.restrictOperation(variables.intent.command.client_command_id).catch(()=>setMessage('原操作仍未知，恢复存储不可用；请只读核对。'));
        return;
      }
      if(error instanceof ApiError){
        let afterReturn:Promise<void>|undefined;
        if(variables.checking)removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
        if(variables.meta.active){
          markSelfWrite(principal.principal_id,{kind:'ticket',id:ticketId,...(snap?.intake_id?{intakeId:snap.intake_id}:{})});
          removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
          const returned=triggerRollbackCue(principal.principal_id,'ticket',ticketId,'claim',snap?.intake_id,snap?.column);
          if(variables.meta.instantClaim)afterReturn=returned;
          setSuppressToast(true);
          void (async()=>{
            const winner=error.status===409?await lookupClaimWinnerName(ticketId):null;
            const detailMsg=winner?winner+'刚刚已经领取了这张工单':error.status===409?'内容已被他人更新：请查看最新内容后再试':errorMessage(error);
            showErrorActionToast({
              id:'claim-error:'+ticketId,
              source:'ticket-conversation-handling',
              title:'没有领取成功',
              message:detailMsg,
              actionLabel:'查看',
              onAction:()=>navigate('/items/ticket/'+ticketId+location.search),
              state:error.status===409?'conflict':'denied',
            });
          })();
        }else{
          setSuppressToast(false);
        }
        setPending(boardMode&&error.status===409?variables.intent:null);
        if(!(boardMode&&error.status===409))await draft.knownFailure(variables.intent.command.client_command_id).catch(()=>{});
        setState(error.status===409?'conflict':'denied');
        setMessage(error.status===409?'内容已被他人更新：你的修改还在，查看最新内容后再保存。':'操作被拒绝：'+errorMessage(error));
        if(error.status===409)refreshQueries(afterReturn);
      }else{
        if(variables.meta.active){
          markOptimisticUnknown(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
        }
        setSuppressToast(false);
        setPending(variables.intent);setState('unknown');
        setMessage('结果未确认：网络中断，暂不确定是否已提交。点击「重新提交」，会按原操作编号提交，已提交的不会重复办理。');
      }
    },
    onSettled:(_d,_e,variables)=>{
      if(variables.timerRef.id!==undefined)window.clearTimeout(variables.timerRef.id);
      if(request.current===variables.controller)request.current=null;
    },
  });
  const send=async(intent:ConversationHandlingIntent,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setSuppressToast(false);setState('denied');setMessage('网络未就绪：网络恢复前不会提交，你的输入已保留。');return;}
    if(request.current)return;
    const controller=new AbortController();request.current=controller;
    const detailCached=client.getQueryData<{pages?:{item?:WorkbenchCard}[]}>(['detail',principal.principal_id,'ticket',ticketId])?.pages?.[0]?.item;
    const currentCard=getDisplayedCard(principal.principal_id,'ticket',ticketId)??detailCached??null;
    const restorePosition=currentCard?captureDisplayedCardPosition(principal.principal_id,currentCard):undefined;
    const optimisticActive=!checking&&intent.action==='take-and-start-with-conversations';
    const commandId=intent.command.client_command_id;
    const timedOutRef={current:false};
    const timerRef:{id:number|undefined}={id:undefined};
    const meta:ConvOptimisticMeta={active:optimisticActive,instantClaim:optimisticActive&&direct&&!open&&!boardMode,commandId,itemSnapshot:currentCard,restorePosition};
    if(optimisticActive&&currentCard){
      setSuppressToast(true);
      markSelfWrite(principal.principal_id,{kind:'ticket',id:ticketId,intakeId:currentCard.intake_id});
      beginOptimisticOverlay(principal.principal_id,{
        itemKey:optimisticItemKey('ticket',ticketId),
        intakeId:currentCard.intake_id,
        kind:'claim',
        slot:'movement',
        clientCommandId:commandId,
        status:'pending',
        startedAt:Date.now(),
        from:{column:currentCard.column,status:currentCard.status,assigneeName:currentCard.assignee_name,closure:currentCard.closure,position:restorePosition,card:currentCard},
        to:{column:'active',status:'IN_PROGRESS',assigneeName:currentUserDisplayName(principal,client),closure:null,updatedAt:nowShanghaiLocalString()},
      });
    }else{
      setSuppressToast(false);
    }
    setPending(intent);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在提交处理操作…');
    try{await draft.prepare(intent);}catch{
      if(timerRef.id!==undefined)window.clearTimeout(timerRef.id);
      if(optimisticActive){
        removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',commandId);
      }
      setSuppressToast(false);
      request.current=null;
      if(checking){setState('unknown');setMessage('原操作仍未知，恢复存储不可用，尚未再次发送。');}
      else{setPending(null);setState('denied');setMessage('草稿未能保存：本次没有提交，你的输入还在。检查浏览器存储后重试。');}
      return;
    }
    if(controller.signal.aborted||request.current!==controller){
      if(optimisticActive)removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',commandId);
      return;
    }
    if(optimisticActive&&currentCard){
      timerRef.id=window.setTimeout(()=>{
        if(request.current!==controller)return;
        timedOutRef.current=true;
        request.current=null;
        markOptimisticUnknown(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',commandId);
        setSuppressToast(false);
        setPending(intent);
        setState('unknown');
        setMessage('结果未确认：网络中断，暂不确定是否已提交。点击「重新提交」，会按原操作编号提交，已提交的不会重复办理。');
        controller.abort();
      },OPTIMISTIC_UNKNOWN_TIMEOUT_MS);
    }
    mutation.mutate({intent,checking,controller,signal:controller.signal,timerRef,timedOutRef,meta});
  };
  const acknowledgement=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.conversationHandlingAcknowledgement(ticketId,commandId,signal),
    onSuccess:async(result,variables)=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知，未找到终态不代表未提交；请继续只读核对。');refresh();return;}forgetRecoveredCommand(scope,'conversation',variables.commandId);removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.commandId);if(result.state==='COMMITTED')markSelfWrite(principal.principal_id,{kind:'ticket',id:ticketId});const cleaned=result.state==='FAILED'?await draft.knownFailure(variables.commandId,true,{notifyLocal:false}):await draft.settle(variables.commandId);const retained=draft.hasRetainedInput();setPending(null);if(!retained)setSelected([]);setState(result.state==='COMMITTED'?'succeeded':'conflict');if(cleaned&&!retained){setOpen(false);setNeedsReview(false);setManualSelection(false);}setMessage((result.state==='COMMITTED'?'已核对原操作结果：已提交。':'已核对原操作失败，请读取工单信息后明确新的操作。')+(cleaned?'':' 草稿未能清空：为避免重复提交，暂时只能查看。点击重试。'));refresh();},onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const checkAcknowledgement=()=>{if(request.current||!receiptId)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在核对上次操作…');acknowledgement.mutate({commandId:receiptId,signal:controller.signal});};
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
  const originalId=pending?.command.client_command_id??receiptId??replay?.command.client_command_id;
  const canStart=allowed.includes('take-and-start-with-conversations');
  const direct=Boolean((simpleSession||noSessions)&&!manualSelection&&!needsReview&&!originalId&&state!=='conflict');
  useEffect(()=>{if(state==='unknown'||boardMode&&state==='conflict'&&pending)setOpen(true);},[state,boardMode,pending]);
  // Card 34A: while the form is open as a modal, its own outcome and draft notices show inside it; only later ones become page
  // toasts. Inside the next-step card the same form opens inline in the drawer, not as a modal, and keeps its toasts.
  const inlineForm=useNextStep(),modalOpen=open&&!inlineForm,messageToast=useDialogToast(modalOpen,messageRevision),draftToast=useDialogToast(modalOpen,draft.message);
  // Old purposes remain readable/recoverable, but no new accept-for-later action is offered.
  if(!canStart&&!originalId&&state==='idle'&&selected.length===0&&choice!=='RETAIN_CURRENT'&&context.isSuccess&&!context.isError)return null;
  if(!canStart&&!originalId&&state==='succeeded'&&context.data?.handling_cycle?.staff_completion_event_id)return null;
  if(!canStart&&!originalId&&state==='succeeded')return <section className="ticket-notes ticket-conversation-handling workflow-result detail-action-controller"><ToastFeedback revision={messageRevision} source="ticket-conversation-handling" state={state} className="conversation-handling-state" role="status">{message}</ToastFeedback></section>;
  const openOptions=()=>{setManualSelection(true);setOpen(true);};
  return <section data-activity-field="ticket-handling" className="ticket-notes ticket-conversation-handling detail-action-controller" aria-label="本人承接工单与沟通">
    {simpleSession&&!originalId?<p className="detail-action-hint">接单后同时负责回复</p>:null}
    <div className="note-controls">
      {!open&&draft.restorationBlocked&&draft.hasUnsavedInput()?<HButton type="button" data-action="show-unsaved-conversation-handling" onClick={()=>setOpen(true)} tone="secondary">查看未保存选择</HButton>:null}
      {originalId?<HButton type="button" data-action="open-conversation-handling-recovery" isDisabled={state==='submitting'||state==='checking'} onClick={()=>setOpen(true)} tone="secondary">核对接单</HButton>:canStart?<>
        {simpleSession?<HButton type="button" className="icon-button" aria-label="接单选项" title="接单选项" isDisabled={blocked||otherBlocked} onClick={openOptions} tone="secondary"><ChevronDown size={16}/></HButton>:null}
        <StepEntry action="take" label={'接单'} fallbackTone={'primary'}>{(tone,text)=><HButton type="button" className="take-and-start" data-action="take-and-start-with-conversations" isDisabled={blocked||otherBlocked||context.isPending||context.isError||related.isPending||related.isError||draft.status==='loading'} onClick={()=>{if(direct)submit('take-and-start-with-conversations');else setOpen(true);}} tone={tone}>{text}</HButton>}</StepEntry>
      </>:null}
    </div>
    <DetailDialog open={open} onClose={()=>setOpen(false)} closeBlocked={state==='submitting'||state==='checking'||draft.restoring} title="接单选项" closeLabel="关闭接单选项" className="detail-action-dialog detail-accept-dialog">
      {context.isPending?<DetailLoading inline label="正在加载可用操作…"/>:context.isError?blocked?<p role="alert">{errorMessage(context.error)}</p>:<ErrorState title="可用操作没有读出来" onRetry={refresh}/>:null}
      {noSessions?<p>接单后由您开始处理，当前没有需要接管的在线会话。</p>:<HRadioGroup className="workbench-radio-group" name={'communication-'+ticketId} value={choice??''} onChange={next=>{if(next==="TAKE_SELECTED"){setChoice('TAKE_SELECTED');}if(next==="RETAIN_CURRENT"){setChoice('RETAIN_CURRENT');}}} isDisabled={blocked||draft.status==='loading'}><HLabel>在线沟通由谁负责</HLabel><HRadio value={"TAKE_SELECTED"}><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>同时负责所选会话的回复</HRadio.Content></HRadio><HRadio value={"RETAIN_CURRENT"} data-action="retain-current-communicator"><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>保留当前沟通人</HRadio.Content></HRadio></HRadioGroup>}
      {related.isPending?<DetailLoading inline label="正在加载关联会话…"/>:related.isError?<>{blocked?<p role="alert">{errorMessage(related.error)}</p>:<ErrorState title="关联会话没有读出来" onRetry={refresh}/>}{temporaryRelatedFailure&&draft.hasUnsavedInput()&&selected.length?<><p>以下为本页未保存的选择，请先自行留存。</p>{fullNumbers.toggle}<SelectedSessions selected={selected.map(row=>row.session_id)} page={related.data?.items??[]} seen={sessionsSeen.seen.current} codes={sessionCodes} fullShown={fullNumbers.shown} disabled onCancel={()=>{}}/></>:null}</>:<>
        {!noSessions?<p>已选择 {selected.length} 个会话（最多 8 个）。</p>:null}
        <ul className="conversation-choices">{related.data.items.map((row,index)=>{const selection=selected.find(item=>item.session_id===row.session_id),stale=selection&&String(selection.expected_row_version)!==row.session_row_version;return <li key={row.session_id}><HCheckbox data-session-choice={row.session_id} isSelected={Boolean(selection)} isDisabled={blocked||draft.status==='loading'||choice==='RETAIN_CURRENT'||(!selection&&(!row.take_allowed||selected.length>=8))} onChange={()=>toggle(row.session_id,row.session_row_version,row.take_allowed)}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control><span>关联会话 {index+1} · {row.conversation_principal_name??'尚未分配沟通人'}<small>{stale?'内容已变化，请重新选择。':!row.take_allowed?'当前不能接管回复。':'接单后由您回复。'}</small></span></HCheckbox.Content></HCheckbox></li>;})}</ul>
        <div className="note-controls">{cursor?<HButton type="button" isDisabled={blocked||related.isPending||related.isError} onClick={()=>setCursor(null)} tone="secondary">回到首批会话</HButton>:null}{related.data.next_cursor?<HButton type="button" isDisabled={blocked||related.isPending||related.isError} onClick={()=>setCursor(related.data.next_cursor)} tone="secondary">下一批关联会话</HButton>:null}</div>
      </>}
      {draft.enabled?<DraftStatus notify={false} data-conversation-draft-status role="status">{draft.message}</DraftStatus>:null}
      {modalOpen&&draft.enabled?<DialogDraftAlert>{draft.message}</DialogDraftAlert>:null}{modalOpen&&state!=='idle'&&message?<DialogAlert source="ticket-conversation-handling" state={state} className="conversation-handling-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</DialogAlert>:null}
      <div className="note-controls">
        {canStart?<HButton type="button" className="take-and-start" data-action="confirm-conversation-handling" isDisabled={blocked||otherBlocked||!draft.canSubmit||context.isPending||context.isError||related.isPending||related.isError||!noSessions&&choice==='TAKE_SELECTED'&&!selected.length} onClick={()=>submit('take-and-start-with-conversations')} tone="secondary">确认接单并开始处理</HButton>:null}
        {replay?<HButton type="button" data-action="check-conversation-handling" isDisabled={draft.restoring||state==='checking'||state==='submitting'} onClick={()=>{void send(replay,true);}} tone="secondary">重新提交</HButton>:null}
        {!pending&&receiptId?<HButton type="button" data-action="check-expired-conversation-handling" isDisabled={state==='submitting'||state==='checking'||draft.restoring} onClick={checkAcknowledgement} tone="secondary">核对结果</HButton>:null}
        {draft.enabled&&(selected.length>0||choice==='RETAIN_CURRENT')?<HButton type="button" data-action="discard-conversation-handling-draft" isDisabled={state==='submitting'||state==='checking'||draft.restoring} onClick={()=>{void draft.discard();}} tone="secondary">丢弃选择内容</HButton>:null}
        {!blocked?<HButton type="button" data-action="refresh-conversation-handling" onClick={refresh} tone="secondary">刷新</HButton>:null}
      </div>
      {boardMode&&state==='conflict'&&pending?<BoardConflictIntent original={pending} onAdopt={current=>draft.knownFailure(pending.command.client_command_id).then(cleaned=>{if(!current())return;if(!cleaned){setMessage('草稿未能清空：为避免重复提交，暂时只能查看。点击重试。');return;}setPending(null);setState('idle');setMessage('会话选择已保留，请确认后再提交。');refresh();}).catch(()=>{if(current())setMessage('草稿未能清空：为避免重复提交，暂时只能查看。点击重试。');})}/>:null}
    </DetailDialog>
      {state!=='idle'&&!suppressToast?<ToastFeedback enabled={messageToast} revision={messageRevision} source="ticket-conversation-handling" state={state} className="conversation-handling-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
    <DraftFeedback enabled={draft.enabled&&draftToast}>{draft.message}</DraftFeedback>

    {!open&&(context.isError||related.isError)?<HButton type="button" onClick={refresh} tone="secondary">重试读取接单选项</HButton>:null}
  </section>;
}
