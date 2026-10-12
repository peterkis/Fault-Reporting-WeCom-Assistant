import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import type {WaitingAction,WaitingCommand} from '../../../../../contracts/workbench_waiting_contracts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError,hasExistingDraft,openDraft,removeSensitiveDraft,settleDraft} from '../drafts/encrypted-drafts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const purposes:Record<WaitingAction,string>={'request-information':'waiting-requester','wait-vendor':'waiting-vendor',resume:'waiting-resume',cancel:'waiting-cancel'};
export interface WaitingCopy {value:string;pending:WaitingCommand|null}
export interface WaitingFence {signal:AbortSignal;requireCurrent:()=>void}
export const serialiseWaiting=(copy:WaitingCopy)=>JSON.stringify({schema:1,note:copy.value,pending:copy.pending});
function decode(text:string):WaitingCopy{
  const input:unknown=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))throw new DraftError('DRAFT_CORRUPT');const value=input as Record<string,unknown>;
  if(Object.keys(value).length!==3||value.schema!==1||typeof value.note!=='string'||value.note.length>2000)throw new DraftError('DRAFT_CORRUPT');let pending:WaitingCommand|null=null;
  if(value.pending!==null){
    if(!value.pending||typeof value.pending!=='object'||Array.isArray(value.pending))throw new DraftError('DRAFT_CORRUPT');const command=value.pending as Record<string,unknown>;
    if(Object.keys(command).length!==5||typeof command.client_command_id!=='string'||!UUID.test(command.client_command_id)||typeof command.expected_version!=='number'||!Number.isSafeInteger(command.expected_version)||command.expected_version<1||command.expected_version>2147483647||typeof command.reason_code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(command.reason_code)||typeof command.note!=='string'||!command.note.trim()||command.note.length>2000||command.external_visible!==false)throw new DraftError('DRAFT_CORRUPT');
    pending=Object.freeze({client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:command.reason_code,note:command.note,external_visible:false});
  }return {value:value.note,pending};
}
export function useWaitingDraft({ticketId,action,principal,value,pending,allowed,onRestore,onOperation,onSensitiveClear}:{ticketId:string;action:WaitingAction;principal:Principal;value:string;pending:WaitingCommand|null;allowed:boolean;onRestore:(copy:WaitingCopy)=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:purposes[action]},raw=principal.ticket_waiting_action_draft_recovery_enabled;
  const [existing,setExisting]=useState(false),[restoring,setRestoring]=useState(false),[unavailable,setUnavailable]=useState(false);
  const generation=useRef(0),request=useRef<AbortController|null>(null),stage=useRef<'session'|'ticket'>('session'),restoreRead=useRef<()=>void>(()=>{});
  const enabled=raw&&(allowed||existing);
  const authorityFailure=(error:unknown)=>{
    if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session')){onSensitiveClear();void clearSessionAuthorization(client,scope.principal,401,'revoked');}
    else if(error instanceof ApiError&&[403,404].includes(error.status)){onSensitiveClear();void clearTicketAuthorization(client,scope.principal,ticketId,error);}
    else if(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'){setExisting(false);onSensitiveClear();}
    else if(!(error instanceof DOMException&&error.name==='AbortError'))setUnavailable(true);
  };
  const draft=useAuthorizedDraft<string,WaitingCommand>({scope,enabled,writeEnabled:raw&&allowed,value,pending,emptyValue:'',hasInput:note=>Boolean(note)&&allowed,serialise:serialiseWaiting,decode,commandId:command=>command.client_command_id,
    authorize:async signal=>{
      const read=captureWorkbenchRead(signal);restoreRead.current=read;stage.current='session';const fresh=await api.bootstrap(signal);read();if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);
      stage.current='ticket';const ticket=await api.ticketCommandContext(ticketId,signal);read();client.setQueryData(['ticket-command-context',scope.principal,ticketId],ticket);
      return fresh.ticket_waiting_actions_enabled&&fresh.ticket_waiting_action_draft_recovery_enabled&&ticket.allowed_actions.includes(action);
    },onAuthorityFailure:authorityFailure,onRestore:copy=>{restoreRead.current();setExisting(true);onRestore(copy);},onOperation:id=>{setExisting(true);onOperation(id);},onSensitiveClear,
  });
  const checkOpaque=async(fence:WaitingFence,purge=false)=>{
    fence.requireCurrent();if(!await hasExistingDraft(scope)){fence.requireCurrent();return null;}fence.requireCurrent();stage.current='session';const fresh=await api.bootstrap(fence.signal);fence.requireCurrent();if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);if(fresh.ticket_waiting_action_draft_recovery_enabled)throw new DraftError('DRAFT_RECHECK_ENABLED');
    stage.current='ticket';await api.ticketCommandContext(ticketId,fence.signal);fence.requireCurrent();const copy=await openDraft(scope,{restore:false});fence.requireCurrent();if(purge&&copy.handle.record){await removeSensitiveDraft(copy.handle,'revoked',{requireMatchingRevision:true});fence.requireCurrent();}return copy.handle;
  };
  useEffect(()=>{
    const controller=new AbortController(),token=++generation.current,read=captureWorkbenchRead(controller.signal);request.current?.abort();request.current=controller;setUnavailable(false);
    const fence:WaitingFence={signal:controller.signal,requireCurrent:()=>{controller.signal.throwIfAborted();read();if(generation.current!==token||request.current!==controller)throw new DOMException('WAITING_RESTORE_CHANGED','AbortError');}};
    if(raw){setRestoring(false);if(!allowed)void hasExistingDraft(scope).then(found=>{fence.requireCurrent();setExisting(found);}).catch(authorityFailure);return()=>{controller.abort();generation.current++;};}
    setRestoring(true);void checkOpaque(fence,true).then(handle=>{fence.requireCurrent();if(handle?.operation){onSensitiveClear();onOperation(handle.operation.commandId);}}).catch(error=>{try{fence.requireCurrent();}catch{return;}authorityFailure(error);}).finally(()=>{if(generation.current===token&&request.current===controller){request.current=null;setRestoring(false);}});
    return()=>{controller.abort();generation.current++;};
  },[raw,allowed,scope.principal,ticketId,action]);
  return {enabled:draft.enabled,message:draft.message,operationId:draft.operationId,restoring,canSubmit:draft.canSubmit&&!restoring&&!unavailable&&draft.status!=='loading',
    safeToLeave:!restoring&&!unavailable&&(draft.safeToLeave||Boolean(draft.operationId&&pending===null&&!value&&['ready','saved'].includes(draft.status))),
    async prepare(command:WaitingCommand,fence:WaitingFence){fence.requireCurrent();if(!raw){const handle=await checkOpaque(fence,true);fence.requireCurrent();if(handle?.operation){onSensitiveClear();onOperation(handle.operation.commandId);throw new DraftError('DRAFT_OPERATION_PENDING');}}await draft.prepare(command);fence.requireCurrent();if(raw)setExisting(true);},
    async settle(commandId:string,fence:WaitingFence){fence.requireCurrent();if(raw){const cleaned=await draft.success(commandId,true);fence.requireCurrent();if(cleaned)setExisting(false);return cleaned;}const handle=await checkOpaque(fence);fence.requireCurrent();if(!handle?.operation)return true;if(handle.operation.commandId!==commandId||handle.record!==null)return false;await settleDraft(handle,commandId);fence.requireCurrent();return handle.operation===null;},
    async dropSensitive(copy:WaitingCopy,fence:WaitingFence){fence.requireCurrent();if(!raw){onSensitiveClear();return true;}if(!await hasExistingDraft(scope)){fence.requireCurrent();onSensitiveClear();return true;}const saved=await openDraft(scope);fence.requireCurrent();if(saved.text!==null&&saved.text!==serialiseWaiting(copy))return false;if(saved.handle.record)await removeSensitiveDraft(saved.handle,'discard',{requireMatchingRevision:true});fence.requireCurrent();onSensitiveClear();return true;},
  };
}
