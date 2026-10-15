import type {LocalDateTime} from './time_contracts.js';

/** WBINT-T36 SOURCE plan only. No mounted implementation or runtime evidence. */
export interface SupplementFollowUpTarget {readonly source_ref:string;readonly revision:string}
export interface SupplementFollowUpCommand extends SupplementFollowUpTarget {
  readonly client_command_id:string;
  readonly action:'RECORD_DISPOSITION';
  readonly disposition_note:string;
  readonly mark_followed_up:true;
}
/** Planned opt-in extension of the existing T22 messages command, not another sender. */
export interface SupplementFollowUpReplyCommand {
  readonly client_command_id:string;
  readonly expected_row_version:number;
  readonly text:string;
  readonly follow_up_target:SupplementFollowUpTarget & {readonly ticket_id:string};
}
export interface SupplementFollowUpResolution {
  readonly resolution_id:string;
  readonly basis:'RECORDED_DISPOSITION'|'VERIFIED_REPLY';
  readonly occurred_at:LocalDateTime;
}
export type SupplementFollowUpItem = Readonly<SupplementFollowUpTarget & {source_kind:'WEB'|'BOT'}> & (
  Readonly<{follow_up_state:'PENDING';resolution:null}> |
  Readonly<{follow_up_state:'FOLLOWED_UP';resolution:SupplementFollowUpResolution}>
);
export interface SupplementFollowUpPage {
  readonly ticket_id:string;
  readonly items:ReadonlyArray<SupplementFollowUpItem>;
  readonly next_cursor:string|null;
  /** EXISTS over the complete currently authorized retained scope, not the returned page. */
  readonly has_pending_supplements:boolean;
}
export interface SupplementFollowUpResult extends SupplementFollowUpTarget {
  readonly ok:true;
  readonly client_command_id:string;
  readonly ticket_id:string;
  readonly follow_up_state:'FOLLOWED_UP';
  readonly resolution_id:string;
  readonly basis:'RECORDED_DISPOSITION';
  readonly replayed:boolean;
}
export type SupplementFollowUpReceipt = Readonly<{client_command_id:string;ticket_id:string}> & (
  Readonly<{state:'UNKNOWN'}> |
  Readonly<{state:'COMMITTED';result:SupplementFollowUpResult & {readonly replayed:true}}> |
  Readonly<{state:'FAILED';error:Readonly<{code:string;retryable:false}>}>
);
