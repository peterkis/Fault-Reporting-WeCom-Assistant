import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';

const RUN_TOKEN = randomUUID().replaceAll('-', '_').slice(0, 12);
const createdDatabases = new Set();
const activeDatabases = new Set();
const applicationNames = new Set();

function applicationName(purpose) {
  const value = `p2_004_${purpose}_${RUN_TOKEN}`.slice(0, 63);
  applicationNames.add(value);
  return value;
}

export async function withP2004IsolatedDatabase({ databaseUrl, purpose, max = 4, run }) {
  assert.equal(typeof databaseUrl, 'string');
  assert.match(purpose, /^[a-z0-9]{1,12}$/u);
  assert.ok(Number.isInteger(max) && max >= 1 && max <= 4);
  const databaseName = `p2_004_${purpose}_${randomUUID().replaceAll('-', '_')}`;
  assert.ok(databaseName.length <= 63);
  createdDatabases.add(databaseName);
  const quotedName = `"${databaseName}"`;
  const adminPool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: applicationName('admin') });
  let pool;
  let result;
  let runError;
  let cleanupError;
  try {
    await adminPool.query(`CREATE DATABASE ${quotedName} TEMPLATE template0`);
    activeDatabases.add(databaseName);
    const isolated = new URL(databaseUrl);
    isolated.pathname = `/${databaseName}`;
    pool = createPostgresPool({ connectionString: isolated.toString(), max, connectionTimeoutMillis: 2_000, application_name: applicationName(purpose) });
    result = await run({ pool, databaseName, databaseUrl: isolated.toString() });
  } catch (error) {
    runError = error;
  } finally {
    try {
      if (pool) await pool.end();
      await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
      await adminPool.query(`DROP DATABASE IF EXISTS ${quotedName}`);
      const residual = await adminPool.query('SELECT count(*)::integer AS count FROM pg_database WHERE datname = $1', [databaseName]);
      assert.equal(residual.rows[0].count, 0);
      activeDatabases.delete(databaseName);
    } catch (error) {
      cleanupError = error;
    } finally {
      await adminPool.end().catch((error) => { cleanupError ??= error; });
    }
  }
  if (runError && cleanupError) throw new AggregateError([runError, cleanupError], 'P2-004 run and cleanup failed.');
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
  return result;
}

export async function assertNoP2004Residual({ databaseUrl }) {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: applicationName('residual') });
  try {
    const result = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM pg_database WHERE datname = ANY($1::text[])) AS database_count,
         (SELECT count(*)::integer FROM pg_stat_activity
           WHERE application_name = ANY($2::text[]) AND pid <> pg_backend_pid()) AS backend_count`,
      [[...createdDatabases], [...applicationNames].filter((name) => !name.includes('_residual_'))],
    );
    assert.deepEqual(result.rows[0], { database_count: 0, backend_count: 0 });
    assert.equal(activeDatabases.size, 0);
    return Object.freeze({ ...result.rows[0], active_database_count: 0 });
  } finally {
    await pool.end();
  }
}
