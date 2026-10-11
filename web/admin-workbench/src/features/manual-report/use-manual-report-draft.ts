import {useEffect,useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal} from '../../api/client';
import type {ManualReportAdmissionCommand} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import {MANUAL_REPORT_DRAFT_ID,emptyManualReportInput,hasManualReportInput,encodeManualReportDraft,decodeManualReportDraft} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportInput} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError,purgeDrafts} from '../drafts/encrypted-drafts';
import {clearSessionAuthorization} from '../../app/authorization';
import type {QueryClient} from '@tanstack/react-query';
export const manualReportCapabilitiesKey=(principal:string)=>['manual-report-capabilities',principal] as const;
export async function clearManualReportAuthority(client:QueryClient,principal:string,error:ApiError){
  const key=manualReportCapabilitiesKey(principal);await client.cancelQueries({queryKey:key},{revert:false});
  for(const query of client.getQueryCache().findAll({queryKey:key}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>mutation.options.mutationKey?.[0]==='manual-report-command'&&mutation.options.mutationKey?.[1]===principal}))client.getMutationCache().remove(mutation);
  await purgeDrafts({principal,kind:'intake',id:MANUAL_REPORT_DRAFT_ID,purpose:'manual-report',reason:'revoked'}).catch(()=>{});
}
export function useManualReportAuthority(principal:Principal|undefined){
  const client=useQueryClient(),context=useQuery({queryKey:manualReportCapabilitiesKey(principal?.principal_id??''),queryFn:({signal})=>api.manualReportCapabilities(signal),enabled:principal?.manual_reports_enabled??false});
  useEffect(()=>{
    if(!principal||!(context.error instanceof ApiError))return;
    if(context.error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
    else if([403,404].includes(context.error.status))void clearManualReportAuthority(client,principal.principal_id,context.error);
  },[client,principal?.principal_id,context.error]);
}
export function useManualReportDraft({principal,value,pending,onRestore,onOperation,onSensitiveClear}:{principal:Principal;value:ManualReportInput;pending:ManualReportAdmissionCommand|null;onRestore:(restored:{value:ManualReportInput;pending:ManualReportAdmissionCommand|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),stage=useRef<'session'|'create'>('session');
  return useAuthorizedDraft<ManualReportInput,ManualReportAdmissionCommand>({scope:{principal:principal.principal_id,kind:'intake',id:MANUAL_REPORT_DRAFT_ID,purpose:'manual-report'},enabled:principal.manual_report_draft_recovery_enabled,
    value,pending,emptyValue:emptyManualReportInput(),hasInput:hasManualReportInput,serialise:v=>encodeManualReportDraft(v.value,v.pending),decode:text=>{try{return decodeManualReportDraft(text);}catch{throw new DraftError('DRAFT_CORRUPT');}},commandId:command=>command.client_command_id,
    authorize:async signal=>{
      stage.current='session';const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);
      if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      if(!fresh.manual_reports_enabled||!fresh.manual_report_draft_recovery_enabled){await clearManualReportAuthority(client,principal.principal_id,new ApiError(403,'MANUAL_REPORT_DISABLED'));return false;}
      stage.current='create';const capabilities=await api.manualReportCapabilities(signal);client.setQueryData(manualReportCapabilitiesKey(principal.principal_id),capabilities);
      if(!capabilities.draft_recovery_enabled){await clearManualReportAuthority(client,principal.principal_id,new ApiError(403,'MANUAL_REPORT_RECOVERY_DISABLED'));return false;}return capabilities.can_create;
    },onAuthorityFailure:error=>{
      if(error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');
      else if(error instanceof ApiError&&[403,404].includes(error.status))void clearManualReportAuthority(client,principal.principal_id,error);
      else if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked','当前账号已变化，请重新读取授权；原输入已停止恢复。');
    },onRestore,onOperation,onSensitiveClear});
}
