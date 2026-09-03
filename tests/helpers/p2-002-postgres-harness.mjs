import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';

const DATABASE_NAME_PATTERN = /^p2_002_[a-z0-9]+_[a-f0-9_]+$/u;

export function createP2002DatabaseName(purpose) {
  assert.match(purpose, /^[a-z0-9]+$/u);
  const name = `p2_002_${purpose}_${randomUUID().replaceAll('-', '_')}`;
  assert.match(name, DATABASE_NAME_PATTERN);
  assert.ok(name.length <= 63);
  return name;
}

export function databaseUrlForP2002Database(databaseUrl, databaseName) {
  assert.match(databaseName, DATABASE_NAME_PATTERN);
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  return isolatedUrl.toString();
}

export async function withP2002IsolatedDatabase({
  databaseUrl,
  purpose,
  max = 8,
  run,
}) {
  const databaseName = createP2002DatabaseName(purpose);
  const quotedDatabaseName = `"${databaseName}"`;
  const adminPool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  let isolatedPool;
  let runFailure;

  try {
    await adminPool.query(`CREATE DATABASE ${quotedDatabaseName} TEMPLATE template0`);
    isolatedPool = createPostgresPool({
      connectionString: databaseUrlForP2002Database(databaseUrl, databaseName),
      max,
      connectionTimeoutMillis: 2_000,
    });
    return await run({ pool: isolatedPool, databaseName });
  } catch (error) {
    runFailure = error;
    throw error;
  } finally {
    let cleanupFailure;
    try {
      if (isolatedPool) {
        await isolatedPool.end();
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
    } catch (error) {
      cleanupFailure = error;
    } finally {
      await adminPool.end();
    }
    if (cleanupFailure) {
      if (runFailure) {
        throw new AggregateError(
          [runFailure, cleanupFailure],
          'P2-002 isolated database run and cleanup both failed.',
        );
      }
      throw cleanupFailure;
    }
  }
}
