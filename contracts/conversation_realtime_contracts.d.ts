import type { LocalDateTime, PhysicalEpochMs } from './time_contracts.js';

/**
 * P2-003 durable realtime event projection, replay, authorization, SSE, and
 * polling-fallback contracts.
 *
 * Realtime Event Log, SSE, and the in-process Wakeup Hub are rebuildable
 * delivery projections. They never own Conversation, Ticket, Incident, or
 * external-provider business facts.
 */

export type RealtimeStreamName = 'CONVERSATION_WORKBENCH';

export type RealtimeEventType =
  | 'conversation.session.created'
  | 'conversation.session.updated'
  | 'conversation.item.created'
  | 'conversation.timeline.rebuilt'
  | 'conversation.mode.changed'
  | 'conversation.assigned'
  | 'conversation.handoff.requested'
  | 'conversation.handoff.accepted'
  | 'conversation.read_cursor.changed'
  | 'communication.delivery.changed'
  | 'ticket.updated'
  | 'incident.updated'
  | 'incident.candidate.review_started'
  | 'incident.candidate.rejected'
  | 'incident.candidate.expired'
  | 'incident.candidate.confirmed'
  | 'incident.confirmed'
  | 'incident.status.changed'
  | 'incident.scope.changed'
  | 'incident.primary_ticket.changed'
  | 'incident.report.linked'
  | 'incident.report.unlinked'
  | 'incident.report.recovered'
  | 'incident.subscription.changed'
  | 'incident.notification.changed'
  | 'gateway.connection.changed'
  | 'manual_review.created' | 'manual_review.resolved'
  | 'ticket.command.committed' | 'ticket.status.changed' | 'ticket.assignment.changed'
  | 'ticket.notification.created' | 'ticket.notification.delivery_changed';

export type RealtimeSourceType =
  | 'CONVERSATION_SESSION'
  | 'CONVERSATION_ITEM'
  | 'TIMELINE_REBUILD'
  | 'COMMUNICATION_DELIVERY'
  | 'TICKET_EVENT'
  | 'HANDOFF_EVENT'
  | 'READ_CURSOR'
  | 'INCIDENT_EVENT'
  | 'GATEWAY_EVENT'
  | 'MANUAL_REVIEW';

export type RealtimeAggregateType =
  | 'CONVERSATION_SESSION'
  | 'CONVERSATION_ITEM'
  | 'CONVERSATION_TIMELINE'
  | 'COMMUNICATION_DELIVERY'
  | 'TICKET'
  | 'CONVERSATION_HANDOFF'
  | 'CONVERSATION_READ_CURSOR'
  | 'INCIDENT'
  | 'INCIDENT_CANDIDATE'
  | 'GATEWAY_CONNECTION'
  | 'MANUAL_REVIEW';

export type RealtimeAuthorizationScopeType = 'SESSION' | 'THREAD' | 'SYSTEM';

export type RealtimeVisibilityScope = 'WORKBENCH' | 'RESTRICTED_ADMIN';

export type RealtimeAppendStatus = 'INSERTED' | 'REPLAYED';

export type RealtimeFallbackReason =
  | 'SSE_DISABLED'
  | 'CAPACITY_REACHED'
  | 'REPLAY_GAP'
  | 'TEMPORARY_UNAVAILABLE';

export type RealtimeFallbackStrategy =
  | 'REFETCH_CONVERSATION_LIST_AND_TIMELINE'
  | 'POLL_UNTIL_SSE_AVAILABLE';

export type RealtimeErrorCode =
  | 'CONVERSATION_REALTIME_DISABLED'
  | 'CONVERSATION_REALTIME_EVENT_INVALID'
  | 'CONVERSATION_REALTIME_EVENT_CONFLICT'
  | 'CONVERSATION_REALTIME_CURSOR_INVALID'
  | 'CONVERSATION_REALTIME_CURSOR_AHEAD'
  | 'CONVERSATION_REALTIME_REPLAY_GAP'
  | 'CONVERSATION_REALTIME_UNAUTHENTICATED'
  | 'CONVERSATION_REALTIME_FORBIDDEN'
  | 'CONVERSATION_REALTIME_CAPACITY_REACHED'
  | 'CONVERSATION_REALTIME_SLOW_CLIENT'
  | 'CONVERSATION_REALTIME_STORAGE_FAILED'
  | 'CONVERSATION_REALTIME_RETENTION_NOT_AUTHORIZED'
  | 'CONVERSATION_REALTIME_RETENTION_FAILED'
  | 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';

/** A canonical decimal string in the range 0..9223372036854775807. */
export type RealtimeBigIntString = string;

/** Private database-row and synthetic-fixture seams only; never use for a public cursor. */
export type RealtimeBigIntInput = RealtimeBigIntString | number | bigint;

export type RealtimeSafeJsonPrimitive = null | boolean | number | string;

export type RealtimeSafeJsonValue =
  | RealtimeSafeJsonPrimitive
  | readonly RealtimeSafeJsonValue[]
  | RealtimeSafeJsonObject;

export interface RealtimeSafeJsonObject {
  readonly [key: string]: RealtimeSafeJsonValue;
}

export declare const REALTIME_STREAM_NAME: RealtimeStreamName;
export declare const REALTIME_EVENT_TYPES: readonly RealtimeEventType[];
export declare const REALTIME_SOURCE_TYPES: readonly RealtimeSourceType[];
export declare const REALTIME_AGGREGATE_TYPES: readonly RealtimeAggregateType[];
export declare const REALTIME_AUTHORIZATION_SCOPE_TYPES: readonly RealtimeAuthorizationScopeType[];
export declare const REALTIME_VISIBILITY_SCOPES: readonly RealtimeVisibilityScope[];
export declare const REALTIME_ERROR_CODES: Readonly<Record<string, RealtimeErrorCode>>;
export declare const REALTIME_SAFE_JSON_LIMITS: Readonly<{
  maximum_depth: 6;
  maximum_nodes: 4096;
  maximum_properties_per_object: 64;
  maximum_array_items: 100;
  maximum_string_length: 4096;
  maximum_canonical_bytes: 65536;
}>;
export declare const REALTIME_DEFAULT_RETENTION_MS: number;
export declare const REALTIME_DEFAULT_REPLAY_LIMIT: 50;
export declare const REALTIME_MAX_REPLAY_LIMIT: 200;
export declare const REALTIME_DEFAULT_CLEANUP_LIMIT: number;
export declare const REALTIME_MAX_CLEANUP_LIMIT: 200;

/** Normalized immutable semantic input. event_key and hashes are computed later. */
export interface RealtimeEventCommand {
  readonly schema_version: 1;
  readonly publisher_name: string;
  readonly publisher_version: string;
  readonly source_type: RealtimeSourceType;
  readonly source_id: string;
  readonly event_variant: string;
  readonly event_type: RealtimeEventType;
  readonly aggregate_type: RealtimeAggregateType;
  readonly aggregate_id: string;
  readonly aggregate_version: RealtimeBigIntString | null;
  readonly authorization_scope_type: RealtimeAuthorizationScopeType;
  readonly authorization_scope_id: string | null;
  readonly visibility_scope: RealtimeVisibilityScope;
  readonly payload: RealtimeSafeJsonObject;
  readonly occurred_at: LocalDateTime;
  readonly expires_at: LocalDateTime;
  readonly expires_epoch_ms: PhysicalEpochMs;
}

/** PostgreSQL representation used by the event store and replay mapper. */
export interface RealtimeEventRow {
  readonly event_id: RealtimeBigIntInput;
  readonly event_key: string;
  readonly stream_name: RealtimeStreamName;
  readonly publisher_name: string;
  readonly publisher_version: string;
  readonly source_type: RealtimeSourceType;
  readonly source_id: string;
  readonly event_variant: string;
  readonly event_type: RealtimeEventType;
  readonly aggregate_type: RealtimeAggregateType;
  readonly aggregate_id: string;
  readonly aggregate_version: RealtimeBigIntInput | null;
  readonly authorization_scope_type: RealtimeAuthorizationScopeType;
  readonly authorization_scope_id: string | null;
  readonly visibility_scope: RealtimeVisibilityScope;
  readonly payload: RealtimeSafeJsonObject;
  readonly payload_hash: string;
  readonly event_hash: string;
  readonly occurred_at: LocalDateTime;
  readonly expires_at: LocalDateTime;
  readonly expires_epoch_ms: PhysicalEpochMs;
  readonly created_at: LocalDateTime;
}

/** Only this safe view may cross the replay/SSE boundary. */
export interface RealtimePublicEventView {
  readonly event_id: RealtimeBigIntString;
  readonly event_type: RealtimeEventType;
  readonly aggregate_type: RealtimeAggregateType;
  readonly aggregate_id: string;
  readonly aggregate_version: RealtimeBigIntString | null;
  readonly visibility_scope: RealtimeVisibilityScope;
  readonly payload: RealtimeSafeJsonObject;
  readonly occurred_at: LocalDateTime;
  readonly created_at: LocalDateTime;
}

export interface RealtimeEventAppendResult {
  readonly event_id: RealtimeBigIntString;
  readonly status: RealtimeAppendStatus;
  readonly inserted_count: 0 | 1;
  readonly replayed_count: 0 | 1;
  readonly conflict_count: 0;
}

export interface RealtimeSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
}

export interface RealtimeSqlExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<RealtimeSqlResult<Row>>;
}

export interface RealtimePool extends RealtimeSqlExecutor {
  connect?(): Promise<RealtimeSqlExecutor & { release?(): void }>;
}

export interface RealtimeAuthorization {
  readonly allowed_session_ids: readonly string[];
  readonly allowed_thread_ids: readonly string[];
  readonly allow_system_events: boolean;
  readonly allow_restricted_admin: boolean;
}

export interface RealtimeReplayWindow {
  readonly stream_name: RealtimeStreamName;
  readonly high_watermark_event_id: RealtimeBigIntString;
  readonly retention_floor_event_id: RealtimeBigIntString;
}

export interface RealtimeReplayPage {
  readonly stream_name: RealtimeStreamName;
  readonly after_event_id: RealtimeBigIntString;
  readonly events: readonly RealtimePublicEventView[];
  readonly high_watermark_event_id: RealtimeBigIntString;
  readonly retention_floor_event_id: RealtimeBigIntString;
  readonly next_after_event_id: RealtimeBigIntString | null;
}

export interface RealtimeRetentionCheckRequest {
  readonly pool: RealtimePool;
  readonly streamName?: RealtimeStreamName;
  readonly limit?: number;
  readonly now?: string;
}

export interface RealtimeRetentionCleanupRequest extends RealtimeRetentionCheckRequest {
  readonly authorized: true;
  readonly faultInjection?: Readonly<{
    readonly afterDeleteBeforeFloor?: () => Promise<void> | void;
  }>;
}

export interface RealtimeRetentionResult {
  readonly mode: 'CHECK' | 'APPLY';
  readonly checked_count: number;
  readonly expired_prefix_count: number;
  readonly deleted_count: number;
  readonly previous_floor_event_id: RealtimeBigIntString;
  readonly new_floor_event_id: RealtimeBigIntString;
  readonly candidate_floor_event_id: RealtimeBigIntString;
  readonly batch_limit: number;
  readonly write_performed: boolean;
}

export interface RealtimeConversationItemFixture {
  readonly id: string;
  readonly session_id: string;
  readonly sequence_no: RealtimeBigIntInput;
  readonly item_type: string;
  readonly sender_kind: string;
  readonly visibility: string;
  readonly occurred_at: string;
  readonly retention_until?: string;
  readonly expires_at?: string;
}

export interface RealtimeConversationSessionFixture {
  readonly session_id: string;
  readonly thread_id: string;
  readonly status: string;
  readonly control_mode: string;
  readonly generation_version: RealtimeBigIntInput;
  readonly row_version: RealtimeBigIntInput;
  readonly occurred_at: string;
  readonly event_type?: 'conversation.session.created' | 'conversation.session.updated';
  readonly eventType?: 'conversation.session.created' | 'conversation.session.updated';
  readonly retention_until?: string;
  readonly expires_at?: string;
}

export interface RealtimeTimelineRebuiltFixture {
  readonly session_id: string;
  readonly item_count: number;
  readonly canonical_timeline_hash: string;
  readonly aggregate_version?: RealtimeBigIntInput | null;
  readonly occurred_at: string;
  readonly retention_until?: string;
  readonly expires_at?: string;
}

export interface RealtimeEventStore {
  append(command: RealtimeEventCommand): Promise<RealtimeEventAppendResult>;
  appendStandalone(command: RealtimeEventCommand): Promise<RealtimeEventAppendResult>;
  appendInTransaction(options: {
    readonly transaction: RealtimeSqlExecutor;
    readonly command: RealtimeEventCommand;
  }): Promise<RealtimeEventAppendResult>;
  appendRealtimeEvent(options: {
    readonly transaction: RealtimeSqlExecutor;
    readonly command: RealtimeEventCommand;
  }): Promise<RealtimeEventAppendResult>;
  getHighWatermark(options?: { readonly streamName?: RealtimeStreamName }): Promise<RealtimeHighWatermark>;
  getRealtimeHighWatermark(options?: { readonly streamName?: RealtimeStreamName }): Promise<RealtimeHighWatermark>;
  getReplayWindow(options?: { readonly streamName?: RealtimeStreamName }): Promise<RealtimeReplayWindow>;
  getRealtimeReplayWindow(options?: { readonly streamName?: RealtimeStreamName }): Promise<RealtimeReplayWindow>;
  listAuthorizedEvents(options: Omit<RealtimeListEventsRequest, 'pool'>): Promise<RealtimeReplayPage>;
  listAuthorizedRealtimeEvents(options: Omit<RealtimeListEventsRequest, 'pool'>): Promise<RealtimeReplayPage>;
  checkRetention(
    options?: Omit<RealtimeRetentionCheckRequest, 'pool'>,
  ): Promise<RealtimeRetentionResult>;
  cleanupRetention(
    options: Omit<RealtimeRetentionCleanupRequest, 'pool'>,
  ): Promise<RealtimeRetentionResult>;
}

export interface RealtimeFallbackContract {
  readonly fallback_required: true;
  readonly reason: RealtimeFallbackReason;
  readonly poll_after_ms: number;
  readonly strategy: RealtimeFallbackStrategy;
  readonly latest_event_id: RealtimeBigIntString | null;
  readonly retention_floor_event_id: RealtimeBigIntString | null;
}

export interface RealtimeSseDefaults {
  readonly heartbeatMs: 20000;
  readonly recoveryPollMs: 5000;
  readonly maxClients: 32;
  readonly replayBatchSize: 50;
  readonly maxWritableBufferBytes: 65536;
  readonly drainTimeoutMs: 5000;
}

export declare const REALTIME_SSE_DEFAULTS: RealtimeSseDefaults;
export declare const REALTIME_SSE_ERROR_CODES: Readonly<Record<string, RealtimeErrorCode>>;
export declare const REALTIME_SSE_EVENT_TYPES: readonly RealtimeEventType[];
export declare const REALTIME_SSE_AGGREGATE_TYPES: readonly RealtimeAggregateType[];

export declare class RealtimeEventLogError extends Error {
  readonly code: RealtimeErrorCode;
}

export declare class RealtimeSseError extends Error {
  readonly code: RealtimeErrorCode;
}

export declare function normalizeRealtimeEventCommand(input: unknown): RealtimeEventCommand;
export declare function computeRealtimeEventKey(command: RealtimeEventCommand): string;
export declare function computeRealtimeEventHash(command: RealtimeEventCommand): string;
export declare function publicRealtimeEventFromRow(row: RealtimeEventRow): RealtimePublicEventView;
export declare function mapConversationItemCreatedEvent(
  item: RealtimeConversationItemFixture,
): RealtimeEventCommand;
export declare function mapConversationSessionEvent(
  fixture: RealtimeConversationSessionFixture,
): RealtimeEventCommand;
export declare function mapTimelineRebuiltEvent(
  fixture: RealtimeTimelineRebuiltFixture,
): RealtimeEventCommand;

export declare function applyRealtimeEventLogMigration(
  options: { readonly pool: RealtimePool },
): Promise<void>;
export declare function appendRealtimeEvent(options: {
  readonly transaction: RealtimeSqlExecutor;
  readonly command: RealtimeEventCommand;
}): Promise<RealtimeEventAppendResult>;
export declare function createRealtimeEventStore(options: {
  readonly pool: RealtimePool;
  readonly enabled: boolean;
  readonly defaultRetentionMs?: number;
}): RealtimeEventStore;

export declare function normalizeRealtimeAuthorization(input: unknown): RealtimeAuthorization;
export declare function getRealtimeHighWatermark(options: {
  readonly pool: RealtimePool;
  readonly streamName?: RealtimeStreamName;
}): Promise<RealtimeHighWatermark>;
export declare function getRealtimeReplayWindow(options: {
  readonly pool: RealtimePool;
  readonly streamName?: RealtimeStreamName;
}): Promise<RealtimeReplayWindow>;
export interface RealtimeHighWatermark {
  readonly stream_name: RealtimeStreamName;
  readonly high_watermark_event_id: RealtimeBigIntString;
}

export interface RealtimeListEventsRequest {
  readonly pool: RealtimePool;
  readonly streamName?: RealtimeStreamName;
  readonly afterEventId?: RealtimeBigIntString;
  readonly limit?: number;
  readonly authorization: RealtimeAuthorization;
}

export declare function listAuthorizedRealtimeEvents(
  options: RealtimeListEventsRequest,
): Promise<RealtimeReplayPage>;

export declare function checkRealtimeRetention(
  options: RealtimeRetentionCheckRequest,
): Promise<RealtimeRetentionResult>;

export declare function cleanupRealtimeRetention(
  options: RealtimeRetentionCleanupRequest,
): Promise<RealtimeRetentionResult>;

export declare function buildRealtimeFallback(input: {
  readonly reason: RealtimeFallbackReason;
  readonly pollAfterMs?: number;
  readonly strategy: RealtimeFallbackStrategy;
  readonly latestEventId?: RealtimeBigIntString | null;
  readonly retentionFloorEventId?: RealtimeBigIntString | null;
}): RealtimeFallbackContract;

export declare function parseRealtimeLastEventId(
  input: RealtimeBigIntString | null | undefined,
): RealtimeBigIntString | null;
export { parseRealtimeLastEventId as parseLastEventId };
export declare function encodeRealtimeSseEvent(event: RealtimePublicEventView): string;
export { encodeRealtimeSseEvent as encodeRealtimeSseFrame };
export declare function encodeRealtimeHeartbeat(): ': heartbeat\n\n';
export { encodeRealtimeHeartbeat as encodeRealtimeSseHeartbeat };

export interface RealtimeWakeupLease {
  release(): void;
}

export interface RealtimeWakeupHubSnapshot {
  readonly max_clients: number;
  readonly active_clients: number;
  readonly peak_clients: number;
  readonly closed: boolean;
}

export interface RealtimeWakeupHub {
  readonly maxClients: number;
  trySubscribe(listener: () => void): RealtimeWakeupLease | null;
  subscribe(listener: () => void): RealtimeWakeupLease;
  wakeup(): Readonly<{ notified_count: number; active_clients: number }>;
  notify(): Readonly<{ notified_count: number; active_clients: number }>;
  publish(): Readonly<{ notified_count: number; active_clients: number }>;
  snapshot(): RealtimeWakeupHubSnapshot;
  close(): RealtimeWakeupHubSnapshot;
}

export interface RealtimeSseMetrics {
  readonly max_clients: number;
  readonly active_clients: number;
  readonly peak_clients: number;
  readonly accepted_client_count: number;
  readonly capacity_rejection_count: number;
  readonly replay_query_batch_count: number;
  readonly delivered_event_count: number;
  readonly heartbeat_count: number;
  readonly max_writable_length: number;
  readonly slow_client_disconnect_count: number;
  readonly storage_disconnect_count: number;
  readonly active_heartbeat_timers: number;
  readonly active_recovery_timers: number;
  readonly active_drain_waiters: number;
  readonly open_streams: number;
}

export interface RealtimeSseHandler {
  (request: unknown, response: unknown): Promise<void>;
  readonly handle: RealtimeSseHandler;
  close(): Promise<RealtimeSseMetrics>;
  getMetrics(): RealtimeSseMetrics;
  metrics(): RealtimeSseMetrics;
  wakeup(): Readonly<{ notified_count: number; active_clients: number }>;
  notify(): Readonly<{ notified_count: number; active_clients: number }>;
  readonly wakeupHub: RealtimeWakeupHub;
  hubSnapshot(): RealtimeWakeupHubSnapshot | null;
}

export declare function createRealtimeWakeupHub(options?: {
  readonly maxClients?: number;
}): RealtimeWakeupHub;

export declare function createRealtimeSseHandler(options?: {
  readonly pool?: RealtimePool;
  readonly eventStore?: RealtimeEventStore;
  readonly authenticate?: (request: unknown) => Promise<unknown> | unknown;
  readonly authorize?: (
    principal: unknown,
    context: Readonly<{ request: unknown; scope: 'workbench' }>,
  ) => Promise<RealtimeAuthorization> | RealtimeAuthorization;
  readonly wakeupHub?: RealtimeWakeupHub;
  readonly enabled?: boolean;
  readonly maxClients?: number;
  readonly heartbeatMs?: number;
  readonly recoveryPollMs?: number;
  readonly replayBatchSize?: number;
  readonly maxWritableBufferBytes?: number;
  readonly drainTimeoutMs?: number;
  readonly onMetric?: (metric: Readonly<Record<string, unknown>>) => void;
}): RealtimeSseHandler;
