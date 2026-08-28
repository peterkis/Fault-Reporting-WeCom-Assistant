import { readFile } from 'node:fs/promises';

const MIGRATION_URL = new URL('../database/migrations/002_p1_004_service_intake.sql', import.meta.url);

const INCIDENT_PATTERN = /(?:报错|打不开|进不去|登录失败|卡死|闪退|蓝屏|无响应|一直转圈|保存失败|提交失败|打印不了|读卡失败|断网|连不上|数据不对|查不到|接口异常|服务不可用|权限错误|login failed|error|unavailable|cannot|can't|unable)/iu;
const INCIDENT_NEGATION_PATTERN = /(?:没有问题|已经好了|不报错了|无需处理|测试正常)/u;
const NEW_REPORT_PATTERN = /(?:新报修|另一个问题|重新报修)/u;
const OTHER_TICKET_PATTERN = /\bIT-[0-9]{8}-[0-9]{4,}\b/iu;
const STATUS_QUERY_PATTERN = /(?:工单.{0,12}(?:状态|进度|处理到哪|什么时候)|处理到哪|处理进度|什么时候处理|处理了吗|修好了吗)/u;
const COMPLAINT_PATTERN = /(?:投诉|一直没人|没人处理|催单|太慢|不满意)/u;
const SERVICE_REQUEST_PATTERN = /(?:开通账号|重置密码|增加权限|安装软件|修改数据|配置打印机|新增用户|离职停用|科室调整)/u;
const QUESTION_PATTERN = /(?:请问|怎么|如何|为什么|能否|可以吗|[?？]$)/u;
const FOLLOW_UP_PATTERN = /(?:这是截图|错误是|三台|都这样|在.{0,20}院区|补充|刚才|已经好了|不报错了|无需处理|测试正常)/u;
const CHATTER_PATTERN = /^(?:在吗|有人吗|你好|您好|hi|hello)[!！?？。.]*$/iu;
const DEFAULT_AGGREGATION_WINDOW_MS = 90_000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanMessageText(message) {
  return message.content
    .filter((item) => item?.kind === 'text' && isRecord(item.text))
    .map((item) => item.text.clean)
    .join('\n')
    .trim();
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
  if (!INCIDENT_NEGATION_PATTERN.test(cleanText) && INCIDENT_PATTERN.test(cleanText)) {
    return 'INCIDENT';
  }
  if (QUESTION_PATTERN.test(cleanText)) {
    return 'QUESTION';
  }
  if (FOLLOW_UP_PATTERN.test(cleanText)) {
    return 'FOLLOW_UP';
  }
  if (CHATTER_PATTERN.test(cleanText)) {
    return 'CHATTER';
  }
  return 'UNKNOWN';
}

function initialStatus(requestType) {
  return ['FOLLOW_UP', 'CHATTER', 'UNKNOWN'].includes(requestType)
    ? 'WAITING_DESCRIPTION'
    : 'RECEIVED';
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicIntake(row) {
  return {
    id: row.id,
    intake_no: row.intake_no,
    source_channel: row.source_channel,
    reporter_wecom_userid: row.reporter_wecom_userid,
    reporter_person_id: null,
    request_type: row.request_type,
    summary: row.summary,
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
        event_type, intake_id, aggregate_version, occurred_at, trace_id, payload
     ) VALUES ($1, $2::uuid, $3, $4::timestamptz, $5, $6::jsonb)
     RETURNING event_id::text, event_type, aggregate_version, occurred_at`,
    [eventType, intake.id, intake.version, occurredAt, traceId, JSON.stringify(payload)],
  );
  return inserted.rows.map((row) => ({
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_version: row.aggregate_version,
    occurred_at: iso(row.occurred_at),
  }));
}

export async function applyServiceIntakeMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createServiceIntakeProcessor({
  aggregationWindowMs = DEFAULT_AGGREGATION_WINDOW_MS,
} = {}) {
  if (!Number.isInteger(aggregationWindowMs) || aggregationWindowMs < 1) {
    throw new TypeError('aggregationWindowMs must be a positive integer.');
  }

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
      `SELECT trace_id
         FROM channel.message_inbox
        WHERE id = $1::bigint`,
      [channelMessageId],
    );
    if (source.rowCount !== 1) {
      throw new Error('CHANNEL_MESSAGE_NOT_FOUND');
    }

    const cleanText = cleanMessageText(message);
    const requestType = classifyRequest(cleanText);
    const status = initialStatus(requestType);
    const summary = cleanText.length === 0 ? null : cleanText.slice(0, 500);
    const sourceChannel = message.chat_type === 'group' ? 'WECOM_GROUP' : 'WECOM_DIRECT';
    const traceId = source.rows[0].trace_id;

    await transaction.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [aggregationKey(message)],
    );

    let existing = { rowCount: 0, rows: [] };
    if (!NEW_REPORT_PATTERN.test(cleanText) && !OTHER_TICKET_PATTERN.test(cleanText)) {
      existing = await transaction.query(
        `SELECT id::text, intake_no, source_channel, reporter_wecom_userid,
                request_type, summary, reported_campus_id, reported_department_id,
                reported_location_text, status, message_count, version,
                created_at, updated_at
           FROM intake.service_intake
          WHERE source_provider = $1
            AND source_bot_id = $2
            AND source_chat_type = $3
            AND source_chat_id IS NOT DISTINCT FROM $4
            AND reporter_wecom_userid = $5
            AND status IN ('RECEIVED', 'WAITING_DESCRIPTION', 'WAITING_TRIAGE', 'TICKET_CREATED')
            AND last_message_at <= $6::timestamptz
            AND last_message_at >= $6::timestamptz - ($7 * INTERVAL '1 millisecond')
          ORDER BY last_message_at DESC, created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [
          message.provider,
          message.bot_id,
          message.chat_type,
          message.chat_id,
          message.sender_user_id,
          message.received_at,
          aggregationWindowMs,
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
      const appended = await transaction.query(
        `UPDATE intake.service_intake
            SET message_count = message_count + 1,
                last_message_at = $2::timestamptz,
                request_type = $3,
                status = $4,
                summary = $5,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::uuid
          RETURNING id::text, intake_no, source_channel, reporter_wecom_userid,
                    request_type, summary, reported_campus_id, reported_department_id,
                    reported_location_text, status, message_count, version,
                    created_at, updated_at`,
        [current.id, message.received_at, nextRequestType, nextStatus, nextSummary],
      );
      const intake = appended.rows[0];
      await transaction.query(
        `INSERT INTO intake.service_intake_message (
            intake_id, channel_message_id, relation_type, sequence_no, linked_at, trace_id
         ) VALUES ($1::uuid, $2::bigint, $3, $4, $5::timestamptz, $6)`,
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
      `INSERT INTO intake.service_intake (
          intake_no,
          source_channel,
          source_provider,
          source_bot_id,
          source_chat_type,
          source_chat_id,
          reporter_wecom_userid,
          request_type,
          summary,
          status,
          primary_message_id,
          last_message_at
       ) VALUES (
          'INT-' || to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD')
            || '-' || lpad(nextval('intake.service_intake_number_seq')::text, 4, '0'),
          $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::bigint, $1::timestamptz
       )
       RETURNING id::text, intake_no, source_channel, reporter_wecom_userid,
                 request_type, summary, reported_campus_id, reported_department_id,
                 reported_location_text, status, message_count, version,
                 created_at, updated_at`,
      [
        message.received_at,
        sourceChannel,
        message.provider,
        message.bot_id,
        message.chat_type,
        message.chat_id,
        message.sender_user_id,
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
       ) VALUES ($1::uuid, $2::bigint, 'PRIMARY', 1, $3::timestamptz, $4)`,
      [intake.id, channelMessageId, message.received_at, traceId],
    );

    const events = await insertEvent({
      transaction,
      eventType: 'intake.received',
      intake,
      occurredAt: message.received_at,
      traceId,
      payload: {
        channel_message_id: channelMessageId,
        source_channel: sourceChannel,
        reporter_wecom_userid: message.sender_user_id,
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
