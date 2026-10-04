import { createRealtimeEventStore, mapConversationItemCreatedEvent, normalizeRealtimeEventCommand } from '../../src/p2-003-realtime-event-log.mjs';
import type { RealtimeMappedEvent } from '../../src/p2-003-realtime-event-log.mjs';
import type { PostgresTransaction } from '../../src/platform/postgres-pool.mjs';
const store = createRealtimeEventStore({ enabled: false });
const item = mapConversationItemCreatedEvent({});
const sequence: string = item.payload.sequence_no;
const normalized = normalizeRealtimeEventCommand({});
declare const transaction: PostgresTransaction;
void store.appendInTransaction({ transaction, command: normalized });
void store.append(item);
// @ts-expect-error -- Event aggregate versions stay canonical strings, never numbers.
void store.append({ ...normalized, aggregate_version: 9007199254740992 });
// @ts-expect-error -- A transaction capability is required for transactional append.
void store.appendInTransaction({ command: normalized });
// @ts-expect-error -- The authored item event cannot carry a rebuild payload.
const wrongItem: RealtimeMappedEvent<'conversation.item.created'> = { ...item, payload: { session_id: 'synthetic', item_count: 1 } };
declare const mapped: RealtimeMappedEvent;
if (mapped.event_type === 'conversation.timeline.rebuilt') {
  const count: number = mapped.payload.item_count;
  void count;
} else if (mapped.event_type === 'conversation.item.created') {
  const cursor: string = mapped.payload.sequence_no;
  void cursor;
}
void sequence; void wrongItem;

import { createTimelineProjector } from '../../src/p2-002-timeline-projector.mjs';
declare const checkpoint: NonNullable<Awaited<ReturnType<ReturnType<typeof createTimelineProjector>['getProjectionCheckpoint']>>>;
const emptyBatchHash: typeof checkpoint.last_batch_hash = null;
// @ts-expect-error -- An initial persisted checkpoint may have a null last batch hash.
const mandatoryHash: string = checkpoint.last_batch_hash;
void emptyBatchHash; void mandatoryHash;
