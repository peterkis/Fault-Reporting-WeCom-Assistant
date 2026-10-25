import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { validateP2015Catalog } from './p2-015-migrate.mjs';

export async function reconcileP2015({ databaseUrl, PoolFactory = createPostgresPool } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw Object.assign(new Error('P2_015_DATABASE_URL_REQUIRED'), { code: 'P2_015_DATABASE_URL_REQUIRED' });
  const pool = PoolFactory({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, allowExitOnIdle: true, application_name: 'p2_015_reconcile' });
  try {
    const inventory = await validateP2015Catalog(pool);
    const consistency = await pool.query(`SELECT
      (SELECT count(*)::integer FROM intake.channel_leg leg JOIN intake.contact_journey j ON j.id=leg.journey_id WHERE leg.reporter_identity_hash<>j.reporter_identity_hash) AS reporter_mismatch,
      (SELECT count(*)::integer FROM intake.manual_review_item WHERE status='PENDING' AND resolution_command_id IS NOT NULL) AS review_shape_mismatch,
      (SELECT count(*)::integer FROM intake.safe_action_suggestion WHERE state IN ('EXECUTED','REPLAYED') AND result_ref_id IS NULL) AS action_shape_mismatch`);
    return Object.freeze({ ok: Object.values(consistency.rows[0]).every((value) => value === 0), inventory, consistency: consistency.rows[0] });
  } finally { await pool.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify({ task: 'P2-015', event: 'reconcile', ...(await reconcileP2015({ databaseUrl: process.env.PILOT_DATABASE_URL })) })); }
  catch (error) { console.log(JSON.stringify({ task: 'P2-015', ok: false, error_code: error?.code ?? 'P2_015_RECONCILE_FAILED' })); process.exitCode = 1; }
}
