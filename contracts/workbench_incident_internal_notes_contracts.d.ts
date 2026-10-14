import type {LocalDateTime} from './time_contracts.js';
import type {AuthContext,IncidentCommandResult} from './p2_012_contracts.js';
import type {IncidentFollowupReceipt} from './workbench_incident_followup_contracts.js';

/** WBINT-T30 frozen candidate contract. PROPOSED_NOT_MOUNTED; not runtime evidence. */
export interface IncidentInternalNoteHostOptions {incidentInternalNotesEnabled?:boolean}
export interface IncidentInternalNoteInput {
  readonly client_command_id:string;
  readonly expected_row_version:string;
  readonly reason_code:'WORKBENCH_INTERNAL_DISPOSITION';
  readonly audience:'INTERNAL';
  readonly text:string;
}
export type IncidentInternalNoteCommand=IncidentInternalNoteInput & {
  readonly action:'ADD_INTERNAL_NOTE';
  readonly incident_id:string;
};
export type IncidentInternalNoteResult=
  (IncidentCommandResult & {readonly result_ref_type:'INCIDENT'}) |
  {readonly ok:false;readonly error:{readonly code:string;readonly retryable:false};readonly replayed:boolean};
/** Authorized internal projection of the same append-only Incident event, not another note ledger. */
export interface IncidentInternalNoteRecord {
  readonly id:string;
  readonly incident_id:string;
  readonly event_ordinal:string;
  readonly incident_row_version:string;
  readonly actor_principal_id:string;
  readonly actor_display_name:string|null;
  readonly occurred_at:LocalDateTime;
  readonly audience:'INTERNAL';
  readonly text:string;
}
export interface IncidentInternalNotePage {
  readonly incident_id:string;
  readonly items:ReadonlyArray<IncidentInternalNoteRecord>;
  readonly next_cursor:string|null;
}
export interface IncidentInternalNoteCommandPort {
  perform(input:{authContext:AuthContext;command:IncidentInternalNoteCommand}):Promise<IncidentInternalNoteResult>;
}
export interface IncidentInternalNoteQueryPort {
  internalNotes(input:{authContext:AuthContext;incidentId:string;cursor?:string|null;limit?:number}):Promise<IncidentInternalNotePage>;
  incidentCommandReceipt(input:{authContext:AuthContext;id:string;commandId:string}):Promise<IncidentFollowupReceipt>;
}
