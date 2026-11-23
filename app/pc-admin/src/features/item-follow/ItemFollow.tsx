import {Button as HButton} from '../../design/components/Button/Button';
import {OptimisticBadge} from '../../design/components/OptimisticBadge/OptimisticBadge';
import {ToastFeedback,DraftStatus,showErrorActionToast,showUndoToast,useFeedbackState} from '../../app/ToastFeedback';
import {Star} from 'lucide-react';
import {TooltipAnchor} from '../../design/components/Tooltip/Tooltip';
import {Kbd} from '../../design/components/Kbd/Kbd';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {ariaKeyshortcuts,shortcutKeys} from '../efficiency/shortcuts';
import {registerDetailFollow} from '../efficiency/keyboard-store';
import {useLocation,useNavigate} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import type {InfiniteData} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,WorkbenchCard,WorkbenchDetail} from '../../api/client';
import {clearItemAuthorization,clearItemView,clearSessionAuthorization,clearSessionView} from '../../app/authorization';
import {DRAFT_TTL_MS,DraftError,hasExistingDraft,matchesDraft,subscribeDrafts} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {decodeFollowCommand,matchesFollowResult} from '../../contracts/workbench-follow-browser-contracts.mjs';
import type {FollowItem,WorkbenchFollowCommand,WorkbenchFollowResult} from '../../contracts/workbench-follow-browser-contracts.mjs';
import {OPTIMISTIC_UNKNOWN_TIMEOUT_MS} from '../optimistic/constants';
import {beginOptimisticOverlay,confirmOptimisticOverlay,markOptimisticUnknown,optimisticItemKey,removeOptimisticOverlay,triggerRollbackCue,useItemOptimisticState} from '../optimistic/store';
import {dispatchRecoverable,forgetRecoveredCommand,keepFollowReceipt,useItemUndoRecovery} from '../optimistic/command-recovery';
import {executeFollowUndo} from '../optimistic/undo-actions';

type State='idle'|'submitting'|'checking'|'reading'|'succeeded'|'conflict'|'unknown'|'denied';
// A rejection from bootstrap has session scope. A purpose or object rejection
// must not borrow this classification from a mutable restoration stage.
class FollowSessionRejected extends ApiError {}
class UnsettledFollowError extends Error {
  readonly cause:unknown;
  constructor(cause:unknown){
    super('UNSETTLED_FOLLOW');
    this.cause=cause;
  }
}
async function readSession(signal:AbortSignal){
 try{return await api.bootstrap(signal);}catch(error){if(error instanceof ApiError&&error.status===403)throw new FollowSessionRejected(error.status,error.code);throw error;}
}
function decodeCopy(serialized:string):{value:string;pending:WorkbenchFollowCommand|null}{
 try{
  const parsed:unknown=JSON.parse(serialized);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();
  const v=parsed as Record<string,unknown>;if(Object.keys(v).length!==3||v.schema!==1||v.value!==''||!Object.hasOwn(v,'pending'))throw Error();
  return {value:'',pending:v.pending===null?null:decodeFollowCommand(v.pending)};
 }catch{throw new DraftError('DRAFT_CORRUPT');}
}
export interface ItemFollowController {
  canStart:boolean;
  busy:boolean;
  inFlight:boolean;
  settled:boolean;
  trigger:()=>boolean;
}
export type ItemFollowControllerState=Omit<ItemFollowController,'trigger'>;
export function ItemFollow({requested,item,principal,readReady,onBlockedChange,headless=false,onBusyChange,onReadyChange,onStateChange,controllerRef}:{requested:FollowItem;item:WorkbenchCard;principal:Principal;readReady:boolean;onBlockedChange:(blocked:boolean)=>void;headless?:boolean|undefined;onBusyChange?:((busy:boolean)=>void)|undefined;onReadyChange?:((ready:boolean)=>void)|undefined;onStateChange?:((state:ItemFollowControllerState)=>void)|undefined;controllerRef?:RefObject<ItemFollowController|null>|undefined}){
 const client=useQueryClient(),navigate=useNavigate(),location=useLocation(),request=useRef<AbortController|null>(null),generation=useRef(0),settling=useRef(false),pendingRelease=useRef<{id:string;release:()=>Promise<void>}|null>(null);
 const identity=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.expires_epoch_ms,principal.roles,principal.workbench_follow_enabled,principal.workbench_follow_draft_recovery_enabled,requested.kind,requested.id]);
 const latestIdentity=useRef(identity);latestIdentity.current=identity;
 const [pending,setPending]=useState<WorkbenchFollowCommand|null>(null),[opaque,setOpaque]=useState<string|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[needsRead,setNeedsRead]=useState(false);
 const [existing,setExisting]=useState(false),[probing,setProbing]=useState(true),[suppressToast,setSuppressToast]=useState(false),[inFlight,setInFlight]=useState(false);
 const scope={principal:principal.principal_id,kind:requested.kind,id:requested.id,purpose:'item-follow'},attention=item.attention;
 const followOpt=useItemOptimisticState(principal.principal_id,item.kind,item.id,item.intake_id);
 const itemKey=optimisticItemKey(item.kind,item.id);
 const rawEnabled=principal.workbench_follow_enabled===true&&principal.workbench_follow_draft_recovery_enabled===true&&attention!==undefined;
 const detailKey=['detail',principal.principal_id,requested.kind,requested.id] as const;
 const clear=()=>{generation.current++;request.current?.abort();request.current=null;pendingRelease.current=null;setInFlight(false);setPending(null);setOpaque(null);setState('idle');setMessage('');};
 const authorityFailure=(error:unknown)=>{
  if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked');
  else if(error instanceof FollowSessionRejected)void clearSessionAuthorization(client,principal.principal_id,403,'revoked');
  else if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status))void clearItemAuthorization(client,principal.principal_id,requested.kind,requested.id,error);
 };
 async function authorize(signal:AbortSignal){
  const currentRead=captureWorkbenchRead(signal),startIdentity=latestIdentity.current;
  const fresh=await readSession(signal);currentRead();if(startIdentity!==latestIdentity.current)throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');
  if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
  const detail=await api.detail(requested.kind,requested.id,null,signal);currentRead();if(startIdentity!==latestIdentity.current)throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');
  // Current object READ precedes restoration; a switched-off purpose keeps only the old operation.
  return fresh.workbench_follow_enabled===true&&fresh.workbench_follow_draft_recovery_enabled===true&&detail.item.attention!==undefined;
 }
 useEffect(()=>{
  if(rawEnabled){setProbing(false);return;}
  const controller=new AbortController();setProbing(true);setExisting(false);
  void hasExistingDraft(scope).then(found=>{if(!controller.signal.aborted)setExisting(found);}).catch(error=>{if(!controller.signal.aborted)authorityFailure(error);}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});
  return()=>controller.abort();
 },[identity,rawEnabled]);
 const draft=useAuthorizedDraft<string,WorkbenchFollowCommand>({scope,enabled:rawEnabled||existing,writeEnabled:rawEnabled,value:'',pending,emptyValue:'',hasInput:()=>false,
  serialise:copy=>JSON.stringify({schema:1,...copy}),decode:decodeCopy,commandId:command=>command.client_command_id,authorize,onAuthorityFailure:authorityFailure,
  onRestore:copy=>{if(settling.current)return;setPending(copy.pending);if(copy.pending){setOpaque(copy.pending.client_command_id);setState('unknown');setMessage('已恢复原关注操作；请只读核对，不会自动再次发送。');}},
  onOperation:id=>{if(!settling.current){setOpaque(id);setState('unknown');setMessage('原操作仍待核对；请只读核对。');}},
  onSensitiveClear:()=>{if(!settling.current)clear();},
 });
 const held=useItemUndoRecovery(principal.principal_id,'follow',item,requested);
 const recoveryScope=held?.scope??{principal:principal.principal_id,kind:item.kind,itemId:item.id,intakeId:item.intake_id};
 const inverse=held?.unknown&&held.intent.purpose==='follow'?held.intent:null;
 const commandId=draft.operationId??opaque??pending?.client_command_id??inverse?.id;
 const undo=commandId===inverse?.id?inverse:null;
 const replayCommand=undo?undo.command:pending;
 useEffect(()=>{if(inverse&&!principal.workbench_follow_enabled)keepFollowReceipt(recoveryScope,inverse.id);},[inverse,principal.workbench_follow_enabled]);
 const busy=state==='submitting'||state==='checking'||state==='reading';
 const blocked=['checking','reading','unknown'].includes(state)||Boolean(commandId&&state!=='submitting'&&!settling.current);
 useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{
  const hadRequest=request.current!==null;
  generation.current++;request.current?.abort();request.current=null;pendingRelease.current=null;setInFlight(false);
  if(commandId){
   if(!principal.workbench_follow_enabled){setPending(null);setOpaque(commandId);}
   if(hadRequest)markOptimisticUnknown(principal.principal_id,itemKey,'follow',commandId);
   setState('unknown');setMessage('当前会话或能力已更新；原操作保留，请只读核对。');
  }
 },[identity]);
 useEffect(()=>{
  if(!pending)return;
  const timer=setTimeout(()=>{generation.current++;request.current?.abort();request.current=null;setInFlight(false);setPending(null);setOpaque(pending.client_command_id);setState('unknown');setMessage('原操作内容已过期；保留原操作标识，只能只读核对。');},DRAFT_TTL_MS);
  return()=>clearTimeout(timer);
 },[pending?.client_command_id]);
 useEffect(()=>{
  if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[blocked]);
 useEffect(()=>{
  if(!principal.workbench_follow_enabled&&!commandId&&!existing)return;
  try{return subscribeDrafts(event=>{
   if(event.principal!==principal.principal_id||client.getQueryData<Principal>(['session'])?.principal_id!==principal.principal_id)return;
   if(event.reason==='logout'||event.reason==='logout-unknown'){clear();clearSessionView(client,undefined,'登录已过期，请重新登录。');}
   else if(event.reason==='revoked'&&matchesDraft(event,scope)){clear();void clearItemView(client,principal.principal_id,requested.kind,requested.id,new ApiError(404,'AUTHORIZATION_REJECTED'));}
  });}catch(error){if(!(error instanceof DraftError&&error.message==='DRAFT_STORAGE_UNAVAILABLE'))throw error;}
 },[principal.principal_id,requested.kind,requested.id,principal.workbench_follow_enabled,commandId,existing]);
 function currentRequest(controller:AbortController,token:number,startIdentity:string,check:()=>void){return()=>{const active=client.getQueryData<Principal>(['session']);if(!active||active.principal_id!==principal.principal_id||active.csrf_token!==principal.csrf_token||active.authorization_revision!==principal.authorization_revision||active.expires_epoch_ms!==principal.expires_epoch_ms||JSON.stringify(active.roles)!==JSON.stringify(principal.roles)||active.workbench_follow_enabled!==principal.workbench_follow_enabled||active.workbench_follow_draft_recovery_enabled!==principal.workbench_follow_draft_recovery_enabled||controller.signal.aborted||generation.current!==token||latestIdentity.current!==startIdentity)return false;try{check();return true;}catch{return false;}};}
 async function verifySession(signal:AbortSignal,current:()=>boolean){
  const fresh=await readSession(signal);if(!current())throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');
  if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
  client.setQueryData(['session'],fresh);if(!current())throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');
 }
 const refresh=()=>{void client.invalidateQueries({queryKey:detailKey});void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
 async function readLatest(signal:AbortSignal,current:()=>boolean){
  await verifySession(signal,current);const fresh=await api.detail(requested.kind,requested.id,null,signal);if(!current())throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');await verifySession(signal,current);
  client.setQueryData<InfiniteData<WorkbenchDetail,string|null>>(detailKey,{pages:[fresh],pageParams:[null]});setNeedsRead(false);return fresh;
 }
 async function settle(id:string){settling.current=true;try{return await draft.success(id);}finally{settling.current=false;}}
 async function terminal(id:string,result:WorkbenchFollowResult|null,controller:AbortController,current:()=>boolean,optimistic=false,rejectionError:ApiError|null=null,recoveryStoreOwned=false){
  const cleaned=recoveryStoreOwned?(forgetRecoveredCommand(recoveryScope,'follow',id),true):(forgetRecoveredCommand(recoveryScope,'follow',id)||await settle(id));if(!current())return;setPending(null);setOpaque(cleaned?null:id);setNeedsRead(true);
  if(!cleaned){
   setSuppressToast(false);
   if(result)confirmOptimisticOverlay(principal.principal_id,itemKey,'follow',id);
   setState('unknown');setMessage('已核对原操作，恢复记录清理尚未确认；请继续只读核对。');return;
  }
  if(result){
   confirmOptimisticOverlay(principal.principal_id,itemKey,'follow',id);
   if(optimistic){
    setSuppressToast(true);
    showUndoToast({
     id:'follow:'+id,
     source:'item-follow',
     title:result.following?'已关注':'已取消关注',
     onUndo:()=>executeFollowUndo({
      principal,
      client,
      requested,
      item,
      targetFollowing:!result.following,
      committedFollowVersion:result.follow_version,
      onOpenItem:()=>navigate('/items/'+requested.kind+'/'+requested.id+location.search),
     }),
    });
   }else{
    setSuppressToast(false);
   }
  }else{
   removeOptimisticOverlay(principal.principal_id,itemKey,'follow',id);
   triggerRollbackCue(principal.principal_id,item.kind,item.id,'follow',item.intake_id);
   if(optimistic){
    setSuppressToast(true);
    showErrorActionToast({
     id:'follow-error:'+itemKey,
     source:'item-follow',
     title:'没有生效',
     message:rejectionError?.status===409?'关注状态已变化，请确认后再试':errorMessage(rejectionError),
     actionLabel:'查看',
     onAction:()=>navigate('/items/'+item.kind+'/'+item.id+location.search),
     state:rejectionError?.status===409?'conflict':'denied',
    });
   }else{
    setSuppressToast(false);
   }
  }
  setState(result?'succeeded':'conflict');setMessage(result?'原操作已提交；正在读取当前关注状态…':'原操作已被拒绝；请读取当前资料后确认新的操作。');
  try{await readLatest(controller.signal,current);if(!current())return;setMessage(result?'已确认原操作，当前关注状态已重新读取。':'原操作已被拒绝，当前资料已重新读取。');}
  catch(error){if(!current())return;if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&[401,403,404].includes(error.status)){authorityFailure(error);return;}setMessage(result?'原操作已确认提交，当前状态暂未读回，请重新读取。':'原操作已被拒绝，当前状态暂未读回，请重新读取。');}
  if(current())refresh();
 }
 async function rejectedPurpose(error:ApiError,id:string,controller:AbortController,current:()=>boolean){
  if(error.status===401||error instanceof FollowSessionRejected){removeOptimisticOverlay(principal.principal_id,itemKey,'follow',id);authorityFailure(error);return;}
  // A purpose OFF404 is not loss of the underlying object READ and never settles an UNKNOWN intent.
  try{await readLatest(controller.signal,current);}catch(readError){if(!current())return;if(readError instanceof DraftError&&readError.message==='DRAFT_IDENTITY_CHANGED'||readError instanceof ApiError&&[401,403,404].includes(readError.status)){removeOptimisticOverlay(principal.principal_id,itemKey,'follow',id);authorityFailure(readError);return;}}
  if(!current())return;setSuppressToast(false);markOptimisticUnknown(principal.principal_id,itemKey,'follow',id);setOpaque(id);setState('unknown');setMessage('当前关注操作或核对不可用；原操作仍保留，不会发送新的操作。');
 }
 async function send(command:WorkbenchFollowCommand,replay=false){
  if(request.current||!principal.workbench_follow_enabled||!attention||!principal.csrf_token||!workbenchTransportWritable()||!draft.canSubmit&&!replay)return;
  if(replay&&(!replayCommand||replayCommand.client_command_id!==commandId||probing||draft.status==='loading'||draft.status==='failed'))return;
  const controller=new AbortController(),token=++generation.current,startIdentity=latestIdentity.current,current=currentRequest(controller,token,startIdentity,captureWorkbenchRead(controller.signal));request.current=controller;setInFlight(true);
  const optimistic=!replay;
  const useRecoveryStore=Boolean(undo)||(!rawEnabled&&!draft.operationId);
  let timedOut=false,preparingDraft=false,dispatched=false,postRejection:ApiError|null=null,preparation:ReturnType<typeof draft.prepareSend>=null;
  const releasePreparation=async()=>{
   const releasing=preparation;preparation=null;
   if(!releasing)return;
   try{
    await releasing.release();
    if(pendingRelease.current?.id===command.client_command_id)pendingRelease.current=null;
   }catch{
    pendingRelease.current={id:command.client_command_id,release:()=>releasing.release()};
    setSuppressToast(false);
    setOpaque(command.client_command_id);
    setState('unknown');
    setMessage('本机恢复记录暂未清理；请只读核对原操作。');
   }
  };
  const timerId=optimistic?window.setTimeout(()=>{
   if(!current()||request.current!==controller)return;
   timedOut=true;
   if(!dispatched){
    if(generation.current===token&&!preparingDraft){request.current=null;setInFlight(false);}
    removeOptimisticOverlay(principal.principal_id,itemKey,'follow',command.client_command_id);
    triggerRollbackCue(principal.principal_id,item.kind,item.id,'follow',item.intake_id);
    setSuppressToast(true);
    showErrorActionToast({id:'follow-error:'+itemKey,source:'item-follow',title:'关注没有提交',message:'读取最新状态超时，尚未提交',actionLabel:'查看',onAction:()=>navigate('/items/'+item.kind+'/'+item.id+location.search)});
    setPending(null);
    setOpaque(null);
    setState('denied');
    setMessage('读取最新状态超时，尚未提交。请重试。');
    controller.abort();
    return;
   }
   if(generation.current===token){request.current=null;setInFlight(false);}
   markOptimisticUnknown(principal.principal_id,itemKey,'follow',command.client_command_id);
   setSuppressToast(false);
   setState('unknown');
   setMessage('关注结果未知；请只读核对原操作，或明确重放同一原操作。');
   controller.abort();
  },OPTIMISTIC_UNKNOWN_TIMEOUT_MS):undefined;
  if(optimistic){
   setSuppressToast(true);
   beginOptimisticOverlay(principal.principal_id,{
    itemKey,
    intakeId:item.intake_id,
    kind:'follow',
    slot:'follow',
    clientCommandId:command.client_command_id,
    status:'pending',
    startedAt:Date.now(),
    from:{following:attention.following},
    to:{following:command.following},
   });
  }else{
   setSuppressToast(false);
  }
  if(!undo)setPending(command);
  setOpaque(command.client_command_id);setState('submitting');setMessage(replay?'正在明确重放原关注操作…':'正在保存关注选择…');
  try{
   await verifySession(controller.signal,current);
   if(!undo){
    if(replay){
     if(!await draft.claimReplay(command.client_command_id)){
      if(timerId!==undefined)window.clearTimeout(timerId);
      if(timedOut||!current())return;
      setSuppressToast(false);setState('unknown');setMessage('原操作仍待核对；本次未再次发送。');
      return;
     }
     if(timedOut||!current())return;
    }else{
     if(rawEnabled){
      preparingDraft=true;
      try{
       preparation=draft.prepareSend(command,{exposePending:true});
       await preparation?.save();
      }finally{
       preparingDraft=false;
      }
     }
     if(timedOut||!current()){
      await releasePreparation();
      return;
     }
    }
   }else if(timedOut||!current()){
    return;
   }
   let result:WorkbenchFollowResult;
   const post=async()=>{
    dispatched=true;
    const sending=api.follow(undo?.requested??requested,command,principal.csrf_token,controller.signal);
    const claiming=preparation?.claim().catch(()=>{});
    return await sending.finally(async()=>{await claiming;});
   };
   const executeAndVerify=async():Promise<WorkbenchFollowResult>=>{
    let res:WorkbenchFollowResult;
    try{
     res=await post();
    }catch(error){
     if(error instanceof ApiError&&error.status>=400&&error.status<500){
      postRejection=error;
      if([403,404].includes(error.status))throw new UnsettledFollowError(error);
     }
     throw error;
    }
    if(timedOut||!current())throw new UnsettledFollowError(new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError'));
    try{
     await verifySession(controller.signal,current);
    }catch(error){
     if(
      error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||
      error instanceof FollowSessionRejected||
      error instanceof ApiError&&error.status===401
     ){
      throw error;
     }
     throw new UnsettledFollowError(error);
    }
    if(timedOut||!current())throw new UnsettledFollowError(new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError'));
    return res;
   };
   result=useRecoveryStore
    ?await dispatchRecoverable(recoveryScope,{purpose:'follow',id:command.client_command_id,requested:undo?.requested??requested,command},controller.signal,executeAndVerify)
    :await executeAndVerify();
   if(timerId!==undefined)window.clearTimeout(timerId);
   if(timedOut||!current())return;
   await terminal(command.client_command_id,result,controller,current,optimistic,null,useRecoveryStore);
  }catch(rawError){
   const error=rawError instanceof UnsettledFollowError?rawError.cause:rawError;
   if(timerId!==undefined)window.clearTimeout(timerId);
   if(timedOut||!current())return;
   if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof FollowSessionRejected||error instanceof ApiError&&error.status===401){removeOptimisticOverlay(principal.principal_id,itemKey,'follow',command.client_command_id);authorityFailure(error);}
   else if(!dispatched){
    if(replay){setSuppressToast(false);setState('unknown');setMessage('原操作仍待核对；本次未再次发送。');}
    else{
     removeOptimisticOverlay(principal.principal_id,itemKey,'follow',command.client_command_id);
     triggerRollbackCue(principal.principal_id,item.kind,item.id,'follow',item.intake_id);
     setSuppressToast(true);
     showErrorActionToast({id:'follow-error:'+itemKey,source:'item-follow',title:'关注没有提交',message:'本机草稿未能保存，请重试',actionLabel:'查看',onAction:()=>navigate('/items/'+item.kind+'/'+item.id+location.search)});
     setPending(null);setOpaque(null);setState('denied');setMessage('关注没有提交：本机草稿未能保存。点击重试。');
    }
   }
   else if(error instanceof ApiError&&[401,403,404].includes(error.status))await rejectedPurpose(error,command.client_command_id,controller,current);
   else if(!undo&&postRejection!==null&&error===postRejection)await terminal(command.client_command_id,null,controller,current,optimistic,postRejection,useRecoveryStore);
   else{setSuppressToast(false);markOptimisticUnknown(principal.principal_id,itemKey,'follow',command.client_command_id);setState('unknown');setMessage('关注结果未知；请只读核对原操作，或明确重放同一原操作。');}
  }finally{if(timerId!==undefined)window.clearTimeout(timerId);if(preparation&&!dispatched)await releasePreparation();if(generation.current===token){request.current=null;setInFlight(false);}}
 }
 async function checkOriginal(){
  if(request.current||!commandId||probing||draft.status==='loading')return;
  const id=commandId,command=replayCommand,originalItem=undo?.requested??requested,controller=new AbortController(),token=++generation.current,current=currentRequest(controller,token,latestIdentity.current,captureWorkbenchRead(controller.signal));request.current=controller;setSuppressToast(false);setState('checking');setMessage('正在只读核对原关注操作…');
  try{
   await verifySession(controller.signal,current);
   if(pendingRelease.current?.id===id){
    const retrying=pendingRelease.current;
    await retrying.release();
    if(pendingRelease.current===retrying)pendingRelease.current=null;
    if(!current())return;
    if(draft.currentOperation()===null){setPending(null);setOpaque(null);setState('idle');setMessage('');return;}
   }
   const receipt=await api.followReceipt(originalItem,id,controller.signal);if(!current())return;await verifySession(controller.signal,current);
   if(receipt.state==='UNKNOWN'){markOptimisticUnknown(principal.principal_id,itemKey,'follow',id);setState('unknown');setMessage('原操作尚无可确认终态；请保留原操作，不会自动再次发送。');return;}
   if(receipt.state==='COMMITTED'&&command&&!matchesFollowResult(command,receipt.result,originalItem))throw Error('FOLLOW_ORIGINAL_RESULT_UNCONFIRMED');
   await terminal(id,receipt.state==='COMMITTED'?receipt.result:null,controller,current,false);
  }catch(error){if(!current())return;if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')authorityFailure(error);else if(error instanceof ApiError&&[401,403,404].includes(error.status))await rejectedPurpose(error,id,controller,current);else{setState('unknown');setMessage('只读核对暂未完成；原操作仍保留。');}}
  finally{if(generation.current===token)request.current=null;}
 }
 async function refreshCurrent(){
  if(request.current)return;const controller=new AbortController(),token=++generation.current,current=currentRequest(controller,token,latestIdentity.current,captureWorkbenchRead(controller.signal));request.current=controller;setSuppressToast(false);setState('reading');
  try{await readLatest(controller.signal,current);if(current()){setState(commandId?'unknown':'idle');setMessage(commandId?'当前资料已读取；原操作仍须只读核对。':'');refresh();}}
  catch(error){if(current()){if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&[401,403,404].includes(error.status))authorityFailure(error);else{setNeedsRead(true);setState(commandId?'unknown':'denied');setMessage(errorMessage(error));}}}
  finally{if(generation.current===token)request.current=null;}
 }
 const displayFollowing=followOpt.followTarget??attention?.following??false;
 const settled=!probing&&draft.status!=='loading';
 const canStart=Boolean(principal.workbench_follow_enabled&&attention!==undefined&&readReady&&!needsRead&&!busy&&!blocked&&!inFlight&&!held&&!followOpt.followPending&&!probing&&draft.status!=='loading'&&draft.canSubmit&&principal.csrf_token&&workbenchTransportWritable());
 const triggerRef=useRef<()=>boolean>(()=>false);
 triggerRef.current=()=>{
  if(!canStart||!attention)return false;
  void send(decodeFollowCommand({client_command_id:crypto.randomUUID(),canonical_item:{kind:item.kind,id:item.id},expected_follow_version:attention.follow_version,following:!attention.following}));
  return true;
 };
 const triggerFollow=useCallback(()=>triggerRef.current(),[]);
 const followBusy=busy||blocked||followOpt.followPending||inFlight;
 if(controllerRef)controllerRef.current={canStart,busy:followBusy,inFlight,settled,trigger:triggerFollow};
 const onStateChangeRef=useRef(onStateChange);onStateChangeRef.current=onStateChange;
 useEffect(()=>{
  return()=>{
   if(controllerRef)controllerRef.current=null;
   onBusyChange?.(false);
   onStateChangeRef.current?.({canStart:false,busy:false,inFlight:false,settled:false});
  };
 },[controllerRef,onBusyChange]);
 useEffect(()=>{onBusyChange?.(followBusy);},[followBusy,onBusyChange]);
 useEffect(()=>{onReadyChange?.(settled);},[settled,onReadyChange]);
 useEffect(()=>{onStateChange?.({canStart,busy:followBusy,inFlight,settled});},[canStart,followBusy,inFlight,settled,onStateChange]);
 useEffect(()=>{
  if(headless)return;
  const itemKeyValue=item.kind+':'+item.id;
  registerDetailFollow(itemKeyValue,{canStart,busy:followBusy,settled,trigger:triggerFollow});
  return()=>{registerDetailFollow(itemKeyValue,null);};
 },[headless,item.kind,item.id,canStart,followBusy,settled,triggerFollow]);
 if(!principal.workbench_follow_enabled&&!commandId&&!existing&&!pending)return null;
 if(headless){
  return message&&!suppressToast?<ToastFeedback revision={messageRevision} source="item-follow" state={state} className="ticket-note-state" data-follow-state={state} role={state==='unknown'||state==='conflict'||state==='denied'?'alert':'status'}>{message}</ToastFeedback>:null;
 }
 return <section className="compact-follow" aria-label="个人关注" data-optimistic-pending={followOpt.followPending?'follow':undefined} data-optimistic-state={followOpt.state??undefined}>
  {principal.workbench_follow_enabled&&attention?<TooltipAnchor as="div" className="note-controls"><HButton type="button" data-action="toggle-item-follow" className="icon-button" aria-label={displayFollowing?'取消关注':'关注此事项'} aria-keyshortcuts={ariaKeyshortcuts('follow')} aria-pressed={attention.following} data-following={displayFollowing?'true':'false'} isDisabled={!canStart} onClick={()=>{triggerFollow();}} tone="secondary"><Star size={18} fill={displayFollowing?'currentColor':'none'}/></HButton><span className="follow-tooltip" role="tooltip" data-shortcut-tooltip="true"><span className="follow-tooltip-head"><span>{displayFollowing?'已关注此事项':'关注此事项'}</span><Kbd keys={shortcutKeys('follow')} tone="light"/></span><small>接收后续动态；不改变处理或沟通责任。</small></span><OptimisticBadge pending={followOpt.followPending} kind="follow"/></TooltipAnchor>:null}
  <div className={state==='succeeded'&&!commandId&&!needsRead?'sr-only':'follow-feedback'} hidden={!commandId&&!needsRead&&draft.status!=='failed'&&(!message||suppressToast)}>
  {commandId?<div className="note-controls"><HButton type="button" data-action="follow-ack" isDisabled={busy||inFlight||probing||draft.status==='loading'} onClick={()=>{void checkOriginal();}} tone="secondary">核对结果</HButton>{replayCommand&&principal.workbench_follow_enabled&&attention?<HButton type="button" data-action="follow-replay" isDisabled={busy||inFlight||probing||draft.status==='loading'||draft.status==='failed'||!readReady||!principal.csrf_token||!workbenchTransportWritable()} onClick={()=>{void send(replayCommand,true);}} tone="secondary">重新提交</HButton>:null}</div>:null}
  {needsRead||state==='conflict'||state==='denied'?<HButton type="button" data-action="follow-refresh" isDisabled={busy} onClick={()=>{void refreshCurrent();}} tone="secondary">重新读取当前状态</HButton>:null}
  {draft.enabled&&draft.status==='failed'?<DraftStatus role="status" data-follow-draft-status={draft.status}>{draft.message}</DraftStatus>:null}
  {message&&!suppressToast?<ToastFeedback revision={messageRevision} source="item-follow" state={state} className="ticket-note-state" data-follow-state={state} role={state==='unknown'||state==='conflict'||state==='denied'?'alert':'status'}>{message}</ToastFeedback>:null}
  </div>
 </section>;
}
