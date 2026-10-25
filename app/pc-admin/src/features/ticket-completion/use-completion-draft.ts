import {useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {P2016CompletionCommand,Principal} from '../../api/client';
import {DraftError} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

export interface CompletionInput {process:string;summary:string;confirmed:boolean}
export const EMPTY_COMPLETION:CompletionInput=Object.freeze({process:'',summary:'',confirmed:false});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function decode(text:string){
  const v=record(JSON.parse(text)),value=record(v.value);if(Object.keys(v).length!==3||v.schema!==1||Object.keys(value).length!==3||typeof value.process!=='string'||value.process.length>2000||typeof value.summary!=='string'||value.summary.length>500||typeof value.confirmed!=='boolean')throw new DraftError('DRAFT_CORRUPT');
  let pending:P2016CompletionCommand|null=null;
  if(v.pending!==null){const c=record(v.pending);if(Object.keys(c).length!==7||typeof c.client_command_id!=='string'||!UUID.test(c.client_command_id)||typeof c.handling_cycle_id!=='string'||!UUID.test(c.handling_cycle_id)||typeof c.expected_version!=='number'||!Number.isSafeInteger(c.expected_version)||c.expected_version<1||c.expected_version>2147483647||c.reason_code!=='STAFF_COMPLETED'||c.external_summary_confirmed!==true||typeof c.internal_process!=='string'||!c.internal_process.trim()||c.internal_process.length>2000||typeof c.external_summary!=='string'||!c.external_summary.trim()||c.external_summary.length>500)throw new DraftError('DRAFT_CORRUPT');pending=Object.freeze({client_command_id:c.client_command_id,expected_version:c.expected_version,reason_code:'STAFF_COMPLETED',handling_cycle_id:c.handling_cycle_id,internal_process:c.internal_process,external_summary:c.external_summary,external_summary_confirmed:true});}
  return {value:{process:value.process,summary:value.summary,confirmed:value.confirmed},pending};
}
export function useCompletionDraft({ticketId,principal,value,pending,onRestore,onOperation,onSensitiveClear}:{ticketId:string;principal:Principal;value:CompletionInput;pending:P2016CompletionCommand|null;onRestore:(copy:{value:CompletionInput;pending:P2016CompletionCommand|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),stage=useRef<'session'|'ticket'>('session'),scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:'staff-completion'};
  return useAuthorizedDraft<CompletionInput,P2016CompletionCommand>({scope,enabled:principal.staff_completion_draft_recovery_enabled,value,pending,emptyValue:EMPTY_COMPLETION,hasInput:v=>Boolean(v.process||v.summary),serialise:copy=>JSON.stringify({schema:1,...copy}),decode,commandId:command=>command.client_command_id,
    authorize:async signal=>{
      stage.current='session';const fresh=await api.bootstrap(signal);if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');client.setQueryData(['session'],fresh);
      if(!fresh.ticket_staff_completion_enabled||!fresh.staff_completion_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');
      stage.current='ticket';const current=await api.ticketCommandContext(ticketId,signal);client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],current);
      return current.allowed_actions.includes('complete')&&current.handling_cycle?.first_responsibility_event_id!=null&&current.handling_cycle.staff_completion_event_id===null;
    },onAuthorityFailure:error=>{
      if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked');
      else if(error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');
      else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,principal.principal_id,ticketId,error);
    },onRestore,onOperation,onSensitiveClear});
}
