export type BoardColumn = 'pending' | 'active' | 'closed';
export type CompletionRange = 'recent' | 'all';
export type BoardCompletionRange = CompletionRange | 'custom';
export type WorkbenchKind = 'ticket' | 'review' | 'intake';
export interface SourceGroupDisplay {
  ref: string; display_name: string | null;
  name_source: 'ADMIN_CONFIRMED' | 'UNREGISTERED'; row_version: string;
}
export interface SourceGroupPage { items: SourceGroupDisplay[]; next_cursor: string | null }
export interface SourceGroupNameCommand { client_command_id: string; expected_row_version: string; display_name: string }
export interface SourceGroupNameResult { ok: true; group: SourceGroupDisplay; replayed: boolean }
export interface WorkbenchService {
  code: string; name_zh: string; category: string; category_name_zh: string;
  source: 'MANUAL_CONFIRMED' | 'REPORTER_EXPLICIT' | 'RULE_DETERMINISTIC';
}
export interface WorkbenchServiceCatalog {
  schema_version: 1; catalog_version: string;
  categories: {category: string; category_name_zh: string; services: {service_code: string; name_zh: string}[]}[];
}
/** Read-only closure-record projection; command services enforce current restoration authority. */
export interface WorkbenchClosure {
  kind: 'COMPLETED' | 'DISMISSED'; source: 'MANUAL' | 'SYSTEM' | null;
  reason_code: string | null; reason_label: string | null; reason_note: string | null;
  secondary_reason:{code:string;label:string}|null;
  closed_by_display_name: string | null;
  /** Asia/Shanghai LocalDateTime, with the same second precision as the card timestamps. */
  closed_at: string | null;
  duplicate_of: {display_no: string} | null; can_restore: boolean;
}
export interface WorkbenchCard {
  kind: WorkbenchKind; id: string; intake_id: string; number: string; title: string;
  status: string; column: BoardColumn; priority: string | null; source: string;
  source_label: string; source_group: SourceGroupDisplay | null;
  location: string | null; reporter_name: string | null;
  /** Historical labels, or an explicitly attributed later lookup; the original snapshot is unchanged. */
  reporter_department?: string | null;
  reporter_profile?: {state:'PENDING'|'PARTIAL'|'RESOLVED'|'UNAVAILABLE';source:'REPORT_SNAPSHOT'|'LATER_LOOKUP'|null;captured_at:string|null};
  assignee_name: string | null; review_reason: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
  /** Always present; null in the first and second columns. */
  closure: WorkbenchClosure | null;
  /** Board, detail and search read projections. Older responses omit these fields. */
  service?: WorkbenchService | null;
  stage_entered_at?: string | null;
  /** Present only on authorized Ticket cards while shared-time viewing is enabled. */
  follow_up_schedule?:import('./workbench_follow_up_schedule_contracts.js').SharedFollowUpActive|null;
  /** Current-round Web urge; projection only, never priority or responsibility. */
  web_report_urge?:import('./workbench_web_report_contracts.js').WorkbenchWebUrge;
}
export interface BoardPage {
  items: WorkbenchCard[]; next_cursor: string | null; column: BoardColumn;
  /** Required on the closed column, absent on the other columns; before pagination. */
  group_counts?: {completed: number; dismissed: number};
  range: { mode: BoardCompletionRange; from: string; until: string; timezone: 'Asia/Shanghai' };
}
export interface WorkbenchRecord {
  id: string; at: string; type: string; text: string | null;
  audience: 'REPORT' | 'INTERNAL' | 'EXTERNAL'; actor: string | null;
  /** Existing internal principal only; never a Provider or Bot identifier. */
  actor_ref?: string | null;
  old_status: string | null; new_status: string | null;
  read_material?:{source_ref:string;revision:string};
}
export interface WorkbenchDetail {
  item: WorkbenchCard; description: string | null;
  /** First receipt/registration of the original report, when its source is readable. */
  reported_at?: string | null;
  records: WorkbenchRecord[]; next_cursor: string | null;
  responsibility: { ticket_assignee_name: string | null; conversation_assignees: string[] };
  review_refs?:import('./workbench_review_contracts.js').ReviewReference[];
  requested_item?:import('./workbench_review_contracts.js').CanonicalItem;
}
