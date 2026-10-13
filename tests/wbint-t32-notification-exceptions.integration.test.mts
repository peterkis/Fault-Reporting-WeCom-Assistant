import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {createCommunicationSenderPort} from '../src/p2-004-communication-sender-port.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {entryConfig, entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import type {NotificationExceptionPage, NotificationExceptionItem, NotificationExceptionHostOptions} from '../contracts/workbench_notification_exception_contracts.js';

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test('T32 public exceptions paginate only current readable Ticket failures and recheck the exact item parent', {timeout: 240000}, async () => {
  await withT24Fixture(async original => {
    await original.runtime.stop();
    const options = {
      pool: original.pool, publicOrigin: original.origin,
      listenPort: Number(new URL(original.origin).port),
      principalIds: [original.principals[0]?.id ?? '', original.outsider.id, original.principals[1]?.id ?? ''],
      flags: {TICKET_LIFECYCLE_WORKBENCH_ENABLED: true as const, REPORTER_TIMELINE_ENABLED: true, WECOM_TEMPLATE_CARD_ENABLED: true},
      ticketSelfHandlingEnabled: true, ticketRoundNotificationsEnabled: true,
      externalSendEnabled: true, notificationExceptionsEnabled: true,
      reporterOrigin: 'https://reporter.example.test', reporterHmacSecret: entryKey,
      reporterPolicy: 'MEMBER_REQUIRED' as const, reporterMemberEntry: entryConfig,
      wecomWebOAuth: {enabled: true, corpId: entryConfig.corpId, agentId: entryConfig.agentId, resolveCode: async () => {throw Error('T32_NO_REAL_OAUTH');}},
    } satisfies Parameters<typeof createP2016Runtime>[0] & NotificationExceptionHostOptions;
    const runtime = createP2016Runtime(options);
    let primaryError: unknown;
    try {
      await listenConversationWorkbenchServer(runtime.server, {port: options.listenPort});
      const browserCookies = runtime.authenticate.browserCookies?.(); assert.ok(browserCookies);
      const context = {...original, runtime, browserCookies, cookies: browserCookies.map(c => c.name + '=' + c.value)};
      const admin = await t11Http(context, 0), reader = await t11Http(context, 2);
      const core = createPilotTicketCore({pool: context.pool});
      let senderCalls = 0;
      const worker = createCommunicationDeliveryWorker({pool: context.pool, enabled: true, sender: createCommunicationSenderPort(() => {
        senderCalls++;
        return {outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'T32_SYNTHETIC_REJECTED', retryable: false};
      })});
      const exceptions: {ticketId: string; deliveryId: string}[] = [];
      for (const [index, actor] of [reader, admin, reader].entries()) {
        const intake = await seedPersistedIntake({pool: context.pool, text: 'T32_INTERNAL_FORBIDDEN_' + index, chatType: 'single', requestType: 'INCIDENT', status: 'RECEIVED', tag: 't32-first-' + index});
        const created = await core.createForIntake({intakeId: intake.intakeId, occurredAt: intake.receivedAt, traceId: 't32-first'});
        assert.ok(created.ticket);
        await actor.start(created.ticket.id);
        await runtime.roundNotifications.runOnce();
        const response = await admin.get('/api/tickets/' + created.ticket.id + '/deliveries'); assert.equal(response.status, 200);
        const data = record(await response.json()); assert.ok(Array.isArray(data.items));
        const deliveries = data.items.map(record); assert.equal(deliveries.length, 1);
        const deliveryId = deliveries[0]?.delivery_id; assert.equal(typeof deliveryId, 'string');
        assert.ok(await worker.deliver({deliveryId: String(deliveryId)}));
        const after = record(await (await admin.get('/api/tickets/' + created.ticket.id + '/deliveries')).json()); assert.ok(Array.isArray(after.items));
        assert.equal(record(after.items[0]).status, 'DEAD_LETTER');
        exceptions.push({ticketId: created.ticket.id, deliveryId: String(deliveryId)});
        // Persisted timestamps are second-precision; make the hidden failure genuinely interleaved.
        if (index < 2) await delay(1100);
      }
      const currentReader = await createPilotAccessService({pool: context.pool}).upsertPrincipal({wecomUserId: 'web01-synthetic-1', displayName: 'T32当前处理人', roles: ['HANDLER'], resolverTeamIds: []});
      assert.equal(currentReader.id, original.principals[1]?.id);
      const oldest = exceptions[0], hidden = exceptions[1], newest = exceptions[2]; assert.ok(oldest && hidden && newest);
      assert.equal((await reader.get('/api/tickets/' + oldest.ticketId)).status, 200);
      assert.equal((await reader.get('/api/tickets/' + newest.ticketId)).status, 200);
      assert.equal((await reader.get('/api/tickets/' + hidden.ticketId)).status, 404);
      assert.equal(senderCalls, 3);

      const response = await reader.get('/api/notification-exceptions?domain=TICKET&limit=1');
      assert.equal(response.status, 200, 'a real authorized exceptions GET must be mounted');
      const page = await response.json() as NotificationExceptionPage;
      assert.deepEqual(Object.keys(page).sort(), ['has_more', 'items', 'next_cursor']);
      assert.equal(page.items.length, 1); assert.equal(page.items[0]?.delivery_id, newest.deliveryId);
      assert.equal(page.items[0]?.parent_id, newest.ticketId); assert.equal(page.items[0]?.domain, 'TICKET');
      assert.equal(page.items[0]?.status, 'DEAD_LETTER'); assert.equal(page.has_more, true); assert.equal(typeof page.next_cursor, 'string');
      const secondResponse = await reader.get('/api/notification-exceptions?domain=TICKET&limit=1&cursor=' + encodeURIComponent(String(page.next_cursor)));
      assert.equal(secondResponse.status, 200);
      const second = await secondResponse.json() as NotificationExceptionPage;
      assert.equal(second.items.length, 1); assert.equal(second.items[0]?.delivery_id, oldest.deliveryId);
      assert.equal(second.has_more, false); assert.equal(second.next_cursor, null);
      const itemResponse = await reader.get('/api/notification-exceptions/ticket/' + newest.ticketId + '/' + newest.deliveryId);
      assert.equal(itemResponse.status, 200); assert.deepEqual(await itemResponse.json() as NotificationExceptionItem, page.items[0]);
      assert.equal((await reader.get('/api/notification-exceptions/ticket/' + hidden.ticketId + '/' + hidden.deliveryId)).status, 404);
      assert.equal((await reader.get('/api/notification-exceptions/ticket/' + oldest.ticketId + '/' + newest.deliveryId)).status, 404);
      assert.equal(/T32_INTERNAL_FORBIDDEN|target_id|target_hash|channel_account|provider_message|raw_identity|content_hash|binding_hash/u.test(JSON.stringify([page, second])), false);
      assert.equal(senderCalls, 3, 'reading does not deliver or retry');
    } catch (error) { primaryError = error; throw error; }
    finally { await closeBrowserTestResources(primaryError, [async () => {await runtime.stop(); assert.equal(runtime.server.listening, false);}]); }
  }, {manualRoundConsumption: true, externalSendEnabled: true});
});
