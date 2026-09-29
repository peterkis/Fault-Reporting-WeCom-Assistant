import { createCoreIntakeSafetyBoundary, createPilotAlertRegistry, createPilotSecurityLogger, createPilotOperationsService, createPilotOperationalIntake, createPilotTelemetry } from '../../src/p1-011-pilot-operations-baseline.mjs';
import type { PostgresPool, PostgresTransaction } from '../../src/platform/postgres-pool.mjs';
declare const pool: PostgresPool;
declare const transaction: PostgresTransaction;
const boundary = createCoreIntakeSafetyBoundary({ acceptCore: (input: { id: string }) => ({ id: input.id }), optionalEnhancements: { ai: core => ({ ok: core.id.length > 0 }) } });
const result = await boundary.accept({ id: 'synthetic' });
const id: string = result.core.id;
// @ts-expect-error -- Core input must preserve the actual callback parameter.
boundary.accept({ id: 42 });
// @ts-expect-error -- Unknown dependency names are not an enhancement port.
createCoreIntakeSafetyBoundary({ acceptCore: () => 1, optionalEnhancements: { unknown: () => ({ ok: true }) } });
const alerts = createPilotAlertRegistry();
alerts.raise('PILOT_BACKUP_STALE', 'backup');
// @ts-expect-error -- Invalid alert codes must not pass the typed boundary.
alerts.raise('UNKNOWN', 'backup');
const logger = createPilotSecurityLogger({ identityHashKey: 'synthetic' });
const log = logger.record({ event: 'test.event', traceId: 'trace', msgId: 'message', status: 'ok', errorCode: 'NONE', durationMs: 0 });
// @ts-expect-error -- Structured records are frozen.
log.status = 'changed';
// @ts-expect-error -- Duration is a number, not a numeric string.
logger.record({ event: 'test.event', traceId: 'trace', msgId: 'message', status: 'ok', errorCode: 'NONE', durationMs: '0' });
const telemetry = createPilotTelemetry();
// @ts-expect-error -- Metrics are allowlisted.
telemetry.increment('other');
const operations = createPilotOperationsService({ pool });
const audit = await operations.listAuditEvents({ transaction, actorId: 'synthetic' });
if (audit.ok) { const count: number = audit.items.length; void count; } else { const code: 'FORBIDDEN' = audit.error.code; void code; }
// @ts-expect-error -- A query-only transaction cannot acquire a connection.
transaction.connect();
// @ts-expect-error -- A transaction is not an owning pool.
createPilotOperationsService({ pool: transaction });
const failed = await operations.recordRestoreDrillFailure({ transaction, restoreId: 'restore-test', failureCode: 'FAILED' });
const backup: string | null = failed.backup_id;
// @ts-expect-error -- Nullable backup identifiers cannot be treated as always present.
const requiredBackup: string = failed.backup_id;
void [id, backup, requiredBackup];

import { createChannelMessageInbox } from '../../src/p1-003-channel-message-inbox.mjs';
import { createTicketLifecycleProcessor } from '../../src/p1-010-ticket-closure.mjs';
declare const lifecycleOptions: NonNullable<Parameters<typeof createTicketLifecycleProcessor>[0]>;
createChannelMessageInbox({ pool }).accept({}, createTicketLifecycleProcessor(lifecycleOptions));

const operational = createPilotOperationalIntake({ ...lifecycleOptions, pool, coreChecks: { postgres: () => ({ ok: true }), intake: () => ({ ok: true }), outbox: () => ({ ok: true }) }, identityHashKey: 'synthetic', writeLogRecord() {} });
operational.telemetry.snapshot();
operational.alerts.snapshot();
