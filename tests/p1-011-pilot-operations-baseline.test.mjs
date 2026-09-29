import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before } from 'node:test';
import test from 'node:test';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { formatEpochMsToShanghaiLocal } from '../src/platform/time-contract.mjs';
import { adaptWeComSdkFrame } from '../src/p1-002-wecom-sdk-adapter.mjs';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration, createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration, createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration, createNotificationOutbox } from '../src/p1-007-notification-outbox.mjs';
import {
  applyPilotAccessMigration,
  closePilotWorkbenchServer,
  createPilotWorkbenchServer,
  listenPilotWorkbenchServer,
} from '../src/p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration, createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import {
  applyPilotOperationsMigration,
  createPilotAlertRegistry,
  createCoreIntakeSafetyBoundary,
  createPilotOperationsService,
  createPilotOperationalIntake,
  createPilotReadinessService,
  createPilotSecurityLogger,
  createPilotTelemetry,
} from '../src/p1-011-pilot-operations-baseline.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const pool = databaseUrl
  ? createPostgresPool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 2_000 })
  : null;
const runtimeMessageIds = new Set();
const runtimeIntakeIds = new Set();
const runtimeTicketIds = new Set();

function retentionFor(message) {
  const retentionUntilEpochMs = String(BigInt(message.received_epoch_ms) + 86_400_000n);
  return {
    retentionUntil: formatEpochMsToShanghaiLocal(retentionUntilEpochMs),
    retentionUntilEpochMs,
  };
}

before(async () => {
  if (!pool) {
    return;
  }
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyPilotAccessMigration({ pool });
  await applyTicketClosureMigration({ pool });
  await applyPilotOperationsMigration({ pool });
});

after(async () => {
  if (!pool) {
    return;
  }
  if (runtimeTicketIds.size > 0) {
    await pool.query(
      `UPDATE intake.service_intake
          SET pilot_ticket_id = NULL,
              status = CASE WHEN status = 'TICKET_CREATED' THEN 'RECEIVED' ELSE status END
        WHERE pilot_ticket_id = ANY($1::uuid[])`,
      [[...runtimeTicketIds]],
    );
    await pool.query('DELETE FROM pilot_ticket.ticket WHERE id = ANY($1::uuid[])', [[...runtimeTicketIds]]);
  }
  if (runtimeIntakeIds.size > 0) {
    await pool.query('DELETE FROM intake.service_intake WHERE id = ANY($1::uuid[])', [[...runtimeIntakeIds]]);
  }
  if (runtimeMessageIds.size > 0) {
    await pool.query(
      'DELETE FROM channel.message_inbox WHERE provider = $1 AND msg_id = ANY($2::text[])',
      ['WECOM_AIBOT', [...runtimeMessageIds]],
    );
  }
  await pool.end();
});

test('P1-011 writes only a redacted, structured operational log record', () => {
  const records = [];
  const logger = createPilotSecurityLogger({
    identityHashKey: 'p1-011-test-log-hash-key',
    writeRecord: (record) => records.push(record),
  });

  const record = logger.record({
    event: 'ticket.created',
    traceId: 'trace-p1-011-security',
    msgId: 'wecom-msg-011',
    actorId: 'user-zhangsan',
    chatId: 'group-clinical-it',
    status: 'accepted',
    errorCode: 'NONE',
    durationMs: 43,
    details: {
      bot_secret: 'wecom-secret-for-test',
      patient_text: '患者住院号 A1234567，姓名张三',
      media_url: 'https://example.test/media?aeskey=aes-key-for-test',
    },
  });

  const serialized = JSON.stringify(record);
  for (const value of [
    'p1-011-test-log-hash-key',
    'user-zhangsan',
    'group-clinical-it',
    'wecom-secret-for-test',
    'A1234567',
    '张三',
    'https://example.test/media',
    'aes-key-for-test',
  ]) {
    assert.equal(serialized.includes(value), false);
  }
  assert.match(record.actor_hash, /^hmac-sha256:[a-f0-9]{24}$/u);
  assert.match(record.chat_hash, /^hmac-sha256:[a-f0-9]{24}$/u);
  assert.deepEqual(record, records[0]);
  assert.equal(record.event, 'ticket.created');
  assert.equal(record.trace_id, 'trace-p1-011-security');
  assert.equal(record.msg_id, 'wecom-msg-011');
  assert.equal(record.status, 'accepted');
  assert.equal(record.error_code, 'NONE');
  assert.equal(record.duration_ms, 43);
  assert.deepEqual(record.redaction_codes, [
    'SECRET_FIELD',
    'PATIENT_SENSITIVE_FIELD',
    'MEDIA_REFERENCE_FIELD',
  ]);
  assert.equal(Object.hasOwn(record, 'details'), false);
});

test('P1-011 keeps a persisted core intake available when optional dependencies fail', async () => {
  const telemetry = createPilotTelemetry();
  const readiness = createPilotReadinessService({
    coreChecks: {
      postgres: async () => ({ ok: true }),
      intake: async () => ({ ok: true }),
      outbox: async () => ({ ok: true }),
    },
    optionalChecks: {
      redis: async () => { throw new Error('redis password=not-for-log'); },
      ai: async () => ({ ok: false }),
    },
    telemetry,
  });

  const availability = await readiness.assess();
  assert.deepEqual(availability, {
    ready: true,
    core_failures: [],
    degraded_dependencies: ['ai', 'redis'],
  });

  let coreAcceptCalls = 0;
  const boundaryAlerts = createPilotAlertRegistry();
  const boundary = createCoreIntakeSafetyBoundary({
    acceptCore: async () => {
      coreAcceptCalls += 1;
      return { ok: true, ticket: { id: 'ticket-p1-011' } };
    },
    optionalEnhancements: {
      redis: async () => { throw new Error('redis token=not-for-log'); },
      ai: async () => ({ ok: false }),
    },
    telemetry,
    alerts: boundaryAlerts,
  });

  const accepted = await boundary.accept({ message_id: 'message-p1-011' });
  assert.equal(coreAcceptCalls, 1);
  assert.deepEqual(accepted, {
    core: { ok: true, ticket: { id: 'ticket-p1-011' } },
    degraded_dependencies: ['ai', 'redis'],
  });
  assert.deepEqual(
    boundaryAlerts.snapshot().map(({ code, scope }) => ({ code, scope })),
    [
      { code: 'PILOT_OPTIONAL_DEPENDENCY_DEGRADED', scope: 'ai' },
      { code: 'PILOT_OPTIONAL_DEPENDENCY_DEGRADED', scope: 'redis' },
    ],
  );

  const metrics = telemetry.snapshot();
  assert.deepEqual(metrics, [
    {
      name: 'pilot_core_readiness',
      labels: {},
      value: 1,
    },
    {
      name: 'pilot_optional_dependency_degraded_total',
      labels: { dependency: 'ai' },
      value: 2,
    },
    {
      name: 'pilot_optional_dependency_degraded_total',
      labels: { dependency: 'redis' },
      value: 2,
    },
  ]);
  assert.equal(JSON.stringify(metrics).includes('not-for-log'), false);
});

integrationTest('P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle', async () => {
  const msgId = `p1-011-operational-${randomUUID()}`;
  const secret = 'p1-011-secret-must-not-reach-operational-log';
  const patientText = '患者张三住院号 A1234567 的 HIS 登录失败';
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-011-operational-test',
      chattype: 'group',
      chatid: `group-${msgId}`,
      from: { userid: `reporter-${msgId}` },
      msgtype: 'text',
      text: { content: `${patientText}; token=${secret}` },
    },
  }, { receivedAt: new Date().toISOString() });
  assert.equal(adapted.ok, true);
  runtimeMessageIds.add(msgId);

  const records = [];
  let logWriteMode = 'success';
  let logAlertThrows = false;
  const logAlerts = createPilotAlertRegistry();
  const runtime = createPilotOperationalIntake({
    pool,
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure: createTicketClosureService({
      pool,
      outbox: createNotificationOutbox(),
      resolveReporterActor: async () => null,
    }),
    coreChecks: {
      postgres: async () => ({ ok: true }),
      intake: async () => ({ ok: true }),
      outbox: async () => ({ ok: true }),
    },
    optionalChecks: {
      ai: async () => ({ ok: false }),
    },
    optionalEnhancements: {
      ai: async () => { throw new Error(`token=${secret}`); },
    },
    identityHashKey: 'p1-011-runtime-log-hash-key',
    alerts: {
      ...logAlerts,
      raise(code, scope) {
        if (logAlertThrows && code === 'PILOT_SECURITY_LOG_WRITE_FAILED') throw new Error('synthetic alert sink failure');
        return logAlerts.raise(code, scope);
      },
    },
    writeLogRecord: (record) => {
      if (logWriteMode === 'sync-failure') throw new Error('synthetic synchronous log failure');
      if (logWriteMode === 'thenable-failure') return { then(_resolve, reject) { reject(new Error('synthetic thenable failure')); } };
      return (async () => {
        await Promise.resolve();
        if (logWriteMode === 'failure') throw new Error(`password=${secret}`);
        records.push(record);
      })();
    },
  });
  const accepted = await runtime.accept({
    message: adapted.message,
    traceId: `trace-${msgId}`,
    privacyClass: 'PATIENT_SENSITIVE',
    ...retentionFor(adapted.message),
  });

  assert.equal(accepted.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  runtimeIntakeIds.add(accepted.result.intake.id);
  assert.ok(accepted.result.ticket);
  runtimeTicketIds.add(accepted.result.ticket.id);
  assert.deepEqual(runtime.telemetry.snapshot(), [
    { name: 'pilot_core_readiness', labels: {}, value: 1 },
    { name: 'pilot_optional_dependency_degraded_total', labels: { dependency: 'ai' }, value: 2 },
  ]);
  const serializedLogs = JSON.stringify(records);
  for (const value of [secret, patientText, 'A1234567', msgId, `reporter-${msgId}`]) {
    assert.equal(serializedLogs.includes(value), false);
  }
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'pilot.intake.accepted');
  assert.equal(runtime.alerts.snapshot().some((alert) => alert.code === 'PILOT_OPTIONAL_DEPENDENCY_DEGRADED'), true);
  assert.equal(runtime.alerts.snapshot().some((alert) => alert.code === 'PILOT_SECURITY_LOG_WRITE_FAILED'), false);
  for (const mode of ['sync-failure', 'thenable-failure', 'failure']) {
    logWriteMode = mode;
    logAlertThrows = mode === 'failure';
    const replay = await runtime.accept({ message: adapted.message, traceId: `trace-${msgId}`, privacyClass: 'INTERNAL', ...retentionFor(adapted.message) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replay.ok, true);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.result.ticket.id, accepted.result.ticket.id);
  }
  logAlertThrows = false;


  const logFailureMsgId = `p1-011-log-failure-${randomUUID()}`;
  const logFailureMessage = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${logFailureMsgId}` },
    body: {
      msgid: logFailureMsgId,
      aibotid: 'bot-p1-011-operational-test',
      chattype: 'group',
      chatid: `group-${logFailureMsgId}`,
      from: { userid: `reporter-${logFailureMsgId}` },
      msgtype: 'text',
      text: { content: 'HIS 登录失败，提示权限错误' },
    },
  }, { receivedAt: new Date().toISOString() });
  assert.equal(logFailureMessage.ok, true);
  runtimeMessageIds.add(logFailureMsgId);
  logWriteMode = 'failure';
  const acceptedWithLogFailure = await runtime.accept({
    message: logFailureMessage.message,
    traceId: `trace-${logFailureMsgId}`,
    privacyClass: 'INTERNAL',
    ...retentionFor(logFailureMessage.message),
  });
  assert.equal(acceptedWithLogFailure.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  runtimeIntakeIds.add(acceptedWithLogFailure.result.intake.id);
  runtimeTicketIds.add(acceptedWithLogFailure.result.ticket.id);
  assert.equal(runtime.alerts.snapshot().some((alert) => alert.code === 'PILOT_SECURITY_LOG_WRITE_FAILED'), true);

  const logRecoveryMsgId = `p1-011-log-recovery-${randomUUID()}`;
  const logRecoveryMessage = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${logRecoveryMsgId}` },
    body: {
      msgid: logRecoveryMsgId,
      aibotid: 'bot-p1-011-operational-test',
      chattype: 'group',
      chatid: `group-${logRecoveryMsgId}`,
      from: { userid: `reporter-${logRecoveryMsgId}` },
      msgtype: 'text',
      text: { content: 'HIS 登录失败，提示权限错误已恢复' },
    },
  }, { receivedAt: new Date().toISOString() });
  assert.equal(logRecoveryMessage.ok, true);
  runtimeMessageIds.add(logRecoveryMsgId);
  logWriteMode = 'success';
  const acceptedAfterLogRecovery = await runtime.accept({
    message: logRecoveryMessage.message,
    traceId: `trace-${logRecoveryMsgId}`,
    privacyClass: 'INTERNAL',
    ...retentionFor(logRecoveryMessage.message),
  });
  assert.equal(acceptedAfterLogRecovery.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  runtimeIntakeIds.add(acceptedAfterLogRecovery.result.intake.id);
  runtimeTicketIds.add(acceptedAfterLogRecovery.result.ticket.id);
  assert.equal(runtime.alerts.snapshot().some((alert) => alert.code === 'PILOT_SECURITY_LOG_WRITE_FAILED'), false);
});

test('P1-011 alerts with stable codes without carrying the rejected sensitive values', async () => {
  const alerts = createPilotAlertRegistry({ now: () => new Date('2026-08-29T01:00:00.000Z') });
  let postgresAvailable = false;
  const logger = createPilotSecurityLogger({
    identityHashKey: 'p1-011-alert-log-hash-key',
    alerts,
  });
  logger.record({
    event: 'message.received',
    traceId: 'trace-p1-011-alert',
    msgId: 'message-p1-011-alert',
    status: 'accepted',
    errorCode: 'NONE',
    durationMs: 1,
    details: { token: 'do-not-place-this-token-in-an-alert' },
  });
  const readiness = createPilotReadinessService({
    coreChecks: {
      postgres: async () => ({ ok: postgresAvailable }),
      intake: async () => ({ ok: true }),
      outbox: async () => ({ ok: true }),
    },
    alerts,
  });
  await readiness.assess();

  assert.deepEqual(alerts.snapshot(), [
    {
      code: 'PILOT_CORE_UNAVAILABLE',
      severity: 'P1',
      scope: 'postgres',
      status: 'ACTIVE',
      opened_at: '2026-08-29 09:00:00',
    },
    {
      code: 'PILOT_SENSITIVE_LOG_REJECTED',
      severity: 'P1',
      scope: 'SECRET_FIELD',
      status: 'ACTIVE',
      opened_at: '2026-08-29 09:00:00',
    },
  ]);
  assert.equal(JSON.stringify(alerts.snapshot()).includes('do-not-place-this-token-in-an-alert'), false);

  postgresAvailable = true;
  await readiness.assess();
  assert.deepEqual(alerts.snapshot(), [
    {
      code: 'PILOT_SENSITIVE_LOG_REJECTED',
      severity: 'P1',
      scope: 'SECRET_FIELD',
      status: 'ACTIVE',
      opened_at: '2026-08-29 09:00:00',
    },
  ]);
});

test('P1-011 serves the Pilot workbench under a same-origin CSP without inline code', async () => {
  const server = createPilotWorkbenchServer({
    access: {
      listWorkQueue: async () => ({ ok: true, items: [] }),
      getTicketView: async () => ({ ok: false }),
    },
    actions: { perform: async () => ({ ok: true }) },
    authenticate: async () => ({ type: 'PILOT_USER', id: 'pilot-user' }),
  });
  const address = await listenPilotWorkbenchServer(server, { host: '127.0.0.1', port: 0 });
  try {
    const [page, script, stylesheet] = await Promise.all([
      fetch(`http://127.0.0.1:${address.port}/`),
      fetch(`http://127.0.0.1:${address.port}/static/pilot-workbench.js`),
      fetch(`http://127.0.0.1:${address.port}/static/pilot-workbench.css`),
    ]);
    const html = await page.text();
    const javascript = await script.text();

    assert.equal(page.status, 200);
    assert.equal(script.status, 200);
    assert.equal(stylesheet.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/u);
    assert.equal(page.headers.get('content-security-policy').includes('unsafe-inline'), false);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match(html, /<script src="\/static\/pilot-workbench\.js" defer><\/script>/u);
    assert.equal(html.includes('fetch('), false);
    assert.match(html, /<link rel="stylesheet" href="\/static\/pilot-workbench\.css">/u);
    assert.match(javascript, /textContent/u);
    assert.equal(javascript.includes('innerHTML'), false);
  } finally {
    await closePilotWorkbenchServer(server);
  }
});

integrationTest('P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail', async () => {
  const transaction = await pool.connect();
  try {
    await transaction.query('BEGIN');
    let clock = new Date('2030-08-29T00:00:00.000Z');
    const alerts = createPilotAlertRegistry({ now: () => clock });
    const admin = await transaction.query(
      `INSERT INTO pilot_ticket.pilot_principal (wecom_user_id, display_name)
       VALUES ($1, $2)
       RETURNING id::text`,
      [`p1-011-admin-${randomUUID()}`, 'P1-011 审计管理员'],
    );
    const reporter = await transaction.query(
      `INSERT INTO pilot_ticket.pilot_principal (wecom_user_id, display_name)
       VALUES ($1, $2)
       RETURNING id::text`,
      [`p1-011-reporter-${randomUUID()}`, 'P1-011 申报人'],
    );
    await transaction.query(
      'INSERT INTO pilot_ticket.pilot_principal_role (principal_id, role) VALUES ($1::uuid, $2)',
      [admin.rows[0].id, 'ADMIN'],
    );
    await transaction.query(
      'INSERT INTO pilot_ticket.pilot_principal_role (principal_id, role) VALUES ($1::uuid, $2)',
      [reporter.rows[0].id, 'REPORTER'],
    );

    const operations = createPilotOperationsService({ pool, alerts, now: () => clock });
    const backupId = `backup-p1-011-${randomUUID()}`;
    const checkpoint = await operations.recordBackupCheckpoint({
      transaction,
      backupId,
      checksumSha256: 'e'.repeat(64),
      sizeBytes: 10_000_000_000,
      encryptionKeyId: 'pilot-backup-key-v1',
      retentionUntil: '2030-09-28 08:00:00',
    });
    const repeatedCheckpoint = await operations.recordBackupCheckpoint({ transaction, backupId, checksumSha256: 'e'.repeat(64), sizeBytes: 10_000_000_000, encryptionKeyId: 'pilot-backup-key-v1', retentionUntil: '2030-09-28 08:00:00' });
    assert.deepEqual(repeatedCheckpoint, checkpoint);
    await assert.rejects(operations.recordBackupCheckpoint({ transaction, backupId, checksumSha256: 'f'.repeat(64), sizeBytes: 10_000_000_000, encryptionKeyId: 'pilot-backup-key-v1', retentionUntil: '2030-09-28 08:00:00' }), { code: 'P1_011_BACKUP_CHECKPOINT_CONFLICT' });
    await assert.rejects(operations.recordBackupCheckpoint({ transaction, backupId: 'backup-invalid', checksumSha256: 'e'.repeat(64), sizeBytes: 1, encryptionKeyId: 'key', retentionUntil: '2030-08-29 08:00:00' }), /retentionUntil must be after/);
    await assert.rejects(operations.recordRestoreDrill({ transaction, backupId: 'backup-absent', restoreId: 'restore-absent', verifiedObjectCount: 1 }), { code: 'P1_011_BACKUP_NOT_FOUND' });
    await assert.rejects(operations.recordRestoreDrill({ transaction, backupId, restoreId: 'restore-inconsistent', verifiedObjectCount: 0 }), /Restore result is inconsistent/);
    const restore = await operations.recordRestoreDrill({
      transaction,
      backupId,
      restoreId: `restore-p1-011-${randomUUID()}`,
      verifiedObjectCount: 12,
    });
    const repeatedRestore = await operations.recordRestoreDrill({ transaction, backupId, restoreId: restore.restore_id, verifiedObjectCount: 12 });
    assert.deepEqual(repeatedRestore, restore);
    await assert.rejects(operations.recordRestoreDrill({ transaction, backupId, restoreId: restore.restore_id, verifiedObjectCount: 13 }), { code: 'P1_011_RESTORE_DRILL_CONFLICT' });
    const failedRestore = await operations.recordRestoreDrillFailure({
      transaction,
      backupId,
      restoreId: `restore-p1-011-failed-${randomUUID()}`,
      failureCode: 'P1_011_RESTORE_COMMAND_FAILED',
    });

    assert.equal(checkpoint.backup_id, backupId);
    assert.equal(checkpoint.checksum_sha256, 'e'.repeat(64));
    assert.equal(checkpoint.size_bytes, 10_000_000_000);
    assert.equal(restore.backup_id, backupId);
    assert.equal(restore.status, 'SUCCEEDED');
    assert.equal(failedRestore.status, 'FAILED');
    assert.equal(failedRestore.failure_code, 'P1_011_RESTORE_COMMAND_FAILED');
    assert.equal(alerts.snapshot().some((alert) => alert.code === 'PILOT_RESTORE_DRILL_FAILED'), true);

    clock = new Date('2030-08-30T00:00:00.000Z');
    assert.deepEqual(await operations.assessBackupFreshness({ transaction, maximumAgeMs: 1 }), {
      fresh: false,
      code: 'PILOT_BACKUP_STALE',
      latest_checkpoint_at: '2030-08-29 08:00:00',
    });
    clock = new Date('2030-08-29T00:00:00.500Z');
    assert.deepEqual(await operations.assessBackupFreshness({ transaction, maximumAgeMs: 1_000 }), {
      fresh: true,
      code: null,
      latest_checkpoint_at: '2030-08-29 08:00:00',
    });
    assert.equal(alerts.snapshot().some((alert) => alert.code === 'PILOT_BACKUP_STALE'), false);

    assert.deepEqual(await operations.listAuditEvents({ transaction, actorId: reporter.rows[0].id }), {
      ok: false,
      error: { code: 'FORBIDDEN', retryable: false },
    });
    const audit = await operations.listAuditEvents({ transaction, actorId: admin.rows[0].id, limit: 10 });
    assert.equal(audit.ok, true);
    const backupEvent = audit.items.find((item) => item.event_type === 'backup.completed');
    const failedRestoreEvent = audit.items.find((item) => item.event_type === 'backup.restore_drill_failed');
    assert.ok(backupEvent);
    assert.ok(failedRestoreEvent);
    assert.equal(JSON.stringify(backupEvent).includes('P1-011 审计管理员'), false);
    assert.equal(JSON.stringify(backupEvent).includes('postgresql://'), false);
    assert.equal(failedRestoreEvent.metadata.failure_code, 'P1_011_RESTORE_COMMAND_FAILED');

    await transaction.query('SAVEPOINT immutable_audit_check');
    try {
      await assert.rejects(
        () => transaction.query(
          'UPDATE operations.audit_event SET event_type = $2 WHERE id = $1::uuid',
          [backupEvent.id, 'security.log_redacted'],
        ),
        /P1_011_AUDIT_IMMUTABLE/u,
      );
    } finally {
      await transaction.query('ROLLBACK TO SAVEPOINT immutable_audit_check');
    }
    await transaction.query('SAVEPOINT sensitive_metadata_check');
    try {
      await assert.rejects(
        () => transaction.query(
          `INSERT INTO operations.audit_event (event_key, event_type, metadata)
           VALUES ($1, $2, $3::jsonb)`,
          [
            `security-test:${randomUUID()}`,
            'backup.completed',
            JSON.stringify({ backup_id: 'patient-text-must-not-be-stored' }),
          ],
        ),
        /operations_audit_event_metadata_safe/u,
      );
    } finally {
      await transaction.query('ROLLBACK TO SAVEPOINT sensitive_metadata_check');
    }
    await transaction.query('SAVEPOINT sensitive_event_key_check');
    try {
      await assert.rejects(
        () => transaction.query(
          `INSERT INTO operations.audit_event (event_key, event_type, metadata)
           VALUES ($1, $2, $3::jsonb)`,
          [
            'patient name Zhang San must not be stored',
            'security.log_redacted',
            JSON.stringify({ result: 'SUCCEEDED' }),
          ],
        ),
        /operations_audit_event_key_format_check/u,
      );
    } finally {
      await transaction.query('ROLLBACK TO SAVEPOINT sensitive_event_key_check');
    }
  } finally {
    await transaction.query('ROLLBACK');
    transaction.release();
  }
});
