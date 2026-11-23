import {ErrorState} from '../../design/components/ErrorState/ErrorState';
import {DetailLoading} from '../../app/DetailLoading';
import {StepEntry} from '../../design/components/Drawer/NextStep';
import {ShortcutTooltip} from '../../design/components/Kbd/Kbd';
import {ariaKeyshortcuts,shortcutKeys} from '../efficiency/shortcuts';
import {Button as HButton} from '../../design/components/Button/Button';
import {ToastFeedback,showErrorActionToast,showSuccessToast,showUndoToast,useFeedbackState} from '../../app/ToastFeedback';
import {BoardConflictIntent} from '../board-actions/BoardConflictIntent';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useLocation,useNavigate} from 'react-router';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,UnconfirmedClaimReplay,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016SelfHandlingCommand,SelfHandlingAction,WorkbenchCard} from '../../api/client';
import {markSelfWrite} from '../../design/motion/self-write';
import {OPTIMISTIC_UNKNOWN_TIMEOUT_MS} from '../optimistic/constants';
import {nowShanghaiLocalString} from '../optimistic/overlay';
import {beginOptimisticOverlay,captureDisplayedCardPosition,confirmOptimisticOverlay,getDisplayedCard,isItemActionPending,markOptimisticUnknown,optimisticItemKey,removeOptimisticOverlay,triggerRollbackCue} from '../optimistic/store';
import type {CardPositionAnchor} from '../optimistic/store';
import {canUndoClaim,currentUserDisplayName,executeClaimUndo,lookupClaimWinnerName} from '../optimistic/undo-actions';
import {dispatchRecoverable,useCommandRecovery} from '../optimistic/command-recovery';

type Pending={action:SelfHandlingAction;command:P2016SelfHandlingCommand};
type OptimisticMeta={active:boolean;instantClaim:boolean;commandId:string;itemSnapshot:WorkbenchCard|null;restorePosition:CardPositionAnchor|undefined};
type SubmitVariables={intent:Pending;checking:boolean;signal:AbortSignal;controller:AbortController;timerRef:{id:number|undefined};timedOutRef:{current:boolean};meta:OptimisticMeta};
type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketSelfHandling({ticketId,item,principal,onBlockedChange,onPendingChange,boardMode=false,otherBlocked=false,cardActionTarget}:{ticketId:string;item?:WorkbenchCard|undefined;principal:Principal;boardMode?:boolean;otherBlocked?:boolean;onBlockedChange:(blocked:boolean)=>void;onPendingChange?:((pending:boolean,item:WorkbenchCard,reason?:'change'|'unmount')=>void)|undefined;cardActionTarget?:HTMLElement|null}){
  const client=useQueryClient(),navigate=useNavigate(),location=useLocation(),request=useRef<AbortController|null>(null);
  const [state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[pending,setPending]=useState<Pending|null>(null),[suppressToast,setSuppressToast]=useState(false);
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const activeCard=item??getDisplayedCard(principal.principal_id,'ticket',ticketId)??client.getQueryData<{pages?:{item?:WorkbenchCard}[]}>(['detail',principal.principal_id,'ticket',ticketId])?.pages?.[0]?.item;
  const scope={principal:principal.principal_id,kind:'ticket',itemId:ticketId};
  const held=useCommandRecovery(scope,'self');
  const recovered=cardActionTarget===undefined&&held?.unknown&&held.intent.purpose==='self'?held.intent:null;
  const replay=state==='unknown'?pending??recovered:recovered;
  const navigationBlocking=Boolean(recovered)||Boolean(cardActionTarget===undefined&&state==='submitting')||['checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending);
  const busy=['submitting','checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending);
  const blocked=busy||Boolean(held)||isItemActionPending(principal.principal_id,'ticket',ticketId,'movement');
  useEffect(()=>{onBlockedChange(navigationBlocking);return()=>onBlockedChange(false);},[navigationBlocking,onBlockedChange]);
  const pendingCallbackRef=useRef({onPendingChange,activeCard});
  pendingCallbackRef.current={onPendingChange,activeCard};
  useEffect(()=>{if(onPendingChange&&activeCard){onPendingChange(busy,activeCard,'change');}},[busy,onPendingChange,activeCard]);
  useEffect(()=>()=>{const latest=pendingCallbackRef.current;if(latest.onPendingChange&&latest.activeCard)latest.onPendingChange(false,latest.activeCard,'unmount');},[]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocking)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocking]);
  const refresh=(afterReturn?:Promise<void>)=>{
    void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});
    void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});
    const refreshBoard=()=>client.invalidateQueries({queryKey:['board',principal.principal_id]});
    if(afterReturn)void afterReturn.then(refreshBoard);else void refreshBoard();
    void client.invalidateQueries({queryKey:['ticket-round-notifications',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['web-report',principal.principal_id,'ticket',ticketId]});
  };
  const mutation=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],
    mutationFn:({intent,signal,checking}:SubmitVariables)=>{
      const post=()=>api.selfHandle(ticketId,intent.action,intent.command,principal.csrf_token,signal,checking);
      return cardActionTarget===undefined
        ?dispatchRecoverable(scope,{purpose:'self',id:intent.command.client_command_id,...intent},signal,post):post();
    },
    onSuccess:(result,variables)=>{
      if(variables.timerRef.id!==undefined)window.clearTimeout(variables.timerRef.id);
      if(variables.timedOutRef.current)return;
      const snap=variables.meta.itemSnapshot;
      markSelfWrite(principal.principal_id,{kind:'ticket',id:ticketId,...(snap?.intake_id?{intakeId:snap.intake_id}:{})});
      if(variables.checking){
        removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
      }else if(variables.meta.active){
        confirmOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
      }
      setPending(null);setState('succeeded');setMessage(variables.intent.action==='accept-for-later'?'已接单，可稍后开始处理。':'已开始处理。');
      if(result.replayed)setMessage(variables.intent.action==='accept-for-later'?'已核对：原操作已接单。':'已核对：原操作已开始处理。');
      refresh();
      if(variables.meta.active&&!variables.checking&&!result.replayed){
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
              source:'ticket-self-handling',
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
            showSuccessToast({id:'claim:'+ticketId,source:'ticket-self-handling',title:'已领取',message:toastMsg});
          }
        })();
      }else{
        setSuppressToast(false);
      }
    },
    onError:(error,variables)=>{
      if(variables.timerRef.id!==undefined)window.clearTimeout(variables.timerRef.id);
      if(variables.timedOutRef.current)return;
      const snap=variables.meta.itemSnapshot;
      if(error instanceof ApiError){
        if(variables.checking)removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
        if(variables.meta.active){
          markSelfWrite(principal.principal_id,{kind:'ticket',id:ticketId,...(snap?.intake_id?{intakeId:snap.intake_id}:{})});
          removeOptimisticOverlay(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
          const returned=triggerRollbackCue(principal.principal_id,'ticket',ticketId,'claim',snap?.intake_id,snap?.column);
          setSuppressToast(true);
          void (async()=>{
            const winner=error.status===409?await lookupClaimWinnerName(ticketId):null;
            const detailMsg=winner?winner+'刚刚已经领取了这张工单':error.status===409?'这张工单的状态刚刚已变化，请确认后再操作':errorMessage(error);
            showErrorActionToast({
              id:'claim-error:'+ticketId,
              source:'ticket-self-handling',
              title:'没有领取成功',
              message:detailMsg,
              actionLabel:'查看',
              onAction:()=>navigate('/items/ticket/'+ticketId+location.search),
              state:error.status===409?'conflict':'denied',
            });
          })();
          if(error.status===409&&variables.meta.instantClaim){
            setPending(null);
            setState('idle');
            refresh(returned);
            return;
          }
        }else{
          setSuppressToast(false);
        }
        setPending(boardMode&&error.status===409?variables.intent:null);
        setState(error.status===409?'conflict':'denied');
        setMessage(error.status===409?'操作冲突：请重新读取工单后确认新的操作。':'操作被拒绝：'+errorMessage(error));
        if(error.status===409)refresh();
      }else{
        if(variables.meta.active){
          markOptimisticUnknown(principal.principal_id,optimisticItemKey('ticket',ticketId),'movement',variables.meta.commandId);
        }
        setSuppressToast(false);
        setPending(variables.intent);
        setState('unknown');
        setMessage(error instanceof UnconfirmedClaimReplay?'原操作仍待核对；本次未能确认结果。':'结果未确认：网络中断，暂不确定是否已提交。点击「重新提交」，会按原操作编号提交，已提交的不会重复办理。');
      }
    },
    onSettled:(_data,_error,variables)=>{
      if(variables.timerRef.id!==undefined)window.clearTimeout(variables.timerRef.id);
      if(request.current===variables.controller)request.current=null;
    },
  });
  const send=(intent:Pending,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setSuppressToast(false);setState('denied');setMessage('网络未就绪：网络恢复前不会提交，你的输入已保留。');return;}
    if(request.current)return;
    const controller=new AbortController();
    request.current=controller;
    const currentCard=activeCard??null;
    const restorePosition=currentCard?captureDisplayedCardPosition(principal.principal_id,currentCard):undefined;
    const optimisticActive=!checking&&intent.action==='take-and-start';
    const commandId=intent.command.client_command_id;
    if(optimisticActive&&currentCard){
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
    }
    const instantClaim=optimisticActive&&(cardActionTarget!==undefined||!boardMode);
    const meta:OptimisticMeta={active:optimisticActive,instantClaim,commandId,itemSnapshot:currentCard,restorePosition};
    const timedOutRef={current:false};
    const timerRef:{id:number|undefined}={id:undefined};
    if(optimisticActive){
      setSuppressToast(true);
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
    }else{
      setSuppressToast(false);
    }
    setPending(intent);
    setState(checking?'checking':'submitting');
    setMessage(checking?'正在核对原操作结果…':'正在提交处理操作…');
    mutation.mutate({intent,checking,signal:controller.signal,controller,timerRef,timedOutRef,meta});
  };
  const submit=(action:SelfHandlingAction)=>{
    if(blocked||otherBlocked||context.isPending||context.isError||!context.data?.allowed_actions.includes(action))return;
    send(Object.freeze({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:context.data.resolver_team_id})}),false);
  };
  const cycle=context.data?.handling_cycle,allowed=context.data?.allowed_actions??[],cardMode=cardActionTarget!==undefined;
  // Keep the original request/result controller mounted; only its idle presentation is optional.
  if(context.isSuccess&&!context.isError&&!allowed.includes('take-and-start')&&!pending&&!replay&&state==='idle')return null;
  const action=allowed.includes('take-and-start')&&(!cardMode||context.isSuccess&&!context.isFetching)?<StepEntry action="take" label={cardMode?'领取':'接单'} fallbackTone={cardMode?'secondary':'primary'}>{(tone,text)=><ShortcutTooltip label={text} keys={shortcutKeys('claim')} placement={cardMode?'top-end':'top'}><HButton type="button" className="take-and-start" data-action="take-and-start" data-board-claim-action={cardMode?'true':undefined} aria-keyshortcuts={ariaKeyshortcuts('claim')} size={cardMode?'sm':'md'} isDisabled={blocked||otherBlocked||context.isPending||context.isError} onClick={()=>submit('take-and-start')} tone={tone}>{text}</HButton></ShortcutTooltip>}</StepEntry>:null;
  return <section data-activity-field="ticket-handling" data-board-claim-state={cardMode?state:undefined} className="ticket-notes ticket-self-handling detail-action-controller" aria-label="本人承接工单">
    {context.isPending?<DetailLoading inline label="正在加载可用操作…"/>:context.isError?blocked?<p role="alert">{errorMessage(context.error)}</p>:<ErrorState title="可用操作没有读出来" onRetry={()=>{void context.refetch();}}/>:<p hidden className="ticket-handling-version">工单版本 {context.data.version}</p>}
    {cycle?<p hidden className="ticket-handling-cycle">处理轮次 {cycle.cycle_no}</p>:null}
    <div className="note-controls">
      {cardMode?(cardActionTarget?createPortal(action,cardActionTarget):null):action}
      {replay?<HButton type="button" data-action="check-self-handling" isDisabled={state==='checking'} onClick={()=>send(replay,true)} tone="secondary">重新提交</HButton>:null}
      {!blocked&&(context.isError||state==='conflict'||state==='denied')?<HButton type="button" data-action="refresh-self-handling" onClick={()=>{void context.refetch();}} tone="secondary">重试读取操作</HButton>:null}
    </div>
    {state!=='idle'&&!suppressToast?<ToastFeedback revision={messageRevision} source="ticket-self-handling" state={state} className="ticket-handling-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
    {boardMode&&state==='conflict'&&pending?<BoardConflictIntent original={pending} onAdopt={()=>{setPending(null);setState('idle');setMessage('已保留填写内容，请按工单信息明确新的操作。');refresh();}}/>:null}
  </section>;
}
