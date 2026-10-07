export type BoardColumn = 'pending' | 'active' | 'closed';
export type CompletionRange = 'recent' | 'all';
export type WorkbenchKind = 'ticket' | 'review' | 'intake';
export interface WorkbenchCard {
  kind: WorkbenchKind; id: string; intake_id: string; number: string; title: string;
  status: string; column: BoardColumn; priority: string | null; source: string;
  location: string | null; reporter_name: string | null;
  assignee_name: string | null; review_reason: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}
export interface BoardPage {
  items: WorkbenchCard[]; next_cursor: string | null; column: BoardColumn;
  range: { mode: CompletionRange; from: string; until: string; timezone: 'Asia/Shanghai' };
}
export interface WorkbenchRecord {
  id: string; at: string; type: string; text: string | null;
  audience: 'REPORT' | 'INTERNAL' | 'EXTERNAL'; actor: string | null;
  old_status: string | null; new_status: string | null;
}
export interface WorkbenchDetail {
  item: WorkbenchCard; description: string | null;
  records: WorkbenchRecord[]; next_cursor: string | null;
  responsibility: { ticket_assignee_name: string | null; conversation_assignees: string[] };
}
