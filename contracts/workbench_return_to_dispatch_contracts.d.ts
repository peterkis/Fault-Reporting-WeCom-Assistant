import type {LocalDateTime} from './time_contracts.js';
import type {P2016AssignmentAcknowledgement,P2016HandlingCycle} from './p2_016_contracts.js';

/** WBINT-T09 frozen command; implemented public seams have separately pinned original RED/GREEN evidence. */
export type P2016ReturnSession=Readonly<{session_id:string;expected_row_version:number}>;
export type P2016ReturnToDispatchCommand=Readonly<{
  client_command_id:string;expected_version:number;reason_code:string;reason:string;unfinished_work:string;
}> & (
  Readonly<{communication_choice:'RETAIN_CURRENT';communication_target_principal_id:null;sessions:readonly []}> |
  Readonly<{communication_choice:'TRANSFER_SELECTED';communication_target_principal_id:string;sessions:readonly [P2016ReturnSession,...P2016ReturnSession[]]}>
);
export type P2016ReturnToDispatchResult=Readonly<{
  ok:true;ticket_id:string;ticket_version:number;ticket_event_id:string;control_event_id:null;
  handling_cycle:(P2016HandlingCycle & Readonly<{first_responsibility_event_id:string}>)|null;
  communication_choice:'RETAIN_CURRENT'|'TRANSFER_SELECTED';
  conversations:ReadonlyArray<Readonly<{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}>>;
  replayed:boolean;
}>;
/** W read enabled + current Ticket READ + original actor/resource/purpose. Independent of T09 write/draft flags, excludes selected Sessions/internal text. */
export type P2016ReturnToDispatchAcknowledgement=P2016AssignmentAcknowledgement;
export type P2016ReturnToDispatchTargets=Readonly<{items:ReadonlyArray<Readonly<{principal_id:string;display_name:string}>>}>;
/** Append-only private fact; no new owner or round authority. */
export type P2016ReturnToDispatchEventFact=Readonly<{
  event_id:string;ticket_id:string;event_type:'ticket.returned_to_dispatch';
  old_status:'IN_PROGRESS'|'WAITING_REQUESTER'|'WAITING_VENDOR';new_status:'QUEUED';
  aggregate_version:number;event_ordinal:number;operator_type:'PILOT_USER';operator_id:string;
  internal_note:string;external_note:null;reason_code:string;trace_id:string;created_at:LocalDateTime;
  assignment_metadata:Readonly<{old_assignee_id:string;new_assignee_id:null;old_team_id:string;new_team_id:string}>;
}>;

/** Optional lifecycle bootstrap capability fragment; raw storage never gates safe ACK READ. */
export interface P2016ReturnToDispatchCapability {ticket_return_to_dispatch_enabled:boolean;ticket_return_to_dispatch_draft_recovery_enabled:boolean}
