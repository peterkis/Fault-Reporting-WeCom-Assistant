import {ApiError,UnknownCommandOutcome,captureWorkbenchRead} from '../../api/client';
import {candidateReasons,IncidentCommandRefusal} from './client';
import type {IncidentOwnerTransferHttpBody,IncidentOwnerTransferTargetPage} from '../../../../../contracts/workbench_incident_owner_transfer_contracts';

export interface OwnerTransferOperation {incidentId:string;body:IncidentOwnerTransferHttpBody}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/iu;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new ApiError(502,'INVALID_RESPONSE');}
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(502,'INVALID_RESPONSE');return value;}
function version(value:unknown){if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/u.test(value)||BigInt(value)>9223372036854775807n)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function name(value:unknown){if(typeof value!=='string'||[...value].length>200)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function team(value:unknown){if(typeof value!=='string'||!/^[A-Z0-9_]{1,64}$/u.test(value))throw new ApiError(502,'INVALID_RESPONSE');return value;}
export function decodeOwnerTransferOperation(value:unknown,incidentId:string):OwnerTransferOperation{
  const operation=object(value);exact(operation,['incidentId','body']);if(id(operation.incidentId)!==incidentId)throw new ApiError(502,'INVALID_RESPONSE');
  const body=object(operation.body);exact(body,['client_command_id','expected_row_version','reason_code','owner_principal_id','owner_team_id']);
  const reason=candidateReasons.find(code=>code===body.reason_code);if(!reason)throw new ApiError(502,'INVALID_RESPONSE');
  return {incidentId,body:{client_command_id:id(body.client_command_id),expected_row_version:version(body.expected_row_version),reason_code:reason,owner_principal_id:id(body.owner_principal_id),owner_team_id:body.owner_team_id===null?null:team(body.owner_team_id)}};
}
function targets(value:unknown):IncidentOwnerTransferTargetPage{
  const page=object(value);exact(page,['items','next_cursor']);if(!Array.isArray(page.items)||page.items.length>100||page.next_cursor!==null&&(typeof page.next_cursor!=='string'||page.next_cursor.length>2048))throw new ApiError(502,'INVALID_RESPONSE');
  const items=page.items.map(value=>{const item=object(value);exact(item,['id','display_name','teams','teams_truncated']);if(!Array.isArray(item.teams)||item.teams.length>20||typeof item.teams_truncated!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');
    const teams=item.teams.map(value=>{const entry=object(value);exact(entry,['team_id','display_name']);return {team_id:team(entry.team_id),display_name:name(entry.display_name)};});if(new Set(teams.map(entry=>entry.team_id)).size!==teams.length)throw new ApiError(502,'INVALID_RESPONSE');
    return {id:id(item.id),display_name:name(item.display_name),teams,teams_truncated:item.teams_truncated};});
  if(new Set(items.map(item=>item.id)).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');return {items,next_cursor:page.next_cursor as string|null};
}
export const ownerTransferApi={
  async targets(incidentId:string,cursor:string|null,signal:AbortSignal){const current=captureWorkbenchRead(signal);try{const response=await fetch('/api/incidents/'+id(incidentId)+'/owner-transfer-targets?'+new URLSearchParams({limit:'30',...(cursor?{cursor}:{})}),{signal,credentials:'same-origin',redirect:'error',cache:'no-store'});current();if(!response.ok)throw new ApiError(response.status,[401,403,404].includes(response.status)?'AUTHORIZATION_REJECTED':'OWNER_TARGET_READ_FAILED');const value:unknown=await response.json();current();return targets(value);}catch(error){current();throw error;}},
  async perform(operation:OwnerTransferOperation,csrf:string|null,signal:AbortSignal){const original=decodeOwnerTransferOperation(operation,operation.incidentId),current=captureWorkbenchRead(signal);current();try{
    const response=await fetch('/api/incidents/'+original.incidentId+'/transfer-owner',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'content-type':'application/json','idempotency-key':original.body.client_command_id,'if-match':'"'+original.body.expected_row_version+'"',...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(original.body)});current();if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');const result=object(await response.json());current();
    if(!response.ok){const error=object(result.error);exact(result,['ok','error','replayed']);exact(error,['code','retryable']);if(result.ok!==false||typeof result.replayed!=='boolean'||error.retryable!==false||typeof error.code!=='string'||!/^P2_012_[A-Z_]+$/u.test(error.code))throw new UnknownCommandOutcome();throw new IncidentCommandRefusal(response.status,error.code);}
    exact(result,['ok','result_ref_type','result_ref_id','result_row_version','result_event_id','replayed']);if(response.status!==200||result.ok!==true||result.result_ref_type!=='INCIDENT'||id(result.result_ref_id)!==original.incidentId||version(result.result_row_version)!==(BigInt(original.body.expected_row_version)+1n).toString()||typeof result.replayed!=='boolean')throw new UnknownCommandOutcome();id(result.result_event_id);
  }catch(error){if(error instanceof IncidentCommandRefusal||error instanceof ApiError&&[401,403,404].includes(error.status))throw error;throw new UnknownCommandOutcome();}}
};
