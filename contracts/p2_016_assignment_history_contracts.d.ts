import type {LocalDateTime} from './time_contracts.js';

/** WBINT-T13 frozen SOURCE proposal. Query/HTTP/UI NOT_MOUNTED; every runtime NOT_RUN. */
export type P2016AssignmentHistoryName =
  | Readonly<{state:'KNOWN';name:string}>
  | Readonly<{state:'NONE'}>
  | Readonly<{state:'UNKNOWN'}>;
export type P2016AssignmentHistoryResponsibility = Readonly<{
  person:P2016AssignmentHistoryName;team:P2016AssignmentHistoryName;
}>;
export type P2016AssignmentHistoryCycle =
  | Readonly<{state:'KNOWN';cycle_no:number}>
  | Readonly<{state:'UNKNOWN'}>;
export type P2016AssignmentHistoryCommunication = Readonly<{
  session_id:string;control_event_id:string;occurred_at:LocalDateTime;
  actor:P2016AssignmentHistoryName;previous:P2016AssignmentHistoryName;next:P2016AssignmentHistoryName;
}>;
export type P2016AssignmentHistoryItem = Readonly<{
  ticket_event_id:string;event_ordinal:number;
  kind:'FIRST_RESPONSIBILITY'|'RESPONSIBILITY_CHANGE';occurred_at:LocalDateTime;
  actor:P2016AssignmentHistoryName;handling_cycle:P2016AssignmentHistoryCycle;
  previous:P2016AssignmentHistoryResponsibility;next:P2016AssignmentHistoryResponsibility;
  /** True only when the event's operator is an internal principal and that same principal is the proven new person; computed by
   * principal id on the server, never from display names (two accounts may share a name). */
  actor_is_next:boolean;
  /** True only when the operator is an internal principal and that same principal is the proven previous person (by principal id). */
  actor_was_previous:boolean;
  /** Only actual changed Control facts independently readable now; empty never means all Sessions absent. */
  communication:ReadonlyArray<P2016AssignmentHistoryCommunication>;
}>;
export type P2016AssignmentHistoryPage = Readonly<{
  schema_version:1;ticket_id:string;initial_basis:'RECORDED'|'UNKNOWN';
  items:ReadonlyArray<P2016AssignmentHistoryItem>;next_cursor:string|null;
}>;
/** Additive read interface at the existing Ticket Query seam; no second fact owner. */
export interface P2016AssignmentHistoryQueryPort {
  assignmentHistory(input:Readonly<{
    authContext:unknown;ticketId:string;cursor?:string|null;limit?:number;
  }>):Promise<P2016AssignmentHistoryPage>;
}

