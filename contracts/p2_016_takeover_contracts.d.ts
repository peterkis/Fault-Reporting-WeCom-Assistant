/** WBINT-T07 frozen SOURCE contract. HTTP/runtime/UI are PLANNED and NOT_RUN. */
export type P2016TakeoverAction = 'takeover' | 'takeover-and-start';
export type P2016TakeoverSession = Readonly<{session_id:string;expected_row_version:number}>;
export type P2016TakeoverCommand = Readonly<{
  client_command_id:string;expected_version:number;reason_code:string;resolver_team_id:string;
}> & (
  Readonly<{communication_choice:'RETAIN_CURRENT';sessions:readonly []}> |
  Readonly<{communication_choice:'TAKE_SELECTED';sessions:readonly [P2016TakeoverSession,...P2016TakeoverSession[]]}>
);
export type P2016TakeoverHandlingCycle = Readonly<{id:string;cycle_no:number;first_responsibility_event_id:string|null}>;
export type P2016TakeoverResult = Readonly<{
  ok:true;ticket_id:string;ticket_version:number;ticket_event_id:string;control_event_id:null;
  handling_cycle:P2016TakeoverHandlingCycle|null;
  communication_choice:'TAKE_SELECTED'|'RETAIN_CURRENT';
  conversations:ReadonlyArray<Readonly<{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}>>;
  replayed:boolean;
}>;
/** Atomic start independently requires a valid current cycle and its existing first basis. */
export type P2016TakeoverAndStartResult = Omit<P2016TakeoverResult,'handling_cycle'> & Readonly<{
  handling_cycle:Readonly<{id:string;cycle_no:number;first_responsibility_event_id:string}>;
}>;
export type P2016TakeoverTargets = Readonly<{
  resolver_teams:ReadonlyArray<Readonly<{team_id:string;display_name:string}>>;
  resolver_team_id:string|null;allowed_actions:ReadonlyArray<P2016TakeoverAction>;
}>;
export type P2016TakeoverAcknowledgement =
  Readonly<{state:'UNKNOWN'}> |
  Readonly<{state:'COMMITTED';ticket_id:string;ticket_version:number;ticket_event_id:string}> |
  Readonly<{state:'FAILED';error:Readonly<{code:string;retryable:false}>}>;
