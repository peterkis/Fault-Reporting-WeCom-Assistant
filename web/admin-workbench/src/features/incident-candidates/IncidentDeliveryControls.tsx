import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization,clearSessionView} from '../../app/authorization';
import {DraftError,matchesDraft,purgeDrafts,subscribeDrafts} from '../drafts/encrypted-drafts';
import {incidentDeliveryApi,IncidentDeliveryCommandRefusal,IncidentDeliverySessionRejected} from './delivery-control-client';
import {useIncidentDeliveryDraft,EMPTY_INCIDENT_DELIVERY_DRAFT} from './use-incident-delivery-draft';
import type {IncidentDeliveryDraftValue} from './use-incident-delivery-draft';
import type {IncidentResult} from './client';
import {decodeIncidentDeliveryOperation,matchesIncidentDeliveryResult} from '../../../../../src/workbench-incident-delivery-browser-contracts.mjs';
import type {IncidentDeliveryOperation,IncidentDeliveryPurpose,IncidentDeliveryResolution,IncidentDeliveryStatus,IncidentDeliverySideEffect,IncidentDeliveryControlResult} from '../../../../../src/workbench-incident-delivery-browser-contracts.mjs';

export interface IncidentDeliveryRoute {deliveryId:string;status:IncidentDeliveryStatus;effect:IncidentDeliverySideEffect;attemptCount:number;label:string}
type State='idle'|'preparing'|'submitting'|'reading'|'checking'|'unknown'|'failed'|'committed'|'denied';
class ControlDisabled extends Error {}
const resolutions:readonly IncidentDeliveryResolution[]=['CONFIRMED_SENT','CONFIRMED_NOT_SENT_REQUEUE','CANCEL'];
const resolutionLabels:Record<IncidentDeliveryResolution,string>={CONFIRMED_SENT:'核对确认已发送，记录结果',CONFIRMED_NOT_SENT_REQUEUE:'核对确认未发送，重新排队',CANCEL:'取消后续处理，保留结果未知事实'};
const reasonLabels={OPERATOR_CONFIRMED_NOT_ATTEMPTED:'已核实此路确定未发送',OPERATOR_VERIFIED_DELIVERY:'已完成此路发送结果核对',OPERATOR_CANCEL_UNKNOWN_DELIVERY:'结束此路后续处理，结果仍未知'};
const statusLabels:Record<IncidentDeliveryStatus,string>={PENDING:'待发送',LEASED:'已领取待发送',SENDING:'发送中',SENT:'已发送',RECONCILIATION_REQUIRED:'结果未知待核对',DEAD_LETTER:'发送失败',CANCELLED:'已取消'};
const unavailable=(error:unknown)=>error instanceof ApiError&&[401,403,404].includes(error.status);
function identity(principal:Principal){return JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.expires_epoch_ms,[...principal.roles].sort(),principal.incident_delivery_control_enabled,principal.incident_delivery_control_draft_recovery_enabled]);}
export function IncidentDeliveryControls({principal,detail,purpose,routes,readReady,otherBlocked,onBlockedChange,onChanged}:{principal:Principal;detail:IncidentResult;purpose:IncidentDeliveryPurpose;routes:readonly IncidentDeliveryRoute[];readReady:boolean;otherBlocked:boolean;onBlockedChange:(blocked:boolean)=>void;onChanged:()=>void}){
 const client=useQueryClient(),incidentId=detail.id,queryPrefix=['incident-delivery-control',principal.principal_id,incidentId,purpose];
 const [value,setValue]=useState<IncidentDeliveryDraftValue>(EMPTY_INCIDENT_DELIVERY_DRAFT),[pending,setPending]=useState<IncidentDeliveryOperation|null>(null),[opaque,setOpaque]=useState<string|null>(null);
 const [state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false),[checked,setChecked]=useState(false),[needsRead,setNeedsRead]=useState(false),[revoked,setRevoked]=useState(false),[result,setResult]=useState<IncidentDeliveryControlResult|null>(null);
 const request=useRef<AbortController|null>(null),generation=useRef(0),settling=useRef(false),clearRequested=useRef(false),known=useRef(false),currentIdentity=useRef(identity(principal)),latestAction=useRef(value.action);currentIdentity.current=identity(principal);latestAction.current=pending?.action??value.action;
 const selected=routes.find(route=>route.deliveryId===value.deliveryId);
 const authority=principal.authorization_revision??[...principal.roles].sort().join('|');
 const capability=useQuery({queryKey:[...queryPrefix,'capability',authority,principal.incident_delivery_control_enabled,value.deliveryId],enabled:Boolean(readReady&&value.deliveryId&&!revoked),queryFn:({signal})=>incidentDeliveryApi.control({incidentId,deliveryId:value.deliveryId??'',purpose},signal),retry:false,gcTime:0});
 const clearSensitive=()=>{setValue(EMPTY_INCIDENT_DELIVERY_DRAFT);setPending(null);setConfirmed(false);setChecked(false);};
 function revoke(error:unknown,purge=true){
  generation.current++;request.current?.abort();request.current=null;clearSensitive();setOpaque(null);setResult(null);setRevoked(true);setNeedsRead(true);setState('denied');setMessage('当前通知控制用途或此公共故障已失权，原输入和恢复副本停止展示。');
  void client.cancelQueries({queryKey:queryPrefix},{revert:false});client.removeQueries({queryKey:queryPrefix});
  if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked');
  else if(error instanceof IncidentDeliverySessionRejected)void clearSessionAuthorization(client,principal.principal_id,403,'revoked');
  else if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
  else if(purge)void purgeDrafts({principal:principal.principal_id,kind:'incident',id:incidentId,purpose:purpose==='INCIDENT_LIFECYCLE'?'incident-delivery-lifecycle':'incident-delivery-public-progress',reason:'revoked'}).catch(()=>setMessage('当前内容已停止展示；本地恢复清理尚未确认，禁止新提交。'));
  onChanged();
 }
 function authorityFailure(error:unknown){
  if(unavailable(error)||error instanceof DraftError&&['DRAFT_IDENTITY_CHANGED','DRAFT_ACTION_REVOKED'].includes(error.message)){revoke(error);return;}
  setNeedsRead(true);
  if(originalId)setState(known.current?'committed':'unknown');
  setMessage(originalId?'恢复或授权读取尚未完成，原 UUID 保留；不会发起新操作。':'恢复或授权读取尚未完成，输入保留；请重新读取后确认。');
 }
 function requirePrincipal(fresh:Principal,startIdentity:string){
  if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
  if(currentIdentity.current!==startIdentity)throw new DOMException('INCIDENT_DELIVERY_REPLACED','AbortError');
  client.setQueryData(['session'],fresh);
  if(identity(fresh)!==startIdentity)throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');
 }
 async function authorizeDraft(signal:AbortSignal){
  const startIdentity=currentIdentity.current,current=captureWorkbenchRead(signal),read=await incidentDeliveryApi.context(incidentId,purpose,null,signal);current();requirePrincipal(read.principal,startIdentity);
  return read.principal.incident_delivery_control_enabled===true&&read.principal.incident_delivery_control_draft_recovery_enabled===true;
 }
 const draft=useIncidentDeliveryDraft({principal,incidentId,purpose,readReady,writeReady:!revoked&&readReady&&capability.data?.receipt_read===true,value,pending,authorize:authorizeDraft,onAuthorityFailure:authorityFailure,
  onRestore:async(copy,signal)=>{
   const startIdentity=currentIdentity.current,token=generation.current,current=captureWorkbenchRead(signal);
   const read=await incidentDeliveryApi.context(incidentId,purpose,copy.value.deliveryId,signal);current();requirePrincipal(read.principal,startIdentity);
   if(token!==generation.current||signal.aborted)throw new DOMException('INCIDENT_DELIVERY_REPLACED','AbortError');
   if(!read.principal.incident_delivery_control_enabled||!read.principal.incident_delivery_control_draft_recovery_enabled||!read.capability?.receipt_read)throw new DraftError('DRAFT_ACTION_REVOKED');
   // Restoration never checks or settles an original receipt automatically.
   // Current action authority permits the original body; current state availability
   // controls only a new intent and does not revoke an existing UUID.
   const actionAllowed=copy.value.action==='RETRY'?read.capability.retry_authorized:copy.value.action==='RECONCILE'?read.capability.reconcile_authorized:true;
   if(!actionAllowed){
    if(copy.pending){clearSensitive();setOpaque(copy.pending.body.client_command_id);setState('unknown');setNeedsRead(true);setMessage('当前完整原操作不可重放；原 UUID 保留，请明确只读核对。');return;}
    throw new DraftError('DRAFT_ACTION_REVOKED');
   }
   setValue(copy.value);setPending(copy.pending);setConfirmed(false);setChecked(false);setNeedsRead(true);
   if(copy.pending){setOpaque(copy.pending.body.client_command_id);setState('unknown');setMessage('已恢复原通知路、UUID、正文和版本；先只读核对，不会自动发送。');}
  },
  onOperation:id=>{if(settling.current)return;if(pending&&pending.body.client_command_id!==id)clearSensitive();setOpaque(id);setState(known.current?'committed':'unknown');setNeedsRead(true);setChecked(false);setMessage(known.current?'原操作已确认提交；本地清理仍须只读核对。':'原通知操作仍待核对；完整正文不可用，只能只读核对原操作。');},
  onSensitiveClear:()=>{if(!settling.current){clearSensitive();if(clearRequested.current){clearRequested.current=false;setState('idle');setMessage('当前输入和此用途的恢复副本已清除。');}}}
 });
 const originalId=draft.operationId??opaque??pending?.body.client_command_id,busy=['preparing','submitting','reading','checking'].includes(state),hasInput=Boolean(value.deliveryId||value.action||value.reason||value.version),blocked=busy||Boolean(originalId)||hasInput||draft.restoring;
 useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();request.current=null;
  const active=client.getQueryData<Principal>(['session']),action=latestAction.current;
  // A trusted current bootstrap may remove this role while the parent hides
  // the section. This is a negative fence, never a permission grant.
  if(active?.principal_id===principal.principal_id&&(!active.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')||action==='RECONCILE'&&!active.roles.includes('ADMIN')))void purgeDrafts({principal:principal.principal_id,kind:'incident',id:incidentId,purpose:purpose==='INCIDENT_LIFECYCLE'?'incident-delivery-lifecycle':'incident-delivery-public-progress',reason:'revoked'}).catch(()=>{});
 },[]);
 useEffect(()=>{
  generation.current++;request.current?.abort();request.current=null;setConfirmed(false);setChecked(false);setNeedsRead(true);
  if((pending?.action??value.action)==='RECONCILE'&&!principal.roles.includes('ADMIN')||(pending?.action??value.action)==='RETRY'&&!principal.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')){revoke(new ApiError(403,'AUTHORIZATION_REJECTED'));return;}
  if(originalId){if(!principal.incident_delivery_control_enabled){setPending(null);setOpaque(originalId);}setState(known.current?'committed':'unknown');setMessage('当前身份、授权或开关已更新；原 UUID 和已知结果保留，只读核对后才能继续。');}
  const token=generation.current,startIdentity=currentIdentity.current;
  void client.cancelQueries({queryKey:queryPrefix},{revert:false}).then(()=>{
   if(value.deliveryId&&readReady&&!revoked&&token===generation.current&&currentIdentity.current===startIdentity)void capability.refetch();
  });
 },[identity(principal)]);
 useEffect(()=>{if(unavailable(capability.error))revoke(capability.error);},[capability.error]);
 useEffect(()=>{
  // This is the first explicit selection's capture. A later GET, SSE, restore,
  // or replay never replaces an already captured attempt.
  if(!value.deliveryId||value.attemptCount!==null||originalId||busy||revoked||capability.isFetching||capability.isError||!capability.data)return;
  const count=capability.data.attempt_count;setValue(input=>input.deliveryId===capability.data?.delivery_id&&input.attemptCount===null?{...input,attemptCount:count}:input);
 },[capability.data,capability.isFetching,capability.isError,value.deliveryId,value.attemptCount,originalId,busy,revoked]);
 useEffect(()=>{
  if(busy||revoked||capability.isFetching||!capability.data||!value.deliveryId)return;
  if(!capability.data.receipt_read){revoke(new ApiError(403,'AUTHORIZATION_REJECTED'));return;}
  if(!pending)return;
  const permitted=pending.action==='RETRY'?capability.data.retry_authorized:capability.data.reconcile_authorized;
  if(!permitted){setOpaque(pending.body.client_command_id);clearSensitive();setState(known.current?'committed':'unknown');setChecked(false);setNeedsRead(true);setMessage('当前完整原操作不可重放；原 UUID 和已知结果保留，仅明确只读核对。');void draft.discard();}
 },[capability.data,capability.isFetching,busy,revoked,value.deliveryId]);

 useEffect(()=>{
  if(!pending)return;
  const timer=setTimeout(()=>{generation.current++;request.current?.abort();request.current=null;setOpaque(pending.body.client_command_id);clearSensitive();setState(known.current?'committed':'unknown');setMessage('原操作正文已过期；原 UUID 和已知结果保留，只能只读核对。');},draft.ttl);
  return()=>clearTimeout(timer);
 },[pending?.body.client_command_id]);
 useEffect(()=>{
  if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[blocked]);
 useEffect(()=>{
  if(!principal.incident_delivery_control_enabled&&!originalId&&!draft.existing)return;
  try{return subscribeDrafts(event=>{
   if(event.principal!==principal.principal_id||client.getQueryData<Principal>(['session'])?.principal_id!==principal.principal_id)return;
   if(event.reason==='logout'||event.reason==='logout-unknown'){generation.current++;request.current?.abort();clearSensitive();setOpaque(null);setResult(null);clearSessionView(client,undefined,'会话已退出，请重新核验。');}
   else if(event.reason==='revoked'&&matchesDraft(event,draft.scope))revoke(new DraftError('DRAFT_ACTION_REVOKED'),false);
  });}catch(error){if(!(error instanceof DraftError&&error.message==='DRAFT_STORAGE_UNAVAILABLE'))throw error;}
 },[principal.principal_id,incidentId,purpose,principal.incident_delivery_control_enabled,originalId,draft.existing]);
 function startRequest(next:State){
  const controller=new AbortController(),token=++generation.current,startIdentity=currentIdentity.current,read=captureWorkbenchRead(controller.signal);request.current=controller;setState(next);
  const current=()=>{read();const active=client.getQueryData<Principal>(['session']);if(request.current!==controller||generation.current!==token||currentIdentity.current!==startIdentity||!active||identity(active)!==startIdentity)throw new DOMException('INCIDENT_DELIVERY_REPLACED','AbortError');};
  return {controller,current,startIdentity};
 }
 async function readCurrent(deliveryId:string|null,controller:AbortController,current:()=>void,startIdentity:string){
  const fresh=await incidentDeliveryApi.context(incidentId,purpose,deliveryId,controller.signal);current();requirePrincipal(fresh.principal,startIdentity);current();
  client.setQueryData(['incident-result',principal.principal_id,incidentId,'standalone'],fresh.incident);
  if(fresh.capability&&deliveryId===value.deliveryId)client.setQueryData([...queryPrefix,'capability',authority,principal.incident_delivery_control_enabled,deliveryId],fresh.capability);
  return fresh;
 }
 async function terminal(commandId:string,receiptResult:IncidentDeliveryControlResult|null,controller:AbortController,current:()=>void,startIdentity:string){
  if(receiptResult){known.current=true;setResult(receiptResult);}
  // A successful POST followed by a failed GET keeps the original intent. Only
  // a current read and an exact terminal receipt allow the local barrier to clear.
  try{
   await readCurrent(receiptResult?.delivery_id??value.deliveryId,controller,current,startIdentity);current();
   settling.current=true;let cleaned=false;
   try{cleaned=await draft.success(commandId,receiptResult===null);}finally{settling.current=false;}
   current();setPending(null);setChecked(false);setConfirmed(false);setOpaque(cleaned?null:commandId);
   if(!cleaned){setState(receiptResult?'committed':'failed');setMessage('原结果已核对并保持；恢复副本清理未确认，保留原 UUID，禁止新提交。');return;}
   if(receiptResult){setResult(receiptResult);clearSensitive();setState('committed');setNeedsRead(false);setMessage('本路操作已确认提交；当前权限和公共故障已重新读取，各路结果分别刷新。确认发送不代表报修人已读。');}
   else{setState('failed');setNeedsRead(true);setMessage('原操作已明确拒绝；输入保留，请重新读取并明确采用当前快照。');}
   onChanged();
  }catch(error){
   if(controller.signal.aborted||request.current!==controller)return;
   try{current();}catch{return;}
   if(unavailable(error)||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'){revoke(error);return;}
   setOpaque(commandId);setState(receiptResult?'committed':'failed');setChecked(false);setNeedsRead(true);setMessage(receiptResult?'原提交已确认，当前事实尚未读回；原 UUID、正文和版本保留，请只读核对。':'原拒绝已确认，当前事实尚未读回；原 UUID 保留，请只读核对。');
  }
 }
 async function send(operation:IncidentDeliveryOperation,replay=false){
  if(request.current)return;
  const {controller,current,startIdentity}=startRequest('preparing');let dispatched=false;
  setPending(operation);setOpaque(operation.body.client_command_id);setResult(null);
  try{
   const fresh=await readCurrent(operation.deliveryId,controller,current,startIdentity);current();
   if(!fresh.principal.incident_delivery_control_enabled||fresh.capability?.disabled)throw new ControlDisabled();
   if(!fresh.capability||(operation.action==='RETRY'?!fresh.capability.retry_authorized:!fresh.capability.reconcile_authorized))throw new ApiError(403,'AUTHORIZATION_REJECTED');
   if(!replay&&(operation.action==='RETRY'?!fresh.capability.retry:!fresh.capability.reconcile))throw new ApiError(409,'P2_012_VERSION_CONFLICT');
   if(!replay&&(fresh.incident.row_version!==operation.body.expected_row_version||fresh.capability.attempt_count!==operation.body.expected_delivery_attempt_count))throw new ApiError(409,'P2_012_VERSION_CONFLICT');
   if(!workbenchTransportWritable()||!navigator.onLine||!fresh.principal.csrf_token)throw new ApiError(503,'WORKBENCH_OFFLINE');
   if(!replay)await draft.prepare(operation);current();dispatched=true;setState('submitting');setMessage(replay?'正在明确重放同一原通知操作…':'正在提交本路明确通知操作…');
   const acknowledged=await incidentDeliveryApi.perform(operation,fresh.principal.csrf_token,controller.signal);current();
   await terminal(operation.body.client_command_id,acknowledged,controller,current,startIdentity);
  }catch(error){
   if(controller.signal.aborted||request.current!==controller)return;
   try{current();}catch{return;}
   if(unavailable(error)||error instanceof DraftError&&['DRAFT_IDENTITY_CHANGED','DRAFT_ACTION_REVOKED'].includes(error.message)){revoke(error);return;}
   if(error instanceof ControlDisabled){if(replay||dispatched){setOpaque(operation.body.client_command_id);clearSensitive();setState('unknown');setMessage('通知控制当前关闭；原操作保留，仅可只读核对，不会新提交。');}else{setPending(null);setOpaque(null);setState('failed');setNeedsRead(true);setMessage('通知控制当前关闭，本次尚未发送。');}return;}
   if(error instanceof IncidentDeliveryCommandRefusal){await terminal(operation.body.client_command_id,null,controller,current,startIdentity);return;}
   if(!dispatched&&!replay){settling.current=true;let cleaned=false;try{cleaned=await draft.success(operation.body.client_command_id,true);}finally{settling.current=false;}try{current();}catch{return;}setPending(null);setOpaque(cleaned?null:operation.body.client_command_id);setState(cleaned?'failed':'unknown');setNeedsRead(true);setMessage(cleaned?'本次尚未发送：'+errorMessage(error)+'。输入保留，请重新核对。':'本次未发送，恢复清理未确认；原 UUID 保留，先只读核对。');}
   else{setState(known.current?'committed':'unknown');setChecked(false);setMessage(known.current?'原提交已收到确认，后续读取尚未完成；保留原 UUID、正文和版本，请只读核对。':'通知操作结果未知；保留原 UUID、正文和版本，先只读核对，不能创建新操作。');}
  }finally{if(request.current===controller)request.current=null;}
 }
 async function checkOriginal(){
  if(!originalId||request.current||draft.probing||draft.restoring)return;
  const id=originalId,original=pending,{controller,current,startIdentity}=startRequest('checking');setMessage('正在只读核对原通知操作…');
  try{
   await readCurrent(original?.deliveryId??value.deliveryId,controller,current,startIdentity);current();
   const receipt=await incidentDeliveryApi.receipt(incidentId,id,controller.signal);current();
   if(receipt.state==='UNKNOWN'){setChecked(!known.current);setState(known.current?'committed':'unknown');setMessage(known.current?'原提交已知确认；本次未读到终态，不改写已有 ACK，没有发送新操作。':'原操作尚无可确认终态；未知不代表未应用，没有发送新操作。');return;}
   if(known.current&&receipt.state==='FAILED')throw new Error('ORIGINAL_INCIDENT_DELIVERY_RECEIPT_CONFLICT');
   if(receipt.state==='COMMITTED'&&original&&!matchesIncidentDeliveryResult(original,receipt.result))throw new Error('ORIGINAL_INCIDENT_DELIVERY_RESULT_UNCONFIRMED');
   await terminal(id,receipt.state==='COMMITTED'?receipt.result:null,controller,current,startIdentity);
  }catch(error){if(controller.signal.aborted||request.current!==controller)return;try{current();}catch{return;}if(unavailable(error)||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')revoke(error);else{setState(known.current?'committed':'unknown');setMessage('本次只读核对未完成，原 UUID 和已知结果保留，没有发送新操作。');}}
  finally{if(request.current===controller)request.current=null;}
 }
 async function refreshCurrent(){
  if(request.current)return;const {controller,current,startIdentity}=startRequest('reading');
  try{await readCurrent(value.deliveryId,controller,current,startIdentity);current();setNeedsRead(false);setState(originalId?(known.current?'committed':'unknown'):'idle');setMessage(originalId?'当前事实已重新读取；原操作仍须只读核对。':'当前事实已读取，捕获输入保持；请明确采用当前快照。');onChanged();}
  catch(error){if(controller.signal.aborted||request.current!==controller)return;try{current();}catch{return;}if(unavailable(error)||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')revoke(error);else{setState(originalId?(known.current?'committed':'unknown'):'failed');setNeedsRead(true);setMessage(errorMessage(error));}}
  finally{if(request.current===controller)request.current=null;}
 }
 function operation():IncidentDeliveryOperation{
  if(!value.deliveryId||!value.version||!value.action||value.attemptCount===null)throw new ApiError(400,'INVALID_INPUT');
  const body={client_command_id:crypto.randomUUID(),expected_row_version:value.version,expected_status:value.status,expected_side_effect_state:value.effect,expected_delivery_attempt_count:value.attemptCount,reason_code:value.reason,...(value.action==='RECONCILE'?{resolution:value.resolution}:{})};
  return decodeIncidentDeliveryOperation({incidentId,deliveryId:value.deliveryId,purpose,action:value.action,body},{incidentId,purpose});
 }
 const actionAllowed=value.action==='RETRY'?capability.data?.retry===true:value.action==='RECONCILE'?capability.data?.reconcile===true:false;
 const statusAllowed=value.action==='RETRY'?(value.status==='PENDING'||value.status==='DEAD_LETTER')&&value.effect==='NOT_ATTEMPTED':value.action==='RECONCILE'?value.status==='RECONCILIATION_REQUIRED'&&value.effect==='UNKNOWN':false;
 const snapshotMatches=Boolean(selected&&selected.status===value.status&&selected.effect===value.effect&&selected.attemptCount===value.attemptCount&&capability.data?.attempt_count===value.attemptCount&&detail.row_version===value.version);
 const locked=otherBlocked||busy||Boolean(originalId)||draft.probing||draft.restoring||revoked||!readReady||!principal.incident_delivery_control_enabled||state==='committed';
 const canSubmit=!locked&&!needsRead&&!capability.isFetching&&!capability.isError&&snapshotMatches&&actionAllowed&&statusAllowed&&Boolean(value.reason)&&confirmed&&(value.action!=='RECONCILE'||Boolean(value.resolution))&&draft.canSubmit&&workbenchTransportWritable()&&navigator.onLine&&Boolean(principal.csrf_token);
 const originalAuthorized=pending?.action==='RETRY'?capability.data?.retry_authorized===true:pending?.action==='RECONCILE'?capability.data?.reconcile_authorized===true:false;
 const canReplay=Boolean(pending&&checked&&confirmed&&principal.incident_delivery_control_enabled&&!capability.data?.disabled&&originalAuthorized&&!otherBlocked&&!busy&&!revoked&&readReady&&!draft.probing&&!draft.restoring&&!capability.isFetching&&!capability.isError&&draft.status!=='failed'&&workbenchTransportWritable()&&navigator.onLine);
 if(!principal.incident_delivery_control_enabled&&!originalId&&!draft.existing&&!pending)return null;
 return <section className="candidate-decision" aria-label={purpose==='INCIDENT_LIFECYCLE'?'生命周期通知控制':'公开进展通知控制'} data-incident-delivery-controls data-control-purpose={purpose}>
  <h3>{purpose==='INCIDENT_LIFECYCLE'?'生命周期通知控制':'公开进展通知控制'}</h3><p>只操作选定通知路。结果未知须先核对；确认已发不再发送，核实未发才重新排队。发送结果不代表报修人已读。</p>
  {principal.incident_delivery_control_enabled&&!revoked?<form onSubmit={event=>{event.preventDefault();if(canSubmit)void send(operation());}}><div className="candidate-form-grid">
   <label>选择通知路<select aria-label="选择通知路" value={value.deliveryId??''} disabled={locked} onChange={event=>{const route=routes.find(item=>item.deliveryId===event.target.value);setValue(route?{...EMPTY_INCIDENT_DELIVERY_DRAFT,deliveryId:route.deliveryId,version:detail.row_version,status:route.status,effect:route.effect,attemptCount:null}:EMPTY_INCIDENT_DELIVERY_DRAFT);setConfirmed(false);setNeedsRead(false);setResult(null);setState('idle');}}><option value="">请选择本次控制的通知路</option>{value.deliveryId&&!selected?<option value={value.deliveryId}>原通知路（当前分页窗口外，提交时核验）</option>:null}{routes.map(route=><option key={route.deliveryId} value={route.deliveryId}>{route.label} · {route.deliveryId.slice(-8)} · {statusLabels[route.status]}</option>)}</select></label>
   <label>投递控制操作<select aria-label="投递控制操作" value={value.action} disabled={locked||!value.deliveryId||capability.isFetching||capability.isError} onChange={event=>{const action=event.target.value;setValue(input=>({...input,action:action==='RETRY'||action==='RECONCILE'?action:'',reason:'',resolution:''}));setConfirmed(false);}}><option value="">请选择明确操作</option><option value="RETRY" disabled={!capability.data?.retry}>重试确定未发送的通知</option><option value="RECONCILE" disabled={!capability.data?.reconcile}>核对未知发送结果</option></select></label>
   <label>投递操作原因<select aria-label="投递操作原因" value={value.reason} disabled={locked||!value.action} onChange={event=>{setValue(input=>({...input,reason:event.target.value}));setConfirmed(false);}}><option value="">请选择已实际完成的核对原因</option>{Object.entries(reasonLabels).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
   {value.action==='RECONCILE'?<label>未知发送核对结论<select aria-label="未知发送核对结论" value={value.resolution} disabled={locked} onChange={event=>{const resolution=resolutions.find(item=>item===event.target.value)??'';setValue(input=>({...input,resolution}));setConfirmed(false);}}><option value="">请选择已核实的结论</option>{resolutions.map(resolution=><option key={resolution} value={resolution}>{resolutionLabels[resolution]}</option>)}</select></label>:null}
  </div>{value.version?<p>捕获公共故障版本 {value.version}；当前版本 {detail.row_version}。原路快照：{value.status?statusLabels[value.status]:''} / {value.effect}；捕获尝试 {value.attemptCount}，当前路尝试 {selected?.attemptCount??'窗口外'}。{!snapshotMatches?'当前事实已变化或原路不在当前窗口，须重新读取并明确采用当前快照。':''}</p>:null}
  <label><input type="checkbox" aria-label="确认本路投递操作" checked={confirmed} disabled={otherBlocked||busy||revoked||!value.action||Boolean(originalId)&&!pending} onChange={event=>setConfirmed(event.target.checked)}/>已核对选定通知路、原因和结论，明确执行此操作</label>
  <div className="note-controls"><button type="submit" data-action="submit-incident-delivery-control" disabled={!canSubmit}>明确提交本路通知操作</button>{hasInput&&!originalId&&!busy&&state!=='committed'?<><button type="button" data-action="adopt-incident-delivery-snapshot" disabled={!selected||!readReady||revoked||capability.isFetching||capability.isError||!capability.data} onClick={()=>{if(!selected)return;setValue(input=>({...input,version:detail.row_version,status:selected.status,effect:selected.effect,attemptCount:capability.data?.attempt_count??null}));setConfirmed(false);setNeedsRead(false);setState('idle');}}>明确采用当前路快照</button><button type="button" data-action="clear-incident-delivery-input" disabled={draft.probing||draft.restoring||draft.enabled&&(draft.status==='loading'||draft.status==='failed')} onClick={()=>{if(draft.enabled){clearRequested.current=true;void draft.discard();}else{clearSensitive();setMessage('已清除尚未提交的本路输入；此页没有保存恢复副本。');setState('idle');}}}>清除当前输入</button></>:null}</div></form>:null}
  {capability.isError&&!revoked?<p role="alert">{errorMessage(capability.error)}；无法读取能力不代表有操作权。</p>:null}
  {draft.enabled?<p data-incident-delivery-draft-status={draft.status} role="status">{draft.message}</p>:null}
  {message?<p data-incident-delivery-outcome data-incident-delivery-state={state} role={state==='unknown'||state==='failed'||state==='denied'?'alert':'status'}>{message}</p>:null}
  {result&&!revoked?<p data-incident-delivery-receipt>原操作安全回执：{statusLabels[result.status]} / {result.side_effect_state} · 尝试 {result.attempt_count} 次。各路当前结果按重新读取的列表显示。</p>:null}
  {originalId&&!revoked?<div className="note-controls"><p>原通知操作 UUID：{originalId}；原版本：{pending?.body.expected_row_version??'正文不可用'}。</p><button type="button" data-action="check-incident-delivery-operation" disabled={busy||draft.probing||draft.restoring} onClick={()=>{void checkOriginal();}}>只读核对原通知操作</button>{pending&&checked?<button type="button" data-action="replay-incident-delivery-operation" disabled={!canReplay} onClick={()=>{if(pending&&canReplay)void send(pending,true);}}>明确重放同一原通知操作</button>:null}</div>:null}
  {needsRead&&!revoked?<button type="button" data-action="refresh-incident-delivery-current" disabled={busy} onClick={()=>{void refreshCurrent();}}>只读刷新当前事实</button>:null}
  {state==='committed'&&!originalId&&!revoked&&principal.incident_delivery_control_enabled?<button type="button" data-action="new-incident-delivery-intent" disabled={busy||otherBlocked||!readReady} onClick={()=>{known.current=false;setResult(null);clearSensitive();setState('idle');setNeedsRead(false);setMessage('请明确选择下一条通知路，不会自动操作其他路。');}}>开始下一条明确通知操作</button>:null}
 </section>;
}
