import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal,P2016AssignmentAction,P2016AssignmentCommand} from '../../api/client';
import {DraftError,openDraft,removeSensitiveDraft,purgeDrafts} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
export type AssignmentIntent=Readonly<{action:P2016AssignmentAction;command:P2016AssignmentCommand}>;
export interface AssignmentInput {team:string;person:string;choice:P2016AssignmentCommand['communication_choice']|null;sessions:P2016AssignmentCommand['sessions']}
export const EMPTY_ASSIGNMENT:AssignmentInput=Object.freeze({team:'',person:'',choice:null,sessions:[]});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,CODE=/^[A-Z][A-Z0-9_]{0,63}$/u;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function identity(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function code(value:unknown):string{if(typeof value!=='string'||!CODE.test(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function version(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)throw new DraftError('DRAFT_CORRUPT');return value;}
function choice(value:unknown):P2016AssignmentCommand['communication_choice']{if(value!=='RETAIN_CURRENT'&&value!=='TRANSFER_SELECTED')throw new DraftError('DRAFT_CORRUPT');return value;}
function sessions(value:unknown):P2016AssignmentCommand['sessions']{if(!Array.isArray(value)||value.length>8)throw new DraftError('DRAFT_CORRUPT');const selected=value.map(value=>{const row=object(value);if(Object.keys(row).length!==2)throw new DraftError('DRAFT_CORRUPT');return Object.freeze({session_id:identity(row.session_id),expected_row_version:version(row.expected_row_version)});});if(new Set(selected.map(row=>row.session_id.toLowerCase())).size!==selected.length)throw new DraftError('DRAFT_CORRUPT');return Object.freeze(selected);}
function decode(text:string){const value=object(JSON.parse(text)),input=object(value.value);if(Object.keys(value).length!==3||value.schema!==1||Object.keys(input).length!==4)throw new DraftError('DRAFT_CORRUPT');
 const current:AssignmentInput={team:input.team===''?'':code(input.team),person:input.person===''?'':identity(input.person),choice:input.choice===null?null:choice(input.choice),sessions:sessions(input.sessions)};let pending:AssignmentIntent|null=null;
 if(value.pending!==null){const intent=object(value.pending),command=object(intent.command);if(Object.keys(intent).length!==2||Object.keys(command).length!==7||(intent.action!=='assign'&&intent.action!=='transfer-assignment'))throw new DraftError('DRAFT_CORRUPT');const selected=sessions(command.sessions),communication=choice(command.communication_choice);
  if(command.resolver_team_id!==current.team||command.target_principal_id!==current.person||communication!==current.choice||JSON.stringify(selected)!==JSON.stringify(communication==='RETAIN_CURRENT'?[]:current.sessions)||(communication==='TRANSFER_SELECTED'&&!selected.length))throw new DraftError('DRAFT_CORRUPT');
  pending=Object.freeze({action:intent.action,command:Object.freeze({client_command_id:identity(command.client_command_id),expected_version:version(command.expected_version),reason_code:code(command.reason_code),target_principal_id:identity(command.target_principal_id),resolver_team_id:code(command.resolver_team_id),communication_choice:communication,sessions:selected})});
 }
 return {value:current,pending};
}
export function useAssignmentDraft({ticketId,principal,value,pending,onRestore,onOperation,onSensitiveClear}:{ticketId:string;principal:Principal;value:AssignmentInput;pending:AssignmentIntent|null;onRestore:(copy:{value:AssignmentInput;pending:AssignmentIntent|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
 const client=useQueryClient(),scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:'ticket-assignment'},enabled=principal.ticket_assignment_draft_recovery_enabled;
 const [restoring,setRestoring]=useState(enabled),[unavailable,setUnavailable]=useState(false),generation=useRef(0),validating=useRef(false),request=useRef<AbortController|null>(null),stage=useRef<'session'|'ticket'>('session'),actions=useRef<readonly string[]>([]);
 const serialise=(copy:{value:AssignmentInput;pending:AssignmentIntent|null})=>JSON.stringify({schema:1,...copy});
 const clear=()=>{generation.current++;request.current?.abort();request.current=null;validating.current=false;setUnavailable(false);setRestoring(false);onSensitiveClear();};
 const draft=useAuthorizedDraft<AssignmentInput,AssignmentIntent>({scope,enabled,value,pending,emptyValue:EMPTY_ASSIGNMENT,hasInput:value=>Boolean(value.team||value.person||value.choice||value.sessions.length),serialise,decode,commandId:intent=>intent.command.client_command_id,
  authorize:async signal=>{stage.current='session';const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');if(!fresh.ticket_assignment_enabled||!fresh.ticket_assignment_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');stage.current='ticket';const context=await api.ticketCommandContext(ticketId,signal);client.setQueryData(['ticket-command-context',scope.principal,ticketId],context);actions.current=context.allowed_actions;return actions.current.some(action=>action==='assign'||action==='transfer-assignment');},
  onAuthorityFailure:error=>{if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,scope.principal,401,'revoked');else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,scope.principal,ticketId,error);else if(error instanceof DraftError&&error.message==='DRAFT_DISABLED')void purgeDrafts({...scope,reason:'revoked'});else setUnavailable(true);},
  onRestore:copy=>{const token=++generation.current,controller=new AbortController();request.current?.abort();request.current=controller;validating.current=true;setUnavailable(false);setRestoring(true);
   void(async()=>{if(!copy.pending&&!actions.current.some(action=>action==='assign'||action==='transfer-assignment'))throw new DraftError('DRAFT_ACTION_REVOKED');
    if(copy.value.team){const current=await api.assignmentTargets(ticketId,copy.value.team,controller.signal,copy.value.person||null);if(copy.value.person&&!current.items.some(row=>row.principal_id===copy.value.person))throw new DraftError('DRAFT_TARGET_REVOKED');}
    for(const row of copy.value.sessions)await api.readConversation(row.session_id,controller.signal);const remaining=new Set(copy.value.sessions.map(row=>row.session_id));let cursor:string|null=null;
    while(remaining.size){const page=await api.relatedConversations(ticketId,cursor,controller.signal);for(const row of page.items)remaining.delete(row.session_id);if(!page.next_cursor){if(remaining.size)throw new DraftError('DRAFT_RELATION_CHANGED');break;}if(cursor===page.next_cursor)throw new DraftError('DRAFT_RELATION_CHANGED');cursor=page.next_cursor;}
    const current=await openDraft(scope);if(current.text!==serialise(copy)||Boolean(copy.pending)!==Boolean(current.handle.operation)||copy.pending&&copy.pending.command.client_command_id!==current.handle.operation?.commandId)throw new DraftError('DRAFT_CHANGED');
    if(controller.signal.aborted||generation.current!==token)return;onRestore(copy);validating.current=false;setRestoring(false);request.current=null;
   })().catch(error=>{if(controller.signal.aborted||generation.current!==token)return;validating.current=false;setRestoring(false);request.current=null;if(error instanceof ApiError&&error.status===401){void clearSessionAuthorization(client,scope.principal,401,'revoked');return;}
    if(error instanceof ApiError&&[403,404].includes(error.status)||error instanceof DraftError&&['DRAFT_ACTION_REVOKED','DRAFT_TARGET_REVOKED','DRAFT_RELATION_CHANGED'].includes(error.message)){void openDraft(scope,{restore:false}).then(copy=>removeSensitiveDraft(copy.handle,'revoked')).catch(()=>{});return;}
    setUnavailable(true);if(copy.pending)onOperation(copy.pending.command.client_command_id);
   });
  },onOperation,onSensitiveClear:clear,
 });
 useEffect(()=>{if(!validating.current&&['ready','saved','failed','disabled'].includes(draft.status))setRestoring(false);},[draft.status]);useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 return {...draft,restorationBlocked:unavailable,canSubmit:draft.canSubmit&&!restoring&&!unavailable&&draft.status!=='loading',safeToLeave:draft.safeToLeave&&!restoring,message:unavailable?'恢复核验暂时不可用，已保留加密副本；请恢复服务后刷新重试。':restoring?'正在核对恢复选择的当前授权…':draft.message,settle:(id:string)=>draft.success(id)};
}
