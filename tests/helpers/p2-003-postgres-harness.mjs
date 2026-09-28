import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';

export const P2003_DATABASE_NAME_PATTERN = /^p2_003_[a-z0-9]{1,12}_[a-f0-9_]{36}$/u;
const APPLICATION_NAME_PATTERN = /^p2_003_[a-z0-9_]{1,54}$/u;
const RUN_TOKEN = randomUUID().replaceAll('-', '_').slice(0, 12);
const createdDatabaseNames = new Set();
const activeDatabaseNames = new Set();
const ownedApplicationNames = new Set();

function assertDatabaseUrl(databaseUrl) {
  assert.equal(typeof databaseUrl, 'string');
  assert.ok(databaseUrl.length > 0, 'P2_003_TEST_DATABASE_REQUIRED');
}

function createApplicationName(purpose) {
  const name = `p2_003_${purpose}_${RUN_TOKEN}`;
  assert.match(name, APPLICATION_NAME_PATTERN);
  ownedApplicationNames.add(name);
  return name;
}

export function createP2003DatabaseName(purpose) {
  assert.match(purpose, /^[a-z0-9]{1,12}$/u);
  const name = `p2_003_${purpose}_${randomUUID().replaceAll('-', '_')}`;
  assert.match(name, P2003_DATABASE_NAME_PATTERN);
  assert.ok(name.length <= 63);
  createdDatabaseNames.add(name);
  return name;
}

export function databaseUrlForP2003Database(databaseUrl, databaseName) {
  assertDatabaseUrl(databaseUrl);
  assert.match(databaseName, P2003_DATABASE_NAME_PATTERN);
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  return isolatedUrl.toString();
}

export function registerP2003ApplicationName(applicationName) {
  assert.match(applicationName, APPLICATION_NAME_PATTERN);
  ownedApplicationNames.add(applicationName);
  return applicationName;
}

export function p2003OwnedResources() {
  return Object.freeze({
    database_names: Object.freeze([...createdDatabaseNames]),
    active_database_names: Object.freeze([...activeDatabaseNames]),
    application_names: Object.freeze([...ownedApplicationNames]),
  });
}

export async function waitForP2003BackendClosed({
  pool,
  applicationName,
  timeoutMs = 5_000,
  intervalMs = 25,
}) {
  registerP2003ApplicationName(applicationName);
  const startedAt = Date.now();
  let polls = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    polls += 1;
    const result = await pool.query(
      `SELECT count(*)::integer AS count
         FROM pg_stat_activity
        WHERE application_name = $1`,
      [applicationName],
    );
    if (result.rows[0].count === 0) {
      return polls;
    }
    await delay(intervalMs);
  }
  assert.fail('P2_003_CHILD_DATABASE_BACKEND_DID_NOT_CLOSE');
}

export async function withP2003IsolatedDatabase({
  databaseUrl,
  purpose,
  max = 4,
  run,
}) {
  assertDatabaseUrl(databaseUrl);
  assert.match(purpose, /^[a-z0-9]{1,12}$/u);
  assert.ok(Number.isInteger(max) && max >= 1 && max <= 4);
  assert.equal(typeof run, 'function');

  const databaseName = createP2003DatabaseName(purpose);
  const quotedDatabaseName = `"${databaseName}"`;
  const applicationName = createApplicationName(purpose);
  const adminPool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    application_name: createApplicationName('admin'),
  });
  let isolatedPool;
  let result;
  let runFailure;
  let cleanupFailure;
  const disconnects = new Set();

  try {
    await adminPool.query(`CREATE DATABASE ${quotedDatabaseName} TEMPLATE template0`);
    activeDatabaseNames.add(databaseName);
    const isolatedDatabaseUrl = databaseUrlForP2003Database(databaseUrl, databaseName);
    isolatedPool = createPostgresPool({
      connectionString: isolatedDatabaseUrl,
      max,
      connectionTimeoutMillis: 2_000,
      application_name: applicationName,
    });
    isolatedPool.on('connect', client => {
      const disconnected = new Promise(resolve => client.once('end', resolve));
      disconnects.add(disconnected);
      disconnected.then(() => disconnects.delete(disconnected));
    });
    result = await run({
      pool: isolatedPool,
      databaseName,
      databaseUrl: isolatedDatabaseUrl,
      applicationName,
    });
  } catch (error) {
    runFailure = error;
  } finally {
    try {
      if (isolatedPool) {
        await isolatedPool.end();
        // Pool removal precedes socket close; wait before terminating our residual backends.
        let timer;
        try {
          await Promise.race([
            Promise.all(disconnects),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('P2_003_CLIENT_DISCONNECT_TIMEOUT')), 5_000); }),
          ]);
        } finally { clearTimeout(timer); }
      }
      await adminPool.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
      const residual = await adminPool.query(
        'SELECT count(*)::integer AS count FROM pg_database WHERE datname = $1',
        [databaseName],
      );
      assert.equal(residual.rows[0].count, 0);
      activeDatabaseNames.delete(databaseName);
    } catch (error) {
      cleanupFailure = error;
    } finally {
      await adminPool.end().catch((error) => {
        cleanupFailure ??= error;
      });
    }
  }

  if (runFailure && cleanupFailure) {
    throw new AggregateError(
      [runFailure, cleanupFailure],
      'P2-003 isolated database run and cleanup both failed.',
    );
  }
  if (runFailure) {
    throw runFailure;
  }
  if (cleanupFailure) {
    throw cleanupFailure;
  }
  return result;
}

export async function assertNoP2003OwnedDatabaseResidual({ databaseUrl }) {
  assertDatabaseUrl(databaseUrl);
  const adminPool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    application_name: createApplicationName('residual'),
  });
  try {
    const databases = [...createdDatabaseNames];
    const applications = [...ownedApplicationNames].filter((name) => !name.endsWith('_residual'));
    const result = await adminPool.query(
      `SELECT
         (SELECT count(*)::integer
            FROM pg_database
           WHERE datname = ANY($1::text[])) AS owned_database_count,
         (SELECT count(*)::integer
            FROM pg_namespace
           WHERE nspname = ANY($1::text[])) AS owned_schema_count,
         (SELECT count(*)::integer
            FROM pg_stat_activity
           WHERE application_name = ANY($2::text[])
             AND pid <> pg_backend_pid()) AS owned_backend_count`,
      [databases, applications],
    );
    assert.deepEqual(result.rows[0], {
      owned_database_count: 0,
      owned_schema_count: 0,
      owned_backend_count: 0,
    });
    assert.equal(activeDatabaseNames.size, 0);
    return Object.freeze({ ...result.rows[0], active_database_count: 0 });
  } finally {
    await adminPool.end();
  }
}
