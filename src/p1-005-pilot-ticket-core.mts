import { readFile } from 'node:fs/promises';
import type { LocalDateTime } from '../contracts/time_contracts.js';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import { assertLocalDateTime } from './platform/time-contract.mjs';
import { postgresTimestampToLocalDateTime } from './platform/postgres-types.mjs';
import type { PostgresPool, PostgresPoolClient, PostgresTransaction } from './platform/postgres-pool.mjs';

const MIGRATION_URL = new URL('../database/migrations/003_p1_005_pilot_ticket_core.sql', import.meta.url);
export type TicketRequestType =
  | 'INCIDENT'
  | 'SERVICE_REQUEST'
  | 'QUESTION'
  | 'COMPLAINT'
  | 'STATUS_QUERY'
  | 'FOLLOW_UP'
  | 'CHATTER'
  | 'UNKNOWN';
export type TicketStatus =
  | 'NEW'
  | 'QUEUED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'WAITING_REQUESTER'
  | 'WAITING_VENDOR'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CANCELLED'
  | 'DUPLICATE_LINKED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type IntakeStatus =
  | 'RECEIVED'
  | 'TICKET_CREATED'
  | 'WAITING_DESCRIPTION'
  | 'WAITING_TRIAGE'
  | 'LINKED_INCIDENT'
  | 'COMPLETED'
  | 'IGNORED'
  | 'FAILED';
export type IntakeSourceChannel = 'WECOM_GROUP' | 'WECOM_DIRECT' | 'PORTAL' | 'MANUAL';
export type IntakeEventType =
  | 'intake.received'
  | 'intake.needs_clarification'
  | 'intake.message_added'
  | 'intake.clarification_added'
  | 'intake.ticket_created';
export type PilotTicketErrorCode =
  | 'PILOT_TICKET_INTAKE_ID_REQUIRED'
  | 'PILOT_TICKET_POOL_REQUIRED'
  | 'PILOT_TICKET_TRANSACTION_REQUIRED'
  | 'PILOT_TICKET_TRACE_ID_REQUIRED'
  | 'PILOT_TICKET_OCCURRED_AT_INVALID'
  | 'PILOT_TICKET_TITLE_INVALID'
  | 'PILOT_TICKET_RESOLVER_TEAM_REQUIRED'
  | 'PILOT_TICKET_PRIORITY_INVALID'
  | 'PILOT_TICKET_INTAKE_NOT_FOUND'
  | 'PILOT_TICKET_INTAKE_LINK_CORRUPT'
  | 'PILOT_TICKET_NUMBER_CONFLICT'
  | 'PILOT_TICKET_PROCESSOR_INPUT_INVALID';

const TICKET_CREATING_REQUEST_TYPES = new Set<TicketRequestType>(['INCIDENT', 'SERVICE_REQUEST']);
const TICKET_STATUSES = new Set<TicketStatus>([
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
const PRIORITIES = new Set<TicketPriority>(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const EXTERNAL_TICKET_STATUS: Readonly<Record<TicketStatus, string>> = Object.freeze({
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
  declare code: PilotTicketErrorCode;
  constructor(code: PilotTicketErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface PilotTicketRow {
  id: string;
  ticket_no: string;
  source_intake_id: string;
  title: string;
  request_type: TicketRequestType;
  status: TicketStatus;
  priority: TicketPriority;
  resolver_team_id: string;
  assignee_id: string | null;
  external_result: string | null;
  closure_reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ServiceIntakeRow {
  id: string;
  intake_no: string;
  source_channel: IntakeSourceChannel;
  reporter_wecom_userid: string;
  request_type: TicketRequestType;
  reported_campus_id: string | null;
  reported_department_id: string | null;
  reported_location_text: string | null;
  status: IntakeStatus;
  pilot_ticket_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ServiceIntakeEventRow {
  event_id: string;
  event_type: IntakeEventType;
  aggregate_type: 'intake';
  aggregate_id: string;
  aggregate_version: number;
  event_ordinal: number;
  occurred_at: string;
  trace_id: string;
  payload: unknown;
}

interface TicketCreationSelectionRow extends ServiceIntakeRow {
  existing_ticket_id: string | null;
  existing_ticket_no: string;
  existing_source_intake_id: string;
  existing_title: string;
  existing_request_type: TicketRequestType;
  existing_status: TicketStatus;
  existing_priority: TicketPriority;
  existing_resolver_team_id: string;
  existing_assignee_id: string | null;
  existing_external_result: string | null;
  existing_closure_reason: string | null;
  existing_created_at: string;
  existing_updated_at: string;
  existing_version: number;
}

export interface PublicPilotTicket {
  id: string;
  ticket_no: string;
  intake_id: string;
  title: string;
  request_type: TicketRequestType;
  status: TicketStatus;
  external_status: string;
  priority: TicketPriority;
  resolver_team_id: string;
  assignee_id: string | null;
  external_result: string | null;
  closure_reason: string | null;
  created_at: LocalDateTime;
  updated_at: LocalDateTime;
  version: number;
}

export interface PublicIntake {
  id: string;
  intake_no: string;
  source_channel: IntakeSourceChannel;
  reporter_wecom_userid: string;
  reporter_person_id: null;
  request_type: TicketRequestType;
  summary: null;
  reported_campus_id: string | null;
  reported_department_id: string | null;
  reported_location_text: string | null;
  status: IntakeStatus;
  ticket_id: string | null;
  incident_id: null;
  created_at: LocalDateTime;
  updated_at: LocalDateTime;
  version: number;
}

export interface PublicIntakeEvent {
  event_id: string;
  event_type: IntakeEventType;
  aggregate_type: 'intake';
  aggregate_id: string;
  aggregate_version: number;
  event_ordinal: number;
  occurred_at: LocalDateTime;
  trace_id: string;
  payload: unknown;
}

export interface PilotTicketInput {
  intakeId: string;
  transaction: PostgresTransaction;
  occurredAt: LocalDateTime;
  traceId: string;
  title?: string | null;
  resolverTeamId?: string;
  priority?: TicketPriority;
}

export type PilotTicketCreateInput = Omit<PilotTicketInput, 'transaction'>;
export type PilotTicketCreateResult =
  | { created: true; intake: PublicIntake; ticket: PublicPilotTicket; intakeEvent: PublicIntakeEvent }
  | { created: false; intake: PublicIntake; ticket: PublicPilotTicket | null; intakeEvent: null };

export interface PilotTicketCore {
  createForIntakeInTransaction(input: PilotTicketInput): Promise<PilotTicketCreateResult>;
  createForIntake(input: PilotTicketCreateInput): Promise<PilotTicketCreateResult>;
}

export interface PilotTicketMessage {
  id: string;
  idempotency_key: string;
  received_at: LocalDateTime;
  [key: string]: unknown;
}

/** Incoming channel messages have no persisted intake-message id yet. */
export interface PilotTicketInputMessage {
  idempotency_key: string;
  received_at: LocalDateTime;
}
export interface PilotTicketProcessorInput {
  transaction: PostgresTransaction;
  message: PilotTicketInputMessage;
}

export interface PilotTicketProcessorIntakeResult {
  intake: PublicIntake;
  events: PublicIntakeEvent[];
  [key: string]: unknown;
}

export interface PilotTicketProcessorResult extends PilotTicketProcessorIntakeResult {
  ticket: PublicPilotTicket | null;
  lifecycle: unknown;
}

export type ServiceIntakeProcessor<I extends PilotTicketProcessorInput = PilotTicketProcessorInput> = (input: I) => Promise<PilotTicketProcessorIntakeResult>;
export type TicketCreatedHook = (input: {
  transaction: PostgresTransaction;
  ticket: PublicPilotTicket;
  intake: PublicIntake;
  message: PilotTicketInputMessage;
}) => unknown | Promise<unknown>;

export interface PilotTicketCoreOptions {
  pool?: PostgresPool;
  defaultResolverTeamId?: string;
}

export interface PilotTicketProcessorOptions<I extends PilotTicketProcessorInput = PilotTicketProcessorInput> {
  serviceIntakeProcessor: ServiceIntakeProcessor<I>;
  ticketCore: PilotTicketCore;
  onTicketCreated?: TicketCreatedHook | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function iso(value: unknown): LocalDateTime {
  return postgresTimestampToLocalDateTime(value);
}

function nonEmptyString(value: unknown, code: PilotTicketErrorCode, maximum = Number.POSITIVE_INFINITY): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new PilotTicketInputError(code);
  }
  return value;
}

function nullableString(value: unknown, code: PilotTicketErrorCode, maximum: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return nonEmptyString(value, code, maximum);
}

function titleForRequestType(requestType: TicketRequestType): string {
  return requestType === 'SERVICE_REQUEST' ? '信息服务申请' : '信息系统故障报修';
}

function publicTicket(row: PilotTicketRow): PublicPilotTicket {
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

function publicIntake(row: ServiceIntakeRow): PublicIntake {
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

function publicIntakeEvent(row: ServiceIntakeEventRow): PublicIntakeEvent {
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

async function appendIntakeTicketCreatedEvent({
  transaction,
  intake,
  ticket,
  occurredAt,
  traceId,
}: {
  transaction: PostgresTransaction;
  intake: ServiceIntakeRow;
  ticket: PilotTicketRow;
  occurredAt: LocalDateTime;
  traceId: string;
}): Promise<PublicIntakeEvent> {
  const inserted = await transaction.query<ServiceIntakeEventRow>(
    `INSERT INTO intake.service_intake_event (
        event_type, intake_id, aggregate_version, event_ordinal,
        occurred_at, trace_id, payload
     )
     SELECT 'intake.ticket_created',
            $1::uuid,
            $2,
            COALESCE(MAX(event_ordinal), 0) + 1,
            $3::timestamp without time zone,
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
  const row = inserted.rows[0];
  if (!row) throw new Error('PILOT_TICKET_INTAKE_EVENT_NOT_RETURNED');
  return publicIntakeEvent(row);
}

async function withTransaction<T>(
  pool: PostgresPool | undefined,
  operation: (transaction: PostgresPoolClient) => Promise<T>,
): Promise<T> {
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

function validateCreateInput({
  intakeId,
  transaction,
  occurredAt,
  traceId,
  title,
  resolverTeamId,
  priority,
}: {
  intakeId: string;
  transaction: PostgresTransaction;
  occurredAt: unknown;
  traceId: string;
  title: string | null | undefined;
  resolverTeamId: string;
  priority: TicketPriority;
}): LocalDateTime {
  nonEmptyString(intakeId, 'PILOT_TICKET_INTAKE_ID_REQUIRED', 64);
  if (!transaction || typeof transaction.query !== 'function') {
    throw new PilotTicketInputError('PILOT_TICKET_TRANSACTION_REQUIRED');
  }
  nonEmptyString(traceId, 'PILOT_TICKET_TRACE_ID_REQUIRED', 128);
  let time;
  try { time = assertLocalDateTime(occurredAt); }
  catch { throw new PilotTicketInputError('PILOT_TICKET_OCCURRED_AT_INVALID'); }
  if (title !== undefined && title !== null) {
    nonEmptyString(title, 'PILOT_TICKET_TITLE_INVALID', 200);
  }
  nonEmptyString(resolverTeamId, 'PILOT_TICKET_RESOLVER_TEAM_REQUIRED', 64);
  if (!PRIORITIES.has(priority)) {
    throw new PilotTicketInputError('PILOT_TICKET_PRIORITY_INVALID');
  }
  return time;
}

export async function applyPilotTicketCoreMigration({ pool }: { pool: PostgresPool }): Promise<void | { status: 'LEGACY_MIGRATION_SUPERSEDED' }> {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createPilotTicketCore({ pool, defaultResolverTeamId = 'PILOT_IT' }: PilotTicketCoreOptions = {}): PilotTicketCore {
  nonEmptyString(defaultResolverTeamId, 'PILOT_TICKET_RESOLVER_TEAM_REQUIRED', 64);

  async function createForIntakeInTransaction({
    intakeId,
    transaction,
    occurredAt,
    traceId,
    title = null,
    resolverTeamId = defaultResolverTeamId,
    priority = 'NORMAL',
  }: PilotTicketInput): Promise<PilotTicketCreateResult> {
    const occurredAtIso = validateCreateInput({
      intakeId,
      transaction,
      occurredAt,
      traceId,
      title,
      resolverTeamId,
      priority,
    });
    const selected = await transaction.query<TicketCreationSelectionRow>(
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
    if (!intake) throw new PilotTicketInputError('PILOT_TICKET_INTAKE_NOT_FOUND');
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

    const createdTicket = await transaction.query<PilotTicketRow>(
      `WITH generated_number AS (
          SELECT nextval('pilot_ticket.ticket_number_seq')::text AS sequence_value
       )
       INSERT INTO pilot_ticket.ticket (
          ticket_no, source_intake_id, title, request_type, status, priority,
          resolver_team_id, reported_campus_id, reported_department_id,
          reported_location_text
       )
       SELECT
          'IT-' || to_char($1::timestamp without time zone AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD')
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
    if (!ticket) throw new Error('PILOT_TICKET_NOT_RETURNED');
    const linked = await transaction.query<ServiceIntakeRow>(
      `UPDATE intake.service_intake
          SET pilot_ticket_id = $2::uuid,
              status = 'TICKET_CREATED',
              version = version + 1,
               updated_at = GREATEST(
                 created_at,
                 date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
               )
        WHERE id = $1::uuid
        RETURNING id::text, intake_no, source_channel, reporter_wecom_userid,
                  request_type, reported_campus_id, reported_department_id,
                  reported_location_text, status, pilot_ticket_id::text,
                  created_at, updated_at, version`,
      [intake.id, ticket.id],
    );
    const linkedIntake = linked.rows[0];
    if (!linkedIntake) throw new Error('PILOT_TICKET_INTAKE_NOT_RETURNED');
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
    createForIntake: async (input: PilotTicketCreateInput): Promise<PilotTicketCreateResult> => {
      try {
        return await withTransaction(
          pool,
          (transaction) => createForIntakeInTransaction({ ...input, transaction }),
        );
      } catch (error) {
        if (
          isRecord(error)
          && error.code === '23505'
          && typeof error.constraint === 'string'
          && ['ticket_ticket_no_key', 'ticket_number_unique'].includes(error.constraint)
        ) {
          throw new PilotTicketInputError('PILOT_TICKET_NUMBER_CONFLICT');
        }
        throw error;
      }
    },
  });
}

export function createPilotTicketProcessor<I extends PilotTicketProcessorInput = PilotTicketProcessorInput>(
  options: PilotTicketProcessorOptions<I>,
): (input: I) => Promise<PilotTicketProcessorResult>;
export function createPilotTicketProcessor<I extends PilotTicketProcessorInput = PilotTicketProcessorInput>({
  serviceIntakeProcessor,
  ticketCore,
  onTicketCreated = null,
}: Partial<PilotTicketProcessorOptions<I>> = {}): (input: I) => Promise<PilotTicketProcessorResult> {
  if (typeof serviceIntakeProcessor !== 'function') {
    throw new TypeError('A Service Intake processor is required.');
  }
  if (!ticketCore || typeof ticketCore.createForIntakeInTransaction !== 'function') {
    throw new TypeError('A Pilot Ticket Core is required.');
  }
  if (onTicketCreated !== null && typeof onTicketCreated !== 'function') {
    throw new TypeError('onTicketCreated must be a function when supplied.');
  }
  return async function processPilotTicket(input: I): Promise<PilotTicketProcessorResult> {
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

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && TICKET_STATUSES.has(value as TicketStatus);
}

export function publicPilotTicket(row: PilotTicketRow): PublicPilotTicket {
  return publicTicket(row);
}
