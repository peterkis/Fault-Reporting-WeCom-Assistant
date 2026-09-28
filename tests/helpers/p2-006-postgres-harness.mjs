import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';

const token = randomUUID().replaceAll('-', '_').slice(0, 12);
const created = new Set(); const applications = new Set();
function app(purpose) { const value = `p2_006_${purpose}_${token}`.slice(0, 63); applications.add(value); return value; }

// Track from connect: totalCount excludes clients whose close is still in flight.
async function closeOwnedPool(pool, disconnects) {
  let timer;
  try {
    await Promise.race([
      (async () => { await pool.end(); await Promise.all(disconnects); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('P2_006_POOL_CLOSE_TIMEOUT')), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function withP2006IsolatedDatabase({ databaseUrl, purpose, max = 4, run }) {
  assert.match(purpose, /^[a-z0-9]{1,12}$/u); assert.ok(max >= 1 && max <= 4);
  const name = `p2_006_${purpose}_${randomUUID().replaceAll('-', '_')}`; created.add(name); const quoted = `"${name}"`;
  const admin = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: app('admin') });
  const disconnects = new Set();
  let pool; let result; let failure;
  try {
    await admin.query(`CREATE DATABASE ${quoted} TEMPLATE template0`);
    const isolated = new URL(databaseUrl); isolated.pathname = `/${name}`;
    pool = createPostgresPool({ connectionString: isolated.toString(), max, connectionTimeoutMillis: 2_000, application_name: app(purpose) });
    pool.on('connect', client => {
      const disconnected = new Promise(resolve => client.once('end', resolve));
      disconnects.add(disconnected);
      disconnected.then(() => disconnects.delete(disconnected));
    });
    result = await run({ pool, databaseUrl: isolated.toString(), databaseName: name });
  } catch (error) { failure = error; }
  finally {
    try { if (pool) await closeOwnedPool(pool, disconnects); await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]); await admin.query(`DROP DATABASE IF EXISTS ${quoted}`); }
    catch (error) { failure ??= error; }
    finally { await admin.end().catch((error) => { failure ??= error; }); }
  }
  if (failure) throw failure; return result;
}

export async function catalogSnapshot(pool) {
  const result = await pool.query(`
    SELECT jsonb_build_object(
      'schemas',(SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'),
      'tables',(SELECT jsonb_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'),
      'columns',(SELECT jsonb_agg(n.nspname||'.'||c.relname||'.'||a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod) ORDER BY n.nspname,c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'),
      'constraints',(SELECT jsonb_agg(n.nspname||'.'||c.relname||'.'||con.conname||':'||pg_get_constraintdef(con.oid) ORDER BY n.nspname,c.relname,con.conname) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'),
      'indexes',(SELECT jsonb_agg(schemaname||'.'||indexname||':'||indexdef ORDER BY schemaname,indexname) FROM pg_indexes WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema'),
      'functions',(SELECT jsonb_agg(n.nspname||'.'||p.proname||':'||pg_get_function_identity_arguments(p.oid) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'),
      'triggers',(SELECT jsonb_agg(n.nspname||'.'||c.relname||'.'||t.tgname ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_'),
      'extensions',(SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension)
    ) AS snapshot`);
  return result.rows[0].snapshot;
}

export async function assertNoP2006Residual({ databaseUrl }) {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: app('residual') });
  try {
    const result = await pool.query(`SELECT
      (SELECT count(*)::integer FROM pg_database WHERE datname=ANY($1::text[])) database_count,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE application_name=ANY($2::text[]) AND pid<>pg_backend_pid()) backend_count`, [[...created], [...applications].filter((value) => !value.includes('_residual_'))]);
    assert.deepEqual(result.rows[0], { database_count: 0, backend_count: 0 }); return result.rows[0];
  } finally { await pool.end(); }
}
