import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {CircleX,Undo2,X} from 'lucide-react';
import {Avatar} from '../../design/components/Avatar/Avatar';
import {Tag} from '../../design/components/Tag/Tag';
import {stagePresentation} from '../../design/status-map';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,WorkbenchCard} from '../../api/client';
import type {ClosureCommand,IntakeClosureCommand,RestoreCommand} from '../../../../../contracts/unified_closure_contracts';
import type {WaitingCommand} from '../../../../../contracts/workbench_waiting_contracts';
import {closureApi,clearClosureRead} from '../closure/client';
import {reviewApi} from '../manual-review/client';
import {Button} from '../../design/components/Button/Button';
import {Modal} from '../../design/components/Modal/Modal';
import {ClosureDialog} from '../../design/components/TicketCard/ClosureDialog';
import {closureReasons,closureSecondaryReasons,closureValidation,closureNotification,emptyClosureForm,knownClosureSecondaryCodes} from '../../design/components/TicketCard/closure-presentation';
import type {ClosureFormValue} from '../../design/components/TicketCard/closure-presentation';
import {ClosureTicketSearch} from './ClosureLinks';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError,hasExistingDraft,openDraft,removeSensitiveDraft,settleDraft} from '../drafts/encrypted-drafts';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {ToastFeedback,DraftStatus} from '../../app/ToastFeedback';

type Action='close'|'restore';
type Command=IntakeClosureCommand|RestoreCommand;
type Pending=Command|WaitingCommand;
type Target={item:WorkbenchCard;action:Action;initial:ClosureFormValue;open:boolean};
interface ActionScope {request:(item:WorkbenchCard,action:Action,initial?:ClosureFormValue)=>void;canOpen:(item:WorkbenchCard,action:Action)=>boolean;highlighted:string|null;blocked:boolean}
const ClosureScope=createContext<ActionScope|null>(null);
const draftPurpose=(kind:'ticket'|'intake',action:Action)=>kind==='ticket'&&action==='close'?'waiting-cancel':'service-'+action;
export function useCloseItem(){const scope=useContext(ClosureScope);return (item:WorkbenchCard,initial=emptyClosureForm)=>scope?.request(item,'close',initial);}
// Pending Review and closed Intake cards have different kind/id, but one Intake identity.
export function useClosureHighlight(item:WorkbenchCard){return useContext(ClosureScope)?.highlighted===item.intake_id;}
export function useClosureNavigationBlocked(){return useContext(ClosureScope)?.blocked??false;}
const worker=(p:Principal)=>p.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role));
const canClose=(item:WorkbenchCard)=>item.kind==='ticket'?['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','REOPENED'].includes(item.status):item.column==='pending';
const subject=(item:WorkbenchCard)=>({kind:item.kind==='ticket'?'ticket' as const:'intake' as const,id:item.kind==='ticket'?item.id:item.intake_id});

/**
 * Card 32 B3: a 「⋯」 menu item that opens this dialog closes its menu first and hands focus to the menu's trigger, before the modal
 * mounts; the modal then restores focus to 「⋯」 when it closes instead of to a hidden menu item.
 */
function collapseTriggerMenu(){
 const active=document.activeElement instanceof HTMLElement?document.activeElement:null,menu=active?.closest('details[open]');
 if(!(menu instanceof HTMLDetailsElement))return;
 menu.open=false;menu.querySelector<HTMLElement>(':scope>summary')?.focus();
}
export function ClosureActionsProvider({principal,otherBlocked,onBlockedChange,children}:{principal:Principal;otherBlocked:boolean;onBlockedChange:(value:boolean)=>void;children:ReactNode}){
 const [target,setTarget]=useState<Target|null>(null),[blocked,setBlocked]=useState(false),[highlighted,setHighlighted]=useState<string|null>(null),[success,setSuccess]=useState<{action:Action;revision:number;column:string}|null>(null);
 const report=useCallback((value:boolean)=>{setBlocked(value);onBlockedChange(value);},[onBlockedChange]);
 useEffect(()=>{if(!highlighted)return;const timer=setTimeout(()=>setHighlighted(null),1200);return()=>clearTimeout(timer);},[highlighted]);
 const sameClosedTarget=(item:WorkbenchCard,action:Action)=>Boolean(target&&!target.open&&target.action===action&&subject(target.item).kind===subject(item).kind&&subject(target.item).id===subject(item).id);
 const canOpen=(item:WorkbenchCard,action:Action)=>!otherBlocked&&(!blocked||sameClosedTarget(item,action));
 return <ClosureScope.Provider value={{request:(item,action,initial=emptyClosureForm)=>{if(canOpen(item,action)){collapseTriggerMenu();setTarget(previous=>blocked&&previous?{...previous,initial,open:true}:{item,action,initial,open:true});}},canOpen,highlighted,blocked:blocked||otherBlocked}}>
  {children}{success?<ToastFeedback source={success.action==='close'?'ticket-waiting-cancel':'closure-restore'} revision={success.revision} state="succeeded" title={success.action==='close'?'已关闭':'已恢复'}>{success.action==='close'?'可在「已处理 · 已关闭」中恢复':'已回到'+success.column}</ToastFeedback>:null}{target?<ClosureActionDialog key={target.item.kind+':'+target.item.id+':'+target.action} target={target} principal={principal} otherBlocked={otherBlocked} onBlockedChange={report} onClose={()=>setTarget(value=>value?{...value,open:false}:null)} onSuccess={column=>{if(target.action==='restore')setHighlighted(target.item.intake_id);setSuccess({action:target.action,revision:Date.now(),column});setTarget(null);}}/>:null}
 </ClosureScope.Provider>;
}
export function CloseItemButton({item,principal,initial,shortcut=false}:{item:WorkbenchCard;principal:Principal;initial?:ClosureFormValue;shortcut?:boolean}){
 const scope=useContext(ClosureScope),[pending,setPending]=useState(false),target=subject(item);
 useEffect(()=>{let active=true;void hasExistingDraft({principal:principal.principal_id,...target,purpose:draftPurpose(target.kind,'close')}).then(value=>{if(active)setPending(value);}).catch(()=>{});return()=>{active=false;};},[principal.principal_id,target.kind,target.id,item.status]);
 if(!scope||!pending&&(!worker(principal)||!canClose(item)))return null;
 return <section className="ticket-notes ticket-waiting-actions detail-action-controller detail-cancel-controller" data-waiting-purpose="cancel" aria-label="关闭事项"><Button tone="secondary" data-action={shortcut?'close-out-of-scope':'cancel'} className="cancel-ticket-trigger" isDisabled={!scope.canOpen(item,'close')} onPress={()=>scope.request(item,'close',initial)}>{shortcut?null:<CircleX aria-hidden="true"/>}{pending?'核对关闭':shortcut?'记录范围外诉求':'关闭事项…'}</Button></section>;
}
export function RestoreClosedItem({item,principal,inline=false}:{item:WorkbenchCard;principal?:Principal;inline?:boolean}){
 const scope=useContext(ClosureScope),client=useQueryClient(),p=principal??client.getQueryData<Principal>(['session']);
 const [pending,setPending]=useState(false),target=subject(item);
 useEffect(()=>{if(!p)return;let active=true;void hasExistingDraft({principal:p.principal_id,...target,purpose:draftPurpose(target.kind,'restore')}).then(value=>{if(active)setPending(value);}).catch(()=>{});return()=>{active=false;};},[p?.principal_id,target.kind,target.id,item.status]);
 if(!scope||!p||!pending&&(!worker(p)||item.closure?.kind!=='DISMISSED'||!item.closure.can_restore))return null;
 return <Button tone={inline?'secondary':'ghost'} className={inline?'ds-closure-restore-inline':'ds-closure-restore'} data-action="restore-closed" isDisabled={!scope.canOpen(item,'restore')} onPress={()=>scope.request(item,'restore')}><Undo2 size={14}/>{pending?'核对恢复':'恢复'}</Button>;
}

function decodeDraft(text:string):{value:ClosureFormValue;pending:Pending|null}{
 const raw:unknown=JSON.parse(text);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new DraftError('DRAFT_CORRUPT');const r=raw as Record<string,unknown>,v=r.value;
 if(r.schema===1&&Object.keys(r).length===3&&typeof r.note==='string'&&r.note.length<=2000&&Object.hasOwn(r,'pending')){
  let pending:WaitingCommand|null=null;
  if(r.pending!==null){if(!r.pending||typeof r.pending!=='object'||Array.isArray(r.pending))throw new DraftError('DRAFT_CORRUPT');const c=r.pending as Record<string,unknown>;
   if(Object.keys(c).length!==5||typeof c.client_command_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(c.client_command_id)||typeof c.expected_version!=='number'||!Number.isSafeInteger(c.expected_version)||c.expected_version<1||c.expected_version>2147483647||typeof c.reason_code!=='string'||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(c.reason_code)||typeof c.note!=='string'||!c.note.trim()||c.note.length>2000||c.external_visible!==false)throw new DraftError('DRAFT_CORRUPT');
   pending={client_command_id:c.client_command_id,expected_version:c.expected_version,reason_code:c.reason_code,note:c.note,external_visible:false};
  }
  return {value:{...emptyClosureForm,reason:r.note.trim()?'OTHER':'',note:r.note},pending};
 }
 if(r.schema!==1||Object.keys(r).length!==3||!v||typeof v!=='object')throw new DraftError('DRAFT_CORRUPT');const f=v as Record<string,unknown>;
 if(Object.keys(f).length!==5||!['',...closureReasons.map(x=>x.value)].includes(String(f.reason))||!['',...knownClosureSecondaryCodes].includes(String(f.secondary))||typeof f.note!=='string'||f.note.length>2000||typeof f.duplicate!=='string'||f.duplicate.length>128||typeof f.notify!=='boolean')throw new DraftError('DRAFT_CORRUPT');
 let pending:Pending|null=null;
 if(r.pending!==null){if(!r.pending||typeof r.pending!=='object')throw new DraftError('DRAFT_CORRUPT');const c=r.pending as Record<string,unknown>;
  if(typeof c.client_command_id!=='string'||!/^[0-9a-f-]{36}$/iu.test(c.client_command_id)||typeof c.expected_version!=='number'||!Number.isInteger(c.expected_version)||c.expected_version<1||c.expected_version>2147483647)throw new DraftError('DRAFT_CORRUPT');
  if(c.reason_code==='RESTORE_CLOSED'){if(Object.keys(c).length!==3)throw new DraftError('DRAFT_CORRUPT');pending={client_command_id:c.client_command_id,expected_version:c.expected_version,reason_code:'RESTORE_CLOSED'};}
  else{if(Object.keys(c).some(key=>!['client_command_id','expected_version','reason_code','secondary_reason_code','note','duplicate_of_ref','notify_reporter','expected_review_version','expected_material_basis'].includes(key))||!closureReasons.some(x=>x.value===c.reason_code)||c.secondary_reason_code!==undefined&&!knownClosureSecondaryCodes.some(code=>code===c.secondary_reason_code)||c.note!==undefined&&(typeof c.note!=='string'||c.note.length>2000)||c.duplicate_of_ref!==undefined&&(typeof c.duplicate_of_ref!=='string'||c.duplicate_of_ref.length>128)||typeof c.notify_reporter!=='boolean'||c.expected_review_version!==undefined&&(typeof c.expected_review_version!=='string'||!/^\d{1,19}$/u.test(c.expected_review_version)))throw new DraftError('DRAFT_CORRUPT');if(c.expected_material_basis!==undefined&&(typeof c.expected_material_basis!=='string'||!/^[a-f0-9]{64}$/u.test(c.expected_material_basis)))throw new DraftError('DRAFT_CORRUPT');pending={client_command_id:c.client_command_id,expected_version:c.expected_version,reason_code:c.reason_code as ClosureCommand['reason_code'],notify_reporter:c.notify_reporter,...(typeof c.secondary_reason_code==='string'?{secondary_reason_code:c.secondary_reason_code as NonNullable<ClosureCommand['secondary_reason_code']>}:{}),...(typeof c.note==='string'?{note:c.note}:{}),...(typeof c.duplicate_of_ref==='string'?{duplicate_of_ref:c.duplicate_of_ref}:{}),...(typeof c.expected_review_version==='string'?{expected_review_version:c.expected_review_version}:{}),...(typeof c.expected_material_basis==='string'?{expected_material_basis:c.expected_material_basis}:{})};}
 }
 // Card 29 K1: an older draft's retired option is cleared for a fresh choice; an unfinished command keeps its original code for checking.
 const secondary=closureSecondaryReasons.some(x=>x.value===f.secondary)?f.secondary as ClosureFormValue['secondary']:'';
 return {value:{reason:f.reason as ClosureFormValue['reason'],secondary,note:f.note,duplicate:f.duplicate,notify:f.notify},pending};
}

function ClosureActionDialog({target,principal,otherBlocked,onBlockedChange,onClose,onSuccess}:{target:Target;principal:Principal;otherBlocked:boolean;onBlockedChange:(value:boolean)=>void;onClose:()=>void;onSuccess:(column:string)=>void}){
 const {item,action}=target,s=subject(item),client=useQueryClient(),[value,setValue]=useState(emptyClosureForm),[pending,setPending]=useState<Pending|null>(null),[opaque,setOpaque]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[cleanupBlocked,setCleanupBlocked]=useState(false),[storageReady,setStorageReady]=useState(false);
 const request=useRef<AbortController|null>(null),known=useRef<'COMMITTED'|'FAILED'|null>(null),prefillApplied=useRef(false),scope={principal:principal.principal_id,...s,purpose:draftPurpose(s.kind,action)},raw=principal.closure_draft_recovery_enabled;
 const readContext=async(signal:AbortSignal)=>{
  const current=captureWorkbenchRead(signal);const fresh=await api.bootstrap(signal);current();if(fresh.principal_id!==principal.principal_id)throw new ApiError(401,'WORKBENCH_UNAUTHENTICATED');client.setQueryData(['session'],fresh);
  if(s.kind==='ticket'){const context=await api.ticketCommandContext(s.id,signal);current();return {fresh,version:context.version,allowed:context.allowed_actions.includes(action==='close'?'cancel':'restore'),review:null};}
  const context=await closureApi.intakeContext(s.id,signal);current();const review=context.pending_review&&action==='close'?await reviewApi.detail(context.pending_review.id,signal):null;current();return {fresh,version:context.version,allowed:action==='close'?context.can_close:context.can_restore,review:review?{id:review.id,row_version:review.row_version,material_basis:review.material_basis.current_hash}:null};
 };
 const context=useQuery({queryKey:['closure-context',principal.principal_id,s.kind,s.id,action,principal.authorization_revision],queryFn:({signal})=>readContext(signal),retry:false,gcTime:0});
 const history=useQuery({queryKey:['closure-history',principal.principal_id,s.kind,s.id,principal.authorization_revision],queryFn:({signal})=>closureApi.history(s.kind,s.id,null,signal),enabled:action==='restore',retry:false,gcTime:0});
 // The target is captured while visible: after a committed restore the refreshed history no longer has one.
 const shownTarget=useRef<'pending'|'active'|null>(null);if(history.data?.restore_target)shownTarget.current=history.data.restore_target.column;
 // Recovering after a lost response mounts with no target; the confirmed current item then says where it is.
 const restoreColumn=()=>{const column=history.data?.restore_target?.column??shownTarget.current??(item.column==='closed'?null:item.column);return column==='active'?'处理中':column==='pending'?(s.kind==='ticket'?'待接单':'待判断'):'关闭前所在列';};
 const clear=()=>{request.current?.abort();request.current=null;setValue(emptyClosureForm);setPending(null);setBusy(false);};
 const denied=(error:unknown)=>{if(error instanceof ApiError&&[401,403,404].includes(error.status)){clear();if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearClosureRead(client,principal.principal_id,s.kind,s.id,error).then(()=>clearItemAuthorization(client,principal.principal_id,item.kind,item.id,error));onClose();return true;}return false;};
 const draft=useAuthorizedDraft<ClosureFormValue,Pending>({scope,enabled:raw,writeEnabled:raw&&context.data?.allowed===true,refreshBlankAfterPurposeRemoval:true,value,pending,emptyValue:emptyClosureForm,hasInput:form=>Boolean(form.reason||form.note),serialise:copy=>JSON.stringify({schema:1,...copy}),decode:decodeDraft,commandId:command=>command.client_command_id,
  authorize:async signal=>{const result=await readContext(signal);return result.fresh.closure_draft_recovery_enabled&&result.allowed;},onAuthorityFailure:error=>{if(!denied(error))setMessage(errorMessage(error));},
  onRestore:copy=>{setValue(!copy.pending&&target.initial.reason?{...copy.value,reason:target.initial.reason,secondary:target.initial.secondary,duplicate:'',notify:false}:copy.value);setPending(copy.pending);if(copy.pending)setMessage('上次操作结果待核对；不会重复提交。');},onOperation:id=>{setOpaque(id);setPending(null);setValue(emptyClosureForm);},onSensitiveClear:clear});
 const originalId=pending?.client_command_id??opaque??draft.operationId,locked=busy||Boolean(originalId)||cleanupBlocked;
 // A saved draft must be read before the opening intent supplies its reason.
 useEffect(()=>{if(!target.open){prefillApplied.current=false;return;}if(prefillApplied.current||!target.initial.reason||originalId||raw&&draft.status==='loading')return;prefillApplied.current=true;setValue(value=>({...value,reason:target.initial.reason,secondary:target.initial.secondary,duplicate:'',notify:false}));},[target.open,target.initial,originalId,raw,draft.status]);
 const unsaved=Boolean(value.reason||value.note)&&!draft.safeToLeave;
 useEffect(()=>{onBlockedChange(target.open||unsaved);return()=>onBlockedChange(false);},[onBlockedChange,target.open,unsaved]);
 useEffect(()=>()=>request.current?.abort(),[]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(locked&&target.open||unsaved)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[locked,target.open,unsaved]);
 const existing=async(current:()=>void)=>{const found=await hasExistingDraft(scope);current();if(!found)return null;const copy=await openDraft(scope,{restore:false});current();if(copy.handle.record)await removeSensitiveDraft(copy.handle,'revoked',{requireMatchingRevision:true});current();return copy.handle;};
 useEffect(()=>{if(raw){setStorageReady(true);return;}const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);setStorageReady(false);
  void (async()=>{await readContext(controller.signal);current();const handle=await existing(current);setOpaque(handle?.operation?.commandId??null);setStorageReady(true);})().catch(error=>{if(!controller.signal.aborted&&!denied(error))setMessage('恢复标记暂不可读，请重试。');});return()=>controller.abort();
 },[raw,principal.principal_id,s.kind,s.id,action]);
 useEffect(()=>{if(context.error)denied(context.error);if(history.error)denied(history.error);},[context.error,history.error]);
 const refresh=async()=>{await Promise.all(['board','detail','workbench-search','closure-history','closure-context','ticket-command-context','manual-review','ticket-follow-up-schedule','web-report'].map(name=>client.invalidateQueries({queryKey:[name,principal.principal_id]})));};
 const settle=async(id:string,preserveInput:boolean)=>{if(raw)return draft.success(id,preserveInput);if(!await hasExistingDraft(scope))return true;const copy=await openDraft(scope,{restore:false});if(copy.handle.record||copy.handle.operation&&copy.handle.operation.commandId!==id)return false;if(copy.handle.operation)await settleDraft(copy.handle,id);return true;};
 const finish=async(id:string,state:'COMMITTED'|'FAILED',current:()=>void)=>{known.current=state;if(state==='COMMITTED')setValue(emptyClosureForm);const cleaned=await settle(id,state==='FAILED');current();if(!cleaned){setCleanupBlocked(true);setOpaque(id);setMessage('操作终态已确认，本地恢复标记尚待清理。请核对上次操作。');return;}
  setPending(null);setOpaque(null);setCleanupBlocked(false);await refresh();current();if(state==='COMMITTED')onSuccess(restoreColumn());else setMessage('上次操作已明确失败。请核对当前资料后重新选择操作。');
 };
 const submit=async()=>{
  if(request.current||locked||otherBlocked||!storageReady||!draft.canSubmit||!context.data?.allowed||context.isError||context.isFetching||action==='close'&&closureValidation(value)||action==='restore'&&(!history.data?.restore_target||history.isFetching||history.isError))return;
  const controller=new AbortController(),read=captureWorkbenchRead(controller.signal),current=()=>{read();if(request.current!==controller)throw new DOMException('CLOSURE_CHANGED','AbortError');};request.current=controller;setBusy(true);setMessage('');let sent=false;
  const version=context.data.version,notice=closureNotification(value),base:ClosureCommand={client_command_id:crypto.randomUUID(),expected_version:version,reason_code:value.reason||'OTHER',...(value.reason==='NOT_IT_SCOPE'&&value.secondary?{secondary_reason_code:value.secondary}:{}),...(value.note.trim()?{note:value.note.trim()}:{}),...(value.reason==='DUPLICATE'&&value.duplicate?{duplicate_of_ref:value.duplicate}:{}),notify_reporter:notice.notify};
  const command:Command=action==='restore'?{client_command_id:base.client_command_id,expected_version:version,reason_code:'RESTORE_CLOSED'}:{...base,...(context.data.review?{expected_review_version:context.data.review.row_version,expected_material_basis:context.data.review.material_basis}:{})};
  try{const fresh=await readContext(controller.signal);current();if(!fresh.allowed)throw new ApiError(403,'P2_016_FORBIDDEN');if(fresh.version!==version||fresh.review?.row_version!==context.data.review?.row_version||fresh.review?.material_basis!==context.data.review?.material_basis)throw new ApiError(409,'P2_016_VERSION_CONFLICT');
   if(action==='restore'){
    const latest=await closureApi.history(s.kind,s.id,null,controller.signal);current();
    if(!history.data?.restore_target||latest.version!==history.data.version||JSON.stringify(latest.restore_target)!==JSON.stringify(history.data.restore_target)){
     client.setQueryData(['closure-history',principal.principal_id,s.kind,s.id,principal.authorization_revision],latest);
     setMessage('恢复目标或关闭通知状态已变化，请核对新提示后再次确认。');return;
    }
   }
   if(!workbenchTransportWritable()||fresh.fresh.closure_draft_recovery_enabled!==raw)throw new ApiError(409,'WORKBENCH_TRANSPORT_NOT_WRITABLE');
   if(!raw){const handle=await existing(current);if(handle?.operation){setOpaque(handle.operation.commandId);throw new DraftError('DRAFT_OPERATION_PENDING');}}
   await draft.prepare(command);current();setPending(command);known.current=null;sent=true;
   if(action==='restore'){const input:RestoreCommand={client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:'RESTORE_CLOSED'};if(s.kind==='ticket')await api.restoreClosedTicket(s.id,input,fresh.fresh.csrf_token,controller.signal);else await closureApi.restoreIntake(s.id,input,fresh.fresh.csrf_token,controller.signal);}
   else{const input=command as IntakeClosureCommand;if(s.kind==='ticket')await api.closeTicket(s.id,input,fresh.fresh.csrf_token,controller.signal);else await closureApi.closeIntake(s.id,input,fresh.fresh.csrf_token,controller.signal);}
   current();known.current='COMMITTED';await finish(command.client_command_id,'COMMITTED',current);
  }catch(error){if(controller.signal.aborted)return;if(denied(error))return;
   if(known.current==='COMMITTED'){setCleanupBlocked(true);setOpaque(command.client_command_id);setMessage('原操作已提交，刷新或清理尚待核对。');}
   else if(error instanceof ApiError||!sent){if(sent){known.current='FAILED';try{await finish(command.client_command_id,'FAILED',current);}catch{setCleanupBlocked(true);setOpaque(command.client_command_id);}}setMessage(error instanceof ApiError&&error.status===409?'事项已变化，填写内容已保留。请读取最新资料后重新确认。':errorMessage(error));void context.refetch();if(action==='restore')void history.refetch();}
   else setMessage('提交结果未知。请核对上次操作，不会重复提交。');
  }finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 const check=async()=>{if(!originalId||request.current)return;const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);request.current=controller;setBusy(true);
  try{await readContext(controller.signal);current();const result=s.kind==='intake'?await closureApi.intakeReceipt(s.id,action,originalId,controller.signal):action==='restore'?await closureApi.ticketRestoreReceipt(s.id,originalId,controller.signal):await api.waitingAcknowledgement(s.id,'cancel',originalId,controller.signal);current();
   if(result.state==='UNKNOWN'){setMessage('提交结果仍待核对；原操作标识保留。');return;}await finish(originalId,result.state,current);
  }catch(error){if(!controller.signal.aborted&&!denied(error))setMessage('核对暂未完成，未重复提交。');}finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 const close=async()=>{if(locked)return;onClose();};
 const feedback=<>{context.isPending?<p role="status">正在核验操作权限…</p>:context.isError?<p role="alert">读取失败。<Button tone="ghost" onPress={()=>{void context.refetch();}}>重试</Button></p>:!context.data?.allowed&&!originalId?<p role="alert">当前事项不可执行此操作，请刷新后核对。</p>:null}{message?<p role="status">{message}</p>:null}</>;
 const draftStatus=raw&&draft.message?<DraftStatus notify={false} inlineText data-waiting-draft-status>{draft.message}</DraftStatus>:null,discard=action==='close'&&(value.reason||value.note)&&!locked?()=>{if(raw)void draft.discard();else setValue(emptyClosureForm);}:null;
 const recovery=<>{originalId?<Button tone="secondary" data-action={action==='close'?'check-cancel-command':'check-restore-command'} isDisabled={busy} onPress={()=>{void check();}}>核对上次操作</Button>:null}{message?<ToastFeedback className="ticket-waiting-state" source={action==='close'?'ticket-waiting-cancel':'closure-restore'} state={originalId?'unknown':'idle'}>{message}</ToastFeedback>:null}</>;
 const enabled=Boolean(storageReady&&draft.canSubmit&&context.data?.allowed&&!context.isFetching&&!context.isError&&!otherBlocked);
 if(action==='close')return <ClosureDialog open={target.open} number={item.number} title={item.title} value={value} onChange={setValue} busy={busy} locked={locked} canSubmit={enabled&&!closureValidation(value)} onClose={()=>{void close();}} onSubmit={()=>{void submit();}} search={<ClosureTicketSearch principal={principal} subjectId={s.id} selected={value.duplicate} disabled={locked} onSelect={duplicate=>setValue(value=>({...value,duplicate}))}/>} inProgress={item.column==='active'} feedback={feedback} error={value.reason==='OTHER'||value.reason==='NOT_IT_SCOPE'?closureValidation(value):null} recovery={recovery} draft={draftStatus} onDiscard={discard}/>;
 const restore=history.data?.restore_target;
 // Card 29 R2: three notice states. Restore notifies only after a closure that chose to notify, so the closure's own choice decides 「本次不发送」.
 const restoreNotice=!restore?'':!restore.notify_reporter?'关闭时未通知报修人，本次不发送':restore.notification_state==='SENT'?'关闭时已通知，将通知报修人已重新受理':'关闭通知尚未送达，恢复后将按送达结果决定是否通知';
 return <Modal.Backdrop isOpen={target.open} isDismissable={false} isKeyboardDismissDisabled={locked} onOpenChange={open=>{if(!open)void close();}}><Modal.Container size="sm" className="ds-restore-container"><Modal.Dialog className="ds-closure-dialog ds-restore-dialog" aria-label="恢复事项" data-workbench-overlay>
  <header><Modal.Heading>恢复事项</Modal.Heading><Button tone="ghost" isIconOnly aria-label="关闭恢复窗口" isDisabled={locked} onPress={()=>{void close();}}><X size={18}/></Button></header>
  <p className="ds-closure-context"><span className="ds-closure-number">{item.number}</span> · {item.title}</p>
  {history.isPending?<p role="status">正在核对恢复目标…</p>:history.isError?<p role="alert">恢复目标暂不可读。<Button tone="ghost" onPress={()=>{void history.refetch();}}>重试</Button></p>:restore?<>
   <dl className="ds-restore-facts" data-restore-confirmation>
    <div><dt>回到</dt><dd><Tag tone={stagePresentation[restore.column].tone}>{restoreColumn()}</Tag></dd></div>
    <div><dt>负责人</dt><dd>{restore.assignee_name?<><Avatar name={restore.assignee_name} size={20} aria-hidden="true"/><span>{restore.assignee_name}</span></>:<span className="ds-restore-unassigned">未领取</span>}</dd></div>
    <div><dt>通知</dt><dd>{restoreNotice}</dd></div>
   </dl>
   {restore.column==='active'?<p className="ds-restore-followups">已终止的跟进与提醒不会自动重建，需要时请重新发起。</p>:null}</>:<p>当前没有可恢复的关闭记录。</p>}
  {feedback}{recovery}<footer><div className="ds-closure-draft"/><div className="ds-closure-actions"><Button tone="secondary" isDisabled={locked} onPress={()=>{void close();}}>取消</Button><Button tone="primary" data-action="confirm-restore-closed" isDisabled={!enabled||locked||!restore||history.isError||history.isFetching} onPress={()=>{void submit();}}><Undo2 aria-hidden="true"/>确认恢复</Button></div></footer>
 </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
