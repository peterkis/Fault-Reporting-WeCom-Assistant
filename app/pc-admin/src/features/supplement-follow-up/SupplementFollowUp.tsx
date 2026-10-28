import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Form as HForm,Label as HLabel,ListBox,TextArea as HTextArea} from "@heroui/react";
import {WorkbenchDisclosure} from "../../app/WorkbenchDisclosure";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization,clearSupplementAuthorization} from '../../app/authorization';
import {DraftError,subscribeDrafts} from '../drafts/encrypted-drafts';
import {sameSupplementTarget} from './client';
import type {SupplementFollowUpCommand,SupplementFollowUpTarget,SupplementFollowUpResult,SupplementFollowUpItem} from './client';
import {EMPTY_SUPPLEMENT_INPUT,useSupplementDraft} from './use-supplement-draft';
import type {SupplementDispositionInput} from './use-supplement-draft';
import {conversations} from '../conversations/client';
import type {ConversationWorkspaceEntry} from '../conversations/client';
import {ConversationComposer} from '../conversations/ConversationComposer';
import './supplement-follow-up.css';
type State='idle'|'submitting'|'checking'|'succeeded'|'failed'|'unknown'|'denied';
function isStaff(principal:Principal){return principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role));}
export function SupplementFollowUpSummary({pending}:{pending:boolean|undefined}){
 return pending===true?<p className="supplement-pending-summary" data-supplement-follow-up-pending="true"><strong>补充待跟进</strong></p>:null;
}
export function SupplementFollowUp({ticketId,principal,readReady,onBlockedChange}:{ticketId:string;principal:Principal;readReady:boolean;onBlockedChange:(blocked:boolean)=>void}){
 const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0),settling=useRef(false),original=useRef<string|null>(null),materialRead=useRef<AbortController|null>(null);
 const [value,setValue]=useState<SupplementDispositionInput>(EMPTY_SUPPLEMENT_INPUT),[pending,setPending]=useState<SupplementFollowUpCommand|null>(null),[operationId,setOperationId]=useState<string|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
 const [bound,setBound]=useState<{target:SupplementFollowUpTarget;entry:ConversationWorkspaceEntry}|null>(null),[replyBlocked,setReplyBlocked]=useState(false),[restoredMaterial,setRestoredMaterial]=useState<SupplementFollowUpItem|null>(null);
 const enabled=principal.supplement_follow_up_enabled===true;
 const sessions=useQuery({queryKey:['supplement-reply-sessions',principal.principal_id,ticketId,principal.authorization_revision,principal.expires_epoch_ms],enabled:enabled&&readReady&&principal.conversation_workspace_enabled,queryFn:({signal})=>conversations.links('ticket',ticketId,signal)});
 const replySessions=sessions.data?.items.filter(entry=>entry.capabilities.includes('REPLY')&&entry.session.status!=='ENDED')??[];
 const page=useInfiniteQuery({queryKey:['ticket-supplement-follow-up',principal.principal_id,ticketId,principal.authorization_revision,principal.expires_epoch_ms],enabled:enabled&&readReady,initialPageParam:null as string|null,
  queryFn:({pageParam,signal})=>api.supplementFollowUpPage(ticketId,pageParam,signal),getNextPageParam:current=>current.next_cursor??undefined});
 const rows=page.data?.pages.flatMap(current=>current.items)??[],unique=[...new Map([...(restoredMaterial?[restoredMaterial]:[]),...rows].map(item=>[JSON.stringify([item.source_ref,item.revision]),item])).values()];
 const currentRead=readReady&&page.isSuccess&&!page.isFetching&&!page.isError,staff=isStaff(principal),stage=useRef<'session'|'purpose'>('purpose');
 const resetInput=()=>{setValue(EMPTY_SUPPLEMENT_INPUT);setPending(null);};
 const sensitiveClear=()=>{resetInput();if(!settling.current){generation.current++;request.current?.abort();materialRead.current?.abort();request.current=null;}};
 async function authorityFailure(error:unknown,commandId?:string|null){
  const id=commandId===undefined?original.current:commandId;
  if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session')){
   await clearSessionAuthorization(client,principal.principal_id,error instanceof ApiError?error.status as 401|403:undefined,'revoked');sensitiveClear();return;
  }
  if(error instanceof ApiError&&[403,404].includes(error.status)){
   await clearSupplementAuthorization(client,principal.principal_id,ticketId,error);setRestoredMaterial(null);sensitiveClear();setOperationId(id);setState(id?'unknown':'denied');setMessage(id?'补充材料或处置权限已失效，敏感输入已清理；原操作只能只读核对。':'补充材料或处置权限已失效，敏感输入已清理。');
  }
 }
 async function authorize(signal:AbortSignal,copy?:{value:SupplementDispositionInput;pending:SupplementFollowUpCommand|null}){
  stage.current='session';const fresh=await api.bootstrap(signal);if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);
  stage.current='purpose';const target=copy?.pending??copy?.value.target??value.target;if(target)await api.supplementFollowUpMaterial(ticketId,target,signal);else await api.supplementFollowUpPage(ticketId,null,signal);
  return fresh.supplement_follow_up_enabled===true&&fresh.supplement_follow_up_draft_recovery_enabled===true&&isStaff(fresh);
 }
 const draft=useSupplementDraft({ticketId,principal,readReady:currentRead,value,pending,authorize,onAuthorityFailure:error=>{void authorityFailure(error);},onSensitiveClear:sensitiveClear,
  onOperation:id=>{setOperationId(id);if(!settling.current){setState('unknown');setMessage('原补充处置结果尚未确认，请核对上次操作。');}},
  onRestore:async(copy,signal)=>{
   stage.current='purpose';const target=copy.pending??copy.value.target;
   if(!target){resetInput();return;}
   const current=await api.supplementFollowUpMaterial(ticketId,target,signal);signal.throwIfAborted();
   setRestoredMaterial(current.item);setValue(copy.value);setPending(copy.pending);setOperationId(copy.pending?.client_command_id??null);setState(copy.pending?'unknown':'idle');setMessage(copy.pending?'原补充处置结果尚未确认，原操作、正文和修订保持不变。':'已恢复原补充修订的内部处置输入。');
  }
 });
 const originalId=pending?.client_command_id??operationId??draft.operationId,busy=state==='submitting'||state==='checking',locked=busy||Boolean(originalId),hasInput=Boolean(value.note);
 original.current=originalId;
 const blocked=((locked||hasInput)&&!draft.safeToLeave)||replyBlocked;
 useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
 useEffect(()=>()=>{generation.current++;request.current?.abort();materialRead.current?.abort();},[]);
 useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
 useEffect(()=>{
  if(!enabled||!principal.logout_enabled&&!principal.supplement_follow_up_draft_recovery_enabled)return;
  try{return subscribeDrafts(event=>{
   if(event.principal!==principal.principal_id||event.kind!==undefined&&event.kind!=='ticket'||event.id!==undefined&&event.id!==ticketId||event.purpose!==undefined&&event.purpose!=='supplement-disposition')return;
   if(['logout','logout-unknown','revoked'].includes(event.reason))sensitiveClear();
  });}catch{return;}
 },[enabled,principal.principal_id,principal.logout_enabled,principal.supplement_follow_up_draft_recovery_enabled,ticketId]);
 useEffect(()=>{if(page.error instanceof ApiError&&[401,403,404].includes(page.error.status)){stage.current='purpose';void authorityFailure(page.error);}},[page.error]);
 useEffect(()=>{if(!staff&&(value.note||pending)){stage.current='purpose';void authorityFailure(new ApiError(403,'P2_016_FORBIDDEN'));}},[staff]);
 const refresh=async()=>{
  // An exact restore fact remains independent of the currently loaded cursor page.
  materialRead.current?.abort();const controller=new AbortController(),token=generation.current;materialRead.current=controller;
  const current=()=>!controller.signal.aborted&&generation.current===token;
  try{
   await page.refetch();if(!current())return;const target=pending??value.target??restoredMaterial;
   if(target){const exact=await api.supplementFollowUpMaterial(ticketId,target,controller.signal);if(!current())return;setRestoredMaterial(exact.item);}
   void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});
  }catch(error){if(!current())return;if(error instanceof ApiError&&[401,403,404].includes(error.status)){stage.current='purpose';await authorityFailure(error);}else setMessage('当前补充重新读取失败，原命令结果未变化。');}
  finally{if(materialRead.current===controller)materialRead.current=null;controller.abort();}
 };
 async function submit(target:SupplementFollowUpTarget){
  if(request.current||locked||!currentRead||!staff||!value.target||!sameSupplementTarget(target,value.target)||!value.note.trim()||Array.from(value.note).length>2000)return;
  const command:SupplementFollowUpCommand=Object.freeze({client_command_id:crypto.randomUUID(),action:'RECORD_DISPOSITION',source_ref:target.source_ref,revision:target.revision,disposition_note:value.note,mark_followed_up:true});
  const controller=new AbortController(),token=++generation.current;request.current=controller;original.current=command.client_command_id;setPending(command);setOperationId(command.client_command_id);setState('submitting');setMessage('正在记录本条补充的内部处置并标记已跟进…');
  const current=()=>generation.current===token&&!controller.signal.aborted;
  try{
   try{await draft.prepare(command);}catch{if(current()){setPending(null);setOperationId(null);setState('failed');setMessage('恢复副本未保存，本次尚未发送；原输入已保留。');}return;}
   if(!current())return;stage.current='purpose';
   let result:SupplementFollowUpResult;
   try{result=await api.recordSupplementDisposition(ticketId,command,principal.csrf_token,controller.signal);}
   catch(error){
    if(!current())return;
    if(error instanceof ApiError&&[401,403,404].includes(error.status)){
     // A closed rejection of this POST differs from a failed read of an older unknown operation.
     let cleaned=true;try{await draft.knownFailure(command.client_command_id);}catch{cleaned=false;}
     if(current())await authorityFailure(error,cleaned?null:command.client_command_id);return;
    }
    if(error instanceof ApiError){
     let cleaned=true;try{await draft.knownFailure(command.client_command_id);}catch{cleaned=false;}
     if(!current())return;setPending(cleaned?null:command);setOperationId(cleaned?null:command.client_command_id);setState('failed');setMessage('处置未成功：'+errorMessage(error)+' 内部输入和原修订已保留。'+(cleaned?'':' 恢复副本清理失败，请核对上次操作。'));return;
    }
    setState('unknown');setMessage('处置结果未知；原操作、正文和修订保持不变，请核对上次操作。');return;
   }
   if(!current())return;
   settling.current=true;let cleaned:boolean;try{cleaned=await draft.success(command.client_command_id);}catch{cleaned=false;}finally{settling.current=false;}
   if(!current())return;resetInput();setOperationId(cleaned?null:command.client_command_id);setState('succeeded');setMessage((result.replayed?'已核对原处置结果。':'本条补充已记录处置并跟进。')+(cleaned?'':' 恢复副本清理失败，须只读核对并重试清理。'));
   try{await refresh();}catch{if(current())setMessage('本条补充处置已确认；当前材料重新读取失败，请重新读取。');}
  }finally{if(request.current===controller)request.current=null;}
 }
 async function checkReceipt(){
  if(request.current||!originalId)return;const commandId=originalId,controller=new AbortController(),token=++generation.current;request.current=controller;setState('checking');setMessage('正在只读核对原补充处置…');
  const current=()=>generation.current===token&&!controller.signal.aborted;
  try{
   stage.current='purpose';const receipt=await api.supplementFollowUpReceipt(ticketId,commandId,controller.signal);if(!current())return;
   if(receipt.state==='UNKNOWN'){setState('unknown');setMessage('原操作仍未知；未找到终态收据不代表未提交。');return;}
   if(receipt.state==='COMMITTED'&&pending&&!sameSupplementTarget(receipt.result,pending)){setState('unknown');setMessage('收据目标与原操作不一致，原操作保持锁定。');return;}
   settling.current=true;let cleaned:boolean;try{cleaned=await draft.success(commandId,receipt.state==='FAILED');}catch{cleaned=false;}finally{settling.current=false;}
   if(!current())return;if(receipt.state==='COMMITTED')resetInput();else setPending(null);
   setOperationId(cleaned?null:commandId);setState(receipt.state==='COMMITTED'?'succeeded':'failed');setMessage((receipt.state==='COMMITTED'?'已核对本条补充处置成功。':'原操作已确认失败；内部输入保留，请重新读取当前材料。')+(cleaned?'':' 恢复副本清理失败，须继续只读核对。'));
   try{await refresh();}catch{if(current())setMessage('原操作终态已确认；当前材料读取失败，请重新读取。');}
  }catch(error){if(!current())return;if(error instanceof ApiError&&[401,403,404].includes(error.status)){await authorityFailure(error,commandId);return;}setState('unknown');setMessage('只读核对失败，原操作仍未知；尚未发送新的操作。');}
  finally{if(request.current===controller)request.current=null;}
 }
 if(!enabled)return null;
 if(currentRead&&!unique.length&&!pending&&!operationId&&!value.target&&!bound&&!replyBlocked&&state==='idle')return null;
 const canEdit=currentRead&&staff&&!locked&&!draft.probing&&!draft.restoring&&(!draft.rawEnabled||draft.canSubmit);
 return <section className="ticket-notes supplement-follow-up" aria-label="补充材料跟进" data-supplement-follow-up-state={state}>
  <WorkbenchDisclosure title={<>补充跟进</>} forceOpen={Boolean(!currentRead||unique.some(item=>item.follow_up_state==='PENDING')||pending||operationId||value.target||bound||locked)||undefined}><p>请核对补充内容，再记录处理情况。提交后将标记为已跟进。</p>{page.isPending?<p role="status">正在读取当前可访问的补充材料…</p>:page.isError?<p role="alert">{errorMessage(page.error)}</p>:null}<SupplementFollowUpSummary pending={page.data?.pages[0]?.has_pending_supplements}/><ol className="supplement-follow-up-list">{unique.map(item=>{
   const selected=value.target!==null&&sameSupplementTarget(value.target,item),fieldId='supplement-note-'+item.source_ref.replace(':','-')+'-'+item.revision;
   const note=selected?value.note:'',editable=canEdit&&(!hasInput||selected),canSubmit=editable&&selected&&Boolean(note.trim())&&Array.from(note).length<=2000;
   return <li key={JSON.stringify([item.source_ref,item.revision])} data-supplement-source-ref={item.source_ref} data-supplement-revision={item.revision} data-follow-up-state={item.follow_up_state}>
    <header><strong>{item.source_kind==='WEB'?'网页补充':'企业微信补充'}</strong><span>{item.follow_up_state==='PENDING'?'待跟进':'已跟进'}</span></header>
    {item.resolution?<p>跟进依据：{item.resolution.basis==='RECORDED_DISPOSITION'?'明确记录处置':'回复成功已核验'} · {item.resolution.occurred_at}（北京时间）</p>:<HForm onSubmit={event=>{event.preventDefault();if(canSubmit)void submit(item);}}><HLabel htmlFor={fieldId}>处理情况（内部）</HLabel><p id={fieldId+'-audience'}>仅信息科可见；提交后明确标记本条补充已跟进。</p><HTextArea id={fieldId} name="disposition_note" aria-describedby={fieldId+'-audience'} disabled={!editable} value={note} onChange={event=>{setValue({target:{source_ref:item.source_ref,revision:item.revision},note:event.target.value});if(!locked){setState('idle');setMessage('');}}}/><HButton type="submit" data-action="record-supplement-disposition" isDisabled={!canSubmit} variant="secondary">保存并标记已跟进</HButton>{replySessions.length&&!bound&&!locked?<HButton type="button" data-action="reply-supplement" onClick={()=>{const entry=replySessions[0];if(entry)setBound({target:{source_ref:item.source_ref,revision:item.revision},entry});}} variant="secondary">通过已有会话回复本条补充</HButton>:null}</HForm>}
   </li>;
  })}</ol>{page.isSuccess&&!unique.length?<p>当前授权范围内没有补充材料。</p>:null}{page.hasNextPage?<HButton type="button" isDisabled={page.isFetchingNextPage||busy} onClick={()=>{void page.fetchNextPage();}} variant="secondary">加载更多补充</HButton>:null}{bound?<section data-supplement-bound-reply="" aria-label="精确补充回复">
   <p>请单独填写回复。内部处理情况不会自动填入回复。回复送达后，才会标记本条补充已跟进。</p>
   {replySessions.length>1?<WorkbenchSelect label={<>已有获权会话</>} value={bound.entry.session.session_id} isDisabled={replyBlocked} onChange={event=>{const entry=replySessions.find(row=>row.session.session_id===event);if(entry)setBound({...bound,entry});}}>{replySessions.map(entry=><ListBox.Item key={entry.session.session_id} id={entry.session.session_id} textValue={String(entry.topic)+"·"+String(entry.channel_label)}>{entry.topic}· {entry.channel_label}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>:null}
   <ConversationComposer key={JSON.stringify([bound.target,bound.entry.session.session_id])} entry={bound.entry} principal={principal} purpose="messages" followUpTarget={{ticket_id:ticketId,...bound.target}} onBlockedChange={setReplyBlocked} onCommitted={()=>{void refresh();}}/>
   <HButton type="button" isDisabled={replyBlocked} onClick={()=>setBound(null)} variant="secondary">关闭补充回复</HButton>
  </section>:null}<div className="note-controls">
   {originalId?<HButton type="button" data-action="check-supplement-receipt" isDisabled={busy} onClick={()=>{void checkReceipt();}} variant="secondary">只读核对原处置</HButton>:null}
   <HButton type="button" data-action="refresh-supplement-follow-up" isDisabled={busy} onClick={()=>{void refresh();}} variant="secondary">重新读取补充</HButton>
   {hasInput&&!locked?<HButton type="button" data-action="discard-supplement-input" onClick={()=>{if(draft.enabled)void draft.discard();else resetInput();}} variant="secondary">清空内部输入</HButton>:null}
  </div>{draft.rawEnabled?<DraftStatus role="status" data-supplement-draft-status>{draft.message}</DraftStatus>:<p>输入仅保留在当前页面；离开前请完成提交或清空输入。</p>}{state!=='idle'?<ToastFeedback revision={messageRevision} source="supplement-follow-up" state={state} role={['failed','unknown','denied'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}</WorkbenchDisclosure>
 </section>;
}
