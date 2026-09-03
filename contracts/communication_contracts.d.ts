import type { LocalDateTime, PhysicalEpochMs } from './time_contracts';

export type CommunicationSenderKind = 'AGENT' | 'AI' | 'SYSTEM';
export type CommunicationMessageType = 'text' | 'markdown' | 'image' | 'file' | 'mixed' | 'template_card';
export type CommunicationVisibility = 'EXTERNAL' | 'INTERNAL' | 'RESTRICTED';
export type CommunicationPurpose = 'HUMAN_REPLY' | 'AI_REPLY' | 'SYSTEM_NOTIFICATION' | 'INTERNAL_NOTE';
export type CommunicationDeliveryStatus = 'PENDING' | 'LEASED' | 'SENDING' | 'SENT' | 'RECONCILIATION_REQUIRED' | 'DEAD_LETTER' | 'CANCELLED';
export type CommunicationAttemptOutcome = 'STARTED' | 'SENT' | 'RETRY_SCHEDULED' | 'RECONCILIATION_REQUIRED' | 'DEAD_LETTER' | 'CANCELLED';
export type ProviderSideEffectState = 'NOT_ATTEMPTED' | 'ACKNOWLEDGED' | 'UNKNOWN';
export type CommunicationSourceKind = 'COMMUNICATION' | 'P1_NOTIFICATION';

export interface CommunicationCommandResult {
  message_id: string;
  outbox_id: string | null;
  delivery_ids: string[];
  command_status: 'COMMITTED' | 'REPLAYED';
  replayed: boolean;
  created_at: LocalDateTime;
}

export interface CommunicationSenderRequest {
  provider: string;
  channel_account_id: string;
  target_type: 'PERSON' | 'GROUP';
  target_id: string;
  delivery_id: string;
  idempotency_key: string;
  message: { message_type: CommunicationMessageType; content: Record<string, unknown> };
  signal: AbortSignal;
}

export interface CommunicationSenderResult {
  outcome: 'ACKNOWLEDGED' | 'REJECTED_NOT_APPLIED' | 'UNKNOWN';
  provider_message_id: string | null;
  error_code: string | null;
  retryable?: boolean;
}

export interface SafeCommunicationDeliveryView {
  source_kind: CommunicationSourceKind;
  delivery_id: string;
  outbox_id: string;
  status: CommunicationDeliveryStatus | 'SENDING';
  channel: string;
  attempt_count: number;
  last_error_code: string | null;
  side_effect_state?: ProviderSideEffectState;
  sent_at: LocalDateTime | null;
  next_attempt_epoch_ms?: PhysicalEpochMs;
  lease_expires_epoch_ms?: PhysicalEpochMs | null;
}
