import {migrationConnection,type MigrationDatabase} from './migration-database.mjs';
import {CONVERSATION_DELIVERY_MIGRATION_ID,matchesReceiptShape,normalizeServiceClosureReceiptCatalog} from '../src/p2-006-delivery-command-schema.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {failP2016} from '../src/p2-016-domain-contracts.mjs';
import {SERVICE_CLOSURE_MIGRATION_ID, serviceClosureChecksum} from './service-closure-migrate.mjs';
import {FK_PREDECESSOR_COUNT_SQL, fkPredecessorParameters, readWorkbenchFkPredecessors} from './fk-indexes-migrate.mjs';
import {projectWorkbenchCatalog, readWorkbenchCatalog, RECEIPT_RELATION} from './workbench-readiness-catalog.mjs';

export const FOLLOW_MIGRATION_ID='044_workbench_item_follow';
const SQL_URL=new URL('../../../database/migrations/'+FOLLOW_MIGRATION_ID+'.sql',import.meta.url);
// Complete receipt inventory captured after the unchanged 031 -> 042 -> 047
// migrations, and after optional 050. Includes every column, constraint, index,
// and trigger; other capabilities retain their own schema inventories.
const RECEIPT_047='a7184f19a7bae6b9fcd94aa2099dd63187a25f3f988c6d79c91f0e2c4187c9b3';
const RECEIPT_047_050='383852a01474f598915d2e58548f6d95f5b64bd7810052ba5f6047e2e079ecff';
const RECEIPT_PREDECESSORS=['031_p2_016_ticket_lifecycle_workbench_notifications','042_workbench_manual_reports','047_workbench_personal_read'] as const;
const BOT_MIGRATION_ID='050_bot_reporter_feedback';
type Marker = { migration_id: string; checksum_sha256: string };
type ReceiptMarker = Marker & { parent: boolean; fallback: boolean; prerequisite: boolean; closure: boolean };

async function checksumMatches(marker: Marker): Promise<boolean> {
  const file = new URL('../../../database/migrations/'+marker.migration_id+'.sql', import.meta.url);
  return marker.checksum_sha256 === createHash('sha256').update(await readFile(file)).digest('hex');
}

type Prerequisite = { migrationId: string; checksum: () => Promise<string> };
type ReceiptRequest = {
  prerequisite?: Prerequisite;
  catalogRelations?: readonly string[];
};

export async function readReadyFollowReceipt(tx: PostgresTransaction, request: ReceiptRequest = {}) {
  const {prerequisite, catalogRelations = []} = request;
  const parentIds = [...RECEIPT_PREDECESSORS, BOT_MIGRATION_ID];
  const markers = (await tx.query<ReceiptMarker>(
    `SELECT * FROM (
       SELECT migration_id, checksum_sha256,
              migration_id = ANY($1::text[]) AS parent,
              migration_id = ANY($2::text[]) AS fallback,
              COALESCE(migration_id = $3, false) AS prerequisite,
              migration_id = $4 AS closure
         FROM platform.schema_migration
     ) AS matches
     WHERE parent OR fallback OR prerequisite OR closure
     ORDER BY migration_id`,
    [parentIds, [...parentIds, CONVERSATION_DELIVERY_MIGRATION_ID], prerequisite?.migrationId ?? null, SERVICE_CLOSURE_MIGRATION_ID],
  )).rows;
  const checksumsMatch = (rows: Marker[], expected: string) =>
    rows.length > 0 && rows.every(row => row.checksum_sha256 === expected);
  if (prerequisite) {
    const expected = await prerequisite.checksum();
    if (!checksumsMatch(markers.filter(row => row.prerequisite), expected)) return null;
  }
  const parents = markers.filter(row => row.parent);
  // Presence uses the original ID spelling. Checksum loops use every SQL match.
  const registeredParents = new Set(parents.map(row => row.migration_id));
  if (RECEIPT_PREDECESSORS.some(id => !registeredParents.has(id))) return null;
  for (const marker of parents) {
    if (!await checksumMatches(marker)) return null;
  }

  const closureMarkers = markers.filter(row => row.closure);
  const closure = closureMarkers.length > 0;
  const catalog = await readWorkbenchCatalog(tx, [RECEIPT_RELATION, ...catalogRelations], closure, true);
  // The file and the scalar 076 marker are read at the first predecessor check.
  let fk: ReturnType<typeof readWorkbenchFkPredecessors> | undefined;
  async function priorIndexes(relations: readonly string[], rows: Record<string, unknown>[]) {
    const project = await (fk ??= readWorkbenchFkPredecessors(tx, catalog.indexes));
    return project(relations, rows);
  }
  let receipt;
  try {
    receipt = await normalizeServiceClosureReceiptCatalog(
      tx, projectWorkbenchCatalog(catalog, [RECEIPT_RELATION], 'receipt'), closure, {
        closureReady: async () => checksumsMatch(closureMarkers, await serviceClosureChecksum()) && catalog.closure_present,
        priorIndexes: rows => priorIndexes([RECEIPT_RELATION], rows),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'SERVICE_CLOSURE_SCHEMA_DRIFT') return null;
    throw error;
  }
  if (!receipt) return null;
  const digest = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  const bot = registeredParents.has(BOT_MIGRATION_ID);
  if (digest !== (bot ? RECEIPT_047_050 : RECEIPT_047)) {
    const fallback = markers.filter(row => row.fallback);
    const registeredFallback = new Set(fallback.map(row => row.migration_id));
    if (!registeredFallback.has(CONVERSATION_DELIVERY_MIGRATION_ID)) return null;
    for (const marker of fallback) {
      if (!await checksumMatches(marker)) return null;
    }
    if (!matchesReceiptShape(digest, bot ? 'BOT' : 'INTAKE', 'after')) return null;
  }
  // Before 071, the catalog inventory can see the receipt without schema USAGE.
  if (!closure) {
    const access = await tx.query<{allowed: boolean | null}>(
      "SELECT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('pilot_ticket'), 'USAGE') AS allowed",
    );
    if (access.rows[0]?.allowed !== true) return null;
  }
  return {catalog, priorIndexes};
}

export async function followReceiptSchemaReady(tx: PostgresTransaction, prerequisite?: Prerequisite): Promise<boolean> {
  return Boolean(await readReadyFollowReceipt(tx, prerequisite ? {prerequisite} : {}));
}
/** Exact feature inventory. No weakening of the existing receipt resource/purpose guards. */
export async function followSchemaReady(tx:PostgresTransaction):Promise<boolean>{
  if (!await followReceiptSchemaReady(tx)) return false;
  const fk = await fkPredecessorParameters(['pilot_ticket.workbench_item_follow']);
  const sql=await readFile(SQL_URL,'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
  // PG18's view supplies caller-specific column visibility and the domain/base-type
  // mapping. Keep both counts on one view scan, reached only after the receipt gate.
  const row=(await tx.query<{ready:boolean}>(`SELECT
    EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id=$4 AND checksum_sha256=$5)
    AND EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read')
    AND f.relkind='r' AND f.relpersistence='p' AND NOT f.relispartition AND NOT f.relrowsecurity AND NOT f.relforcerowsecurity
    AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=f.oid AND NOT tgisinternal)
    AND (SELECT count(*)=6 AND count(*) FILTER (WHERE is_nullable='NO' AND is_generated='NEVER' AND
      ((column_name IN ('principal_id','source_intake_id') AND data_type='uuid' AND column_default IS NULL)
       OR (column_name='following' AND data_type='boolean' AND column_default IS NULL)
       OR (column_name='row_version' AND data_type='bigint' AND column_default='1')
       OR (column_name IN ('created_at','updated_at') AND data_type='timestamp without time zone' AND column_default='platform.local_now()')))=6
      FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='workbench_item_follow')
    AND (SELECT count(*)=10
      AND count(*) FILTER (WHERE contype='n' AND convalidated AND pg_get_constraintdef(oid) IN
        ('NOT NULL principal_id','NOT NULL source_intake_id','NOT NULL following','NOT NULL row_version','NOT NULL created_at','NOT NULL updated_at'))=6
      AND count(*) FILTER (WHERE contype='p' AND convalidated AND pg_get_constraintdef(oid)='PRIMARY KEY (principal_id, source_intake_id)')>0
      AND count(*) FILTER (WHERE contype='c' AND convalidated AND pg_get_constraintdef(oid)='CHECK ((row_version >= 1))')>0
      AND count(*) FILTER (WHERE contype='f' AND convalidated AND pg_get_constraintdef(oid)='FOREIGN KEY (principal_id) REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT')>0
      AND count(*) FILTER (WHERE contype='f' AND convalidated AND pg_get_constraintdef(oid)='FOREIGN KEY (source_intake_id) REFERENCES intake.service_intake(id) ON DELETE RESTRICT')>0
      FROM pg_constraint WHERE conrelid=f.oid)
    AND (SELECT count(*)=2+${FK_PREDECESSOR_COUNT_SQL}
      AND count(*) FILTER (WHERE i.indisvalid AND i.indisready AND i.indisunique AND i.indisprimary)>0
      AND count(*) FILTER (WHERE ix.relname='workbench_item_follow_active_idx'
        AND i.indisvalid AND i.indisready AND NOT i.indisunique AND NOT i.indisprimary
        AND pg_get_indexdef(i.indexrelid)='CREATE INDEX workbench_item_follow_active_idx ON pilot_ticket.workbench_item_follow USING btree (principal_id, source_intake_id) WHERE following')>0
      FROM pg_index i LEFT JOIN pg_class ix ON ix.oid=i.indexrelid
      WHERE i.indrelid=f.oid) AS ready
    FROM pg_class f WHERE f.oid=to_regclass('pilot_ticket.workbench_item_follow')`,[...fk.values,FOLLOW_MIGRATION_ID,checksum])).rows[0];
  return row?.ready===true;
}
export async function migrateWorkbenchFollow({databaseUrl,mode='check'}:{databaseUrl:MigrationDatabase;mode?:'check'|'apply'|'status'}){
  if(!databaseUrl||!['check','apply','status'].includes(mode))failP2016();
  const sql=await readFile(SQL_URL,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex'),pool=createPostgresPool({...migrationConnection(databaseUrl),max:1,application_name:'workbench_follow_migrator'}),tx=await pool.connect();
  try{
    await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='60s'");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('WORKBENCH_FOLLOW_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read'")).rowCount!==1)failP2016('ACTION_FAILED',409);
    const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[FOLLOW_MIGRATION_ID])).rows[0];
    if(old){if(old.checksum_sha256!==checksum||!await followSchemaReady(tx))failP2016('ACTION_FAILED',409);await tx.query('ROLLBACK');return {status:'NOOP_ALREADY_APPLIED',migration_id:FOLLOW_MIGRATION_ID};}
    if(mode==='status'){await tx.query('ROLLBACK');return {status:'PENDING',migration_id:FOLLOW_MIGRATION_ID};}
    await tx.query(body);await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[FOLLOW_MIGRATION_ID,checksum]);
    if(!await followSchemaReady(tx))failP2016('ACTION_FAILED',409);
    await tx.query(mode==='check'?'ROLLBACK':'COMMIT');return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:FOLLOW_MIGRATION_ID};
  }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}
  finally{tx.release();await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL;
 if(!databaseUrl||args.length>1||args.some(x=>!['--check','--apply','--status'].includes(x)))throw Error('FOLLOW_MIGRATION_INPUT_INVALID');
 try{console.log(JSON.stringify(await migrateWorkbenchFollow({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--status'?'status':'check'})));}
 catch{console.error(JSON.stringify({ok:false,error_code:'FOLLOW_MIGRATION_FAILED'}));process.exitCode=1;}
}
