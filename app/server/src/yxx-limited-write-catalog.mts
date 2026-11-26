import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PostgresPoolClient } from './platform/postgres-pool.mjs';
import { reject } from './yxx-limited-write-contract.mjs';
import {
  validateYxxCatalogWithSuccessors, yxxCatalogInventory, YXX_MIGRATION_ID, YXX_CORRECTIVE_MIGRATION_ID,
} from '../scripts/yxx-self-service-migrate.mjs';
import { FK_INDEXES_MIGRATION_ID, fkIndexesSchemaReady } from '../scripts/fk-indexes-migrate.mjs';
import {
  RETENTION_TIME_CONTRACT_MIGRATION_ID, retentionTimeContractSchemaReady,
} from '../scripts/retention-and-time-contract-migrate.mjs';

// These migrations changed the nine inventoried Intake relations between 034 and 066.
const intakePrerequisites = [
  '042_workbench_manual_reports', '043_ticket_reopen_rounds', '045_workbench_verified_manual_reports',
  '051_workbench_verified_manual_report_candidate_ref_check', '063_mvp_notifications_app_members',
  '064_yixiaoxiu_h5_member_service',
];
const closure = '071_unified_service_closure';
const completion = '072_ticket_completion_dismissal';
const successors = [closure, completion, FK_INDEXES_MIGRATION_ID, RETENTION_TIME_CONTRACT_MIGRATION_ID];
const migrationIds = [YXX_MIGRATION_ID, YXX_CORRECTIVE_MIGRATION_ID, ...intakePrerequisites, ...successors];
const checksums = new Map(migrationIds.map(id => [
  id, createHash('sha256').update(readFileSync(new URL('../../../database/migrations/' + id + '.sql', import.meta.url))).digest('hex'),
]));

export async function verifyLimitedCatalog(client: PostgresPoolClient): Promise<void> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const { rows } = await client.query<{ migration_id: string; checksum_sha256: string }>(
      'SELECT migration_id, checksum_sha256 FROM platform.schema_migration WHERE migration_id = ANY($1::text[])',
      [migrationIds],
    );
    const installed = new Set(rows.map(row => row.migration_id));
    const hasFkIndexes = installed.has(FK_INDEXES_MIGRATION_ID);
    const hasRetention = installed.has(RETENTION_TIME_CONTRACT_MIGRATION_ID);
    const current = hasFkIndexes || hasRetention;
    if (!installed.has(YXX_MIGRATION_ID) || !installed.has(YXX_CORRECTIVE_MIGRATION_ID)
        || (installed.has(completion) && !installed.has(closure)) || (current && !installed.has(completion))
        || rows.some(row => checksums.get(row.migration_id) !== row.checksum_sha256)
        || intakePrerequisites.some(id => installed.has(id) !== current)) {
      reject('MIGRATION_NOT_READY');
    }
    const profile = successors.filter(id => installed.has(id)).map(id => id.slice(0, 3));
    validateYxxCatalogWithSuccessors(await yxxCatalogInventory(client), { successors: profile });
    if ((hasFkIndexes && !await fkIndexesSchemaReady(client)) || (hasRetention && !await retentionTimeContractSchemaReady(client))) {
      reject('MIGRATION_NOT_READY');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
