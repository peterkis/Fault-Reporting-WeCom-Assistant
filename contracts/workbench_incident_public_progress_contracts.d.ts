import type {LocalDateTime} from './time_contracts.js';
import type {AuthContext,IncidentCommandResult} from './p2_012_contracts.js';
import type {IncidentFollowupReceipt} from './workbench_incident_followup_contracts.js';

/** T31 frozen SOURCE contract; PROPOSED_NOT_MOUNTED until real validation. */
export interface IncidentPublicProgressHostOptions {incidentPublicProgressEnabled?:boolean}
export interface IncidentPublicProgressInput {
  readonly client_command_id:string;
  readonly expected_row_version:string;
  readonly reason_code:'WORKBENCH_PUBLIC_PROGRESS';
  readonly summary:string;
  readonly preview_confirmed:true;
}
export type IncidentPublicProgressCommand=IncidentPublicProgressInput & {readonly action:'PUBLISH_PUBLIC_PROGRESS';readonly incident_id:string};
export interface IncidentPublicProgressRecord {
  readonly id:string;readonly incident_id:string;readonly event_ordinal:string;
  readonly incident_row_version:string;readonly actor_principal_id:string;
  readonly actor_display_name:string|null;readonly occurred_at:LocalDateTime;readonly summary:string;
}
export interface IncidentPublicProgressPage {readonly incident_id:string;readonly items:ReadonlyArray<IncidentPublicProgressRecord>;readonly next_cursor:string|null}
export interface IncidentPublicProgressDelivery {
  readonly id:string;readonly route:'BOT_DIRECT';readonly audience:'REPORTER_DIRECT';
  readonly status:'PENDING'|'LEASED'|'SENDING'|'SENT'|'RECONCILIATION_REQUIRED'|'DEAD_LETTER'|'CANCELLED';
  readonly attempt_count:number;readonly side_effect_state:'NOT_ATTEMPTED'|'ACKNOWLEDGED'|'UNKNOWN';
  readonly last_error_code:string|null;readonly sent_at:LocalDateTime|null;
}
export interface IncidentPublicProgressDeliveryPage {readonly incident_id:string;readonly publication_id:string;readonly items:ReadonlyArray<IncidentPublicProgressDelivery>;readonly next_cursor:string|null}
export interface IncidentPublicProgressCommandPort {perform(input:{authContext:AuthContext;command:IncidentPublicProgressCommand}):Promise<IncidentCommandResult>}
export interface IncidentPublicProgressQueryPort {
  publicProgress(input:{authContext:AuthContext;incidentId:string;cursor?:string|null;limit?:number}):Promise<IncidentPublicProgressPage>;
  publicProgressDeliveries(input:{authContext:AuthContext;incidentId:string;publicationId:string;cursor?:string|null;limit?:number}):Promise<IncidentPublicProgressDeliveryPage>;
  incidentCommandReceipt(input:{authContext:AuthContext;id:string;commandId:string}):Promise<IncidentFollowupReceipt>;
}
