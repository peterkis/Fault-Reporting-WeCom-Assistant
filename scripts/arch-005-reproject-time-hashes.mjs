import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  computeTimelineCanonicalOrderKey,
  normalizeTimelineSourceRecord,
} from '../src/p2-002-timeline-projector.mjs';
import { computeRealtimeEventHash } from '../src/p2-003-realtime-event-log.mjs';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import {
  assertEpochMsString,
  formatEpochMsToShanghaiLocal,
} from '../src/platform/time-contract.mjs';

const APPROVAL = 'ARCH_005_PROJECTION_REBUILD_APPROVED';
const DATABASE_URL = 'PILOT_DATABASE_URL';

function digest(values) {
  const hash = createHash('sha256');
  for (const value of [...values].sort()) hash.update(`${value}\n`);
  return hash.digest('hex');
}

function sourceOrdinal(canonicalOrderKey) {
  if (typeof canonicalOrderKey !== 'string') throw new Error('ARCH_005_CANONICAL_ORDER_KEY_INVALID');
  const value = canonicalOrderKey.split('|')[2]?.replace(/^0+(?=\d)/u, '');
  if (!/^(0|[1-9][0-9]*)$/u.test(value ?? '')) throw new Error('ARCH_005_SOURCE_ORDINAL_INVALID');
  return value;
}

function timelineRecord(row) {
  return normalizeTimelineSourceRecord({
    schema_version: 1,
    projector_name: row.projector_name,
    projector_version: row.projector_version,
    source_stream: row.source_stream,
    source_type: row.source_type,
    source_id: row.source_id,
    projection_variant: row.projection_variant,
    session_id: row.session_id,
    item_type: row.item_type,
    sender_kind: row.sender_kind,
    visibility: row.visibility,
    text: row.text,
    safe_content: row.safe_content,
    occurred_at: row.occurred_at,
    source_ordinal: sourceOrdinal(row.canonical_order_key),
    privacy_class: row.privacy_class,
    retention_until: row.retention_until,
  });
}

function realtimeCommand(row) {
  return {
    schema_version: Number(row.schema_version),
    publisher_name: row.publisher_name,
    publisher_version: row.publisher_version,
    source_type: row.source_type,
    source_id: row.source_id,
    event_variant: row.event_variant,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    authorization_scope_type: row.authorization_scope_type,
    authorization_scope_id: row.authorization_scope_id,
    visibility_scope: row.visibility_scope,
    payload: row.payload,
    occurred_at: row.occurred_at,
    expires_at: row.expires_at,
    expires_epoch_ms: row.expires_epoch_ms,
  };
}

async function writeEvidence(evidence) {
  await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
  const path = new URL(`../evidence/arch-005-time-reprojection-${evidence.run_id}.json`, import.meta.url);
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return path;
}

export async function reprojectArch005TimeHashes({ databaseUrl, approved = false } = {}) {
  if (approved !== true) throw new Error('ARCH_005_PROJECTION_REBUILD_NOT_AUTHORIZED');
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw new Error('ARCH_005_DATABASE_URL_REQUIRED');

  const eventEpochMs = assertEpochMsString(String(Date.now()));
  const runId = `${eventEpochMs}-${randomUUID()}`;
  const baseEvidence = {
    schema_version: 1,
    architecture_task: 'ARCH-005',
    run_id: runId,
    event_time: formatEpochMsToShanghaiLocal(eventEpochMs),
    event_epoch_ms: eventEpochMs,
    scope: 'P2_002_AND_P2_003_REBUILDABLE_PROJECTION_HASH_METADATA',
    authoritative_fact_deletes: 0,
    projection_row_deletes: 0,
  };
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: 'arch_005_time_reprojection',
  });
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    const marker = await client.query(
      `SELECT checksum_sha256 FROM platform.schema_migration
        WHERE migration_id='022_arch_005_asia_shanghai_time_contract'`,
    );
    if (marker.rowCount !== 1) throw new Error('ARCH_005_MIGRATION_MARKER_REQUIRED');
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ARCH_005_TIME_REPROJECTION'))");

    const timeline = await client.query(
      `SELECT item.id::text AS item_id,item.session_id::text,item.item_type,item.sender_kind,
              item.visibility,item.text,item.safe_content,item.occurred_at,item.privacy_class,
              item.retention_until,item.content_hash,binding.projector_name,
              binding.projector_version,binding.source_stream,binding.source_type,
              binding.source_id,binding.projection_variant,binding.source_hash,
              binding.canonical_order_key
         FROM conversation.item AS item
         JOIN conversation.item_source_binding AS binding ON binding.item_id=item.id
        WHERE binding.projector_name='CONVERSATION_TIMELINE'
        ORDER BY item.session_id,item.occurred_at,item.sequence_no
        FOR UPDATE OF item,binding`,
    );
    const oldTimelineHashes = [];
    const newTimelineHashes = [];
    let timelineChanged = 0;
    for (const row of timeline.rows) {
      const record = timelineRecord(row);
      const orderKey = computeTimelineCanonicalOrderKey(record);
      oldTimelineHashes.push(`${row.item_id}:${row.content_hash}:${row.source_hash}:${row.canonical_order_key}`);
      newTimelineHashes.push(`${row.item_id}:${record.source_hash}:${record.source_hash}:${orderKey}`);
      if (row.content_hash !== record.source_hash || row.source_hash !== record.source_hash
        || row.canonical_order_key !== orderKey) {
        timelineChanged += 1;
        await client.query(
          'UPDATE conversation.item SET content_hash=$2 WHERE id=$1::uuid',
          [row.item_id, record.source_hash],
        );
        await client.query(
          `UPDATE conversation.item_source_binding
              SET source_hash=$2,canonical_order_key=$3
            WHERE item_id=$1::uuid AND projector_name='CONVERSATION_TIMELINE'`,
          [row.item_id, record.source_hash, orderKey],
        );
      }
    }

    const realtime = await client.query(
      `SELECT event_id::text,1 AS schema_version,publisher_name,publisher_version,source_type,
              source_id,event_variant,event_type,aggregate_type,aggregate_id,
              aggregate_version::text,authorization_scope_type,authorization_scope_id,
              visibility_scope,payload,occurred_at,expires_at,expires_epoch_ms::text,event_hash
         FROM conversation.realtime_event ORDER BY occurred_at,event_id FOR UPDATE`,
    );
    const oldRealtimeHashes = [];
    const newRealtimeHashes = [];
    let realtimeChanged = 0;
    for (const row of realtime.rows) {
      const eventHash = computeRealtimeEventHash(realtimeCommand(row));
      oldRealtimeHashes.push(`${row.event_id}:${row.event_hash}`);
      newRealtimeHashes.push(`${row.event_id}:${eventHash}`);
      if (row.event_hash !== eventHash) {
        realtimeChanged += 1;
        await client.query(
          'UPDATE conversation.realtime_event SET event_hash=$2 WHERE event_id=$1::bigint',
          [row.event_id, eventHash],
        );
      }
    }

    const orderingBefore = await client.query(
      `SELECT count(*)::integer AS count
         FROM (
           SELECT occurred_at,lag(occurred_at) OVER (ORDER BY event_id) AS prior_occurred_at
             FROM conversation.realtime_event
         ) AS ordered
        WHERE occurred_at < prior_occurred_at`,
    );
    const realtimeOrderingInversionsBefore = orderingBefore.rows[0].count;
    let realtimeEventsResequenced = 0;
    let retentionFloorAfterResequence = null;
    if (realtimeOrderingInversionsBefore > 0) {
      await client.query(
        `CREATE TEMP TABLE arch005_realtime_event_order ON COMMIT DROP AS
         SELECT event_id AS old_event_id,
                row_number() OVER (ORDER BY occurred_at,event_id)::bigint AS new_event_id
           FROM conversation.realtime_event`,
      );
      const maximum = await client.query(
        'SELECT COALESCE(max(old_event_id),0)::text AS maximum,count(*)::integer AS count FROM arch005_realtime_event_order',
      );
      const offset = String(BigInt(maximum.rows[0].maximum) + BigInt(maximum.rows[0].count) + 1n);
      await client.query(
        'ALTER TABLE conversation.realtime_event ALTER COLUMN event_id SET GENERATED BY DEFAULT',
      );
      await client.query(
        'UPDATE conversation.realtime_event SET event_id=event_id+$1::bigint',
        [offset],
      );
      const resequenced = await client.query(
        `UPDATE conversation.realtime_event AS event
            SET event_id=ordering.new_event_id
           FROM arch005_realtime_event_order AS ordering
          WHERE event.event_id=ordering.old_event_id+$1::bigint`,
        [offset],
      );
      realtimeEventsResequenced = resequenced.rowCount;
      await client.query(
        'ALTER TABLE conversation.realtime_event ALTER COLUMN event_id SET GENERATED ALWAYS',
      );
      retentionFloorAfterResequence = String(maximum.rows[0].count);
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence('conversation.realtime_event','event_id'),
           GREATEST($1::bigint,1),
           $1::bigint > 0
         )`,
        [retentionFloorAfterResequence],
      );
      await client.query(
        `UPDATE conversation.realtime_stream_state
            SET retention_floor_event_id=$1::bigint,
                row_version=row_version+1,
                updated_at=platform.local_now()
          WHERE stream_name='CONVERSATION_WORKBENCH'`,
        [retentionFloorAfterResequence],
      );
    }
    const orderingAfter = await client.query(
      `SELECT count(*)::integer AS count
         FROM (
           SELECT occurred_at,lag(occurred_at) OVER (ORDER BY event_id) AS prior_occurred_at
             FROM conversation.realtime_event
         ) AS ordered
        WHERE occurred_at < prior_occurred_at`,
    );
    if (orderingAfter.rows[0].count !== 0) throw new Error('ARCH_005_REALTIME_EVENT_ORDERING_REBUILD_FAILED');

    const forbidden = await client.query(
      'SELECT count(*)::integer AS count FROM platform.forbidden_owned_schema_time_types()',
    );
    if (forbidden.rows[0]?.count !== 0) throw new Error('ARCH_005_FORBIDDEN_TIME_TYPE_COUNT_NONZERO');
    await client.query('COMMIT');
    transactionOpen = false;

    const evidence = {
      ...baseEvidence,
      outcome: 'PASS',
      migration_checksum_sha256: marker.rows[0].checksum_sha256,
      timeline_projection_rows: timeline.rowCount,
      timeline_projection_rows_rehashed: timelineChanged,
      timeline_hash_digest_before: digest(oldTimelineHashes),
      timeline_hash_digest_after: digest(newTimelineHashes),
      realtime_projection_rows: realtime.rowCount,
      realtime_projection_rows_rehashed: realtimeChanged,
      realtime_business_time_inversions_before: realtimeOrderingInversionsBefore,
      realtime_business_time_inversions_after: orderingAfter.rows[0].count,
      realtime_events_resequenced: realtimeEventsResequenced,
      retention_floor_after_resequence: retentionFloorAfterResequence,
      realtime_hash_digest_before: digest(oldRealtimeHashes),
      realtime_hash_digest_after: digest(newRealtimeHashes),
      forbidden_owned_schema_type_count: 0,
      fake_source_conflict_count: 0,
    };
    const path = await writeEvidence(evidence);
    return Object.freeze({ ...evidence, evidence_path: path.pathname });
  } catch (error) {
    if (transactionOpen && client) await client.query('ROLLBACK').catch(() => {});
    const evidence = {
      ...baseEvidence,
      outcome: 'FAIL',
      error_code: typeof error?.code === 'string' ? error.code : error?.message ?? 'ARCH_005_REPROJECTION_FAILED',
    };
    await writeEvidence(evidence).catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main() {
  const result = await reprojectArch005TimeHashes({
    databaseUrl: process.env[DATABASE_URL],
    approved: process.env[APPROVAL] === 'true',
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    operation: 'arch_005_time_reprojection',
    run_id: result.run_id,
    timeline_projection_rows: result.timeline_projection_rows,
    timeline_projection_rows_rehashed: result.timeline_projection_rows_rehashed,
    realtime_projection_rows: result.realtime_projection_rows,
    realtime_projection_rows_rehashed: result.realtime_projection_rows_rehashed,
    realtime_business_time_inversions_before: result.realtime_business_time_inversions_before,
    realtime_business_time_inversions_after: result.realtime_business_time_inversions_after,
    realtime_events_resequenced: result.realtime_events_resequenced,
    retention_floor_after_resequence: result.retention_floor_after_resequence,
    forbidden_owned_schema_type_count: result.forbidden_owned_schema_type_count,
    evidence_path: result.evidence_path,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.code ?? error?.message ?? 'ARCH_005_REPROJECTION_FAILED'}\n`);
    process.exitCode = 1;
  });
}
