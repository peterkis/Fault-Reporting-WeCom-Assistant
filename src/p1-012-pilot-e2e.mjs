import { createHash } from 'node:crypto';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';
import { adaptWeComSdkFrame } from './p1-002-wecom-sdk-adapter.mjs';

const GROUP_TEXT = 'GROUP_TEXT';
const GROUP_IMAGE_DEGRADED = 'GROUP_IMAGE_DEGRADED';
const SCENARIOS = new Set([GROUP_TEXT, GROUP_IMAGE_DEGRADED]);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;
const INTAKE_STATUSES = new Set([
  'RECEIVED',
  'WAITING_DESCRIPTION',
  'TICKET_CREATED',
  'CLOSED',
]);
const DELIVERY_STATUSES = new Set(['SENT', 'PENDING', 'RETRY_SCHEDULED', 'DEAD_LETTER']);

const GO_NO_GO_GATES = Object.freeze([
  ['wss_authenticated', 'WSS_AUTHENTICATION_PENDING'],
  ['test_group_configured', 'TEST_GROUP_CONFIGURATION_PENDING'],
  ['pilot_runtime_ready', 'PILOT_RUNTIME_READY_PENDING'],
  ['text_round_trip', 'TEXT_ROUND_TRIP_PENDING'],
  ['image_degraded', 'IMAGE_DEGRADED_PENDING'],
  ['burst_100', 'BURST_100_PENDING'],
  ['reconnect', 'RECONNECT_PENDING'],
  ['database_failure', 'DATABASE_FAILURE_DRILL_PENDING'],
  ['outbox_failure', 'OUTBOX_FAILURE_DRILL_PENDING'],
  ['ai_disabled', 'AI_DISABLED_SCENARIO_PENDING'],
  ['no_lost_tickets', 'LOST_TICKET_CHECK_PENDING'],
  ['no_duplicate_tickets', 'DUPLICATE_TICKET_CHECK_PENDING'],
  ['all_within_target', 'TEN_SECOND_TARGET_PENDING'],
  ['statuses_and_events_consistent', 'STATUS_EVENT_CONSISTENCY_PENDING'],
  ['notifications_traceable', 'NOTIFICATION_TRACEABILITY_PENDING'],
  ['client_observation', 'CLIENT_OBSERVATION_PENDING'],
  ['pilot_owner_approved', 'PILOT_OWNER_APPROVAL_PENDING'],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, message, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function requiredTestAccountUserIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) {
    throw new TypeError('testAccountUserIds must be a non-empty array.');
  }
  const normalized = value.map((userId) => requiredText(userId, 'testAccountUserIds contains an invalid user id.', 128));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('testAccountUserIds must not contain duplicates.');
  }
  return new Set(normalized);
}

function validPositiveInteger(value, message, maximum = 60_000) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function contentIncludesTrigger(frame, triggerToken) {
  const body = frame?.body;
  if (!isRecord(body)) return false;
  if (body.msgtype === 'text') {
    return typeof body.text?.content === 'string' && body.text.content.includes(triggerToken);
  }
  if (body.msgtype === 'mixed') {
    return Array.isArray(body.mixed?.msg_item) && body.mixed.msg_item.some((item) => (
      item?.msgtype === 'text'
      && typeof item.text?.content === 'string'
      && item.text.content.includes(triggerToken)
    ));
  }
  return false;
}

function mixedContainsImage(frame) {
  return Array.isArray(frame?.body?.mixed?.msg_item)
    && frame.body.mixed.msg_item.some((item) => item?.msgtype === 'image');
}

function scopeResult(frame, { testGroupId, testAccountUserIds, triggerToken, scenario }) {
  const body = frame?.body;
  if (!isRecord(body) || frame?.cmd !== 'aibot_msg_callback') {
    return { outcome: 'ignored', reason: 'UNSUPPORTED_CALLBACK' };
  }
  if (body.chattype !== 'group') {
    return { outcome: 'ignored', reason: 'CHAT_TYPE_MISMATCH' };
  }
  if (body.chatid !== testGroupId) {
    return { outcome: 'ignored', reason: 'TEST_GROUP_MISMATCH' };
  }
  if (typeof body.from?.userid !== 'string' || !testAccountUserIds.has(body.from.userid)) {
    return { outcome: 'ignored', reason: 'TEST_ACCOUNT_MISMATCH' };
  }
  if (scenario === GROUP_IMAGE_DEGRADED) {
    if (body.msgtype === 'image') return null;
    if (body.msgtype !== 'mixed' || !mixedContainsImage(frame)) {
      return { outcome: 'ignored', reason: 'SCENARIO_MESSAGE_TYPE_MISMATCH' };
    }
    return contentIncludesTrigger(frame, triggerToken)
      ? null
      : { outcome: 'ignored', reason: 'TRIGGER_TOKEN_MISMATCH' };
  }
  if (!['text', 'mixed'].includes(body.msgtype)) {
    return { outcome: 'ignored', reason: 'SCENARIO_MESSAGE_TYPE_MISMATCH' };
  }
  return contentIncludesTrigger(frame, triggerToken)
    ? null
    : { outcome: 'ignored', reason: 'TRIGGER_TOKEN_MISMATCH' };
}

function safeErrorCode(value, fallback) {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : fallback;
}

function safeIntakeStatus(value) {
  return INTAKE_STATUSES.has(value) ? value : 'UNKNOWN';
}

function safeDeliveryStatus(value) {
  return DELIVERY_STATUSES.has(value) ? value : 'PENDING';
}

function traceIdFor(message) {
  return `p1-012:${createHash('sha256').update(message.idempotency_key).digest('hex').slice(0, 24)}`;
}

function replyBodyFor(accepted) {
  const ticketNo = accepted?.result?.ticket?.ticket_no;
  if (typeof ticketNo === 'string' && ticketNo.length > 0 && ticketNo.length <= 128) {
    return {
      msgtype: 'text',
      text: { content: `P1-012 验收受理完成，工单号：${ticketNo}。` },
    };
  }
  if (accepted?.ok === true) {
    return {
      msgtype: 'text',
      text: { content: 'P1-012 验收已受理，请补充文字描述后继续处理。' },
    };
  }
  return {
    msgtype: 'text',
    text: { content: 'P1-012 验收暂无法完成受理，请稍后重试。' },
  };
}

function replyAcknowledged(receipt) {
  return isRecord(receipt) && receipt.errcode === 0;
}

function providerErrorCode(receiptOrError) {
  return Number.isInteger(receiptOrError?.errcode) ? receiptOrError.errcode : null;
}

function replyOutcome(acknowledged, providerErrcode) {
  if (acknowledged) return 'ACKED';
  return providerErrcode === null ? 'UNKNOWN' : 'REJECTED';
}

function safeReplyReceiptCode(receipt) {
  if (receipt?.errcode !== 0 && Number.isInteger(receipt?.errcode)) {
    return 'WECOM_REPLY_REJECTED';
  }
  return 'WECOM_REPLY_ACK_MISSING';
}

function safeReplyFailureCode(error) {
  if (Number.isInteger(error?.errcode)) return 'WECOM_REPLY_REJECTED';
  return safeErrorCode(error?.code, 'WECOM_REPLY_FAILED');
}

function publicCoreResult(accepted, withinTarget) {
  if (accepted?.ok === true) {
    return {
      accepted: true,
      ticket_created: accepted.result?.ticket !== null && accepted.result?.ticket !== undefined,
      intake_status: safeIntakeStatus(accepted.result?.intake?.status),
      within_target: withinTarget,
    };
  }
  return {
    accepted: false,
    error_code: safeErrorCode(accepted?.error?.code, 'P1_012_CORE_OPERATION_FAILED'),
    retryable: accepted?.error?.retryable === true,
    within_target: withinTarget,
  };
}

/**
 * Handles one explicitly scoped real WeCom group callback. The interface keeps
 * raw frame processing, Pilot admission, passive reply, and first Delivery at
 * one seam, while returning only safe evidence fields.
 */
export function createPilotE2EHandler({
  testGroupId,
  testAccountUserIds,
  triggerToken,
  scenario = GROUP_TEXT,
  accept,
  reply,
  deliver = null,
  now = () => new Date(),
  acceptanceTargetMs = 10_000,
  passiveReplyTargetMs = 5_000,
  retentionMs = 86_400_000,
} = {}) {
  requiredText(testGroupId, 'testGroupId is required.');
  const normalizedTestAccountUserIds = requiredTestAccountUserIds(testAccountUserIds);
  requiredText(triggerToken, 'triggerToken is required.');
  if (!SCENARIOS.has(scenario)) {
    throw new TypeError('scenario is invalid.');
  }
  if (typeof accept !== 'function' || typeof reply !== 'function') {
    throw new TypeError('accept and reply functions are required.');
  }
  if (deliver !== null && typeof deliver !== 'function') {
    throw new TypeError('deliver must be a function when supplied.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }
  validPositiveInteger(acceptanceTargetMs, 'acceptanceTargetMs is invalid.');
  validPositiveInteger(passiveReplyTargetMs, 'passiveReplyTargetMs is invalid.');
  validPositiveInteger(retentionMs, 'retentionMs is invalid.', 31_536_000_000);

  async function handleFrame(frame) {
    const ignored = scopeResult(frame, {
      testGroupId,
      testAccountUserIds: normalizedTestAccountUserIds,
      triggerToken,
      scenario,
    });
    if (ignored !== null) {
      return Object.freeze(ignored);
    }

    const receivedAt = now();
    if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) {
      throw new TypeError('now must return a valid Date.');
    }
    const receivedEpochMs = String(receivedAt.getTime());
    const adapted = adaptWeComSdkFrame(frame, { receivedEpochMs });
    if (!adapted.ok) {
      return Object.freeze({
        outcome: 'rejected',
        error_code: safeErrorCode(adapted.error?.code, 'WECOM_INVALID_FRAME'),
      });
    }

    const startedAt = Date.now();
    let accepted;
    try {
      accepted = await accept({
        message: adapted.message,
        traceId: traceIdFor(adapted.message),
        privacyClass: 'PATIENT_SENSITIVE',
        retentionUntil: formatEpochMsToShanghaiLocal(String(receivedAt.getTime() + retentionMs)),
        retentionUntilEpochMs: String(receivedAt.getTime() + retentionMs),
      });
    } catch {
      accepted = {
        ok: false,
        error: { code: 'P1_012_CORE_OPERATION_FAILED', retryable: true },
      };
    }
    const afterAdmissionMs = Date.now();
    const core = publicCoreResult(accepted, afterAdmissionMs - startedAt <= acceptanceTargetMs);

    let passiveReply;
    try {
      const receipt = await reply(frame, replyBodyFor(accepted));
      const acknowledged = replyAcknowledged(receipt);
      const providerErrcode = providerErrorCode(receipt);
      passiveReply = {
        operation: 'aibot_respond_msg_stream',
        attempted: true,
        acknowledged,
        provider_errcode: providerErrcode,
        outcome: replyOutcome(acknowledged, providerErrcode),
        ...(acknowledged ? {} : { error_code: safeReplyReceiptCode(receipt) }),
        within_target: Date.now() - startedAt <= passiveReplyTargetMs,
      };
    } catch (error) {
      const providerErrcode = providerErrorCode(error);
      passiveReply = {
        operation: 'aibot_respond_msg_stream',
        attempted: true,
        acknowledged: false,
        provider_errcode: providerErrcode,
        outcome: replyOutcome(false, providerErrcode),
        error_code: safeReplyFailureCode(error),
        within_target: Date.now() - startedAt <= passiveReplyTargetMs,
      };
    }

    let delivery = { attempted: false, status: 'NOT_APPLICABLE' };
    const deliveryId = accepted?.ok === true && Array.isArray(accepted.result?.lifecycle?.delivery_ids)
      ? accepted.result.lifecycle.delivery_ids[0]
      : null;
    if (typeof deliveryId === 'string' && deliver !== null) {
      try {
        const delivered = await deliver({ deliveryId });
        delivery = { attempted: true, status: safeDeliveryStatus(delivered?.status) };
      } catch {
        delivery = { attempted: true, status: 'RETRY_SCHEDULED' };
      }
    }

    return Object.freeze({
      outcome: 'processed',
      scenario,
      core: Object.freeze(core),
      passive_reply: Object.freeze(passiveReply),
      delivery: Object.freeze(delivery),
    });
  }

  return Object.freeze({ handleFrame });
}

/**
 * Evaluates the P1-012 exit criteria from independently recorded evidence.
 * Outbound WSS does not require a public listener; client observation does.
 */
export function evaluatePilotGoNoGo(evidence) {
  if (!isRecord(evidence)) {
    throw new TypeError('P1-012 evidence must be an object.');
  }
  const blockers = GO_NO_GO_GATES
    .filter(([key]) => evidence[key] !== true)
    .map(([, blocker]) => blocker);
  return Object.freeze({
    decision: blockers.length === 0 ? 'GO' : 'NO_GO',
    blockers: Object.freeze(blockers),
  });
}
