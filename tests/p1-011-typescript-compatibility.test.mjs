import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPilotAlertRegistry, createPilotSecurityLogger, createPilotTelemetry, createPilotReadinessService, createCoreIntakeSafetyBoundary, createPilotOperationsService } from '../src/p1-011-pilot-operations-baseline.mjs';

test('T04-03 preserves omitted arguments, validation and alert identity', async () => {
  assert.throws(() => createPilotSecurityLogger(), /identity hash key/);
  assert.throws(() => createPilotReadinessService(), /coreChecks/);
  assert.throws(() => createCoreIntakeSafetyBoundary(), /acceptCore/);
  assert.throws(() => createPilotOperationsService(), /PostgreSQL pool/);
  const alerts = createPilotAlertRegistry();
  assert.equal(alerts.raise('PILOT_BACKUP_STALE', 'backup'), alerts.raise('PILOT_BACKUP_STALE', 'backup'));
  assert.throws(() => alerts.raise('PILOT_BACKUP_STALE', 'person'), /allowlisted/);
  alerts.resolve('PILOT_BACKUP_STALE', 'backup');
  assert.deepEqual(alerts.snapshot(), []);
  const telemetry = createPilotTelemetry();
  assert.throws(() => telemetry.increment('unknown'), /allowlisted/);
  assert.throws(() => telemetry.setGauge('pilot_core_readiness', {}, NaN), /finite/);
});

test('T04-03 core failure never runs enhancements and successful core identity survives degradation', async () => {
  const failure = new Error('core failure');
  let enhancements = 0;
  const failed = createCoreIntakeSafetyBoundary({ acceptCore() { throw failure; }, optionalEnhancements: { ai() { enhancements++; } } });
  await assert.rejects(failed.accept({}), e => e === failure);
  assert.equal(enhancements, 0);
  const core = { accepted: true };
  const boundary = createCoreIntakeSafetyBoundary({ acceptCore: () => core, optionalEnhancements: { ai() { throw new Error('optional'); }, redis: () => ({ ok: true }) } });
  const result = await boundary.accept({});
  assert.equal(result.core, core);
  assert.deepEqual(result.degraded_dependencies, ['ai']);
});

test('T04-03 external transaction is query-only; owned rollback failure destroys client', async () => {
  const commands = [];
  const fail = new Error('write failed');
  let released;
  const client = { async query(sql) { commands.push(sql); if (sql === 'ROLLBACK' || sql.startsWith('INSERT')) throw fail; }, release(destroy) { released = destroy; } };
  const pool = { query() {}, async connect() { return client; } };
  const service = createPilotOperationsService({ pool });
  const input = { restoreId: 'restore-test', failureCode: 'RESTORE_FAILED', completedAt: '2030-01-01 08:00:00' };
  await assert.rejects(service.recordRestoreDrillFailure(input), e => e === fail);
  assert.equal(commands[0], 'BEGIN');
  assert.equal(commands.at(-1), 'ROLLBACK');
  assert.equal(released, true);
  commands.length = 0;
  const transaction = { async query(sql) { commands.push(sql); return { rows: [], rowCount: 1 }; } };
  const result = await service.recordRestoreDrillFailure({ ...input, transaction });
  assert.equal(result.backup_id, null);
  assert.equal(result.status, 'FAILED');
  assert.equal(commands.length, 1);
  assert.match(commands[0], /^INSERT INTO operations.audit_event/);
  await assert.rejects(service.assessBackupFreshness(), /positive safe integer/);
  await assert.rejects(service.listAuditEvents(), /actorId/);
});
