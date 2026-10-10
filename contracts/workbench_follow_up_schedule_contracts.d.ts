import type {LocalDateTime, PhysicalEpochMs} from './time_contracts.js';

/** WBINT-T37 frozen target contract; SOURCE_READY does not imply a mounted HTTP route. */
export type SharedFollowUpCommand = Readonly<{
  client_command_id:string;
  expected_version:number;
  expected_schedule_version:string;
  reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE';
}> & (Readonly<{action:'SET';due_at:LocalDateTime}> | Readonly<{action:'CANCEL';due_at:null}>);

/** A revision identifier, never a Ticket lifecycle/assignment owner or a JS number. */
export type SharedFollowUpActive = Readonly<{
  schedule_version:string;
  due_at:LocalDateTime;
  due_epoch_ms:PhysicalEpochMs;
  is_due:boolean;
}>;
export type SharedFollowUpHistoryEntry = Readonly<{
  schedule_version:string;
  action:'SET'|'CANCEL'|'ENDED';
  due_at:LocalDateTime|null;
  occurred_at:LocalDateTime;
  ticket_event_id:string;
  end_reason:'CLOSED'|'CANCELLED'|null;
}>;
export type SharedFollowUpView = Readonly<{
  ticket_id:string;
  ticket_version:number;
  schedule_version:string;
  active:SharedFollowUpActive|null;
  allowed_actions:ReadonlyArray<'SET'|'CANCEL'>;
  history:ReadonlyArray<SharedFollowUpHistoryEntry>;
  history_has_more:boolean;
}>;
export type SharedFollowUpResult = Readonly<{
  ok:true;
  ticket_id:string;
  ticket_version:number;
  ticket_event_id:string;
  control_event_id:null;
  schedule_version:string;
  replayed:boolean;
}>;
/** Current READ + original principal/purpose, independently of current SET/CANCEL ability. */
export type SharedFollowUpReceipt = Readonly<{client_command_id:string;ticket_id:string}> & (
  Readonly<{state:'UNKNOWN'}> |
  Readonly<{state:'COMMITTED';result:SharedFollowUpResult & Readonly<{replayed:true}>}> |
  Readonly<{state:'FAILED';error:Readonly<{code:string;retryable:false}>}>
);
