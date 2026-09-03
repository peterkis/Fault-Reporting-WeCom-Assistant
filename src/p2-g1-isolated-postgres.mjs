import { randomUUID } from 'node:crypto';
import { createPostgresPool } from './platform/postgres-pool.mjs';

const NAME = /^p2_g1_isolated_[a-z0-9]{1,12}_[a-f0-9]{24}$/u;

export async function withP2G1IsolatedPostgres({ databaseUrl, purpose, run } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length < 1 || databaseUrl.length > 4_096
    || typeof purpose !== 'string' || !/^[a-z0-9]{1,12}$/u.test(purpose)
    || typeof run !== 'function') {
    throw new TypeError('P2_G1_ISOLATED_DATABASE_CONFIGURATION_INVALID');
  }
  const databaseName = `p2_g1_isolated_${purpose}_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  if (!NAME.test(databaseName)) throw new Error('P2_G1_ISOLATED_DATABASE_NAME_INVALID');
  const quotedName = `"${databaseName}"`;
  const admin = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: 'p2_g1_isolated_admin' });
  let isolatedPool = null;
  let result;
  let failure;
  try {
    await admin.query(`CREATE DATABASE ${quotedName} TEMPLATE template0`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    const isolatedDatabaseUrl = isolatedUrl.toString();
    isolatedPool = createPostgresPool({ connectionString: isolatedDatabaseUrl, max: 4, connectionTimeoutMillis: 2_000, application_name: `p2_g1_${purpose}` });
    result = await run({ pool: isolatedPool, databaseUrl: isolatedDatabaseUrl, databaseName });
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (isolatedPool) await isolatedPool.end();
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      if (!NAME.test(databaseName)) throw new Error('P2_G1_ISOLATED_DATABASE_DROP_REFUSED');
      await admin.query(`DROP DATABASE IF EXISTS ${quotedName}`);
    } catch (error) {
      failure ??= error;
    } finally {
      await admin.end().catch((error) => { failure ??= error; });
    }
  }
  if (failure) throw failure;
  return result;
}
