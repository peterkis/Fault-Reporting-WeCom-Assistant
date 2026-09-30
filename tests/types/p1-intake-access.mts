import { adaptWeComSdkFrame } from '../../src/p1-002-wecom-sdk-adapter.mjs';
import { createChannelMessageInbox } from '../../src/p1-003-channel-message-inbox.mjs';
import type { PostgresPool } from '../../src/platform/postgres-pool.mjs';
import { assertEpochMsString, assertLocalDateTime } from '../../src/platform/time-contract.mjs';

declare const pool: PostgresPool;
declare const frame: unknown;
const clock = assertEpochMsString('1790733600000');
const local = assertLocalDateTime('2026-09-30 10:00:00');
const adapted = adaptWeComSdkFrame(frame, { receivedEpochMs: clock });
if (adapted.ok) {
  createChannelMessageInbox({ pool }).accept({ message: adapted.message, traceId: 'synthetic', privacyClass: 'INTERNAL', retentionUntil: local }, async () => ({}));
  const schema: 1 = adapted.message.schema_version;
  void schema;
} else {
  const retry: false = adapted.error.retryable;
  // @ts-expect-error -- Failure responses do not contain normalized messages.
  adapted.message;
  void retry;
}
// @ts-expect-error -- Physical epoch milliseconds are string values, not numbers.
adaptWeComSdkFrame(frame, { receivedEpochMs: 1790733600000 });

import { createServiceIntakeProcessor } from '../../src/p1-004-service-intake.mjs';
import { createPilotTicketCore, createPilotTicketProcessor } from '../../src/p1-005-pilot-ticket-core.mjs';
import type { PostgresTransaction } from '../../src/platform/postgres-pool.mjs';
import type { PostgresPoolClient } from '../../src/platform/postgres-pool.mjs';
import type { InboxMessage } from '../../src/p1-003-channel-message-inbox.mjs';
declare const transaction: PostgresTransaction;
declare const client: PostgresPoolClient;
declare const message: InboxMessage;
const intakeProcessor = createServiceIntakeProcessor({ existingIntakeSelector: async () => ({ id: null, explicitBoundary: true, boundaryReason: 'EXPLICIT_USER_NEW_TOPIC' }) });
const intake = await intakeProcessor({ channelMessageId: '9007199254740993', message, transaction });
intakeProcessor({ channelMessageId: '1', message, transaction: client });
const aggregate: 'CREATED' | 'APPENDED' = intake.aggregation.action;
void aggregate;
// @ts-expect-error -- A durable channel message identifier is a string.
intakeProcessor({ channelMessageId: 1, message, transaction });
// @ts-expect-error -- An owning Pool can dispatch queries across connections; the Inbox provides a transaction client.
intakeProcessor({ channelMessageId: '1', message, transaction: pool });
// @ts-expect-error -- A selector has an explicit nullable identifier; undefined is not a boundary.
createServiceIntakeProcessor({ existingIntakeSelector: async () => ({ id: undefined }) });
const ticketProcessor = createPilotTicketProcessor({ serviceIntakeProcessor: intakeProcessor, ticketCore: createPilotTicketCore({ pool }) });
ticketProcessor({ channelMessageId: '1', message, transaction });
// @ts-expect-error -- Ticket composition preserves the transaction capability required by Intake.
ticketProcessor({ channelMessageId: '1', message, transaction: pool });
// @ts-expect-error -- The composed processor preserves the Intake's required durable message id.
ticketProcessor({ message, transaction });
// @ts-expect-error -- The composed processor preserves the normalized message contract.
ticketProcessor({ channelMessageId: '1', message: { idempotency_key: 'key', received_at: local }, transaction });

import { createTicketClosureService, createTicketLifecycleProcessor } from '../../src/p1-010-ticket-closure.mjs';
import { createPilotOperationalIntake } from '../../src/p1-011-pilot-operations-baseline.mjs';
declare const closure: ReturnType<typeof createTicketClosureService>;
const lifecycle = createTicketLifecycleProcessor({ serviceIntakeProcessor: intakeProcessor, ticketCore: createPilotTicketCore({ pool }), closure });
createChannelMessageInbox({ pool }).accept({}, lifecycle);
lifecycle({ channelMessageId: '1', message, transaction });
// @ts-expect-error -- Lifecycle must preserve Intake's restriction against an owning Pool.
lifecycle({ channelMessageId: '1', message, transaction: pool });
// @ts-expect-error -- The lifecycle also preserves the normalized message required by Intake.
lifecycle({ channelMessageId: '1', message: { idempotency_key: 'key', received_at: local, sender_user_id: 'synthetic' }, transaction });
createPilotOperationalIntake({ pool, serviceIntakeProcessor: intakeProcessor, ticketCore: createPilotTicketCore({ pool }), closure, identityHashKey: 'synthetic', writeLogRecord() {}, coreChecks: { postgres: () => ({ ok: true }), intake: () => ({ ok: true }), outbox: () => ({ ok: true }) } });

import { createPilotAccessService, createPilotWorkbenchServer, listenPilotWorkbenchServer, closePilotWorkbenchServer } from '../../src/p1-009-pilot-access-workbench.mjs';
import { createTicketActionService } from '../../src/p1-006-ticket-state-actions.mjs';
import type { PilotHttpActionInput, PilotHttpActionPort } from '../../src/p1-009-pilot-access-workbench.mjs';
import type { TicketAction, TicketActionResult } from '../../src/p1-006-ticket-state-actions.mjs';
const numberVersionOnly = {
  async perform(input: PilotHttpActionInput & { expectedVersion: number }): Promise<TicketActionResult> {
    input.expectedVersion.toFixed(0);
    return { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } };
  },
};
// @ts-expect-error -- HTTP must reject an implementation that requires an already validated numeric version.
const rejectsNumberVersionOnly: PilotHttpActionPort = numberVersionOnly;
void rejectsNumberVersionOnly;
const stringNoteOnly = {
  async perform(input: PilotHttpActionInput & { note: string }): Promise<TicketActionResult> {
    input.note.trim();
    return { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } };
  },
};
const knownActionOnly = {
  async perform(input: PilotHttpActionInput & { action: TicketAction }): Promise<TicketActionResult> {
    const action: TicketAction = input.action;
    void action;
    return { ok: false, error: { code: 'INVALID_STATE_TRANSITION', retryable: false } };
  },
};
// @ts-expect-error -- A raw note may be absent, null, or non-text; a text-only implementation is unsafe.
const rejectsStringNoteOnly: PilotHttpActionPort = stringNoteOnly;
// @ts-expect-error -- Route text has not been validated as a Ticket Action.
const rejectsKnownActionOnly: PilotHttpActionPort = knownActionOnly;
// @ts-expect-error -- The HTTP factory must reject the same numeric-version implementation as the public port.
createPilotWorkbenchServer({ actions: numberVersionOnly });
// @ts-expect-error -- The HTTP factory must reject a text-only note implementation.
createPilotWorkbenchServer({ actions: stringNoteOnly });
// @ts-expect-error -- The HTTP factory must reject an implementation requiring a valid Action enum.
createPilotWorkbenchServer({ actions: knownActionOnly });
void [rejectsStringNoteOnly, rejectsKnownActionOnly];
const access = createPilotAccessService({ pool });
const actions = createTicketActionService({ pool, authorize: access.authorizeAction });
// @ts-expect-error -- Internal domain commands retain their numeric expected-version contract.
actions.perform({ ticketId: 'synthetic', action: 'accept', actor: { type: 'PILOT_USER', id: 'synthetic' }, expectedVersion: '1', traceId: 'synthetic' });
// @ts-expect-error -- Internal domain commands cannot use arbitrary HTTP route text.
actions.perform({ ticketId: 'synthetic', action: 'unrecognized', actor: { type: 'PILOT_USER', id: 'synthetic' }, expectedVersion: 1, traceId: 'synthetic' });
// @ts-expect-error -- The typed domain entry is narrower than the raw HTTP boundary.
const rejectsDomainEntry: PilotHttpActionPort = actions;
// @ts-expect-error -- The HTTP factory requires explicit wiring to the raw service entry.
createPilotWorkbenchServer({ actions });
actions.performRaw(frame);
void rejectsDomainEntry;
const principal = await access.upsertPrincipal({ wecomUserId: 'synthetic', displayName: 'Synthetic', roles: ['HANDLER'], resolverTeamIds: ['PILOT_IT'] });
const role: 'REPORTER' | 'HANDLER' | 'DISPATCHER' | 'ADMIN' | undefined = principal.roles[0];
void role;
// @ts-expect-error -- Pilot roles do not include an arbitrary external role.
access.upsertPrincipal({ wecomUserId: 'synthetic', displayName: 'Synthetic', roles: ['OWNER'] });
// @ts-expect-error -- Workbench principals use string identifiers.
access.getTicketView({ ticketId: 'synthetic', actorId: 1 });
const view = await access.getTicketView({ ticketId: 'synthetic', actorId: 'synthetic' });
if (!view.ok) {
  const code: 'FORBIDDEN' = view.error.code;
  // @ts-expect-error -- Forbidden responses contain no ticket.
  view.ticket;
  void code;
}
const rawActions: PilotHttpActionPort = { perform: actions.performRaw };
const server = createPilotWorkbenchServer({ access, actions: rawActions, authenticate: async () => ({ type: 'PILOT_USER', id: 'synthetic' }) });
await listenPilotWorkbenchServer(server, { host: '127.0.0.1', port: 0 });
await closePilotWorkbenchServer(server);
// @ts-expect-error -- The authenticator must provide an actor rather than a bare identifier.
createPilotWorkbenchServer({ access, actions: rawActions, authenticate: async () => 'synthetic' });
createPilotWorkbenchServer({ access, authenticate: async () => ({ type: 'PILOT_USER', id: 'synthetic' }), actions: {
  async perform(input) {
    // @ts-expect-error -- HTTP request fields remain unknown until Action validation.
    const version: number = input.expectedVersion;
    // @ts-expect-error -- Contextual notes are also unvalidated HTTP input.
    const note: string = input.note;
    // @ts-expect-error -- HTTP route text is not yet a validated Ticket Action.
    const action: import('../../src/p1-006-ticket-state-actions.mjs').TicketAction = input.action;
    void [version, note, action];
    return { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } };
  },
} });
