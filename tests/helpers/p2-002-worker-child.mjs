import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';
import {
  TIMELINE_ERROR_CODES,
  TimelineProjectionError,
  createTimelineProjector,
  createTimelineProjectorWorker,
  normalizeTimelineSourceRecord,
} from '../../src/p2-002-timeline-projector.mjs';

const MODES = new Set(['normal', 'block-before-commit', 'block-after-commit']);
const DATABASE_NAME_PATTERN = /^p2_002_[a-z0-9]+_[a-f0-9_]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTRACT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const WORKER_TOKEN_PATTERN = /^p2_002_child_[a-f0-9_]{36}$/u;

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error('P2_002_CHILD_INPUT_INVALID');
  }
  return value;
}

function isolatedDatabaseUrl() {
  const baseUrl = process.env.PILOT_DATABASE_URL;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('P2_002_CHILD_DATABASE_REQUIRED');
  }
  const databaseName = requiredEnvironment(
    'P2_002_TEST_DATABASE_NAME',
    DATABASE_NAME_PATTERN,
  );
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function sendSafe(message) {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== 'function' || !process.connected) {
      reject(new Error('P2_002_CHILD_IPC_REQUIRED'));
      return;
    }
    process.send(message, (error) => {
      if (error) {
        reject(new Error('P2_002_CHILD_IPC_FAILED'));
      } else {
        resolve();
      }
    });
  });
}

async function announceAndBlock(event) {
  await sendSafe({ event });
  await new Promise(() => {});
}

function childRecord({ sessionId, sourceStream, sourceId }) {
  return normalizeTimelineSourceRecord({
    schema_version: 1,
    projector_name: 'CONVERSATION_TIMELINE',
    projector_version: '1',
    source_stream: sourceStream,
    source_type: 'CHANNEL_MESSAGE',
    source_id: sourceId,
    projection_variant: 'PRIMARY',
    session_id: sessionId,
    item_type: 'USER_MESSAGE',
    sender_kind: 'USER',
    visibility: 'EXTERNAL',
    text: 'synthetic child process timeline item',
    safe_content: { fixture_kind: 'P2_002_CHILD_PROCESS' },
    occurred_at: '2026-08-30 18:00:00',
    source_ordinal: '1',
    privacy_class: 'INTERNAL',
    retention_until: '2027-08-30 08:00:00',
  });
}

let pool;

try {
  const mode = requiredEnvironment('P2_002_CHILD_MODE', /^[a-z-]+$/u);
  if (!MODES.has(mode)) {
    throw new Error('P2_002_CHILD_INPUT_INVALID');
  }
  const sessionId = requiredEnvironment('P2_002_TEST_SESSION_ID', UUID_PATTERN);
  const sourceStream = requiredEnvironment(
    'P2_002_TEST_SOURCE_STREAM',
    CONTRACT_IDENTIFIER_PATTERN,
  );
  const sourceId = requiredEnvironment('P2_002_TEST_SOURCE_ID', SOURCE_ID_PATTERN);
  const workerToken = requiredEnvironment('P2_002_TEST_WORKER_TOKEN', WORKER_TOKEN_PATTERN);
  const faultInjection = mode === 'block-before-commit'
    ? { beforeCommit: () => announceAndBlock('BEFORE_COMMIT_BLOCKED') }
    : mode === 'block-after-commit'
      ? { afterCommit: () => announceAndBlock('AFTER_COMMIT_BEFORE_ACK_BLOCKED') }
      : null;
  pool = createPostgresPool({
    connectionString: isolatedDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 2_000,
    application_name: workerToken,
  });
  const projector = createTimelineProjector({
    pool,
    enabled: true,
    batchSize: 20,
    faultInjection,
  });
  const record = childRecord({ sessionId, sourceStream, sourceId });
  const worker = createTimelineProjectorWorker({
    sourceAdapter: {
      sourceStream,
      readBatch: async () => ({
        records: [record],
        cursor_value: '1',
        done: true,
      }),
    },
    projector,
    batchSize: 20,
  });
  const outcome = await worker.runOnce({
    projectorName: 'CONVERSATION_TIMELINE',
    projectorVersion: '1',
    sourceStream,
  });
  const result = outcome.stats;
  await sendSafe({
    event: 'PROJECTION_RESULT',
    result: {
      received_count: result.received_count,
      inserted_count: result.inserted_count,
      replayed_count: result.replayed_count,
      checkpoint_updated: result.checkpoint_updated,
      batch_hash: result.batch_hash,
    },
  });
} catch (error) {
  const code = error instanceof TimelineProjectionError
    ? error.code
    : error?.message === 'P2_002_CHILD_INPUT_INVALID'
      ? 'P2_002_CHILD_INPUT_INVALID'
      : TIMELINE_ERROR_CODES.storageFailed;
  await sendSafe({ event: 'PROJECTION_ERROR', code }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (pool) {
    await pool.end().catch(() => {});
  }
  if (process.connected) {
    process.disconnect();
  }
}
