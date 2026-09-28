import { readFile } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import type { LocalDateTime } from '../contracts/time_contracts.js';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import {
  EXTERNAL_TICKET_STATUS,
  isTicketStatus,
  publicPilotTicket,
} from './p1-005-pilot-ticket-core.mjs';
import type {
  PilotTicketRow,
  PublicPilotTicket,
  TicketStatus,
} from './p1-005-pilot-ticket-core.mjs';
import { assertLocalDateTime } from './platform/time-contract.mjs';
import { postgresTimestampToLocalDateTime } from './platform/postgres-types.mjs';
import type { PostgresPool, PostgresPoolClient } from './platform/postgres-pool.mjs';

const MIGRATION_URL = new URL('../database/migrations/004_p1_006_ticket_state_actions.sql', import.meta.url);
export type TicketAction =
  | 'queue'
  | 'accept'
  | 'start'
  | 'request-information'
  | 'resume'
  | 'wait-vendor'
  | 'resolve'
  | 'confirm'
  | 'reopen'
  | 'cancel'
  | 'auto-close'
  | 'add-note';
export type OperatorType = 'PILOT_USER' | 'REPORTER' | 'SYSTEM';
export type TicketEventType =
  | 'ticket.created'
  | 'ticket.queued'
  | 'ticket.accepted'
  | 'ticket.started'
  | 'ticket.waiting_requester'
  | 'ticket.waiting_vendor'
  | 'ticket.resumed'
  | 'ticket.resolved'
  | 'ticket.closed'
  | 'ticket.reopened'
  | 'ticket.cancelled'
  | 'ticket.duplicate_linked'
  | 'ticket.unlinked'
  | 'ticket.note_added'
  | 'ticket.information_added'
  | 'ticket.auto_close_reminder'
  | 'ticket.assignment_transferred';
export type TicketActionErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_STATE_TRANSITION'
  | 'FORBIDDEN'
  | 'TICKET_NOT_FOUND'
  | 'TICKET_VERSION_CONFLICT';

interface StatusTransition {
  from: readonly TicketStatus[];
  to: TicketStatus;
  eventType: TicketEventType;
  toCurrentStatus?: false;
}
interface SameStatusTransition {
  from: readonly TicketStatus[];
  toCurrentStatus: true;
  eventType: TicketEventType;
}
type TicketTransition = StatusTransition | SameStatusTransition;

const ACTIONS: Readonly<Record<TicketAction, TicketTransition>> = Object.freeze({
  queue: { from: ['NEW'], to: 'QUEUED', eventType: 'ticket.queued' },
  accept: { from: ['QUEUED'], to: 'ACCEPTED', eventType: 'ticket.accepted' },
  start: { from: ['ACCEPTED', 'REOPENED'], to: 'IN_PROGRESS', eventType: 'ticket.started' },
  'request-information': {
    from: ['IN_PROGRESS'],
    to: 'WAITING_REQUESTER',
    eventType: 'ticket.waiting_requester',
  },
  resume: {
    from: ['WAITING_REQUESTER', 'WAITING_VENDOR'],
    to: 'IN_PROGRESS',
    eventType: 'ticket.resumed',
  },
  'wait-vendor': { from: ['IN_PROGRESS'], to: 'WAITING_VENDOR', eventType: 'ticket.waiting_vendor' },
  resolve: { from: ['IN_PROGRESS'], to: 'RESOLVED', eventType: 'ticket.resolved' },
  confirm: { from: ['RESOLVED'], to: 'CLOSED', eventType: 'ticket.closed' },
  reopen: {
    from: ['RESOLVED', 'CLOSED'],
    to: 'REOPENED',
    eventType: 'ticket.reopened',
  },
  cancel: { from: ['QUEUED', 'ACCEPTED'], to: 'CANCELLED', eventType: 'ticket.cancelled' },
  'auto-close': { from: ['RESOLVED'], to: 'CLOSED', eventType: 'ticket.closed' },
  'add-note': {
    from: [
      'NEW', 'QUEUED', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_REQUESTER',
      'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'REOPENED',
    ],
    toCurrentStatus: true,
    eventType: 'ticket.note_added',
  },
});
const OPERATOR_TYPES = new Set<OperatorType>(['PILOT_USER', 'REPORTER', 'SYSTEM']);

class TicketActionError extends Error {
  declare code: TicketActionErrorCode;
  constructor(code: TicketActionErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface TicketActor {
  type: OperatorType;
  id: string | null;
}

export interface AssignmentMetadata {
  old_assignee_id: string | null;
  new_assignee_id: string;
  old_team_id: string;
  new_team_id: string;
}

export interface TicketActionInput {
  ticketId: string;
  action: TicketAction;
  actor: TicketActor;
  expectedVersion: number;
  note?: string | null;
  externalVisible?: boolean;
  reasonCode?: string | null;
  attachmentIds?: unknown[];
  traceId: string;
}

export interface TicketEventRow {
  event_id: string;
  event_type: TicketEventType;
  ticket_id: string;
  old_status: TicketStatus | null;
  new_status: TicketStatus;
  aggregate_version: number;
  event_ordinal: number;
  operator_type: OperatorType;
  operator_id: string | null;
  internal_note: string | null;
  external_note: string | null;
  reason_code: string | null;
  attachment_ids: unknown;
  trace_id: string;
  created_at: string;
}

export interface PublicTicketEvent {
  event_id: string;
  event_type: TicketEventType;
  ticket_id: string;
  old_status: TicketStatus | null;
  new_status: TicketStatus;
  aggregate_version: number;
  event_ordinal: number;
  operator_type: OperatorType;
  operator_id: string | null;
  external_note: string | null;
  reason_code: string | null;
  attachment_ids: unknown;
  trace_id: string;
  created_at: LocalDateTime;
}

export interface TicketActionSuccess {
  ok: true;
  ticket: PublicPilotTicket;
  event: PublicTicketEvent;
  side_effects: unknown;
}

export interface TicketActionFailure {
  ok: false;
  error: { code: TicketActionErrorCode; retryable: false };
}

export type TicketActionResult = TicketActionSuccess | TicketActionFailure;
export type TicketActionAuthorizeInput = {
  transaction: PostgresPoolClient;
  ticket: PublicPilotTicket;
  action: TicketAction;
  actor: TicketActor;
};
export type TicketActionAuthorizer = (input: TicketActionAuthorizeInput) => boolean | Promise<boolean>;
export type TicketActionAfterHook = (input: {
  transaction: PostgresPoolClient;
  ticket: PublicPilotTicket;
  event: PublicTicketEvent;
  action: TicketAction;
  actor: TicketActor;
}) => unknown | Promise<unknown>;

export interface TicketActionService {
  performInTransaction(input: TicketActionInput, transaction: PostgresPoolClient): Promise<TicketActionSuccess>;
  perform(input: TicketActionInput): Promise<TicketActionResult>;
}

export interface TicketActionServiceOptions {
  pool?: PostgresPool;
  authorize?: TicketActionAuthorizer | null;
  afterAction?: TicketActionAfterHook | null;
}

export interface TicketActionTransition {
  action: TicketAction;
  from: readonly TicketStatus[];
  to: TicketStatus | null;
  event_type: TicketEventType;
}

interface NormalizedTicketActionInput {
  ticketId: string;
  action: TicketAction;
  actor: TicketActor;
  expectedVersion: number;
  note: string | null;
  externalVisible: boolean;
  reasonCode: string | null;
  attachmentIds: unknown[];
  traceId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTicketAction(value: string): value is TicketAction {
  return Object.hasOwn(ACTIONS, value);
}

function isOperatorType(value: unknown): value is OperatorType {
  return typeof value === 'string' && OPERATOR_TYPES.has(value as OperatorType);
}

function iso(value: unknown): LocalDateTime {
  return postgresTimestampToLocalDateTime(value);
}

function nonEmpty(value: unknown, code: TicketActionErrorCode, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TicketActionError(code);
  }
  return value;
}

function nullableText(value: unknown, code: TicketActionErrorCode, maximum: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return nonEmpty(value, code, maximum);
}

function validateActionInput(input: unknown): NormalizedTicketActionInput {
  if (!isRecord(input)) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  const ticketId = nonEmpty(input.ticketId, 'VALIDATION_FAILED', 64);
  const actionValue = nonEmpty(input.action, 'VALIDATION_FAILED', 64);
  if (!isTicketAction(actionValue)) {
    throw new TicketActionError('INVALID_STATE_TRANSITION');
  }
  if (!isRecord(input.actor) || !isOperatorType(input.actor.type)) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  if (actionValue === 'auto-close' && input.actor.type !== 'SYSTEM') {
    throw new TicketActionError('FORBIDDEN');
  }
  const operatorId = input.actor.id === null || input.actor.id === undefined
    ? null
    : nonEmpty(String(input.actor.id), 'VALIDATION_FAILED', 128);
  if (input.actor.type !== 'SYSTEM' && operatorId === null) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  if (typeof input.expectedVersion !== 'number'
    || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  const traceId = nonEmpty(input.traceId, 'VALIDATION_FAILED', 128);
  if (input.externalVisible !== undefined && typeof input.externalVisible !== 'boolean') {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  const attachmentIds = input.attachmentIds ?? [];
  if (!Array.isArray(attachmentIds)) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  return {
    ticketId,
    action: actionValue,
    actor: { type: input.actor.type, id: operatorId },
    expectedVersion: input.expectedVersion,
    note: nullableText(input.note, 'VALIDATION_FAILED', 2000),
    externalVisible: input.externalVisible === true,
    reasonCode: nullableText(input.reasonCode, 'VALIDATION_FAILED', 128),
    attachmentIds,
    traceId,
  };
}

function publicTicketEvent(row: TicketEventRow): PublicTicketEvent {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    ticket_id: row.ticket_id,
    old_status: row.old_status,
    new_status: row.new_status,
    aggregate_version: row.aggregate_version,
    event_ordinal: row.event_ordinal,
    operator_type: row.operator_type,
    operator_id: row.operator_id,
    external_note: row.external_note,
    reason_code: row.reason_code,
    attachment_ids: row.attachment_ids,
    trace_id: row.trace_id,
    created_at: iso(row.created_at),
  };
}

function publicActionError(code: TicketActionErrorCode): TicketActionFailure {
  return { ok: false, error: { code, retryable: false } };
}

async function withTransaction<T>(
  pool: PostgresPool | undefined,
  operation: (transaction: PostgresPoolClient) => Promise<T>,
): Promise<T> {
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

function ticketFields(prefix = 'ticket'): string {
  return `${prefix}.id::text AS id,
          ${prefix}.ticket_no,
          ${prefix}.source_intake_id::text AS source_intake_id,
          ${prefix}.title,
          ${prefix}.request_type,
          ${prefix}.status,
          ${prefix}.priority,
          ${prefix}.resolver_team_id,
          ${prefix}.assignee_id::text AS assignee_id,
          ${prefix}.external_result,
          ${prefix}.closure_reason,
          ${prefix}.created_at,
          ${prefix}.updated_at,
          ${prefix}.version`;
}

export async function applyTicketStateActionMigration({ pool }: { pool: PostgresPool }): Promise<void | { status: 'LEGACY_MIGRATION_SUPERSEDED' }> {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export async function appendTicketEvent({
  transaction,
  ticket,
  eventType,
  oldStatus = null,
  newStatus = ticket?.status,
  actor,
  internalNote = null,
  externalNote = null,
  reasonCode = null,
  attachmentIds = [],
  traceId,
  assignmentMetadata,
}: {
  transaction: PostgresPoolClient;
  ticket: Pick<PilotTicketRow, 'id' | 'status' | 'version'>;
  eventType: TicketEventType;
  oldStatus?: TicketStatus | null;
  newStatus?: TicketStatus;
  actor: TicketActor;
  internalNote?: string | null;
  externalNote?: string | null;
  reasonCode?: string | null;
  attachmentIds?: unknown[];
  traceId: string;
  assignmentMetadata?: AssignmentMetadata;
}): Promise<PublicTicketEvent> {
  if (!transaction || typeof transaction.query !== 'function' || !ticket) {
    throw new TypeError('A Ticket and transaction are required.');
  }
  if (assignmentMetadata !== undefined) {
    const keys = ['old_assignee_id', 'new_assignee_id', 'old_team_id', 'new_team_id'] as const;
    if (!assignmentMetadata || utilTypes.isProxy(assignmentMetadata)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(assignmentMetadata))
      || Reflect.ownKeys(assignmentMetadata).length!==4
      || Reflect.ownKeys(assignmentMetadata).some(key => typeof key !== 'string' || !keys.includes(key as typeof keys[number]))
      || eventType!=='ticket.assignment_transferred') throw new TicketActionError('VALIDATION_FAILED');
    const copy: AssignmentMetadata = {
      old_assignee_id: null,
      new_assignee_id: '',
      old_team_id: '',
      new_team_id: '',
    };
    for (const key of keys) {
      const descriptor=Object.getOwnPropertyDescriptor(assignmentMetadata,key);
      if (!descriptor || !Object.hasOwn(descriptor,'value')) throw new TicketActionError('VALIDATION_FAILED');
      const value=descriptor.value;
      if (key === 'old_assignee_id') {
        if (value !== null && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))) {
          throw new TicketActionError('VALIDATION_FAILED');
        }
        copy.old_assignee_id = value;
      } else if (key === 'new_assignee_id') {
        if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
          throw new TicketActionError('VALIDATION_FAILED');
        }
        copy.new_assignee_id = value;
      } else if (key === 'old_team_id') {
        if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value)) {
          throw new TicketActionError('VALIDATION_FAILED');
        }
        copy.old_team_id = value;
      } else {
        if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value)) {
          throw new TicketActionError('VALIDATION_FAILED');
        }
        copy.new_team_id = value;
      }
    }
    assignmentMetadata=copy;
  }
  const inserted = await transaction.query<TicketEventRow>(
    `INSERT INTO pilot_ticket.ticket_event (
        ticket_id, event_type, old_status, new_status, aggregate_version,
        event_ordinal, operator_type, operator_id, internal_note, external_note,
        reason_code, attachment_ids, trace_id${assignmentMetadata === undefined ? '' : ', assignment_metadata'}
     )
     SELECT $1::uuid, $2, $3, $4, $5,
            COALESCE(MAX(event_ordinal), 0) + 1,
            $6, $7, $8, $9, $10, $11::jsonb, $12${assignmentMetadata === undefined ? '' : ', $13::jsonb'}
       FROM pilot_ticket.ticket_event
      WHERE ticket_id = $1::uuid
     RETURNING event_id::text, event_type, ticket_id::text, old_status, new_status,
               aggregate_version, event_ordinal, operator_type, operator_id,
               internal_note, external_note, reason_code, attachment_ids,
               trace_id, created_at`,
    [
      ticket.id,
      eventType,
      oldStatus,
      newStatus,
      ticket.version,
      actor.type,
      actor.id,
      internalNote,
      externalNote,
      reasonCode,
      JSON.stringify(attachmentIds),
      traceId,
      ...(assignmentMetadata === undefined ? [] : [JSON.stringify(assignmentMetadata)]),
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('TICKET_EVENT_NOT_RETURNED');
  return publicTicketEvent(row);
}

export function createTicketActionService({ pool, authorize = null, afterAction = null }: TicketActionServiceOptions = {}): TicketActionService {
  if (authorize !== null && typeof authorize !== 'function') {
    throw new TypeError('authorize must be a function when supplied.');
  }
  if (afterAction !== null && typeof afterAction !== 'function') {
    throw new TypeError('afterAction must be a function when supplied.');
  }

  async function performInTransaction(input: TicketActionInput, transaction: PostgresPoolClient): Promise<TicketActionSuccess> {
    const request = validateActionInput(input);
    if (!transaction || typeof transaction.query !== 'function') {
      throw new TicketActionError('VALIDATION_FAILED');
    }
    const selected = await transaction.query<PilotTicketRow>(
      `SELECT ${ticketFields()}
         FROM pilot_ticket.ticket AS ticket
        WHERE ticket.id = $1::uuid
        FOR UPDATE`,
      [request.ticketId],
    );
    if (selected.rowCount !== 1) {
      throw new TicketActionError('TICKET_NOT_FOUND');
    }
    const current = selected.rows[0];
    if (!current) {
      throw new TicketActionError('TICKET_NOT_FOUND');
    }
    if (current.version !== request.expectedVersion) {
      throw new TicketActionError('TICKET_VERSION_CONFLICT');
    }
    const transition = ACTIONS[request.action];
    if (!transition.from.includes(current.status)) {
      throw new TicketActionError('INVALID_STATE_TRANSITION');
    }
    if (authorize) {
      const authorized = await authorize({
        transaction,
        ticket: publicPilotTicket(current),
        action: request.action,
        actor: request.actor,
      });
      if (!authorized) {
        throw new TicketActionError('FORBIDDEN');
      }
    }
    const nextStatus = transition.toCurrentStatus === true ? current.status : transition.to;
    const externalNote = request.externalVisible ? request.note : null;
    const internalNote = request.externalVisible ? null : request.note;
    const closureReason = request.action === 'confirm'
      ? request.reasonCode ?? 'REQUESTER_CONFIRMED'
      : request.action === 'auto-close'
        ? 'AUTO_TIMEOUT'
        : request.action === 'cancel'
          ? request.reasonCode ?? 'CANCELLED'
          : request.action === 'reopen'
            ? null
            : current.closure_reason;
    const assigneeId = request.action === 'accept' ? request.actor.id : current.assignee_id;
    const externalResult = request.action === 'resolve' && externalNote !== null
      ? externalNote
      : current.external_result;
    const updated = await transaction.query<PilotTicketRow>(
      `UPDATE pilot_ticket.ticket
          SET status = $2,
              version = version + 1,
              assignee_id = $3::uuid,
              external_result = $4,
              closure_reason = $5,
              updated_at = GREATEST(
                created_at,
                date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
              )
        WHERE id = $1::uuid AND version = $6
        RETURNING ${ticketFields('pilot_ticket.ticket')}`,
      [current.id, nextStatus, assigneeId, externalResult, closureReason, request.expectedVersion],
    );
    if (updated.rowCount !== 1) {
      throw new TicketActionError('TICKET_VERSION_CONFLICT');
    }
    const updatedRow = updated.rows[0];
    if (!updatedRow) throw new Error('TICKET_NOT_RETURNED');
    const ticket = publicPilotTicket(updatedRow);
    const event = await appendTicketEvent({
      transaction,
      ticket,
      eventType: transition.eventType,
      oldStatus: current.status,
      newStatus: nextStatus,
      actor: request.actor,
      internalNote,
      externalNote,
      reasonCode: request.reasonCode,
      attachmentIds: request.attachmentIds,
      traceId: request.traceId,
    });
    const sideEffects = afterAction
      ? await afterAction({
        transaction,
        ticket,
        event,
        action: request.action,
        actor: request.actor,
      })
      : null;
    return { ok: true, ticket, event, side_effects: sideEffects };
  }

  return Object.freeze({
    performInTransaction,
    perform: async (input: TicketActionInput): Promise<TicketActionResult> => {
      try {
        return await withTransaction(pool, (transaction) => performInTransaction(input, transaction));
      } catch (error) {
        if (error instanceof TicketActionError) {
          return publicActionError(error.code);
        }
        throw error;
      }
    },
  });
}

export function externalTicketStatus(status: unknown): string | null {
  return isTicketStatus(status) ? EXTERNAL_TICKET_STATUS[status] ?? null : null;
}

export function getTicketActionTransitions(): readonly TicketActionTransition[] {
  return Object.freeze((Object.entries(ACTIONS) as [TicketAction, TicketTransition][]).map(([action, transition]) => Object.freeze({
    action,
    from: Object.freeze([...transition.from]),
    to: 'to' in transition ? transition.to : null,
    event_type: transition.eventType,
  })));
}
