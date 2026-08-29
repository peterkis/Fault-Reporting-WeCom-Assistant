import { readFile } from 'node:fs/promises';

const MIGRATION_URL = new URL('../database/migrations/003_p1_005_pilot_ticket_core.sql', import.meta.url);
const TICKET_CREATING_REQUEST_TYPES = new Set(['INCIDENT', 'SERVICE_REQUEST']);
const TICKET_STATUSES = new Set([
  'NEW',
  'QUEUED',
  'ACCEPTED',
  'IN_PROGRESS',
  'WAITING_REQUESTER',
  'WAITING_VENDOR',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
  'DUPLICATE_LINKED',
]);
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const EXTERNAL_TICKET_STATUS = Object.freeze({
  NEW: '等待受理',
  QUEUED: '等待受理',
  ACCEPTED: '已受理',
  IN_PROGRESS: '处理中',
  WAITING_REQUESTER: '待您补充',
  WAITING_VENDOR: '处理中',
  RESOLVED: '已处理，待确认',
  CLOSED: '已关闭',
  REOPENED: '重新处理中',
  CANCELLED: '已撤销',
  DUPLICATE_LINKED: '已关联公共故障',
});

export class PilotTicketInputError extends Error {
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

function nonEmptyString(value, code, maximum = Number.POSITIVE_INFINITY) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new PilotTicketInputError(code);
  }
  return value;
}

function nullableString(value, code, maximum) {
  if (value === null || value === undefined) {
    return null;
  }
  return nonEmptyString(value, code, maximum);
}

function titleForRequestType(requestType) {
  return requestType === 'SERVICE_REQUEST' ? '信息服务申请' : '信息系统故障报修';
}

function publicTicket(row) {
  return {
    id: row.id,
    ticket_no: row.ticket_no,
    intake_id: row.source_intake_id,
    title: row.title,
    request_type: row.request_type,
    status: row.status,
    external_status: EXTERNAL_TICKET_STATUS[row.status],
    priority: row.priority,
    resolver_team_id: row.resolver_team_id,
    assignee_id: row.assignee_id,
    external_result: row.external_result,
    closure_reason: row.closure_reason,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    version: row.version,
  };
}

function publicIntake(row) {
  return {
    id: row.id,
    intake_no: row.intake_no,
    source_channel: row.source_channel,
    reporter_wecom_userid: row.reporter_wecom_userid,
    reporter_person_id: null,
    request_type: row.request_type,
    summary: null,
    reported_campus_id: row.reported_campus_id,
    reported_department_id: row.reported_department_id,
    reported_location_text: row.reported_location_text,
    status: row.status,
    ticket_id: row.pilot_ticket_id,
    incident_id: null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    version: row.version,
  };
}

function publicIntakeEvent(row) {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    event_ordinal: row.event_ordinal,
    occurred_at: iso(row.occurred_at),
    trace_id: row.trace_id,
    payload: row.payload,
  };
}

async function appendIntakeTicketCreatedEvent({ transaction, intake, ticket, occurredAt, traceId }) {
  const inserted = await transaction.query(
    `INSERT INTO intake.service_intake_event (
        event_type, intake_id, aggregate_version, event_ordinal,
        occurred_at, trace_id, payload
     )
     SELECT 'intake.ticket_created',
            $1::uuid,
            $2,
            COALESCE(MAX(event_ordinal), 0) + 1,
            $3::timestamptz,
            $4,
            $5::jsonb
       FROM intake.service_intake_event
      WHERE intake_id = $1::uuid
     RETURNING event_id::text, event_type, aggregate_type,
               intake_id::text AS aggregate_id, aggregate_version,
               event_ordinal, occurred_at, trace_id, payload`,
    [
      intake.id,
      intake.version,
      occurredAt,
      traceId,
      JSON.stringify({
        intake_id: intake.id,
        ticket_id: ticket.id,
        ticket_no: ticket.ticket_no,
        external_status: EXTERNAL_TICKET_STATUS[ticket.status],
      }),
    ],
  );
  return publicIntakeEvent(inserted.rows[0]);
}

async function withTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new PilotTicketInputError('PILOT_TICKET_POOL_REQUIRED');
  }
  const client = await pool.connect();
  let shouldDestroy = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      shouldDestroy = true;
    }
    throw error;
  } finally {
    client.release(shouldDestroy);
  }
}

function validateCreateInput({ intakeId, transaction, occurredAt, traceId, title, resolverTeamId, priority }) {
  nonEmptyString(intakeId, 'PILOT_TICKET_INTAKE_ID_REQUIRED', 64);
  if (!transaction || typeof transaction.query !== 'function') {
    throw new PilotTicketInputError('PILOT_TICKET_TRANSACTION_REQUIRED');
  }
  nonEmptyString(traceId, 'PILOT_TICKET_TRACE_ID_REQUIRED', 128);
  const time = new Date(occurredAt);
  if (Number.isNaN(time.getTime())) {
    throw new PilotTicketInputError('PILOT_TICKET_OCCURRED_AT_INVALID');
  }
  if (title !== undefined && title !== null) {
    nonEmptyString(title, 'PILOT_TICKET_TITLE_INVALID', 200);
  }
  nonEmptyString(resolverTeamId, 'PILOT_TICKET_RESOLVER_TEAM_REQUIRED', 64);
  if (!PRIORITIES.has(priority)) {
    throw new PilotTicketInputError('PILOT_TICKET_PRIORITY_INVALID');
  }
  return time.toISOString();
}

export async function applyPilotTicketCoreMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createPilotTicketCore({ pool, defaultResolverTeamId = 'PILOT_IT' } = {}) {
  nonEmptyString(defaultResolverTeamId, 'PILOT_TICKET_RESOLVER_TEAM_REQUIRED', 64);

  async function createForIntakeInTransaction({
    intakeId,
    transaction,
    occurredAt,
    traceId,
    title = null,
    resolverTeamId = defaultResolverTeamId,
    priority = 'NORMAL',
  }) {
    const occurredAtIso = validateCreateInput({
      intakeId,
      transaction,
      occurredAt,
      traceId,
      title,
      resolverTeamId,
      priority,
    });
    const selected = await transaction.query(
      `SELECT intake.id::text AS id,
              intake.intake_no,
              intake.source_channel,
              intake.reporter_wecom_userid,
              intake.request_type,
              intake.reported_campus_id,
              intake.reported_department_id,
              intake.reported_location_text,
              intake.status,
              intake.pilot_ticket_id::text AS pilot_ticket_id,
              intake.created_at,
              intake.updated_at,
              intake.version,
              ticket.id::text AS existing_ticket_id,
              ticket.ticket_no AS existing_ticket_no,
              ticket.source_intake_id::text AS existing_source_intake_id,
              ticket.title AS existing_title,
              ticket.request_type AS existing_request_type,
              ticket.status AS existing_status,
              ticket.priority AS existing_priority,
              ticket.resolver_team_id AS existing_resolver_team_id,
              ticket.assignee_id::text AS existing_assignee_id,
              ticket.external_result AS existing_external_result,
              ticket.closure_reason AS existing_closure_reason,
              ticket.created_at AS existing_created_at,
              ticket.updated_at AS existing_updated_at,
              ticket.version AS existing_version
         FROM intake.service_intake AS intake
         LEFT JOIN pilot_ticket.ticket AS ticket ON ticket.id = intake.pilot_ticket_id
        WHERE intake.id = $1::uuid
        FOR UPDATE OF intake`,
      [intakeId],
    );
    if (selected.rowCount !== 1) {
      throw new PilotTicketInputError('PILOT_TICKET_INTAKE_NOT_FOUND');
    }
    const intake = selected.rows[0];
    if (intake.pilot_ticket_id !== null && intake.existing_ticket_id === null) {
      throw new PilotTicketInputError('PILOT_TICKET_INTAKE_LINK_CORRUPT');
    }
    if (intake.existing_ticket_id !== null) {
      return {
        created: false,
        intake: publicIntake(intake),
        ticket: publicTicket({
          id: intake.existing_ticket_id,
          ticket_no: intake.existing_ticket_no,
          source_intake_id: intake.existing_source_intake_id,
          title: intake.existing_title,
          request_type: intake.existing_request_type,
          status: intake.existing_status,
          priority: intake.existing_priority,
          resolver_team_id: intake.existing_resolver_team_id,
          assignee_id: intake.existing_assignee_id,
          external_result: intake.existing_external_result,
          closure_reason: intake.existing_closure_reason,
          created_at: intake.existing_created_at,
          updated_at: intake.existing_updated_at,
          version: intake.existing_version,
        }),
        intakeEvent: null,
      };
    }
    if (!TICKET_CREATING_REQUEST_TYPES.has(intake.request_type) || intake.status !== 'RECEIVED') {
      return {
        created: false,
        intake: publicIntake(intake),
        ticket: null,
        intakeEvent: null,
      };
    }

    const createdTicket = await transaction.query(
      `WITH generated_number AS (
          SELECT nextval('pilot_ticket.ticket_number_seq')::text AS sequence_value
       )
       INSERT INTO pilot_ticket.ticket (
          ticket_no, source_intake_id, title, request_type, status, priority,
          resolver_team_id, reported_campus_id, reported_department_id,
          reported_location_text
       )
       SELECT
          'IT-' || to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD')
            || '-' || lpad(
              generated_number.sequence_value,
              GREATEST(4, char_length(generated_number.sequence_value)),
              '0'
            ),
          $2::uuid, $3, $4, 'QUEUED', $5, $6, $7, $8, $9
         FROM generated_number
       RETURNING id::text, ticket_no, source_intake_id::text, title, request_type,
                 status, priority, resolver_team_id, assignee_id::text,
                 external_result, closure_reason, created_at, updated_at, version`,
      [
        occurredAtIso,
        intake.id,
        title ?? titleForRequestType(intake.request_type),
        intake.request_type,
        priority,
        resolverTeamId,
        intake.reported_campus_id,
        intake.reported_department_id,
        intake.reported_location_text,
      ],
    );
    const ticket = createdTicket.rows[0];
    const linked = await transaction.query(
      `UPDATE intake.service_intake
          SET pilot_ticket_id = $2::uuid,
              status = 'TICKET_CREATED',
              version = version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1::uuid
        RETURNING id::text, intake_no, source_channel, reporter_wecom_userid,
                  request_type, reported_campus_id, reported_department_id,
                  reported_location_text, status, pilot_ticket_id::text,
                  created_at, updated_at, version`,
      [intake.id, ticket.id],
    );
    const linkedIntake = linked.rows[0];
    const intakeEvent = await appendIntakeTicketCreatedEvent({
      transaction,
      intake: linkedIntake,
      ticket,
      occurredAt: occurredAtIso,
      traceId,
    });
    return {
      created: true,
      intake: publicIntake(linkedIntake),
      ticket: publicTicket(ticket),
      intakeEvent,
    };
  }

  return Object.freeze({
    createForIntakeInTransaction,
    createForIntake: async (input) => {
      try {
        return await withTransaction(
          pool,
          (transaction) => createForIntakeInTransaction({ ...input, transaction }),
        );
      } catch (error) {
        if (
          error?.code === '23505'
          && ['ticket_ticket_no_key', 'ticket_number_unique'].includes(error.constraint)
        ) {
          throw new PilotTicketInputError('PILOT_TICKET_NUMBER_CONFLICT');
        }
        throw error;
      }
    },
  });
}

export function createPilotTicketProcessor({
  serviceIntakeProcessor,
  ticketCore,
  onTicketCreated = null,
} = {}) {
  if (typeof serviceIntakeProcessor !== 'function') {
    throw new TypeError('A Service Intake processor is required.');
  }
  if (!ticketCore || typeof ticketCore.createForIntakeInTransaction !== 'function') {
    throw new TypeError('A Pilot Ticket Core is required.');
  }
  if (onTicketCreated !== null && typeof onTicketCreated !== 'function') {
    throw new TypeError('onTicketCreated must be a function when supplied.');
  }
  return async function processPilotTicket(input) {
    if (!isRecord(input) || !isRecord(input.message) || !input.transaction) {
      throw new PilotTicketInputError('PILOT_TICKET_PROCESSOR_INPUT_INVALID');
    }
    const intakeResult = await serviceIntakeProcessor(input);
    const ticketResult = await ticketCore.createForIntakeInTransaction({
      intakeId: intakeResult.intake.id,
      transaction: input.transaction,
      occurredAt: input.message.received_at,
      traceId: `ticket:${input.message.idempotency_key}`,
    });
    const lifecycle = ticketResult.created && onTicketCreated
      ? await onTicketCreated({
        transaction: input.transaction,
        ticket: ticketResult.ticket,
        intake: ticketResult.intake,
        message: input.message,
      })
      : null;
    return {
      ...intakeResult,
      intake: ticketResult.intake,
      ticket: ticketResult.ticket,
      events: ticketResult.intakeEvent
        ? [...intakeResult.events, ticketResult.intakeEvent]
        : intakeResult.events,
      lifecycle,
    };
  };
}

export function isTicketStatus(value) {
  return TICKET_STATUSES.has(value);
}

export function publicPilotTicket(row) {
  return publicTicket(row);
}
