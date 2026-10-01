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
