import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { decryptBackupStream, encryptBackupStream } from '../src/p1-011-encrypted-backup.mjs';
import {
  applyPilotOperationsMigration,
  createPilotAlertRegistry,
  createPilotOperationsService,
} from '../src/p1-011-pilot-operations-baseline.mjs';

const REQUIRED_TABLES = Object.freeze([
  ['channel', 'message_inbox'],
  ['intake', 'service_intake'],
  ['intake', 'service_intake_event'],
  ['pilot_ticket', 'ticket'],
  ['pilot_ticket', 'ticket_event'],
  ['pilot_ticket', 'pilot_principal'],
  ['notification', 'outbox'],
  ['notification', 'delivery'],
  ['notification', 'delivery_attempt'],
  ['notification', 'card_action_task'],
  ['operations', 'audit_event'],
  ['operations', 'backup_checkpoint'],
  ['operations', 'restore_drill'],
]);
const BACKUP_SCHEMAS = Object.freeze(['channel', 'intake', 'pilot_ticket', 'notification', 'operations']);

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function nonEmpty(value, code, maximum = 4_096) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw failure(code);
  }
  return value;
}

function parsePositiveInteger(value, code, maximum) {
  if (!/^\d+$/u.test(String(value ?? ''))) {
    throw failure(code);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw failure(code);
  }
  return parsed;
}

function safeDatabaseName(value, code) {
  const database = nonEmpty(value, code, 63);
  if (!/^[A-Za-z0-9_-]+$/u.test(database)) {
    throw failure(code);
  }
  return database;
}

function executable(binary, directory) {
  if (directory === null) {
    return binary;
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw failure('P1_011_PG_BIN_INVALID');
  }
  return join(directory, process.platform === 'win32' ? `${binary}.exe` : binary);
}

function commandEnvironment(baseEnvironment, password) {
  const {
    PILOT_DATABASE_URL: _databaseUrl,
    PILOT_BACKUP_ENCRYPTION_KEY: _encryptionKey,
    ...withoutDatabaseCredentials
  } = baseEnvironment;
  return { ...withoutDatabaseCredentials, PGPASSWORD: password };
}

/**
 * Returns password-free PostgreSQL utility arguments. The password remains in
 * closures used only for child-process environment construction and Pool setup.
 */
export function buildPgConnectionArgs(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(nonEmpty(databaseUrl, 'P1_011_DATABASE_URL_INVALID'));
  } catch {
    throw failure('P1_011_DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hostname.length === 0
    || /\s/u.test(parsed.hostname)) {
    throw failure('P1_011_DATABASE_URL_INVALID');
  }
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = safeDatabaseName(decodeURIComponent(parsed.pathname.replace(/^\//u, '')), 'P1_011_DATABASE_URL_INVALID');
  const port = parsed.port.length === 0
    ? '5432'
    : String(parsePositiveInteger(parsed.port, 'P1_011_DATABASE_URL_INVALID', 65_535));
  if (username.length === 0 || password.length === 0 || username.length > 256) {
    throw failure('P1_011_DATABASE_URL_INVALID');
  }
  const commonArgs = Object.freeze([
    '--host', parsed.hostname,
    '--port', port,
    '--username', username,
  ]);
  const argsForDatabase = (targetDatabase) => Object.freeze([
    ...commonArgs,
    '--dbname', safeDatabaseName(targetDatabase, 'P1_011_DATABASE_NAME_INVALID'),
  ]);
  return Object.freeze({
    args: argsForDatabase(database),
    common_args: commonArgs,
    database,
    argsForDatabase,
    environmentFor: (baseEnvironment = process.env) => commandEnvironment(baseEnvironment, password),
    poolConfigFor: (targetDatabase) => Object.freeze({
      host: parsed.hostname,
      port: Number(port),
      user: username,
      password,
      database: safeDatabaseName(targetDatabase, 'P1_011_DATABASE_NAME_INVALID'),
      max: 1,
      connectionTimeoutMillis: 5_000,
    }),
  });
}

export function parseBackupRestoreArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return Object.freeze({ mode: 'check' });
  }
  if (argv.length === 1 && argv[0] === '--drill') {
    return Object.freeze({ mode: 'drill' });
  }
  throw failure('P1_011_BACKUP_ARGS');
}

export function validateBackupRestoreConfig(env = process.env) {
  const keyText = nonEmpty(env.PILOT_BACKUP_ENCRYPTION_KEY, 'P1_011_BACKUP_ENCRYPTION_KEY_MISSING', 512);
  const encryptionKey = Buffer.from(keyText, 'base64');
  if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== keyText) {
    throw failure('P1_011_BACKUP_ENCRYPTION_KEY_INVALID');
  }
  const encryptionKeyId = nonEmpty(env.PILOT_BACKUP_ENCRYPTION_KEY_ID, 'P1_011_BACKUP_ENCRYPTION_KEY_ID_MISSING', 128);
  if (!/^[A-Za-z0-9_.:-]+$/u.test(encryptionKeyId)) {
    throw failure('P1_011_BACKUP_ENCRYPTION_KEY_ID_INVALID');
  }
  const retentionDays = parsePositiveInteger(env.PILOT_BACKUP_RETENTION_DAYS, 'P1_011_BACKUP_RETENTION_DAYS_INVALID', 3_650);
  const pgBinDirectory = env.PILOT_PG_BIN ? String(env.PILOT_PG_BIN) : null;
  const workDirectory = env.PILOT_BACKUP_WORK_DIRECTORY ? String(env.PILOT_BACKUP_WORK_DIRECTORY) : null;
  if (workDirectory !== null && !isAbsolute(workDirectory)) {
    throw failure('P1_011_BACKUP_WORK_DIRECTORY_INVALID');
  }
  return Object.freeze({
    connection: buildPgConnectionArgs(env.PILOT_DATABASE_URL),
    encryptionKey,
    encryptionKeyId,
    retentionDays,
    pgBinDirectory,
    workDirectory,
    drillApproved: String(env.PILOT_BACKUP_RESTORE_DRILL_APPROVED ?? '').toLowerCase() === 'true',
  });
}

function waitForExit(child, code) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', () => reject(failure(code)));
    child.once('close', (exitCode) => {
      if (exitCode === 0) {
        resolvePromise();
      } else {
        reject(failure(code));
      }
    });
  });
}

function runQuiet(command, args, environment, code, { stdin = 'ignore', stdout = 'ignore' } = {}) {
  const child = spawn(command, args, {
    env: environment,
    stdio: [stdin, stdout, 'ignore'],
    windowsHide: true,
  });
  return Object.freeze({ child, completed: waitForExit(child, code) });
}

async function hashArtifact(artifactPath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(artifactPath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function restoreDatabaseName() {
  return `p1_011_restore_${randomUUID().replaceAll('-', '')}`;
}

function assertRestoreDatabaseName(value) {
  if (!/^p1_011_restore_[a-f0-9]{32}$/u.test(value)) {
    throw failure('P1_011_RESTORE_DATABASE_INVALID');
  }
}

async function verifyRestoredDatabase(connection, restoreDatabase) {
  const pool = new Pool(connection.poolConfigFor(restoreDatabase));
  try {
    const verified = await pool.query(
      `SELECT count(*)::integer AS verified_object_count
         FROM (VALUES
           ('channel', 'message_inbox'),
           ('intake', 'service_intake'),
           ('intake', 'service_intake_event'),
           ('pilot_ticket', 'ticket'),
           ('pilot_ticket', 'ticket_event'),
           ('pilot_ticket', 'pilot_principal'),
           ('notification', 'outbox'),
           ('notification', 'delivery'),
           ('notification', 'delivery_attempt'),
           ('notification', 'card_action_task'),
           ('operations', 'audit_event'),
           ('operations', 'backup_checkpoint'),
           ('operations', 'restore_drill')
         ) AS expected(schema_name, table_name)
        WHERE to_regclass(format('%I.%I', expected.schema_name, expected.table_name)) IS NOT NULL`,
    );
    const objectCount = verified.rows[0].verified_object_count;
    if (objectCount !== REQUIRED_TABLES.length) {
      throw failure('P1_011_RESTORE_VERIFICATION_FAILED');
    }
    return objectCount;
  } finally {
    await pool.end();
  }
}

/**
 * Performs an encrypted, temporary logical backup and isolated restore drill.
 * It never places the source credential in an argument vector or writes a
 * plaintext dump. The generated restoration database has a fixed random name
 * and is dropped during cleanup.
 */
function stableErrorCode(error, fallback = 'P1_011_BACKUP_RESTORE_FAILED') {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code)
    ? code
    : fallback;
}

function attachDrillFailure(error, context) {
  const target = error instanceof Error ? error : failure('P1_011_BACKUP_RESTORE_FAILED');
  const failureCode = stableErrorCode(target);
  target.code = failureCode;
  target.p1_011_drill = Object.freeze({
    ...context,
    failure_code: failureCode,
  });
  return target;
}

export async function runBackupRestoreDrill({
  env = process.env,
  now = () => new Date(),
  alerts = null,
  onCheckpoint = null,
} = {}) {
  const config = validateBackupRestoreConfig(env);
  if (!config.drillApproved) {
    throw failure('P1_011_BACKUP_RESTORE_DRILL_APPROVAL_REQUIRED');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }
  if (alerts !== null && (!alerts || typeof alerts.raise !== 'function')) {
    throw failure('P1_011_BACKUP_ALERTS_INVALID');
  }
  if (onCheckpoint !== null && typeof onCheckpoint !== 'function') {
    throw failure('P1_011_BACKUP_CHECKPOINT_CALLBACK_INVALID');
  }
  const environment = config.connection.environmentFor(env);
  const root = config.workDirectory === null ? tmpdir() : resolve(config.workDirectory);
  const restoreDatabase = restoreDatabaseName();
  const backupId = `backup-${randomUUID()}`;
  const restoreId = `restore-${randomUUID()}`;
  const occurredAt = new Date(now());
  if (Number.isNaN(occurredAt.getTime())) {
    throw failure('P1_011_BACKUP_TIME_INVALID');
  }
  const retentionUntil = new Date(occurredAt.getTime() + config.retentionDays * 86_400_000);
  let temporaryDirectory = null;
  let restoreCreated = false;
  let primaryFailure = null;
  let checkpoint = null;
  let checkpointPersisted = false;
  let outcome = null;
  try {
    temporaryDirectory = await mkdtemp(join(root, 'p1-011-backup-'));
    const artifactPath = join(temporaryDirectory, 'pilot-core.backup');
    const dump = runQuiet(
      executable('pg_dump', config.pgBinDirectory),
      [
        '--format=custom', '--no-owner', '--no-privileges',
        ...BACKUP_SCHEMAS.map((schema) => `--schema=${schema}`),
        ...config.connection.args,
      ],
      environment,
      'P1_011_BACKUP_COMMAND_FAILED',
      { stdout: 'pipe' },
    );
    await Promise.all([
      dump.completed,
      encryptBackupStream({
        input: dump.child.stdout,
        artifactPath,
        encryptionKey: config.encryptionKey,
        iv: randomBytes(12),
      }),
    ]);
    const checksumSha256 = await hashArtifact(artifactPath);
    const resolvedSizeBytes = (await stat(artifactPath)).size;
    checkpoint = Object.freeze({
      backup_id: backupId,
      checksum_sha256: checksumSha256,
      size_bytes: resolvedSizeBytes,
      encryption_key_id: config.encryptionKeyId,
      retention_until: retentionUntil.toISOString(),
      occurred_at: occurredAt.toISOString(),
    });
    if (onCheckpoint !== null) {
      await onCheckpoint(checkpoint);
      checkpointPersisted = true;
    }

    assertRestoreDatabaseName(restoreDatabase);
    await runQuiet(
      executable('createdb', config.pgBinDirectory),
      ['--maintenance-db=postgres', ...config.connection.common_args, restoreDatabase],
      environment,
      'P1_011_RESTORE_DATABASE_CREATE_FAILED',
    ).completed;
    restoreCreated = true;
    const restore = runQuiet(
      executable('pg_restore', config.pgBinDirectory),
      ['--format=custom', '--no-owner', '--no-privileges', ...config.connection.argsForDatabase(restoreDatabase)],
      environment,
      'P1_011_RESTORE_COMMAND_FAILED',
      { stdin: 'pipe' },
    );
    await Promise.all([
      restore.completed,
      decryptBackupStream({
        artifactPath,
        encryptionKey: config.encryptionKey,
        output: restore.child.stdin,
      }),
    ]);
    const verifiedObjectCount = await verifyRestoredDatabase(config.connection, restoreDatabase);
    outcome = Object.freeze({
      ...checkpoint,
      restore_id: restoreId,
      verified_object_count: verifiedObjectCount,
      status: 'SUCCEEDED',
    });
  } catch (error) {
    primaryFailure = error;
  }
  try {
    if (restoreCreated) {
      assertRestoreDatabaseName(restoreDatabase);
      await runQuiet(
        executable('dropdb', config.pgBinDirectory),
        ['--if-exists', ...config.connection.common_args, restoreDatabase],
        environment,
        'P1_011_RESTORE_CLEANUP_FAILED',
      ).completed;
    }
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } catch (cleanupError) {
    if (primaryFailure === null) {
      primaryFailure = cleanupError;
    }
  }
  if (primaryFailure !== null) {
    alerts?.raise('PILOT_RESTORE_DRILL_FAILED', 'restore');
    throw attachDrillFailure(primaryFailure, {
      backup_checkpoint: checkpoint,
      checkpoint_persisted: checkpointPersisted,
      restore_id: restoreId,
      occurred_at: occurredAt.toISOString(),
    });
  }
  if (typeof alerts?.resolve === 'function') {
    alerts.resolve('PILOT_RESTORE_DRILL_FAILED', 'restore');
  }
  return outcome;
}

async function persistCheckpoint(operations, checkpoint) {
  return operations.recordBackupCheckpoint({
    backupId: checkpoint.backup_id,
    checksumSha256: checkpoint.checksum_sha256,
    sizeBytes: checkpoint.size_bytes,
    encryptionKeyId: checkpoint.encryption_key_id,
    retentionUntil: checkpoint.retention_until,
    occurredAt: checkpoint.occurred_at,
  });
}

async function persistDrillFailure(operations, context) {
  if (context.backup_checkpoint !== null && context.checkpoint_persisted !== true) {
    try {
      await persistCheckpoint(operations, context.backup_checkpoint);
    } catch {
      // A standalone immutable failed-drill event is still recorded below.
    }
  }
  const backupId = context.backup_checkpoint?.backup_id ?? null;
  try {
    return await operations.recordRestoreDrillFailure({
      backupId,
      restoreId: context.restore_id,
      failureCode: context.failure_code,
      completedAt: context.occurred_at,
    });
  } catch (error) {
    if (backupId === null) {
      throw error;
    }
    return operations.recordRestoreDrillFailure({
      restoreId: context.restore_id,
      failureCode: context.failure_code,
      completedAt: context.occurred_at,
    });
  }
}

async function main() {
  let options;
  let config;
  try {
    options = parseBackupRestoreArgs(process.argv.slice(2));
    config = validateBackupRestoreConfig(process.env);
  } catch (error) {
    console.log(JSON.stringify({ test_id: 'P1-011', event: 'p1_011_backup_restore_failed', error_code: error.code ?? 'P1_011_BACKUP_CONFIG_INVALID' }));
    process.exitCode = 1;
    return;
  }
  if (options.mode === 'check') {
    console.log(JSON.stringify({
      test_id: 'P1-011',
      event: 'p1_011_backup_restore_ready',
      encryption: 'AES_256_GCM',
      drill_requires_explicit_approval: true,
      retention_days_configured: config.retentionDays,
    }));
    return;
  }
  const alerts = createPilotAlertRegistry();
  let pool = null;
  let operations = null;
  let completedDrill = null;
  try {
    pool = new Pool(config.connection.poolConfigFor(config.connection.database));
    await applyPilotOperationsMigration({ pool });
    operations = createPilotOperationsService({ pool, alerts });
    completedDrill = await runBackupRestoreDrill({
      env: process.env,
      alerts,
      onCheckpoint: (checkpoint) => persistCheckpoint(operations, checkpoint),
    });
    await operations.recordRestoreDrill({
      backupId: completedDrill.backup_id,
      restoreId: completedDrill.restore_id,
      verifiedObjectCount: completedDrill.verified_object_count,
      completedAt: completedDrill.occurred_at,
    });
    await operations.assessBackupFreshness({
      maximumAgeMs: config.retentionDays * 86_400_000,
    });
    console.log(JSON.stringify({
      test_id: 'P1-011',
      event: 'p1_011_backup_restore_drill_succeeded',
      backup_id: completedDrill.backup_id,
      checksum_sha256: completedDrill.checksum_sha256,
      size_bytes: completedDrill.size_bytes,
      restore_id: completedDrill.restore_id,
      verified_object_count: completedDrill.verified_object_count,
      status: completedDrill.status,
    }));
  } catch (error) {
    const context = error?.p1_011_drill ?? (completedDrill === null
      ? null
      : {
        backup_checkpoint: {
          backup_id: completedDrill.backup_id,
          checksum_sha256: completedDrill.checksum_sha256,
          size_bytes: completedDrill.size_bytes,
          encryption_key_id: completedDrill.encryption_key_id,
          retention_until: completedDrill.retention_until,
          occurred_at: completedDrill.occurred_at,
        },
        checkpoint_persisted: true,
        restore_id: completedDrill.restore_id,
        occurred_at: completedDrill.occurred_at,
        failure_code: stableErrorCode(error),
      });
    let failureRecorded = false;
    if (operations !== null && context !== null) {
      try {
        await persistDrillFailure(operations, context);
        failureRecorded = true;
      } catch {
        // The CLI still emits a fixed alert code when the audit store itself is unavailable.
      }
    }
    if (context !== null) {
      alerts.raise('PILOT_RESTORE_DRILL_FAILED', 'restore');
    }
    console.log(JSON.stringify({
      test_id: 'P1-011',
      event: 'p1_011_backup_restore_failed',
      error_code: stableErrorCode(error),
      ...(context === null ? {} : { alert_codes: alerts.snapshot().map((alert) => alert.code) }),
      ...(failureRecorded ? { operations_failure_recorded: true } : {}),
    }));
    process.exitCode = 1;
  } finally {
    if (pool !== null) {
      await pool.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
