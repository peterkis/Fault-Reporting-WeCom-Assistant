import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
import {Star} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {InfiniteData} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,WorkbenchCard,WorkbenchDetail} from '../../api/client';
import {clearItemAuthorization,clearItemView,clearSessionAuthorization,clearSessionView} from '../../app/authorization';
import {DRAFT_TTL_MS,DraftError,hasExistingDraft,matchesDraft,subscribeDrafts} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {decodeFollowCommand,matchesFollowResult} from '../../contracts/workbench-follow-browser-contracts.mjs';
import type {FollowItem,WorkbenchFollowCommand,WorkbenchFollowResult} from '../../contracts/workbench-follow-browser-contracts.mjs';

type State='idle'|'submitting'|'checking'|'reading'|'succeeded'|'conflict'|'unknown'|'denied';
// A rejection from bootstrap has session scope. A purpose or object rejection
// must not borrow this classification from a mutable restoration stage.
class FollowSessionRejected extends ApiError {}
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
export function ItemFollow({requested,item,principal,readReady,onBlockedChange}:{requested:FollowItem;item:WorkbenchCard;principal:Principal;readReady:boolean;onBlockedChange:(blocked:boolean)=>void}){
 const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0),settling=useRef(false);
 const identity=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.expires_epoch_ms,principal.roles,principal.workbench_follow_enabled,principal.workbench_follow_draft_recovery_enabled,requested.kind,requested.id]);
 const latestIdentity=useRef(identity);latestIdentity.current=identity;
 const [pending,setPending]=useState<WorkbenchFollowCommand|null>(null),[opaque,setOpaque]=useState<string|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[needsRead,setNeedsRead]=useState(false);
 const [existing,setExisting]=useState(false),[probing,setProbing]=useState(true);
 const scope={principal:principal.principal_id,kind:requested.kind,id:requested.id,purpose:'item-follow'},attention=item.attention;
 const rawEnabled=principal.workbench_follow_enabled===true&&principal.workbench_follow_draft_recovery_enabled===true&&attention!==undefined;
 const detailKey=['detail',principal.principal_id,requested.kind,requested.id] as const;
 const clear=()=>{generation.current++;request.current?.abort();request.current=null;setPending(null);setOpaque(null);setState('idle');setMessage('');};
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
 const commandId=draft.operationId??opaque??pending?.client_command_id,busy=state==='submitting'||state==='checking'||state==='reading';
 const blocked=busy||Boolean(commandId);
 useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{generation.current++;request.current?.abort();request.current=null;if(commandId){if(!principal.workbench_follow_enabled){setPending(null);setOpaque(commandId);}setState('unknown');setMessage('当前会话或能力已更新；原操作保留，请只读核对。');}},[identity]);
 useEffect(()=>{
  if(!pending)return;
  const timer=setTimeout(()=>{generation.current++;request.current?.abort();request.current=null;setPending(null);setOpaque(pending.client_command_id);setState('unknown');setMessage('原操作内容已过期；保留原操作标识，只能只读核对。');},DRAFT_TTL_MS);
  return()=>clearTimeout(timer);
 },[pending?.client_command_id]);
 useEffect(()=>{
  if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[blocked]);
 useEffect(()=>{
  if(!principal.workbench_follow_enabled&&!commandId&&!existing)return;
  try{return subscribeDrafts(event=>{
   if(event.principal!==principal.principal_id||client.getQueryData<Principal>(['session'])?.principal_id!==principal.principal_id)return;
   if(event.reason==='logout'||event.reason==='logout-unknown'){clear();clearSessionView(client,undefined,'会话已退出，请重新核验。');}
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
 async function terminal(id:string,result:WorkbenchFollowResult|null,controller:AbortController,current:()=>boolean){
  const cleaned=await settle(id);if(!current())return;setPending(null);setOpaque(cleaned?null:id);setNeedsRead(true);
  if(!cleaned){setState('unknown');setMessage('已核对原操作，恢复记录清理尚未确认；请继续只读核对。');return;}
  setState(result?'succeeded':'conflict');setMessage(result?'原操作已提交；正在读取当前关注状态…':'原操作已被拒绝；请读取当前资料后确认新的操作。');
  try{await readLatest(controller.signal,current);if(!current())return;setMessage(result?'已确认原操作，当前关注状态已重新读取。':'原操作已被拒绝，当前资料已重新读取。');}
  catch(error){if(!current())return;if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&[401,403,404].includes(error.status)){authorityFailure(error);return;}setMessage(result?'原操作已确认提交，当前状态暂未读回，请重新读取。':'原操作已被拒绝，当前状态暂未读回，请重新读取。');}
  if(current())refresh();
 }
 async function rejectedPurpose(error:ApiError,id:string,controller:AbortController,current:()=>boolean){
  if(error.status===401||error instanceof FollowSessionRejected){authorityFailure(error);return;}
  // A purpose OFF404 is not loss of the underlying object READ and never settles an UNKNOWN intent.
  try{await readLatest(controller.signal,current);}catch(readError){if(!current())return;if(readError instanceof DraftError&&readError.message==='DRAFT_IDENTITY_CHANGED'||readError instanceof ApiError&&[401,403,404].includes(readError.status)){authorityFailure(readError);return;}}
  if(!current())return;setOpaque(id);setState('unknown');setMessage('当前关注操作或核对不可用；原操作仍保留，不会发送新的操作。');
 }
 async function send(command:WorkbenchFollowCommand,replay=false){
  if(request.current||!principal.workbench_follow_enabled||!attention||!principal.csrf_token||!workbenchTransportWritable()||!draft.canSubmit&&!replay)return;
  if(replay&&(!pending||pending.client_command_id!==commandId||probing||draft.status==='loading'||draft.status==='failed'))return;
  const controller=new AbortController(),token=++generation.current,startIdentity=latestIdentity.current,current=currentRequest(controller,token,startIdentity,captureWorkbenchRead(controller.signal));request.current=controller;setPending(command);setOpaque(command.client_command_id);setState('submitting');setMessage(replay?'正在明确重放原关注操作…':'正在保存关注选择…');let dispatched=false,postRejection:ApiError|null=null;
  try{
   await verifySession(controller.signal,current);await draft.prepare(command);if(!current())return;dispatched=true;
   let result:WorkbenchFollowResult;
   try{result=await api.follow(requested,command,principal.csrf_token,controller.signal);}
   catch(error){if(error instanceof ApiError&&error.status>=400&&error.status<500)postRejection=error;throw error;}
   if(!current())return;await verifySession(controller.signal,current);
   await terminal(command.client_command_id,result,controller,current);
  }catch(error){
   if(!current())return;
   if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof FollowSessionRejected||error instanceof ApiError&&error.status===401)authorityFailure(error);
   else if(!dispatched){if(replay){setState('unknown');setMessage('原操作仍待核对；本次未再次发送。');}else{setPending(null);setOpaque(null);setState('denied');setMessage('恢复副本未能确认，关注操作尚未发送。');}}
   else if(error instanceof ApiError&&[401,403,404].includes(error.status))await rejectedPurpose(error,command.client_command_id,controller,current);
   else if(postRejection!==null&&error===postRejection)await terminal(command.client_command_id,null,controller,current);
   else{setState('unknown');setMessage('关注结果未知；请只读核对原操作，或明确重放同一原操作。');}
  }finally{if(generation.current===token)request.current=null;}
 }
 async function checkOriginal(){
  if(request.current||!commandId||probing||draft.status==='loading')return;
  const id=commandId,command=pending,controller=new AbortController(),token=++generation.current,current=currentRequest(controller,token,latestIdentity.current,captureWorkbenchRead(controller.signal));request.current=controller;setState('checking');setMessage('正在只读核对原关注操作…');
  try{
   await verifySession(controller.signal,current);const receipt=await api.followReceipt(requested,id,controller.signal);if(!current())return;await verifySession(controller.signal,current);
   if(receipt.state==='UNKNOWN'){setState('unknown');setMessage('原操作尚无可确认终态；请保留原操作，不会自动再次发送。');return;}
   if(receipt.state==='COMMITTED'&&command&&!matchesFollowResult(command,receipt.result,requested))throw Error('FOLLOW_ORIGINAL_RESULT_UNCONFIRMED');
   await terminal(id,receipt.state==='COMMITTED'?receipt.result:null,controller,current);
  }catch(error){if(!current())return;if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')authorityFailure(error);else if(error instanceof ApiError&&[401,403,404].includes(error.status))await rejectedPurpose(error,id,controller,current);else{setState('unknown');setMessage('只读核对暂未完成；原操作仍保留。');}}
  finally{if(generation.current===token)request.current=null;}
 }
 async function refreshCurrent(){
  if(request.current)return;const controller=new AbortController(),token=++generation.current,current=currentRequest(controller,token,latestIdentity.current,captureWorkbenchRead(controller.signal));request.current=controller;setState('reading');
  try{await readLatest(controller.signal,current);if(current()){setState(commandId?'unknown':'idle');setMessage(commandId?'当前资料已读取；原操作仍须只读核对。':'');refresh();}}
  catch(error){if(current()){if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&[401,403,404].includes(error.status))authorityFailure(error);else{setNeedsRead(true);setState(commandId?'unknown':'denied');setMessage(errorMessage(error));}}}
  finally{if(generation.current===token)request.current=null;}
 }
 if(!principal.workbench_follow_enabled&&!commandId&&!existing&&!pending)return null;
 const canStart=principal.workbench_follow_enabled&&attention!==undefined&&readReady&&!needsRead&&!blocked&&!probing&&draft.status!=='loading'&&draft.canSubmit&&Boolean(principal.csrf_token)&&workbenchTransportWritable();
 return <section className="compact-follow" aria-label="个人关注">
  {principal.workbench_follow_enabled&&attention?<div className="note-controls"><HButton type="button" data-action="toggle-item-follow" className="icon-button" aria-label={attention.following?'取消关注':'关注此事项'} title={attention.following?'取消关注此事项':'关注此事项，接收后续动态'} aria-pressed={attention.following} isDisabled={!canStart} onClick={()=>{if(!canStart||!attention)return;void send(decodeFollowCommand({client_command_id:crypto.randomUUID(),canonical_item:{kind:item.kind,id:item.id},expected_follow_version:attention.follow_version,following:!attention.following}));}} variant="secondary"><Star size={18} fill={attention.following?'currentColor':'none'}/></HButton><span className="follow-tooltip" role="tooltip">{attention.following?'已关注此事项':'关注此事项'}<small>接收后续动态；不改变处理或沟通责任。</small></span></div>:null}
  <div className={state==='succeeded'&&!commandId&&!needsRead?'sr-only':'follow-feedback'} hidden={!commandId&&!needsRead&&draft.status!=='failed'&&!message}>
  {commandId?<div className="note-controls"><HButton type="button" data-action="follow-ack" isDisabled={busy||probing||draft.status==='loading'} onClick={()=>{void checkOriginal();}} variant="secondary">只读核对原操作</HButton>{pending&&principal.workbench_follow_enabled&&attention?<HButton type="button" data-action="follow-replay" isDisabled={busy||probing||draft.status==='loading'||draft.status==='failed'||!readReady||!principal.csrf_token||!workbenchTransportWritable()} onClick={()=>{void send(pending,true);}} variant="secondary">明确重放原操作</HButton>:null}</div>:null}
  {needsRead||state==='conflict'||state==='denied'?<HButton type="button" data-action="follow-refresh" isDisabled={busy} onClick={()=>{void refreshCurrent();}} variant="secondary">重新读取当前状态</HButton>:null}
  {draft.enabled&&draft.status==='failed'?<DraftStatus role="status" data-follow-draft-status={draft.status}>{draft.message}</DraftStatus>:null}
  {message?<ToastFeedback revision={messageRevision} source="item-follow" state={state} className="ticket-note-state" data-follow-state={state} role={state==='unknown'||state==='conflict'||state==='denied'?'alert':'status'}>{message}</ToastFeedback>:null}
  </div>
 </section>;
}
