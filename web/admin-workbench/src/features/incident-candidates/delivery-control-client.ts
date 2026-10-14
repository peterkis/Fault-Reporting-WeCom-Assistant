import {ApiError,UnknownCommandOutcome,api,captureWorkbenchRead,readWorkbench} from '../../api/client';
import {candidateApi} from './client';
import {decodeIncidentDeliveryAuthority} from '../../../../../src/workbench-incident-delivery-authority.mjs';
import {decodeIncidentDeliveryOperation,decodeIncidentDeliveryCapability,decodeIncidentDeliveryResult,decodeIncidentDeliveryReceipt,matchesIncidentDeliveryResult} from '../../../../../src/workbench-incident-delivery-browser-contracts.mjs';
import type {IncidentDeliveryExpectation,IncidentDeliveryOperation,IncidentDeliveryPurpose} from '../../../../../src/workbench-incident-delivery-browser-contracts.mjs';

export class IncidentDeliveryCommandRefusal extends ApiError {}
export class IncidentDeliverySessionRejected extends ApiError {}
function decode<T>(run:()=>T):T{try{return run();}catch{throw new ApiError(502,'INVALID_RESPONSE');}}
export async function readIncidentDeliverySession(signal:AbortSignal){
 try{return await api.bootstrap(signal);}catch(error){if(error instanceof ApiError&&error.status===403)throw new IncidentDeliverySessionRejected(error.status,error.code);throw error;}
}
function prefix(incidentId:string,deliveryId:string){return '/api/incidents/'+encodeURIComponent(incidentId)+'/notifications/'+encodeURIComponent(deliveryId);}
function refusal(value:unknown):string|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>,error=row.error;
 if(Object.keys(row).length!==3||row.ok!==false||typeof row.replayed!=='boolean'||!error||typeof error!=='object'||Array.isArray(error))return null;
 const detail=error as Record<string,unknown>;
 if(Object.keys(detail).length!==2||detail.retryable!==false||typeof detail.code!=='string'||!/^P2_012_[A-Z0-9_]{1,96}$/u.test(detail.code))return null;
 return detail.code;
}
export const incidentDeliveryApi={
 control:(expected:IncidentDeliveryExpectation,signal:AbortSignal)=>readWorkbench(prefix(expected.incidentId,expected.deliveryId)+'/control',signal,(value,response)=>decode(()=>{const capability=decodeIncidentDeliveryCapability(value,expected);return {...capability,...decodeIncidentDeliveryAuthority(response.headers,capability)};})),
 receipt:(incidentId:string,commandId:string,signal:AbortSignal)=>readWorkbench('/api/incidents/'+encodeURIComponent(incidentId)+'/notification-commands/'+encodeURIComponent(commandId),signal,value=>decode(()=>decodeIncidentDeliveryReceipt(value,incidentId,commandId))),
 async context(incidentId:string,purpose:IncidentDeliveryPurpose,deliveryId:string|null,signal:AbortSignal){
  const current=captureWorkbenchRead(signal),principal=await readIncidentDeliverySession(signal);current();
  const [incident,capability]=await Promise.all([candidateApi.incident(incidentId,signal),deliveryId?incidentDeliveryApi.control({incidentId,deliveryId,purpose},signal):Promise.resolve(null)]);current();
  return {principal,incident,capability};
 },
 async perform(operation:IncidentDeliveryOperation,csrf:string|null,signal:AbortSignal){
  const original=decode(()=>decodeIncidentDeliveryOperation(operation)),current=captureWorkbenchRead(signal);current();
  try{
   const response=await fetch(prefix(original.incidentId,original.deliveryId)+(original.action==='RETRY'?'/retry':'/reconcile'),{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':original.body.client_command_id,'if-match':'"'+original.body.expected_row_version+'"',...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(original.body)});current();
   if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');
   if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
   const value:unknown=await response.json();current();
   if(!response.ok){const code=response.status>=400&&response.status<500?refusal(value):null;if(code)throw new IncidentDeliveryCommandRefusal(response.status,code);throw new UnknownCommandOutcome();}
   if(response.status!==200)throw new UnknownCommandOutcome();
   const result=decodeIncidentDeliveryResult(value);if(!matchesIncidentDeliveryResult(original,result))throw new UnknownCommandOutcome();return result;
  }catch(error){if(error instanceof IncidentDeliveryCommandRefusal||error instanceof ApiError&&[401,403,404].includes(error.status))throw error;throw new UnknownCommandOutcome();}
 }
};
