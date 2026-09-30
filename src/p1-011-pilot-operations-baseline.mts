import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import {
  assertLocalDateTime,
  formatEpochMsToShanghaiLocal,
  shanghaiLocalToEpochMs,
} from './platform/time-contract.mjs';
import { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import { createTicketLifecycleProcessor } from './p1-010-ticket-closure.mjs';

import type { PostgresPool, PostgresPoolClient, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { LocalDateTime } from '../contracts/time_contracts.js';

type CoreDependency = 'postgres' | 'intake' | 'outbox';
type OptionalDependency = 'redis' | 'ai' | 'ocr' | 'object_storage';
type RedactionCode = 'SECRET_FIELD' | 'PATIENT_SENSITIVE_FIELD' | 'MEDIA_REFERENCE_FIELD';
type AlertCode = keyof typeof ALERT_RULES;
type AlertScope = CoreDependency | OptionalDependency | RedactionCode | 'log' | 'backup' | 'restore';
type MetricName = keyof typeof METRIC_LABELS;
type Check = () => unknown;
type Clock = () => Date | LocalDateTime;
interface AlertSink { raise(code: AlertCode, scope: AlertScope): unknown; resolve?(code: AlertCode, scope: AlertScope): unknown }
interface Alert { code: AlertCode; severity: 'P1' | 'P2'; scope: AlertScope; status: 'ACTIVE'; opened_at: LocalDateTime }
interface SafeLogRecord { readonly event: string; readonly trace_id: string; readonly msg_id: string; readonly actor_hash?: string; readonly chat_hash?: string; readonly status: string; readonly error_code: string; readonly duration_ms: number; readonly redaction_codes: RedactionCode[] }
interface LogInput { event: string; traceId: string; msgId: string; actorId?: unknown; chatId?: unknown; status: string; errorCode: string; durationMs: number; details?: unknown }
interface LoggerOptions { identityHashKey: string; writeRecord?: (record: SafeLogRecord) => unknown; alerts?: AlertSink | null }
type Labels = { dependency?: OptionalDependency };
interface Metric { name: MetricName; labels: Labels; value: number }
interface TelemetrySink { increment(name: MetricName, labels?: Labels, amount?: number): void; setGauge(name: MetricName, labels: Labels | undefined, value: number): void }
interface ReadinessOptions { coreChecks: Record<CoreDependency, Check>; optionalChecks?: Partial<Record<OptionalDependency, Check>>; telemetry?: TelemetrySink; alerts?: AlertSink | null }
interface BoundaryOptions<I, O> { acceptCore: (input: I) => O | PromiseLike<O>; optionalEnhancements?: Partial<Record<OptionalDependency, (core: Awaited<O>) => unknown>>; telemetry?: Pick<TelemetrySink, 'increment'>; alerts?: AlertSink | null }
type LifecycleOptions = NonNullable<Parameters<typeof createTicketLifecycleProcessor>[0]>;
type Inbox = ReturnType<typeof createChannelMessageInbox>;
type IntakeResult = Awaited<ReturnType<Inbox['accept']>>;
interface OperationalOptions<T extends TelemetrySink = ReturnType<typeof createPilotTelemetry>, A extends AlertSink = ReturnType<typeof createPilotAlertRegistry>> extends LifecycleOptions, Omit<ReadinessOptions, 'telemetry' | 'alerts'> { pool: PostgresPool; identityHashKey: string; writeLogRecord: (record: SafeLogRecord) => unknown; telemetry?: T; alerts?: A; optionalEnhancements?: Partial<Record<OptionalDependency, (core: IntakeResult) => unknown>> }
interface OperationsOptions { pool: PostgresPool; now?: Clock; alerts?: AlertSink | null }
interface TransactionInput { transaction?: PostgresTransaction | null }
interface BackupInput extends TransactionInput { backupId: string; checksumSha256: string; sizeBytes: number; encryptionKeyId: string; retentionUntil: string | Date; occurredAt?: string | Date }
interface RestoreInput extends TransactionInput { backupId: string; restoreId: string; verifiedObjectCount: number; status?: 'SUCCEEDED' | 'FAILED'; failureCode?: string | null; completedAt?: string | Date }
interface RestoreFailureInput extends TransactionInput { backupId?: string | null; restoreId: string; failureCode: string; completedAt?: string | Date }
interface BackupRow { id: string; backup_id: string; checksum_sha256: string; size_bytes: string; encryption_key_id: string; retention_until: string; created_at: string }
interface RestoreFields { id: string; restore_id: string; verified_object_count: string; completed_at: string }
type RestoreInsertRow = RestoreFields & ({ status: 'SUCCEEDED'; failure_code: null } | { status: 'FAILED'; failure_code: string });
type RestoreRow = RestoreInsertRow & { backup_id: string };
interface AuditRow { id: string; event_type: string; trace_id: string | null; subject_hash: string | null; metadata: Record<string, unknown>; occurred_at: string }
interface AuditInput { eventKey?: string; eventType?: string; actorId?: string | null; traceId?: string | null; subjectHash?: string | null; metadata?: unknown; occurredAt?: string | Date }

interface ReadinessResult { readonly ready: boolean; readonly core_failures: readonly CoreDependency[]; readonly degraded_dependencies: readonly OptionalDependency[] }
interface ReadinessService { assess(): Promise<Readonly<ReadinessResult>> }
interface OperationalIntake<T extends TelemetrySink, A extends AlertSink> { accept(request: unknown): Promise<IntakeResult>; assessReadiness(): Promise<Readonly<ReadinessResult>>; telemetry: T; alerts: A }
type BackupCheckpoint = ReturnType<typeof publicBackupCheckpoint>;
interface PublicRestoreFields { readonly id: string; readonly backup_id: string; readonly restore_id: string; readonly completed_at: LocalDateTime }
type LinkedRestoreFailure = Readonly<PublicRestoreFields & { status: 'FAILED'; verified_object_count: 0; failure_code: string }>;
type RestoreDrill = Readonly<PublicRestoreFields & { status: 'SUCCEEDED'; verified_object_count: number; failure_code: null }> | LinkedRestoreFailure;
interface UnlinkedRestoreFailure { readonly backup_id: null; readonly restore_id: string; readonly status: 'FAILED'; readonly verified_object_count: 0; readonly failure_code: string; readonly completed_at: LocalDateTime }
type AuditResult = Readonly<{ ok: false; error: Readonly<{ code: 'FORBIDDEN'; retryable: false }> }> | Readonly<{ ok: true; items: readonly Readonly<Omit<AuditRow, 'occurred_at'> & { occurred_at: LocalDateTime }>[] }>;
interface FreshnessResult { readonly fresh: boolean; readonly code: 'PILOT_BACKUP_STALE' | null; readonly latest_checkpoint_at: LocalDateTime | null }
interface OperationsService {
  recordBackupCheckpoint(input: BackupInput): Promise<BackupCheckpoint>;
  recordRestoreDrill(input: RestoreInput): Promise<RestoreDrill>;
  recordRestoreDrillFailure(input: RestoreFailureInput): Promise<LinkedRestoreFailure | UnlinkedRestoreFailure>;
  assessBackupFreshness(input: TransactionInput & { maximumAgeMs: number }): Promise<FreshnessResult>;
  listAuditEvents(input: TransactionInput & { actorId: string; limit?: number }): Promise<AuditResult>;
}

const MIGRATION_URL = new URL('../database/migrations/009_p1_011_pilot_operations_baseline.sql', import.meta.url);

const EVENT_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const STATUS_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;

const REDACTION_ORDER: readonly RedactionCode[] = Object.freeze([
  'SECRET_FIELD',
  'PATIENT_SENSITIVE_FIELD',
  'MEDIA_REFERENCE_FIELD',
]);
const REQUIRED_CORE_DEPENDENCIES: readonly CoreDependency[] = Object.freeze(['postgres', 'intake', 'outbox']);
const OPTIONAL_DEPENDENCIES = new Set<unknown>(['redis', 'ai', 'ocr', 'object_storage']);
const AUDIT_EVENT_TYPES = new Set([
  'security.log_redacted',
  'security.secret_scan_failed',
  'backup.completed',
  'backup.restore_drill_completed',
  'backup.restore_drill_failed',
  'audit.accessed',
  'readiness.core_failed',
  'readiness.degraded',
]);
const ALERT_RULES = Object.freeze({
  PILOT_CORE_UNAVAILABLE: Object.freeze({ severity: 'P1' as const, scopes: new Set<unknown>(REQUIRED_CORE_DEPENDENCIES) }),
  PILOT_OPTIONAL_DEPENDENCY_DEGRADED: Object.freeze({ severity: 'P2' as const, scopes: OPTIONAL_DEPENDENCIES }),
  PILOT_SENSITIVE_LOG_REJECTED: Object.freeze({ severity: 'P1' as const, scopes: new Set<unknown>(REDACTION_ORDER) }),
  PILOT_SECURITY_LOG_WRITE_FAILED: Object.freeze({ severity: 'P1' as const, scopes: new Set<unknown>(['log']) }),
  PILOT_BACKUP_STALE: Object.freeze({ severity: 'P1' as const, scopes: new Set<unknown>(['backup']) }),
  PILOT_RESTORE_DRILL_FAILED: Object.freeze({ severity: 'P1' as const, scopes: new Set<unknown>(['restore']) }),
});
const METRIC_LABELS = Object.freeze({
  pilot_core_readiness: Object.freeze([]),
  pilot_optional_dependency_degraded_total: Object.freeze(['dependency']),
});

function nonEmpty(value: unknown, message: string, maximum: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredIdentifier(value: unknown, message: string) {
  const identifier = nonEmpty(value, message, 128);
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new TypeError(message);
  }
  return identifier;
}

function classifyDetailKey(key: string): RedactionCode | null {
  const normalized = key.toLowerCase().replaceAll('-', '_');
  if (/(secret|token|password|credential|authorization|cookie|aeskey|private_key)/u.test(normalized)) {
    return 'SECRET_FIELD';
  }
  if (/(patient|medical|diagnosis|prescription|record|inpatient|outpatient|resident|phone|identity|id_card|name|text|content|note|summary|description)/u.test(normalized)) {
    return 'PATIENT_SENSITIVE_FIELD';
  }
  if (/(media|upload|url|base64|filename|file_name|raw_payload|attachment)/u.test(normalized)) {
    return 'MEDIA_REFERENCE_FIELD';
  }
  return null;
}

function collectRedactionCodes(value: unknown, codes = new Set<RedactionCode>()) {
  if (value === null || value === undefined) {
    return codes;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRedactionCodes(entry, codes);
    }
    return codes;
  }
  if (typeof value !== 'object') {
    return codes;
  }
  for (const [key, nested] of Object.entries(value)) {
    const code = classifyDetailKey(key);
    if (code !== null) {
      codes.add(code);
    }
    collectRedactionCodes(nested, codes);
  }
  return codes;
}

function hashIdentifier(identityHashKey: string, value: string) {
  return `hmac-sha256:${createHmac('sha256', identityHashKey).update(value).digest('hex').slice(0, 24)}`;
}

/**
 * Creates the P1 structured-log boundary. It never writes free text or media
 * references: callers may provide them only in `details`, which is inspected
 * for redaction telemetry and then discarded.
 */
function validateAlertRegistry(alerts: AlertSink | null) {
  if (alerts !== null && (!alerts || typeof alerts.raise !== 'function')) {
    throw new TypeError('alerts must expose raise when supplied.');
  }
}

/**
 * In-memory alert state is intentionally limited to fixed code and scope
 * combinations. It cannot accept a person, URL, credential, or free-text
 * value as an alert dimension.
 */
export function createPilotAlertRegistry({ now = () => new Date() }: { now?: Clock } = {}) {
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }
  const active = new Map<string, Readonly<Alert>>();

  function key(code: AlertCode, scope: AlertScope) {
    const rule = ALERT_RULES[code];
    if (!rule || !rule.scopes.has(scope)) {
      throw new TypeError('Alert code or scope is not allowlisted.');
    }
    return `${code}\u0000${scope}`;
  }

  function raise(code: AlertCode, scope: AlertScope) {
    const identity = key(code, scope);
    const rule = ALERT_RULES[code];
    const existing = active.get(identity);
    if (existing) {
      return existing;
    }
    const alert = Object.freeze({
      code,
      severity: rule.severity,
      scope,
      status: 'ACTIVE' as const,
      opened_at: iso(now(), 'Alert time is invalid.'),
    });
    active.set(identity, alert);
    return alert;
  }

  function resolve(code: AlertCode, scope: AlertScope) {
    active.delete(key(code, scope));
  }

  function snapshot() {
    return [...active.values()].sort((left, right) => `${left.code}\u0000${left.scope}`
      .localeCompare(`${right.code}\u0000${right.scope}`));
  }

  return Object.freeze({ raise, resolve, snapshot });
}

export function createPilotSecurityLogger(options: LoggerOptions): Readonly<{ record(input: LogInput): SafeLogRecord }>;
export function createPilotSecurityLogger({ identityHashKey, writeRecord = () => {}, alerts = null }: Partial<LoggerOptions> = {}) {
  nonEmpty(identityHashKey, 'A log identity hash key is required.', 4_096);
  if (typeof writeRecord !== 'function') {
    throw new TypeError('writeRecord must be a function.');
  }
  validateAlertRegistry(alerts);

  function record(input: LogInput): SafeLogRecord;
  function record({
    event,
    traceId,
    msgId,
    actorId = null,
    chatId = null,
    status,
    errorCode,
    durationMs,
    details = null,
  }: Partial<LogInput> = {}): SafeLogRecord {
    const eventName = nonEmpty(event, 'event is required.', 128);
    if (!EVENT_PATTERN.test(eventName)) {
      throw new TypeError('event is invalid.');
    }
    const traceIdentifier = requiredIdentifier(traceId, 'traceId is invalid.');
    const messageIdentifier = requiredIdentifier(msgId, 'msgId is invalid.');
    const normalizedStatus = nonEmpty(status, 'status is required.', 64);
    if (!STATUS_PATTERN.test(normalizedStatus)) {
      throw new TypeError('status is invalid.');
    }
    const normalizedErrorCode = nonEmpty(errorCode, 'errorCode is required.', 128);
    if (!ERROR_CODE_PATTERN.test(normalizedErrorCode)) {
      throw new TypeError('errorCode is invalid.');
    }
    if (!Number.isInteger(durationMs) || (durationMs as number) < 0 || (durationMs as number) > 86_400_000) {
      throw new TypeError('durationMs must be an integer from 0 through 86400000.');
    }
    if (actorId !== null) {
      nonEmpty(String(actorId), 'actorId is invalid.', 512);
    }
    if (chatId !== null) {
      nonEmpty(String(chatId), 'chatId is invalid.', 512);
    }
    if (details !== null && (typeof details !== 'object' || Array.isArray(details))) {
      throw new TypeError('details must be an object when supplied.');
    }

    const redactionCodes = REDACTION_ORDER.filter((code) => collectRedactionCodes(details).has(code));
    const safeRecord = Object.freeze({
      event: eventName,
      trace_id: traceIdentifier,
      msg_id: messageIdentifier,
      ...(actorId === null ? {} : { actor_hash: hashIdentifier(identityHashKey as string, String(actorId)) }),
      ...(chatId === null ? {} : { chat_hash: hashIdentifier(identityHashKey as string, String(chatId)) }),
      status: normalizedStatus,
      error_code: normalizedErrorCode,
      duration_ms: durationMs as number,
      redaction_codes: redactionCodes,
    });
    writeRecord(safeRecord);
    for (const code of redactionCodes) {
      alerts?.raise('PILOT_SENSITIVE_LOG_REJECTED', code);
    }
    return safeRecord;
  }

  return Object.freeze({ record });
}

function sortedLabels(labels: Labels): Labels {
  return Object.fromEntries(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)));
}

function metricIdentity(name: MetricName, labels: Labels) {
  return `${name}\u0000${JSON.stringify(sortedLabels(labels))}`;
}

function validateMetric(name: MetricName, labels: Labels) {
  const expectedLabels = METRIC_LABELS[name];
  if (!expectedLabels) {
    throw new TypeError('Metric name is not allowlisted.');
  }
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new TypeError('Metric labels must be an object.');
  }
  const actualLabels = Object.keys(labels).sort();
  if (actualLabels.length !== expectedLabels.length
    || actualLabels.some((label, index) => label !== expectedLabels[index])) {
    throw new TypeError('Metric labels are not allowlisted.');
  }
  if (Object.hasOwn(labels, 'dependency') && !OPTIONAL_DEPENDENCIES.has(labels.dependency)) {
    throw new TypeError('Metric dependency label is invalid.');
  }
  return sortedLabels(labels);
}

/**
 * An intentionally small metrics registry. Labels are allowlisted so personal,
 * clinical, media, and secret values cannot become metrics dimensions.
 */
export function createPilotTelemetry() {
  const values = new Map<string, Metric>();

  function increment(name: MetricName, labels: Labels = {}, amount = 1) {
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new TypeError('Metric increment must be a positive integer.');
    }
    const normalizedLabels = validateMetric(name, labels);
    const identity = metricIdentity(name, normalizedLabels);
    const current = values.get(identity) ?? { name, labels: normalizedLabels, value: 0 };
    values.set(identity, { ...current, value: current.value + amount });
  }

  function setGauge(name: MetricName, labels: Labels = {}, value: number) {
    if (!Number.isFinite(value) || (value as number) < 0) {
      throw new TypeError('Metric gauge must be a non-negative finite number.');
    }
    const normalizedLabels = validateMetric(name, labels);
    values.set(metricIdentity(name, normalizedLabels), { name, labels: normalizedLabels, value });
  }

  function snapshot() {
    return [...values.values()]
      .map((metric) => Object.freeze({ ...metric, labels: Object.freeze({ ...metric.labels }) }))
      .sort((left, right) => metricIdentity(left.name, left.labels).localeCompare(metricIdentity(right.name, right.labels)));
  }

  return Object.freeze({ increment, setGauge, snapshot });
}

function validateChecks(checks: unknown, expected: readonly CoreDependency[], label: string): asserts checks is Record<CoreDependency, Check> {
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const dependency of expected) {
    if (typeof (checks as Record<string, unknown>)[dependency] !== 'function') {
      throw new TypeError(`${label}.${dependency} must be a function.`);
    }
  }
}

function validateOptionalChecks(checks: unknown, label: string) {
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const [dependency, check] of Object.entries(checks)) {
    if (!OPTIONAL_DEPENDENCIES.has(dependency) || typeof check !== 'function') {
      throw new TypeError(`${label} contains an invalid dependency.`);
    }
  }
}

async function probe(check: Check) {
  try {
    return ((await check()) as { ok?: unknown } | null | undefined)?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Separates P1 admission dependencies from optional P2/operational ones.
 * Stable codes deliberately replace raw probe errors in every result.
 */
export function createPilotReadinessService(options: ReadinessOptions): Readonly<ReadinessService>;
export function createPilotReadinessService({
  coreChecks,
  optionalChecks = {},
  telemetry = createPilotTelemetry(),
  alerts = null,
}: Partial<ReadinessOptions> = {}) {
  validateChecks(coreChecks, REQUIRED_CORE_DEPENDENCIES, 'coreChecks');
  validateOptionalChecks(optionalChecks, 'optionalChecks');
  if (!telemetry || typeof telemetry.increment !== 'function' || typeof telemetry.setGauge !== 'function') {
    throw new TypeError('A Pilot telemetry service is required.');
  }
  validateAlertRegistry(alerts);

  async function assess() {
    const coreFailures: CoreDependency[] = [];
    for (const dependency of REQUIRED_CORE_DEPENDENCIES) {
      if (!(await probe((coreChecks as Record<CoreDependency, Check>)[dependency]))) {
        coreFailures.push(dependency);
        alerts?.raise('PILOT_CORE_UNAVAILABLE', dependency);
      } else if (typeof alerts?.resolve === 'function') {
        alerts.resolve('PILOT_CORE_UNAVAILABLE', dependency);
      }
    }
    const degradedDependencies: OptionalDependency[] = [];
    for (const dependency of (Object.keys(optionalChecks) as OptionalDependency[]).sort()) {
      if (!(await probe((optionalChecks[dependency] as Check)))) {
        degradedDependencies.push(dependency);
        telemetry.increment('pilot_optional_dependency_degraded_total', { dependency });
        alerts?.raise('PILOT_OPTIONAL_DEPENDENCY_DEGRADED', dependency);
      } else if (typeof alerts?.resolve === 'function') {
        alerts.resolve('PILOT_OPTIONAL_DEPENDENCY_DEGRADED', dependency);
      }
    }
    const ready = coreFailures.length === 0;
    telemetry.setGauge('pilot_core_readiness', {}, ready ? 1 : 0);
    return Object.freeze({
      ready,
      core_failures: Object.freeze(coreFailures),
      degraded_dependencies: Object.freeze(degradedDependencies),
    });
  }

  return Object.freeze({ assess });
}

/**
 * Runs the durable Intake/Ticket acceptance first. Optional cache or AI hooks
 * execute only after that result and cannot turn a committed core result into a
 * failed admission.
 */
export function createCoreIntakeSafetyBoundary<I, O>(options: BoundaryOptions<I, O>): Readonly<{ accept(input: I): Promise<Readonly<{ core: Awaited<O>; degraded_dependencies: readonly OptionalDependency[] }>> }>;
export function createCoreIntakeSafetyBoundary<I, O>({
  acceptCore,
  optionalEnhancements = {},
  telemetry = createPilotTelemetry(),
  alerts = null,
}: Partial<BoundaryOptions<I, O>> = {}) {
  if (typeof acceptCore !== 'function') {
    throw new TypeError('acceptCore must be a function.');
  }
  validateOptionalChecks(optionalEnhancements, 'optionalEnhancements');
  if (!telemetry || typeof telemetry.increment !== 'function') {
    throw new TypeError('A Pilot telemetry service is required.');
  }
  validateAlertRegistry(alerts);

  async function accept(input: I) {
    const core = await (acceptCore as (input: I) => O | PromiseLike<O>)(input);
    const degradedDependencies: OptionalDependency[] = [];
    for (const dependency of (Object.keys(optionalEnhancements) as OptionalDependency[]).sort()) {
      if (!(await probe(() => (optionalEnhancements[dependency] as (core: Awaited<O>) => unknown)(core)))) {
        degradedDependencies.push(dependency);
        telemetry.increment('pilot_optional_dependency_degraded_total', { dependency });
        alerts?.raise('PILOT_OPTIONAL_DEPENDENCY_DEGRADED', dependency);
      } else if (typeof alerts?.resolve === 'function') {
        alerts.resolve('PILOT_OPTIONAL_DEPENDENCY_DEGRADED', dependency);
      }
    }
    return Object.freeze({
      core,
      degraded_dependencies: Object.freeze(degradedDependencies),
    });
  }

  return Object.freeze({ accept });
}

function logCorrelationId(prefix: string, value: unknown) {
  const source = typeof value === 'string' ? value : 'missing';
  return `${prefix}-${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function logSubject(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function safeResultCode(result: IntakeResult) {
  const candidate = (result as { error?: { code?: unknown } } | null | undefined)?.error?.code;
  return typeof candidate === 'string' && ERROR_CODE_PATTERN.test(candidate)
    ? candidate
    : 'P1_011_INTAKE_REJECTED';
}

function setSecurityLogWriteAlert(alerts: AlertSink | null, succeeded: boolean) {
  try {
    if (succeeded && typeof alerts?.resolve === 'function') {
      alerts.resolve('PILOT_SECURITY_LOG_WRITE_FAILED', 'log');
    } else if (!succeeded) {
      alerts?.raise('PILOT_SECURITY_LOG_WRITE_FAILED', 'log');
    }
  } catch {
    // An alert sink must never turn a committed Pilot intake into a failure.
  }
}

function dispatchSecurityLogRecord(writeLogRecord: (record: SafeLogRecord) => unknown, record: SafeLogRecord, alerts: AlertSink | null) {
  try {
    const outcome = writeLogRecord(record);
    if (outcome && typeof (outcome as { then?: unknown }).then === 'function') {
      void Promise.resolve(outcome).then(
        () => setSecurityLogWriteAlert(alerts, true),
        () => setSecurityLogWriteAlert(alerts, false),
      );
      return;
    }
    setSecurityLogWriteAlert(alerts, true);
  } catch {
    setSecurityLogWriteAlert(alerts, false);
  }
}

/**
 * The Phase-1 runtime composition for a durable incoming message. It puts the
 * operational boundary around the real Inbox -> Intake -> Ticket -> Outbox
 * transaction, rather than exposing a test-only wrapper around a callback.
 */
export function createPilotOperationalIntake<T extends TelemetrySink = ReturnType<typeof createPilotTelemetry>, A extends AlertSink = ReturnType<typeof createPilotAlertRegistry>>(options: OperationalOptions<T, A>): Readonly<OperationalIntake<T, A>>;
export function createPilotOperationalIntake({
  pool,
  serviceIntakeProcessor,
  ticketCore,
  closure,
  coreChecks,
  optionalChecks = {},
  optionalEnhancements = {},
  identityHashKey,
  writeLogRecord,
  telemetry = createPilotTelemetry(),
  alerts = createPilotAlertRegistry(),
}: Partial<OperationalOptions<TelemetrySink, AlertSink>> = {}) {
  if (typeof writeLogRecord !== 'function') {
    throw new TypeError('writeLogRecord must be a function.');
  }
  const inbox = createChannelMessageInbox({ pool } as Parameters<typeof createChannelMessageInbox>[0]);
  const lifecycle = createTicketLifecycleProcessor({
    serviceIntakeProcessor,
    ticketCore,
    closure,
  } as LifecycleOptions);
  const readiness = createPilotReadinessService({
    coreChecks,
    optionalChecks,
    telemetry,
    alerts,
  } as ReadinessOptions);
  const logger = createPilotSecurityLogger({
    identityHashKey,
    writeRecord(record) {
      dispatchSecurityLogRecord(writeLogRecord, record, alerts);
    },
    alerts,
  } as LoggerOptions);
  const boundary = createCoreIntakeSafetyBoundary({
    acceptCore: async (request: unknown) => {
      const startedAt = Date.now();
      const result = await inbox.accept(request, lifecycle);
      const message = (request as { message?: { msg_id?: unknown; sender_user_id?: unknown; chat_id?: unknown } } | null | undefined)?.message;
      logger.record({
        event: result.ok ? 'pilot.intake.accepted' : 'pilot.intake.rejected',
        traceId: logCorrelationId('trace', (request as { traceId?: unknown } | null | undefined)?.traceId),
        msgId: logCorrelationId('message', message?.msg_id),
        actorId: logSubject(message?.sender_user_id),
        chatId: logSubject(message?.chat_id),
        status: result.ok ? 'accepted' : 'rejected',
        errorCode: result.ok ? 'NONE' : safeResultCode(result),
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      return result;
    },
    optionalEnhancements,
    telemetry,
    alerts,
  });

  return Object.freeze({
    accept: async (request: unknown) => {
      await readiness.assess();
      return (await boundary.accept(request)).core;
    },
    assessReadiness: readiness.assess,
    telemetry,
    alerts,
  });
}

function iso(value: unknown, message: string): LocalDateTime {
  try {
    return value instanceof Date
      ? formatEpochMsToShanghaiLocal(String(value.getTime()))
      : assertLocalDateTime(value);
  } catch { throw new TypeError(message); }
}

function opaqueId(value: unknown, message: string, prefix: string) {
  const identifier = nonEmpty(value, message, 128);
  if (!new RegExp(`^${prefix}[A-Za-z0-9-]{1,120}$`, 'u').test(identifier)) {
    throw new TypeError(message);
  }
  return identifier;
}

function uuid(value: unknown, message: string) {
  const identifier = nonEmpty(value, message, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identifier)) {
    throw new TypeError(message);
  }
  return identifier;
}

function sha256(value: unknown, message: string) {
  const hash = nonEmpty(value, message, 64);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new TypeError(message);
  }
  return hash;
}

function safeErrorCode(value: unknown, message: string) {
  const code = nonEmpty(value, message, 128);
  if (!ERROR_CODE_PATTERN.test(code)) {
    throw new TypeError(message);
  }
  return code;
}

function hashOperationalSubject(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function safeAuditMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    throw new TypeError('Audit metadata must be an object.');
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    switch (key) {
      case 'backup_id':
        safe.backup_id = opaqueId(value, 'backup_id is invalid.', 'backup-');
        break;
      case 'checksum_sha256':
        safe.checksum_sha256 = sha256(value, 'checksum_sha256 is invalid.');
        break;
      case 'size_bytes':
        if (!Number.isSafeInteger(value) || (value as number) < 1) {
          throw new TypeError(`${key} is invalid.`);
        }
        safe[key] = value;
        break;
      case 'verified_object_count':
      case 'query_limit':
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) {
          throw new TypeError(`${key} is invalid.`);
        }
        safe[key] = value;
        break;
      case 'encryption_key_id':
        safe.encryption_key_id = requiredIdentifier(value, 'encryption_key_id is invalid.');
        break;
      case 'retention_until':
        safe.retention_until = iso(value, 'retention_until is invalid.');
        break;
      case 'restore_id':
        safe.restore_id = opaqueId(value, 'restore_id is invalid.', 'restore-');
        break;
      case 'result':
        if (!(['SUCCEEDED', 'FAILED', 'DEGRADED', 'READY'] as readonly unknown[]).includes(value)) {
          throw new TypeError('result is invalid.');
        }
        safe.result = value;
        break;
      case 'failure_code':
        safe.failure_code = safeErrorCode(value, 'failure_code is invalid.');
        break;
      case 'dependency':
        if (!OPTIONAL_DEPENDENCIES.has(value) && !(REQUIRED_CORE_DEPENDENCIES as readonly unknown[]).includes(value)) {
          throw new TypeError('dependency is invalid.');
        }
        safe.dependency = value;
        break;
      case 'redaction_code':
        if (!(REDACTION_ORDER as readonly unknown[]).includes(value)) {
          throw new TypeError('redaction_code is invalid.');
        }
        safe.redaction_code = value;
        break;
      default:
        throw new TypeError('Audit metadata contains a forbidden field.');
    }
  }
  return safe;
}

async function withTransaction<T>(pool: PostgresPool, operation: (client: PostgresPoolClient) => Promise<T>): Promise<T> {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroyClient = true;
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

function suppliedTransaction(value: PostgresTransaction | null | undefined): PostgresTransaction | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value.query !== 'function') {
    throw new TypeError('transaction must expose query when supplied.');
  }
  return value;
}

async function executeInTransaction<T>(pool: PostgresPool, transaction: PostgresTransaction | null | undefined, operation: (client: PostgresTransaction) => Promise<T>): Promise<T> {
  const supplied = suppliedTransaction(transaction);
  return supplied === null ? withTransaction(pool, operation) : operation(supplied);
}

async function insertAuditEvent(transaction: PostgresTransaction, {
  eventKey,
  eventType,
  actorId = null,
  traceId = null,
  subjectHash = null,
  metadata = {},
  occurredAt = new Date(),
}: AuditInput = {}) {
  const key = nonEmpty(eventKey, 'eventKey is required.', 256);
  if (!/^[a-z][a-z0-9:._-]{1,255}$/u.test(key)) {
    throw new TypeError('eventKey is invalid.');
  }
  if (!AUDIT_EVENT_TYPES.has(eventType as string)) {
    throw new TypeError('eventType is invalid.');
  }
  const normalizedActorId = actorId === null ? null : uuid(actorId, 'actorId is invalid.');
  const normalizedTraceId = traceId === null ? null : requiredIdentifier(traceId, 'traceId is invalid.');
  if (subjectHash !== null && !/^sha256:[a-f0-9]{24}$/u.test(subjectHash)) {
    throw new TypeError('subjectHash is invalid.');
  }
  const normalizedMetadata = safeAuditMetadata(metadata);
  const normalizedOccurredAt = iso(occurredAt, 'occurredAt is invalid.');
  await transaction.query(
    `INSERT INTO operations.audit_event (
        event_key, event_type, actor_principal_id, trace_id, subject_hash, metadata, occurred_at
     ) VALUES ($1, $2, $3::uuid, $4, $5, $6::jsonb, $7::timestamp without time zone)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      key,
      eventType,
      normalizedActorId,
      normalizedTraceId,
      subjectHash,
      JSON.stringify(normalizedMetadata),
      normalizedOccurredAt,
    ],
  );
}

function publicBackupCheckpoint(row: BackupRow) {
  return Object.freeze({
    id: row.id,
    backup_id: row.backup_id,
    checksum_sha256: row.checksum_sha256,
    size_bytes: Number(row.size_bytes),
    encryption_key_id: row.encryption_key_id,
    retention_until: iso(row.retention_until, 'Stored backup retention is invalid.'),
    created_at: iso(row.created_at, 'Stored backup time is invalid.'),
  });
}

function publicRestoreDrill(row: RestoreRow): RestoreDrill;
function publicRestoreDrill(row: RestoreRow) {
  return Object.freeze({
    id: row.id,
    backup_id: row.backup_id,
    restore_id: row.restore_id,
    status: row.status,
    verified_object_count: Number(row.verified_object_count),
    failure_code: row.failure_code,
    completed_at: iso(row.completed_at, 'Stored restore time is invalid.'),
  });
}

export async function applyPilotOperationsMigration({ pool }: { pool: Pick<PostgresPool, 'query'> }): Promise<void | { status: 'LEGACY_MIGRATION_SUPERSEDED' }> {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

/**
 * The durable P1 operations boundary. It stores only backup and recovery
 * metadata, never dump paths, database URLs, credentials, patient text, or
 * media references.
 */
export function createPilotOperationsService(options: OperationsOptions): Readonly<OperationsService>;
export function createPilotOperationsService({ pool, now = () => new Date(), alerts = null }: Partial<OperationsOptions> = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }
  validateAlertRegistry(alerts);

  async function recordBackupCheckpoint(input: BackupInput): Promise<BackupCheckpoint>;
  async function recordBackupCheckpoint({
    transaction = null,
    backupId,
    checksumSha256,
    sizeBytes,
    encryptionKeyId,
    retentionUntil,
    occurredAt = now(),
  }: Partial<BackupInput> = {}): Promise<BackupCheckpoint> {
    const normalizedBackupId = opaqueId(backupId, 'backupId is invalid.', 'backup-');
    const normalizedChecksum = sha256(checksumSha256, 'checksumSha256 is invalid.');
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > Number.MAX_SAFE_INTEGER) {
      throw new TypeError('sizeBytes is invalid.');
    }
    const normalizedKeyId = requiredIdentifier(encryptionKeyId, 'encryptionKeyId is invalid.');
    const normalizedRetention = iso(retentionUntil, 'retentionUntil is invalid.');
    const normalizedOccurredAt = iso(occurredAt, 'occurredAt is invalid.');
    if (BigInt(shanghaiLocalToEpochMs(normalizedRetention)) <= BigInt(shanghaiLocalToEpochMs(normalizedOccurredAt))) {
      throw new TypeError('retentionUntil must be after occurredAt.');
    }

    return executeInTransaction(pool as PostgresPool, transaction, async (database) => {
      const inserted = await database.query<BackupRow>(
        `INSERT INTO operations.backup_checkpoint (
            backup_id, checksum_sha256, size_bytes, encryption_key_id, retention_until, created_at
         ) VALUES ($1, $2, $3, $4, $5::timestamp without time zone, $6::timestamp without time zone)
         ON CONFLICT (backup_id) DO NOTHING
         RETURNING id::text, backup_id, checksum_sha256, size_bytes, encryption_key_id, retention_until, created_at`,
        [
          normalizedBackupId,
          normalizedChecksum,
          sizeBytes,
          normalizedKeyId,
          normalizedRetention,
          normalizedOccurredAt,
        ],
      );
      const selected = inserted.rowCount === 1 ? inserted : await database.query<BackupRow>(
        `SELECT id::text, backup_id, checksum_sha256, size_bytes, encryption_key_id, retention_until, created_at
           FROM operations.backup_checkpoint
          WHERE backup_id = $1`,
        [normalizedBackupId],
      );
      // SQL insert-or-select guarantees the row under normal operation; retain the original
      // property-access failure if storage violates that invariant.
      const row = selected.rows[0] as BackupRow;
      if (
        row.checksum_sha256 !== normalizedChecksum
        || Number(row.size_bytes) !== sizeBytes
        || row.encryption_key_id !== normalizedKeyId
        || iso(row.retention_until, 'Stored backup retention is invalid.') !== normalizedRetention
      ) {
        const error = new Error('P1_011_BACKUP_CHECKPOINT_CONFLICT') as Error & { code: string };
        error.code = 'P1_011_BACKUP_CHECKPOINT_CONFLICT';
        throw error;
      }
      await insertAuditEvent(database, {
        eventKey: `backup:${normalizedBackupId}`,
        eventType: 'backup.completed',
        subjectHash: hashOperationalSubject(normalizedBackupId),
        metadata: {
          backup_id: normalizedBackupId,
          checksum_sha256: normalizedChecksum,
          size_bytes: sizeBytes,
          encryption_key_id: normalizedKeyId,
          result: 'SUCCEEDED',
        },
        occurredAt: normalizedOccurredAt,
      });
      return publicBackupCheckpoint(row);
    });
  }

  async function recordRestoreDrill(input: RestoreInput): Promise<RestoreDrill>;
  async function recordRestoreDrill({
    transaction = null,
    backupId,
    restoreId,
    verifiedObjectCount,
    status = 'SUCCEEDED',
    failureCode = null,
    completedAt = now(),
  }: Partial<RestoreInput> = {}): Promise<RestoreDrill> {
    const normalizedBackupId = opaqueId(backupId, 'backupId is invalid.', 'backup-');
    const normalizedRestoreId = opaqueId(restoreId, 'restoreId is invalid.', 'restore-');
    if (!Number.isSafeInteger(verifiedObjectCount) || (verifiedObjectCount as number) < 0 || (verifiedObjectCount as number) > 1_000_000_000) {
      throw new TypeError('verifiedObjectCount is invalid.');
    }
    if (!['SUCCEEDED', 'FAILED'].includes(status)) {
      throw new TypeError('status is invalid.');
    }
    const normalizedFailureCode = failureCode === null ? null : safeErrorCode(failureCode, 'failureCode is invalid.');
    if ((status === 'SUCCEEDED' && (verifiedObjectCount === 0 || normalizedFailureCode !== null))
      || (status === 'FAILED' && (verifiedObjectCount !== 0 || normalizedFailureCode === null))) {
      throw new TypeError('Restore result is inconsistent.');
    }
    const normalizedCompletedAt = iso(completedAt, 'completedAt is invalid.');

    return executeInTransaction(pool as PostgresPool, transaction, async (database) => {
      const backup = await database.query<{ id: string; backup_id: string }>(
        'SELECT id::text, backup_id FROM operations.backup_checkpoint WHERE backup_id = $1',
        [normalizedBackupId],
      );
      if (backup.rowCount !== 1) {
        const error = new Error('P1_011_BACKUP_NOT_FOUND') as Error & { code: string };
        error.code = 'P1_011_BACKUP_NOT_FOUND';
        throw error;
      }
      const inserted = await database.query<RestoreInsertRow>(
        `INSERT INTO operations.restore_drill (
            restore_id, backup_checkpoint_id, status, verified_object_count, failure_code, completed_at
         ) VALUES ($1, $2::uuid, $3, $4, $5, $6::timestamp without time zone)
         ON CONFLICT (restore_id) DO NOTHING
         RETURNING id::text, restore_id, status, verified_object_count, failure_code, completed_at`,
        [
          normalizedRestoreId,
          (backup.rows[0] as { id: string }).id,
          status,
          verifiedObjectCount,
          normalizedFailureCode,
          normalizedCompletedAt,
        ],
      );
      const selected = inserted.rowCount === 1 ? inserted : await database.query<RestoreRow>(
        `SELECT restore.id::text, checkpoint.backup_id, restore.restore_id, restore.status,
                restore.verified_object_count, restore.failure_code, restore.completed_at
           FROM operations.restore_drill AS restore
           JOIN operations.backup_checkpoint AS checkpoint ON checkpoint.id = restore.backup_checkpoint_id
          WHERE restore.restore_id = $1`,
        [normalizedRestoreId],
      );
      const row = inserted.rowCount === 1
        ? { ...(selected.rows[0] as RestoreInsertRow), backup_id: normalizedBackupId }
        : selected.rows[0] as RestoreRow;
      if (
        row.backup_id !== normalizedBackupId
        || row.status !== status
        || Number(row.verified_object_count) !== verifiedObjectCount
        || row.failure_code !== normalizedFailureCode
      ) {
        const error = new Error('P1_011_RESTORE_DRILL_CONFLICT') as Error & { code: string };
        error.code = 'P1_011_RESTORE_DRILL_CONFLICT';
        throw error;
      }
      await insertAuditEvent(database, {
        eventKey: `restore:${normalizedRestoreId}`,
        eventType: status === 'SUCCEEDED'
          ? 'backup.restore_drill_completed'
          : 'backup.restore_drill_failed',
        subjectHash: hashOperationalSubject(normalizedBackupId),
        metadata: {
          backup_id: normalizedBackupId,
          restore_id: normalizedRestoreId,
          verified_object_count: verifiedObjectCount,
          ...(normalizedFailureCode === null
            ? { result: 'SUCCEEDED' }
            : { result: 'FAILED', failure_code: normalizedFailureCode }),
        },
        occurredAt: normalizedCompletedAt,
      });
      if (status === 'FAILED') {
        alerts?.raise('PILOT_RESTORE_DRILL_FAILED', 'restore');
      } else if (typeof alerts?.resolve === 'function') {
        alerts.resolve('PILOT_RESTORE_DRILL_FAILED', 'restore');
      }
      return publicRestoreDrill(row);
    });
  }

  async function recordRestoreDrillFailure(input: RestoreFailureInput): Promise<LinkedRestoreFailure | UnlinkedRestoreFailure>;
  async function recordRestoreDrillFailure({
    transaction = null,
    backupId = null,
    restoreId,
    failureCode,
    completedAt = now(),
  }: Partial<RestoreFailureInput> = {}): Promise<LinkedRestoreFailure | UnlinkedRestoreFailure> {
    const normalizedRestoreId = opaqueId(restoreId, 'restoreId is invalid.', 'restore-');
    const normalizedFailureCode = safeErrorCode(failureCode, 'failureCode is invalid.');
    const normalizedCompletedAt = iso(completedAt, 'completedAt is invalid.');
    if (backupId !== null) {
      return recordRestoreDrill({
        transaction,
        backupId,
        restoreId: normalizedRestoreId,
        verifiedObjectCount: 0,
        status: 'FAILED',
        failureCode: normalizedFailureCode,
        completedAt: normalizedCompletedAt,
      } as RestoreInput) as Promise<LinkedRestoreFailure>; // The call fixes status to FAILED after validating failureCode.
    }
    return executeInTransaction(pool as PostgresPool, transaction, async (database) => {
      await insertAuditEvent(database, {
        eventKey: `restore:${normalizedRestoreId}`,
        eventType: 'backup.restore_drill_failed',
        metadata: {
          restore_id: normalizedRestoreId,
          result: 'FAILED',
          failure_code: normalizedFailureCode,
        },
        occurredAt: normalizedCompletedAt,
      });
      alerts?.raise('PILOT_RESTORE_DRILL_FAILED', 'restore');
      return Object.freeze({
        backup_id: null,
        restore_id: normalizedRestoreId,
        status: 'FAILED',
        verified_object_count: 0,
        failure_code: normalizedFailureCode,
        completed_at: normalizedCompletedAt,
      });
    });
  }

  async function assessBackupFreshness(input: TransactionInput & { maximumAgeMs: number }): Promise<FreshnessResult>;
  async function assessBackupFreshness({ transaction = null, maximumAgeMs }: TransactionInput & { maximumAgeMs?: number } = {}): Promise<FreshnessResult> {
    if (!Number.isSafeInteger(maximumAgeMs) || (maximumAgeMs as number) < 1) {
      throw new TypeError('maximumAgeMs must be a positive safe integer.');
    }
    const checkedAt = iso(now(), 'Backup freshness time is invalid.');
    const database = suppliedTransaction(transaction) ?? (pool as PostgresPool);
    const latest = await database.query<{ created_at: string }>(
      `SELECT created_at
         FROM operations.backup_checkpoint
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    );
    const latestAt = latest.rowCount === 1
      ? iso((latest.rows[0] as { created_at: string }).created_at, 'Stored backup time is invalid.')
      : null;
    const fresh = latestAt !== null
      && BigInt(shanghaiLocalToEpochMs(checkedAt)) - BigInt(shanghaiLocalToEpochMs(latestAt)) <= BigInt(maximumAgeMs as number);
    if (fresh) {
      if (typeof alerts?.resolve === 'function') {
        alerts.resolve('PILOT_BACKUP_STALE', 'backup');
      }
    } else {
      alerts?.raise('PILOT_BACKUP_STALE', 'backup');
    }
    return Object.freeze({
      fresh,
      code: fresh ? null : 'PILOT_BACKUP_STALE',
      latest_checkpoint_at: latestAt,
    });
  }

  async function listAuditEvents(input: TransactionInput & { actorId: string; limit?: number }): Promise<AuditResult>;
  async function listAuditEvents({ transaction = null, actorId, limit = 50 }: TransactionInput & { actorId?: string; limit?: number } = {}): Promise<AuditResult> {
    const normalizedActorId = uuid(actorId, 'actorId is invalid.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be an integer from 1 through 100.');
    }
    const supplied = suppliedTransaction(transaction);
    return executeInTransaction(pool as PostgresPool, supplied, async (activeTransaction) => {
      const authorized = await activeTransaction.query(
        `SELECT principal.id
           FROM pilot_ticket.pilot_principal AS principal
           JOIN pilot_ticket.pilot_principal_role AS role ON role.principal_id = principal.id
          WHERE principal.id = $1::uuid
            AND principal.is_active
            AND role.role = 'ADMIN'
          FOR SHARE OF principal, role`,
        [normalizedActorId],
      );
      if (authorized.rowCount !== 1) {
        return Object.freeze({ ok: false, error: Object.freeze({ code: 'FORBIDDEN', retryable: false }) });
      }
      await insertAuditEvent(activeTransaction, {
        eventKey: `audit-access:${normalizedActorId}:${randomUUID()}`,
        eventType: 'audit.accessed',
        actorId: normalizedActorId,
        metadata: { query_limit: limit, result: 'SUCCEEDED' },
        occurredAt: now(),
      });
      const selected = await activeTransaction.query<AuditRow>(
        `SELECT id::text, event_type, trace_id, subject_hash, metadata, occurred_at
           FROM operations.audit_event
          ORDER BY occurred_at DESC, id DESC
          LIMIT $1`,
        [limit],
      );
      return Object.freeze({
        ok: true,
        items: Object.freeze(selected.rows.map((row) => Object.freeze({
          id: row.id,
          event_type: row.event_type,
          trace_id: row.trace_id,
          subject_hash: row.subject_hash,
          metadata: row.metadata,
          occurred_at: iso(row.occurred_at, 'Stored audit time is invalid.'),
        }))),
      });
    });
  }

  return Object.freeze({
    recordBackupCheckpoint,
    recordRestoreDrill,
    recordRestoreDrillFailure,
    assessBackupFreshness,
    listAuditEvents,
  });
}
