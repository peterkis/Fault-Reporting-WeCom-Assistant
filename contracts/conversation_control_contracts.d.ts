export type ConversationAssignmentStatus = 'UNASSIGNED' | 'ASSIGNED';
export type ConversationHandoffStatus = 'REQUESTED' | 'ACCEPTED' | 'RELEASED' | 'CANCELLED';
export type ConversationControlCommandType = 'REQUEST_HANDOFF' | 'TAKEOVER' | 'TRANSFER' | 'RELEASE' | 'CANCEL_HANDOFF' | 'ADVANCE_READ_CURSOR' | 'INVALIDATE_GENERATION';
export type ConversationControlEventType = 'HANDOFF_REQUESTED' | 'HANDOFF_ACCEPTED' | 'HANDOFF_RELEASED' | 'HANDOFF_CANCELLED' | 'ASSIGNMENT_ASSIGNED' | 'ASSIGNMENT_TRANSFERRED' | 'ASSIGNMENT_RELEASED' | 'GENERATION_INVALIDATED' | 'READ_CURSOR_ADVANCED';
export type ConversationGenerationInvalidationReason = 'HANDOFF_REQUESTED' | 'HUMAN_TAKEOVER' | 'ASSIGNMENT_TRANSFERRED' | 'ASSIGNMENT_RELEASED' | 'HANDOFF_CANCELLED' | 'ADMIN_CANCELLED' | 'TICKET_CRITICAL_STATE_CHANGED' | 'USER_MESSAGE_COMMITTED';

export interface ConversationControlCommand {
  command_type: ConversationControlCommandType;
  session_id: string;
  client_command_id: string;
  idempotency_scope: string;
  expected_row_version?: number;
  expected_cursor_row_version?: number;
  actor_principal_id?: string | null;
  target_principal_id?: string | null;
  handoff_id?: string | null;
  requested_by_kind?: 'USER' | 'AI' | 'RULE' | 'AGENT' | 'ADMIN';
  last_read_sequence?: number;
  reason_code: string;
  force?: boolean;
  target_mode?: 'HUMAN' | 'COPILOT' | 'AUTO';
}

export interface ConversationGenerationFence {
  session_id: string;
  generation_version_at_start: number;
  control_mode: 'HUMAN' | 'COPILOT' | 'AUTO';
  captured_at: string;
}
