import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
/** SOURCE contract only. No handler or permission implementation is supplied here. */
export type IncidentDeliveryPermission='INCIDENT_DELIVERY_RETRY'|'INCIDENT_DELIVERY_RECONCILE';
export interface IncidentDeliveryControlPermissionPort {
  hasPermission(input:{principal_id:string;incident_id:string;permission:IncidentDeliveryPermission;transaction:PostgresTransaction}):Promise<boolean>;
}
export type IncidentDeliveryStatus='PENDING'|'LEASED'|'SENDING'|'SENT'|'RECONCILIATION_REQUIRED'|'DEAD_LETTER'|'CANCELLED';
export type IncidentDeliverySideEffect='NOT_ATTEMPTED'|'ACKNOWLEDGED'|'UNKNOWN';
export interface IncidentDeliveryRetryCommand {
  client_command_id:string;expected_incident_version:string;expected_status:'PENDING'|'DEAD_LETTER';
  expected_side_effect_state:'NOT_ATTEMPTED';reason_code:string;
}
export interface IncidentDeliveryReconcileCommand {
  client_command_id:string;expected_incident_version:string;expected_status:'RECONCILIATION_REQUIRED';
  expected_side_effect_state:'UNKNOWN';reason_code:string;
  resolution:'CONFIRMED_SENT'|'CONFIRMED_NOT_SENT_REQUEUE'|'CANCEL';
}
export interface IncidentDeliveryControlResult {
  ok:true;incident_id:string;delivery_id:string;client_command_id:string;status:IncidentDeliveryStatus;
  side_effect_state:IncidentDeliverySideEffect;attempt_count:number;replayed:boolean;
}
export interface IncidentDeliveryCapability {
  incident_id:string;delivery_id:string;purpose:'INCIDENT_LIFECYCLE'|'INCIDENT_PUBLIC_PROGRESS';
  retry:boolean;reconcile:boolean;receipt_read:boolean;disabled:boolean;
}
export type IncidentDeliveryReceipt =
  |{state:'UNKNOWN';incident_id:string;client_command_id:string}
  |{state:'COMMITTED';incident_id:string;client_command_id:string;result:IncidentDeliveryControlResult}
  |{state:'FAILED';incident_id:string;client_command_id:string;error:{code:string;retryable:boolean}};

