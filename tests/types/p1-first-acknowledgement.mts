import { createFirstAcknowledgementService } from '../../src/p1-008-first-acknowledgement.mjs';
import { createChannelMessageInbox } from '../../src/p1-003-channel-message-inbox.mjs';
import { createServiceIntakeProcessor } from '../../src/p1-004-service-intake.mjs';
import { createPilotTicketCore } from '../../src/p1-005-pilot-ticket-core.mjs';
import { createTicketClosureService, createTicketLifecycleProcessor } from '../../src/p1-010-ticket-closure.mjs';
import { createNotificationDeliveryWorker } from '../../src/p1-007-notification-outbox.mjs';
import type { PostgresPool } from '../../src/platform/postgres-pool.mjs';

declare const pool: PostgresPool;
const inbox = createChannelMessageInbox({ pool });
const processor = createTicketLifecycleProcessor({ serviceIntakeProcessor: createServiceIntakeProcessor(), ticketCore: createPilotTicketCore({ pool }), closure: createTicketClosureService({ pool }) });
const deliveryWorker = createNotificationDeliveryWorker({ pool, sender: async () => ({}) });
const acknowledgement = createFirstAcknowledgementService({ inbox, processor, deliveryWorker });
const accepted = await acknowledgement.accept({});
if (accepted.ok) {
  const state: 'NO_TICKET' | 'PENDING' | 'SENT' | 'ALREADY_DELIVERED' = accepted.acknowledgement.state;
  void state;
} else {
  // @ts-expect-error -- An Inbox failure cannot claim a post-commit acknowledgement.
  accepted.acknowledgement;
}
// @ts-expect-error -- Delivery implementations must preserve the Delivery result contract.
createFirstAcknowledgementService({ inbox, processor, deliveryWorker: { deliver: async () => ({ status: 1 }) } });
// @ts-expect-error -- The clock returns Date values, never serialized timestamps.
createFirstAcknowledgementService({ inbox, processor, deliveryWorker, now: () => '2026-10-01' });

const restrictedInbox = { accept: async (_request: { onlyThisRequest: string }) => ({ ok: false as const, error: { code: 'SYNTHETIC', retryable: false } }) };
// @ts-expect-error -- The raw request port must accept unknown, not one narrow request shape.
createFirstAcknowledgementService({ inbox: restrictedInbox, processor, deliveryWorker });
// @ts-expect-error -- First acknowledgement forwards unvalidated snapshot IDs to the existing worker guard.
createFirstAcknowledgementService({ inbox, processor, deliveryWorker: { deliver: async (_input: { deliveryId: string }) => null } });
// @ts-expect-error -- Optional replay lookup must also accept raw snapshot IDs.
createFirstAcknowledgementService({ inbox, processor, deliveryWorker: { deliver: deliveryWorker.deliver, getDelivery: async (_input: { deliveryId: 'only-one-id' }) => null } });
if (accepted.ok && accepted.acknowledgement.state === 'PENDING' && 'delivery_id' in accepted.acknowledgement) {
  // @ts-expect-error -- A fallback from the generic persisted snapshot is not yet a validated string.
  const unvalidatedId: string = accepted.acknowledgement.delivery_id;
  if (typeof accepted.acknowledgement.delivery_id === 'string') accepted.acknowledgement.delivery_id.toUpperCase();
  void unvalidatedId;
}
if (accepted.ok && (accepted.acknowledgement.state === 'SENT' || accepted.acknowledgement.state === 'ALREADY_DELIVERED')) {
  const validatedId: string = accepted.acknowledgement.delivery_id;
  void validatedId;
}

import type { NotificationDeliveryWorker } from '../../src/p1-007-notification-outbox.mjs';
// @ts-expect-error -- Pre-labelling a narrower Worker must not bypass function-property variance.
const narrowedWorker: NotificationDeliveryWorker = { deliver: async (_input: { deliveryId: 'only-one-id' }) => null, getDelivery: deliveryWorker.getDelivery, runOnce: deliveryWorker.runOnce };
void narrowedWorker;
