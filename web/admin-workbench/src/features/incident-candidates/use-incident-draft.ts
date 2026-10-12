import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {DraftError,purgeDrafts} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {candidateApi,incidentApi,incidentActions,candidateReasons,incidentScopes,decodeIncidentOperation,decodeIncidentReportItem,decodeIncidentSubscriptionItem,incidentRoleAllowed} from './client';
import type {IncidentAction,IncidentOperation,IncidentReportItem,IncidentSubscriptionItem} from './client';

export interface IncidentDraftValue {action:IncidentAction|'';reason:string;capturedVersion:string|null;scope:string;primary:string;source:string;report:IncidentReportItem|null;subscription:IncidentSubscriptionItem|null;direct:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function identity(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function member(value:unknown,allowed:readonly string[]){if(typeof value!=='string'||value!==''&&!allowed.includes(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new DraftError('DRAFT_CORRUPT');}
function decode(text:string,incidentId:string){
  const row=object(JSON.parse(text));exact(row,['schema','value','pending']);if(row.schema!==1)throw new DraftError('DRAFT_CORRUPT');const input=object(row.value);exact(input,['action','reason','capturedVersion','scope','primary','source','report','subscription',...(Object.hasOwn(input,'direct')?['direct']:[])]);
  const action=member(input.action,incidentActions) as IncidentAction|'';
  let capturedVersion:string|null=null;if(input.capturedVersion!==null){if(typeof input.capturedVersion!=='string'||!/^[1-9][0-9]{0,18}$/u.test(input.capturedVersion)||BigInt(input.capturedVersion)>9223372036854775807n)throw new DraftError('DRAFT_CORRUPT');capturedVersion=input.capturedVersion;}
  const value:IncidentDraftValue={action,reason:member(input.reason,candidateReasons),capturedVersion,scope:member(input.scope,incidentScopes),primary:input.primary===''||input.primary==='NONE'?input.primary:identity(input.primary),source:input.source===''?'':identity(input.source),report:input.report===null?null:decodeIncidentReportItem(input.report),subscription:input.subscription===null?null:decodeIncidentSubscriptionItem(input.subscription),direct:input.direct===undefined||input.direct===''?'':identity(input.direct)};
  const pending=row.pending===null?null:decodeIncidentOperation(row.pending);
  if(pending&&(pending.incidentId!==incidentId||pending.action!==value.action||pending.body.reason_code!==value.reason||pending.body.expected_row_version!==value.capturedVersion))throw new DraftError('DRAFT_CORRUPT');
  if(pending?.action==='CORRECT_SCOPE'&&pending.body.confirmed_scope!==value.scope||pending?.action==='SET_PRIMARY_TICKET'&&pending.body.primary_ticket_id!==(value.primary==='NONE'?null:value.primary)||pending?.action==='LINK_REPORT'&&pending.body.source_decision_id!==value.source)throw new DraftError('DRAFT_CORRUPT');
  if(pending&&(pending.action==='UNLINK_REPORT'||pending.action==='MARK_REPORTER_RECOVERED')&&(pending.reportId!==value.report?.id||pending.body.expected_report_version!==value.report.row_version))throw new DraftError('DRAFT_CORRUPT');
  if(pending&&(pending.action==='PAUSE_SUBSCRIPTION'||pending.action==='RESUME_SUBSCRIPTION')&&(pending.subscriptionId!==value.subscription?.id||pending.body.expected_subscription_version!==value.subscription.row_version))throw new DraftError('DRAFT_CORRUPT');
  if(pending?.action==='RESUME_SUBSCRIPTION'&&(pending.body.direct_channel_leg_id??'')!==value.direct)throw new DraftError('DRAFT_CORRUPT');
  return {value,pending};
}
export function useIncidentDraft({principal,incidentId,value,pending,emptyValue,onRestore,onOperation,onSensitiveClear}:{principal:Principal;incidentId:string;value:IncidentDraftValue;pending:IncidentOperation|null;emptyValue:IncidentDraftValue;onRestore:(copy:{value:IncidentDraftValue;pending:IncidentOperation|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),[restoring,setRestoring]=useState(false),[authorityNotice,setAuthorityNotice]=useState(''),scope={principal:principal.principal_id,kind:'incident' as const,id:incidentId,purpose:'incident-followup'},stage=useRef<'session'|'incident'>('session');
  const restoreRequest=useRef<AbortController|null>(null),revocation=useRef(0);
  const revoke=(error:unknown)=>{
    if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,scope.principal,401,'revoked');
    else if(error instanceof ApiError&&[403,404].includes(error.status)||error instanceof DraftError&&['DRAFT_DISABLED','DRAFT_ACTION_REVOKED'].includes(error.message)||error instanceof DOMException&&error.name==='AbortError'&&error.message==='AUTHORIZATION_EPOCH_CHANGED'){revocation.current++;restoreRequest.current?.abort();restoreRequest.current=null;setRestoring(false);onSensitiveClear();setAuthorityNotice('当前用途权限已变化，恢复内容停止展示。');void purgeDrafts({...scope,reason:'revoked'}).catch(()=>{setAuthorityNotice('恢复副本清理尚未确认；当前内容已停止展示，禁止新提交。');});}
  };
  async function authorize(signal:AbortSignal,copy?:{value:IncidentDraftValue;pending:IncidentOperation|null}){
    const epoch=captureWorkbenchRead(signal),revision=revocation.current,requireCurrent=()=>{epoch();if(revocation.current!==revision)throw new DraftError('DRAFT_ACTION_REVOKED');};stage.current='session';const fresh=await api.bootstrap(signal);requireCurrent();
    if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');if(!fresh.incident_candidate_workspace_enabled||!fresh.incident_candidate_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');
    client.setQueryData(['session'],fresh);stage.current='incident';const current=await candidateApi.incident(incidentId,signal);requireCurrent();client.setQueryData(['incident-result',scope.principal,incidentId,'standalone'],current);
    const action=copy?.pending?.action||copy?.value.action;
    if(action&&(!incidentRoleAllowed(action,fresh.roles)||!incidentRoleAllowed(action,current.roles)))throw new DraftError('DRAFT_ACTION_REVOKED');
    if(action==='MARK_REPORTER_RECOVERED'&&!fresh.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')){
      const target=copy?.value.report?.ticket_id;if(!target||await incidentApi.ticketAssignee(target,signal)!==fresh.principal_id)throw new DraftError('DRAFT_ACTION_REVOKED');requireCurrent();
    }
    return fresh.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role))&&current.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role));
  }
  useEffect(()=>()=>{restoreRequest.current?.abort();restoreRequest.current=null;},[incidentId,principal.principal_id]);
  const draft=useAuthorizedDraft<IncidentDraftValue,IncidentOperation>({scope,enabled:principal.incident_candidate_draft_recovery_enabled,value,pending,emptyValue,hasInput:value=>Boolean(value.action||value.reason||value.capturedVersion),serialise:copy=>JSON.stringify({schema:1,...copy}),decode:text=>decode(text,incidentId),commandId:command=>command.body.client_command_id,authorize,onAuthorityFailure:revoke,
    onRestore:copy=>{const controller=new AbortController();restoreRequest.current?.abort();restoreRequest.current=controller;setRestoring(true);void authorize(controller.signal,copy).then(allowed=>{controller.signal.throwIfAborted();if(restoreRequest.current!==controller)return;if(!allowed)throw new DraftError('DRAFT_ACTION_REVOKED');onRestore(copy);}).catch(error=>{if(!controller.signal.aborted&&restoreRequest.current===controller)revoke(error);}).finally(()=>{if(restoreRequest.current===controller){restoreRequest.current=null;setRestoring(false);}});},
    onOperation,onSensitiveClear:()=>{restoreRequest.current?.abort();restoreRequest.current=null;setRestoring(false);onSensitiveClear();}});
  return {...draft,restoring,revoke,canSubmit:draft.canSubmit&&!authorityNotice,message:authorityNotice||(restoring?'正在核对恢复操作的当前权限和目标…':draft.message)};
}
