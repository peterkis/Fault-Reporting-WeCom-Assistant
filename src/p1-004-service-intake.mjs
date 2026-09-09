import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import { assertLocalDateTime } from './platform/time-contract.mjs';
import { postgresTimestampToLocalDateTime } from './platform/postgres-types.mjs';

const MIGRATION_URL = new URL('../database/migrations/002_p1_004_service_intake.sql', import.meta.url);

const INCIDENT_PATTERN = /(?:报错|打不开|进不去|无法登录|登录失败|卡死|闪退|蓝屏|无响应|一直转圈|保存失败|提交失败|打印不了|读卡失败|断网|连不上|数据不对|查不到|接口异常|服务不可用|权限错误|login failed|error|unavailable|cannot|can't|unable)/iu;
const INCIDENT_NEGATION_PATTERN = /(?:没有问题|没有报错|已经好了|不报错了|无需处理|测试正常)/u;
const INCIDENT_CLAUSE_SEPARATOR = /(?:[，,。；;！!？?\n]+|(?<!不)但(?:是)?|不过|然而)/u;
const NEW_REPORT_PATTERN = /(?:新报修|另一个问题|重新报修)/u;
const OTHER_TICKET_PATTERN = /\bIT-[0-9]{8}-[0-9]{4,}\b/iu;
const STATUS_QUERY_PATTERN = /(?:工单.{0,12}(?:状态|进度|处理到哪|什么时候)|处理到哪|处理进度|什么时候处理|处理了吗|修好了吗)/u;
const COMPLAINT_PATTERN = /(?:投诉|一直没人|没人处理|催单|太慢|不满意)/u;
const SERVICE_REQUEST_PATTERN = /(?:开通账号|重置密码|增加权限|安装软件|修改数据|配置打印机|新增用户|离职停用|科室调整)/u;
const QUESTION_PATTERN = /(?:请问|怎么|如何|为什么|能否|可以吗|[?？]$)/u;
const FOLLOW_UP_PATTERN = /(?:这是截图|错误是|三台|都这样|在.{0,20}院区|补充|刚才|没有问题|没有报错|已经好了|不报错了|无需处理|测试正常)/u;
const THANKS_PATTERN = /^(?:谢谢|感谢|多谢|辛苦了|thanks|thank you)[!！?？。.]*$/iu;
const CHATTER_PATTERN = /^(?:在吗|有人吗|你好|您好|hi|hello)[!！?？。.]*$/iu;
const DEFAULT_AGGREGATION_WINDOW_MS = 90_000;
const LEGACY_INBOX_SUMMARY_ERROR = 'P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED';
const PRIVACY_RANK = new Map([
  ['PUBLIC', 0],
  ['INTERNAL', 1],
  ['SENSITIVE_INTERNAL', 2],
  ['PERSONAL', 3],
  ['PATIENT_SENSITIVE', 4],
  ['SECRET', 5],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mapServiceIntakeMigrationFailure(error) {
  const legacySnapshotRemediationRequired = error?.code === '23514'
    && error?.message === LEGACY_INBOX_SUMMARY_ERROR;
  return {
    code: legacySnapshotRemediationRequired
      ? LEGACY_INBOX_SUMMARY_ERROR
      : 'P1_004_MIGRATION_FAILED',
    retryable: !legacySnapshotRemediationRequired,
  };
}

function cleanMessageText(message) {
  return message.content
    .filter((item) => item?.kind === 'text' && isRecord(item.text))
    .map((item) => item.text.clean)
    .join('\n')
    .trim();
}

function hasAffirmedIncident(cleanText) {
  return cleanText
    .split(INCIDENT_CLAUSE_SEPARATOR)
    .map((clause) => clause.trim())
    .some((clause) => clause.length > 0
      && INCIDENT_PATTERN.test(clause)
      && !INCIDENT_NEGATION_PATTERN.test(clause));
}

function classifyRequest(cleanText) {
  if (cleanText.length === 0) {
    return 'UNKNOWN';
  }
  if (STATUS_QUERY_PATTERN.test(cleanText)) {
    return 'STATUS_QUERY';
  }
  if (COMPLAINT_PATTERN.test(cleanText)) {
    return 'COMPLAINT';
  }
  if (SERVICE_REQUEST_PATTERN.test(cleanText)) {
    return 'SERVICE_REQUEST';
  }
  if (hasAffirmedIncident(cleanText)) {
    return 'INCIDENT';
  }
  if (QUESTION_PATTERN.test(cleanText)) {
    return 'QUESTION';
  }
  if (FOLLOW_UP_PATTERN.test(cleanText)) {
    return 'FOLLOW_UP';
  }
  if (THANKS_PATTERN.test(cleanText) || CHATTER_PATTERN.test(cleanText)) {
    return 'CHATTER';
  }
  return 'UNKNOWN';
}

function initialStatus(requestType, cleanText) {
  if (requestType === 'CHATTER' && THANKS_PATTERN.test(cleanText)) {
    return 'IGNORED';
  }
  return ['FOLLOW_UP', 'CHATTER', 'UNKNOWN'].includes(requestType)
    ? 'WAITING_DESCRIPTION'
    : 'RECEIVED';
}

function iso(value) {
  return postgresTimestampToLocalDateTime(value);
}

function publicIntake(row) {
  return {
    id: row.id,
    intake_no: row.intake_no,
    source_channel: row.source_channel,
    reporter_wecom_userid: row.reporter_wecom_userid,
    reporter_person_id: null,
    request_type: row.request_type,
    summary: null,
    reported_campus_id: row.reported_campus_id,
    reported_department_id: row.reported_department_id,
    reported_location_text: row.reported_location_text,
    status: row.status,
    ticket_id: null,
    incident_id: null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    version: row.version,
  };
}

function strongestPrivacy(left, right) {
  return PRIVACY_RANK.get(left) >= PRIVACY_RANK.get(right) ? left : right;
}

function earliestTimestamp(left, right) {
  const first = assertLocalDateTime(left);
  const second = assertLocalDateTime(right);
  return first < second ? first : second;
}

function aggregationKey(message) {
  return JSON.stringify([
    message.provider,
    message.bot_id,
    message.chat_type,
    message.chat_id,
    message.sender_user_id,
  ]);
}

async function insertEvent({
  transaction,
  eventType,
  intake,
  occurredAt,
  traceId,
  payload,
}) {
  const inserted = await transaction.query(
    `INSERT INTO intake.service_intake_event (
        event_type, intake_id, aggregate_version, event_ordinal,
        occurred_at, trace_id, payload
     )
     SELECT $1,
            $2::uuid,
            $3,
            COALESCE(MAX(event_ordinal), 0) + 1,
            $4::timestamp without time zone,
            $5,
            $6::jsonb
       FROM intake.service_intake_event
      WHERE intake_id = $2::uuid
     RETURNING event_id::text, event_type, aggregate_type,
               intake_id::text AS aggregate_id, aggregate_version,
               event_ordinal, occurred_at, trace_id, payload`,
    [eventType, intake.id, intake.version, occurredAt, traceId, JSON.stringify(payload)],
  );
  return inserted.rows.map((row) => ({
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    event_ordinal: row.event_ordinal,
    occurred_at: iso(row.occurred_at),
    trace_id: row.trace_id,
    payload: row.payload,
  }));
}

export async function applyServiceIntakeMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createServiceIntakeProcessor({
  aggregationWindowMs = DEFAULT_AGGREGATION_WINDOW_MS,
  existingIntakeSelector = null,
} = {}) {
  if (!Number.isInteger(aggregationWindowMs) || aggregationWindowMs < 1) {
    throw new TypeError('aggregationWindowMs must be a positive integer.');
  }
  if (existingIntakeSelector !== null && typeof existingIntakeSelector !== 'function') throw new TypeError('An Intake selector must be a function.');

  return async function processServiceIntake({ channelMessageId, message, transaction }) {
    if (
      typeof channelMessageId !== 'string'
      || !isRecord(message)
      || !transaction
      || typeof transaction.query !== 'function'
    ) {
      throw new TypeError('A Channel Message and Inbox transaction are required.');
    }

    const source = await transaction.query(
      `SELECT trace_id, privacy_class, retention_until
         FROM channel.message_inbox
        WHERE id = $1::bigint`,
      [channelMessageId],
    );
    if (source.rowCount !== 1) {
      throw new Error('CHANNEL_MESSAGE_NOT_FOUND');
    }

    const cleanText = cleanMessageText(message);
    const requestType = classifyRequest(cleanText);
    const status = initialStatus(requestType, cleanText);
    let explicitAggregationBoundary = NEW_REPORT_PATTERN.test(cleanText)
      || OTHER_TICKET_PATTERN.test(cleanText);
    const summary = cleanText.length === 0 ? null : cleanText.slice(0, 500);
    const sourceChannel = message.chat_type === 'group' ? 'WECOM_GROUP' : 'WECOM_DIRECT';
    const traceId = source.rows[0].trace_id;

    await transaction.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [aggregationKey(message)],
    );

    let existing = { rowCount: 0, rows: [] };
    // Optional P2 association runs inside this same durable Inbox transaction.
    // null means use the P1 fragment window; {id:null} explicitly forbids reuse.
    const selection = !explicitAggregationBoundary && existingIntakeSelector
      ? await existingIntakeSelector({ transaction, message, cleanText }) : null;
    if (selection?.explicitBoundary === true) explicitAggregationBoundary = true;
    if (!explicitAggregationBoundary && selection?.id !== null) {
      existing = await transaction.query(
        `SELECT candidate.id::text, candidate.intake_no, candidate.source_channel,
                candidate.reporter_wecom_userid, candidate.request_type, candidate.summary,
                candidate.reported_campus_id, candidate.reported_department_id,
                candidate.reported_location_text, candidate.status,
                candidate.privacy_class, candidate.retention_until,
                candidate.message_count, candidate.version,
                candidate.created_at, candidate.updated_at
           FROM intake.service_intake AS candidate
           JOIN channel.message_inbox AS primary_message
             ON primary_message.id = candidate.primary_message_id
          WHERE candidate.source_provider = $1
            AND candidate.source_bot_id = $2
            AND candidate.source_chat_type = $3
            AND candidate.source_chat_id IS NOT DISTINCT FROM $4
            AND candidate.reporter_wecom_userid = $5
            AND candidate.status IN ('RECEIVED', 'WAITING_DESCRIPTION', 'WAITING_TRIAGE', 'TICKET_CREATED')
            AND (candidate.id = $8::uuid OR ($8::uuid IS NULL
              AND candidate.last_message_at >= $6::timestamp without time zone - ($7 * INTERVAL '1 millisecond')
              AND candidate.last_message_at <= $6::timestamp without time zone + ($7 * INTERVAL '1 millisecond')))
            AND (
                NOT candidate.explicit_aggregation_boundary
                OR primary_message.received_at <= $6::timestamp without time zone
            )
          ORDER BY primary_message.received_at DESC,
                   candidate.last_message_at DESC,
                   candidate.created_at DESC
          LIMIT 1
          FOR UPDATE OF candidate`,
        [
          message.provider,
          message.bot_id,
          message.chat_type,
          message.chat_id,
          message.sender_user_id,
          message.received_at,
          aggregationWindowMs,
          selection?.id ?? null,
        ],
      );
    }

    if (existing.rowCount === 1) {
      const current = existing.rows[0];
      const relationType = current.status === 'WAITING_DESCRIPTION'
        ? 'CLARIFICATION'
        : 'SUPPLEMENT';
      const hasUsableClassification = !['UNKNOWN', 'CHATTER', 'FOLLOW_UP'].includes(requestType);
      const clarified = relationType === 'CLARIFICATION' && hasUsableClassification;
      const nextRequestType = clarified ? requestType : current.request_type;
      const nextStatus = clarified ? 'RECEIVED' : current.status;
      const nextSummary = clarified && summary !== null ? summary : current.summary;
      const nextPrivacyClass = strongestPrivacy(current.privacy_class, source.rows[0].privacy_class);
      const nextRetentionUntil = earliestTimestamp(
        current.retention_until,
        source.rows[0].retention_until,
      );
      const appended = await transaction.query(
        `UPDATE intake.service_intake
            SET message_count = message_count + 1,
                last_message_at = GREATEST(last_message_at, $2::timestamp without time zone),
                request_type = $3,
                status = $4,
                summary = $5,
                privacy_class = $6,
                retention_until = $7::timestamp without time zone,
                version = version + 1,
                updated_at = GREATEST(
                  created_at,
                  date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
                )
          WHERE id = $1::uuid
          RETURNING id::text, intake_no, source_channel, reporter_wecom_userid,
                    request_type, summary, reported_campus_id, reported_department_id,
                    reported_location_text, status, privacy_class, retention_until,
                    message_count, version,
                    created_at, updated_at`,
        [
          current.id,
          message.received_at,
          nextRequestType,
          nextStatus,
          nextSummary,
          nextPrivacyClass,
          nextRetentionUntil,
        ],
      );
      const intake = appended.rows[0];
      await transaction.query(
        `INSERT INTO intake.service_intake_message (
            intake_id, channel_message_id, relation_type, sequence_no, linked_at, trace_id
         ) VALUES ($1::uuid, $2::bigint, $3, $4, $5::timestamp without time zone, $6)`,
        [intake.id, channelMessageId, relationType, intake.message_count, message.received_at, traceId],
      );
      const events = await insertEvent({
        transaction,
        eventType: relationType === 'CLARIFICATION'
          ? 'intake.clarification_added'
          : 'intake.message_added',
        intake,
        occurredAt: message.received_at,
        traceId,
        payload: {
          intake_id: intake.id,
          channel_message_id: channelMessageId,
          relation_type: relationType,
          message_count: intake.message_count,
          request_type: intake.request_type,
          status: intake.status,
        },
      });

      return {
        intake: publicIntake(intake),
        message: {
          channel_message_id: channelMessageId,
          relation_type: relationType,
          sequence_no: intake.message_count,
        },
        aggregation: {
          action: 'APPENDED',
          window_seconds: aggregationWindowMs / 1_000,
          message_count: intake.message_count,
        },
        events,
      };
    }

    const created = await transaction.query(
      `WITH generated_number AS (
          SELECT nextval('intake.service_intake_number_seq')::text AS sequence_value
       )
       INSERT INTO intake.service_intake (
          intake_no,
          source_channel,
          source_provider,
          source_bot_id,
          source_chat_type,
          source_chat_id,
          reporter_wecom_userid,
          explicit_aggregation_boundary,
          privacy_class,
          retention_until,
          request_type,
          summary,
          status,
          primary_message_id,
          last_message_at
       )
       SELECT
          'INT-' || to_char($1::timestamp without time zone AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD')
            || '-' || lpad(
              generated_number.sequence_value,
              GREATEST(4, char_length(generated_number.sequence_value)),
              '0'
            ),
          $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamp without time zone,
          $11, $12, $13, $14::bigint, $1::timestamp without time zone
         FROM generated_number
       RETURNING id::text, intake_no, source_channel, reporter_wecom_userid,
                 request_type, summary, reported_campus_id, reported_department_id,
                 reported_location_text, status, privacy_class, retention_until,
                 message_count, version,
                 created_at, updated_at`,
      [
        message.received_at,
        sourceChannel,
        message.provider,
        message.bot_id,
        message.chat_type,
        message.chat_id,
        message.sender_user_id,
        explicitAggregationBoundary,
        source.rows[0].privacy_class,
        source.rows[0].retention_until,
        requestType,
        summary,
        status,
        channelMessageId,
      ],
    );
    const intake = created.rows[0];

    await transaction.query(
      `INSERT INTO intake.service_intake_message (
          intake_id, channel_message_id, relation_type, sequence_no, linked_at, trace_id
       ) VALUES ($1::uuid, $2::bigint, 'PRIMARY', 1, $3::timestamp without time zone, $4)`,
      [intake.id, channelMessageId, message.received_at, traceId],
    );

    const events = await insertEvent({
      transaction,
      eventType: 'intake.received',
      intake,
      occurredAt: message.received_at,
      traceId,
        payload: {
          intake_id: intake.id,
          channel_message_id: channelMessageId,
          source_channel: sourceChannel,
          reporter_wecom_userid: message.sender_user_id,
          explicit_aggregation_boundary: explicitAggregationBoundary,
          ...(selection?.boundaryReason ? { session_boundary_reason: selection.boundaryReason } : {}),
          request_type: requestType,
        status,
      },
    });
    if (status === 'WAITING_DESCRIPTION') {
      events.push(...await insertEvent({
        transaction,
        eventType: 'intake.needs_clarification',
        intake,
        occurredAt: message.received_at,
        traceId,
        payload: {
          intake_id: intake.id,
          channel_message_id: channelMessageId,
          reason: 'DESCRIPTION_REQUIRED',
          message_type: message.msg_type,
        },
      }));
    }

    return {
      intake: publicIntake(intake),
      message: {
        channel_message_id: channelMessageId,
        relation_type: 'PRIMARY',
        sequence_no: 1,
      },
      aggregation: {
        action: 'CREATED',
        window_seconds: aggregationWindowMs / 1_000,
        message_count: 1,
      },
      events,
    };
  };
}
