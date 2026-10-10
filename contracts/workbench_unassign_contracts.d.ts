import type {LocalDateTime} from './time_contracts.js';
import type {P2016AssignmentAcknowledgement,P2016HandlingCycle} from './p2_016_contracts.js';

/** PLANNED WBINT-T08 contract. No mounted unassign HTTP or validated runtime is claimed. */
export type P2016UnassignSession = Readonly<{session_id:string;expected_row_version:number}>;
export type P2016UnassignCommand = Readonly<{client_command_id:string;expected_version:number;reason_code:string;reason:string}> & (
  Readonly<{communication_choice:'RETAIN_CURRENT';communication_target_principal_id:null;sessions:readonly []}> |
  Readonly<{communication_choice:'TRANSFER_SELECTED';communication_target_principal_id:string;sessions:readonly [P2016UnassignSession,...P2016UnassignSession[]]}>);
export type P2016UnassignResult = Readonly<{
  ok:true;ticket_id:string;ticket_version:number;ticket_event_id:string;control_event_id:null;
  handling_cycle:(P2016HandlingCycle & Readonly<{first_responsibility_event_id:string}>)|null;
  communication_choice:'RETAIN_CURRENT'|'TRANSFER_SELECTED';
  conversations:ReadonlyArray<Readonly<{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}>>;
  replayed:boolean;
}>;
/** Current Ticket read authority and original principal/purpose only; no selected Session or reason. */
export type P2016UnassignAcknowledgement = P2016AssignmentAcknowledgement;
/** Independent bounded internal communication choices; the query grants no later Control write. */
export type P2016UnassignTargets = Readonly<{items:ReadonlyArray<Readonly<{principal_id:string;display_name:string}>>}>;
/** Private append-only fact; ordinary events HTTP retains its existing safe projection. */
export type P2016UnassignEventFact = Readonly<{
  event_id:string;ticket_id:string;event_type:'ticket.unassigned';old_status:'QUEUED'|'ACCEPTED';new_status:'QUEUED';
  aggregate_version:number;event_ordinal:number;operator_type:'PILOT_USER';operator_id:string;
  internal_note:string;external_note:null;reason_code:string;trace_id:string;created_at:LocalDateTime;
  assignment_metadata:Readonly<{old_assignee_id:string;new_assignee_id:null;old_team_id:string;new_team_id:string}>;
}>;
