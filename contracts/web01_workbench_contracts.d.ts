export type BoardColumn = 'pending' | 'active' | 'closed';
export type CompletionRange = 'recent' | 'all' | 'cancelled';
export type WorkbenchKind = 'ticket' | 'review' | 'intake';
export interface SourceGroupDisplay {
  ref: string; display_name: string | null;
  name_source: 'ADMIN_CONFIRMED' | 'UNREGISTERED'; row_version: string;
}
export interface SourceGroupPage { items: SourceGroupDisplay[]; next_cursor: string | null }
export interface SourceGroupNameCommand { client_command_id: string; expected_row_version: string; display_name: string }
export interface SourceGroupNameResult { ok: true; group: SourceGroupDisplay; replayed: boolean }
export interface WorkbenchCard {
  kind: WorkbenchKind; id: string; intake_id: string; number: string; title: string;
  status: string; column: BoardColumn; priority: string | null; source: string;
  source_label: string; source_group: SourceGroupDisplay | null;
  location: string | null; reporter_name: string | null;
  assignee_name: string | null; review_reason: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
  /** Present only on authorized Ticket cards while shared-time viewing is enabled. */
  follow_up_schedule?:import('./workbench_follow_up_schedule_contracts.js').SharedFollowUpActive|null;
  /** Current-round Web urge; projection only, never priority or responsibility. */
  web_report_urge?:import('./workbench_web_report_contracts.js').WorkbenchWebUrge;
}
export interface BoardPage {
  items: WorkbenchCard[]; next_cursor: string | null; column: BoardColumn;
  range: { mode: CompletionRange; from: string; until: string; timezone: 'Asia/Shanghai' };
}
export interface WorkbenchRecord {
  id: string; at: string; type: string; text: string | null;
  audience: 'REPORT' | 'INTERNAL' | 'EXTERNAL'; actor: string | null;
  old_status: string | null; new_status: string | null;
  read_material?:{source_ref:string;revision:string};
}
export interface WorkbenchDetail {
  item: WorkbenchCard; description: string | null;
  records: WorkbenchRecord[]; next_cursor: string | null;
  responsibility: { ticket_assignee_name: string | null; conversation_assignees: string[] };
  review_refs?:import('./workbench_review_contracts.js').ReviewReference[];
  requested_item?:import('./workbench_review_contracts.js').CanonicalItem;
}
