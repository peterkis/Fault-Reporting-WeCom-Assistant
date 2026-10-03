import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';
import { formatEpochMsToShanghaiLocal } from '../../src/platform/time-contract.mjs';

const RUN = randomUUID().replaceAll('-', '_').slice(0, 12);
const databases = new Set();
const applicationNames = new Set();
const migrations = [
  '001_p1_003_channel_message_inbox.sql','002_p1_004_service_intake.sql',
  '003_p1_005_pilot_ticket_core.sql','004_p1_006_ticket_state_actions.sql',
  '005_p1_007_notification_outbox.sql','006_p1_009_pilot_access.sql',
  '007_p1_010_ticket_closure.sql','008_p1_010_review_hardening.sql',
  '009_p1_011_pilot_operations_baseline.sql','010_p2_001_conversation_contracts.sql',
  '011_p2_002_timeline_projector.sql','012_p2_003_realtime_event_log.sql',
  '020_p2_004_unified_communication.sql','021_p2_005_conversation_control.sql',
];

function app(purpose) { const value = `p2_015_${purpose}_${RUN}`.slice(0, 63); applicationNames.add(value); return value; }

export async function withP2015IsolatedDatabase({ databaseUrl, purpose, max = 4, run }) {
  assert.equal(typeof databaseUrl, 'string'); assert.match(purpose, /^[a-z0-9]{1,12}$/u);
  assert.ok(Number.isInteger(max) && max >= 1 && max <= 4);
  const name = `p2_015_${purpose}_${randomUUID().replaceAll('-', '_')}`;
  databases.add(name);
  const quoted = `"${name}"`;
  const admin = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, application_name: app('admin') });
  let pool; let result; let runError; let cleanupError;
  try {
    await admin.query(`CREATE DATABASE ${quoted} TEMPLATE template0`);
    const isolated = new URL(databaseUrl); isolated.pathname = `/${name}`;
    pool = createPostgresPool({ connectionString: isolated.toString(), max, connectionTimeoutMillis: 5_000, application_name: app(purpose) });
    result = await run({ pool, databaseUrl: isolated.toString(), databaseName: name });
  } catch (error) { runError = error; }
  finally {
    try {
      await pool?.end();
      // Pool shutdown can return before PostgreSQL has observed socket closure.
      // Do not race a normal disconnect with an administrator termination.
      // The bounded grace period does not replace forced cleanup or residual checks.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const remaining = await admin.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
        if (remaining.rows[0].count === 0) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
      await admin.query(`DROP DATABASE IF EXISTS ${quoted}`);
      assert.equal((await admin.query('SELECT count(*)::integer AS count FROM pg_database WHERE datname=$1', [name])).rows[0].count, 0);
    } catch (error) { cleanupError = error; }
    finally { await admin.end().catch((error) => { cleanupError ??= error; }); }
  }
  if (runError && cleanupError) throw new AggregateError([runError, cleanupError]);
  if (runError) throw runError; if (cleanupError) throw cleanupError; return result;
}

export async function applyThrough022(pool) {
  for (const filename of migrations) await pool.query(await readFile(new URL(`../../database/migrations/${filename}`, import.meta.url), 'utf8'));
  const sql = await readFile(new URL('../../database/migrations/022_arch_005_asia_shanghai_time_contract.sql', import.meta.url), 'utf8');
  await pool.query('BEGIN');
  try {
    await pool.query(sql);
    const checksum = createHash('sha256').update(sql).digest('hex');
    await pool.query(`WITH applied AS (SELECT platform.physical_epoch_ms() AS epoch_ms)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT '022_arch_005_asia_shanghai_time_contract',$1,platform.local_from_epoch_ms(epoch_ms),epoch_ms FROM applied`, [checksum]);
    await pool.query('COMMIT');
  } catch (error) { await pool.query('ROLLBACK').catch(() => {}); throw error; }
}

export async function seedPersistedIntake({ pool, text, chatType = 'group', requestType = 'UNKNOWN', status = 'WAITING_TRIAGE', tag = randomUUID().slice(0, 8) }) {
  // Live integration fixtures must remain eligible under the real retention guard.
  const epoch = BigInt((await pool.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0].epoch);
  const receivedAt = formatEpochMsToShanghaiLocal(String(epoch));
  const retentionUntil = formatEpochMsToShanghaiLocal(String(epoch + 2592000000n));
  const message = await pool.query(
    `INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,
      chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,
      processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
     VALUES (1,'WECOM_AIBOT',$1,'WECOM_AIBOT:'||$1,'req-'||$1,'bot-test',$2,$3,'user-test','text',
      $4::timestamp without time zone,$5,$5,$6::jsonb,'COMPLETED','{}'::jsonb,'INTERNAL','trace-'||$1,
      $7::timestamp without time zone,$4::timestamp without time zone) RETURNING id::text`,
    [`msg-${tag}`, chatType, chatType === 'group' ? `group-${tag}` : null, receivedAt, text,
      JSON.stringify({ msgtype: 'text', bot_mentioned: chatType === 'group', text: { content: text } }), retentionUntil],
  );
  const intake = await pool.query(
    `INSERT INTO intake.service_intake(intake_no,source_channel,source_provider,source_bot_id,source_chat_type,
      source_chat_id,reporter_wecom_userid,privacy_class,retention_until,request_type,summary,status,
      primary_message_id,message_count,last_message_at,version)
     VALUES ('INT-20260903-'||lpad(nextval('intake.service_intake_number_seq')::text,4,'0'),$1,
      'WECOM_AIBOT','bot-test',$2,$3,'user-test','INTERNAL',$4::timestamp without time zone,$5,$6,$7,
      $8::bigint,1,$9::timestamp without time zone,1)
     RETURNING id::text,intake_no`,
    [chatType === 'group' ? 'WECOM_GROUP' : 'WECOM_DIRECT', chatType,
      chatType === 'group' ? `group-${tag}` : null, retentionUntil, requestType,
      text.slice(0, 500), status, message.rows[0].id, receivedAt],
  );
  await pool.query(`INSERT INTO intake.service_intake_message(intake_id,channel_message_id,relation_type,sequence_no,linked_at,trace_id)
    VALUES ($1::uuid,$2::bigint,'PRIMARY',1,$3::timestamp without time zone,$4)`, [intake.rows[0].id, message.rows[0].id, receivedAt, `trace-msg-${tag}`]);
  await pool.query(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
    VALUES ('intake.received','intake',$1::uuid,1,1,$2::timestamp without time zone,$3,'{}'::jsonb)`, [intake.rows[0].id, receivedAt, `trace-intake-${tag}`]);
  return Object.freeze({ intakeId: intake.rows[0].id, messageId: message.rows[0].id, receivedAt, retentionUntil });
}

export async function seedCapacityDataset({ pool, tag = randomUUID().slice(0, 8) }) {
  const epoch = (await pool.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0].epoch;
  await pool.query(
    `INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,
      chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,
      processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
     SELECT 1,'WECOM_AIBOT',format('cap-%s-%s-%s',$1::text,i,t),
      'WECOM_AIBOT:'||format('cap-%s-%s-%s',$1::text,i,t),'req-'||format('cap-%s-%s-%s',$1::text,i,t),'bot-test',
      CASE WHEN i BETWEEN 301 AND 400 THEN 'single' ELSE 'group' END,
      CASE WHEN i BETWEEN 301 AND 400 THEN NULL ELSE format('group-cap-%s',i) END,
      format('user-cap-%s',i),'text',
      platform.local_from_epoch_ms($2::bigint) - interval '2004 seconds' + ((i*4+t)||' seconds')::interval,
      CASE WHEN i<=100 THEN '需人工判断' WHEN i<=400 THEN '处方提交不了' ELSE '系统不行' END,
      CASE WHEN i<=100 THEN '需人工判断' WHEN i<=400 THEN '处方提交不了' ELSE '系统不行' END,
      jsonb_build_object('msgtype','text','bot_mentioned',NOT (i BETWEEN 301 AND 400)),
      'COMPLETED','{}'::jsonb,'INTERNAL','trace-cap-'||i||'-'||t,
      platform.local_from_epoch_ms($2::bigint + 2592000000),
      platform.local_from_epoch_ms($2::bigint) - interval '2004 seconds' + ((i*4+t)||' seconds')::interval
     FROM generate_series(1,500) i CROSS JOIN generate_series(1,4) t`, [tag, epoch],
  );
  await pool.query(
    `INSERT INTO intake.service_intake(intake_no,source_channel,source_provider,source_bot_id,
      source_chat_type,source_chat_id,reporter_wecom_userid,privacy_class,retention_until,
      request_type,summary,status,primary_message_id,message_count,last_message_at,version)
     SELECT 'INT-20260903-'||lpad(nextval('intake.service_intake_number_seq')::text,4,'0'),
      CASE WHEN i BETWEEN 301 AND 400 THEN 'WECOM_DIRECT' ELSE 'WECOM_GROUP' END,
      'WECOM_AIBOT','bot-test',CASE WHEN i BETWEEN 301 AND 400 THEN 'single' ELSE 'group' END,
      CASE WHEN i BETWEEN 301 AND 400 THEN NULL ELSE format('group-cap-%s',i) END,
      format('user-cap-%s',i),'INTERNAL',platform.local_from_epoch_ms($2::bigint + 2592000000),
      'UNKNOWN',format('CAP:%s:%s',$1::text,i),'WAITING_TRIAGE',message.id,4,
      platform.local_from_epoch_ms($2::bigint) - interval '2004 seconds' + ((i*4+4)||' seconds')::interval,1
     FROM generate_series(1,500) i JOIN channel.message_inbox message
       ON message.msg_id=format('cap-%s-%s-1',$1::text,i)`, [tag, epoch],
  );
  await pool.query(
    `INSERT INTO intake.service_intake_message(intake_id,channel_message_id,relation_type,sequence_no,linked_at,trace_id)
     SELECT intake.id,message.id,CASE WHEN t=1 THEN 'PRIMARY' ELSE 'SUPPLEMENT' END,t,
       message.received_at,format('trace-rel-%s-%s',i,t)
      FROM generate_series(1,500) i CROSS JOIN generate_series(1,4) t
      JOIN intake.service_intake intake ON intake.summary=format('CAP:%s:%s',$1::text,i)
      JOIN channel.message_inbox message ON message.msg_id=format('cap-%s-%s-%s',$1::text,i,t)`, [tag],
  );
  await pool.query(
    `INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
     SELECT 'intake.received','intake',id,1,1,created_at,'trace-cap-event-'||id,'{}'::jsonb
       FROM intake.service_intake WHERE summary LIKE 'CAP:'||$1::text||':%'`, [tag],
  );
  return Object.freeze({ journeys: 500, turns: 2000, expectedReviews: 100 });
}

export async function assertNoP2015Residual({ databaseUrl }) {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, application_name: app('residual') });
  try {
    const result = await pool.query(`SELECT
      (SELECT count(*)::integer FROM pg_database WHERE datname=ANY($1::text[])) AS database_count,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE application_name=ANY($2::text[]) AND pid<>pg_backend_pid()) AS backend_count`,
    [[...databases], [...applicationNames].filter((name) => !name.includes('_residual_'))]);
    assert.deepEqual(result.rows[0], { database_count: 0, backend_count: 0 });
    return result.rows[0];
  } finally { await pool.end(); }
}
