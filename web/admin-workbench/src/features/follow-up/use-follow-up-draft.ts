import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {DraftError,hasExistingDraft} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {followUpApi,followUpInput} from './client';
import type {SharedFollowUpCommand} from './client';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function corrupt():never{throw new DraftError('DRAFT_CORRUPT');}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return corrupt();
 const record=value as Record<string,unknown>;
 if(Object.keys(record).length!==keys.length||Object.keys(record).some(key=>!keys.includes(key)))return corrupt();
 return record;
}
function decode(serialized:string):{value:string;pending:SharedFollowUpCommand|null}{
 let parsed:unknown;try{parsed=JSON.parse(serialized);}catch{return corrupt();}
 const copy=closed(parsed,['schema','value','pending']);
 if(copy.schema!==1||typeof copy.value!=='string'||copy.value.length>19)return corrupt();
 let pending:SharedFollowUpCommand|null=null;
 if(copy.pending!==null){
  const command=closed(copy.pending,['client_command_id','expected_version','expected_schedule_version','reason_code','action','due_at']);
  if(typeof command.client_command_id!=='string'||!UUID.test(command.client_command_id)
   ||typeof command.expected_version!=='number'||!Number.isSafeInteger(command.expected_version)||command.expected_version<1||command.expected_version>2147483647
   ||typeof command.expected_schedule_version!=='string'||!/^(0|[1-9][0-9]{0,18})$/u.test(command.expected_schedule_version)||BigInt(command.expected_schedule_version)>9223372036854775807n
   ||command.reason_code!=='WORKBENCH_FOLLOW_UP_SCHEDULE')return corrupt();
  const base={client_command_id:command.client_command_id,expected_version:command.expected_version,expected_schedule_version:command.expected_schedule_version,reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE' as const};
  if(command.action==='SET'){
   let due:ReturnType<typeof followUpInput>;try{due=followUpInput(copy.value);}catch{return corrupt();}
   if(command.due_at!==due||command.due_at!==copy.value.trim())return corrupt();
   pending=Object.freeze({...base,action:'SET',due_at:due});
  }else if(command.action==='CANCEL'&&command.due_at===null)pending=Object.freeze({...base,action:'CANCEL',due_at:null});
  else return corrupt();
 }
 return {value:copy.value,pending};
}
interface FollowUpDraftOptions {
 ticketId:string;principal:Principal;input:string;pending:SharedFollowUpCommand|null;
 onRestore:(copy:{value:string;pending:SharedFollowUpCommand|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void;
}
export function useFollowUpDraft({ticketId,principal,input,pending,onRestore,onOperation,onSensitiveClear}:FollowUpDraftOptions){
 const client=useQueryClient(),stage=useRef<'session'|'ticket'>('session'),[existing,setExisting]=useState(false),[probing,setProbing]=useState(true);
 const scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:'shared-follow-up-schedule'},rawEnabled=principal.follow_up_schedule_draft_recovery_enabled===true;
 const authorityFailure=(error:unknown)=>{
  if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked');
  else if(error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,principal.principal_id,ticketId,error);
 };
 async function authorize(signal:AbortSignal){
  const currentRead=captureWorkbenchRead(signal);currentRead();stage.current='session';
  const fresh=await api.bootstrap(signal);currentRead();if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);
  stage.current='ticket';const context=await api.ticketCommandContext(ticketId,signal);currentRead();client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],context);
  // Existing opaque operations require current Ticket READ even when new raw writes or the view are off.
  // Returning false lets the shared protocol remove only sensitive recovery and retain the original UUID.
  if(!fresh.follow_up_schedules_enabled||fresh.follow_up_schedule_draft_recovery_enabled!==true)return false;
  const view=await followUpApi.view(ticketId,signal);currentRead();client.setQueryData(['ticket-follow-up-schedule',principal.principal_id,ticketId],view);
  return view.allowed_actions.some(action=>action==='SET'||action==='CANCEL');
 }
 useEffect(()=>{
  if(rawEnabled){setProbing(false);return;}
  const controller=new AbortController();setExisting(false);setProbing(true);
  void (async()=>{if(!await hasExistingDraft(scope)||controller.signal.aborted)return;await authorize(controller.signal);if(!controller.signal.aborted)setExisting(true);})()
   .catch(error=>{if(!controller.signal.aborted)authorityFailure(error);}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});
  return()=>controller.abort();
 },[principal.principal_id,principal.csrf_token,principal.authorization_revision,rawEnabled,ticketId]);
 const draft=useAuthorizedDraft<string,SharedFollowUpCommand>({scope,enabled:rawEnabled||existing,writeEnabled:rawEnabled,value:input,pending,emptyValue:'',hasInput:value=>Boolean(value),
  serialise:copy=>JSON.stringify({schema:1,...copy}),decode,commandId:command=>command.client_command_id,authorize,onAuthorityFailure:authorityFailure,onRestore,onOperation,onSensitiveClear});
 return {...draft,probing};
}
