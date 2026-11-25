import assert from 'node:assert/strict';
import { withWeb01Fixture, seedCard27Board } from '../helpers/web01-workbench-fixture.mjs';
import type { T11Fixture } from '../helpers/t11-completion-fixture.mjs';
import type { PostgresPool } from '../../app/server/src/platform/postgres-pool.mjs';
import { loadServiceCatalog } from '../../app/server/src/p2-007-service-catalog.mjs';
import { createP2016Runtime } from '../../app/server/src/p2-016-runtime.mjs';
import { migrateWorkbenchFollowUpSchedules } from '../../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import { migrateWorkbenchFollowUpDueSignals } from '../../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import { addInboxSession, attachInboxJourney } from '../helpers/conversation-inbox-fixture.mjs';
import { appendCommunication } from '../../app/server/src/p2-004-communication-core.mjs';
import { transactionP2016 } from '../../app/server/src/p2-016-domain-contracts.mjs';
import { createCommunicationDeliveryWorker } from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import { createCommunicationSenderPort } from '../../app/server/src/p2-004-communication-sender-port.mjs';
import crypto, { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const realRandomUUID = crypto.randomUUID;
let uuidSequence = 0;
// All SQL below runs only inside withWeb01Fixture's newly created, owned UUID database.
// Original integration helpers retain their real clocks and random identities.
async function fixedDefaults(pool: PostgresPool): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS visual_fixture;
CREATE SEQUENCE IF NOT EXISTS visual_fixture.ids;
CREATE OR REPLACE FUNCTION visual_fixture.uuid() RETURNS uuid LANGUAGE sql VOLATILE AS $$
SELECT ('019a7b22-0000-7000-8000-'||lpad(nextval('visual_fixture.ids')::text,12,'0'))::uuid $$;
DO $$ DECLARE col record; BEGIN FOR col IN SELECT n.nspname AS schema_name,c.relname AS table_name,a.attname AS column_name
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname IN ('pilot_ticket','intake','conversation','communication','incident','channel') AND pg_get_expr(d.adbin,d.adrelid) LIKE '%uuidv7()%'
LOOP EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT visual_fixture.uuid()',col.schema_name,col.table_name,col.column_name); END LOOP; END $$;`);
}
async function fixedClock({ pool }: { pool: PostgresPool }): Promise<void> {
  uuidSequence = 0;
  crypto.randomUUID = () =>
    ((0x19a00000 + ++uuidSequence).toString(16) +
      '-1111-7000-8000-' +
      uuidSequence.toString(16).padStart(12, '0')) as ReturnType<typeof randomUUID>;
  syncBuiltinESMExports();
  await fixedDefaults(pool);
  await pool.query(`CREATE OR REPLACE FUNCTION platform.physical_epoch_ms() RETURNS bigint LANGUAGE sql VOLATILE AS $$ SELECT 1794535200000::bigint $$;
CREATE OR REPLACE FUNCTION platform.local_now() RETURNS timestamp without time zone LANGUAGE sql VOLATILE AS $$ SELECT timestamp '2026-11-13 10:00:00' $$`);
}
export interface VisualFixture extends T11Fixture {
  ids: {
    processing: string;
    dismissed: string;
    completed: string;
    conversation: string;
  };
  sessionId: string;
}
export async function withVisualFixture(
  prepare: readonly string[],
  run: (fixture: VisualFixture) => Promise<void>,
): Promise<void> {
  const captureScheduleToasts = prepare.includes('toast-exhibit');
  try {
    await withWeb01Fixture(
      async (original: T11Fixture) => {
        await original.runtime.stop();
        await fixedDefaults(original.pool);
        const p = original.tickets[5],
          c = original.tickets[9];
        assert.ok(p && c);
        await original.pool.query(
          "UPDATE pilot_ticket.ticket SET ticket_no=regexp_replace(ticket_no,'IT-[0-9]{8}','IT-20261113')",
        );
        const closed = await seedCard27Board(original);
        await original.pool.query(
          "UPDATE pilot_ticket.closure_record SET ended_at='2026-11-13 10:00:00' WHERE ticket_id IS DISTINCT FROM $1::uuid",
          [closed.historical],
        );
        await original.pool.query(
          'UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',
          [p.ticket.id, original.principals[0]?.id],
        );
        // Pending/current source fixtures have real retention guards; freeze only their displayed timestamps.
        await original.pool.query(
          "UPDATE intake.service_intake SET created_at='2026-11-13 09:20:00',updated_at='2026-11-13 09:30:00',last_message_at='2026-11-13 09:30:00'",
        );
        await original.pool.query(
          "UPDATE intake.manual_review_item SET created_at='2026-11-13 09:20:00',updated_at='2026-11-13 09:30:00'",
        );
        await original.pool.query(
          "UPDATE intake.web_submission SET received_at='2026-11-13 09:20:00',received_epoch_ms=1794532800000",
        );
        const session = await addInboxSession(original.pool, {
          reporter: 'visual-reporter-01',
          group: null,
          text: '护士站打印机无法连接，请协助排查（合成）。',
        });
        await attachInboxJourney(original.pool, session, {
          name: '欧阳慧敏（合成）',
          department: '心血管内科（合成）',
        });
        await original.pool.query(
          "UPDATE conversation.session SET last_activity_at='2026-11-13 09:35:00' WHERE id=$1::uuid",
          [session.id],
        );
        await original.pool.query(
          "UPDATE conversation.item SET occurred_at='2026-11-13 09:35:00' WHERE session_id=$1::uuid",
          [session.id],
        );
        // Same append/binding/recording-sender seams as Card 21/32. No real transport.
        for (let i = 0; i < 3; i++) {
          const ticket = original.tickets[i + 5];
          assert.ok(ticket);
          const event = (
            await original.pool.query<{
              id: string;
            }>(
              'SELECT event_id::text AS id FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY created_at,event_id LIMIT 1',
              [ticket.ticket.id],
            )
          ).rows[0];
          assert.ok(event);
          const message = await transactionP2016(original.pool, async (tx) => {
            const m = await appendCommunication({
              transaction: tx,
              actor: null,
              command: {
                client_command_id: randomUUID(),
                session_id: null,
                sender_kind: 'SYSTEM',
                sender_system_code: 'TICKET_LIFECYCLE',
                purpose: 'SYSTEM_NOTIFICATION',
                message_type: 'text',
                visibility: 'EXTERNAL',
                text: '打印服务处理进展（合成）',
                privacy_class: 'INTERNAL',
                retention_until: '2027-12-13 10:00:00',
              },
              resolvedDestinations: [
                {
                  provider: 'WECOM_AIBOT',
                  channel_account_id: 'visual-synthetic',
                  target_type: 'PERSON',
                  target_id: 'visual-recipient-' + i,
                },
              ],
            });
            assert.ok(m && 'message_id' in m && m.outbox_id && m.delivery_ids[0]);
            await tx.query(
              `INSERT INTO communication.ticket_notification_binding(
                ticket_event_id,ticket_id,notification_type,recipient_binding_hash,
                destination_type,template_version,message_id,outbox_id,delivery_id)
VALUES($1::uuid,$2::uuid,'TICKET_CREATED',$3,'PERSON','VISUAL_SYNTHETIC',$4::uuid,$5::uuid,$6::uuid)`,
              [
                event.id,
                ticket.ticket.id,
                'a'.repeat(63) + i,
                m.message_id,
                m.outbox_id,
                m.delivery_ids[0],
              ],
            );
            return m;
          });
          const id = message.delivery_ids[0];
          assert.ok(id);
          const worker = createCommunicationDeliveryWorker({
            pool: original.pool,
            enabled: true,
            sender: createCommunicationSenderPort(() => ({
              outcome: i === 1 ? 'UNKNOWN' : 'REJECTED_NOT_APPLIED',
              provider_message_id: null,
              error_code: 'VISUAL_SYNTHETIC',
              retryable: false,
            })),
          });
          await worker.deliver({ deliveryId: id });
          await original.pool.query(
            "UPDATE communication.delivery_attempt SET started_at='2026-11-13 09:40:00',started_epoch_ms=1794534000000 WHERE delivery_id=$1::uuid",
            [id],
          );
        }
        await original.pool.query(
          "UPDATE intake.service_intake SET intake_no=regexp_replace(intake_no,'INT-[0-9]{8}','INT-20261113')",
        );
        const restoreDefaults = async () =>
          original.pool
            .query(`DO $$ DECLARE col record; BEGIN FOR col IN SELECT n.nspname AS s,c.relname AS t,a.attname AS a
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname NOT LIKE 'pg_%' AND pg_get_expr(d.adbin,d.adrelid)='visual_fixture.uuid()'
LOOP EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT uuidv7()',col.s,col.t,col.a); END LOOP; END $$`);
        const runtime = createP2016Runtime({
          pool: original.pool,
          flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true },
          publicOrigin: original.origin,
          listenPort: Number(new URL(original.origin).port),
          principalIds: [
            original.principals[0]?.id ?? '',
            original.outsider.id,
            original.principals[1]?.id ?? '',
          ],
          externalSendEnabled: false,
          ticketSelfHandlingEnabled: true,
          ticketWaitingActionsEnabled: true,
          workbenchInternalNotesEnabled: true,
          workbenchDraftRecoveryEnabled: true,
          workbenchFollowEnabled: true,
          workbenchFollowUpSchedulesEnabled: captureScheduleToasts,
          workbenchSearchEnabled: true,
          workbenchAssignmentHistoryEnabled: true,
          workbenchRealtimeEnabled: true,
          workbenchActivityEnabled: true,
          identityHmacKey: 'conversation-inbox-synthetic-key-v1',
          workbenchConversationsEnabled: true,
          workbenchConversationInboxEnabled: true,
          notificationExceptionsEnabled: true,
        });
        try {
          const started = await runtime.start();
          assert.ok(started.cookies);
          await runtime.coordinator.runOnce();
          await restoreDefaults();
          await run({
            ...original,
            runtime,
            cookies: started.cookies.map((cookie) => cookie.name + '=' + cookie.value),
            browserCookies: started.cookies,
            ids: {
              processing: p.ticket.id,
              dismissed: closed.manual,
              completed: c.ticket.id,
              conversation: session.id,
            },
            sessionId: session.id,
          });
        } finally {
          await runtime.stop();
          assert.equal(runtime.server.listening, false);
        }
      },
      {
        precisionV212: true,
        syntheticServiceCodes: true,
        serviceCatalog: loadServiceCatalog(),
        ticketSelfHandlingEnabled: true,
        workbenchInternalNotesEnabled: true,
        workbenchDraftRecoveryEnabled: true,
        workbenchFollowEnabled: true,
        workbenchSearchEnabled: true,
        partialSchemaOnly: true,
        beforeClosureMigration: async (context) => {
          await fixedClock(context);
          if (captureScheduleToasts) {
            await migrateWorkbenchFollowUpSchedules({ databaseUrl: context.databaseUrl, mode: 'apply' });
            await migrateWorkbenchFollowUpDueSignals({ databaseUrl: context.databaseUrl, mode: 'apply' });
          }
        },
      },
    );
  } finally {
    crypto.randomUUID = realRandomUUID;
    syncBuiltinESMExports();
  }
}
