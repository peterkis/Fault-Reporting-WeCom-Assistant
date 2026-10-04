import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { LocalDateTime } from '../contracts/time_contracts.js';
import type { ConversationSessionStatus } from '../contracts/conversation_contracts.js';
interface DirectSessionRow { id: string; status: ConversationSessionStatus; last_activity_at: LocalDateTime; last_activity_epoch_ms: string; service_intake_id: string; primary_message_id: string; eligible: boolean }
import { createServiceIntakeProcessor } from './p1-004-service-intake.mjs';
import { buildConversationThreadIdentity, decideConversationSessionBoundary } from './p2-001-conversation-contracts.mjs';
import { shanghaiLocalToEpochMs } from './platform/time-contract.mjs';
import { parseExplicitContinuation } from './p2-015-explicit-continuation.mjs';

export const P2016_DIRECT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// An additive, asserted fault is a new issue. Supplemental or negated statements
// are not converted into a new-topic boundary merely because they say “另外”.
function additionalFault(text: string) {
  // An explicit issue heading is a user-declared boundary, not a Ticket
  // classification. The normal rule/human pipeline still evaluates its body.
  if(/^(?:新故障|新的故障|另一个故障|另外一个故障|新的报修)[：:，,]\s*\S/u.test(text))return true;
  const rest = text.replace(/^(?:另外|此外)[，,：:\s]*/u, '');
  if (rest === text || /^(?:补充|说明|提醒|刚才|仍然|还是|这|同一)/u.test(rest)) return false;
  const asserted = rest.match(/^[^，,。；;\n]{1,30}也(?:登录不了|打印不了|打不开|进不去|无法登录|不能打印|提交不了|保存不了|报错了|断网了|连不上)/u)?.[0];
  return Boolean(asserted && !/(?:不是|并非|并不|不代表|如果|假如|要是|是否|会不会|可能|说过|之前|昨天)/u.test(asserted));
}

export function createP2016DirectIntakeProcessor({ idleTimeoutMs = P2016_DIRECT_IDLE_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1) throw new TypeError('P2_016_DIRECT_IDLE_TIMEOUT_INVALID');
  return createServiceIntakeProcessor({ existingIntakeSelector: async ({ transaction, message, cleanText }) => {
    if (!['single','group'].includes(message.chat_type)) return null;
    if (message.chat_type==='single'&&parseExplicitContinuation(cleanText)) return { id: null, explicitBoundary: true, boundaryReason: 'EXPLICIT_USER_NEW_TOPIC' };
    const addressedText=message.chat_type==='group'?cleanText.replace(/^@[^\s@]+(?:\s+|$)/u,''):cleanText;
    if (additionalFault(addressedText)) return { id: null, explicitBoundary: true, boundaryReason: 'EXPLICIT_USER_NEW_TOPIC' };
    const identity = buildConversationThreadIdentity({ provider: message.provider, botId: message.bot_id,
      chatType: message.chat_type, chatId: message.chat_id, senderUserId: message.sender_user_id });
    const receivedEpochMs = message.received_epoch_ms ?? shanghaiLocalToEpochMs(message.received_at);
    const scope=[identity.provider,identity.channel_account_id,identity.participant_key,receivedEpochMs,message.received_at,
      message.chat_id??null,identity.external_thread_key,message.chat_type];
    const legTypes=message.chat_type==='group'?['GROUP_ORIGIN','GROUP_CONTINUATION']:['DIRECT_ORGANIC','DIRECT_GUIDED'];
    const sessions = await transaction.query<DirectSessionRow>(`SELECT s.id::text,s.status,s.last_activity_at,s.last_activity_epoch_ms::text,s.service_intake_id::text,i.primary_message_id::text,
        (t.status='OPEN' AND i.source_provider=$1 AND i.source_bot_id=$2 AND i.source_chat_type=$8
          AND i.source_chat_id IS NOT DISTINCT FROM $6::text AND i.reporter_wecom_userid=$3
          AND i.retention_until_epoch_ms>GREATEST($4::bigint,platform.physical_epoch_ms())
          AND s.started_at<=$5::timestamp without time zone
          AND (l.id IS NULL OR (l.status='OPEN' AND l.leg_type=ANY($9::text[])
            AND l.conversation_session_id=s.id AND l.conversation_thread_id=t.id
            AND j.current_session_id=s.id AND j.status<>'ENDED'
            AND j.reporter_identity_hash=l.reporter_identity_hash
            AND j.retention_until_epoch_ms>GREATEST($4::bigint,platform.physical_epoch_ms())
            AND origin.source_provider=$1 AND origin.source_bot_id=$2 AND origin.reporter_wecom_userid=$3))) AS eligible
      FROM conversation.thread t JOIN conversation.session s ON s.thread_id=t.id
      JOIN intake.service_intake i ON i.id=s.service_intake_id
      LEFT JOIN intake.channel_leg l ON l.source_intake_id=i.id
      LEFT JOIN intake.contact_journey j ON j.id=l.journey_id
      LEFT JOIN intake.service_intake origin ON origin.id=j.origin_intake_id
      WHERE t.provider=$1 AND t.channel_account_id=$2 AND t.chat_type=$8
        AND t.external_thread_key=$7 AND s.participant_key=$3 AND s.status<>'ENDED'
      ORDER BY s.id LIMIT 2 FOR UPDATE OF s`, [...scope,legTypes]);
    if ((sessions.rowCount as number) <= 1) {
      // Inbox boundaries are authoritative before the asynchronous Session projection.
      // Follow the latest committed new Intake in this same serialized inbound stream,
      // never the older projected Session that the next projector cycle will end.
      const pending = await transaction.query<{ id: string; eligible: boolean }>(`SELECT i.id::text,
          (i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','TICKET_CREATED')
            AND i.retention_until_epoch_ms>GREATEST($4::bigint,platform.physical_epoch_ms())
            AND latest.received_epoch_ms<=$4::bigint
            AND latest.received_epoch_ms>$4::bigint-$9::bigint
            AND i.last_message_at<=$5::timestamp without time zone) AS eligible
        FROM intake.service_intake i
        JOIN LATERAL (SELECT max(m.received_epoch_ms) AS received_epoch_ms
          FROM intake.service_intake_message relation JOIN channel.message_inbox m ON m.id=relation.channel_message_id
          WHERE relation.intake_id=i.id) latest ON true
        WHERE i.source_provider=$1 AND i.source_bot_id=$2 AND i.source_chat_type=$8
          AND i.source_chat_id IS NOT DISTINCT FROM $6::text AND i.reporter_wecom_userid=$3
          AND i.primary_message_id>COALESCE((SELECT max(bound.primary_message_id)
            FROM conversation.session seen JOIN conversation.thread thread ON thread.id=seen.thread_id
            JOIN intake.service_intake bound ON bound.id=seen.service_intake_id
            WHERE thread.provider=$1 AND thread.channel_account_id=$2 AND thread.chat_type=$8
              AND thread.external_thread_key=$7 AND seen.participant_key=$3),0)
          AND NOT EXISTS(SELECT 1 FROM conversation.session projected WHERE projected.service_intake_id=i.id)
        ORDER BY i.primary_message_id DESC LIMIT 1 FOR UPDATE OF i`, [...scope,idleTimeoutMs]);
      if (pending.rowCount) return { id: (pending.rows[0] as (typeof pending.rows)[number]).eligible === true ? (pending.rows[0] as (typeof pending.rows)[number]).id : null };
    }
    if (sessions.rowCount === 1 && (sessions.rows[0] as DirectSessionRow).eligible === true) {
      const current = sessions.rows[0] as DirectSessionRow;
      const boundary = decideConversationSessionBoundary({ currentSession: current, receivedAt: message.received_at,
        receivedEpochMs, idleTimeoutMs, nextServiceIntakeId: current.service_intake_id });
      if (boundary.action === 'CONTINUE_SESSION') return { id: current.service_intake_id };
      return { id: null, boundaryReason: boundary.reason };
    }
    if (sessions.rowCount) return { id: null };
    const history = await transaction.query(`SELECT 1 FROM conversation.thread t JOIN conversation.session s ON s.thread_id=t.id
      WHERE t.provider=$1 AND t.channel_account_id=$2 AND t.chat_type=$5 AND t.external_thread_key=$4
        AND s.participant_key=$3 LIMIT 1`, [identity.provider, identity.channel_account_id, identity.participant_key,identity.external_thread_key,message.chat_type]);
    return history.rowCount ? { id: null } : null;
  } });
}
