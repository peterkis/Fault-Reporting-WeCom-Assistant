import type { LocalDateTime, PhysicalEpochMs } from './time_contracts.js';

/**
 * P2-002 rebuildable Conversation Timeline projection contracts.
 *
 * These declarations preserve the P2-001 Item/Sender/Visibility semantics.
 * A projected Item, Source Binding, and Checkpoint are deletable read-model
 * state; none owns Channel Message, Ticket Event, Delivery, future
 * Communication Message, future Handoff Event, or Ticket lifecycle facts.
 */

import type {
  ConversationItemSenderKind,
  ConversationItemType,
  ConversationItemVisibility,
} from './conversation_contracts.js';

export type TimelineSourceType =
  | 'CHANNEL_MESSAGE'
  | 'COMMUNICATION_MESSAGE'
  | 'TICKET_EVENT'
  | 'DELIVERY'
  | 'HANDOFF_EVENT';

export type TimelineSourceRank = 10 | 20 | 30 | 40 | 50;

export type TimelineProjectorName = 'CONVERSATION_TIMELINE';

export declare const TIMELINE_PROJECTOR_NAME: TimelineProjectorName;

export declare const TIMELINE_SOURCE_RANKS: Readonly<{
  CHANNEL_MESSAGE: 10;
  COMMUNICATION_MESSAGE: 20;
  TICKET_EVENT: 30;
  DELIVERY: 40;
  HANDOFF_EVENT: 50;
}>;

export type ConversationPrivacyClass =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'SENSITIVE_INTERNAL'
  | 'PERSONAL'
  | 'PATIENT_SENSITIVE'
  | 'SECRET';

export type TimelineAudience = 'EXTERNAL' | 'WORKBENCH' | 'RESTRICTED_ADMIN';

export type TimelineProjectionErrorCode =
  | 'CONVERSATION_TIMELINE_DISABLED'
  | 'CONVERSATION_TIMELINE_SOURCE_INVALID'
  | 'CONVERSATION_TIMELINE_SESSION_NOT_FOUND'
  | 'CONVERSATION_TIMELINE_SOURCE_CONFLICT'
  | 'CONVERSATION_TIMELINE_SEQUENCE_CONFLICT'
  | 'CONVERSATION_TIMELINE_REBUILD_REQUIRED'
  | 'CONVERSATION_TIMELINE_REBUILD_NOT_AUTHORIZED'
  | 'CONVERSATION_TIMELINE_REBUILD_FAILED'
  | 'CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT'
  | 'CONVERSATION_TIMELINE_STORAGE_FAILED'
  | 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED';

export type SafeJsonPrimitive = null | boolean | number | string;

export type SafeJsonValue =
  | SafeJsonPrimitive
  | readonly SafeJsonValue[]
  | SafeJsonObject;

export interface SafeJsonObject {
  readonly [key: string]: SafeJsonValue;
}

/** A canonical decimal string in the range 0..9223372036854775807. */
export type TimelineBigIntString = string;

/** A canonical non-negative PostgreSQL BIGINT decimal string. */
export type TimelineSourceOrdinal = TimelineBigIntString;

/** Input forms accepted by runtime BIGINT normalization. Outputs are strings. */
export type TimelineBigIntInput = TimelineBigIntString | number | bigint;

/**
 * Normalized safe semantic input for one projection variant.
 *
 * source_hash is lowercase SHA-256 of the canonical record excluding
 * source_hash, privacy_class, and retention_until. The latter two form an
 * inherited control envelope and may independently tighten on replay.
 */
export interface ConversationProjectionSourceRecord {
  readonly schema_version: 1;
  readonly projector_name: TimelineProjectorName;
  readonly projector_version: string;
  readonly source_stream: string;
  readonly source_type: TimelineSourceType;
  readonly source_id: string;
  readonly projection_variant: string;
  readonly session_id: string;
  readonly item_type: ConversationItemType;
  readonly sender_kind: ConversationItemSenderKind;
  readonly visibility: ConversationItemVisibility;
  readonly text: string | null;
  readonly safe_content: SafeJsonObject;
  readonly occurred_at: LocalDateTime;
  readonly source_ordinal: TimelineSourceOrdinal;
  readonly source_hash: string;
  readonly privacy_class: ConversationPrivacyClass;
  readonly retention_until: LocalDateTime;
  readonly retention_until_epoch_ms: PhysicalEpochMs;
}

export type TimelineSourceRecord = ConversationProjectionSourceRecord;

/**
 * Stable sort tuple. source_rank is derived from source_type and is never
 * accepted as caller-controlled Source Record data.
 */
export type TimelineCanonicalOrderTuple = readonly [
  occurredAt: string,
  sourceRank: TimelineSourceRank,
  sourceOrdinal: TimelineSourceOrdinal,
  sourceType: TimelineSourceType,
  sourceId: string,
  projectionVariant: string,
];

export interface ConversationItemSourceBinding {
  readonly projector_name: TimelineProjectorName;
  readonly projector_version: string;
  readonly source_stream: string;
  readonly source_type: TimelineSourceType;
  readonly source_id: string;
  readonly projection_variant: string;
  readonly session_id: string;
  readonly item_id: string;
  readonly source_hash: string;
  readonly canonical_order_key: string;
  readonly created_at: LocalDateTime;
  readonly last_seen_at: LocalDateTime;
}

export type TimelineSourceBinding = ConversationItemSourceBinding;

/** Safe checkpoint view keyed by projector_name and source_stream. */
export interface ConversationProjectionCheckpoint {
  readonly schema_version: 1;
  readonly projector_name: TimelineProjectorName;
  readonly projector_version: string;
  readonly source_stream: string;
  readonly cursor_value: string | null;
  readonly last_source_occurred_at: LocalDateTime | null;
  readonly last_batch_hash: string | null;
  readonly row_version: TimelineBigIntString;
  readonly updated_at: LocalDateTime;
}

export type TimelineProjectionCheckpoint = ConversationProjectionCheckpoint;

interface TimelineExpectedCheckpointFields {
  /** Opaque cursor, including an explicit null checkpoint cursor; maximum 512 characters. */
  readonly cursor_value?: string | null;
  readonly cursorValue?: string | null;
  readonly row_version?: TimelineBigIntInput;
  readonly rowVersion?: TimelineBigIntInput;
}

/** Runtime requires at least one cursor or row-version expectation. */
export type TimelineExpectedCheckpoint = TimelineExpectedCheckpointFields & (
  | { readonly cursor_value: string | null }
  | { readonly cursorValue: string | null }
  | { readonly row_version: TimelineBigIntInput }
  | { readonly rowVersion: TimelineBigIntInput }
);

export interface TimelineSourceAdapterReadRequest {
  readonly cursorValue?: string | null;
  /** Both are supplied by the built-in worker and carry the same bounded value. */
  readonly limit?: number;
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  readonly projectorName?: TimelineProjectorName;
  readonly projectorVersion?: string;
  readonly sourceStream?: string;
}

export interface TimelineSourceAdapterBatch {
  readonly records: readonly TimelineSourceRecord[];
  readonly next_cursor_value: string | null;
  readonly exhausted: boolean;
  readonly cursor_value: string | null;
  readonly done: boolean;
}

/**
 * Minimum read-only batch source port consumed by TimelineProjectorWorker.
 * Implementations read source facts outside projector write transactions;
 * fixture-only adapters must not query future tables.
 */
export interface TimelineBatchSourceAdapter {
  readonly sourceStream: string;
  readBatch(request: TimelineSourceAdapterReadRequest): Promise<TimelineSourceAdapterBatch>;
}

export type TimelineSessionSourceReadRequest =
  | {
      readonly sessionId: string;
      readonly session_id?: never;
      readonly signal?: AbortSignal;
    }
  | {
      readonly sessionId?: never;
      readonly session_id: string;
      readonly signal?: AbortSignal;
    };

/** Read-only source port used by the explicit single-Session rebuild path. */
export interface TimelineSessionSourceAdapter {
  readonly sourceStream: string;
  readSessionRecords(
    request: TimelineSessionSourceReadRequest,
  ): Promise<readonly TimelineSourceRecord[]>;
}

/**
 * Runtime generic adapter. Its batch capability is required; the Session
 * method is present but rejects when no readSessionRecords operation was
 * configured. It is distinct from the built-in P1-only Session adapter.
 */
export interface TimelineSourceAdapter extends TimelineBatchSourceAdapter {
  readSessionRecords(
    request: TimelineSessionSourceReadRequest,
  ): Promise<readonly TimelineSourceRecord[]>;
}

/** Built-in adapter over current P1 facts; it intentionally has no batch port. */
export interface P1TimelineSourceAdapter extends TimelineSessionSourceAdapter {
  readonly sourceStream: 'P1_SESSION_TIMELINE';
}

export interface TimelineProjectBatchRequest {
  readonly projectorName: TimelineProjectorName;
  readonly projectorVersion: string;
  readonly sourceStream: string;
  readonly records: readonly TimelineSourceRecord[];
  /** null means the checkpoint is expected to be absent. */
  readonly expectedCheckpoint?: TimelineExpectedCheckpoint | string | null;
  /** Opaque next cursor; maximum 512 characters. */
  readonly cursorValue?: string | null;
  readonly signal?: AbortSignal;
}

export interface TimelineProjectionResult {
  readonly received_count: number;
  readonly inserted_count: number;
  readonly replayed_count: number;
  readonly conflict_count: number;
  readonly session_count: number;
  readonly checkpoint_updated: boolean;
  readonly batch_hash: string;
}

export interface TimelineItemView {
  readonly id: string;
  readonly session_id: string;
  readonly sequence_no: TimelineBigIntString;
  readonly item_type: ConversationItemType;
  readonly sender_kind: ConversationItemSenderKind;
  readonly visibility: ConversationItemVisibility;
  readonly text: string | null;
  readonly safe_content: SafeJsonObject;
  readonly source_type: TimelineSourceType;
  readonly source_id: string;
  readonly projection_variant: string;
  readonly canonical_order_key: string;
  readonly content_hash: string;
  readonly privacy_class: ConversationPrivacyClass;
  readonly retention_until: LocalDateTime;
  readonly retention_until_epoch_ms: PhysicalEpochMs;
  readonly occurred_at: LocalDateTime;
  readonly projected_at: LocalDateTime;
}

export interface TimelineListItemsRequest {
  readonly sessionId: string;
  readonly afterSequence?: TimelineBigIntInput;
  readonly limit?: number;
  readonly audience: TimelineAudience;
  readonly restrictedAuthorized?: boolean;
  readonly signal?: AbortSignal;
}

export interface TimelineItemsPage {
  readonly session_id: string;
  readonly items: readonly TimelineItemView[];
  readonly next_after_sequence: TimelineBigIntString | null;
}

export interface TimelineCheckpointRequest {
  readonly projectorName: TimelineProjectorName;
  readonly sourceStream: string;
  readonly signal?: AbortSignal;
}

export interface TimelineRebuildRequestBase {
  readonly sessionId: string;
  readonly projectorName: TimelineProjectorName;
  readonly projectorVersion: string;
  readonly signal?: AbortSignal;
}

export type TimelineRebuildRecordInput =
  | {
      readonly records: readonly TimelineSourceRecord[];
      readonly sourceRecords?: never;
      readonly source_records?: never;
    }
  | {
      readonly records?: never;
      readonly sourceRecords: readonly TimelineSourceRecord[];
      readonly source_records?: never;
    }
  | {
      readonly records?: never;
      readonly sourceRecords?: never;
      readonly source_records: readonly TimelineSourceRecord[];
    };

export type TimelineRebuildCheckRequest = TimelineRebuildRequestBase
  & TimelineRebuildRecordInput
  & {
    readonly authorized?: boolean;
    readonly rebuildAuthorized?: boolean;
  };

export type TimelineRebuildRequest = TimelineRebuildRequestBase
  & TimelineRebuildRecordInput
  & (
    | { readonly authorized: true; readonly rebuildAuthorized?: boolean }
    | { readonly authorized?: boolean; readonly rebuildAuthorized: true }
  );

export interface TimelineRebuildCheckResult {
  readonly session_id: string;
  readonly record_count: number;
  readonly session_count: 1;
  readonly canonical_hash: string;
  readonly source_stream_count: number;
  readonly write_required: true;
}

export interface TimelineRebuildResult {
  readonly session_id: string;
  readonly received_count: number;
  readonly inserted_count: number;
  readonly replayed_count: 0;
  readonly conflict_count: 0;
  readonly session_count: 1;
  readonly checkpoint_updated: false;
  readonly batch_hash: string;
  readonly canonical_hash: string;
  readonly source_count: number;
  readonly item_count: number;
  readonly canonical_timeline_hash: string;
}

export interface TimelineProjectorPort {
  projectBatch(request: TimelineProjectBatchRequest): Promise<TimelineProjectionResult>;
  projectOne(
    record: TimelineSourceRecord,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TimelineProjectionResult>;
  listTimelineItems(request: TimelineListItemsRequest): Promise<TimelineItemsPage>;
  getProjectionCheckpoint(
    request: TimelineCheckpointRequest,
  ): Promise<TimelineProjectionCheckpoint | null>;
  checkRebuildSession(request: TimelineRebuildCheckRequest): TimelineRebuildCheckResult;
  rebuildSession(request: TimelineRebuildRequest): Promise<TimelineRebuildResult>;
}

export interface TimelineProjectorWorkerResult {
  readonly batch_count: number;
  readonly received_count: number;
  readonly inserted_count: number;
  readonly replayed_count: number;
  readonly cursor_value: string | null;
  readonly exhausted: boolean;
  readonly checkpoint: TimelineProjectionCheckpoint | null;
}
