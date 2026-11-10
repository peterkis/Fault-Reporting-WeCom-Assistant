export type ClosureReasonCode = 'FALSE_REPORT_OR_TEST'|'DUPLICATE'|'NOT_IT_SCOPE'|'REPORTER_WITHDREW'|'REPORTER_UNREACHABLE'|'OTHER';
export type ClosureSecondaryReasonCode = 'HUMAN_CONFIRMED'|'INFORMATION_INSUFFICIENT'|'BUSINESS_CONSULTATION_CONFIRMED'|'ACKNOWLEDGED'|'OUT_OF_SCOPE_CONFIRMED'|'SERVICE_REQUEST_CONFIRMED'|'INCIDENT_REVIEW_PENDING'|'STALE_REVIEW_CANCELLED';
export interface ClosureInput {reason_code:ClosureReasonCode;secondary_reason_code?:ClosureSecondaryReasonCode|null;note?:string|null;duplicate_of_ref?:string|null;notify_reporter?:boolean}
export interface NormalizedClosureInput {reason_code:ClosureReasonCode;secondary_reason_code:ClosureSecondaryReasonCode|null;note:string|null;duplicate_of_ref:string|null;notify_reporter:boolean}
export interface ClosureCommand extends ClosureInput {client_command_id:string;expected_version:number}
export interface RestoreCommand {client_command_id:string;expected_version:number;reason_code:'RESTORE_CLOSED'}
export interface IntakeClosureCommand extends ClosureCommand {expected_review_version?:string;expected_material_basis?:string}
export interface ClosureResult {ok:true;subject_type:'TICKET'|'INTAKE';subject_id:string;version:number;closure_id:string;event_id:string;replayed:boolean}
export interface IntakeClosureContext {subject_id:string;version:number;status:string;can_close:boolean;can_restore:boolean;closure_id:string|null;pending_review:{id:string;row_version:string}|null}
export type ClosureReceipt={state:'UNKNOWN'}|{state:'FAILED';error:{code:string;retryable:false}}|{state:'COMMITTED';result:ClosureResult};
/** Staff-only, bounded read projection. No internal fields are exposed to H5. */
export interface ClosureHistoryEntry {
 id:string;before_version:number;reason_code:ClosureReasonCode;reason_label:string;
 secondary_reason:{code:ClosureSecondaryReasonCode;label:string}|null;note:string|null;
 duplicate_of:{display_no:string}|null;source:'MANUAL'|'SYSTEM';ended_at:string;ended_by_display_name:string|null;
 notification_state:'SENT'|'UNKNOWN'|'NOT_SENT';restored_at:string|null;restored_by_display_name:string|null;
}
export interface ClosureHistoryPage {
 subject_id:string;version:number;items:ClosureHistoryEntry[];next_before_version:number|null;
 /** notify_reporter: whether the closure being restored chose to notify the reporter; restore notifies only after a notified closure. */
 restore_target:{status:string;column:'pending'|'active';assignee_name:string|null;notify_reporter:boolean;notification_state:'SENT'|'UNKNOWN'|'NOT_SENT'}|null;
}
