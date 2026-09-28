import type { LocalDateTime, PhysicalEpochMs } from '../../contracts/time_contracts.js';
import type { PostgresPoolClient } from '../../src/platform/postgres-pool.mjs';
import {
  createPilotTicketCore,
  createPilotTicketProcessor,
  isTicketStatus,
  type PilotTicketCreateResult,
  type PilotTicketInput,
  type PilotTicketRow,
  type PilotTicketCore,
  type ServiceIntakeProcessor,
  type PublicIntakeEvent,
  type PublicPilotTicket,
  type TicketPriority,
  type TicketStatus,
} from '../../src/p1-005-pilot-ticket-core.mjs';
import {
  createTicketActionService,
  type AssignmentMetadata,
  type PublicTicketEvent,
  type TicketAction,
  type TicketActionInput,
  type TicketActor,
  type TicketActionResult,
  type TicketActionService,
} from '../../src/p1-006-ticket-state-actions.mjs';
import {
  createNotificationDeliveryWorker,
  createNotificationOutbox,
  type NotificationChannel,
  type NotificationDeliveryWorkerOptions,
  type NotificationSender,
  type NotificationTarget,
} from '../../src/p1-007-notification-outbox.mjs';

declare const transaction: PostgresPoolClient;
declare const occurredAt: LocalDateTime;
declare const epochMs: PhysicalEpochMs;

const priority: TicketPriority = 'NORMAL';
const status: TicketStatus = isTicketStatus('QUEUED') ? 'QUEUED' : 'NEW';
const ticketInput: PilotTicketInput = {
  intakeId: 'intake-id',
  transaction,
  occurredAt,
  traceId: 'trace-id',
  title: null,
  resolverTeamId: 'PILOT_IT',
  priority,
};
const ticketCore = createPilotTicketCore({ defaultResolverTeamId: 'PILOT_IT' });
declare const serviceIntakeProcessor: ServiceIntakeProcessor;
declare const processorTicketCore: PilotTicketCore;
const processor = createPilotTicketProcessor({ serviceIntakeProcessor, ticketCore: processorTicketCore });
// @ts-expect-error -- The processor's mandatory Service Intake dependency cannot be omitted.
createPilotTicketProcessor({ ticketCore: processorTicketCore });
// @ts-expect-error -- The processor's mandatory Pilot Ticket Core dependency cannot be omitted.
createPilotTicketProcessor({ serviceIntakeProcessor });
const validAction: TicketAction = 'accept';
const actor: TicketActor = { type: 'PILOT_USER', id: 'operator-id' };
const actionInput: TicketActionInput = {
  ticketId: 'ticket-id',
  action: validAction,
  actor,
  expectedVersion: 1,
  note: null,
  externalVisible: false,
  reasonCode: null,
  attachmentIds: [],
  traceId: 'trace-id',
};
const assignment: AssignmentMetadata = {
  old_assignee_id: null,
  new_assignee_id: '00000000-0000-4000-8000-000000000000',
  old_team_id: 'PILOT_IT',
  new_team_id: 'PILOT_IT',
};
const actionService: TicketActionService = createTicketActionService({});
const channel: NotificationChannel = 'WECOM_DIRECT';
const target: NotificationTarget = { channel, targetKey: 'reporter-id' };
const outbox = createNotificationOutbox({
  targetsForEvent: async () => [target],
});
const worker = createNotificationDeliveryWorker({
  sender: async ({ channel: senderChannel, targetKey }) => ({
    ok: senderChannel === channel && targetKey === target.targetKey,
    providerMessageId: null,
  }),
  nowEpochMs: () => epochMs,
});
// @ts-expect-error -- A delivery worker must receive its mandatory sender dependency.
createNotificationDeliveryWorker({});

declare const ticketResult: PilotTicketCreateResult;
if (ticketResult.created) {
  const createdTicket: PublicPilotTicket = ticketResult.ticket;
  const createdEvent: PublicIntakeEvent = ticketResult.intakeEvent;
  void [createdTicket, createdEvent];
} else {
  const noEvent: null = ticketResult.intakeEvent;
  const maybeTicket: PublicPilotTicket | null = ticketResult.ticket;
  void [noEvent, maybeTicket];
}

declare const actionResult: TicketActionResult;
if (actionResult.ok) {
  const actionTicket: PublicPilotTicket = actionResult.ticket;
  const actionEvent: PublicTicketEvent = actionResult.event;
  void [actionTicket, actionEvent];
} else {
  const actionErrorCode: string = actionResult.error.code;
  const actionIsNotRetryable: false = actionResult.error.retryable;
  void [actionErrorCode, actionIsNotRetryable];
}

const typedTicketQuery = transaction.query<PilotTicketRow>('SELECT typed_ticket_row');
void typedTicketQuery.then(({ rows }) => {
  const row = rows[0];
  if (!row) return;
  const validVersion: number = row.version;
  const validTimestamp: string = row.created_at;
  // @ts-expect-error -- PostgreSQL row timestamps remain strings at this boundary.
  const timestampAsNumber: number = row.created_at;
  // @ts-expect-error -- PostgreSQL row version remains a number in the declared row contract.
  const versionAsString: string = row.version;
  // @ts-expect-error -- Nullable PostgreSQL columns must not be used as definite strings.
  const nullableAssignee: string = row.assignee_id;
  void [validVersion, validTimestamp, timestampAsNumber, versionAsString, nullableAssignee];
});

const unsafeSender: NotificationSender = async () => {
  const response: unknown = { ok: true, providerMessageId: 'provider-id' };
  // @ts-expect-error -- An unknown sender response must be narrowed before field access.
  const providerMessageId = response.providerMessageId;
  return { ok: true, providerMessageId };
};

const isAcceptedSenderResponse = (value: unknown): value is { ok: true; providerMessageId: string | null } => (
  typeof value === 'object'
  && value !== null
  && 'ok' in value
  && value.ok === true
  && ('providerMessageId' in value)
  && (typeof value.providerMessageId === 'string' || value.providerMessageId === null)
);
const guardedSender: NotificationSender = async () => {
  const response: unknown = { ok: true, providerMessageId: null };
  if (isAcceptedSenderResponse(response)) {
    const providerMessageId: string | null = response.providerMessageId;
    return { ok: response.ok, providerMessageId };
  }
  return { ok: false, code: 'WECOM_SEND_REJECTED' };
};
void [unsafeSender, guardedSender];

// @ts-expect-error -- Ticket priority is a closed domain union.
const invalidPriority: TicketPriority = 'CRITICAL';
// @ts-expect-error -- Ticket status cannot accept arbitrary strings.
const invalidStatus: TicketStatus = 'DONE';
// @ts-expect-error -- Action names are limited to the persisted transition table.
const invalidAction: TicketAction = 'finish';
// @ts-expect-error -- Only known operator types may create action facts.
const invalidActor: TicketActor = { type: 'ADMIN', id: 'operator-id' };
// @ts-expect-error -- expectedVersion remains an integer number, not a string.
const invalidActionInput: TicketActionInput = { ...actionInput, expectedVersion: '1' };
// @ts-expect-error -- Optional notes remain string-or-null and cannot accept numbers.
const invalidOptionalNote: TicketActionInput = { ...actionInput, note: 42 };
// @ts-expect-error -- Assignment metadata cannot omit one of its four audited fields.
const incompleteAssignment: AssignmentMetadata = { old_assignee_id: null, new_assignee_id: null, old_team_id: 'PILOT_IT' };
// @ts-expect-error -- Optional resolver team values cannot be explicitly undefined under exact optional typing.
const invalidOptionalResolverTeam: PilotTicketInput = { ...ticketInput, resolverTeamId: undefined };
// @ts-expect-error -- Notification channels are closed to the supported delivery paths.
const invalidChannel: NotificationChannel = 'EMAIL';
// @ts-expect-error -- A target must use a supported notification channel.
const invalidTarget: NotificationTarget = { channel: 'EMAIL', targetKey: 'reporter-id' };
// @ts-expect-error -- Epoch providers must return the branded non-negative epoch string.
createNotificationDeliveryWorker({ sender: async () => ({ ok: true }), nowEpochMs: () => 1 });
// @ts-expect-error -- The epoch option carries a branded string, never a number.
const invalidEpochOptions: NotificationDeliveryWorkerOptions = { sender: async () => ({ ok: true }), nowEpochMs: () => 1 };

void [status, ticketInput, ticketCore, processor, actionInput, assignment, actionService, outbox, worker,
  invalidPriority, invalidStatus, invalidAction, invalidActor, invalidActionInput,
  invalidOptionalNote, incompleteAssignment, invalidOptionalResolverTeam, invalidChannel, invalidTarget,
  invalidEpochOptions];
