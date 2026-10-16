import {ApiError,UnknownCommandOutcome,captureWorkbenchRead,workbenchTransportWritable} from '../../api/client';
import {decodeManualSelfHandlingContext,decodeManualSelfHandlingResult} from '../../../../../src/workbench-manual-self-handling-browser-contracts.mjs';
import type {ManualReportSelfHandlingCommand} from '../../../../../src/workbench-manual-self-handling-browser-contracts.mjs';
export class ConfirmedManualSelfHandlingFailure extends ApiError{}
export const manualSelfHandlingApi={
  async context(signal:AbortSignal,team?:string){
    const current=captureWorkbenchRead(signal),response=await fetch('/api/workbench/reports/self-handling-context'+(team?'?'+new URLSearchParams({resolver_team_id:team}):''),{signal,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json'}});current();
    if(!response.ok)throw new ApiError(response.status,'MANUAL_SELF_HANDLING_UNAVAILABLE');
    try{const body:unknown=await response.json();current();return decodeManualSelfHandlingContext(body);}catch(error){current();if(error instanceof ApiError)throw error;throw new ApiError(502,'INVALID_RESPONSE');}
  },
  async submit(command:ManualReportSelfHandlingCommand,csrf:string|null,signal:AbortSignal){
    if(!workbenchTransportWritable())throw new ApiError(409,'WORKBENCH_REVALIDATION_REQUIRED');
    const current=captureWorkbenchRead(signal),response=await fetch('/api/workbench/reports/take-and-start',{method:'POST',signal,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(command)});current();
    if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');
    if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
    const body:unknown=await response.json();current();
    if(!response.ok){
      if(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===3&&'ok' in body&&body.ok===false&&'replayed' in body&&typeof body.replayed==='boolean'&&'error' in body&&body.error&&typeof body.error==='object'&&!Array.isArray(body.error)){
        const error=body.error;if(Object.keys(error).length===2&&'code' in error&&typeof error.code==='string'&&/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(error.code)&&'retryable' in error&&error.retryable===false)throw new ConfirmedManualSelfHandlingFailure(response.status,error.code);
      }
      throw new UnknownCommandOutcome();
    }
    try{return decodeManualSelfHandlingResult(body,command.client_command_id);}catch{throw new UnknownCommandOutcome();}
  },
};
