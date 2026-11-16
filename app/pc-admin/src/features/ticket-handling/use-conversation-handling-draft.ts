import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal,P2016ConversationHandlingCommand,P2016ConversationHandlingAction} from '../../api/client';
import {DraftError,openDraft,removeOwnedSensitiveDraft,purgeDrafts} from '../drafts/encrypted-drafts';
import type {DraftHandle,DraftScope} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

export type ConversationHandlingIntent=Readonly<{action:P2016ConversationHandlingAction;command:P2016ConversationHandlingCommand}>;
export interface CommunicationChoice {choice:P2016ConversationHandlingCommand['communication_choice'];sessions:P2016ConversationHandlingCommand['sessions']}
interface Copy extends CommunicationChoice {schema:1;pending:ConversationHandlingIntent|null}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function bounded(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)throw new DraftError('DRAFT_CORRUPT');return value;}
function identity(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function choice(value:unknown):CommunicationChoice['choice']{if(value!=='TAKE_SELECTED'&&value!=='RETAIN_CURRENT')throw new DraftError('DRAFT_CORRUPT');return value;}
function sessions(value:unknown):CommunicationChoice['sessions']{
  if(!Array.isArray(value)||value.length>8)throw new DraftError('DRAFT_CORRUPT');
  const rows=value.map(value=>{const v=object(value);if(Object.keys(v).length!==2)throw new DraftError('DRAFT_CORRUPT');return Object.freeze({session_id:identity(v.session_id),expected_row_version:bounded(v.expected_row_version)});});
  if(new Set(rows.map(row=>row.session_id.toLowerCase())).size!==rows.length)throw new DraftError('DRAFT_CORRUPT');return Object.freeze(rows);
}
function decode(text:string):Copy{
  const v=object(JSON.parse(text));if(Object.keys(v).length!==4||v.schema!==1)throw new DraftError('DRAFT_CORRUPT');
  const selected=sessions(v.sessions),communication=choice(v.choice);let pending:ConversationHandlingIntent|null=null;
  if(v.pending!==null){const intent=object(v.pending),command=object(intent.command);
    if(Object.keys(intent).length!==2||Object.keys(command).length!==6||(intent.action!=='take-and-start-with-conversations'&&intent.action!=='accept-for-later-with-conversations')
      ||typeof command.reason_code!=='string'||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(command.reason_code)||typeof command.resolver_team_id!=='string'||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(command.resolver_team_id))throw new DraftError('DRAFT_CORRUPT');
    const commandChoice=choice(command.communication_choice),commandSessions=sessions(command.sessions);
    if(commandChoice!==communication||(commandChoice==='TAKE_SELECTED'?commandSessions.length===0:commandSessions.length!==0)
      ||JSON.stringify(commandSessions)!==JSON.stringify(commandChoice==='RETAIN_CURRENT'?[]:selected))throw new DraftError('DRAFT_CORRUPT');
    pending=Object.freeze({action:intent.action,command:Object.freeze({client_command_id:identity(command.client_command_id),expected_version:bounded(command.expected_version),reason_code:command.reason_code,resolver_team_id:command.resolver_team_id,communication_choice:commandChoice,sessions:commandSessions})});
  }
  return {schema:1,choice:communication,sessions:selected,pending};
}
export function useConversationHandlingDraft({ticketId,principal,value,pending,onRestore,onSensitiveClear,onOperation}:{ticketId:string;principal:Principal;value:CommunicationChoice;pending:ConversationHandlingIntent|null;onRestore:(value:Copy)=>void;onSensitiveClear:()=>void;onOperation:()=>void}){
  const scope:DraftScope={principal:principal.principal_id,kind:'ticket',id:ticketId,purpose:'ticket-conversation-handling'},enabled=principal.ticket_conversation_draft_recovery_enabled,client=useQueryClient();
  const [restoring,setRestoring]=useState(enabled),[unavailable,setUnavailable]=useState(false),generation=useRef(0),validating=useRef(false),request=useRef<AbortController|null>(null),stage=useRef<'session'|'ticket'>('session'),actions=useRef<readonly string[]>([]);
  const serialise=({value,pending}:{value:CommunicationChoice;pending:ConversationHandlingIntent|null})=>JSON.stringify({schema:1,...value,...(pending?{choice:pending.command.communication_choice,sessions:pending.command.sessions}:{}),pending});
  const clear=()=>{generation.current++;request.current?.abort();request.current=null;validating.current=false;setRestoring(false);setUnavailable(false);onSensitiveClear();};
  const draft=useAuthorizedDraft<CommunicationChoice,ConversationHandlingIntent>({scope,enabled,writeEnabled:enabled&&!unavailable,value,pending,emptyValue:{choice:'TAKE_SELECTED',sessions:[]},hasInput:value=>value.sessions.length>0||value.choice==='RETAIN_CURRENT',serialise,
    decode:text=>{const copy=decode(text);return {value:{choice:copy.choice,sessions:copy.sessions},pending:copy.pending};},commandId:intent=>intent.command.client_command_id,
    authorize:async signal=>{stage.current='session';const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);if(fresh.principal_id!==scope.principal||!fresh.ticket_conversation_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');stage.current='ticket';const context=await api.ticketCommandContext(ticketId,signal);client.setQueryData(['ticket-command-context',scope.principal,ticketId],context);actions.current=context.allowed_actions;return true;},
    onAuthorityFailure:error=>{if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,scope.principal,401,'revoked');else if(error instanceof ApiError&&error.status===403&&stage.current==='session')void clearSessionAuthorization(client,scope.principal,403,'revoked');else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,scope.principal,ticketId,error);else if(error instanceof DraftError&&error.message==='DRAFT_DISABLED')void purgeDrafts({...scope,reason:'revoked'});else setUnavailable(true);},
    onRestore:(copy,retained=false,owned)=>{
      const token=++generation.current,controller=new AbortController();let original:DraftHandle|null=owned??null;request.current?.abort();request.current=controller;validating.current=true;setUnavailable(false);setRestoring(true);
      // A Ticket read cannot authorize decrypted Session identities. Hold UI and submit until these current reads finish.
      void(async()=>{
        if(!retained){const stored=await openDraft(scope);if(stored.text!==serialise(copy)||Boolean(copy.pending)!==Boolean(stored.handle.operation)||copy.pending&&copy.pending.command.client_command_id!==stored.handle.operation?.commandId)throw new DraftError('DRAFT_CHANGED');original={...stored.handle};}
        if(!copy.pending&&!actions.current.some(action=>['take-and-start-with-conversations','accept-for-later-with-conversations'].includes(action)))throw new DraftError('DRAFT_ACTION_REVOKED');
        for(const row of copy.value.sessions)await api.readConversation(row.session_id,controller.signal);
        const remaining=new Set(copy.value.sessions.map(row=>row.session_id));let cursor:string|null=null;
        while(remaining.size){const page=await api.relatedConversations(ticketId,cursor,controller.signal);for(const row of page.items)remaining.delete(row.session_id);if(!page.next_cursor){if(remaining.size)throw new DraftError('DRAFT_RELATION_CHANGED');break;}if(page.next_cursor===cursor)throw new DraftError('DRAFT_RELATION_CHANGED');cursor=page.next_cursor;}
        if(!retained){const current=await openDraft(scope);
        if(current.text!==serialise(copy)||Boolean(copy.pending)!==Boolean(current.handle.operation)||copy.pending&&copy.pending.command.client_command_id!==current.handle.operation?.commandId)throw new DraftError('DRAFT_CHANGED');}
        if(controller.signal.aborted||token!==generation.current)return;
        onRestore({schema:1,...copy.value,pending:copy.pending});validating.current=false;setRestoring(false);request.current=null;
      })().catch(error=>{if(controller.signal.aborted||token!==generation.current)return;validating.current=false;request.current=null;setRestoring(false);if(error instanceof ApiError&&error.status===401){void clearSessionAuthorization(client,scope.principal,401,'revoked');return;}if(error instanceof ApiError&&[403,404].includes(error.status)||error instanceof DraftError&&['DRAFT_ACTION_REVOKED','DRAFT_RELATION_CHANGED'].includes(error.message)){if(retained){draft.forgetRetainedInput();onSensitiveClear();}void removeOwnedSensitiveDraft(original).catch(()=>{});return;}setUnavailable(true);});
    },onSensitiveClear:clear,onOperation:()=>{onOperation();},
  });
  useEffect(()=>{if(!validating.current&&['ready','saved','failed','disabled'].includes(draft.status))setRestoring(false);},[draft.status]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  return {...draft,restoring,restorationBlocked:unavailable,message:unavailable?(draft.hasRetainedInput()?'本页输入未保存，请先留在此页并自行留存可见内容，再重新核对。':'草稿暂未恢复：本机内容暂时读不到，请重新打开详情或刷新页面后再试。'):restoring?'正在核对恢复选择的会话授权…':draft.message,canSubmit:draft.canSubmit&&!restoring&&!unavailable&&draft.status!=='loading',safeToLeave:draft.safeToLeave&&!restoring&&!unavailable,settle:(commandId:string)=>draft.success(commandId)};
}
