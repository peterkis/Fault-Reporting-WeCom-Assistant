// T09 consumer SOURCE after original55c true FORM_PRESENT RED. Runtime remains NOT_RUN.
// Uses the shared guarded client and purpose-specific encrypted-draft contract.
import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import type {P2016ReturnToDispatchCommand,P2016ReturnSession} from '../../../../../contracts/workbench_return_to_dispatch_contracts';
import {DraftError,hasExistingDraft,openDraft,removeSensitiveDraft,settleDraft} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

export interface ReturnInput {
  reason:string;unfinished:string;
  choice:'RETAIN_CURRENT'|'TRANSFER_SELECTED';
  target:string|null;
  sessions:readonly P2016ReturnSession[];
  version:number|null;
}
export interface ReturnCopy {value:ReturnInput;pending:P2016ReturnToDispatchCommand|null}
export interface ReturnFence {signal:AbortSignal;requireCurrent:()=>void}
export const EMPTY_RETURN:ReturnInput=Object.freeze({reason:'',unfinished:'',choice:'RETAIN_CURRENT',target:null,sessions:Object.freeze([]),version:null});
export const hasReturnInput=(value:ReturnInput)=>Boolean(value.reason||value.unfinished||value.choice==='TRANSFER_SELECTED'||value.target||value.sessions.length||value.version!==null);
export const serialiseReturn=(copy:ReturnCopy)=>JSON.stringify({schema:1,...copy});
export const returnInputSnapshot=(value:ReturnInput)=>JSON.stringify(value);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/u;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new DraftError('DRAFT_CORRUPT');}
function identity(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function bounded(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)throw new DraftError('DRAFT_CORRUPT');return value;}
function selected(value:unknown):readonly P2016ReturnSession[]{
  if(!Array.isArray(value)||value.length>8)throw new DraftError('DRAFT_CORRUPT');
  const rows=value.map(value=>{const row=object(value);exact(row,['session_id','expected_row_version']);return Object.freeze({session_id:identity(row.session_id),expected_row_version:bounded(row.expected_row_version)});});
  if(new Set(rows.map(row=>row.session_id.toLowerCase())).size!==rows.length)throw new DraftError('DRAFT_CORRUPT');return Object.freeze(rows);
}
function choice(value:unknown):ReturnInput['choice']{if(value!=='RETAIN_CURRENT'&&value!=='TRANSFER_SELECTED')throw new DraftError('DRAFT_CORRUPT');return value;}
export function createReturnCommand(value:ReturnInput,commandId:string,reasonCode='WORKBENCH_RETURN_TO_DISPATCH'):P2016ReturnToDispatchCommand{
  if(value.reason.length>500||!value.reason.trim()||value.unfinished.length>1400||!value.unfinished.trim()||!CODE.test(reasonCode))throw new DraftError('DRAFT_CORRUPT');
  const common={client_command_id:identity(commandId),expected_version:bounded(value.version),reason_code:reasonCode,reason:value.reason,unfinished_work:value.unfinished};
  if(value.choice==='RETAIN_CURRENT'){
    if(value.target!==null||value.sessions.length!==0)throw new DraftError('DRAFT_CORRUPT');
    return Object.freeze({...common,communication_choice:'RETAIN_CURRENT' as const,communication_target_principal_id:null,sessions:Object.freeze([] as const)});
  }
  const sessions=selected(value.sessions),first=sessions[0];if(!first)throw new DraftError('DRAFT_CORRUPT');
  const tuple:[P2016ReturnSession,...P2016ReturnSession[]]=[first,...sessions.slice(1)];
  return Object.freeze({...common,communication_choice:'TRANSFER_SELECTED' as const,communication_target_principal_id:identity(value.target),sessions:Object.freeze(tuple)});
}
function decode(text:string):ReturnCopy{
  const copy=object(JSON.parse(text));exact(copy,['schema','value','pending']);if(copy.schema!==1)throw new DraftError('DRAFT_CORRUPT');
  const input=object(copy.value);exact(input,['reason','unfinished','choice','target','sessions','version']);
  if(typeof input.reason!=='string'||input.reason.length>500||typeof input.unfinished!=='string'||input.unfinished.length>1400)throw new DraftError('DRAFT_CORRUPT');
  const value:ReturnInput=Object.freeze({reason:input.reason,unfinished:input.unfinished,choice:choice(input.choice),target:input.target===null?null:identity(input.target),sessions:selected(input.sessions),version:input.version===null?null:bounded(input.version)});
  if(value.choice==='RETAIN_CURRENT'&&(value.target!==null||value.sessions.length))throw new DraftError('DRAFT_CORRUPT');
  let pending:P2016ReturnToDispatchCommand|null=null;
  if(copy.pending!==null){
    const command=object(copy.pending);exact(command,['client_command_id','expected_version','reason_code','reason','unfinished_work','communication_choice','communication_target_principal_id','sessions']);
    if(typeof command.reason_code!=='string'||!CODE.test(command.reason_code))throw new DraftError('DRAFT_CORRUPT');
    pending=createReturnCommand(value,identity(command.client_command_id),command.reason_code);
    if(command.expected_version!==pending.expected_version||command.reason!==pending.reason||command.unfinished_work!==pending.unfinished_work||command.communication_choice!==pending.communication_choice
      ||command.communication_target_principal_id!==pending.communication_target_principal_id||JSON.stringify(selected(command.sessions))!==JSON.stringify(pending.sessions))throw new DraftError('DRAFT_CORRUPT');
  }
  return {value,pending};
}
const choiceRevocations=new Set(['DRAFT_TARGET_REVOKED','DRAFT_SESSION_REVOKED','DRAFT_SESSION_WRITE_REVOKED','DRAFT_RELATION_CHANGED']);
export const isReturnChoiceRevocation=(error:unknown)=>error instanceof DraftError&&choiceRevocations.has(error.message);

// Ticket authority is read separately first. This only confirms the independent target and explicit Session choices.
export async function readReturnChoices(ticketId:string,value:ReturnInput,fence:ReturnFence){
  fence.requireCurrent();if(value.choice==='RETAIN_CURRENT')return;
  if(value.target!==null){
    try{
      const targets=await api.returnCommunicationTargets(ticketId,value.target,value.sessions,fence.signal);fence.requireCurrent();
      if(!targets.items.some(row=>row.principal_id.toLowerCase()===value.target?.toLowerCase()))throw new DraftError('DRAFT_TARGET_UNVERIFIED');
    }catch(error){fence.requireCurrent();if(error instanceof ApiError&&[403,404].includes(error.status))throw new DraftError('DRAFT_TARGET_REVOKED');throw error;}
  }
  for(const row of value.sessions){
    try{await api.readConversation(row.session_id,fence.signal);fence.requireCurrent();}
    catch(error){fence.requireCurrent();if(error instanceof ApiError&&[403,404].includes(error.status))throw new DraftError('DRAFT_SESSION_REVOKED');throw error;}
  }
  const remaining=new Set(value.sessions.map(row=>row.session_id.toLowerCase())),visited=new Set<string>();let cursor:string|null=null,pages=0;
  while(remaining.size){
    if(++pages>10)throw new DraftError('DRAFT_RELATION_UNVERIFIED');
    const page=await api.relatedConversations(ticketId,cursor,fence.signal);fence.requireCurrent();
    for(const row of page.items)if(remaining.has(row.session_id.toLowerCase())){
      if(!row.take_allowed)throw new DraftError('DRAFT_SESSION_WRITE_REVOKED');remaining.delete(row.session_id.toLowerCase());
    }
    if(!page.next_cursor){if(remaining.size)throw new DraftError('DRAFT_RELATION_CHANGED');break;}
    if(visited.has(page.next_cursor))throw new DraftError('DRAFT_RELATION_CHANGED');visited.add(page.next_cursor);cursor=page.next_cursor;
  }
}

export function useReturnDraft({ticketId,principal,value,pending,actionAllowed,onRestore,onOperation,onSensitiveClear}:{
  ticketId:string;principal:Principal;value:ReturnInput;pending:P2016ReturnToDispatchCommand|null;actionAllowed:boolean;
  onRestore:(copy:ReturnCopy)=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void;
}){
  const client=useQueryClient(),scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:'ticket-return-to-dispatch'};
  const enabled=principal.ticket_return_to_dispatch_draft_recovery_enabled;
  const generation=useRef(0),request=useRef<AbortController|null>(null),stage=useRef<'session'|'ticket'>('session');
  const latest=useRef<ReturnCopy>({value,pending});latest.current={value,pending};
  const actions=useRef<readonly string[]>([]),validating=useRef(false),[restoring,setRestoring]=useState(enabled),[unavailable,setUnavailable]=useState(false);
  const clear=()=>{generation.current++;request.current?.abort();request.current=null;validating.current=false;setRestoring(false);setUnavailable(false);onSensitiveClear();};
  const current=(controller:AbortController,token:number,read:()=>void)=>{controller.signal.throwIfAborted();read();if(generation.current!==token||request.current!==controller)throw new DOMException('RETURN_RESTORE_CHANGED','AbortError');};
  const draft=useAuthorizedDraft<ReturnInput,P2016ReturnToDispatchCommand>({
    scope,enabled,writeEnabled:enabled&&principal.ticket_return_to_dispatch_enabled,value,pending,emptyValue:EMPTY_RETURN,
    // A newly typed live value can remain visible when a committed state disables this action; it is not silently saved under lost write authority.
    hasInput:input=>hasReturnInput(input)&&actionAllowed,serialise:serialiseReturn,decode,commandId:command=>command.client_command_id,
    authorize:async signal=>{
      const requireCurrent=captureWorkbenchRead(signal);stage.current='session';
      const fresh=await api.bootstrap(signal);requireCurrent();
      if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      client.setQueryData(['session'],fresh);
      const rawAllowed=fresh.ticket_return_to_dispatch_enabled&&fresh.ticket_return_to_dispatch_draft_recovery_enabled;
      stage.current='ticket';const context=await api.ticketCommandContext(ticketId,signal);requireCurrent();
      client.setQueryData(['ticket-command-context',scope.principal,ticketId],context);actions.current=context.allowed_actions;
      return rawAllowed&&context.allowed_actions.includes('return-to-dispatch');
    },
    onAuthorityFailure:error=>{
      if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session')){
        clear();void clearSessionAuthorization(client,scope.principal,401,'revoked');
      }else if(error instanceof ApiError&&[403,404].includes(error.status)){
        clear();void clearTicketAuthorization(client,scope.principal,ticketId,error);
      }else if(error instanceof DraftError&&error.message==='DRAFT_DISABLED')clear();
      else setUnavailable(true); // A temporary read/storage failure never purges a saved copy.
    },
    onRestore:copy=>{
      const controller=new AbortController(),token=++generation.current,requireRead=captureWorkbenchRead(controller.signal),inputBefore=returnInputSnapshot(latest.current.value);
      request.current?.abort();request.current=controller;validating.current=true;setRestoring(true);setUnavailable(false);
      const fence:ReturnFence={signal:controller.signal,requireCurrent:()=>current(controller,token,requireRead)};
      void(async()=>{
        fence.requireCurrent();const original=await openDraft(scope);fence.requireCurrent();
        if(original.text!==serialiseReturn(copy)||Boolean(copy.pending)!==Boolean(original.handle.operation)
          ||copy.pending&&copy.pending.client_command_id!==original.handle.operation?.commandId)throw new DraftError('DRAFT_CHANGED');
        try{
          if(!actions.current.includes('return-to-dispatch'))throw new DraftError('DRAFT_ACTION_REVOKED');
          await readReturnChoices(ticketId,copy.value,fence);fence.requireCurrent();
        }catch(error){
          fence.requireCurrent();
          if(isReturnChoiceRevocation(error)||error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'){
            // Only the originally observed revision is removed; a newer tab's value is never guessed or deleted.
            fence.requireCurrent();await removeSensitiveDraft(original.handle,'revoked',{requireMatchingRevision:true});fence.requireCurrent();
          }
          throw error;
        }
        const checked=await openDraft(scope);fence.requireCurrent();
        if(checked.text!==serialiseReturn(copy)||checked.handle.record?.revision!==original.handle.record?.revision
          ||checked.handle.operation?.commandId!==original.handle.operation?.commandId)throw new DraftError('DRAFT_CHANGED');
        if(returnInputSnapshot(latest.current.value)!==inputBefore){if(copy.pending)onOperation(copy.pending.client_command_id);return;}
        onRestore(copy);
      })().catch(error=>{
        try{fence.requireCurrent();}catch{return;}
        if(error instanceof ApiError&&error.status===401){clear();void clearSessionAuthorization(client,scope.principal,401,'revoked');return;}
        setUnavailable(true);if(copy.pending)onOperation(copy.pending.client_command_id);
      }).finally(()=>{if(request.current===controller&&generation.current===token){request.current=null;validating.current=false;setRestoring(false);}});
    },onOperation,onSensitiveClear:clear,
  });
  useEffect(()=>{if(!validating.current&&['ready','saved','failed','disabled'].includes(draft.status))setRestoring(false);},[draft.status]);
  const checkOpaque=async(fence:ReturnFence,purge=false)=>{
    fence.requireCurrent();if(!await hasExistingDraft(scope)){fence.requireCurrent();return null;}
    fence.requireCurrent();const fresh=await api.bootstrap(fence.signal);fence.requireCurrent();if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');
    client.setQueryData(['session'],fresh);if(fresh.ticket_return_to_dispatch_draft_recovery_enabled)throw new DraftError('DRAFT_RECHECK_ENABLED');
    await api.ticketCommandContext(ticketId,fence.signal);fence.requireCurrent();const saved=await openDraft(scope,{restore:false});fence.requireCurrent();
    if(purge&&saved.handle.record){await removeSensitiveDraft(saved.handle,'revoked',{requireMatchingRevision:true});fence.requireCurrent();}
    return saved.handle;
  };
  useEffect(()=>{
    if(enabled)return;const controller=new AbortController(),token=++generation.current,requireRead=captureWorkbenchRead(controller.signal);request.current?.abort();request.current=controller;setRestoring(true);setUnavailable(false);
    const fence:ReturnFence={signal:controller.signal,requireCurrent:()=>current(controller,token,requireRead)};
    void checkOpaque(fence,true).then(saved=>{fence.requireCurrent();if(saved?.operation){onSensitiveClear();onOperation(saved.operation.commandId);}}).catch(error=>{
      try{fence.requireCurrent();}catch{return;}setUnavailable(true);
      if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'){onSensitiveClear();void clearSessionAuthorization(client,scope.principal,401,'revoked');}
      else if(error instanceof ApiError&&[403,404].includes(error.status)){onSensitiveClear();void clearTicketAuthorization(client,scope.principal,ticketId,error);}
    }).finally(()=>{if(request.current===controller&&generation.current===token){request.current=null;setRestoring(false);}});
    return()=>{controller.abort();generation.current++;};
  },[enabled,scope.principal,ticketId]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  return {
    enabled: draft.enabled,status:draft.status,operationId:draft.operationId,
    restorationBlocked:unavailable,restoring,canSubmit:draft.canSubmit&&!restoring&&!unavailable&&draft.status!=='loading',
    safeToLeave:!restoring&&!unavailable&&(draft.safeToLeave||Boolean(enabled&&draft.operationId&&pending===null&&!hasReturnInput(value)&&['ready','saved'].includes(draft.status))),
    message:unavailable?'恢复核验暂时不可用，已保留加密副本；请恢复服务后重新读取。':restoring?'正在核对当前退回、目标和会话授权…':draft.message,
    async prepare(command:P2016ReturnToDispatchCommand,fence:ReturnFence){
      fence.requireCurrent();if(!enabled){const saved=await checkOpaque(fence,true);fence.requireCurrent();if(saved?.operation){onSensitiveClear();onOperation(saved.operation.commandId);throw new DraftError('DRAFT_OPERATION_PENDING');}}
      await draft.prepare(command);fence.requireCurrent();
    },
    async settleKnown(commandId:string,fence:ReturnFence){
      fence.requireCurrent();
      // Preserve current input before the shared method's await; its original revision/UUID CAS cannot erase a newer row.
      // Do not use T06's stale ACK callback or knownFailure's post-await save path.
      if(!enabled){const saved=await checkOpaque(fence);fence.requireCurrent();if(!saved?.operation)return true;if(saved.operation.commandId!==commandId||saved.record!==null)return false;await settleDraft(saved,commandId);fence.requireCurrent();return saved.operation===null;}
      const cleaned=await draft.success(commandId,true);fence.requireCurrent();return cleaned;
    },
    async dropSensitive(expected:ReturnCopy,fence:ReturnFence){
      fence.requireCurrent();if(!enabled){onSensitiveClear();return true;}
      const copy=await openDraft(scope);fence.requireCurrent();
      if(copy.text===null&&copy.handle.record===null)return true;
      if(copy.text!==serialiseReturn(expected))return false;
      fence.requireCurrent();await removeSensitiveDraft(copy.handle,'revoked',{requireMatchingRevision:true});fence.requireCurrent();return true;
    },
  };
}
