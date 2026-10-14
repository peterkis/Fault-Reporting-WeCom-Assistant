import type {IncidentDeliveryCapability,IncidentDeliveryRetryCommand,IncidentDeliveryReconcileCommand,IncidentDeliveryControlResult,IncidentDeliveryReceipt,IncidentDeliveryStatus,IncidentDeliverySideEffect} from '../contracts/workbench_incident_delivery_control_contracts.js';
export type {IncidentDeliveryCapability,IncidentDeliveryControlResult,IncidentDeliveryReceipt,IncidentDeliveryStatus,IncidentDeliverySideEffect};
export type IncidentDeliveryPurpose=IncidentDeliveryCapability['purpose'];
export type IncidentDeliveryCapabilityV2=IncidentDeliveryCapability&{attempt_count:number};
export type IncidentDeliveryResolution=IncidentDeliveryReconcileCommand['resolution'];
export type IncidentDeliveryRetryV2=IncidentDeliveryRetryCommand&{expected_delivery_attempt_count:number};
export type IncidentDeliveryReconcileV2=IncidentDeliveryReconcileCommand&{expected_delivery_attempt_count:number};
export type IncidentDeliveryOperation=
 |{incidentId:string;deliveryId:string;purpose:IncidentDeliveryPurpose;action:'RETRY';body:IncidentDeliveryRetryV2}
 |{incidentId:string;deliveryId:string;purpose:IncidentDeliveryPurpose;action:'RECONCILE';body:IncidentDeliveryReconcileV2};
export interface IncidentDeliveryExpectation {incidentId:string;deliveryId:string;purpose:IncidentDeliveryPurpose}
function invalid():never{throw new TypeError('INCIDENT_DELIVERY_INVALID_RESPONSE');}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const row=value as Record<string,unknown>;
 if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return invalid();return row;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))return invalid();return value;}
export function decodeIncidentDeliveryVersion(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/u.test(value)||BigInt(value)>9223372036854775807n)return invalid();return value;}
export function decodeIncidentDeliveryAttemptCount(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>2147483647)return invalid();return value;}
function boolean(value:unknown):boolean{if(typeof value!=='boolean')return invalid();return value;}
function choice<T extends string>(value:unknown,values:readonly T[]):T{if(typeof value!=='string')return invalid();const selected=values.find(item=>item===value);return selected??invalid();}
const purposes=['INCIDENT_LIFECYCLE','INCIDENT_PUBLIC_PROGRESS'] as const;
const statuses=['PENDING','LEASED','SENDING','SENT','RECONCILIATION_REQUIRED','DEAD_LETTER','CANCELLED'] as const;
const effects=['NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN'] as const;
const resolutions=['CONFIRMED_SENT','CONFIRMED_NOT_SENT_REQUEUE','CANCEL'] as const;
function reason(value:unknown):string{if(typeof value!=='string'||!/^[A-Z0-9_]{1,128}$/u.test(value))return invalid();return value;}
function same(a:string,b:string){return a.toLowerCase()===b.toLowerCase();}
export function decodeIncidentDeliveryOperation(value:unknown,expected?:Partial<IncidentDeliveryExpectation>):IncidentDeliveryOperation{
 const row=closed(value,['incidentId','deliveryId','purpose','action','body']),incidentId=uuid(row.incidentId),deliveryId=uuid(row.deliveryId),purpose=choice(row.purpose,purposes);
 if(expected?.incidentId&&!same(incidentId,expected.incidentId)||expected?.deliveryId&&!same(deliveryId,expected.deliveryId)||expected?.purpose&&purpose!==expected.purpose)return invalid();
 if(row.action==='RETRY'){
  const body=closed(row.body,['client_command_id','expected_row_version','expected_status','expected_side_effect_state','expected_delivery_attempt_count','reason_code']);
  if(body.expected_side_effect_state!=='NOT_ATTEMPTED')return invalid();
  return Object.freeze({incidentId,deliveryId,purpose,action:'RETRY',body:Object.freeze({client_command_id:uuid(body.client_command_id),expected_row_version:decodeIncidentDeliveryVersion(body.expected_row_version),expected_status:choice(body.expected_status,['PENDING','DEAD_LETTER'] as const),expected_side_effect_state:'NOT_ATTEMPTED',expected_delivery_attempt_count:decodeIncidentDeliveryAttemptCount(body.expected_delivery_attempt_count),reason_code:reason(body.reason_code)})});
 }
 if(row.action==='RECONCILE'){
  const body=closed(row.body,['client_command_id','expected_row_version','expected_status','expected_side_effect_state','expected_delivery_attempt_count','reason_code','resolution']);
  if(body.expected_status!=='RECONCILIATION_REQUIRED'||body.expected_side_effect_state!=='UNKNOWN')return invalid();
  return Object.freeze({incidentId,deliveryId,purpose,action:'RECONCILE',body:Object.freeze({client_command_id:uuid(body.client_command_id),expected_row_version:decodeIncidentDeliveryVersion(body.expected_row_version),expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',expected_delivery_attempt_count:decodeIncidentDeliveryAttemptCount(body.expected_delivery_attempt_count),reason_code:reason(body.reason_code),resolution:choice(body.resolution,resolutions)})});
 }
 return invalid();
}
export function decodeIncidentDeliveryCapability(value:unknown,expected:IncidentDeliveryExpectation):IncidentDeliveryCapabilityV2{
 const row=closed(value,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
 const incidentId=uuid(row.incident_id),deliveryId=uuid(row.delivery_id),purpose=choice(row.purpose,purposes),retry=boolean(row.retry),reconcile=boolean(row.reconcile),disabled=boolean(row.disabled);
 if(!same(incidentId,expected.incidentId)||!same(deliveryId,expected.deliveryId)||purpose!==expected.purpose||disabled&&(retry||reconcile))return invalid();
 return {incident_id:incidentId,delivery_id:deliveryId,purpose,retry,reconcile,receipt_read:boolean(row.receipt_read),disabled,attempt_count:decodeIncidentDeliveryAttemptCount(row.attempt_count)};
}
export function decodeIncidentDeliveryResult(value:unknown):IncidentDeliveryControlResult{
 const row=closed(value,['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']);
 if(row.ok!==true||typeof row.attempt_count!=='number'||!Number.isSafeInteger(row.attempt_count)||row.attempt_count<0||row.attempt_count>2147483647)return invalid();
 return {ok:true,incident_id:uuid(row.incident_id),delivery_id:uuid(row.delivery_id),client_command_id:uuid(row.client_command_id),status:choice(row.status,statuses),side_effect_state:choice(row.side_effect_state,effects),attempt_count:row.attempt_count,replayed:boolean(row.replayed)};
}
export function matchesIncidentDeliveryResult(operation:IncidentDeliveryOperation,result:IncidentDeliveryControlResult):boolean{
 if(!same(operation.incidentId,result.incident_id)||!same(operation.deliveryId,result.delivery_id)||!same(operation.body.client_command_id,result.client_command_id))return false;
 if(operation.action==='RETRY')return result.status==='PENDING'&&result.side_effect_state==='NOT_ATTEMPTED';
 if(operation.body.resolution==='CONFIRMED_SENT')return result.status==='SENT'&&result.side_effect_state==='ACKNOWLEDGED';
 if(operation.body.resolution==='CONFIRMED_NOT_SENT_REQUEUE')return result.status==='PENDING'&&result.side_effect_state==='NOT_ATTEMPTED';
 return result.status==='CANCELLED'&&result.side_effect_state==='UNKNOWN';
}
export function decodeIncidentDeliveryReceipt(value:unknown,incidentId:string,commandId:string):IncidentDeliveryReceipt{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const row=value as Record<string,unknown>,parent=uuid(row.incident_id),id=uuid(row.client_command_id);
 if(!same(parent,incidentId)||!same(id,commandId))return invalid();
 const base={incident_id:parent,client_command_id:id};
 if(row.state==='UNKNOWN'){closed(row,['state','incident_id','client_command_id']);return {...base,state:'UNKNOWN'};}
 if(row.state==='COMMITTED'){
  closed(row,['state','incident_id','client_command_id','result']);const result=decodeIncidentDeliveryResult(row.result);
  if(!same(result.incident_id,parent)||!same(result.client_command_id,id))return invalid();
  return {...base,state:'COMMITTED',result};
 }
 if(row.state==='FAILED'){
  closed(row,['state','incident_id','client_command_id','error']);const error=closed(row.error,['code','retryable']);
  if(typeof error.code!=='string'||!/^P2_012_[A-Z0-9_]{1,96}$/u.test(error.code))return invalid();
  return {...base,state:'FAILED',error:{code:error.code,retryable:boolean(error.retryable)}};
 }
 return invalid();
}
