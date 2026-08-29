import { readFile } from 'node:fs/promises';
import { EXTERNAL_TICKET_STATUS, publicPilotTicket } from './p1-005-pilot-ticket-core.mjs';

const MIGRATION_URL = new URL('../database/migrations/004_p1_006_ticket_state_actions.sql', import.meta.url);
const ACTIONS = Object.freeze({
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
const OPERATOR_TYPES = new Set(['PILOT_USER', 'REPORTER', 'SYSTEM']);

class TicketActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nonEmpty(value, code, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TicketActionError(code);
  }
  return value;
}

function nullableText(value, code, maximum) {
  if (value === null || value === undefined) {
    return null;
  }
  return nonEmpty(value, code, maximum);
}

function validateActionInput(input) {
  if (!isRecord(input)) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  const ticketId = nonEmpty(input.ticketId, 'VALIDATION_FAILED', 64);
  const action = nonEmpty(input.action, 'VALIDATION_FAILED', 64);
  if (!Object.hasOwn(ACTIONS, action)) {
    throw new TicketActionError('INVALID_STATE_TRANSITION');
  }
  if (!isRecord(input.actor) || !OPERATOR_TYPES.has(input.actor.type)) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  if (action === 'auto-close' && input.actor.type !== 'SYSTEM') {
    throw new TicketActionError('FORBIDDEN');
  }
  const operatorId = input.actor.id === null || input.actor.id === undefined
    ? null
    : nonEmpty(String(input.actor.id), 'VALIDATION_FAILED', 128);
  if (input.actor.type !== 'SYSTEM' && operatorId === null) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  const traceId = nonEmpty(input.traceId, 'VALIDATION_FAILED', 128);
  if (input.externalVisible !== undefined && typeof input.externalVisible !== 'boolean') {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  if (!Array.isArray(input.attachmentIds ?? [])) {
    throw new TicketActionError('VALIDATION_FAILED');
  }
  return {
    ticketId,
    action,
    actor: { type: input.actor.type, id: operatorId },
    expectedVersion: input.expectedVersion,
    note: nullableText(input.note, 'VALIDATION_FAILED', 2000),
    externalVisible: input.externalVisible === true,
    reasonCode: nullableText(input.reasonCode, 'VALIDATION_FAILED', 128),
    attachmentIds: input.attachmentIds ?? [],
    traceId,
  };
}

function publicTicketEvent(row) {
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

function publicActionError(code) {
  return { ok: false, error: { code, retryable: false } };
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

function ticketFields(prefix = 'ticket') {
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

export async function applyTicketStateActionMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
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
}) {
  if (!transaction || typeof transaction.query !== 'function' || !ticket) {
    throw new TypeError('A Ticket and transaction are required.');
  }
  const inserted = await transaction.query(
    `INSERT INTO pilot_ticket.ticket_event (
        ticket_id, event_type, old_status, new_status, aggregate_version,
        event_ordinal, operator_type, operator_id, internal_note, external_note,
        reason_code, attachment_ids, trace_id
     )
     SELECT $1::uuid, $2, $3, $4, $5,
            COALESCE(MAX(event_ordinal), 0) + 1,
            $6, $7, $8, $9, $10, $11::jsonb, $12
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
    ],
  );
  return publicTicketEvent(inserted.rows[0]);
}

export function createTicketActionService({ pool, authorize = null, afterAction = null } = {}) {
  if (authorize !== null && typeof authorize !== 'function') {
    throw new TypeError('authorize must be a function when supplied.');
  }
  if (afterAction !== null && typeof afterAction !== 'function') {
    throw new TypeError('afterAction must be a function when supplied.');
  }

  async function performInTransaction(input, transaction) {
    const request = validateActionInput(input);
    if (!transaction || typeof transaction.query !== 'function') {
      throw new TicketActionError('VALIDATION_FAILED');
    }
    const selected = await transaction.query(
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
    const nextStatus = transition.toCurrentStatus ? current.status : transition.to;
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
    const updated = await transaction.query(
      `UPDATE pilot_ticket.ticket
          SET status = $2,
              version = version + 1,
              assignee_id = $3::uuid,
              external_result = $4,
              closure_reason = $5,
              updated_at = clock_timestamp()
        WHERE id = $1::uuid AND version = $6
        RETURNING ${ticketFields('pilot_ticket.ticket')}`,
      [current.id, nextStatus, assigneeId, externalResult, closureReason, request.expectedVersion],
    );
    if (updated.rowCount !== 1) {
      throw new TicketActionError('TICKET_VERSION_CONFLICT');
    }
    const ticket = publicPilotTicket(updated.rows[0]);
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
    perform: async (input) => {
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

export function externalTicketStatus(status) {
  return EXTERNAL_TICKET_STATUS[status] ?? null;
}
