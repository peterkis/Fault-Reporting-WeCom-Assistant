import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withP2016IsolatedDatabase, applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {migrateP2016} from '../app/server/scripts/p2-016-migrate.mjs';
import {migrateServiceClosure} from '../app/server/scripts/service-closure-migrate.mjs';
import {migrateCompletionDismissal} from '../app/server/scripts/completion-dismissal-migrate.mjs';
import {migrateNotificationVocabulary} from '../app/server/scripts/notification-vocabulary-migrate.mjs';
import {migrateSystemClosureRestore} from '../app/server/scripts/system-closure-restore-migrate.mjs';
import {
  TICKET_TERMINAL_AT_MIGRATION_ID,
  migrateTicketTerminalAt,
  ticketTerminalAtSchemaReady,
} from '../app/server/scripts/ticket-terminal-at-migrate.mjs';
import {withT11Fixture, t11Http, t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {appendTicketEvent, createTicketActionService} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {createTicketClosureService} from '../app/server/src/p1-010-ticket-auto-completion.mjs';
import {createServiceIntakeDecisionPort} from '../app/server/src/p2-015-service-intake-decision-port.mjs';
import {currentClosure, insertClosureRecord, normalizeClosureInput, restoreIntakeClosure} from '../app/server/src/service-closure-records.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime, shanghaiLocalToEpochMs} from '../app/server/src/platform/time-contract.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

interface TicketStampRow {
  status: string;
  version: number;
  terminal_at: string | null;
  terminal_epoch_ms: string | null;
}

async function readTicketStamp(pool: PostgresPool, ticketId: string): Promise<TicketStampRow> {
  const row = (await pool.query<TicketStampRow>(
    `SELECT status, version,
            to_char(terminal_at, 'YYYY-MM-DD HH24:MI:SS') AS terminal_at,
            terminal_epoch_ms::text AS terminal_epoch_ms
       FROM pilot_ticket.ticket
      WHERE id = $1::uuid`,
    [ticketId],
  )).rows[0];
  assert.ok(row, `ticket ${ticketId} must exist`);
  return row;
}

async function latestStatusEventTime(pool: PostgresPool, ticketId: string, newStatus: string): Promise<string> {
  const row = (await pool.query<{at: string}>(
    `SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS at
       FROM pilot_ticket.ticket_event
      WHERE ticket_id = $1::uuid
        AND new_status = $2
        AND old_status IS DISTINCT FROM new_status
      ORDER BY aggregate_version DESC, event_ordinal DESC
      LIMIT 1`,
    [ticketId, newStatus],
  )).rows[0];
  assert.ok(row?.at, `expected status transition event for ${ticketId} -> ${newStatus}`);
  return row.at;
}

test('075 ticket terminal_at migration backfills RESOLVED/COMPLETED/DISMISSED, enforces CHECK constraints & sync trigger, and supports rollback/re-apply', {timeout: 180000}, () =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'term075',
    run: async ({pool, databaseUrl}: {pool: PostgresPool; databaseUrl: string}) => {
      await applyThrough030({pool, databaseUrl});
      const p2016Opts = {databaseUrl, mode: 'apply'};
      await migrateP2016(p2016Opts);
      await migrateServiceClosure({databaseUrl, mode: 'apply'});
      await migrateCompletionDismissal({databaseUrl, mode: 'apply'});
      await migrateNotificationVocabulary({databaseUrl, mode: 'apply'});
      await migrateSystemClosureRestore({databaseUrl, mode: 'apply'});

      const queuedIntake = await seedPersistedIntake({pool, text: '排队工单（合成）', requestType: 'INCIDENT', status: 'RECEIVED'});
      const activeIntake = await seedPersistedIntake({pool, text: '处理中工单（合成）', requestType: 'INCIDENT', status: 'RECEIVED'});
      const resolvedIntake = await seedPersistedIntake({pool, text: '待确认工单（合成）', requestType: 'INCIDENT', status: 'RECEIVED'});
      const completedIntake = await seedPersistedIntake({pool, text: '已完成工单（合成）', requestType: 'INCIDENT', status: 'RECEIVED'});
      const dismissedIntake = await seedPersistedIntake({pool, text: '已关闭工单（合成）', requestType: 'INCIDENT', status: 'RECEIVED'});

      const core = createPilotTicketCore({pool});
      // Create through the real Ticket core (keeps the intake/ticket pair), then stage the pre-075 status/version.
      const insertTicket = async (intakeId: string, label: string, status: string, version: number) => {
        const created = await core.createForIntake({intakeId, occurredAt: assertLocalDateTime('2026-11-20 08:00:00'), traceId: '42a-backfill-' + label});
        const id = created.ticket?.id;
        assert.ok(id);
        await pool.query(
          `UPDATE pilot_ticket.ticket SET status=$2, version=$3, title=$4, created_at='2026-11-20 08:00:00', updated_at='2026-11-20 08:05:00' WHERE id=$1::uuid`,
          [id, status, version, `回填验收 ${label}（合成）`],
        );
        return id;
      };

      const queuedId = await insertTicket(queuedIntake.intakeId, 'T-075-Q', 'QUEUED', 1);
      const activeId = await insertTicket(activeIntake.intakeId, 'T-075-A', 'IN_PROGRESS', 2);
      const resolvedId = await insertTicket(resolvedIntake.intakeId, 'T-075-R', 'RESOLVED', 3);
      const completedId = await insertTicket(completedIntake.intakeId, 'T-075-C', 'COMPLETED', 4);
      const dismissedId = await insertTicket(dismissedIntake.intakeId, 'T-075-D', 'DISMISSED', 3);

      const resolvedAt = '2026-11-21 09:15:30';
      const completedAt = '2026-11-22 14:20:45';
      const oldRestoredEndedAt = '2026-11-19 10:00:00';
      const activeClosureEndedAt = '2026-11-23 16:40:10';

      // Pre-075 events through the existing event writer, then pinned to fixed historical times.
      const seedEvent = async (ticketId: string, eventType: 'ticket.resolved' | 'ticket.completed' | 'ticket.dismissed' | 'ticket.restored',
        oldStatus: 'IN_PROGRESS' | 'RESOLVED' | 'QUEUED' | 'DISMISSED', newStatus: 'RESOLVED' | 'COMPLETED' | 'DISMISSED' | 'QUEUED', version: number, at: string) => {
        const event = await appendTicketEvent({
          transaction: pool, ticket: {id: ticketId, status: newStatus, version}, eventType, oldStatus, newStatus,
          actor: {type: 'SYSTEM', id: null}, traceId: '42a-backfill-seed',
        });
        await pool.query('UPDATE pilot_ticket.ticket_event SET created_at=$2::timestamp without time zone WHERE event_id=$1::uuid', [event.event_id, at]);
        return event.event_id;
      };
      await seedEvent(resolvedId, 'ticket.resolved', 'IN_PROGRESS', 'RESOLVED', 3, resolvedAt);
      await seedEvent(completedId, 'ticket.completed', 'RESOLVED', 'COMPLETED', 4, completedAt);
      // The dismissed ticket was dismissed once, restored, then dismissed again; only the active closure counts.
      const historicalDismissal = await seedEvent(dismissedId, 'ticket.dismissed', 'QUEUED', 'DISMISSED', 2, oldRestoredEndedAt);
      const restoration = await seedEvent(dismissedId, 'ticket.restored', 'DISMISSED', 'QUEUED', 2, '2026-11-19 11:00:00');
      const activeDismissal = await seedEvent(dismissedId, 'ticket.dismissed', 'IN_PROGRESS', 'DISMISSED', 3, '2026-11-23 16:40:00');

      // Historical restored closure record + active closure record: backfill must select the active one.
      const historical = await insertClosureRecord({
        transaction: pool,
        subjectType: 'TICKET',
        subjectId: dismissedId,
        beforeStatus: 'QUEUED',
        beforeTeam: 'PILOT_IT',
        beforeVersion: 1,
        actor: randomUUID(),
        source: 'MANUAL',
        input: normalizeClosureInput({reason_code: 'REPORTER_WITHDREW'}),
        ticketEventId: historicalDismissal,
        endedAt: oldRestoredEndedAt,
      });
      await pool.query(
        `UPDATE pilot_ticket.closure_record SET restored_at='2026-11-19 11:00:00', restored_by=$2::uuid, restoration_event_id=$3::uuid WHERE id=$1::uuid`,
        [historical.id, randomUUID(), restoration],
      );
      await insertClosureRecord({
        transaction: pool,
        subjectType: 'TICKET',
        subjectId: dismissedId,
        beforeStatus: 'IN_PROGRESS',
        beforeTeam: 'PILOT_IT',
        beforeVersion: 2,
        actor: randomUUID(),
        source: 'MANUAL',
        input: normalizeClosureInput({reason_code: 'REPORTER_WITHDREW'}),
        ticketEventId: activeDismissal,
        endedAt: activeClosureEndedAt,
      });

      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'check'}), {
        status: 'PENDING',
        migration_id: TICKET_TERMINAL_AT_MIGRATION_ID,
      });
      // A terminal ticket without terminal evidence is surfaced for repair, never given a guessed time.
      const unprovenIntake = await seedPersistedIntake({pool, text: '缺少完成事件的工单（合成）', requestType: 'INCIDENT', status: 'RECEIVED'});
      const unprovenId = await insertTicket(unprovenIntake.intakeId, 'T-075-X', 'COMPLETED', 4);
      await assert.rejects(migrateTicketTerminalAt({databaseUrl, mode: 'apply'}), /TICKET_TERMINAL_AT_BACKFILL_EVIDENCE_MISSING/u);
      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'check'}), {status: 'PENDING', migration_id: TICKET_TERMINAL_AT_MIGRATION_ID});
      const unprovenAt = '2026-11-22 08:00:07';
      await seedEvent(unprovenId, 'ticket.completed', 'RESOLVED', 'COMPLETED', 4, unprovenAt);
      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'apply'}), {
        status: 'APPLIED',
        migration_id: TICKET_TERMINAL_AT_MIGRATION_ID,
      });
      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'apply'}), {
        status: 'NOOP_ALREADY_APPLIED',
        migration_id: TICKET_TERMINAL_AT_MIGRATION_ID,
      });

      assert.deepEqual(await readTicketStamp(pool, queuedId), {
        status: 'QUEUED', version: 1, terminal_at: null, terminal_epoch_ms: null,
      });
      assert.deepEqual(await readTicketStamp(pool, activeId), {
        status: 'IN_PROGRESS', version: 2, terminal_at: null, terminal_epoch_ms: null,
      });
      assert.deepEqual(await readTicketStamp(pool, resolvedId), {
        status: 'RESOLVED', version: 3, terminal_at: resolvedAt, terminal_epoch_ms: shanghaiLocalToEpochMs(resolvedAt),
      });
      assert.deepEqual(await readTicketStamp(pool, completedId), {
        status: 'COMPLETED', version: 4, terminal_at: completedAt, terminal_epoch_ms: shanghaiLocalToEpochMs(completedAt),
      });
      assert.deepEqual(await readTicketStamp(pool, dismissedId), {
        status: 'DISMISSED', version: 3, terminal_at: activeClosureEndedAt, terminal_epoch_ms: shanghaiLocalToEpochMs(activeClosureEndedAt),
      });

      const indexes = (await pool.query<{indexname: string}>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'pilot_ticket' AND tablename = 'ticket'
          AND indexname IN ('ticket_terminal_idx', 'ticket_resolved_terminal_idx', 'ticket_open_updated_idx')
         ORDER BY indexname`,
      )).rows.map(r => r.indexname);
      assert.deepEqual(indexes, ['ticket_open_updated_idx', 'ticket_resolved_terminal_idx', 'ticket_terminal_idx']);

      // CHECK constraints reject inconsistent terminal states
      await assert.rejects(
        pool.query(`UPDATE pilot_ticket.ticket SET status='COMPLETED', terminal_at=NULL, terminal_epoch_ms=NULL WHERE id=$1::uuid`, [queuedId]),
        /ticket_terminal_status_check/u,
      );
      await assert.rejects(
        pool.query(`UPDATE pilot_ticket.ticket SET terminal_at='2026-11-24 10:00:00', terminal_epoch_ms=NULL WHERE id=$1::uuid`, [queuedId]),
        /ticket_terminal_status_check/u,
      );

      // ARCH-005 sync trigger computes terminal_epoch_ms when terminal_at is updated on a terminal ticket
      const syncedAt = '2026-11-24 12:34:56';
      await pool.query(
        `UPDATE pilot_ticket.ticket SET terminal_at=$2::timestamp without time zone, terminal_epoch_ms=NULL WHERE id=$1::uuid`,
        [completedId, syncedAt],
      );
      assert.deepEqual(await readTicketStamp(pool, completedId), {
        status: 'COMPLETED', version: 4, terminal_at: syncedAt, terminal_epoch_ms: shanghaiLocalToEpochMs(syncedAt),
      });

      // Rollback removes columns/constraints/indexes and re-apply restores cleanly
      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'rollback'}), {
        status: 'ROLLED_BACK',
        migration_id: TICKET_TERMINAL_AT_MIGRATION_ID,
      });
      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'rollback'}), {
        status: 'NOT_APPLIED',
        migration_id: TICKET_TERMINAL_AT_MIGRATION_ID,
      });
      assert.deepEqual(await migrateTicketTerminalAt({databaseUrl, mode: 'apply'}), {
        status: 'APPLIED',
        migration_id: TICKET_TERMINAL_AT_MIGRATION_ID,
      });
      assert.equal((await readTicketStamp(pool, unprovenId)).terminal_at, unprovenAt);
      // Physical drift with an unchanged registry checksum is reported, not treated as already applied.
      assert.equal(await ticketTerminalAtSchemaReady(pool), true);
      await pool.query('ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT ticket_terminal_epoch_check');
      assert.equal(await ticketTerminalAtSchemaReady(pool), false);
      await assert.rejects(migrateTicketTerminalAt({databaseUrl, mode: 'apply'}), /TICKET_TERMINAL_AT_SCHEMA_DRIFT/u);
      await pool.query('DROP INDEX pilot_ticket.ticket_terminal_idx');
      await assert.rejects(migrateTicketTerminalAt({databaseUrl, mode: 'check'}), /TICKET_TERMINAL_AT_SCHEMA_DRIFT/u);
    },
  }));

test('Card 42A-3: every ticket status write path atomically sets or clears terminal_at and 074 intake restore leaves tickets untouched', {timeout: 180000}, async () => {
  await withT11Fixture(async context => {
    const http = await t11Http(context, 0, {closeConnections: true});
    const staffHttp = await t11Http(context, 2, {closeConnections: true});
    const principalId = context.principals[0]?.id;
    const staffId = context.principals[1]?.id;
    assert.ok(principalId && staffId);
    const access = createPilotAccessService({pool: context.pool});
    const actionService = createTicketActionService({pool: context.pool, authorize: access.authorizeAction});

    // 1. resolve (IN_PROGRESS -> RESOLVED)
    const tResolveId = await t11NewTicket(context);
    const tResolveActive = await http.start(tResolveId);
    assert.deepEqual((await readTicketStamp(context.pool, tResolveId)).terminal_at, null);
    const resolvedAction = await actionService.perform({
      ticketId: tResolveId,
      action: 'resolve',
      actor: {type: 'PILOT_USER', id: principalId},
      expectedVersion: tResolveActive.version,
      traceId: '42a-resolve',
      reasonCode: 'SOLVED',
    });
    assert.equal(resolvedAction.ok, true);
    const resolvedStamp = await readTicketStamp(context.pool, tResolveId);
    assert.equal(resolvedStamp.status, 'RESOLVED');
    assert.equal(resolvedStamp.terminal_at, await latestStatusEventTime(context.pool, tResolveId, 'RESOLVED'));
    assert.ok(resolvedStamp.terminal_at);
    assert.equal(resolvedStamp.terminal_epoch_ms, shanghaiLocalToEpochMs(resolvedStamp.terminal_at));

    // 2. confirm (RESOLVED -> COMPLETED)
    const confirmResp = await http.post(tResolveId, 'confirm', {
      client_command_id: randomUUID(),
      expected_version: resolvedStamp.version,
      reason_code: 'REQUESTER_CONFIRMED',
    });
    assert.equal(confirmResp.status, 200, await confirmResp.clone().text());
    const confirmedStamp = await readTicketStamp(context.pool, tResolveId);
    assert.equal(confirmedStamp.status, 'COMPLETED');
    assert.equal(confirmedStamp.terminal_at, await latestStatusEventTime(context.pool, tResolveId, 'COMPLETED'));
    assert.ok(confirmedStamp.terminal_at);
    assert.equal(confirmedStamp.terminal_epoch_ms, shanghaiLocalToEpochMs(confirmedStamp.terminal_at));

    // 3. reopen from COMPLETED (COMPLETED -> REOPENED) clears terminal_at
    const reopenCompletedResp = await http.post(tResolveId, 'reopen', {
      client_command_id: randomUUID(),
      expected_version: confirmedStamp.version,
      reason_code: 'STAFF_REOPEN',
      note: '完成后重开清理终态时间（合成）',
    });
    assert.equal(reopenCompletedResp.status, 200, await reopenCompletedResp.clone().text());
    assert.deepEqual(await readTicketStamp(context.pool, tResolveId), {
      status: 'REOPENED',
      version: confirmedStamp.version + 1,
      terminal_at: null,
      terminal_epoch_ms: null,
    });

    // 4. complete (IN_PROGRESS -> COMPLETED via /complete) & add-note preserves terminal_at
    const tCompleteId = await t11NewTicket(context);
    const tCompleteActive = await staffHttp.start(tCompleteId);
    const completeResp = await staffHttp.post(tCompleteId, 'complete', staffHttp.command(tCompleteActive));
    assert.equal(completeResp.status, 200, await completeResp.clone().text());
    const completedStamp = await readTicketStamp(context.pool, tCompleteId);
    assert.equal(completedStamp.status, 'COMPLETED');
    assert.equal(completedStamp.terminal_at, await latestStatusEventTime(context.pool, tCompleteId, 'COMPLETED'));
    assert.ok(completedStamp.terminal_at);
    assert.equal(completedStamp.terminal_epoch_ms, shanghaiLocalToEpochMs(completedStamp.terminal_at));

    const noteResult = await actionService.perform({
      ticketId: tCompleteId,
      action: 'add-note',
      actor: {type: 'PILOT_USER', id: staffId},
      expectedVersion: completedStamp.version,
      traceId: '42a-add-note',
      reasonCode: 'WORKBENCH_INTERNAL_NOTE',
      note: '同状态补充说明不改写 terminal_at（合成）',
    });
    assert.equal(noteResult.ok, true);
    const afterNoteStamp = await readTicketStamp(context.pool, tCompleteId);
    assert.equal(afterNoteStamp.terminal_at, completedStamp.terminal_at);
    assert.equal(afterNoteStamp.terminal_epoch_ms, completedStamp.terminal_epoch_ms);

    // 5. auto-complete (RESOLVED -> COMPLETED via runAutoComplete) & reopen from RESOLVED
    const tAutoId = await t11NewTicket(context);
    const tAutoActive = await http.start(tAutoId);
    const tAutoResolved = await actionService.perform({
      ticketId: tAutoId,
      action: 'resolve',
      actor: {type: 'PILOT_USER', id: principalId},
      expectedVersion: tAutoActive.version,
      traceId: '42a-auto-resolve',
      reasonCode: 'SOLVED',
    });
    assert.equal(tAutoResolved.ok, true);
    await context.pool.query(
      `UPDATE pilot_ticket.ticket
          SET auto_complete_at = '2026-11-20 00:00:00',
              auto_complete_epoch_ms = NULL,
              auto_complete_reminder_at = '2026-11-19 20:00:00',
              auto_complete_reminder_epoch_ms = NULL
        WHERE id = $1::uuid`,
      [tAutoId],
    );
    const closureService = createTicketClosureService({pool: context.pool, now: () => new Date(), resolveReporterActor: async () => null});
    const autoClosed = await closureService.runAutoComplete({actionService, limit: 10});
    assert.equal(autoClosed.closed_ticket_ids.includes(tAutoId), true);
    const autoClosedStamp = await readTicketStamp(context.pool, tAutoId);
    assert.equal(autoClosedStamp.status, 'COMPLETED');
    assert.equal(autoClosedStamp.terminal_at, await latestStatusEventTime(context.pool, tAutoId, 'COMPLETED'));

    const tReopenResId = await t11NewTicket(context);
    const tReopenResActive = await http.start(tReopenResId);
    const tReopenRes = await actionService.perform({
      ticketId: tReopenResId,
      action: 'resolve',
      actor: {type: 'PILOT_USER', id: principalId},
      expectedVersion: tReopenResActive.version,
      traceId: '42a-reopen-res',
      reasonCode: 'SOLVED',
    });
    assert.equal(tReopenRes.ok, true);
    const resolvedReopenStamp = await readTicketStamp(context.pool, tReopenResId);
    assert.ok(resolvedReopenStamp.terminal_at);
    const reopenedFromResolved = await actionService.perform({
      ticketId: tReopenResId,
      action: 'reopen',
      actor: {type: 'PILOT_USER', id: principalId},
      expectedVersion: resolvedReopenStamp.version,
      traceId: '42a-reopen-from-resolved',
      reasonCode: 'REPORTER_STILL_BROKEN',
    });
    assert.equal(reopenedFromResolved.ok, true);
    assert.deepEqual(await readTicketStamp(context.pool, tReopenResId), {
      status: 'REOPENED',
      version: resolvedReopenStamp.version + 1,
      terminal_at: null,
      terminal_epoch_ms: null,
    });

    // 6. 074 system closure restore on unlinked Intake must not alter any ticket terminal_at
    const systemSeed = await seedPersistedIntake({pool: context.pool, text: '非IT范围系统关闭（合成）', requestType: 'UNKNOWN', status: 'RECEIVED'});
    await transactionP2016(context.pool, transaction =>
      createServiceIntakeDecisionPort({}).apply({
        transaction,
        input: {
          result_code: 'OUT_OF_SCOPE',
          intake_id: systemSeed.intakeId,
          occurred_at: systemSeed.receivedAt,
          trace_id: '42a-074-close',
          decision_id: randomUUID(),
          reason_code: 'OUT_OF_SCOPE',
          catalog_version: '42A',
          rule_set_version: '42A',
        },
      }),
    );
    await transactionP2016(context.pool, async tx => {
      const record = await currentClosure(tx, 'INTAKE', systemSeed.intakeId, true);
      const row = (await tx.query<{version: number; request_type: string}>(
        'SELECT version, request_type FROM intake.service_intake WHERE id=$1::uuid FOR UPDATE',
        [systemSeed.intakeId],
      )).rows[0];
      assert.ok(row);
      await restoreIntakeClosure(tx, {
        intakeId: systemSeed.intakeId,
        version: row.version,
        requestType: row.request_type,
        record,
        actor: null,
        traceId: '42a-074-restore',
        reviewRestored: async () => undefined,
      });
    });
    assert.deepEqual(await readTicketStamp(context.pool, tCompleteId), afterNoteStamp);
  }, {reopenEnabled: true});

  // 7. dismiss + restore + 37A undo within closure window
  await withT24Fixture(async f => {
    const http = await t11Http(f, 0, {closeConnections: true});
    const detail = await http.detail(f.ticketId);
    const dismissed = await http.post(f.ticketId, 'dismiss', {
      client_command_id: randomUUID(),
      expected_version: detail.version,
      reason_code: 'REPORTER_WITHDREW',
      notify_reporter: true,
    });
    assert.equal(dismissed.status, 200, await dismissed.clone().text());
    const dismissedStamp = await readTicketStamp(f.pool, f.ticketId);
    const eventTime = await latestStatusEventTime(f.pool, f.ticketId, 'DISMISSED');
    const closureRow = (await f.pool.query<{ended_at: string; notification_message_id: string | null}>(
      `SELECT to_char(ended_at, 'YYYY-MM-DD HH24:MI:SS') AS ended_at, notification_message_id::text
         FROM pilot_ticket.closure_record
        WHERE ticket_id=$1::uuid AND restored_at IS NULL`,
      [f.ticketId],
    )).rows[0];
    assert.equal(dismissedStamp.status, 'DISMISSED');
    assert.equal(dismissedStamp.terminal_at, eventTime);
    assert.equal(closureRow?.ended_at, eventTime);
    assert.equal(dismissedStamp.terminal_epoch_ms, shanghaiLocalToEpochMs(eventTime));
    assert.ok(closureRow?.notification_message_id);

    const afterDismiss = await http.detail(f.ticketId);
    const restored = await http.post(f.ticketId, 'restore', {
      client_command_id: randomUUID(),
      expected_version: afterDismiss.version,
      reason_code: 'RESTORE_CLOSED',
    });
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.deepEqual(await readTicketStamp(f.pool, f.ticketId), {
      status: detail.status,
      version: afterDismiss.version + 1,
      terminal_at: null,
      terminal_epoch_ms: null,
    });
  }, {closureNotificationUndoWindowMs: 20_000});
});
