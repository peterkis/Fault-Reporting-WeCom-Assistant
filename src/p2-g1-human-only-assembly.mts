import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { createP2G1InboundProjectionCoordinator } from './p2-g1-inbound-projection-coordinator.mjs';
import type { createP2G1Observability } from './p2-g1-observability.mjs';
export type OperationalIntake = ReturnType<typeof createPilotOperationalIntake>;
type Coordinator = ReturnType<typeof createP2G1InboundProjectionCoordinator>;
interface AssemblyOptions { operationalIntake?: OperationalIntake; coordinator?: Coordinator | null; projectAfterCommit?: boolean; observability?: Pick<ReturnType<typeof createP2G1Observability>, 'recordP1Commit' | 'recordProjection'> | null; privacyClass?: 'INTERNAL' | 'PATIENT_SENSITIVE'; retentionMs?: number; now?: () => Date }
import { adaptWeComSdkFrame } from './p1-002-wecom-sdk-adapter.mjs';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';
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

function truth(value: unknown) { return value === true || value === 'true'; }

export function validateP2G1ProcessApprovals(env: Record<string, unknown>, { mode, checkOnly = false }: { mode?: string; checkOnly?: boolean } = {}) {
  if (!env || typeof env !== 'object' || (!checkOnly && !P2_G1_LIVE_MODES.includes(mode as string))) {
    throw new Error('P2_G1_PROCESS_SCOPE_INVALID');
  }
  if (P2_G1_FORBIDDEN_FEATURE_FLAGS.some((name) => truth(env[name]))) {
    throw new Error('P2_G1_HUMAN_ONLY_FLAG_VIOLATION');
  }
  if (checkOnly) return Object.freeze({ check_only: true, live_approved: false, send_approved: false });
  if (!truth(env.P2_G1_LIVE_TEST_APPROVED) || !truth(env.P2_G1_TEST_SCOPE_CONFIGURED)) {
    throw new Error('P2_G1_LIVE_APPROVAL_REQUIRED');
  }
  const sendMode = ['human-live', 'reconnect', 'duplicate-reply'].includes(mode as string);
  if (sendMode && !truth(env.P2_G1_REAL_WECOM_SEND_APPROVED)) {
    throw new Error('P2_G1_REAL_SEND_APPROVAL_REQUIRED');
  }
  return Object.freeze({ check_only: false, live_approved: true, send_approved: sendMode });
}

export function createP2G1PilotOperationalIntake({ pool, identityHashKey }: { pool?: PostgresPool; identityHashKey?: string } = {}) {
  if (!pool || typeof (pool as PostgresPool).query !== 'function' || typeof identityHashKey !== 'string' || identityHashKey.length < 16) {
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
  coordinator = null,
  projectAfterCommit = true,
  observability = null,
  privacyClass = 'PATIENT_SENSITIVE',
  retentionMs = 86_400_000,
  now = () => new Date(),
}: AssemblyOptions = {}) {
  if (!operationalIntake || typeof (operationalIntake as OperationalIntake).accept !== 'function'
    || typeof projectAfterCommit !== 'boolean'
    || (projectAfterCommit && (!coordinator || typeof coordinator.runOnce !== 'function'))
    || (!projectAfterCommit && coordinator !== null)
    || !['INTERNAL', 'PATIENT_SENSITIVE'].includes(privacyClass)
    || !Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > 31_536_000_000
    || typeof now !== 'function') {
    throw new TypeError('P2_G1_ASSEMBLY_CONFIGURATION_INVALID');
  }
  async function handleFrame(frame: unknown) {
    const receivedAt = now();
    if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
      throw new TypeError('P2_G1_ASSEMBLY_CLOCK_INVALID');
    }
    const receivedEpochMs = String(receivedAt.getTime());
    const adapted = adaptWeComSdkFrame(frame, { receivedEpochMs });
    if (!adapted.ok) return adapted;
    const accepted = await (operationalIntake as OperationalIntake).accept({
      message: adapted.message,
      traceId: adapted.message.req_id,
      privacyClass,
      retentionUntil: formatEpochMsToShanghaiLocal(String(receivedAt.getTime() + retentionMs)),
      retentionUntilEpochMs: String(receivedAt.getTime() + retentionMs),
    });
    if (!accepted.ok) return accepted;
    observability?.recordP1Commit?.();
    let projection: { processed: number; failures?: number; deferred?: boolean; error_code?: string } = Object.freeze({ processed: 0, failures: 0, deferred: true });
    if (projectAfterCommit) {
      try {
        projection = await (coordinator as Coordinator).runOnce();
        observability?.recordProjection?.(projection);
      } catch {
        projection = Object.freeze({ processed: 0, failures: 1, error_code: 'P2_G1_PROJECTION_DEFERRED' });
      }
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
