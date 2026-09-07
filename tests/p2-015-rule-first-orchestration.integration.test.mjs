import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createContactJourneyStore } from '../src/p2-015-contact-journey.mjs';
import { createContinuationRefService } from '../src/p2-015-continuation-ref.mjs';
import { createDecisionStore } from '../src/p2-015-decision-store.mjs';
import { createManualReviewStore } from '../src/p2-015-manual-review.mjs';
import { createRuleFirstOrchestrator } from '../src/p2-015-rule-first-orchestrator.mjs';
import { createExistingTicketCommandPort, createP2004FixedCommunicationPort, createSafeActionExecutor } from '../src/p2-015-safe-action-executor.mjs';
import { createServiceIntakeDecisionPort } from '../src/p2-015-service-intake-decision-port.mjs';
import { migrateCurrentBaseline } from '../scripts/migrate-current-baseline.mjs';
import { migrateP2015, validateP2015Catalog } from '../scripts/p2-015-migrate.mjs';
import { safeHash } from '../src/p2-015-domain-contracts.mjs';
import { applyThrough022, assertNoP2015Residual, seedPersistedIntake, withP2015IsolatedDatabase } from './helpers/p2-015-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const enabled = { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true };

function runtime(pool, { ruleEngine = null, authorizer = { authorizedJourneyIds: async () => [] } } = {}) {
  const decisionStore = createDecisionStore();
  const manualReviewStore = createManualReviewStore({ authorizer });
  const executor = createSafeActionExecutor({ intakeDecisionPort: createServiceIntakeDecisionPort(),
    ticketCommandPort: createExistingTicketCommandPort({ ticketCore: createPilotTicketCore({ pool }) }),
    communicationPort: createP2004FixedCommunicationPort(), manualReviewStore, decisionStore });
  const orchestrator = createRuleFirstOrchestrator({ pool, identityHmacKey: 'p2-015-test-hmac-key-32-characters',
    journeyStore: createContactJourneyStore(), continuationService: createContinuationRefService({ tokenGenerator: () => 'fixed-test-token-value-with-32-characters' }),
    decisionStore, safeActionExecutor: executor, ...(ruleEngine ? { ruleEngine } : {}) });
  return { orchestrator, manualReviewStore };
}

test('migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures', { timeout: 120_000 }, async () => {
  if (!databaseUrl) { assert.equal(databaseUrl, undefined); return; }
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'migfresh', run: async ({ pool, databaseUrl: isolated }) => {
    const fresh = await migrateCurrentBaseline({ databaseUrl: isolated });
    assert.equal(fresh.status, 'APPLIED'); assert.equal(fresh.p2_015.status, 'APPLIED');
    assert.equal((await validateP2015Catalog(pool)).tables.length, 6);
  } });
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'mig022', run: async ({ pool, databaseUrl: isolated }) => {
    await applyThrough022(pool);
    assert.equal((await migrateP2015({ databaseUrl: isolated, mode: 'check' })).status, 'CHECK_ROLLBACK_SUCCEEDED');
    assert.equal((await pool.query("SELECT to_regclass('intake.contact_journey') IS NULL AS missing")).rows[0].missing, true);
    const applied = await migrateP2015({ databaseUrl: isolated });
    assert.equal(applied.status, 'APPLIED'); assert.equal(applied.inventory.tables.length, 6);
    assert.equal((await migrateP2015({ databaseUrl: isolated })).status, 'NOOP_ALREADY_APPLIED');
    const driftCases = [
      ["ALTER TABLE intake.contact_journey RENAME TO contact_journey_drift", 'P2_015_SCHEMA_DRIFT_TABLES'],
      ["ALTER TABLE intake.contact_journey ADD COLUMN forbidden_time timestamptz", 'P2_015_SCHEMA_DRIFT_TIME_TYPES'],
      ["ALTER TABLE intake.contact_journey DROP CONSTRAINT contact_journey_entry_mode_check", 'P2_015_SCHEMA_DRIFT_CONSTRAINTS'],
      ["DROP INDEX intake.contact_journey_evaluation_due_idx", 'P2_015_SCHEMA_DRIFT_INDEXES'],
      ["ALTER TABLE intake.channel_leg DROP CONSTRAINT channel_leg_journey_id_fkey", 'P2_015_SCHEMA_DRIFT_CONSTRAINTS'],
    ];
    for (const [sql, code] of driftCases) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query(sql); await assert.rejects(validateP2015Catalog(client), { code }); }
      finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    }
    const extras = await pool.query(`SELECT
      (SELECT count(*)::integer FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='intake' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal) AS triggers,
      (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='intake' AND p.proname LIKE 'p2_015%') AS functions`,
    [['contact_journey','channel_leg','continuation_ref','deterministic_decision','manual_review_item','safe_action_suggestion']]);
    assert.deepEqual(extras.rows[0], { triggers: 0, functions: 0 });
  } });
});

test('orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely', { timeout: 120_000 }, async () => {
  if (!databaseUrl) { assert.equal(databaseUrl, undefined); return; }
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'runtime', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaseline({ databaseUrl: isolated });
    const allowed = new Set();
    const services = runtime(pool, { authorizer: { authorizedJourneyIds: async () => [...allowed] } });
    const explicit = await seedPersistedIntake({ pool, text: '处方提交不了', chatType: 'group', tag: 'explicit' });
    const first = await services.orchestrator.processPersistedIntake({ service_intake_id: explicit.intakeId, feature_flags: enabled });
    allowed.add(first.journey.id);
    assert.equal(first.journey.entry_mode, 'GROUP_MENTION_INLINE'); assert.equal(first.decision.result_code, 'TICKET_ELIGIBLE');
    const replayed = await Promise.all(Array.from({ length: 12 }, () => services.orchestrator.processPersistedIntake({ service_intake_id: explicit.intakeId, feature_flags: enabled })));
    assert.equal(replayed.every((item) => item.decision.replayed), true);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid', [explicit.intakeId])).rows[0].count, 1);
    const guided = await seedPersistedIntake({ pool, text: '系统不行', chatType: 'group', tag: 'guided' });
    const guidedResult = await services.orchestrator.processPersistedIntake({ service_intake_id: guided.intakeId, feature_flags: enabled });
    allowed.add(guidedResult.journey.id);
    assert.equal(guidedResult.journey.entry_mode, 'GROUP_MENTION_TO_DIRECT_GUIDED');
    assert.equal(guidedResult.decision.result_code, 'NEEDS_DESCRIPTION'); assert.equal(typeof guidedResult.continuation.token, 'string');
    await services.orchestrator.processPersistedIntake({ service_intake_id: guided.intakeId, feature_flags: enabled });
    const communication = await pool.query(`SELECT
      (SELECT count(*)::integer FROM communication.message) AS messages,
      (SELECT count(*)::integer FROM communication.outbox) AS outboxes,
      (SELECT count(*)::integer FROM communication.delivery) AS deliveries`);
    assert.deepEqual(communication.rows[0], { messages: 1, outboxes: 1, deliveries: 1 });
    const direct = await seedPersistedIntake({ pool, text: '重置密码', chatType: 'single', tag: 'direct' });
    const directResult = await services.orchestrator.processPersistedIntake({ service_intake_id: direct.intakeId, feature_flags: enabled });
    allowed.add(directResult.journey.id);
    assert.equal(directResult.journey.entry_mode, 'DIRECT_ORGANIC'); assert.equal(directResult.decision.result_code, 'SERVICE_REQUEST');
    const legs = await pool.query(`SELECT journey_id::text,leg_type,conversation_thread_id::text FROM intake.channel_leg ORDER BY journey_id,leg_ordinal`);
    assert.equal(legs.rows.length, 3); assert.equal(new Set(legs.rows.map((row) => row.journey_id)).size, 3);
    assert.equal(legs.rows.some((row) => row.leg_type === 'GROUP_ORIGIN'), true); assert.equal(legs.rows.some((row) => row.leg_type === 'DIRECT_ORGANIC'), true);
    const leaks = await pool.query(`SELECT
      (SELECT count(*)::integer FROM intake.continuation_ref WHERE token_hash='fixed-test-token-value-with-32-characters') AS raw_tokens,
      (SELECT count(*)::integer FROM intake.contact_journey WHERE reporter_identity_hash='user-test') AS raw_users`);
    assert.deepEqual(leaks.rows[0], { raw_tokens: 0, raw_users: 0 });
    assert.equal(first.model_provider_calls + guidedResult.model_provider_calls + directResult.model_provider_calls, 0);
    assert.equal(first.sender_calls + guidedResult.sender_calls + directResult.sender_calls, 0);
  } });
});

test('rule failure reaches review; authorized keyset query and concurrent human resolution append one override', { timeout: 120_000 }, async () => {
  if (!databaseUrl) { assert.equal(databaseUrl, undefined); return; }
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'review', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaseline({ databaseUrl: isolated });
    const allowed = new Set();
    const failing = { rule_set_version: 'broken', evaluate() { throw new Error('private provider detail'); } };
    const services = runtime(pool, { ruleEngine: failing, authorizer: { authorizedJourneyIds: async () => [...allowed] } });
    const source = await seedPersistedIntake({ pool, text: '无法安全判断', tag: 'review' });
    const result = await services.orchestrator.processPersistedIntake({ service_intake_id: source.intakeId, feature_flags: enabled });
    allowed.add(result.journey.id); assert.equal(result.decision.result_code, 'MANUAL_REVIEW_REQUIRED');
    const listed = await services.manualReviewStore.list({ transaction: pool, principal: { principal_id: 'seat' }, limit: 30 });
    assert.equal(listed.items.length, 1); assert.equal(JSON.stringify(listed).includes('private provider detail'), false);
    const principal = await pool.query(`INSERT INTO pilot_ticket.pilot_principal(wecom_user_id,display_name) VALUES ('synthetic-seat','Synthetic Seat') RETURNING id::text`);
    const command = { review_id: listed.items[0].id, expected_row_version: listed.items[0].row_version,
      client_command_id: '10000000-0000-4000-8000-000000000001', resolution_code: 'REQUEST_DESCRIPTION',
      resolution_reason_code: 'HUMAN_REQUESTED_DESCRIPTION', resolved_at: '2026-09-03 12:05:00' };
    const secondCommand = { ...command, client_command_id: '10000000-0000-4000-8000-000000000002' };
    const resolveCommand = async (selectedCommand) => {
      const client = await pool.connect(); try { await client.query('BEGIN'); const value = await services.manualReviewStore.resolve({ transaction: client, principal: { principal_id: principal.rows[0].id }, command: selectedCommand }); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    };
    const settled = await Promise.allSettled([resolveCommand(command), resolveCommand(secondCommand)]);
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
    const winning = settled[0].status === 'fulfilled' ? command : secondCommand;
    assert.equal((await resolveCommand(winning)).replayed, true);
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM intake.deterministic_decision WHERE journey_id=$1::uuid AND status='HUMAN_OVERRIDDEN'`, [result.journey.id])).rows[0].count, 1);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM intake.manual_review_item WHERE status<>\'PENDING\'')).rows[0].count, 1);
    // The current baseline includes authorized 032; P2-015 still cannot create Incident facts.
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.candidate_review')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM communication.incident_notification_binding')).rows[0].count, 0);
  } });
});

test('continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use', { timeout: 120_000 }, async () => {
  if (!databaseUrl) { assert.equal(databaseUrl, undefined); return; }
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'continue', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaseline({ databaseUrl: isolated });
    const services = runtime(pool);
    const source = await seedPersistedIntake({ pool, text: '系统不行', tag: 'continue' });
    const initial = await services.orchestrator.processPersistedIntake({ service_intake_id: source.intakeId, feature_flags: enabled });
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM intake.continuation_ref WHERE token_hash=$1', [initial.continuation.token])).rows[0].count, 0);
    const tokens = ['token-A-abcdefghijklmnopqrstuvwxyz012345','token-B-abcdefghijklmnopqrstuvwxyz012345','token-C-abcdefghijklmnopqrstuvwxyz012345'];
    const continuation = createContinuationRefService({ tokenGenerator: () => tokens.shift() });
    const issue = (key, ttl = 120) => continuation.issue({ transaction: pool, input: {
      journey_id: initial.journey.id, origin_leg_id: initial.leg.id, purpose: 'EXPLICIT_CONTINUATION',
      reporter_binding_hash: safeHash({ reporter: 'a' }), bot_binding_hash: safeHash({ bot: 'a' }),
      issue_idempotency_key: key, issued_at: '2026-09-03 12:00:00', issued_epoch_ms: '1788408000000', ttl_minutes: ttl,
    } });
    const first = await issue('continuation-command-0001');
    const replay = await issue('continuation-command-0001');
    assert.equal(replay.id, first.id); assert.equal(replay.token, null); assert.equal(replay.replayed, true);
    await assert.rejects(continuation.consume({ transaction: pool, input: { token: first.token, purpose: 'EXPLICIT_CONTINUATION',
      reporter_binding_hash: safeHash({ reporter: 'wrong' }), bot_binding_hash: safeHash({ bot: 'a' }), target_leg_id: initial.leg.id,
      consumed_at: '2026-09-03 12:00:10', consumed_epoch_ms: '1788408010000' } }), { code: 'P2_015_CONTINUATION_BINDING_MISMATCH' });
    const consumed = await continuation.consume({ transaction: pool, input: { token: first.token, purpose: 'EXPLICIT_CONTINUATION',
      reporter_binding_hash: safeHash({ reporter: 'a' }), bot_binding_hash: safeHash({ bot: 'a' }), target_leg_id: initial.leg.id,
      consumed_at: '2026-09-03 12:00:10', consumed_epoch_ms: '1788408010000' } });
    assert.equal(consumed.state, 'CONSUMED');
    await assert.rejects(continuation.consume({ transaction: pool, input: { token: first.token, purpose: 'EXPLICIT_CONTINUATION',
      reporter_binding_hash: safeHash({ reporter: 'a' }), bot_binding_hash: safeHash({ bot: 'a' }), target_leg_id: initial.leg.id,
      consumed_at: '2026-09-03 12:00:11', consumed_epoch_ms: '1788408011000' } }), { code: 'P2_015_CONTINUATION_CONSUMED' });
    const expired = await issue('continuation-command-0002', 1);
    await assert.rejects(continuation.consume({ transaction: pool, input: { token: expired.token, purpose: 'EXPLICIT_CONTINUATION',
      reporter_binding_hash: safeHash({ reporter: 'a' }), bot_binding_hash: safeHash({ bot: 'a' }), target_leg_id: initial.leg.id,
      consumed_at: '2026-09-03 12:02:00', consumed_epoch_ms: '1788408120000' } }), { code: 'P2_015_CONTINUATION_EXPIRED' });
    const revoked = await issue('continuation-command-0003');
    await continuation.revoke({ transaction: pool, id: revoked.id, revoked_at: '2026-09-03 12:00:20', revoked_epoch_ms: '1788408020000' });
    await assert.rejects(continuation.consume({ transaction: pool, input: { token: revoked.token, purpose: 'EXPLICIT_CONTINUATION',
      reporter_binding_hash: safeHash({ reporter: 'a' }), bot_binding_hash: safeHash({ bot: 'a' }), target_leg_id: initial.leg.id,
      consumed_at: '2026-09-03 12:00:30', consumed_epoch_ms: '1788408030000' } }), { code: 'P2_015_CONTINUATION_EXPIRED' });
  } });
});

test('migration 001 through 022 and P2-007 runtime are unchanged from origin/main', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const names = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\','/')}`, 'diff', '--name-only', 'origin/main...HEAD', '--', 'database/migrations/001_*', 'database/migrations/002_*', 'database/migrations/003_*', 'database/migrations/004_*', 'database/migrations/005_*', 'database/migrations/006_*', 'database/migrations/007_*', 'database/migrations/008_*', 'database/migrations/009_*', 'database/migrations/010_*', 'database/migrations/011_*', 'database/migrations/012_*', 'database/migrations/020_*', 'database/migrations/021_*', 'database/migrations/022_*', 'src/p2-007-*'], { cwd: root, encoding: 'utf8' });
  assert.equal(names.status, 0); assert.equal(names.stdout.trim(), '');
});

test.after(async () => { if (databaseUrl) await assertNoP2015Residual({ databaseUrl }); });
