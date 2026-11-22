import type {QueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,statusLabels,workbenchTransportWritable} from '../../api/client';
import type {BoardColumn,Principal,WorkbenchCard} from '../../api/client';
import {closureApi} from '../closure/client';
import {decodeFollowCommand} from '../../contracts/workbench-follow-browser-contracts.mjs';
import type {FollowItem} from '../../contracts/workbench-follow-browser-contracts.mjs';
import {showErrorActionToast,showInfoToast} from '../../app/ToastFeedback';
import {markSelfWrite} from '../../design/motion/self-write';
import {
  CLAIM_UNDO_REASON,
  CLAIM_UNDO_REASON_CODE,
  CLAIM_UNDO_ROLES,
  CLAIM_UNDO_UNFINISHED_WORK,
  CLOSE_UNDO_REASON_CODE,
  OPTIMISTIC_UNKNOWN_TIMEOUT_MS,
} from './constants';
import {
  beginOptimisticOverlay,
  confirmOptimisticOverlay,
  optimisticItemKey,
  removeOptimisticOverlay,
  triggerRollbackCue,
} from './store';
import type {CardPositionAnchor} from './store';

/** Matches Decision 2: show claim undo only when return-to-dispatch capability, role, and post-claim allowed action all permit it. */
export function canUndoClaim(principal:Principal,allowedActions:readonly string[]):boolean{
  return Boolean(
    principal.ticket_return_to_dispatch_enabled
    &&principal.roles.some(role=>CLAIM_UNDO_ROLES.has(role))
    &&allowedActions.includes('return-to-dispatch'),
  );
}

/** Resolves the current operator's display name from cache before falling back to `principal.display_name`. */
export function currentUserDisplayName(principal:Principal,client:QueryClient):string{
  const profile=client.getQueryData<{name:string|null}>(['current-profile',principal.principal_id,principal.authorization_revision]);
  return profile?.name?.trim()||principal.display_name;
}

/** Only the current authorized read can identify a competing claimant. */
export async function lookupClaimWinnerName(ticketId:string):Promise<string|null>{
  try{
    const detail=await api.detail('ticket',ticketId,null,AbortSignal.timeout(3000));
    return detail.item.assignee_name?.trim()||detail.responsibility.ticket_assignee_name?.trim()||null;
  }catch{return null;}
}

function changedStatus(status?:string){
  const label=status&&statusLabels[status];
  return label?'事项已变化，当前状态为「'+label+'」':'事项已变化，请查看最新状态';
}

async function readChangedStatus(kind:'ticket'|'intake',id:string){
  try{
    const signal=AbortSignal.timeout(3000);
    const current=kind==='ticket'?await api.ticketCommandContext(id,signal):await closureApi.intakeContext(id,signal);
    return changedStatus(current.status);
  }catch{return changedStatus();}
}

function invalidateTicketQueries(client:QueryClient,principalId:string,ticketId:string){
  for(const key of [
    ['board',principalId],
    ['detail',principalId,'ticket',ticketId],
    ['ticket-command-context',principalId,ticketId],
    ['ticket-round-notifications',principalId,ticketId],
    ['ticket-assignment-history',principalId,ticketId],
    ['web-report',principalId,'ticket',ticketId],
    ['workbench-search',principalId],
  ]){
    void client.invalidateQueries({queryKey:key});
  }
}

function invalidateClosureQueries(client:QueryClient,principalId:string){
  for(const name of [
    'board',
    'detail',
    'workbench-search',
    'closure-history',
    'closure-context',
    'ticket-command-context',
    'manual-review',
    'ticket-follow-up-schedule',
    'web-report',
  ]){
    void client.invalidateQueries({queryKey:[name,principalId]});
  }
}

export async function executeClaimUndo({
  principal,
  client,
  item,
  committedVersion,
  restorePosition,
  onOpenItem,
}:{
  principal:Principal;
  client:QueryClient;
  item:WorkbenchCard;
  committedVersion:number;
  restorePosition?:CardPositionAnchor|undefined;
  onOpenItem:()=>void;
}):Promise<void>{
  if(!workbenchTransportWritable()){
    showErrorActionToast({
      source:'ticket-return-to-dispatch',
      title:'没有撤销成功',
      message:'网络未就绪，工单仍保留在「处理中」',
      actionLabel:'查看',
      onAction:onOpenItem,
    });
    return;
  }
  const key=optimisticItemKey('ticket',item.id);
  const commandId=crypto.randomUUID();
  markSelfWrite(principal.principal_id,{kind:'ticket',id:item.id,intakeId:item.intake_id});
  beginOptimisticOverlay(principal.principal_id,{
    itemKey:key,
    intakeId:item.intake_id,
    kind:'claim',
    slot:'movement',
    clientCommandId:commandId,
    status:'pending',
    startedAt:Date.now(),
    undo:true,
    from:{column:'active',status:'IN_PROGRESS',assigneeName:currentUserDisplayName(principal,client),closure:null,card:item},
    to:{column:'pending',status:'QUEUED',assigneeName:null,closure:null,restorePosition},
  });

  const controller=new AbortController();
  let timedOut=false;
  let versionConflictMessage:string|undefined;
  const timer=window.setTimeout(()=>{
    timedOut=true;
    controller.abort();
    removeOptimisticOverlay(principal.principal_id,key,'movement',commandId);
    invalidateTicketQueries(client,principal.principal_id,item.id);
    showErrorActionToast({
      source:'ticket-return-to-dispatch',
      title:'撤销结果未确认',
      message:'连接超时，工单仍可能在处理中，请查看最新状态',
      actionLabel:'查看',
      onAction:onOpenItem,
      state:'unknown',
    });
  },OPTIMISTIC_UNKNOWN_TIMEOUT_MS);

  try{
    const ctx=await api.ticketCommandContext(item.id,controller.signal);
    if(ctx.version!==committedVersion||ctx.assignee_id!==principal.principal_id||!ctx.allowed_actions.includes('return-to-dispatch')){
      versionConflictMessage=changedStatus(ctx.status);
      throw new ApiError(409,'P2_016_RETURN_TO_DISPATCH_UNAVAILABLE');
    }
    // The server checks this receipt version again while holding the ticket lock.
    await api.returnTicket(item.id,{
      client_command_id:commandId,
      expected_version:committedVersion,
      reason_code:CLAIM_UNDO_REASON_CODE,
      reason:CLAIM_UNDO_REASON,
      unfinished_work:CLAIM_UNDO_UNFINISHED_WORK,
      communication_choice:'RETAIN_CURRENT',
      communication_target_principal_id:null,
      sessions:[],
    },principal.csrf_token,controller.signal);
    window.clearTimeout(timer);
    if(timedOut)return;
    markSelfWrite(principal.principal_id,{kind:'ticket',id:item.id,intakeId:item.intake_id});
    confirmOptimisticOverlay(principal.principal_id,key,'movement',commandId);
    invalidateTicketQueries(client,principal.principal_id,item.id);
    showInfoToast({
      id:'undo-result:claim:'+item.id,
      source:'ticket-return-to-dispatch',
      title:'已撤销',
      message:'工单回到「待受理」',
    });
  }catch(error){
    window.clearTimeout(timer);
    if(timedOut)return;
    markSelfWrite(principal.principal_id,{kind:'ticket',id:item.id,intakeId:item.intake_id});
    removeOptimisticOverlay(principal.principal_id,key,'movement',commandId);
    invalidateTicketQueries(client,principal.principal_id,item.id);
    if(error instanceof ApiError){
      triggerRollbackCue(principal.principal_id,'ticket',item.id,'claim',item.intake_id);
      showErrorActionToast({
        source:'ticket-return-to-dispatch',
        title:'没有撤销成功',
        message:error.status===409?(versionConflictMessage??await readChangedStatus('ticket',item.id)):errorMessage(error),
        actionLabel:'查看',
        onAction:onOpenItem,
        state:error.status===409?'conflict':'denied',
      });
    }else{
      showErrorActionToast({
        source:'ticket-return-to-dispatch',
        title:'撤销结果未确认',
        message:'连接中断，请打开工单确认当前状态',
        actionLabel:'查看',
        onAction:onOpenItem,
        state:'unknown',
      });
    }
  }
}

export async function executeCloseUndo({
  principal,
  client,
  item,
  committedVersion,
  restorePosition,
  previousColumn,
  previousStatus,
  onRestored,
  onOpenItem,
}:{
  principal:Principal;
  client:QueryClient;
  item:WorkbenchCard;
  committedVersion:number;
  restorePosition?:CardPositionAnchor|undefined;
  previousColumn:Exclude<BoardColumn,'handled'>;
  previousStatus:string;
  onRestored?:(intakeId:string)=>void;
  onOpenItem:()=>void;
}):Promise<void>{
  if(!workbenchTransportWritable()){
    showErrorActionToast({
      source:'closure-restore',
      title:'没有撤销成功',
      message:'网络未就绪，事项仍保留在「已关闭」',
      actionLabel:'查看',
      onAction:onOpenItem,
    });
    return;
  }
  const subjectKind=item.kind==='ticket'?'ticket':'intake';
  const subjectId=item.kind==='ticket'?item.id:item.intake_id;
  const key=optimisticItemKey(item.kind,item.id);
  const commandId=crypto.randomUUID();
  markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
  beginOptimisticOverlay(principal.principal_id,{
    itemKey:key,
    intakeId:item.intake_id,
    kind:'close',
    slot:'movement',
    clientCommandId:commandId,
    status:'pending',
    startedAt:Date.now(),
    undo:true,
    from:{column:'handled',status:'DISMISSED',assigneeName:item.assignee_name,closure:item.closure,card:item},
    to:{column:previousColumn,status:previousStatus,assigneeName:item.assignee_name,closure:null,restorePosition},
  });

  const controller=new AbortController();
  let timedOut=false;
  let versionConflictMessage:string|undefined;
  const timer=window.setTimeout(()=>{
    timedOut=true;
    controller.abort();
    removeOptimisticOverlay(principal.principal_id,key,'movement',commandId);
    invalidateClosureQueries(client,principal.principal_id);
    showErrorActionToast({
      source:'closure-restore',
      title:'撤销结果未确认',
      message:'连接超时，请查看最新状态',
      actionLabel:'查看',
      onAction:onOpenItem,
      state:'unknown',
    });
  },OPTIMISTIC_UNKNOWN_TIMEOUT_MS);

  try{
    if(subjectKind==='ticket'){
      const ctx=await api.ticketCommandContext(subjectId,controller.signal);
      if(ctx.version!==committedVersion||!ctx.allowed_actions.includes('restore')){
        versionConflictMessage=changedStatus(ctx.status);
        throw new ApiError(409,'CLOSURE_RESTORE_UNAVAILABLE');
      }
      await api.restoreClosedTicket(subjectId,{
        client_command_id:commandId,
        expected_version:committedVersion,
        reason_code:CLOSE_UNDO_REASON_CODE,
      },principal.csrf_token,controller.signal);
    }else{
      const ctx=await closureApi.intakeContext(subjectId,controller.signal);
      if(ctx.version!==committedVersion||!ctx.can_restore){
        versionConflictMessage=changedStatus(ctx.status);
        throw new ApiError(409,'CLOSURE_RESTORE_UNAVAILABLE');
      }
      await closureApi.restoreIntake(subjectId,{
        client_command_id:commandId,
        expected_version:committedVersion,
        reason_code:CLOSE_UNDO_REASON_CODE,
      },principal.csrf_token,controller.signal);
    }
    window.clearTimeout(timer);
    if(timedOut)return;
    markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
    confirmOptimisticOverlay(principal.principal_id,key,'movement',commandId);
    onRestored?.(item.intake_id);
    invalidateClosureQueries(client,principal.principal_id);
    showInfoToast({
      id:'undo-result:close:'+key,
      source:'closure-restore',
      title:'已撤销',
      message:'已恢复到「'+(previousColumn==='active'?'处理中':'待受理')+'」',
    });
  }catch(error){
    window.clearTimeout(timer);
    if(timedOut)return;
    markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
    removeOptimisticOverlay(principal.principal_id,key,'movement',commandId);
    invalidateClosureQueries(client,principal.principal_id);
    if(error instanceof ApiError){
      triggerRollbackCue(principal.principal_id,item.kind,item.id,'close',item.intake_id);
      showErrorActionToast({
        source:'closure-restore',
        title:'没有撤销成功',
        message:error.status===409?(versionConflictMessage??await readChangedStatus(subjectKind,subjectId)):errorMessage(error),
        actionLabel:'查看',
        onAction:onOpenItem,
        state:error.status===409?'conflict':'denied',
      });
    }else{
      showErrorActionToast({
        source:'closure-restore',
        title:'撤销结果未确认',
        message:'连接中断，请查看最新状态',
        actionLabel:'查看',
        onAction:onOpenItem,
        state:'unknown',
      });
    }
  }
}

export async function executeFollowUndo({
  principal,
  client,
  requested,
  item,
  targetFollowing,
  committedFollowVersion,
  onOpenItem,
}:{
  principal:Principal;
  client:QueryClient;
  requested:FollowItem;
  item:WorkbenchCard;
  targetFollowing:boolean;
  committedFollowVersion:string;
  onOpenItem:()=>void;
}):Promise<void>{
  if(!workbenchTransportWritable()){
    showErrorActionToast({
      source:'item-follow',
      title:'没有撤销成功',
      message:'网络未就绪，关注状态未改变',
      actionLabel:'查看',
      onAction:onOpenItem,
    });
    return;
  }
  const key=optimisticItemKey(item.kind,item.id);
  const commandId=crypto.randomUUID();
  beginOptimisticOverlay(principal.principal_id,{
    itemKey:key,
    intakeId:item.intake_id,
    kind:'follow',
    slot:'follow',
    clientCommandId:commandId,
    status:'pending',
    startedAt:Date.now(),
    undo:true,
    from:{following:!targetFollowing},
    to:{following:targetFollowing},
  });

  const controller=new AbortController();
  let timedOut=false;
  const timer=window.setTimeout(()=>{
    timedOut=true;
    controller.abort();
    removeOptimisticOverlay(principal.principal_id,key,'follow',commandId);
    void client.invalidateQueries({queryKey:['detail',principal.principal_id,requested.kind,requested.id]});
    void client.invalidateQueries({queryKey:['board',principal.principal_id]});
    showErrorActionToast({
      source:'item-follow',
      title:'撤销结果未确认',
      message:'连接超时，请查看最新关注状态',
      actionLabel:'查看',
      onAction:onOpenItem,
      state:'unknown',
    });
  },OPTIMISTIC_UNKNOWN_TIMEOUT_MS);

  try{
    const detail=await api.detail(requested.kind,requested.id,null,controller.signal);
    const attention=detail.item.attention;
    if(!attention)throw new ApiError(403,'WORKBENCH_FOLLOW_DISABLED');
    if(attention.follow_version!==committedFollowVersion||attention.following===targetFollowing)throw new ApiError(409,'WORKBENCH_FOLLOW_CONFLICT');
    const command=decodeFollowCommand({
      client_command_id:commandId,
      canonical_item:{kind:item.kind,id:item.id},
      expected_follow_version:committedFollowVersion,
      following:targetFollowing,
    });
    const result=await api.follow(requested,command,principal.csrf_token,controller.signal);
    window.clearTimeout(timer);
    if(timedOut)return;
    confirmOptimisticOverlay(principal.principal_id,key,'follow',commandId);
    void client.invalidateQueries({queryKey:['detail',principal.principal_id,requested.kind,requested.id]});
    void client.invalidateQueries({queryKey:['board',principal.principal_id]});
    showInfoToast({
      id:'undo-result:follow:'+key,
      source:'item-follow',
      title:'已撤销',
      message:result.following?'已恢复关注':'已取消关注',
    });
  }catch(error){
    window.clearTimeout(timer);
    if(timedOut)return;
    removeOptimisticOverlay(principal.principal_id,key,'follow',commandId);
    void client.invalidateQueries({queryKey:['detail',principal.principal_id,requested.kind,requested.id]});
    void client.invalidateQueries({queryKey:['board',principal.principal_id]});
    if(error instanceof ApiError){
      triggerRollbackCue(principal.principal_id,item.kind,item.id,'follow',item.intake_id);
      showErrorActionToast({
        source:'item-follow',
        title:'没有撤销成功',
        message:error.status===409?'关注状态已变化，请确认后再试':errorMessage(error),
        actionLabel:'查看',
        onAction:onOpenItem,
        state:error.status===409?'conflict':'denied',
      });
    }else{
      showErrorActionToast({
        source:'item-follow',
        title:'撤销结果未确认',
        message:'连接中断，请查看最新关注状态',
        actionLabel:'查看',
        onAction:onOpenItem,
        state:'unknown',
      });
    }
  }
}
