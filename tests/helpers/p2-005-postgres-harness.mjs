import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';

const token = randomUUID().replaceAll('-', '_').slice(0, 12);
const created = new Set();
const applications = new Set();
function app(purpose) { const value = `p2_005_${purpose}_${token}`.slice(0, 63); applications.add(value); return value; }

// pg-pool removes clients from totalCount before their socket close callbacks.
// Await the public remove events before terminating any residual owned backend.
async function closeOwnedPool(pool) {
  let remaining = pool.totalCount;
  if (!remaining) { await pool.end(); return; }
  let timer, onRemove;
  const closed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('P2_005_POOL_CLOSE_TIMEOUT')), 5000);
    onRemove = () => { if (--remaining === 0) resolve(); };
    pool.on('remove', onRemove);
  });
  try { await Promise.all([pool.end(), closed]); }
  finally { clearTimeout(timer); pool.off('remove', onRemove); }
}

export async function withP2005IsolatedDatabase({ databaseUrl, purpose, max = 4, run }) {
  assert.match(purpose, /^[a-z0-9]{1,12}$/u); assert.ok(max >= 1 && max <= 4);
  const name = `p2_005_${purpose}_${randomUUID().replaceAll('-', '_')}`; created.add(name); const quoted = `"${name}"`;
  const admin = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: app('admin') }); let pool; let result; let failure;
  try {
    await admin.query(`CREATE DATABASE ${quoted} TEMPLATE template0`); const isolated = new URL(databaseUrl); isolated.pathname = `/${name}`;
    pool = createPostgresPool({ connectionString: isolated.toString(), max, connectionTimeoutMillis: 2_000, application_name: app(purpose) }); result = await run({ pool, databaseUrl: isolated.toString(), databaseName: name });
  } catch (error) { failure = error; }
  finally {
    try { if (pool) await closeOwnedPool(pool); await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]); await admin.query(`DROP DATABASE IF EXISTS ${quoted}`); }
    catch (error) { failure ??= error; }
    finally { await admin.end().catch(error => { failure ??= error; }); }
  }
  if (failure) throw failure; return result;
}

export async function assertNoP2005Residual({ databaseUrl }) {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: app('residual') });
  try { const q=await pool.query(`SELECT (SELECT count(*)::integer FROM pg_database WHERE datname=ANY($1::text[])) database_count,(SELECT count(*)::integer FROM pg_stat_activity WHERE application_name=ANY($2::text[]) AND pid<>pg_backend_pid()) backend_count`,[[...created],[...applications].filter(x=>!x.includes('_residual_'))]); assert.deepEqual(q.rows[0],{database_count:0,backend_count:0}); return q.rows[0]; }
  finally { await pool.end(); }
}
