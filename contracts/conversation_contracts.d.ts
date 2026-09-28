import type { LocalDateTime } from './time_contracts.js';

/**
 * P2-001 Conversation Thread, Session, and Item contracts.
 *
 * These declarations mirror the JSON Schemas in this directory. They define
 * domain representations only; they do not authorize persistence, delivery,
 * realtime transport, handoff, assignment, or AI behavior.
 */

export type ConversationChatType = 'single' | 'group';

export type ConversationThreadStatus = 'OPEN' | 'ARCHIVED';

export type ConversationSessionStatus = 'OPEN' | 'WAITING_USER' | 'ENDED';

export type ConversationControlMode = 'AUTO' | 'COPILOT' | 'HUMAN';

export type ConversationItemType =
  | 'USER_MESSAGE'
  | 'AI_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'INTERNAL_NOTE'
  | 'SYSTEM_EVENT'
  | 'TICKET_EVENT'
  | 'DELIVERY_STATUS'
  | 'HANDOFF_EVENT';

export type ConversationItemSenderKind = 'USER' | 'AI' | 'AGENT' | 'SYSTEM' | 'TOOL';

export type ConversationItemVisibility = 'EXTERNAL' | 'INTERNAL' | 'RESTRICTED';

export interface ConversationThread {
  id: string;
  provider: string;
  channel_account_id: string;
  chat_type: ConversationChatType;
  external_thread_key: string;
  thread_key: string;
  status: ConversationThreadStatus;
  last_activity_at: LocalDateTime;
  created_at: LocalDateTime;
  updated_at: LocalDateTime;
}

export interface ConversationSession {
  id: string;
  thread_id: string;
  participant_key: string;
  service_intake_id: string | null;
  session_scope_key: string;
  creation_idempotency_key: string;
  status: ConversationSessionStatus;
  control_mode: ConversationControlMode;
  generation_version: number;
  row_version: number;
  started_at: LocalDateTime;
  last_activity_at: LocalDateTime;
  ended_at: LocalDateTime | null;
  close_reason: string | null;
  created_at: LocalDateTime;
  updated_at: LocalDateTime;
}

export interface ConversationItem {
  id: string;
  session_id: string;
  sequence_no: number;
  item_type: ConversationItemType;
  sender_kind: ConversationItemSenderKind;
  visibility: ConversationItemVisibility;
  text?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  occurred_at: LocalDateTime;
}
