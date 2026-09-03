import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import { createTicketLifecycleProcessor } from './p1-010-ticket-closure.mjs';

const MIGRATION_URL = new URL('../database/migrations/009_p1_011_pilot_operations_baseline.sql', import.meta.url);

const EVENT_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const STATUS_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;

const REDACTION_ORDER = Object.freeze([
  'SECRET_FIELD',
  'PATIENT_SENSITIVE_FIELD',
  'MEDIA_REFERENCE_FIELD',
]);
const REQUIRED_CORE_DEPENDENCIES = Object.freeze(['postgres', 'intake', 'outbox']);
const OPTIONAL_DEPENDENCIES = new Set(['redis', 'ai', 'ocr', 'object_storage']);
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
  PILOT_CORE_UNAVAILABLE: Object.freeze({ severity: 'P1', scopes: new Set(REQUIRED_CORE_DEPENDENCIES) }),
  PILOT_OPTIONAL_DEPENDENCY_DEGRADED: Object.freeze({ severity: 'P2', scopes: OPTIONAL_DEPENDENCIES }),
  PILOT_SENSITIVE_LOG_REJECTED: Object.freeze({ severity: 'P1', scopes: new Set(REDACTION_ORDER) }),
  PILOT_SECURITY_LOG_WRITE_FAILED: Object.freeze({ severity: 'P1', scopes: new Set(['log']) }),
  PILOT_BACKUP_STALE: Object.freeze({ severity: 'P1', scopes: new Set(['backup']) }),
  PILOT_RESTORE_DRILL_FAILED: Object.freeze({ severity: 'P1', scopes: new Set(['restore']) }),
});
const METRIC_LABELS = Object.freeze({
  pilot_core_readiness: Object.freeze([]),
  pilot_optional_dependency_degraded_total: Object.freeze(['dependency']),
});

function nonEmpty(value, message, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredIdentifier(value, message) {
  const identifier = nonEmpty(value, message, 128);
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new TypeError(message);
  }
  return identifier;
}

function classifyDetailKey(key) {
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

function collectRedactionCodes(value, codes = new Set()) {
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

function hashIdentifier(identityHashKey, value) {
  return `hmac-sha256:${createHmac('sha256', identityHashKey).update(value).digest('hex').slice(0, 24)}`;
}

/**
 * Creates the P1 structured-log boundary. It never writes free text or media
 * references: callers may provide them only in `details`, which is inspected
 * for redaction telemetry and then discarded.
 */
function validateAlertRegistry(alerts) {
  if (alerts !== null && (!alerts || typeof alerts.raise !== 'function')) {
    throw new TypeError('alerts must expose raise when supplied.');
  }
}

/**
 * In-memory alert state is intentionally limited to fixed code and scope
 * combinations. It cannot accept a person, URL, credential, or free-text
 * value as an alert dimension.
 */
export function createPilotAlertRegistry({ now = () => new Date() } = {}) {
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }
  const active = new Map();

  function key(code, scope) {
    const rule = ALERT_RULES[code];
    if (!rule || !rule.scopes.has(scope)) {
      throw new TypeError('Alert code or scope is not allowlisted.');
    }
    return `${code}\u0000${scope}`;
  }

  function raise(code, scope) {
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
      status: 'ACTIVE',
      opened_at: iso(now(), 'Alert time is invalid.'),
    });
    active.set(identity, alert);
    return alert;
  }

  function resolve(code, scope) {
    active.delete(key(code, scope));
  }

  function snapshot() {
    return [...active.values()].sort((left, right) => `${left.code}\u0000${left.scope}`
      .localeCompare(`${right.code}\u0000${right.scope}`));
  }

  return Object.freeze({ raise, resolve, snapshot });
}

export function createPilotSecurityLogger({ identityHashKey, writeRecord = () => {}, alerts = null } = {}) {
  nonEmpty(identityHashKey, 'A log identity hash key is required.', 4_096);
  if (typeof writeRecord !== 'function') {
    throw new TypeError('writeRecord must be a function.');
  }
  validateAlertRegistry(alerts);

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
  } = {}) {
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
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 86_400_000) {
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
      ...(actorId === null ? {} : { actor_hash: hashIdentifier(identityHashKey, String(actorId)) }),
      ...(chatId === null ? {} : { chat_hash: hashIdentifier(identityHashKey, String(chatId)) }),
      status: normalizedStatus,
      error_code: normalizedErrorCode,
      duration_ms: durationMs,
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

function sortedLabels(labels) {
  return Object.fromEntries(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)));
}

function metricIdentity(name, labels) {
  return `${name}\u0000${JSON.stringify(sortedLabels(labels))}`;
}

function validateMetric(name, labels) {
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
  const values = new Map();

  function increment(name, labels = {}, amount = 1) {
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new TypeError('Metric increment must be a positive integer.');
    }
    const normalizedLabels = validateMetric(name, labels);
    const identity = metricIdentity(name, normalizedLabels);
    const current = values.get(identity) ?? { name, labels: normalizedLabels, value: 0 };
    values.set(identity, { ...current, value: current.value + amount });
  }

  function setGauge(name, labels = {}, value) {
    if (!Number.isFinite(value) || value < 0) {
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

function validateChecks(checks, expected, label) {
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const dependency of expected) {
    if (typeof checks[dependency] !== 'function') {
      throw new TypeError(`${label}.${dependency} must be a function.`);
    }
  }
}

function validateOptionalChecks(checks, label) {
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const [dependency, check] of Object.entries(checks)) {
    if (!OPTIONAL_DEPENDENCIES.has(dependency) || typeof check !== 'function') {
      throw new TypeError(`${label} contains an invalid dependency.`);
    }
  }
}

async function probe(check) {
  try {
    return (await check())?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Separates P1 admission dependencies from optional P2/operational ones.
 * Stable codes deliberately replace raw probe errors in every result.
 */
export function createPilotReadinessService({
  coreChecks,
  optionalChecks = {},
  telemetry = createPilotTelemetry(),
  alerts = null,
} = {}) {
  validateChecks(coreChecks, REQUIRED_CORE_DEPENDENCIES, 'coreChecks');
  validateOptionalChecks(optionalChecks, 'optionalChecks');
  if (!telemetry || typeof telemetry.increment !== 'function' || typeof telemetry.setGauge !== 'function') {
    throw new TypeError('A Pilot telemetry service is required.');
  }
  validateAlertRegistry(alerts);

  async function assess() {
    const coreFailures = [];
    for (const dependency of REQUIRED_CORE_DEPENDENCIES) {
      if (!(await probe(coreChecks[dependency]))) {
        coreFailures.push(dependency);
        alerts?.raise('PILOT_CORE_UNAVAILABLE', dependency);
      } else if (typeof alerts?.resolve === 'function') {
        alerts.resolve('PILOT_CORE_UNAVAILABLE', dependency);
      }
    }
    const degradedDependencies = [];
    for (const dependency of Object.keys(optionalChecks).sort()) {
      if (!(await probe(optionalChecks[dependency]))) {
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
export function createCoreIntakeSafetyBoundary({
  acceptCore,
  optionalEnhancements = {},
  telemetry = createPilotTelemetry(),
  alerts = null,
} = {}) {
  if (typeof acceptCore !== 'function') {
    throw new TypeError('acceptCore must be a function.');
  }
  validateOptionalChecks(optionalEnhancements, 'optionalEnhancements');
  if (!telemetry || typeof telemetry.increment !== 'function') {
    throw new TypeError('A Pilot telemetry service is required.');
  }
  validateAlertRegistry(alerts);

  async function accept(input) {
    const core = await acceptCore(input);
    const degradedDependencies = [];
    for (const dependency of Object.keys(optionalEnhancements).sort()) {
      if (!(await probe(() => optionalEnhancements[dependency](core)))) {
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

function logCorrelationId(prefix, value) {
  const source = typeof value === 'string' ? value : 'missing';
  return `${prefix}-${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function logSubject(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function safeResultCode(result) {
  const candidate = result?.error?.code;
  return typeof candidate === 'string' && ERROR_CODE_PATTERN.test(candidate)
    ? candidate
    : 'P1_011_INTAKE_REJECTED';
}

function setSecurityLogWriteAlert(alerts, succeeded) {
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

function dispatchSecurityLogRecord(writeLogRecord, record, alerts) {
  try {
    const outcome = writeLogRecord(record);
    if (outcome && typeof outcome.then === 'function') {
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
} = {}) {
  if (typeof writeLogRecord !== 'function') {
    throw new TypeError('writeLogRecord must be a function.');
  }
  const inbox = createChannelMessageInbox({ pool });
  const lifecycle = createTicketLifecycleProcessor({
    serviceIntakeProcessor,
    ticketCore,
    closure,
  });
  const readiness = createPilotReadinessService({
    coreChecks,
    optionalChecks,
    telemetry,
    alerts,
  });
  const logger = createPilotSecurityLogger({
    identityHashKey,
    writeRecord(record) {
      dispatchSecurityLogRecord(writeLogRecord, record, alerts);
    },
    alerts,
  });
  const boundary = createCoreIntakeSafetyBoundary({
    acceptCore: async (request) => {
      const startedAt = Date.now();
      const result = await inbox.accept(request, lifecycle);
      const message = request?.message;
      logger.record({
        event: result.ok ? 'pilot.intake.accepted' : 'pilot.intake.rejected',
        traceId: logCorrelationId('trace', request?.traceId),
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
    accept: async (request) => {
      await readiness.assess();
      return (await boundary.accept(request)).core;
    },
    assessReadiness: readiness.assess,
    telemetry,
    alerts,
  });
}

function iso(value, message) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(message);
  }
  return date.toISOString();
}

function opaqueId(value, message, prefix) {
  const identifier = nonEmpty(value, message, 128);
  if (!new RegExp(`^${prefix}[A-Za-z0-9-]{1,120}$`, 'u').test(identifier)) {
    throw new TypeError(message);
  }
  return identifier;
}

function uuid(value, message) {
  const identifier = nonEmpty(value, message, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identifier)) {
    throw new TypeError(message);
  }
  return identifier;
}

function sha256(value, message) {
  const hash = nonEmpty(value, message, 64);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new TypeError(message);
  }
  return hash;
}

function safeErrorCode(value, message) {
  const code = nonEmpty(value, message, 128);
  if (!ERROR_CODE_PATTERN.test(code)) {
    throw new TypeError(message);
  }
  return code;
}

function hashOperationalSubject(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function safeAuditMetadata(metadata) {
  if (!isRecord(metadata)) {
    throw new TypeError('Audit metadata must be an object.');
  }
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    switch (key) {
      case 'backup_id':
        safe.backup_id = opaqueId(value, 'backup_id is invalid.', 'backup-');
        break;
      case 'checksum_sha256':
        safe.checksum_sha256 = sha256(value, 'checksum_sha256 is invalid.');
        break;
      case 'size_bytes':
        if (!Number.isSafeInteger(value) || value < 1) {
          throw new TypeError(`${key} is invalid.`);
        }
        safe[key] = value;
        break;
      case 'verified_object_count':
      case 'query_limit':
        if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
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
        if (!['SUCCEEDED', 'FAILED', 'DEGRADED', 'READY'].includes(value)) {
          throw new TypeError('result is invalid.');
        }
        safe.result = value;
        break;
      case 'failure_code':
        safe.failure_code = safeErrorCode(value, 'failure_code is invalid.');
        break;
      case 'dependency':
        if (!OPTIONAL_DEPENDENCIES.has(value) && !REQUIRED_CORE_DEPENDENCIES.includes(value)) {
          throw new TypeError('dependency is invalid.');
        }
        safe.dependency = value;
        break;
      case 'redaction_code':
        if (!REDACTION_ORDER.includes(value)) {
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

async function withTransaction(pool, operation) {
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

function suppliedTransaction(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value.query !== 'function') {
    throw new TypeError('transaction must expose query when supplied.');
  }
  return value;
}

async function executeInTransaction(pool, transaction, operation) {
  const supplied = suppliedTransaction(transaction);
  return supplied === null ? withTransaction(pool, operation) : operation(supplied);
}

async function insertAuditEvent(transaction, {
  eventKey,
  eventType,
  actorId = null,
  traceId = null,
  subjectHash = null,
  metadata = {},
  occurredAt = new Date(),
} = {}) {
  const key = nonEmpty(eventKey, 'eventKey is required.', 256);
  if (!/^[a-z][a-z0-9:._-]{1,255}$/u.test(key)) {
    throw new TypeError('eventKey is invalid.');
  }
  if (!AUDIT_EVENT_TYPES.has(eventType)) {
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

function publicBackupCheckpoint(row) {
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

function publicRestoreDrill(row) {
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

export async function applyPilotOperationsMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

/**
 * The durable P1 operations boundary. It stores only backup and recovery
 * metadata, never dump paths, database URLs, credentials, patient text, or
 * media references.
 */
export function createPilotOperationsService({ pool, now = () => new Date(), alerts = null } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }
  validateAlertRegistry(alerts);

  async function recordBackupCheckpoint({
    transaction = null,
    backupId,
    checksumSha256,
    sizeBytes,
    encryptionKeyId,
    retentionUntil,
    occurredAt = now(),
  } = {}) {
    const normalizedBackupId = opaqueId(backupId, 'backupId is invalid.', 'backup-');
    const normalizedChecksum = sha256(checksumSha256, 'checksumSha256 is invalid.');
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > Number.MAX_SAFE_INTEGER) {
      throw new TypeError('sizeBytes is invalid.');
    }
    const normalizedKeyId = requiredIdentifier(encryptionKeyId, 'encryptionKeyId is invalid.');
    const normalizedRetention = iso(retentionUntil, 'retentionUntil is invalid.');
    const normalizedOccurredAt = iso(occurredAt, 'occurredAt is invalid.');
    if (Date.parse(normalizedRetention) <= Date.parse(normalizedOccurredAt)) {
      throw new TypeError('retentionUntil must be after occurredAt.');
    }

    return executeInTransaction(pool, transaction, async (database) => {
      const inserted = await database.query(
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
      const selected = inserted.rowCount === 1 ? inserted : await database.query(
        `SELECT id::text, backup_id, checksum_sha256, size_bytes, encryption_key_id, retention_until, created_at
           FROM operations.backup_checkpoint
          WHERE backup_id = $1`,
        [normalizedBackupId],
      );
      const row = selected.rows[0];
      if (
        row.checksum_sha256 !== normalizedChecksum
        || Number(row.size_bytes) !== sizeBytes
        || row.encryption_key_id !== normalizedKeyId
        || iso(row.retention_until, 'Stored backup retention is invalid.') !== normalizedRetention
      ) {
        const error = new Error('P1_011_BACKUP_CHECKPOINT_CONFLICT');
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
          retention_until: normalizedRetention,
          result: 'SUCCEEDED',
        },
        occurredAt: normalizedOccurredAt,
      });
      return publicBackupCheckpoint(row);
    });
  }

  async function recordRestoreDrill({
    transaction = null,
    backupId,
    restoreId,
    verifiedObjectCount,
    status = 'SUCCEEDED',
    failureCode = null,
    completedAt = now(),
  } = {}) {
    const normalizedBackupId = opaqueId(backupId, 'backupId is invalid.', 'backup-');
    const normalizedRestoreId = opaqueId(restoreId, 'restoreId is invalid.', 'restore-');
    if (!Number.isSafeInteger(verifiedObjectCount) || verifiedObjectCount < 0 || verifiedObjectCount > 1_000_000_000) {
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

    return executeInTransaction(pool, transaction, async (database) => {
      const backup = await database.query(
        'SELECT id::text, backup_id FROM operations.backup_checkpoint WHERE backup_id = $1',
        [normalizedBackupId],
      );
      if (backup.rowCount !== 1) {
        const error = new Error('P1_011_BACKUP_NOT_FOUND');
        error.code = 'P1_011_BACKUP_NOT_FOUND';
        throw error;
      }
      const inserted = await database.query(
        `INSERT INTO operations.restore_drill (
            restore_id, backup_checkpoint_id, status, verified_object_count, failure_code, completed_at
         ) VALUES ($1, $2::uuid, $3, $4, $5, $6::timestamp without time zone)
         ON CONFLICT (restore_id) DO NOTHING
         RETURNING id::text, restore_id, status, verified_object_count, failure_code, completed_at`,
        [
          normalizedRestoreId,
          backup.rows[0].id,
          status,
          verifiedObjectCount,
          normalizedFailureCode,
          normalizedCompletedAt,
        ],
      );
      const selected = inserted.rowCount === 1 ? inserted : await database.query(
        `SELECT restore.id::text, checkpoint.backup_id, restore.restore_id, restore.status,
                restore.verified_object_count, restore.failure_code, restore.completed_at
           FROM operations.restore_drill AS restore
           JOIN operations.backup_checkpoint AS checkpoint ON checkpoint.id = restore.backup_checkpoint_id
          WHERE restore.restore_id = $1`,
        [normalizedRestoreId],
      );
      const row = inserted.rowCount === 1
        ? { ...selected.rows[0], backup_id: normalizedBackupId }
        : selected.rows[0];
      if (
        row.backup_id !== normalizedBackupId
        || row.status !== status
        || Number(row.verified_object_count) !== verifiedObjectCount
        || row.failure_code !== normalizedFailureCode
      ) {
        const error = new Error('P1_011_RESTORE_DRILL_CONFLICT');
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

  async function recordRestoreDrillFailure({
    transaction = null,
    backupId = null,
    restoreId,
    failureCode,
    completedAt = now(),
  } = {}) {
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
      });
    }
    return executeInTransaction(pool, transaction, async (database) => {
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

  async function assessBackupFreshness({ transaction = null, maximumAgeMs } = {}) {
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 1) {
      throw new TypeError('maximumAgeMs must be a positive safe integer.');
    }
    const checkedAt = iso(now(), 'Backup freshness time is invalid.');
    const database = suppliedTransaction(transaction) ?? pool;
    const latest = await database.query(
      `SELECT created_at
         FROM operations.backup_checkpoint
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    );
    const latestAt = latest.rowCount === 1
      ? iso(latest.rows[0].created_at, 'Stored backup time is invalid.')
      : null;
    const fresh = latestAt !== null
      && Date.parse(checkedAt) - Date.parse(latestAt) <= maximumAgeMs;
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

  async function listAuditEvents({ transaction = null, actorId, limit = 50 } = {}) {
    const normalizedActorId = uuid(actorId, 'actorId is invalid.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be an integer from 1 through 100.');
    }
    const supplied = suppliedTransaction(transaction);
    return executeInTransaction(pool, supplied, async (activeTransaction) => {
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
      const selected = await activeTransaction.query(
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
