import {DetailLoading} from '../../app/DetailLoading';
import {ErrorState} from '../../design/components/ErrorState/ErrorState';
import {useCallback,useContext,useEffect,useMemo,useRef,useState,createContext} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {motionToken} from '../../design/motion/tokens';
import {markSelfWrite} from '../../design/motion/self-write';
import type {ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {CircleX,Undo2,X} from 'lucide-react';
import {Avatar} from '../../design/components/Avatar/Avatar';
import {Tag} from '../../design/components/Tag/Tag';
import {stagePresentation} from '../../design/status-map';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,WorkbenchCard} from '../../api/client';
type WorkbenchClosure=NonNullable<WorkbenchCard['closure']>;
import type {ClosureCommand,IntakeClosureCommand,RestoreCommand} from '../../../../../contracts/unified_closure_contracts';
import type {WaitingCommand} from '../../../../../contracts/workbench_waiting_contracts';
import {closureApi,clearClosureRead} from '../closure/client';
import {reviewApi} from '../manual-review/client';
import {Button} from '../../design/components/Button/Button';
import {Kbd,ShortcutTooltip} from '../../design/components/Kbd/Kbd';
import {ariaKeyshortcuts,shortcutKeys} from '../efficiency/shortcuts';
import type {CloseAdmission,CloseAdmissionOptions} from '../efficiency/keyboard-store';
import {Modal} from '../../design/components/Modal/Modal';
import {ClosureDialog} from '../../design/components/TicketCard/ClosureDialog';
import {closureReasons,closureSecondaryReasons,closureValidation,closureNotification,emptyClosureForm,knownClosureSecondaryCodes} from '../../design/components/TicketCard/closure-presentation';
import type {ClosureFormValue} from '../../design/components/TicketCard/closure-presentation';
import {ClosureTicketSearch} from './ClosureLinks';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError,hasExistingDraft,matchesDraft,openDraft,removeSensitiveDraft,settleDraft,subscribeDrafts} from '../drafts/encrypted-drafts';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {ToastFeedback,DraftStatus,showErrorActionToast,showUndoToast} from '../../app/ToastFeedback';
import {DialogAlert} from '../../app/DialogFeedback';
import {OPTIMISTIC_UNKNOWN_TIMEOUT_MS} from '../optimistic/constants';
import {nowShanghaiLocalString} from '../optimistic/overlay';
import {beginOptimisticOverlay,captureDisplayedCardPosition,confirmOptimisticOverlay,markOptimisticUnknown,optimisticItemKey,removeOptimisticOverlay,triggerRollbackCue} from '../optimistic/store';
import type {CardPositionAnchor} from '../optimistic/store';
import {currentUserDisplayName,executeCloseUndo} from '../optimistic/undo-actions';
import {dispatchRecoverable,forgetRecoveredCommand,hasUnknownCommandRecovery,useCommandRecovery,useCommandRecoveryRevision,useItemUndoRecovery} from '../optimistic/command-recovery';

type Action='close'|'restore';
type Command=IntakeClosureCommand|RestoreCommand;
type Pending=Command|WaitingCommand;
type ClosureSubject={kind:'ticket'|'intake';id:string};
type Target={subject:ClosureSubject;key:string;trigger:HTMLElement|null;background:boolean;item:WorkbenchCard;action:Action;initial:ClosureFormValue;open:boolean};
interface DetailCloseController{canInvoke:boolean;invoke:()=>void;recovering:boolean}
interface ActionScope {request:(item:WorkbenchCard,action:Action,initial?:ClosureFormValue,original?:ClosureSubject)=>void;canOpen:(item:WorkbenchCard,action:Action,original?:ClosureSubject)=>boolean;registerDetailClose:(itemKey:string,controller:DetailCloseController|null)=>void;canCloseAction:(item:WorkbenchCard,options:CloseAdmissionOptions)=>CloseAdmission;requestCloseAction:(item:WorkbenchCard,inDetail?:boolean)=>void;hasCloseRecovery:(item:WorkbenchCard)=>boolean;isCloseDraftChecked:(item:WorkbenchCard)=>boolean;probeCloseDraft:(item:WorkbenchCard,force?:boolean)=>Promise<boolean>;highlighted:string|null;blocked:boolean}
const ClosureScope=createContext<ActionScope|null>(null);
const draftPurpose=(kind:'ticket'|'intake',action:Action)=>kind==='ticket'&&action==='close'?'waiting-cancel':'service-'+action;
export function useCloseItem(){const scope=useContext(ClosureScope);return (item:WorkbenchCard,initial=emptyClosureForm)=>scope?.request(item,'close',initial);}
export function useClosureBridge(){const scope=useContext(ClosureScope);return scope?{canClose:scope.canCloseAction,requestClose:scope.requestCloseAction,hasCloseRecovery:scope.hasCloseRecovery,isCloseDraftChecked:scope.isCloseDraftChecked,probeCloseDraft:scope.probeCloseDraft}:null;}
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
function collapseTriggerMenu():HTMLElement|null{
 const active=document.activeElement instanceof HTMLElement?document.activeElement:null,menu=active?.closest('details[open]');
 if(!(menu instanceof HTMLDetailsElement))return active;
 menu.open=false;const summary=menu.querySelector<HTMLElement>(':scope>summary');summary?.focus();return summary??active;
}
/** The modal's own restore can run while the page behind it is still inert (Escape); put focus back once if it was lost. */
function restoreTriggerFocus(trigger:HTMLElement|null){
 if(!trigger)return;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  const active=document.activeElement;
  if(trigger.isConnected&&(!active||active===document.body))trigger.focus();
 }));
}
export function ClosureActionsProvider({principal,otherBlocked,onBlockedChange,children}:{principal:Principal;otherBlocked:boolean;onBlockedChange:(value:boolean)=>void;children:ReactNode}){
 const navigate=useNavigate(),location=useLocation(),client=useQueryClient();
 const [targets,setTargets]=useState<Target[]>([]),[blockers,setBlockers]=useState<string[]>([]);
 const [outstandingCloseKeys,setOutstandingCloseKeys]=useState<string[]>([]);
 const [persistedCloseDrafts,setPersistedCloseDrafts]=useState<Record<string,boolean>>({});
 const [closeProbeTick,setCloseProbeTick]=useState(0);
 const persistedCloseDraftsRef=useRef<Record<string,boolean>>({});
 const failedCloseProbesRef=useRef<Set<string>>(new Set());
 const inFlightCloseProbesRef=useRef<Map<string,Promise<boolean>>>(new Map());
 const closeProbeGenRef=useRef<Map<string,number>>(new Map());
 const closeProbeEpochRef=useRef(0);
 const principalIdRef=useRef(principal.principal_id);
 principalIdRef.current=principal.principal_id;
 const [highlighted,setHighlighted]=useState<string|null>(null),[success,setSuccess]=useState<{action:Action;revision:number;column:string}|null>(null);
 const report=useCallback((key:string,value:boolean)=>{
  setBlockers(previous=>previous.includes(key)===value?previous:value?[...previous,key]:previous.filter(k=>k!==key));
 },[]);
 const reportOutstanding=useCallback((key:string,value:boolean)=>{
  setOutstandingCloseKeys(previous=>previous.includes(key)===value?previous:value?[...previous,key]:previous.filter(k=>k!==key));
 },[]);
 useEffect(()=>{
  closeProbeEpochRef.current++;
  closeProbeGenRef.current.clear();
  persistedCloseDraftsRef.current={};
  failedCloseProbesRef.current.clear();
  inFlightCloseProbesRef.current.clear();
  setPersistedCloseDrafts({});
 },[principal.principal_id]);
 const runCloseDraftProbe=useCallback((capturedPrincipal:string,s:ClosureSubject,force=false):Promise<boolean>=>{
  const k=capturedPrincipal+':'+s.kind+':'+s.id;
  if(!force&&(Object.hasOwn(persistedCloseDraftsRef.current,k)||failedCloseProbesRef.current.has(k))){
   return Promise.resolve(persistedCloseDraftsRef.current[k]??false);
  }
  const existingProbe=inFlightCloseProbesRef.current.get(k);
  if(!force&&existingProbe)return existingProbe;
  const nextGen=(closeProbeGenRef.current.get(k)??0)+1;
  closeProbeGenRef.current.set(k,nextGen);
  const tokenEpoch=closeProbeEpochRef.current;
  const isCurrent=()=>principalIdRef.current===capturedPrincipal&&closeProbeEpochRef.current===tokenEpoch&&closeProbeGenRef.current.get(k)===nextGen;
  const task=hasExistingDraft({principal:capturedPrincipal,kind:s.kind,id:s.id,purpose:draftPurpose(s.kind,'close')}).then(value=>{
   if(isCurrent()){
    const hadFailed=failedCloseProbesRef.current.delete(k);
    const prevValue=persistedCloseDraftsRef.current[k];
    const hadCached=Object.hasOwn(persistedCloseDraftsRef.current,k);
    persistedCloseDraftsRef.current={...persistedCloseDraftsRef.current,[k]:value};
    if(!hadCached||prevValue!==value){
     setPersistedCloseDrafts(prev=>Object.hasOwn(prev,k)&&prev[k]===value?prev:{...prev,[k]:value});
    }else if(hadFailed){
     setCloseProbeTick(rev=>rev+1);
    }
   }
   return isCurrent()?value:(persistedCloseDraftsRef.current[k]??false);
  },()=>{
   if(isCurrent()){
    const hadCached=Object.hasOwn(persistedCloseDraftsRef.current,k);
    const hadFailed=failedCloseProbesRef.current.has(k);
    if(hadCached){
     const nextCache={...persistedCloseDraftsRef.current};
     delete nextCache[k];
     persistedCloseDraftsRef.current=nextCache;
     setPersistedCloseDrafts(prev=>{
      if(!Object.hasOwn(prev,k))return prev;
      const updated={...prev};
      delete updated[k];
      return updated;
     });
    }
    if(!hadFailed){
     failedCloseProbesRef.current.add(k);
     setCloseProbeTick(rev=>rev+1);
    }
   }
   return false;
  }).finally(()=>{
   if(inFlightCloseProbesRef.current.get(k)===task)inFlightCloseProbesRef.current.delete(k);
  });
  inFlightCloseProbesRef.current.set(k,task);
  return task;
 },[]);
 const probeCloseDraft=useCallback((item:WorkbenchCard,force=false):Promise<boolean>=>{
  return runCloseDraftProbe(principal.principal_id,subject(item),force);
 },[principal.principal_id,runCloseDraftProbe]);
 useEffect(()=>{
  const invalidateNegativeProbes=()=>{
   if(typeof document!=='undefined'&&document.hidden)return;
   const capturedPrincipal=principal.principal_id;
   const entries=Object.entries(persistedCloseDraftsRef.current);
   for(const [k,val] of entries){
    if(val)continue;
    const parts=k.split(':');
    const kind=parts[1],id=parts[2];
    if((kind==='ticket'||kind==='intake')&&id){
     void runCloseDraftProbe(capturedPrincipal,{kind,id},true);
    }
   }
  };
  window.addEventListener('focus',invalidateNegativeProbes);
  document.addEventListener('visibilitychange',invalidateNegativeProbes);
  return()=>{
   window.removeEventListener('focus',invalidateNegativeProbes);
   document.removeEventListener('visibilitychange',invalidateNegativeProbes);
  };
 },[principal.principal_id,runCloseDraftProbe]);
 useEffect(()=>{
  const capturedPrincipal=principal.principal_id;
  try{
   return subscribeDrafts(event=>{
    if(event.principal!==capturedPrincipal)return;
    if(!event.kind||!event.id){
     closeProbeEpochRef.current++;
     closeProbeGenRef.current.clear();
     persistedCloseDraftsRef.current={};
     failedCloseProbesRef.current.clear();
     inFlightCloseProbesRef.current.clear();
     setPersistedCloseDrafts({});
     return;
    }
    if(event.kind!=='ticket'&&event.kind!=='intake')return;
    const closePurpose=draftPurpose(event.kind,'close');
    if(event.purpose&&!matchesDraft(event,{principal:capturedPrincipal,kind:event.kind,id:event.id,purpose:closePurpose}))return;
    const k=capturedPrincipal+':'+event.kind+':'+event.id;
    closeProbeGenRef.current.set(k,(closeProbeGenRef.current.get(k)??0)+1);
    const hadEntry=Object.hasOwn(persistedCloseDraftsRef.current,k)||inFlightCloseProbesRef.current.has(k)||failedCloseProbesRef.current.has(k);
    if(!hadEntry)return;
    const nextCache={...persistedCloseDraftsRef.current};
    delete nextCache[k];
    persistedCloseDraftsRef.current=nextCache;
    failedCloseProbesRef.current.delete(k);
    inFlightCloseProbesRef.current.delete(k);
    setPersistedCloseDrafts(prev=>{
     if(!Object.hasOwn(prev,k))return prev;
     const updated={...prev};
     delete updated[k];
     return updated;
    });
    void runCloseDraftProbe(capturedPrincipal,{kind:event.kind,id:event.id},true);
   });
  }catch(error){
   if(!(error instanceof DraftError&&error.message==='DRAFT_STORAGE_UNAVAILABLE'))throw error;
   return undefined;
  }
 },[principal.principal_id,runCloseDraftProbe]);
 const blocked=blockers.length>0,visible=targets.filter(t=>t.open).at(-1);
 useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
 useEffect(()=>{if(!highlighted)return;const timer=setTimeout(()=>setHighlighted(null),motionToken('--dur-highlight'));return()=>clearTimeout(timer);},[highlighted]);
 const canOpen=useCallback((item:WorkbenchCard,action:Action,s=subject(item))=>{
  const same=targets.find(t=>t.subject.kind===s.kind&&t.subject.id===s.id&&t.action===action);
  return !otherBlocked&&!targets.some(t=>t.background&&t.subject.kind===s.kind&&t.subject.id===s.id)
    &&(!blocked||Boolean(same&&!same.open&&blockers.every(key=>key===same.key)));
 },[otherBlocked,blocked,blockers,targets]);
 const detailCloseControllersRef=useRef<Map<string,DetailCloseController>>(new Map());
 const [detailCloseRev,setDetailCloseRev]=useState(0);
 const recoveryRev=useCommandRecoveryRevision();
 const isCloseDraftChecked=useCallback((item:WorkbenchCard,s=subject(item)):boolean=>{
  void persistedCloseDrafts;
  void closeProbeTick;
  const k=principal.principal_id+':'+s.kind+':'+s.id;
  return Object.hasOwn(persistedCloseDraftsRef.current,k)||failedCloseProbesRef.current.has(k);
 },[principal.principal_id,persistedCloseDrafts,closeProbeTick]);
 const hasCloseRecovery=useCallback((item:WorkbenchCard,s=subject(item)):boolean=>{
  void persistedCloseDrafts;
  void recoveryRev;
  const k=principal.principal_id+':'+s.kind+':'+s.id;
  return Boolean(
   persistedCloseDraftsRef.current[k]||
   outstandingCloseKeys.includes(k+':close')||
   hasUnknownCommandRecovery({principal:principal.principal_id,kind:s.kind,itemId:s.id},'close'),
  );
 },[principal.principal_id,persistedCloseDrafts,outstandingCloseKeys,recoveryRev]);
 const registerDetailClose=useCallback((itemKey:string,controller:DetailCloseController|null)=>{
  const existing=detailCloseControllersRef.current.get(itemKey);
  if(controller){
   detailCloseControllersRef.current.set(itemKey,controller);
   if(!existing||existing.canInvoke!==controller.canInvoke||existing.recovering!==controller.recovering){
    setDetailCloseRev(rev=>rev+1);
   }
  }else if(existing){
   detailCloseControllersRef.current.delete(itemKey);
   setDetailCloseRev(rev=>rev+1);
  }
 },[]);
 const canCloseAction=useCallback((item:WorkbenchCard,{inDetail,detailReady,ticketAdmission}:CloseAdmissionOptions):CloseAdmission=>{
  void detailCloseRev;
  void recoveryRev;
  const s=subject(item);
  if(inDetail){
   if(!detailReady)return 'pending';
   const ctrl=detailCloseControllersRef.current.get(item.kind+':'+item.id);
   if(ctrl)return ctrl.canInvoke?'allowed':'denied';
   if(!isCloseDraftChecked(item,s))return 'pending';
   if(hasCloseRecovery(item,s)||(worker(principal)&&canClose(item)))return 'pending';
   return worker(principal)?'denied':'unauthorized';
  }
  if(hasCloseRecovery(item,s))return canOpen(item,'close',s)?'allowed':'denied';
  if(!canOpen(item,'close',s))return 'denied';
  const draftChecked=isCloseDraftChecked(item,s);
  if(!worker(principal))return draftChecked?'unauthorized':'pending';
  if(!canClose(item))return draftChecked?'denied':'pending';
  if(item.kind==='ticket'){
   if(ticketAdmission==='error')return draftChecked?'error':'pending';
   if(ticketAdmission==='denied')return draftChecked?'denied':'pending';
   if(ticketAdmission==='pending')return 'pending';
  }
  return 'allowed';
 },[detailCloseRev,recoveryRev,principal,hasCloseRecovery,isCloseDraftChecked,canOpen]);
 const requestImpl=(item:WorkbenchCard,action:Action,initial=emptyClosureForm,s=subject(item))=>{
  if(!canOpen(item,action,s))return;
  const key=principal.principal_id+':'+s.kind+':'+s.id+':'+action,trigger=collapseTriggerMenu();
  setTargets(previous=>[...previous.filter(t=>t.key!==key&&(t.open||t.background||blockers.includes(t.key))),
    {key,item,subject:s,action,initial,open:true,background:false,trigger}]);
 };
 const requestRef=useRef(requestImpl);requestRef.current=requestImpl;
 const request=useCallback((item:WorkbenchCard,action:Action,initial=emptyClosureForm,original?:ClosureSubject)=>{requestRef.current(item,action,initial,original);},[]);
 const requestCloseAction=useCallback((item:WorkbenchCard,inDetail=false)=>{
  if(inDetail){
   const ctrl=detailCloseControllersRef.current.get(item.kind+':'+item.id);
   if(ctrl){ctrl.invoke();return;}
  }
  requestRef.current(item,'close',emptyClosureForm);
 },[]);
 const isBlocked=blocked||otherBlocked;
 const scopeHasCloseRecovery=useCallback((item:WorkbenchCard)=>hasCloseRecovery(item),[hasCloseRecovery]);
 const scopeIsCloseDraftChecked=useCallback((item:WorkbenchCard)=>isCloseDraftChecked(item),[isCloseDraftChecked]);
 const scopeProbeCloseDraft=useCallback((item:WorkbenchCard,force?:boolean)=>probeCloseDraft(item,force),[probeCloseDraft]);
 const scopeValue=useMemo(()=>({request,canOpen,registerDetailClose,canCloseAction,requestCloseAction,hasCloseRecovery:scopeHasCloseRecovery,isCloseDraftChecked:scopeIsCloseDraftChecked,probeCloseDraft:scopeProbeCloseDraft,highlighted,blocked:isBlocked}),[request,canOpen,registerDetailClose,canCloseAction,requestCloseAction,scopeHasCloseRecovery,scopeIsCloseDraftChecked,scopeProbeCloseDraft,highlighted,isBlocked]);
 const update=(key:string,open:boolean,background=false)=>setTargets(previous=>previous.map(t=>t.key===key?{...t,open,background}:t));
 const remove=(key:string)=>setTargets(previous=>previous.filter(t=>t.key!==key));
 return <ClosureScope.Provider value={scopeValue}>
  {children}{success?<ToastFeedback source={success.action==='close'?'ticket-waiting-cancel':'closure-restore'} revision={success.revision} state="succeeded" title={success.action==='close'?'已关闭':'已恢复'}>{success.action==='close'?'可在「已处理 · 已关闭」中恢复':'已回到'+success.column}</ToastFeedback>:null}
  {targets.map(target=><ClosureActionDialog key={target.key} target={{...target,open:visible?.key===target.key}} principal={principal} otherBlocked={otherBlocked} onBlockedChange={report} onOutstandingChange={reportOutstanding}
   onDraftSync={target.action==='close'?()=>{void probeCloseDraft(target.item,true);}:undefined}
   onClose={(background=false,retire=false)=>{if(retire&&!background)remove(target.key);else update(target.key,false,background);if(!target.background)restoreTriggerFocus(target.trigger);if(target.action==='close')void probeCloseDraft(target.item,true);}}
   onReopen={()=>update(target.key,true)}
   onSuccess={column=>{if(target.action==='restore')setHighlighted(target.item.intake_id);setSuccess({action:target.action,revision:Date.now(),column});remove(target.key);if(target.action==='close')void probeCloseDraft(target.item,true);}}
   onOptimisticCloseSuccess={({closedItem,notify,restorePosition,committedVersion})=>{
    remove(target.key);
    void probeCloseDraft(target.item,true);
    showUndoToast({
     id:'close:'+optimisticItemKey(closedItem.kind,closedItem.id),
     source:'ticket-waiting-cancel',title:'已关闭',
     message:notify?'报修人通知将在 10 秒后发出':'可在「已处理 · 已关闭」中恢复',
     onUndo:()=>executeCloseUndo({principal,client,item:closedItem,committedVersion,restorePosition,
      previousColumn:closedItem.column==='active'?'active':'pending',previousStatus:closedItem.status,
      onRestored:intakeId=>setHighlighted(intakeId),onOpenItem:()=>navigate('/items/'+closedItem.kind+'/'+closedItem.id+location.search)}),
    });
   }}/>)}
 </ClosureScope.Provider>;
}
export function CloseItemButton({item,principal,initial,shortcut=false}:{item:WorkbenchCard;principal:Principal;initial?:ClosureFormValue;shortcut?:boolean}){
 const scope=useContext(ClosureScope),target=subject(item);
 const probeCloseDraft=scope?.probeCloseDraft;
 useEffect(()=>{if(probeCloseDraft)void probeCloseDraft(item,true);},[principal.principal_id,target.kind,target.id,item.status,probeCloseDraft]);
 const recovering=Boolean(scope?.hasCloseRecovery(item));
 const shown=Boolean(scope&&(recovering||(worker(principal)&&canClose(item))));
 const disabled=!scope||!scope.canOpen(item,'close');
 const invokeRef=useRef(()=>{scope?.request(item,'close',initial);});
 invokeRef.current=()=>{scope?.request(item,'close',initial);};
 const registerDetailClose=scope?.registerDetailClose;
 const itemKey=item.kind+':'+item.id;
 useEffect(()=>{
  if(shortcut||!registerDetailClose)return;
  if(!shown){registerDetailClose(itemKey,null);return;}
  registerDetailClose(itemKey,{canInvoke:!disabled,invoke:()=>invokeRef.current(),recovering});
  return()=>registerDetailClose(itemKey,null);
 },[registerDetailClose,shortcut,itemKey,shown,disabled,recovering]);
 if(!scope||!shown)return null;
 const keys=shortcutKeys('close');
 const button=<Button tone="secondary" data-action={shortcut?'close-out-of-scope':'cancel'} aria-keyshortcuts={!shortcut?ariaKeyshortcuts('close'):undefined} className="cancel-ticket-trigger" isDisabled={disabled} onPress={()=>scope.request(item,'close',initial)}>{shortcut?null:<CircleX aria-hidden="true"/>}{recovering?'核对关闭':shortcut?'记录范围外诉求':'关闭事项…'}{!shortcut?<Kbd keys={keys} disabled={disabled} className="ds-menu-item-kbd"/>:null}</Button>;
 return <section className="ticket-notes ticket-waiting-actions detail-action-controller detail-cancel-controller" data-waiting-purpose="cancel" aria-label="关闭事项">{!shortcut?<ShortcutTooltip label="关闭事项…" keys={keys} placement="top-end">{button}</ShortcutTooltip>:button}</section>;
}
export function RestoreClosedItem({item,principal,inline=false,requested}:{item:WorkbenchCard;principal?:Principal;inline?:boolean;requested?:Pick<WorkbenchCard,'kind'|'id'>|undefined}){
 const scope=useContext(ClosureScope),client=useQueryClient(),p=principal??client.getQueryData<Principal>(['session']);
 const [pending,setPending]=useState(false),target=subject(item);
 useEffect(()=>{if(!p)return;let active=true;void hasExistingDraft({principal:p.principal_id,...target,purpose:draftPurpose(target.kind,'restore')}).then(value=>{if(active)setPending(value);}).catch(()=>{});return()=>{active=false;};},[p?.principal_id,target.kind,target.id,item.status]);
 const held=useItemUndoRecovery(p?.principal_id??'','restore',item,requested);
 const owner=held?.scope,original:ClosureSubject=owner&&(owner.kind==='intake'||owner.kind==='ticket')?{kind:owner.kind,id:owner.itemId}:target;
 if(!scope||!p||!pending&&!held?.unknown&&(!worker(p)||item.closure?.kind!=='DISMISSED'||!item.closure.can_restore))return null;
 return <Button tone={inline?'secondary':'ghost'} className={inline?'ds-closure-restore-inline':'ds-closure-restore'} data-action="restore-dismissed" isDisabled={!scope.canOpen(item,'restore',original)} onPress={()=>scope.request(item,'restore',undefined,original)}><Undo2 size={14}/>{pending||held?.unknown?'核对恢复':'恢复'}</Button>;
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

function ClosureActionDialog({target,principal,otherBlocked,onBlockedChange,onOutstandingChange,onDraftSync,onClose,onReopen,onSuccess,onOptimisticCloseSuccess}:{target:Target;principal:Principal;otherBlocked:boolean;onBlockedChange:(key:string,value:boolean)=>void;onOutstandingChange:(key:string,value:boolean)=>void;onDraftSync?:(()=>void)|undefined;onClose:(background?:boolean,retire?:boolean)=>void;onReopen:()=>void;onSuccess:(column:string)=>void;onOptimisticCloseSuccess:(info:{closedItem:WorkbenchCard;notify:boolean;committedVersion:number;restorePosition:CardPositionAnchor|undefined})=>void}){
 const {item,action,subject:s}=target,client=useQueryClient(),navigate=useNavigate(),location=useLocation(),[value,setValue]=useState(emptyClosureForm),[pending,setPending]=useState<Pending|null>(null),[opaque,setOpaque]=useState<string|null>(null),[busy,setBusy]=useState(false),[backgroundOptimistic,setBackgroundOptimistic]=useState(false),[message,setMessage]=useState(''),[cleanupBlocked,setCleanupBlocked]=useState(false),[storageReady,setStorageReady]=useState(false);
 const displayed=subject(item),receiptOnly=s.kind!==displayed.kind||s.id!==displayed.id;
 const request=useRef<AbortController|null>(null),requestOperation=useRef<string|null>(null),known=useRef<'COMMITTED'|'FAILED'|null>(null),prefillApplied=useRef(false),scope={principal:principal.principal_id,...s,purpose:draftPurpose(s.kind,action)},raw=principal.closure_draft_recovery_enabled;
 const activeOptimisticRef=useRef<{commandId:string;notify:boolean;restorePosition:CardPositionAnchor|undefined;timerId:number|undefined;timedOut:boolean;dispatched:boolean}|null>(null);
 const readContext=async(signal:AbortSignal)=>{
  const current=captureWorkbenchRead(signal);const fresh=await api.bootstrap(signal);current();if(fresh.principal_id!==principal.principal_id)throw new ApiError(401,'WORKBENCH_UNAUTHENTICATED');client.setQueryData(['session'],fresh);
  if(s.kind==='ticket'){const context=await api.ticketCommandContext(s.id,signal);current();return {fresh,version:context.version,allowed:context.allowed_actions.includes(action==='close'?'dismiss':'restore'),review:null};}
  const context=await closureApi.intakeContext(s.id,signal);current();const review=context.pending_review&&action==='close'?await reviewApi.detail(context.pending_review.id,signal):null;current();return {fresh,version:context.version,allowed:action==='close'?context.can_close:context.can_restore,review:review?{id:review.id,row_version:review.row_version,material_basis:review.material_basis.current_hash}:null};
 };
 const context=useQuery({queryKey:['closure-context',principal.principal_id,s.kind,s.id,action,principal.authorization_revision],queryFn:({signal})=>readContext(signal),retry:false,gcTime:0});
 const history=useQuery({queryKey:['closure-history',principal.principal_id,s.kind,s.id,principal.authorization_revision],queryFn:({signal})=>closureApi.history(s.kind,s.id,null,signal),enabled:action==='restore',retry:false,gcTime:0});
 // The target is captured while visible: after a committed restore the refreshed history no longer has one.
 const shownTarget=useRef<'pending'|'active'|null>(null);if(history.data?.restore_target)shownTarget.current=history.data.restore_target.column;
 // Recovering after a lost response mounts with no target; the confirmed current item then says where it is.
 const restoreColumn=()=>{const column=history.data?.restore_target?.column??shownTarget.current??(receiptOnly||item.column==='handled'?null:item.column);return column==='active'?'处理中':column==='pending'?(s.kind==='ticket'?'待接单':'待判断'):'关闭前所在列';};
 const clear=()=>{if(activeOptimisticRef.current?.timerId!==undefined)window.clearTimeout(activeOptimisticRef.current.timerId);activeOptimisticRef.current=null;setBackgroundOptimistic(false);request.current?.abort();request.current=null;requestOperation.current=null;setValue(emptyClosureForm);setPending(null);setBusy(false);};
 const denied=(error:unknown)=>{if(error instanceof ApiError&&[401,403,404].includes(error.status)){if(!receiptOnly)removeOptimisticOverlay(principal.principal_id,optimisticItemKey(item.kind,item.id),'movement');clear();if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearClosureRead(client,principal.principal_id,s.kind,s.id,error).then(()=>clearItemAuthorization(client,principal.principal_id,receiptOnly?s.kind:item.kind,receiptOnly?s.id:item.id,error));onClose(false,true);return true;}return false;};
 const draft=useAuthorizedDraft<ClosureFormValue,Pending>({scope,enabled:raw,writeEnabled:raw&&context.data?.allowed===true,refreshBlankAfterPurposeRemoval:true,value,pending,emptyValue:emptyClosureForm,hasInput:form=>Boolean(form.reason||form.note),serialise:copy=>JSON.stringify({schema:1,...copy}),decode:decodeDraft,commandId:command=>command.client_command_id,
  authorize:async signal=>{const result=await readContext(signal);return result.fresh.closure_draft_recovery_enabled&&result.allowed;},onAuthorityFailure:error=>{if(!denied(error))setMessage(errorMessage(error));},
  onRestore:(copy,retained)=>{setValue(!retained&&!copy.pending&&target.initial.reason?{...copy.value,reason:target.initial.reason,secondary:target.initial.secondary,duplicate:'',notify:false}:copy.value);setPending(copy.pending);if(copy.pending)setMessage('上次操作结果待核对；不会重复提交。');},onOperation:(id,preserveInput)=>{if(request.current&&requestOperation.current!==id){request.current.abort();request.current=null;requestOperation.current=null;setBusy(false);known.current=null;}setOpaque(id);setPending(null);if(!preserveInput)setValue(emptyClosureForm);},onOperationCleared:conflict=>{request.current?.abort();request.current=null;requestOperation.current=null;setBusy(false);known.current=null;setOpaque(null);setPending(null);setCleanupBlocked(false);setMessage(conflict?'本页输入未保存，请先自行留存。':'上次操作已结束，可继续处理。');},onSensitiveClear:clear});
 const recoveryScope={principal:principal.principal_id,kind:s.kind,itemId:s.id};
 const held=useCommandRecovery(recoveryScope,action);
 const originalId=pending?.client_command_id??opaque??draft.operationId??(held?.unknown?held.intent.id:null),locked=busy||Boolean(originalId)||Boolean(held)||cleanupBlocked;
 const unsaved=Boolean(value.reason||value.note)&&!draft.safeToLeave;
 const openItem=()=>{onClose(false,!unsaved&&!originalId&&!cleanupBlocked);void navigate('/items/'+item.kind+'/'+item.id+location.search);};
 // A saved draft must be read before the opening intent supplies its reason.
 useEffect(()=>{if(!target.open){prefillApplied.current=false;return;}if(prefillApplied.current||!target.initial.reason||originalId||raw&&draft.status==='loading')return;prefillApplied.current=true;setValue(value=>({...value,reason:target.initial.reason,secondary:target.initial.secondary,duplicate:'',notify:false}));},[target.open,target.initial,originalId,raw,draft.status]);
 useEffect(()=>{onBlockedChange(target.key,target.open||(!backgroundOptimistic&&unsaved));return()=>onBlockedChange(target.key,false);},[onBlockedChange,target.key,target.open,backgroundOptimistic,unsaved]);
 const hasOutstandingClose=action==='close'&&Boolean(originalId||cleanupBlocked);
 useEffect(()=>{onOutstandingChange(target.key,hasOutstandingClose);return()=>onOutstandingChange(target.key,false);},[onOutstandingChange,target.key,hasOutstandingClose]);
 const onDraftSyncRef=useRef(onDraftSync);
 onDraftSyncRef.current=onDraftSync;
 const lastSyncedDraftStatusRef=useRef<string|null>(null);
 useEffect(()=>{
  if(action!=='close')return;
  if((draft.status==='saved'||draft.status==='ready')&&lastSyncedDraftStatusRef.current!==draft.status){
   lastSyncedDraftStatusRef.current=draft.status;
   onDraftSyncRef.current?.();
  }else if(draft.status!=='saved'&&draft.status!=='ready'){
   lastSyncedDraftStatusRef.current=draft.status;
  }
 },[action,draft.status]);
 useEffect(()=>()=>{
  const opt=activeOptimisticRef.current;
  if(opt){
   window.clearTimeout(opt.timerId);
   const key=optimisticItemKey(item.kind,item.id);
   if(opt.dispatched&&known.current==='COMMITTED')confirmOptimisticOverlay(principal.principal_id,key,'movement',opt.commandId);
   else if(opt.dispatched&&known.current!=='FAILED')markOptimisticUnknown(principal.principal_id,key,'movement',opt.commandId);
   else removeOptimisticOverlay(principal.principal_id,key,'movement',opt.commandId);
  }
  request.current?.abort();
 },[]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(locked&&target.open||unsaved)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[locked,target.open,unsaved]);
 const existing=async(current:()=>void)=>{const found=await hasExistingDraft(scope);current();if(!found)return null;const copy=await openDraft(scope,{restore:false});current();if(copy.handle.record)await removeSensitiveDraft(copy.handle,'revoked',{requireMatchingRevision:true});current();return copy.handle;};
 useEffect(()=>{if(raw){setStorageReady(true);return;}const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);setStorageReady(false);
  void (async()=>{await readContext(controller.signal);current();const handle=await existing(current);setOpaque(handle?.operation?.commandId??null);setStorageReady(true);})().catch(error=>{if(!controller.signal.aborted&&!denied(error))setMessage('恢复标记暂不可读，请重试。');});return()=>controller.abort();
 },[raw,principal.principal_id,s.kind,s.id,action]);
 useEffect(()=>{if(context.error)denied(context.error);if(history.error)denied(history.error);},[context.error,history.error]);
 const refresh=async()=>{await Promise.all(['board','detail','workbench-search','closure-history','closure-context','ticket-command-context','manual-review','ticket-follow-up-schedule','web-report'].map(name=>client.invalidateQueries({queryKey:[name,principal.principal_id]})));};
 const settle=async(id:string,preserveInput:boolean)=>{if(raw)return draft.success(id,preserveInput);if(!await hasExistingDraft(scope))return true;const copy=await openDraft(scope,{restore:false});if(copy.handle.record||copy.handle.operation&&copy.handle.operation.commandId!==id)return false;if(copy.handle.operation)await settleDraft(copy.handle,id);return true;};
 const finish=async(id:string,state:'COMMITTED'|'FAILED',current:()=>void,committedVersion?:number)=>{known.current=state;const independent=draft.hasRetainedInput(),cleaned=state==='FAILED'&&raw?await draft.knownFailure(id,true,{notifyLocal:false,notifyReplacement:false,revalidateBlocked:true,requireCurrent:current}):await settle(id,state==='FAILED'||independent);current();if(!cleaned){const opt=activeOptimisticRef.current;if(opt?.timerId!==undefined)window.clearTimeout(opt.timerId);activeOptimisticRef.current=null;setBackgroundOptimistic(false);if(state==='COMMITTED')confirmOptimisticOverlay(principal.principal_id,optimisticItemKey(item.kind,item.id),'movement',id);const next=draft.currentOperation();if(next&&next!==id){known.current=null;setPending(null);setOpaque(next);setCleanupBlocked(false);setMessage('另一个页面已开始新的操作，请先核对。');onReopen();return;}setCleanupBlocked(true);setOpaque(id);setMessage('操作终态已确认，本地恢复标记尚待清理。请核对上次操作。');onReopen();return;}
  setPending(null);setOpaque(null);setCleanupBlocked(false);
  const opt=activeOptimisticRef.current;
  if(opt&&opt.commandId===id&&state==='COMMITTED'&&committedVersion!==undefined&&!independent){
   if(opt.timerId!==undefined)window.clearTimeout(opt.timerId);
   activeOptimisticRef.current=null;
   setBackgroundOptimistic(false);
   markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
   confirmOptimisticOverlay(principal.principal_id,optimisticItemKey(item.kind,item.id),'movement',id);
   setValue(emptyClosureForm);
   onOptimisticCloseSuccess({closedItem:item,committedVersion,notify:opt.notify,restorePosition:opt.restorePosition});
   void refresh();
   return;
  }
  await refresh();current();
  if(state==='COMMITTED'&&!independent){
   if(action==='close')confirmOptimisticOverlay(principal.principal_id,optimisticItemKey(item.kind,item.id),'movement',id);
   setValue(emptyClosureForm);onSuccess(restoreColumn());
  }else{
   if(opt&&independent&&state==='COMMITTED'){
    confirmOptimisticOverlay(principal.principal_id,optimisticItemKey(item.kind,item.id),'movement',id);
    activeOptimisticRef.current=null;setBackgroundOptimistic(false);onReopen();
   }
   setMessage(state==='COMMITTED'?'上次操作已提交，本页输入保留；请核对当前资料。':'上次操作已明确失败。请核对当前资料后重新选择操作。');
  }
 };
 const submit=async()=>{
  if(receiptOnly||request.current||locked||otherBlocked||!storageReady||!draft.canSubmit||!context.data?.allowed||context.isError||context.isFetching||action==='close'&&closureValidation(value)||action==='restore'&&(!history.data?.restore_target||history.isFetching||history.isError))return;
  if(action==='close'&&!workbenchTransportWritable()){setMessage('网络未就绪：网络恢复前不会提交，你的输入已保留。');return;}
  const controller=new AbortController(),read=captureWorkbenchRead(controller.signal),current=()=>{read();if(request.current!==controller)throw new DOMException('CLOSURE_CHANGED','AbortError');};request.current=controller;setBusy(true);setMessage('');let sent=false;
  const version=context.data.version,notice=closureNotification(value),base:ClosureCommand={client_command_id:crypto.randomUUID(),expected_version:version,reason_code:value.reason||'OTHER',...(value.reason==='NOT_IT_SCOPE'&&value.secondary?{secondary_reason_code:value.secondary}:{}),...(value.note.trim()?{note:value.note.trim()}:{}),...(value.reason==='DUPLICATE'&&value.duplicate?{duplicate_of_ref:value.duplicate}:{}),notify_reporter:notice.notify};
   const command:Command=action==='restore'?{client_command_id:base.client_command_id,expected_version:version,reason_code:'RESTORE_CLOSED'}:{...base,...(context.data.review?{expected_review_version:context.data.review.row_version,expected_material_basis:context.data.review.material_basis}:{})};requestOperation.current=command.client_command_id;
  const itemKey=optimisticItemKey(item.kind,item.id);
  if(action==='close'){
   const restorePosition=captureDisplayedCardPosition(principal.principal_id,item);
   const reasonOption=closureReasons.find(option=>option.value===base.reason_code);
   const secondaryOption=base.secondary_reason_code?closureSecondaryReasons.find(option=>option.value===base.secondary_reason_code):undefined;
   const duplicateNo=base.reason_code==='DUPLICATE'&&base.duplicate_of_ref?{display_no:base.duplicate_of_ref}:null;
   const endedAt=nowShanghaiLocalString();
   const optimisticClosure:WorkbenchClosure={
    kind:'DISMISSED',
    source:'MANUAL',
    reason_code:base.reason_code,
    reason_label:reasonOption?.label??'其他',
    reason_note:base.note??null,
    secondary_reason:base.secondary_reason_code?{code:base.secondary_reason_code,label:secondaryOption?.label??base.secondary_reason_code}:null,
    ended_by_display_name:currentUserDisplayName(principal,client),
    ended_at:endedAt,
    duplicate_of:duplicateNo,
    can_restore:true,
   };
   markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
   beginOptimisticOverlay(principal.principal_id,{
    itemKey,
    intakeId:item.intake_id,
    kind:'close',
    slot:'movement',
    clientCommandId:command.client_command_id,
    status:'pending',
    startedAt:Date.now(),
    from:{column:item.column,status:item.status,assigneeName:item.assignee_name,closure:item.closure,position:restorePosition,card:item},
    to:{column:'handled',status:'DISMISSED',assigneeName:item.assignee_name,closure:optimisticClosure,updatedAt:endedAt},
   });
   setBackgroundOptimistic(true);
   onClose(true,false);
   const optState={commandId:command.client_command_id,notify:notice.notify,restorePosition,timerId:undefined as number|undefined,timedOut:false,dispatched:false};
   optState.timerId=window.setTimeout(()=>{
    if(request.current!==controller)return;
    controller.abort();
    activeOptimisticRef.current=null;request.current=null;requestOperation.current=null;
    setBusy(false);setBackgroundOptimistic(false);
    removeOptimisticOverlay(principal.principal_id,itemKey,'movement',command.client_command_id);
    triggerRollbackCue(principal.principal_id,item.kind,item.id,'close',item.intake_id);
    setMessage('读取最新状态超时，尚未提交。填写内容已保留，请重试。');onReopen();
    showErrorActionToast({source:'ticket-waiting-cancel',title:'没有关闭成功',message:'读取最新状态超时，尚未提交',
     actionLabel:'查看',onAction:openItem});
   },OPTIMISTIC_UNKNOWN_TIMEOUT_MS);
   activeOptimisticRef.current=optState;
  }
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
   const optState=activeOptimisticRef.current;
   if(optState?.timerId!==undefined)window.clearTimeout(optState.timerId);
   await draft.prepare(command);current();setPending(command);known.current=null;sent=true;
   if(optState){
    optState.timerId=window.setTimeout(()=>{
     if(request.current!==controller)return;
     optState.timedOut=true;
     activeOptimisticRef.current=null;
     request.current=null;
     requestOperation.current=null;
     setBusy(false);
     setBackgroundOptimistic(false);
     markOptimisticUnknown(principal.principal_id,itemKey,'movement',command.client_command_id);
     setMessage('提交结果未知。请核对上次操作，不会重复提交。');
     onReopen();
     controller.abort();
    },OPTIMISTIC_UNKNOWN_TIMEOUT_MS);
   }
   let committedVersion:number|undefined;
   if(action==='restore'){const input:RestoreCommand={client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:'RESTORE_CLOSED'};if(s.kind==='ticket')await api.restoreClosedTicket(s.id,input,fresh.fresh.csrf_token,controller.signal);else await closureApi.restoreIntake(s.id,input,fresh.fresh.csrf_token,controller.signal);}
   else{
    const input=command as IntakeClosureCommand;
    const post=async()=>{
     if(optState)optState.dispatched=true;
     return s.kind==='ticket'?(await api.closeTicket(s.id,input,fresh.fresh.csrf_token,controller.signal)).ticket_version
     :(await closureApi.closeIntake(s.id,input,fresh.fresh.csrf_token,controller.signal)).version;
    };
    committedVersion=raw?await post():await dispatchRecoverable(recoveryScope,{purpose:'close',id:input.client_command_id},controller.signal,post);
   }
   if(optState?.timerId!==undefined)window.clearTimeout(optState.timerId);
   markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
   current();known.current='COMMITTED';await finish(command.client_command_id,'COMMITTED',current,committedVersion);
  }catch(error){
   if(request.current!==controller)return;
   const opt=activeOptimisticRef.current;
   if(opt?.timerId!==undefined)window.clearTimeout(opt.timerId);
   if(opt?.timedOut)return;
   activeOptimisticRef.current=null;
   setBackgroundOptimistic(false);
   if(controller.signal.aborted)return;
   if(denied(error))return;
   if(known.current==='COMMITTED'){setCleanupBlocked(true);setOpaque(command.client_command_id);setMessage('原操作已提交，刷新或清理尚待核对。');if(action==='close'){confirmOptimisticOverlay(principal.principal_id,itemKey,'movement',command.client_command_id);onReopen();}}
   else if(error instanceof ApiError||!sent||error instanceof DraftError){
    if(action==='close'){
     markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
     removeOptimisticOverlay(principal.principal_id,itemKey,'movement',command.client_command_id);
     triggerRollbackCue(principal.principal_id,item.kind,item.id,'close',item.intake_id);
     onReopen();
    }
    if(sent){known.current='FAILED';try{await finish(command.client_command_id,'FAILED',current);}catch{if(controller.signal.aborted||request.current!==controller)return;setCleanupBlocked(true);setOpaque(command.client_command_id);}}
    if(controller.signal.aborted||request.current!==controller)return;
    const failureMsg=error instanceof ApiError&&error.status===409?'事项已变化，填写内容已保留。请读取最新资料后重新确认。':errorMessage(error);
    setMessage(failureMsg);
    if(action==='close'){
     showErrorActionToast({
      id:'close-error:'+itemKey,
      source:'ticket-waiting-cancel',
      title:'没有关闭成功',
      message:error instanceof ApiError&&error.status===409?'事项状态已变化，填写内容已保留':errorMessage(error),
      actionLabel:'查看',
      onAction:openItem,
      state:error instanceof ApiError&&error.status===409?'conflict':'denied',
     });
    }
    void context.refetch();if(action==='restore')void history.refetch();
   }else{
    if(action==='close'){
     markOptimisticUnknown(principal.principal_id,itemKey,'movement',command.client_command_id);
     onReopen();
    }
    setMessage('提交结果未知。请核对上次操作，不会重复提交。');
   }
   }finally{if(request.current===controller){request.current=null;requestOperation.current=null;setBusy(false);}}
 };
  const check=async()=>{if(!originalId||request.current)return;const controller=new AbortController(),read=captureWorkbenchRead(controller.signal),current=()=>{read();if(request.current!==controller)throw new DOMException('CLOSURE_CHANGED','AbortError');};request.current=controller;requestOperation.current=originalId;setBusy(true);
  try{await readContext(controller.signal);current();const result=s.kind==='intake'?await closureApi.intakeReceipt(s.id,action,originalId,controller.signal):action==='restore'?await closureApi.ticketRestoreReceipt(s.id,originalId,controller.signal):await api.waitingAcknowledgement(s.id,'dismiss',originalId,controller.signal);current();
   if(result.state==='UNKNOWN'){setMessage('提交结果仍待核对；原操作标识保留。');return;}
   if(result.state==='COMMITTED')markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
   else if(action==='close'){
    markSelfWrite(principal.principal_id,{kind:item.kind,id:item.id,intakeId:item.intake_id});
    removeOptimisticOverlay(principal.principal_id,optimisticItemKey(item.kind,item.id),'movement',originalId);
    triggerRollbackCue(principal.principal_id,item.kind,item.id,'close',item.intake_id);
   }
   if(forgetRecoveredCommand(recoveryScope,action,originalId)&&action==='restore'){
    await refresh();current();
    if(result.state==='COMMITTED')onSuccess(restoreColumn());
    else setMessage('上次操作已明确失败。请核对当前资料后重新选择操作。');
   }else await finish(originalId,result.state,current);
   }catch(error){if(!controller.signal.aborted&&request.current===controller&&!denied(error))setMessage('核对暂未完成，未重复提交。');}finally{if(request.current===controller){request.current=null;requestOperation.current=null;setBusy(false);}}
 };
 const close=async()=>{if(locked)return;onClose(false,!unsaved);};
 const feedback=<>{context.isPending?<DetailLoading inline label="正在加载可用操作…"/>:context.isError?<ErrorState title="可用操作没有读出来" onRetry={()=>{void context.refetch();}}/>:!context.data?.allowed&&!originalId?<p role="alert">当前事项不可执行此操作，请刷新后核对。</p>:null}{message?<DialogAlert className="ticket-waiting-state" source={action==='close'?'ticket-waiting-cancel':'closure-restore'} state={originalId?'unknown':'idle'}>{message}</DialogAlert>:null}</>;
 const draftStatus=raw&&draft.message?<DraftStatus notify={false} inlineText data-waiting-draft-status>{draft.message}</DraftStatus>:null,discard=action==='close'&&(value.reason||value.note)&&!locked?()=>{if(raw)void draft.discard();else setValue(emptyClosureForm);}:null;
 const recovery=<>{originalId?<Button tone="secondary" data-toast-avoid="bottom" data-action={action==='close'?'check-cancel-command':'check-restore-command'} isDisabled={busy} onPress={()=>{void check();}}>核对结果</Button>:null}</>;
 const enabled=Boolean(!receiptOnly&&storageReady&&draft.canSubmit&&context.data?.allowed&&!context.isFetching&&!context.isError&&!otherBlocked);
 if(action==='close')return <ClosureDialog open={target.open} number={item.number} title={item.title} value={value} onChange={setValue} busy={busy} locked={locked} canSubmit={enabled&&!closureValidation(value)} onClose={()=>{void close();}} onSubmit={()=>{void submit();}} search={<ClosureTicketSearch principal={principal} subjectId={s.id} selected={value.duplicate} disabled={locked} onSelect={duplicate=>setValue(value=>({...value,duplicate}))}/>} inProgress={item.column==='active'} feedback={feedback} error={value.reason==='OTHER'||value.reason==='NOT_IT_SCOPE'?closureValidation(value):null} recovery={recovery} draft={draftStatus} onDiscard={discard}/>;
 const restore=history.data?.restore_target;
 // Card 29 R2: three notice states. Restore notifies only after a closure that chose to notify, so the closure's own choice decides 「本次不发送」.
 const restoreNotice=!restore?'':!restore.notify_reporter?'关闭时未通知报修人，本次不发送':restore.notification_state==='SENT'?'关闭时已通知，将通知报修人已重新受理':'关闭通知尚未送达，恢复后将按送达结果决定是否通知';
 return <Modal.Backdrop isOpen={target.open} isDismissable={false} isKeyboardDismissDisabled={locked} onOpenChange={open=>{if(!open)void close();}}><Modal.Container size="sm" className="ds-restore-container"><Modal.Dialog className="ds-closure-dialog ds-restore-dialog" aria-label="恢复事项" data-workbench-overlay data-workbench-modal data-toast-host>
  <header data-toast-avoid="top"><Modal.Heading>恢复事项</Modal.Heading><Button tone="ghost" isIconOnly aria-label="关闭恢复窗口" isDisabled={locked} onPress={()=>{void close();}}><X size={18}/></Button></header>
  <p className="ds-closure-context"><span className="ds-closure-number">{item.number}</span> · {item.title}</p>
  {history.isPending?<DetailLoading inline label="正在加载恢复后的安排…"/>:history.isError?<ErrorState title="恢复安排没有读出来" onRetry={()=>{void history.refetch();}}/>:restore?<>
   <dl className="ds-restore-facts" data-restore-confirmation>
    <div><dt>回到</dt><dd><Tag tone={stagePresentation[restore.column].tone}>{restoreColumn()}</Tag></dd></div>
    <div><dt>负责人</dt><dd>{restore.assignee_name?<><Avatar name={restore.assignee_name} size={20} aria-hidden="true"/><span>{restore.assignee_name}</span></>:<span className="ds-restore-unassigned">未领取</span>}</dd></div>
    <div><dt>通知</dt><dd>{restoreNotice}</dd></div>
   </dl>
   {restore.column==='active'?<p className="ds-restore-followups">已终止的跟进与提醒不会自动重建，需要时请重新发起。</p>:null}</>:<p>当前没有可恢复的关闭记录。</p>}
  {feedback}{recovery}<footer data-toast-avoid="bottom"><div className="ds-closure-draft"/><div className="ds-closure-actions"><Button tone="secondary" isDisabled={locked} onPress={()=>{void close();}}>取消</Button><Button tone="primary" data-action="confirm-restore-dismissed" isDisabled={!enabled||locked||!restore||history.isError||history.isFetching} onPress={()=>{void submit();}}><Undo2 aria-hidden="true"/>确认恢复</Button></div></footer>
 </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
