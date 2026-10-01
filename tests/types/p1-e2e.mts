import { createPilotE2EHandler, evaluatePilotGoNoGo } from '../../src/p1-012-pilot-e2e.mjs';
import { createChannelMessageInbox } from '../../src/p1-003-channel-message-inbox.mjs';
import { createServiceIntakeProcessor } from '../../src/p1-004-service-intake.mjs';
import { createPilotTicketCore } from '../../src/p1-005-pilot-ticket-core.mjs';
import { createTicketClosureService, createTicketLifecycleProcessor } from '../../src/p1-010-ticket-closure.mjs';
import { createNotificationDeliveryWorker } from '../../src/p1-007-notification-outbox.mjs';
import type { PostgresPool } from '../../src/platform/postgres-pool.mjs';

declare const pool: PostgresPool;
const inbox = createChannelMessageInbox({ pool });
const processor = createTicketLifecycleProcessor({ serviceIntakeProcessor: createServiceIntakeProcessor(), ticketCore: createPilotTicketCore({ pool }), closure: createTicketClosureService({ pool }) });
const worker = createNotificationDeliveryWorker({ pool, sender: async () => ({}) });
const handler = createPilotE2EHandler({ testGroupId: 'synthetic', testAccountUserIds: ['synthetic'], triggerToken: 'run', accept: request => inbox.accept(request, processor), reply: async (_frame, body) => ({ errcode: body.msgtype === 'text' ? 0 : 1 }), deliver: worker.deliver });
const result = await handler.handleFrame({});
if (result.outcome === 'processed') {
  const scenario: 'GROUP_TEXT' | 'GROUP_IMAGE_DEGRADED' = result.scenario;
  if (result.core.accepted) {
    const created: boolean = result.core.ticket_created;
    void created;
  } else {
    // @ts-expect-error -- Failed admission does not contain a successful ticket result.
    result.core.ticket_created;
  }
  void scenario;
} else {
  // @ts-expect-error -- Ignored and rejected callbacks contain no Delivery observation.
  result.delivery;
}
const decision: 'GO' | 'NO_GO' = evaluatePilotGoNoGo({}).decision;
void decision;
// @ts-expect-error -- E2E callbacks return the actual admission result, never a boolean.
createPilotE2EHandler({ testGroupId: 'synthetic', testAccountUserIds: ['synthetic'], triggerToken: 'run', accept: async () => true, reply: async () => ({}) });
// @ts-expect-error -- The only scenarios are the scoped text and image-degraded runs.
createPilotE2EHandler({ testGroupId: 'synthetic', testAccountUserIds: ['synthetic'], triggerToken: 'run', scenario: 'UNSCOPED', accept: request => inbox.accept(request, processor), reply: async () => ({}) });
