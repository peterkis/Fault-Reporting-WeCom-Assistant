import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError,purgeDrafts,matchesDraft,subscribeDrafts} from '../drafts/encrypted-drafts';
import type {DraftInvalidation} from '../drafts/encrypted-drafts';
import {MANUAL_REPORT_DRAFT_ID,emptyManualReportInput,hasManualReportInput} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportInput} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import {MANUAL_SELF_HANDLING_PURPOSE,encodeManualSelfHandlingDraft,decodeManualSelfHandlingDraft} from '../../contracts/workbench-manual-self-handling-browser-contracts.mjs';
import type {ManualReportSelfHandlingCommand,ManualSelfHandlingCopy} from '../../contracts/workbench-manual-self-handling-browser-contracts.mjs';
import {manualSelfHandlingApi} from './self-handling-client';
export const manualSelfHandlingContextKey=(principal:string)=>['manual-report-self-handling-context',principal] as const;
export function useManualSelfHandlingDraft({principal,value,team,pending,onRestore,onOperation,onSensitiveClear}:{principal:Principal;value:ManualReportInput;team:string;pending:ManualReportSelfHandlingCommand|null;onRestore:(copy:ManualSelfHandlingCopy)=>void;onOperation:(id:string)=>void;onSensitiveClear:(settled?:boolean)=>void}){
  const client=useQueryClient(),scope={principal:principal.principal_id,kind:'intake' as const,id:MANUAL_REPORT_DRAFT_ID,purpose:MANUAL_SELF_HANDLING_PURPOSE};
  const [restoring,setRestoring]=useState(principal.manual_report_draft_recovery_enabled),[unavailable,setUnavailable]=useState(false),request=useRef<AbortController|null>(null),epoch=useRef(0),revoked=useRef(false),validating=useRef(false);
  const clearing=useRef<DraftInvalidation['reason']|null>(null);
  useEffect(()=>{
    if(!principal.manual_report_draft_recovery_enabled)return;
    try{return subscribeDrafts(notice=>{if(!matchesDraft(notice,scope))return;clearing.current=notice.reason;queueMicrotask(()=>{clearing.current=null;});});}catch{setUnavailable(true);}
  },[principal.principal_id,principal.manual_report_draft_recovery_enabled]);
  useEffect(()=>{if(hasManualReportInput(value)||team)revoked.current=false;},[value,team]);
  const revoke=async()=>{if(revoked.current)return;revoked.current=true;epoch.current++;request.current?.abort();request.current=null;validating.current=false;setRestoring(false);onSensitiveClear();
    try{await purgeDrafts({...scope,reason:'revoked'},{preserveOperations:true});}catch(error){revoked.current=false;setUnavailable(true);throw error;}};
  const draft=useAuthorizedDraft<{input:ManualReportInput;team:string},ManualReportSelfHandlingCommand>({
    scope,enabled:principal.manual_report_draft_recovery_enabled&&principal.manual_reports_enabled&&principal.ticket_self_handling_enabled,
    value:{input:value,team},pending,emptyValue:{input:emptyManualReportInput(),team:''},hasInput:copy=>hasManualReportInput(copy.input)||Boolean(copy.team),
    serialise:copy=>encodeManualSelfHandlingDraft({value:copy.value.input,team:copy.value.team,pending:copy.pending}),
    decode:text=>{try{const copy=decodeManualSelfHandlingDraft(text);return {value:{input:copy.value,team:copy.team},pending:copy.pending};}catch{throw new DraftError('DRAFT_CORRUPT');}},commandId:command=>command.client_command_id,
    authorize:async(signal,copy)=>{
      const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);
      if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      if(!fresh.manual_reports_enabled||!fresh.ticket_self_handling_enabled||!fresh.manual_report_draft_recovery_enabled)return false;
      const capabilities=await api.manualReportCapabilities(signal);if(!capabilities.can_create||!capabilities.draft_recovery_enabled)return false;
      if(!copy)return true;
      const context=await manualSelfHandlingApi.context(signal,copy.value.team||undefined);
      if(copy?.value.team&&!context.resolver_teams.some(t=>t.id===copy.value.team))return false;
      return context.can_take_and_start&&context.draft_recovery_enabled;
    },onAuthorityFailure:error=>{
      if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,scope.principal,401,'revoked');
      else if(error instanceof ApiError&&[403,404].includes(error.status)||error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED')void revoke().catch(()=>{});
      else{setUnavailable(true);setRestoring(false);}
    },onRestore:copy=>{
      const controller=new AbortController(),token=++epoch.current,current=captureWorkbenchRead(controller.signal);request.current?.abort();request.current=controller;validating.current=true;setRestoring(true);
      void(async()=>{
        const context=await manualSelfHandlingApi.context(controller.signal,copy.value.team||undefined);current();
        if(copy.value.team&&!context.resolver_teams.some(t=>t.id===copy.value.team))throw new DraftError('DRAFT_ACTION_REVOKED');
        if(controller.signal.aborted||token!==epoch.current)return;
        onRestore({value:copy.value.input,team:copy.value.team,pending:copy.pending});validating.current=false;request.current=null;setRestoring(false);setUnavailable(false);
      })().catch(error=>{if(controller.signal.aborted||token!==epoch.current)return;validating.current=false;request.current=null;setRestoring(false);
        if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,scope.principal,401,'revoked');
        else if(error instanceof ApiError&&[403,404].includes(error.status)||error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED')void revoke().catch(()=>{});
        else setUnavailable(true);
      });
    },onOperation,onSensitiveClear:()=>{const settled=clearing.current==='settled';if(!settled){epoch.current++;request.current?.abort();request.current=null;validating.current=false;setRestoring(false);}onSensitiveClear(settled);}});
  useEffect(()=>{if(!validating.current&&['ready','saved','failed','disabled'].includes(draft.status))setRestoring(false);},[draft.status]);
  useEffect(()=>()=>{epoch.current++;request.current?.abort();},[]);
  return {...draft,revoke,restoring,canSubmit:draft.canSubmit&&!restoring&&!unavailable,safeToLeave:draft.safeToLeave&&!restoring&&!unavailable,
    message:unavailable?'恢复核验暂未完成，原副本保留；请重新读取页面，不会发送新操作。':restoring?'正在核对原输入及本人当前处理组…':draft.message};
}
