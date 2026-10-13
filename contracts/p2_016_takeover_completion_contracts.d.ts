/** WBINT-T12 frozen SOURCE candidate. Runtime, UI and every native check NOT_RUN. */
export type P2016TakeoverCompletionSession = Readonly<{session_id:string;expected_row_version:number}>;
export type P2016TakeoverCompletionCommand = Readonly<{
  client_command_id:string;expected_version:number;reason_code:'STAFF_COMPLETED';
  resolver_team_id:string;handling_cycle_id:string;internal_process:string;
  external_summary:string;external_summary_confirmed:true;
}> & (
  Readonly<{communication_choice:'RETAIN_CURRENT';sessions:readonly []}> |
  Readonly<{communication_choice:'TAKE_SELECTED';sessions:readonly [P2016TakeoverCompletionSession,...P2016TakeoverCompletionSession[]]}>
);
export type P2016TakeoverCompletionBasis = Readonly<{cycle_id:string;cycle_no:number;event_id:string;basis:'STAFF_COMPLETED'}>;
export type P2016TakeoverCompletionResult = Readonly<{
  ok:true;ticket_id:string;ticket_version:number;ticket_event_id:string;control_event_id:null;replayed:boolean;
  completion:P2016TakeoverCompletionBasis;communication_choice:'RETAIN_CURRENT'|'TAKE_SELECTED';
  conversations:ReadonlyArray<Readonly<{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}>>;
}>;
export type P2016TakeoverCompletionTargets = Readonly<{
  resolver_teams:ReadonlyArray<Readonly<{team_id:string;display_name:string}>>;
  resolver_team_id:string|null;allowed_actions:ReadonlyArray<'takeover-and-complete'>;
}>;
/** Current READ + original actor/Ticket/UUID/purpose. No original body or Session/group output. */
export type P2016TakeoverCompletionAcknowledgement =
  Readonly<{state:'UNKNOWN'}> |
  Readonly<{state:'COMMITTED';ticket_id:string;ticket_version:number;ticket_event_id:string;completion:P2016TakeoverCompletionBasis}> |
  Readonly<{state:'FAILED';error:Readonly<{code:string;retryable:false}>}>;
