import { adaptWeComSdkFrame } from './p1-002-wecom-sdk-adapter.mjs';
import { createServiceIntakeProcessor } from './p1-004-service-intake.mjs';
import { createPilotTicketCore } from './p1-005-pilot-ticket-core.mjs';
import { createNotificationOutbox } from './p1-007-notification-outbox.mjs';
import { createTicketClosureService } from './p1-010-ticket-closure.mjs';
import { createPilotOperationalIntake } from './p1-011-pilot-operations-baseline.mjs';

export const P2_G1_LIVE_MODES = Object.freeze([
  'inbound-shadow',
  'human-live',
  'reconnect',
  'concurrent-takeover',
  'internal-note',
  'duplicate-reply',
]);

export const P2_G1_FORBIDDEN_FEATURE_FLAGS = Object.freeze([
  'AI_TRIAGE_ENABLED',
  'AI_CONVERSATION_ENABLED',
  'AI_AUTO_REPLY_ENABLED',
  'OCR_ENABLED',
  'INCIDENT_CORRELATION_ENABLED',
  'INTEGRATION_CONNECTOR_ENABLED',
  'HOSPITAL_IDENTITY_ENABLED',
  'INTRANET_PORTAL_SOURCE_ENABLED',
  'HOSPITAL_API_SOURCE_ENABLED',
  'MONITORING_SOURCE_ENABLED',
]);

function truth(value) { return value === true || value === 'true'; }

export function validateP2G1ProcessApprovals(env, { mode, checkOnly = false } = {}) {
  if (!env || typeof env !== 'object' || (!checkOnly && !P2_G1_LIVE_MODES.includes(mode))) {
    throw new Error('P2_G1_PROCESS_SCOPE_INVALID');
  }
  if (P2_G1_FORBIDDEN_FEATURE_FLAGS.some((name) => truth(env[name]))) {
    throw new Error('P2_G1_HUMAN_ONLY_FLAG_VIOLATION');
  }
  if (checkOnly) return Object.freeze({ check_only: true, live_approved: false, send_approved: false });
  if (!truth(env.P2_G1_LIVE_TEST_APPROVED) || !truth(env.P2_G1_TEST_SCOPE_CONFIGURED)) {
    throw new Error('P2_G1_LIVE_APPROVAL_REQUIRED');
  }
  const sendMode = mode !== 'inbound-shadow';
  if (sendMode && !truth(env.P2_G1_REAL_WECOM_SEND_APPROVED)) {
    throw new Error('P2_G1_REAL_SEND_APPROVAL_REQUIRED');
  }
  return Object.freeze({ check_only: false, live_approved: true, send_approved: sendMode });
}

export function createP2G1PilotOperationalIntake({ pool, identityHashKey } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof identityHashKey !== 'string' || identityHashKey.length < 16) {
    throw new TypeError('P2_G1_P1_INTAKE_CONFIGURATION_INVALID');
  }
  const outbox = createNotificationOutbox();
  const closure = createTicketClosureService({ pool, outbox, resolveReporterActor: async () => null });
  return createPilotOperationalIntake({
    pool,
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure,
    coreChecks: {
      postgres: async () => ({ ok: true }),
      intake: async () => ({ ok: true }),
      outbox: async () => ({ ok: true }),
    },
    identityHashKey,
    writeLogRecord: async () => {},
  });
}

export function createP2G1HumanOnlyAssembly({
  operationalIntake,
  coordinator,
  observability = null,
  privacyClass = 'PATIENT_SENSITIVE',
  retentionMs = 86_400_000,
  now = () => new Date(),
} = {}) {
  if (!operationalIntake || typeof operationalIntake.accept !== 'function' || !coordinator || typeof coordinator.runOnce !== 'function'
    || !['INTERNAL', 'PATIENT_SENSITIVE'].includes(privacyClass)
    || !Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > 31_536_000_000
    || typeof now !== 'function') {
    throw new TypeError('P2_G1_ASSEMBLY_CONFIGURATION_INVALID');
  }
  async function handleFrame(frame) {
    const receivedAt = now();
    if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
      throw new TypeError('P2_G1_ASSEMBLY_CLOCK_INVALID');
    }
    const adapted = adaptWeComSdkFrame(frame, { receivedAt: receivedAt.toISOString() });
    if (!adapted.ok) return adapted;
    const accepted = await operationalIntake.accept({
      message: adapted.message,
      traceId: adapted.message.req_id,
      privacyClass,
      retentionUntil: new Date(receivedAt.getTime() + retentionMs).toISOString(),
    });
    if (!accepted.ok) return accepted;
    observability?.recordP1Commit?.();
    let projection;
    try {
      projection = await coordinator.runOnce();
      observability?.recordProjection?.(projection);
    } catch {
      projection = Object.freeze({ processed: 0, failures: 1, error_code: 'P2_G1_PROJECTION_DEFERRED' });
    }
    return Object.freeze({
      ok: true,
      result: accepted.result,
      projection,
      p1_committed: true,
    });
  }
  return Object.freeze({ handleFrame });
}
