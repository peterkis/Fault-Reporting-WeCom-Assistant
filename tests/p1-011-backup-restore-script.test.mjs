import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  buildPgConnectionArgs,
  parseBackupRestoreArgs,
  runBackupRestoreDrill,
} from '../scripts/p1-011-backup-restore.mjs';
import { createPilotAlertRegistry } from '../src/p1-011-pilot-operations-baseline.mjs';

const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'scripts/p1-011-backup-restore.mjs');

test('P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments', () => {
  assert.deepEqual(parseBackupRestoreArgs([]), { mode: 'check' });
  assert.deepEqual(parseBackupRestoreArgs(['--drill']), { mode: 'drill' });
  assert.throws(() => parseBackupRestoreArgs(['--drill', '--verbose']), /P1_011_BACKUP_ARGS/u);

  const connection = buildPgConnectionArgs('postgresql://pilot-user:database-secret@127.0.0.1:5432/pilot_ticket_core');
  const serialized = JSON.stringify(connection.args);
  assert.equal(serialized.includes('database-secret'), false);
  assert.deepEqual(connection.args, [
    '--host', '127.0.0.1',
    '--port', '5432',
    '--username', 'pilot-user',
    '--dbname', 'pilot_ticket_core',
  ]);
});

test('P1-011 backup check validates controls without writing credential or encryption-key values', () => {
  const backupKey = randomBytes(32).toString('base64');
  const result = spawnSync(process.execPath, [script, '--check'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PILOT_DATABASE_URL: 'postgresql://pilot-user:database-secret@127.0.0.1:5432/pilot_ticket_core',
      PILOT_BACKUP_ENCRYPTION_KEY: backupKey,
      PILOT_BACKUP_ENCRYPTION_KEY_ID: 'pilot-backup-key-v1',
      PILOT_BACKUP_RETENTION_DAYS: '30',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes('database-secret'), false);
  assert.equal(output.includes(backupKey), false);
  assert.match(output, /p1_011_backup_restore_ready/u);
});

test('P1-011 emits a fixed restore alert and failure context when a drill cannot start', async () => {
  const backupKey = randomBytes(32).toString('base64');
  const alerts = createPilotAlertRegistry();
  await assert.rejects(
    () => runBackupRestoreDrill({
      alerts,
      env: {
        ...process.env,
        PILOT_DATABASE_URL: 'postgresql://pilot-user:database-secret@127.0.0.1:5432/pilot_ticket_core',
        PILOT_BACKUP_ENCRYPTION_KEY: backupKey,
        PILOT_BACKUP_ENCRYPTION_KEY_ID: 'pilot-backup-key-v1',
        PILOT_BACKUP_RETENTION_DAYS: '30',
        PILOT_BACKUP_RESTORE_DRILL_APPROVED: 'true',
        PILOT_PG_BIN: resolve(root, 'tests', 'fixtures', 'p1-011-missing-pg-bin'),
      },
    }),
    (error) => {
      assert.equal(error.code, 'P1_011_BACKUP_COMMAND_FAILED');
      assert.equal(error.p1_011_drill.backup_checkpoint, null);
      assert.match(error.p1_011_drill.restore_id, /^restore-[a-f0-9-]+$/u);
      return true;
    },
  );
  assert.deepEqual(alerts.snapshot().map((alert) => alert.code), ['PILOT_RESTORE_DRILL_FAILED']);
  assert.equal(JSON.stringify(alerts.snapshot()).includes('database-secret'), false);
  assert.equal(JSON.stringify(alerts.snapshot()).includes(backupKey), false);
});
