import { withP2015IsolatedDatabase, applyThrough022, assertNoP2015Residual } from './p2-015-postgres-harness.mjs';
import { migrateP2015 } from '../../scripts/p2-015-migrate.mjs';

// Reuse the proven isolated-database lifecycle, including its strict cleanup.
export const withP2016IsolatedDatabase = withP2015IsolatedDatabase;
export const assertNoP2016Residual = assertNoP2015Residual;
export async function applyThrough030({ pool, databaseUrl }) {
  await applyThrough022(pool);
  await migrateP2015({ databaseUrl });
}
