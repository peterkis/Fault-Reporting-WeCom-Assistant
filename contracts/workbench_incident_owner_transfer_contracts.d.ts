import type {IncidentCommand,IncidentCommandResult} from './p2_012_contracts.js';
import type {LocalDateTime} from './time_contracts.js';

/** T29 frozen SOURCE only: no mounted handler or runtime validation. */
export interface IncidentOwnerTransferHostOptions {
  /** Future explicit purpose seam; default false. Ownership never grants READ. */
  readonly incidentOwnerTransferEnabled?:boolean;
}
export type IncidentOwnerTransferHttpBody={
  readonly client_command_id:string;
  readonly reason_code:IncidentCommand['reason_code'];
  readonly expected_row_version:string;
  readonly owner_principal_id:string;
  /** Required: null deliberately selects no team; no sentinel string. */
  readonly owner_team_id:string|null;
};
export type IncidentOwnerTransferCommand=IncidentOwnerTransferHttpBody & {
  readonly action:'TRANSFER_OWNER';readonly incident_id:string;
};
export type IncidentOwnerTransferResult=Omit<IncidentCommandResult,'result_ref_type'> & {
  readonly result_ref_type:'INCIDENT';
};
export interface IncidentOwnerTransferTarget {
  readonly id:string;readonly display_name:string;
  readonly teams:ReadonlyArray<{readonly team_id:string;readonly display_name:string}>;
  readonly teams_truncated:boolean;
}
export interface IncidentOwnerTransferTargetPage {
  readonly items:ReadonlyArray<IncidentOwnerTransferTarget>;readonly next_cursor:string|null;
}
export interface IncidentOwnerResponsibility {
  readonly owner_principal_id:string;readonly owner_team_id:string|null;
}
/** Broad-only safe history; the original private/public event pages stay independent. */
export interface IncidentOwnerTransferEvent {
  readonly id:string;readonly event_type:'incident.owner.transferred';
  readonly event_ordinal:string;readonly occurred_at:LocalDateTime;
  readonly old_status:null;readonly new_status:null;readonly old_scope:null;readonly new_scope:null;
  readonly actor_principal_id:string;
  readonly owner_transfer:{readonly previous:IncidentOwnerResponsibility;readonly next:IncidentOwnerResponsibility};
}
