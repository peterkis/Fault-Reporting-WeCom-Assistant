import {migrationConnection} from './migration-database.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import type { PostgresTransaction } from '../src/platform/postgres-pool.mjs';
import { transactionP2016, failP2016 } from '../src/p2-016-domain-contracts.mjs';

/** Card 42C-1: B-tree supporting indexes for foreign key columns across high-volume, parent-mutated, and hot-JOIN tables. */
export const FK_INDEXES_MIGRATION_ID = '076_fk_indexes';
const file = new URL('../../../database/migrations/076_fk_indexes.sql', import.meta.url);

export interface ExpectedFkIndexTarget {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly columns: readonly string[];
}

const RAW_FK_INDEX_TARGETS: readonly ExpectedFkIndexTarget[] = [
  { schema: 'communication', table: 'message', name: 'communication_message_reply_item_fk_idx', columns: ['reply_to_conversation_item_id'] },
  { schema: 'conversation', table: 'assignment', name: 'conversation_assignment_assigned_principal_fk_idx', columns: ['assigned_principal_id'] },
  { schema: 'conversation', table: 'assignment', name: 'conversation_assignment_assigned_by_fk_idx', columns: ['assigned_by_principal_id'] },
  { schema: 'conversation', table: 'control_event', name: 'conversation_control_event_actor_fk_idx', columns: ['actor_principal_id'] },
  { schema: 'conversation', table: 'control_event', name: 'conversation_control_event_target_fk_idx', columns: ['target_principal_id'] },
  { schema: 'conversation', table: 'control_event', name: 'conversation_control_event_handoff_fk_idx', columns: ['handoff_id'] },
  { schema: 'conversation', table: 'handoff', name: 'conversation_handoff_requested_by_fk_idx', columns: ['requested_by_principal_id'] },
  { schema: 'conversation', table: 'handoff', name: 'conversation_handoff_assigned_principal_fk_idx', columns: ['assigned_principal_id'] },
  { schema: 'conversation', table: 'item_source_binding', name: 'conversation_item_source_binding_item_session_fk_idx', columns: ['item_id', 'session_id'] },
  { schema: 'conversation', table: 'session', name: 'conversation_session_service_intake_fk_idx', columns: ['service_intake_id'] },
  { schema: 'incident', table: 'incident_event', name: 'incident_event_actor_principal_fk_idx', columns: ['actor_principal_id'] },
  { schema: 'incident', table: 'incident_report', name: 'incident_report_ticket_fk_idx', columns: ['ticket_id'] },
  { schema: 'intake', table: 'channel_leg', name: 'channel_leg_conversation_thread_fk_idx', columns: ['conversation_thread_id'] },
  { schema: 'intake', table: 'channel_leg', name: 'channel_leg_conversation_session_fk_idx', columns: ['conversation_session_id'] },
  { schema: 'intake', table: 'channel_leg', name: 'channel_leg_origin_channel_message_fk_idx', columns: ['origin_channel_message_id'] },
  { schema: 'intake', table: 'channel_leg', name: 'channel_leg_web_submission_intake_fk_idx', columns: ['web_submission_id', 'source_intake_id'] },
  { schema: 'intake', table: 'contact_journey', name: 'contact_journey_origin_session_fk_idx', columns: ['origin_session_id'] },
  { schema: 'intake', table: 'contact_journey', name: 'contact_journey_current_session_fk_idx', columns: ['current_session_id'] },
  { schema: 'intake', table: 'contact_journey', name: 'contact_journey_linked_ticket_fk_idx', columns: ['linked_ticket_id'] },
  { schema: 'intake', table: 'continuation_ref', name: 'continuation_ref_journey_fk_idx', columns: ['journey_id'] },
  { schema: 'intake', table: 'continuation_ref', name: 'continuation_ref_origin_leg_fk_idx', columns: ['origin_leg_id'] },
  { schema: 'intake', table: 'continuation_ref', name: 'continuation_ref_target_leg_fk_idx', columns: ['target_leg_id'] },
  { schema: 'intake', table: 'deterministic_decision', name: 'deterministic_decision_leg_intake_sub_fk_idx', columns: ['channel_leg_id', 'service_intake_id', 'primary_web_submission_id'] },
  { schema: 'intake', table: 'deterministic_decision', name: 'deterministic_decision_session_fk_idx', columns: ['conversation_session_id'] },
  { schema: 'intake', table: 'deterministic_decision', name: 'deterministic_decision_linked_ticket_fk_idx', columns: ['linked_ticket_id'] },
  { schema: 'intake', table: 'deterministic_decision', name: 'deterministic_decision_primary_web_sub_fk_idx', columns: ['primary_web_submission_id'] },
  { schema: 'intake', table: 'manual_review_item', name: 'manual_review_item_decision_fk_idx', columns: ['decision_id'] },
  { schema: 'intake', table: 'manual_review_item', name: 'manual_review_item_service_intake_fk_idx', columns: ['service_intake_id'] },
  { schema: 'intake', table: 'manual_review_item', name: 'manual_review_item_linked_ticket_fk_idx', columns: ['linked_ticket_id'] },
  { schema: 'intake', table: 'manual_review_item', name: 'manual_review_item_resolved_by_fk_idx', columns: ['resolved_by_principal_id'] },
  { schema: 'intake', table: 'manual_review_item', name: 'manual_review_item_resolution_decision_fk_idx', columns: ['resolution_decision_id'] },
  { schema: 'intake', table: 'service_intake', name: 'service_intake_primary_web_sub_id_fk_idx', columns: ['primary_web_submission_id', 'id'] },
  { schema: 'intake', table: 'service_intake', name: 'service_intake_manual_actor_fk_idx', columns: ['manual_actor_principal_id'] },
  { schema: 'intake', table: 'ticket_reporter_profile', name: 'ticket_reporter_profile_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'intake', table: 'web_media_upload', name: 'web_media_upload_intake_fk_idx', columns: ['intake_id'] },
  { schema: 'intake', table: 'web_media_upload', name: 'web_media_upload_request_ref_fk_idx', columns: ['request_ref'] },
  { schema: 'intake', table: 'web_media_upload', name: 'web_media_upload_submission_intake_fk_idx', columns: ['submission_id', 'intake_id'] },
  { schema: 'intake', table: 'web_report_evaluation', name: 'web_report_evaluation_ticket_fk_idx', columns: ['ticket_id'] },
  { schema: 'intake', table: 'web_report_evaluation', name: 'web_report_evaluation_completion_event_fk_idx', columns: ['completion_event_id'] },
  { schema: 'intake', table: 'web_report_evaluation', name: 'web_report_evaluation_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'intake', table: 'web_report_urge', name: 'web_report_urge_cycle_fk_idx', columns: ['cycle_id'] },
  { schema: 'intake', table: 'web_report_urge', name: 'web_report_urge_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'intake', table: 'web_submission', name: 'web_submission_command_receipt_fk_idx', columns: ['command_receipt_id'] },
  { schema: 'intake', table: 'web_submission', name: 'web_submission_intake_reporter_fk_idx', columns: ['intake_id', 'canonical_reporter_binding'] },
  { schema: 'notification', table: 'card_action_task', name: 'card_action_task_ticket_fk_idx', columns: ['ticket_id'] },
  { schema: 'operations', table: 'audit_event', name: 'audit_event_actor_principal_fk_idx', columns: ['actor_principal_id'] },
  { schema: 'pilot_ticket', table: 'closure_record', name: 'closure_record_ticket_fk_idx', columns: ['ticket_id'] },
  { schema: 'pilot_ticket', table: 'closure_record', name: 'closure_record_intake_fk_idx', columns: ['intake_id'] },
  { schema: 'pilot_ticket', table: 'closure_record', name: 'closure_record_ticket_event_fk_idx', columns: ['closure_ticket_event_id'] },
  { schema: 'pilot_ticket', table: 'closure_record', name: 'closure_record_intake_event_fk_idx', columns: ['closure_intake_event_id'] },
  { schema: 'pilot_ticket', table: 'closure_record', name: 'closure_record_aborted_cycle_event_fk_idx', columns: ['aborted_cycle_event_id'] },
  { schema: 'pilot_ticket', table: 'closure_supplement_termination', name: 'closure_supplement_term_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'pilot_ticket', table: 'follow_up_schedule', name: 'follow_up_schedule_ticket_version_fk_idx', columns: ['ticket_id', 'schedule_version'] },
  { schema: 'pilot_ticket', table: 'follow_up_schedule', name: 'follow_up_schedule_ticket_event_fk_idx', columns: ['ticket_id', 'scheduled_event_id'] },
  { schema: 'pilot_ticket', table: 'follow_up_schedule_revision', name: 'follow_up_schedule_rev_ticket_event_fk_idx', columns: ['ticket_id', 'ticket_event_id'] },
  { schema: 'pilot_ticket', table: 'personal_material_read_position', name: 'personal_material_read_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'pilot_ticket', table: 'staff_completion_notification_commitment', name: 'staff_completion_commit_cycle_fk_idx', columns: ['ticket_id', 'cycle_id', 'ticket_event_id', 'source_intake_id'] },
  { schema: 'pilot_ticket', table: 'ticket', name: 'ticket_id_current_handling_cycle_fk_idx', columns: ['id', 'current_handling_cycle_id'] },
  { schema: 'pilot_ticket', table: 'ticket_command_receipt', name: 'ticket_command_receipt_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'pilot_ticket', table: 'ticket_command_receipt', name: 'ticket_command_receipt_closure_intake_fk_idx', columns: ['closure_intake_id'] },
  { schema: 'pilot_ticket', table: 'ticket_cycle_reopen', name: 'ticket_cycle_reopen_completed_cycle_fk_idx', columns: ['ticket_id', 'completed_cycle_id', 'completion_event_id', 'source_intake_id'] },
  { schema: 'pilot_ticket', table: 'ticket_cycle_reopen', name: 'ticket_cycle_reopen_reopen_event_fk_idx', columns: ['ticket_id', 'reopen_event_id'] },
  { schema: 'pilot_ticket', table: 'ticket_cycle_reopen', name: 'ticket_cycle_reopen_new_cycle_event_fk_idx', columns: ['ticket_id', 'new_cycle_id', 'reopen_event_id'] },
  { schema: 'pilot_ticket', table: 'ticket_handling_cycle', name: 'ticket_handling_cycle_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'pilot_ticket', table: 'ticket_handling_cycle', name: 'ticket_handling_cycle_first_principal_fk_idx', columns: ['first_responsibility_principal_id'] },
  { schema: 'pilot_ticket', table: 'ticket_handling_cycle', name: 'ticket_handling_cycle_first_team_fk_idx', columns: ['first_responsibility_team_id'] },
  { schema: 'pilot_ticket', table: 'ticket_handling_cycle', name: 'ticket_handling_cycle_first_event_fk_idx', columns: ['ticket_id', 'first_responsibility_event_id'] },
  { schema: 'pilot_ticket', table: 'ticket_handling_cycle', name: 'ticket_handling_cycle_start_event_fk_idx', columns: ['ticket_id', 'cycle_start_event_id'] },
  { schema: 'pilot_ticket', table: 'ticket_handling_cycle_event', name: 'ticket_handling_cycle_event_ticket_event_fk_idx', columns: ['ticket_id', 'ticket_event_id'] },
  { schema: 'pilot_ticket', table: 'ticket_public_progress', name: 'ticket_public_progress_ticket_event_fk_idx', columns: ['ticket_event_id'] },
  { schema: 'pilot_ticket', table: 'workbench_item_follow', name: 'workbench_item_follow_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'pilot_ticket', table: 'workbench_supplement_disposition', name: 'workbench_supp_disp_source_intake_fk_idx', columns: ['source_intake_id'] },
  { schema: 'pilot_ticket', table: 'workbench_supplement_disposition', name: 'workbench_supp_disp_actor_fk_idx', columns: ['actor_principal_id'] },
  { schema: 'pilot_ticket', table: 'workbench_supplement_reply_binding', name: 'workbench_supp_reply_source_intake_fk_idx', columns: ['source_intake_id'] },
];

export const FK_INDEX_TARGETS: readonly ExpectedFkIndexTarget[] = Object.freeze(
  RAW_FK_INDEX_TARGETS.map((entry) =>
    Object.freeze({
      schema: entry.schema,
      table: entry.table,
      name: entry.name,
      columns: Object.freeze([...entry.columns]),
    }),
  ),
);

const FK_TARGET_SPECS_JSON = JSON.stringify(FK_INDEX_TARGETS);

async function source() {
  const sql = await readFile(file, 'utf8');
  const body = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if (!body) failP2016();
  return { sql, body, checksum: createHash('sha256').update(sql).digest('hex') };
}

/** Applies the 076 FK index statements inside the caller's transaction without registering the migration marker. */
export async function applyFkIndexesSql(tx: Pick<PostgresTransaction, 'query'>): Promise<void> {
  const { body } = await source();
  await tx.query(body);
}

// There is exactly one record per array element. The bound exposes the small
// predecessor cardinality when PostgreSQL plans with the parameter value.
export const FK_STRUCTURE_COUNT_SQL = `
  (SELECT count(*)::integer
     FROM (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS spec(schema text, "table" text, name text, columns text[])
       LIMIT jsonb_array_length($1::jsonb)
     ) AS expected
     JOIN pg_namespace AS nsp ON nsp.nspname = expected.schema
     JOIN pg_class AS cls ON cls.relnamespace = nsp.oid AND cls.relname = expected.name::name
                         AND cls.relname = expected.name
     JOIN pg_am AS am ON am.oid = cls.relam
     JOIN pg_index AS idx ON idx.indexrelid = cls.oid
     JOIN pg_class AS tbl ON tbl.oid = idx.indrelid
     JOIN pg_namespace AS tnsp ON tnsp.oid = tbl.relnamespace
    WHERE tnsp.nspname = expected.schema
      AND tbl.relname = expected."table"
      AND cls.relkind = 'i'
      AND cls.relpersistence = 'p'
      AND am.amname = 'btree'
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indislive
      AND idx.indimmediate
      AND NOT idx.indisunique
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnatts = idx.indnkeyatts
      AND idx.indnkeyatts = cardinality(expected.columns)
      AND pg_get_indexdef(cls.oid) = format('CREATE INDEX %I ON %I.%I USING btree (%s)',
        expected.name, expected.schema, expected."table", array_to_string(expected.columns, ', '))
      AND ARRAY(
        SELECT att.attname::text
          FROM unnest(idx.indkey::smallint[]) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute AS att
            ON att.attrelid = tbl.oid
           AND att.attnum = k.attnum
         ORDER BY k.pos
      ) = expected.columns)
`;

export async function fkIndexesStructureValid(tx: Pick<PostgresTransaction, 'query'>): Promise<boolean> {
  const row = (await tx.query<{ structural_match_count: number }>(
    `SELECT ${FK_STRUCTURE_COUNT_SQL} AS structural_match_count`,
    [FK_TARGET_SPECS_JSON],
  )).rows[0];
  return row?.structural_match_count === FK_INDEX_TARGETS.length;
}

async function readFkIndexState(tx: Pick<PostgresTransaction, 'query'>, specsJson: string) {
  return (await tx.query<{ checksum_sha256: string | null; structural_match_count: number }>(
    `SELECT
       (SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id = $2::text) AS checksum_sha256,
       ${FK_STRUCTURE_COUNT_SQL} AS structural_match_count`,
    [specsJson, FK_INDEXES_MIGRATION_ID],
  )).rows[0];
}

export async function fkIndexesSchemaReady(tx: Pick<PostgresTransaction, 'query'>): Promise<boolean> {
  const { checksum } = await source();
  const row = await readFkIndexState(tx, FK_TARGET_SPECS_JSON);
  return row?.checksum_sha256 === checksum && row.structural_match_count === FK_INDEX_TARGETS.length;
}

/** Read the marker and index shapes in the same statement as the historical index count. */
export async function fkPredecessorParameters(relations:readonly string[]){
  const targets=FK_INDEX_TARGETS.filter(target=>relations.includes(target.schema+'.'+target.table));
  return {targets,values:[JSON.stringify(targets),FK_INDEXES_MIGRATION_ID,(await source()).checksum]};
}

export const FK_PREDECESSOR_COUNT_SQL = `(SELECT CASE
  WHEN marker IS NULL THEN 0
  WHEN marker=$3::text AND matches=jsonb_array_length($1::jsonb) THEN jsonb_array_length($1::jsonb)
  ELSE NULL END
  FROM (SELECT (SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$2::text) AS marker,
    ${FK_STRUCTURE_COUNT_SQL} AS matches) AS state)`;

export type WorkbenchIndexRow = {
  relation: string; name: string; valid: boolean; ready: boolean; unique: boolean; primary: boolean; definition: string;
  fk: {eligible: boolean; key_count: number; columns: string[]} | null;
};

function indexDefinition(target: ExpectedFkIndexTarget) {
  return 'CREATE INDEX '+target.name+' ON '+target.schema+'.'+target.table+' USING btree ('+target.columns.join(', ')+')';
}

function workbenchFkTargets(relations: readonly string[]) {
  return FK_INDEX_TARGETS.filter(t => relations.includes(t.schema+'.'+t.table));
}

function workbenchFkMatchCount(relations: readonly string[], indexes: readonly WorkbenchIndexRow[]) {
  const targets = workbenchFkTargets(relations);
  const valid = targets.every(target => indexes.some(row => {
    const facts = row.fk;
    return row.relation === target.schema+'.'+target.table && row.name === target.name
      && row.valid && row.ready && facts?.eligible && row.definition === indexDefinition(target)
      && facts.key_count === target.columns.length && facts.columns.length === target.columns.length
      && target.columns.every((column, ordinal) => facts.columns[ordinal] === column);
  }));
  return valid ? targets.length : null;
}

/** This scalar is read only when normalization reaches the predecessor check. */
export async function readWorkbenchFkPredecessors(tx: PostgresTransaction, indexes: readonly WorkbenchIndexRow[]) {
  const state = (await tx.query<{registered: boolean | null}>(`
    SELECT (SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$2::text)=$1::text AS registered
  `, [(await source()).checksum, FK_INDEXES_MIGRATION_ID])).rows[0];
  if (!state) throw Error('FK_INDEX_STATE_MISSING');
  return (relations: readonly string[], rows: Record<string,unknown>[]) => {
    const count = state.registered === null ? 0 : state.registered ? workbenchFkMatchCount(relations, indexes) : null;
    return projectPredecessorIndexes(workbenchFkTargets(relations), count, rows);
  };
}

/** Compare each actual inventoried row before projecting it out of an earlier digest. */
export async function predecessorIndexRows(tx:PostgresTransaction,relations:readonly string[],rows:Record<string,unknown>[]){
  const {targets,values}=await fkPredecessorParameters(relations);
  const count=(await tx.query<{registered:number|null}>(`SELECT ${FK_PREDECESSOR_COUNT_SQL} AS registered`,values)).rows[0]?.registered;
  return projectPredecessorIndexes(targets,count,rows);
}

function projectPredecessorIndexes(targets: readonly ExpectedFkIndexTarget[], count: number | null | undefined, rows: Record<string,unknown>[]) {
  if(count===0)return rows;
  if(count!==targets.length)return null;
  const removable=new Set<Record<string,unknown>>();
  for(const target of targets){
    const relation=target.schema+'.'+target.table;
    const definition=indexDefinition(target);
    const matches=rows.filter(row=>row.relation===relation&&row.name===target.name);
    const row=matches[0];
    if(matches.length!==1||!row||row.valid!==true||row.ready!==true||row.definition!==definition)return null;
    removable.add(row);
  }
  return rows.filter(row=>!removable.has(row));
}

async function findMissingFkIndexPrerequisites(tx: Pick<PostgresTransaction, 'query'>): Promise<string | null> {
  const row = (await tx.query<{ missing_ref: string | null }>(
    `SELECT (
       SELECT expected.schema || '.' || expected."table" || '.' || req.col
         FROM jsonb_to_recordset($1::jsonb) AS expected(schema text, "table" text, name text, columns text[])
         CROSS JOIN LATERAL unnest(expected.columns) AS req(col)
         LEFT JOIN pg_namespace AS nsp ON nsp.nspname = expected.schema
         LEFT JOIN pg_class AS tbl ON tbl.relnamespace = nsp.oid AND tbl.relname = expected."table" AND tbl.relkind = 'r'
         LEFT JOIN pg_attribute AS att ON att.attrelid = tbl.oid AND att.attname = req.col AND NOT att.attisdropped
        WHERE att.attnum IS NULL
        ORDER BY expected.schema, expected."table", req.col
        LIMIT 1
     ) AS missing_ref`,
    [FK_TARGET_SPECS_JSON],
  )).rows[0];
  return row?.missing_ref ?? null;
}

async function findOccupiedFkIndexName(tx: Pick<PostgresTransaction, 'query'>): Promise<string | null> {
  const row = (await tx.query<{ occupied_name: string | null }>(
    `SELECT (
       SELECT expected.schema || '.' || expected.name
         FROM jsonb_to_recordset($1::jsonb) AS expected(schema text, "table" text, name text, columns text[])
         JOIN pg_namespace AS nsp ON nsp.nspname = expected.schema
         JOIN pg_class AS cls ON cls.relnamespace = nsp.oid AND cls.relname = expected.name
        ORDER BY expected.schema, expected.name
        LIMIT 1
     ) AS occupied_name`,
    [FK_TARGET_SPECS_JSON],
  )).rows[0];
  return row?.occupied_name ?? null;
}

export async function dropFkIndexesBaseline(tx: Pick<PostgresTransaction, 'query'>): Promise<void> {
  for (const target of FK_INDEX_TARGETS) {
    if (!/^[a-z_][a-z0-9_]*$/u.test(target.schema) || !/^[a-z_][a-z0-9_]*$/u.test(target.name)) {
      throw Error('FK_INDEXES_IDENTIFIER_INVALID');
    }
    await tx.query(`DROP INDEX IF EXISTS ${target.schema}.${target.name}`);
  }
}

export async function migrateFkIndexes({
  databaseUrl,
  mode = 'check',
}: {
  databaseUrl: string;
  mode?: 'check' | 'apply' | 'rollback';
}) {
  if (!databaseUrl || !['check', 'apply', 'rollback'].includes(mode)) failP2016();
  const { body, checksum } = await source();
  const pool = createPostgresPool({
    ...migrationConnection(databaseUrl),
    max: 1,
    application_name: 'fk_indexes_migrator',
  });
  try {
    return await transactionP2016(pool, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('FK_INDEXES_MIGRATION'))");
      const registry = (await tx.query<{ present: boolean }>(
        "SELECT to_regclass('platform.schema_migration') IS NOT NULL AS present",
      )).rows[0];
      if (!registry?.present && mode === 'apply') {
        throw Error('FK_INDEXES_PREREQUISITE_MISSING:platform.schema_migration');
      }
      const existing = registry?.present ? (await tx.query<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id = $1',
        [FK_INDEXES_MIGRATION_ID],
      )).rows[0] : undefined;
      if (existing) {
        if (existing.checksum_sha256 !== checksum || !(await fkIndexesSchemaReady(tx))) {
          throw Error('FK_INDEXES_SCHEMA_DRIFT');
        }
        if (mode !== 'rollback') {
          return { status: 'NOOP_ALREADY_APPLIED', migration_id: FK_INDEXES_MIGRATION_ID };
        }
        await dropFkIndexesBaseline(tx);
        await tx.query('DELETE FROM platform.schema_migration WHERE migration_id = $1', [FK_INDEXES_MIGRATION_ID]);
        return { status: 'ROLLED_BACK', migration_id: FK_INDEXES_MIGRATION_ID };
      }
      if (mode === 'rollback') return { status: 'NOT_APPLIED', migration_id: FK_INDEXES_MIGRATION_ID };
      if (mode === 'check') return { status: 'PENDING', migration_id: FK_INDEXES_MIGRATION_ID };

      const missingPrereq = await findMissingFkIndexPrerequisites(tx);
      if (missingPrereq) throw Error(`FK_INDEXES_PREREQUISITE_MISSING:${missingPrereq}`);
      const occupied = await findOccupiedFkIndexName(tx);
      if (occupied) throw Error(`FK_INDEXES_TARGET_NAME_OCCUPIED:${occupied}`);

      await tx.query(body);
      if (!(await fkIndexesStructureValid(tx))) {
        throw Error('FK_INDEXES_SCHEMA_DRIFT');
      }
      await tx.query(
        `WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
         INSERT INTO platform.schema_migration(migration_id, checksum_sha256, applied_at, applied_epoch_ms)
         SELECT $1, $2, platform.local_from_epoch_ms(epoch), epoch FROM stamp`,
        [FK_INDEXES_MIGRATION_ID, checksum],
      );
      return { status: 'APPLIED', migration_id: FK_INDEXES_MIGRATION_ID };
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !['--check', '--apply', '--rollback'].includes(arg))) {
    throw Error('FK_INDEXES_ARGUMENT_INVALID');
  }
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) throw Error('FK_INDEXES_DATABASE_URL_REQUIRED');
  try {
    const mode = args[0] === '--apply' ? 'apply' : args[0] === '--rollback' ? 'rollback' : 'check';
    console.log(JSON.stringify(await migrateFkIndexes({ databaseUrl, mode })));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error_code: 'FK_INDEXES_MIGRATION_FAILED',
      detail: error instanceof Error ? error.message.slice(0, 200) : null,
    }));
    process.exitCode = 1;
  }
}

export {projectPredecessorIndexes as projectPredecessorIndexRows};
