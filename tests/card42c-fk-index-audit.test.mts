import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  FK_AUDIT_SQL,
  FK_HOT_JOIN_MAP,
  FK_PROPOSED_INDEX_MAP,
  classifyForeignKey,
  evaluateForeignKeyAudit,
  parentKeyMutatedReason,
  parseFkAuditArgs,
  renderForeignKeyAuditMarkdown,
} from '../app/server/scripts/fk-index-audit.mjs';
import { FK_INDEX_TARGETS, fkIndexesSchemaReady, fkIndexesStructureValid } from '../app/server/scripts/fk-indexes-migrate.mjs';
import {
  EXPECTED_POST_077_LOCAL_NOW_NORMALIZED_BODY,
  RETENTION_INDEX_TARGETS,
  retentionTimeContractSchemaReady,
  retentionTimeContractStructureValid,
} from '../app/server/scripts/retention-and-time-contract-migrate.mjs';

test('076 and 077 structure and readiness queries reference every bound parameter', async () => {
  for (const check of [fkIndexesStructureValid, fkIndexesSchemaReady, retentionTimeContractStructureValid, retentionTimeContractSchemaReady]) {
    await check({ async query(sql, values = []) {
      const positions = new Set(Array.from(sql.matchAll(/\$(\d+)/gu), match => Number(match[1])));
      assert.deepEqual(positions, new Set(values.map((_, index) => index + 1)), check.name);
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
    } });
  }
});

function readSql(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/--[^\n]*/gu, '');
}

function parseCreateIndexes(sql: string): Array<{ schema: string; name: string; table: string; columns: string[]; isPartial: boolean }> {
  const results: Array<{ schema: string; name: string; table: string; columns: string[]; isPartial: boolean }> = [];
  const pattern = /CREATE\s+INDEX\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(([^)]+)\)\s*([^;]*);/gu;
  for (const match of sql.matchAll(pattern)) {
    const name = match[1] ?? '';
    const schema = match[2] ?? '';
    const table = match[3] ?? '';
    const colsRaw = match[4] ?? '';
    const tail = match[5] ?? '';
    results.push({
      schema,
      name,
      table: `${schema}.${table}`,
      columns: colsRaw.split(',').map((part) => part.trim()),
      isPartial: /\bWHERE\b/iu.test(tail),
    });
  }
  return results;
}

test('fk-index-audit classifies supported, partial-only, high-volume, parent-deleted, hot-join, and low-volume FKs', () => {
  const rows = [
    {
      schema_table: 'pilot_ticket.ticket_event',
      constraint_name: 'ticket_event_ticket_id_fkey',
      columns: ['ticket_id'],
      parent_table: 'pilot_ticket.ticket',
      on_delete: 'CASCADE',
      on_update: 'NO ACTION',
      supporting_index_name: 'ticket_event_ticket_created_idx',
      partial_only_index_name: null,
    },
    {
      schema_table: 'pilot_ticket.closure_record',
      constraint_name: 'closure_record_ticket_id_fkey',
      columns: ['ticket_id'],
      parent_table: 'pilot_ticket.ticket',
      on_delete: 'CASCADE',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: 'closure_ticket_current_idx',
    },
    {
      schema_table: 'communication.message',
      constraint_name: 'communication_message_reply_item_fk',
      columns: ['reply_to_conversation_item_id'],
      parent_table: 'conversation.item',
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'intake.deterministic_decision',
      constraint_name: 'deterministic_decision_channel_leg_id_fkey',
      columns: ['channel_leg_id'],
      parent_table: 'intake.channel_leg',
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'intake.deterministic_decision',
      constraint_name: 'deterministic_decision_web_leg_fk',
      columns: ['channel_leg_id', 'service_intake_id', 'primary_web_submission_id'],
      parent_table: 'intake.channel_leg',
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'incident.incident',
      constraint_name: 'incident_primary_ticket_id_fkey',
      columns: ['primary_ticket_id'],
      parent_table: 'pilot_ticket.ticket',
      parent_columns: ['id'],
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'incident.incident_event',
      constraint_name: 'incident_event_actor_principal_id_fkey',
      columns: ['actor_principal_id'],
      parent_table: 'auth.principal',
      parent_columns: ['id'],
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'incident.incident_report',
      constraint_name: 'incident_report_ticket_id_fkey',
      columns: ['ticket_id'],
      parent_table: 'pilot_ticket.ticket',
      parent_columns: ['id'],
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'intake.web_report_urge',
      constraint_name: 'web_report_urge_cycle_id_fkey',
      columns: ['cycle_id'],
      parent_table: 'pilot_ticket.ticket_handling_cycle',
      parent_columns: ['id'],
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: null,
      partial_only_index_name: null,
    },
    {
      schema_table: 'pilot_ticket.ticket',
      constraint_name: 'ticket_completion_cycle_fk',
      columns: ['id', 'current_handling_cycle_id', 'staff_completion_event_id'],
      parent_table: 'pilot_ticket.ticket_handling_cycle',
      parent_columns: ['ticket_id', 'id', 'staff_completion_event_id'],
      on_delete: 'RESTRICT',
      on_update: 'NO ACTION',
      supporting_index_name: 'ticket_completion_cycle_idx',
      partial_only_index_name: null,
    },
  ] as const;

  const supported = classifyForeignKey(rows[0]);
  assert.equal(supported.decision, '已有');

  const partialOnly = classifyForeignKey(rows[1]);
  assert.equal(partialOnly.decision, '补');
  assert.equal(partialOnly.partial_only_index_name, 'closure_ticket_current_idx');
  assert.equal(partialOnly.proposed_index_name, 'closure_record_ticket_fk_idx');
  assert.match(partialOnly.reason, /\(b\)/u);
  assert.match(partialOnly.reason, /\(c\)/u);

  const parentDeleted = classifyForeignKey(rows[2]);
  assert.equal(parentDeleted.decision, '补');
  assert.match(parentDeleted.reason, /\(a\)/u);

  const lowVolume = classifyForeignKey(rows[5]);
  assert.equal(lowVolume.decision, '不补');
  assert.equal(lowVolume.proposed_index_name, null);

  const incidentActor = classifyForeignKey(rows[6]);
  assert.equal(incidentActor.decision, '补');
  assert.equal(incidentActor.proposed_index_name, 'incident_event_actor_principal_fk_idx');
  assert.match(incidentActor.reason, /\(c\)/u);

  const incidentTicket = classifyForeignKey(rows[7]);
  assert.equal(incidentTicket.decision, '补');
  assert.equal(incidentTicket.proposed_index_name, 'incident_report_ticket_fk_idx');
  assert.match(incidentTicket.reason, /\(c\)/u);

  // confkey precision (Med 1): ticket_handling_cycle(id) does not trigger (a), while staff_completion_event_id does.
  assert.equal(parentKeyMutatedReason('pilot_ticket.ticket_handling_cycle', ['id']), null);
  assert.match(
    parentKeyMutatedReason('pilot_ticket.ticket_handling_cycle', ['ticket_id', 'id', 'staff_completion_event_id']) ?? '',
    /staff_completion_event_id/u,
  );
  const urgeCycle = classifyForeignKey(rows[8]);
  assert.equal(urgeCycle.decision, '补');
  assert.equal(/\b\(a\)/u.test(urgeCycle.reason), false);

  const report = evaluateForeignKeyAudit(rows, 0);
  assert.equal(report.summary.total, 10);
  assert.equal(report.summary.supported, 2);
  assert.equal(report.summary.missing, 8);
  assert.equal(report.summary.missing_with_partial_only, 1);
  assert.equal(report.summary.add_count, 7);
  assert.equal(report.summary.skip_count, 1);
  // Two deterministic_decision FKs share deterministic_decision_leg_intake_sub_fk_idx.
  assert.equal(report.summary.distinct_indexes_proposed, 6);
  assert.equal(report.summary.distinct_076_indexes_created, 0);

  const preMarkdown = renderForeignKeyAuditMarkdown(report, { phase: 'pre-076' });
  assert.match(preMarkdown, /\| 审计阶段 \| pre-076 \|/u);
  assert.match(preMarkdown, /\| 结论：补（待补\/残留） \| 7 \|/u);
  assert.match(preMarkdown, /\| 结论：不补 \| 1 \|/u);
  assert.match(preMarkdown, /（合成）/u);
  assert.match(preMarkdown, /incident\.incident/u);

  const postMarkdown = renderForeignKeyAuditMarkdown(report, { phase: 'post-076' });
  assert.match(postMarkdown, /\| 审计阶段 \| post-076 \|/u);
  assert.match(postMarkdown, /\| 已物理创建 076 索引数 \| 0 \|/u);

  // High 1 & Med 1 catalog query guards: B-tree only, ordered indkey prefix match, confkey projected.
  assert.match(FK_AUDIT_SQL, /am\.amname = 'btree'/u);
  assert.match(FK_AUDIT_SQL, /indnkeyatts >= cardinality\(fk\.conkey\)/u);
  assert.match(FK_AUDIT_SQL, /unnest\(i\.indkey::smallint\[\]\) WITH ORDINALITY/u);
  assert.match(FK_AUDIT_SQL, /c\.confkey/u);
  assert.match(FK_AUDIT_SQL, /AS parent_columns/u);
});

test('fk-index-audit CLI parser handles formats, phases, and rejects invalid arguments', () => {
  assert.deepEqual(parseFkAuditArgs([]), { format: 'markdown', phase: 'auto', writePath: null });
  assert.deepEqual(parseFkAuditArgs(['--format=json', '--phase=post-076', '--write=out.json']), {
    format: 'json',
    phase: 'post-076',
    writePath: 'out.json',
  });
  assert.deepEqual(parseFkAuditArgs(['--phase=pre-076']), {
    format: 'markdown',
    phase: 'pre-076',
    writePath: null,
  });
  assert.throws(() => parseFkAuditArgs(['--write=']), /FK_INDEX_AUDIT_ARGUMENT_INVALID/u);
  assert.throws(() => parseFkAuditArgs(['--unknown']), /FK_INDEX_AUDIT_ARGUMENT_INVALID/u);
});

test('076_fk_indexes.sql covers every proposed FK index cleanly, within 63-byte limit, without touching 42A objects', () => {
  const sql076 = stripSqlComments(readSql('database/migrations/076_fk_indexes.sql'));
  const parsed = parseCreateIndexes(sql076);
  assert.equal(parsed.length, FK_INDEX_TARGETS.length);
  assert.equal(parsed.length, 74);

  for (const idx of parsed) {
    assert.ok(idx.name.length <= 63, `Index name exceeds 63 bytes: ${idx.name}`);
    assert.equal(idx.isPartial, false, `FK index must not be partial: ${idx.name}`);
  }

  const targetNames = parsed.map((idx) => `${idx.schema}.${idx.name}`);
  assert.equal(new Set(targetNames).size, 74);
  assert.deepEqual(
    targetNames,
    FK_INDEX_TARGETS.map((entry) => `${entry.schema}.${entry.name}`),
  );

  // Every FK classified as 补 in FK_PROPOSED_INDEX_MAP has a matching leading-column index in 076.
  for (const [key, indexName] of Object.entries(FK_PROPOSED_INDEX_MAP)) {
    const [table, colsJoined] = key.split('|');
    const cols = (colsJoined ?? '').split(',');
    const matched = parsed.find(
      (idx) =>
        idx.table === table
        && idx.name === indexName
        && idx.columns.length >= cols.length
        && cols.every((col, pos) => idx.columns[pos] === col),
    );
    assert.ok(matched, `Missing 076 index for ${key} -> ${indexName}`);
  }

  assert.equal(/terminal_at|terminal_epoch_ms|ticket_terminal_idx/u.test(sql076), false);
});

test('Incident delivery and subscription detail joins label existing FK supports without proposing indexes', () => {
  for (const key of [
    'communication.incident_notification_binding|communication_message_id',
    'communication.incident_notification_binding|incident_event_id',
    'communication.incident_notification_binding|incident_id',
    'incident.reporter_subscription|incident_id',
  ]) {
    assert.match(FK_HOT_JOIN_MAP[key] ?? '', /p2-012-incident-query/u);
    assert.equal(Object.hasOwn(FK_PROPOSED_INDEX_MAP, key), false);
  }
});

test('077_retention_and_time_contract.sql maintains time, retention index, and realtime expiry contracts without touching 42A', () => {
  const sql077 = stripSqlComments(readSql('database/migrations/077_retention_and_time_contract.sql'));
  const parsed = parseCreateIndexes(sql077);
  assert.equal(parsed.length, RETENTION_INDEX_TARGETS.length);
  assert.equal(parsed.length, 9);

  for (const idx of parsed) {
    assert.ok(idx.name.length <= 63, `Retention index name exceeds 63 bytes: ${idx.name}`);
    assert.equal(idx.isPartial, false);
    assert.equal(idx.columns[0], 'retention_until_epoch_ms');
  }

  assert.deepEqual(
    parsed.map((idx) => `${idx.schema}.${idx.name}`),
    RETENTION_INDEX_TARGETS.map((entry) => `${entry.schema}.${entry.name}`),
  );

  const fnMatch = /CREATE OR REPLACE FUNCTION platform\.local_now\(\)([\s\S]*?)AS \$card42c_local_now\$([\s\S]*?)\$card42c_local_now\$/u.exec(sql077);
  assert.ok(fnMatch, 'Expected platform.local_now() definition');
  assert.equal(/SET\s+search_path/iu.test(fnMatch[1] ?? ''), false);
  const normalizedBody = (fnMatch[2] ?? '').trim().replace(/\s+/gu, ' ');
  assert.equal(normalizedBody, EXPECTED_POST_077_LOCAL_NOW_NORMALIZED_BODY);
  assert.match(sql077, /pg_catalog\.date_trunc\('second', pg_catalog\.timezone\('Asia\/Shanghai', pg_catalog\.transaction_timestamp\(\)\)\)/u);
  assert.equal(/CREATE OR REPLACE FUNCTION platform\.physical_epoch_ms/iu.test(sql077), false);
  assert.match(sql077, /DROP INDEX IF EXISTS conversation\.conversation_realtime_event_expiry_event_idx;/u);
  assert.match(sql077, /\$card42c_local_now_contract\$/u);
  assert.match(sql077, /p\.provolatile = 'v'/u);
  assert.match(sql077, /\$card42c_realtime_expiry_index_contract\$/u);
  assert.match(sql077, /conversation_realtime_expiry_epoch_idx/u);
  assert.equal(/terminal_at|terminal_epoch_ms|ticket_terminal_idx/u.test(sql077), false);
});
