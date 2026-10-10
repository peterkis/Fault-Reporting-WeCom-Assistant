import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal,P2016ReopenCommand} from '../../api/client';
import {DraftError,hasExistingDraft} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function decode(text:string){
 const copy=object(JSON.parse(text));if(Object.keys(copy).length!==3||copy.schema!==1||typeof copy.value!=='string'||copy.value.length>2000)throw new DraftError('DRAFT_CORRUPT');
 let pending:P2016ReopenCommand|null=null;
 if(copy.pending!==null){const command=object(copy.pending);if(Object.keys(command).length!==4||typeof command.client_command_id!=='string'||!UUID.test(command.client_command_id)||typeof command.expected_version!=='number'||!Number.isSafeInteger(command.expected_version)||command.expected_version<1||command.expected_version>2147483647||command.reason_code!=='STAFF_REOPEN'||typeof command.note!=='string'||!command.note.trim()||command.note.length>2000||command.note!==copy.value.trim())throw new DraftError('DRAFT_CORRUPT');pending=Object.freeze({client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:'STAFF_REOPEN',note:command.note});}
 return {value:copy.value,pending};
}
export function useReopenDraft({ticketId,principal,reason,pending,onRestore,onOperation,onSensitiveClear}:{ticketId:string;principal:Principal;reason:string;pending:P2016ReopenCommand|null;onRestore:(copy:{value:string;pending:P2016ReopenCommand|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
 const client=useQueryClient(),stage=useRef<'session'|'ticket'>('session'),[existing,setExisting]=useState(false),[probing,setProbing]=useState(true);
 const scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:'staff-reopen'};
 const authorityFailure=(error:unknown)=>{
  if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked');
  else if(error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,principal.principal_id,ticketId,error);
 };
 async function authorize(signal:AbortSignal){
  const currentRead=captureWorkbenchRead(signal);stage.current='session';const fresh=await api.bootstrap(signal);currentRead();if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);
  stage.current='ticket';const current=await api.ticketCommandContext(ticketId,signal);currentRead();client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],current);
  return fresh.ticket_reopen_rounds_enabled&&fresh.ticket_reopen_draft_recovery_enabled===true&&current.allowed_actions.includes('reopen');
 }
 useEffect(()=>{
  if(principal.ticket_reopen_draft_recovery_enabled){setProbing(false);return;}
  const controller=new AbortController();setProbing(true);
  void (async()=>{if(!await hasExistingDraft(scope)||controller.signal.aborted)return;await authorize(controller.signal);if(!controller.signal.aborted)setExisting(true);})().catch(error=>{if(!controller.signal.aborted)authorityFailure(error);}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});
  return()=>controller.abort();
 },[principal.principal_id,principal.csrf_token,principal.ticket_reopen_draft_recovery_enabled,ticketId]);
 const draft=useAuthorizedDraft<string,P2016ReopenCommand>({scope,enabled:principal.ticket_reopen_draft_recovery_enabled===true||existing,writeEnabled:principal.ticket_reopen_draft_recovery_enabled===true,value:reason,pending,emptyValue:'',hasInput:input=>Boolean(input),serialise:copy=>JSON.stringify({schema:1,...copy}),decode,commandId:command=>command.client_command_id,authorize,onAuthorityFailure:authorityFailure,onRestore,onOperation,onSensitiveClear});
 return {...draft,probing};
}
