import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {fkIndexesSchemaReady} from '../scripts/fk-indexes-migrate.mjs';
import {retentionTimeContractSchemaReady} from '../scripts/retention-and-time-contract-migrate.mjs';

export async function workbenchReleaseSchemaChecks(pool:Pick<PostgresTransaction,'query'>){
 return {
  fk_indexes_schema:await fkIndexesSchemaReady(pool),
  retention_time_contract_schema:await retentionTimeContractSchemaReady(pool),
 };
}

export function requireWorkbenchSchemas(checks:Readonly<Record<string,unknown>>,profile:'HUMAN_WORKBENCH'|'P2_016'){
 const missing=Object.entries(checks)
  .filter(([name,ready])=>ready===false&&(name.includes('schema')||name==='workbench_wecom_auth'))
  .map(([name])=>name);
 if(missing.length)throw new Error(profile+'_SCHEMA_REQUIRED:'+missing.join(','));
}
