
import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { ConversationSessionStatus, ConversationControlMode } from '../contracts/conversation_contracts.js';
import type { ConversationControlCommand, ConversationControlCommandType, ConversationControlEventType, ConversationAssignmentStatus, ConversationHandoffStatus } from '../contracts/conversation_control_contracts.js';
import type { CommunicationJson, CommunicationAuthorizationContext } from './p2-004-communication-core.mjs';
export type ControlCommandFor<K extends ConversationControlCommandType> = Omit<ConversationControlCommand, 'command_type'> & { command_type: K };
export interface NormalizedControlCommand {
  command_type: ConversationControlCommandType; session_id: string; client_command_id: string; idempotency_scope: string; expected_row_version: number | null; expected_cursor_row_version: number | null;
  actor_principal_id: string | null; target_principal_id: string | null; handoff_id: string | null; requested_by_kind: 'USER' | 'AI' | 'RULE' | 'AGENT' | 'ADMIN' | null;
  last_read_sequence: number | null; reason_code: string; force: boolean; target_mode: ConversationControlMode | null;
}
interface SessionState { status: ConversationSessionStatus; control_mode: ConversationControlMode; generation_version: string | number; row_version: string | number }
interface SessionRow extends SessionState { id: string; service_intake_id: string | null }
interface AssignmentViewRow { assignment_status: ConversationAssignmentStatus; assignment_version: string | number; assigned_at: unknown; released_at: unknown }
interface AssignmentRow extends AssignmentViewRow { session_id: string; assigned_principal_id: string | null; assigned_by_principal_id: string | null; updated_at: unknown }
interface HandoffRow { id: string; status: ConversationHandoffStatus; reason_code: string; from_mode: ConversationControlMode; to_mode: ConversationControlMode; row_version: string | number; requested_at: unknown; accepted_at: unknown; released_at: unknown; cancelled_at: unknown }
interface CursorRow { last_read_sequence: string | number; row_version: string | number; created_at: unknown; updated_at: unknown }
interface ControlEventRow { id: string; event_type: ConversationControlEventType; event_ordinal: string | number; occurred_at: unknown; command_hash?: string }
interface EventFields { event_type: ConversationControlEventType; handoff_id?: string | null | undefined; old_assignment_status?: ConversationAssignmentStatus; new_assignment_status?: ConversationAssignmentStatus; old_control_mode?: ConversationControlMode; new_control_mode?: ConversationControlMode; old_read_sequence?: string | number; new_read_sequence?: string | number; generation_version_after: string | number; session_row_version_after: string | number; occurred_at: string }
interface ResultInput { event?: ControlEventRow | null | undefined; session?: SessionState | null | undefined; assignment?: AssignmentViewRow | null | undefined; handoff?: HandoffRow | null | undefined; cursor?: CursorRow | null | undefined; replayed?: boolean; noOp?: boolean }
export type ControlSuccess = ReturnType<typeof result>;
export type ControlErrorCode = typeof CONVERSATION_CONTROL_ERROR_CODES[keyof typeof CONVERSATION_CONTROL_ERROR_CODES];
export type ControlFailure = ReturnType<typeof publicError>;
export type ControlConflictCode = typeof CONVERSATION_CONTROL_ERROR_CODES.commandConflict | typeof CONVERSATION_CONTROL_ERROR_CODES.sessionVersionConflict | typeof CONVERSATION_CONTROL_ERROR_CODES.alreadyAssigned | typeof CONVERSATION_CONTROL_ERROR_CODES.assignmentConflict | typeof CONVERSATION_CONTROL_ERROR_CODES.handoffStateConflict | typeof CONVERSATION_CONTROL_ERROR_CODES.cursorAhead | typeof CONVERSATION_CONTROL_ERROR_CODES.generationStale;
export type ControlConflict = ControlFailure & { readonly error: Readonly<{ code: ControlConflictCode; retryable: boolean }> };
export type ControlRejection = ControlFailure & { readonly error: Readonly<{ code: Exclude<ControlErrorCode, ControlConflictCode>; retryable: boolean }> };
export type ControlResult = ControlSuccess | ControlFailure;
interface ExecutionContext { tx: PostgresTransaction; command: NormalizedControlCommand; hash: string; session: SessionRow; occurredAt: string }
interface AuthorizationCommand { session_id: string; actor_principal_id?: string | null; target_principal_id?: string | null; force?: boolean }
export interface ControlAuthorizationContext { transaction: PostgresTransaction; command: AuthorizationCommand; session?: { id?: string; status: ConversationSessionStatus; row_version: string | number; control_mode?: ConversationControlMode; generation_version?: string | number }; assignment?: AssignmentRow | null; handoff?: HandoffRow }
type AuthorizationName = 'authorizeRequestHandoff' | 'authorizeTakeover' | 'authorizeTransfer' | 'authorizeRelease' | 'authorizeCancel' | 'authorizeReadCursor' | 'authorizeGenerationInvalidation' | 'authorizeCommunication';
export type ControlAuthorization = Partial<Record<AuthorizationName, (context: ControlAuthorizationContext) => boolean | Promise<boolean>>> & { resolveTimelineAudience?: (context: ControlAuthorizationContext) => 'WORKBENCH' | 'RESTRICTED_ADMIN' | Promise<'WORKBENCH' | 'RESTRICTED_ADMIN'> };
type RealtimeCommand = ReturnType<typeof mapControlRealtime>;
export type ControlRealtimeAppender = (input: { transaction: PostgresTransaction; command: RealtimeCommand }) => unknown | Promise<unknown>;
interface ControlOptions { pool?: PostgresPool; enabled?: boolean; authorize?: ControlAuthorization; realtimeAppender?: ControlRealtimeAppender; now?: () => Date; onInternalError?: ((error: unknown) => void) | null }
type ErrorObservation = { message?: unknown } | null | undefined;
interface PilotPrincipalRow { id: string; is_active: boolean; roles: string[]; teams: string[] }
interface PilotContext { actor: PilotPrincipalRow | null; target: PilotPrincipalRow | null; team: string | null }

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import {
  addEpochMilliseconds,
  assertLocalDateTime,
  formatEpochMsToShanghaiLocal,
  nowShanghaiLocal,
  shanghaiLocalToEpochMs,
} from './platform/time-contract.mjs';

const MIGRATION_URL = new URL('../database/migrations/021_p2_005_conversation_control.sql', import.meta.url);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SCOPE = /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/u;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const CONVERSATION_ASSIGNMENT_STATUSES = Object.freeze(['UNASSIGNED', 'ASSIGNED']);
export const CONVERSATION_HANDOFF_STATUSES = Object.freeze(['REQUESTED', 'ACCEPTED', 'RELEASED', 'CANCELLED']);
export const CONVERSATION_CONTROL_COMMAND_TYPES = Object.freeze(['REQUEST_HANDOFF', 'TAKEOVER', 'TRANSFER', 'RELEASE', 'CANCEL_HANDOFF', 'ADVANCE_READ_CURSOR', 'INVALIDATE_GENERATION']);
export const CONVERSATION_CONTROL_EVENT_TYPES = Object.freeze(['HANDOFF_REQUESTED', 'HANDOFF_ACCEPTED', 'HANDOFF_RELEASED', 'HANDOFF_CANCELLED', 'ASSIGNMENT_ASSIGNED', 'ASSIGNMENT_TRANSFERRED', 'ASSIGNMENT_RELEASED', 'GENERATION_INVALIDATED', 'READ_CURSOR_ADVANCED']);
export const CONVERSATION_GENERATION_INVALIDATION_REASONS = Object.freeze(['HANDOFF_REQUESTED', 'HUMAN_TAKEOVER', 'ASSIGNMENT_TRANSFERRED', 'ASSIGNMENT_RELEASED', 'HANDOFF_CANCELLED', 'ADMIN_CANCELLED', 'TICKET_CRITICAL_STATE_CHANGED', 'USER_MESSAGE_COMMITTED']);
export const CONVERSATION_CONTROL_ERROR_CODES = Object.freeze({
  disabled: 'CONVERSATION_CONTROL_DISABLED', commandInvalid: 'CONVERSATION_CONTROL_COMMAND_INVALID',
  commandConflict: 'CONVERSATION_CONTROL_COMMAND_CONFLICT', sessionNotFound: 'CONVERSATION_CONTROL_SESSION_NOT_FOUND',
  sessionEnded: 'CONVERSATION_CONTROL_SESSION_ENDED', sessionVersionConflict: 'CONVERSATION_CONTROL_SESSION_VERSION_CONFLICT',
  unauthorized: 'CONVERSATION_CONTROL_UNAUTHORIZED', principalInactive: 'CONVERSATION_CONTROL_PRINCIPAL_INACTIVE',
  targetInvalid: 'CONVERSATION_CONTROL_TARGET_INVALID', alreadyAssigned: 'CONVERSATION_CONTROL_ALREADY_ASSIGNED',
  assignmentConflict: 'CONVERSATION_CONTROL_ASSIGNMENT_CONFLICT', handoffNotFound: 'CONVERSATION_CONTROL_HANDOFF_NOT_FOUND',
  handoffStateConflict: 'CONVERSATION_CONTROL_HANDOFF_STATE_CONFLICT', forceTransferForbidden: 'CONVERSATION_CONTROL_FORCE_TRANSFER_FORBIDDEN',
  cursorInvalid: 'CONVERSATION_CONTROL_CURSOR_INVALID', cursorRegression: 'CONVERSATION_CONTROL_CURSOR_REGRESSION',
  cursorAhead: 'CONVERSATION_CONTROL_CURSOR_AHEAD', generationStale: 'CONVERSATION_CONTROL_GENERATION_STALE',
  aiSendForbidden: 'CONVERSATION_CONTROL_AI_SEND_FORBIDDEN', storageFailed: 'CONVERSATION_CONTROL_STORAGE_FAILED',
  schemaDrift: 'P2_005_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
});

const ERROR_SET: ReadonlySet<string> = new Set(Object.values(CONVERSATION_CONTROL_ERROR_CODES));
const COMMAND_SET = new Set(CONVERSATION_CONTROL_COMMAND_TYPES);
const INVALIDATION_SET = new Set(CONVERSATION_GENERATION_INVALIDATION_REASONS);
const COMMAND_KEYS: readonly (keyof NormalizedControlCommand)[] = Object.freeze(['command_type','session_id','client_command_id','idempotency_scope','expected_row_version','expected_cursor_row_version','actor_principal_id','target_principal_id','handoff_id','requested_by_kind','last_read_sequence','reason_code','force','target_mode']);

export class ConversationControlError extends Error {
  declare code: ControlErrorCode;
  constructor(code: string) { super(ERROR_SET.has(code) ? code : CONVERSATION_CONTROL_ERROR_CODES.storageFailed); this.name = 'ConversationControlError'; this.code = this.message as ControlErrorCode; }
}
function fail(code: string = CONVERSATION_CONTROL_ERROR_CODES.commandInvalid): never { throw new ConversationControlError(code); }
function publicError(code: ControlErrorCode, retryable = false) { return Object.freeze({ ok: false as const, error: Object.freeze({ code, retryable }) }); }
function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}
function plainSnapshot(input: unknown, allowed: ReadonlySet<string> | null = null): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || utilTypes.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype || Object.getOwnPropertySymbols(input).length > 0) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input); const out: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (FORBIDDEN_KEYS.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || (allowed && !allowed.has(key))) fail();
    if (key === 'toJSON') fail(); out[key] = descriptor.value;
  }
  return out;
}
function cloneJson(value: unknown, seen: Set<object> = new Set(), depth = 0): CommunicationJson {
  if (depth > 8 || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function' || value === undefined) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail(); return value; }
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) fail();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 200) fail();
      return value.map((_, index) => cloneJson(ownData(value, String(index)), seen, depth + 1));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) fail();
    const snapshot = plainSnapshot(value); const out: Record<string, CommunicationJson> = Object.create(null);
    for (const key of Object.keys(snapshot).sort()) out[key] = cloneJson(snapshot[key], seen, depth + 1);
    return out;
  } finally { seen.delete(value); }
}
function canonical(value: unknown): string { return JSON.stringify(cloneJson(value)) as string; }
function sha(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function uuid(value: unknown, nullable?: false): string;
function uuid(value: unknown, nullable: true): string | null;
function uuid(value: unknown, nullable = false): string | null { if (nullable && (value === null || value === undefined)) return null; if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase(); }
function integer(value: unknown, options?: { minimum?: number; optional?: false }): number;
function integer(value: unknown, options: { minimum?: number; optional: true }): number | null;
function integer(value: unknown, { minimum = 0, optional = false }: { minimum?: number; optional?: boolean } = {}): number | null { if (optional && (value === undefined || value === null)) return null; if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(); return value as number; }
function code(value: unknown): string { if (typeof value !== 'string' || !CODE.test(value)) fail(); return value; }
function iso(value: unknown) { try { return assertLocalDateTime(value); } catch { fail(CONVERSATION_CONTROL_ERROR_CODES.storageFailed); } }
function clockStamp(now: () => Date) { const value = now(); if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0) fail(); return formatEpochMsToShanghaiLocal(String(value.getTime())); }
function expiryFrom(occurredAt: unknown) { return formatEpochMsToShanghaiLocal(addEpochMilliseconds(shanghaiLocalToEpochMs(occurredAt), 7*24*60*60*1000)); }

export function normalizeConversationControlCommand(input: unknown): NormalizedControlCommand {
  const source = plainSnapshot(input, new Set(COMMAND_KEYS));
  for (const key of ['command_type','session_id','client_command_id','idempotency_scope','reason_code']) if (!Object.hasOwn(source, key)) fail();
  const commandType = source.command_type as ConversationControlCommandType;
  if (!COMMAND_SET.has(commandType) || typeof source.idempotency_scope !== 'string' || !SCOPE.test(source.idempotency_scope)) fail();
  const normalized = {
    command_type: commandType, session_id: uuid(source.session_id), client_command_id: uuid(source.client_command_id),
    idempotency_scope: source.idempotency_scope, expected_row_version: integer(source.expected_row_version, { minimum: 1, optional: true }),
    expected_cursor_row_version: integer(source.expected_cursor_row_version, { minimum: 0, optional: true }),
    actor_principal_id: uuid(source.actor_principal_id, true), target_principal_id: uuid(source.target_principal_id, true), handoff_id: uuid(source.handoff_id, true),
    requested_by_kind: source.requested_by_kind ?? null, last_read_sequence: integer(source.last_read_sequence, { optional: true }),
    reason_code: code(source.reason_code), force: source.force ?? false, target_mode: source.target_mode ?? null,
  };
  if (typeof normalized.force !== 'boolean') fail();
  if (normalized.requested_by_kind !== null && !['USER','AI','RULE','AGENT','ADMIN'].includes(normalized.requested_by_kind as string)) fail();
  if (normalized.target_mode !== null && !['HUMAN','COPILOT','AUTO'].includes(normalized.target_mode as string)) fail();
  const cursor = commandType === 'ADVANCE_READ_CURSOR';
  if (cursor) {
    if (normalized.actor_principal_id === null || normalized.last_read_sequence === null || normalized.expected_cursor_row_version === null || normalized.expected_row_version !== null) fail();
  } else if (normalized.expected_row_version === null) fail();
  if (commandType === 'REQUEST_HANDOFF' && normalized.requested_by_kind === null) fail();
  if (['TAKEOVER','TRANSFER'].includes(commandType) && normalized.target_principal_id === null) fail();
  if (commandType === 'TRANSFER' && normalized.actor_principal_id === normalized.target_principal_id) fail(CONVERSATION_CONTROL_ERROR_CODES.targetInvalid);
  if (commandType === 'INVALIDATE_GENERATION' && !INVALIDATION_SET.has(normalized.reason_code)) fail();
  if (['RELEASE','CANCEL_HANDOFF'].includes(commandType) && ['COPILOT','AUTO'].includes(normalized.target_mode as string)) fail(CONVERSATION_CONTROL_ERROR_CODES.aiSendForbidden);
  return Object.freeze(normalized as NormalizedControlCommand);
}

export function computeConversationControlCommandHash(command: ConversationControlCommand | NormalizedControlCommand) {
  const value = normalizeConversationControlCommand(command);
  return sha(['conversation-control-command-v1', ...COMMAND_KEYS.map((key) => value[key])]);
}

function safeAssignment(row: AssignmentViewRow | null | undefined) { return Object.freeze({ assignment_status: row?.assignment_status ?? 'UNASSIGNED', assignment_version: Number(row?.assignment_version ?? 1), assigned: row?.assignment_status === 'ASSIGNED', assigned_at: row?.assigned_at ? iso(row.assigned_at) : null, released_at: row?.released_at ? iso(row.released_at) : null }); }
function safeHandoff(row: HandoffRow | null | undefined) { return row ? Object.freeze({ id: row.id, status: row.status, reason_code: row.reason_code, from_mode: row.from_mode, to_mode: row.to_mode, row_version: Number(row.row_version), requested_at: iso(row.requested_at), accepted_at: row.accepted_at ? iso(row.accepted_at) : null, released_at: row.released_at ? iso(row.released_at) : null, cancelled_at: row.cancelled_at ? iso(row.cancelled_at) : null }) : null; }
function safeCursor(row: CursorRow | null | undefined) { return Object.freeze({ last_read_sequence: Number(row?.last_read_sequence ?? 0), row_version: Number(row?.row_version ?? 0), created_at: row?.created_at ? iso(row.created_at) : null, updated_at: row?.updated_at ? iso(row.updated_at) : null }); }
function safeSession(row: SessionState) { return Object.freeze({ status: row.status, control_mode: row.control_mode, generation_version: Number(row.generation_version), row_version: Number(row.row_version) }); }
function result({ event, session, assignment, handoff, cursor, replayed = false, noOp = false }: ResultInput) { return Object.freeze({ ok: true as const, replayed, no_op: noOp, event: event ? Object.freeze({ id: event.id, event_type: event.event_type, event_ordinal: Number(event.event_ordinal), occurred_at: iso(event.occurred_at) }) : null, session: session ? safeSession(session) : null, assignment: assignment ? safeAssignment(assignment) : null, handoff: safeHandoff(handoff), cursor: cursor ? safeCursor(cursor) : null }); }

async function withTransaction<T>(pool: PostgresPool, run: (tx: PostgresTransaction) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let open = false;
  try { await client.query('BEGIN'); open = true; const value = await run(client); await client.query('COMMIT'); open = false; return value; }
  catch (error) { if (open) await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
async function lockSession(tx: PostgresTransaction, id: string) {
  const selected = await tx.query<SessionRow>('SELECT id::text,status,control_mode,generation_version::text,row_version::text,service_intake_id::text FROM conversation.session WHERE id=$1::uuid FOR UPDATE', [id]);
  if (selected.rowCount !== 1) fail(CONVERSATION_CONTROL_ERROR_CODES.sessionNotFound);
  const row = selected.rows[0] as SessionRow; if (row.status === 'ENDED') fail(CONVERSATION_CONTROL_ERROR_CODES.sessionEnded); return row;
}
function assertVersion(session: SessionState, expected: number | null) { if (Number(session.row_version) !== expected) fail(CONVERSATION_CONTROL_ERROR_CODES.sessionVersionConflict); }
async function currentAssignment(tx: PostgresTransaction, sessionId: string, lock = false) { const q = await tx.query<AssignmentRow>(`SELECT session_id::text,assignment_status,assigned_principal_id::text,assigned_by_principal_id::text,assignment_version::text,assigned_at,released_at,updated_at FROM conversation.assignment WHERE session_id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, [sessionId]); return q.rows[0] ?? null; }
async function activeHandoff(tx: PostgresTransaction, sessionId: string, lock = false) { const q = await tx.query<HandoffRow>(`SELECT id::text,session_id::text,status,requested_by_kind,requested_by_principal_id::text,reason_code,from_mode,to_mode,assigned_principal_id::text,row_version::text,requested_at,accepted_at,released_at,cancelled_at,updated_at FROM conversation.handoff WHERE session_id=$1::uuid AND status IN ('REQUESTED','ACCEPTED') ORDER BY requested_at DESC,row_version DESC,id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [sessionId]); return q.rows[0] ?? null; }
async function eventReplay(tx: PostgresTransaction, command: NormalizedControlCommand, hash: string) {
  const found = await tx.query<ControlEventRow>('SELECT id::text,event_type,event_ordinal::text,command_hash,occurred_at FROM conversation.control_event WHERE idempotency_scope=$1 AND client_command_id=$2::uuid FOR UPDATE', [command.idempotency_scope, command.client_command_id]);
  if (found.rowCount === 0) return null; if ((found.rows[0] as ControlEventRow).command_hash !== hash) fail(CONVERSATION_CONTROL_ERROR_CODES.commandConflict);
  const session = await tx.query<SessionState>('SELECT status,control_mode,generation_version::text,row_version::text FROM conversation.session WHERE id=$1::uuid',[command.session_id]);
  const assignment = await currentAssignment(tx,command.session_id);
  const handoff = await activeHandoff(tx,command.session_id);
  const cursor = command.actor_principal_id ? await tx.query<CursorRow>('SELECT last_read_sequence::text,row_version::text,created_at,updated_at FROM conversation.read_cursor WHERE principal_id=$1::uuid AND session_id=$2::uuid',[command.actor_principal_id,command.session_id]) : {rows:[]};
  return result({ event: (found.rows[0] as ControlEventRow), session: session.rows[0] as SessionState, assignment, handoff, cursor: cursor.rows[0], replayed: true });
}
async function appendControlEvent(tx: PostgresTransaction, command: NormalizedControlCommand, hash: string, fields: EventFields) {
  const ordinal = await tx.query<{ ordinal: number }>('SELECT COALESCE(max(event_ordinal),0)+1 AS ordinal FROM conversation.control_event WHERE session_id=$1::uuid', [command.session_id]);
  const inserted = await tx.query<ControlEventRow>(`INSERT INTO conversation.control_event (session_id,event_ordinal,event_type,idempotency_scope,client_command_id,command_hash,actor_principal_id,target_principal_id,handoff_id,old_assignment_status,new_assignment_status,old_control_mode,new_control_mode,old_read_sequence,new_read_sequence,generation_version_after,session_row_version_after,reason_code,occurred_at) VALUES ($1::uuid,$2,$3,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9::uuid,$10,$11,$12,$13,$14::bigint,$15::bigint,$16::bigint,$17::bigint,$18,$19::timestamp without time zone) RETURNING id::text,event_type,event_ordinal::text,occurred_at`, [command.session_id,(ordinal.rows[0] as { ordinal: number }).ordinal,fields.event_type,command.idempotency_scope,command.client_command_id,hash,command.actor_principal_id,command.target_principal_id,fields.handoff_id ?? command.handoff_id,fields.old_assignment_status ?? null,fields.new_assignment_status ?? null,fields.old_control_mode ?? null,fields.new_control_mode ?? null,fields.old_read_sequence ?? null,fields.new_read_sequence ?? null,fields.generation_version_after,fields.session_row_version_after,command.reason_code,fields.occurred_at]);
  return inserted.rows[0] as ControlEventRow;
}
async function advanceSession(tx: PostgresTransaction, command: NormalizedControlCommand, now: string, { mode = null }: { mode?: ConversationControlMode | null } = {}) {
  const updated = await tx.query<SessionState>(`UPDATE conversation.session SET control_mode=COALESCE($2,control_mode),generation_version=generation_version+1,row_version=row_version+1,updated_at=$3::timestamp without time zone WHERE id=$1::uuid RETURNING status,control_mode,generation_version::text,row_version::text`, [command.session_id,mode,now]); return updated.rows[0] as SessionState;
}
async function authorizeCall(authorize: ControlAuthorization | undefined, name: AuthorizationName, context: ControlAuthorizationContext) { const fn = authorize?.[name]; if (typeof fn !== 'function' || await fn(context) !== true) fail(CONVERSATION_CONTROL_ERROR_CODES.unauthorized); }

export function createDenyAllConversationControlAuthorization(): ControlAuthorization {
  const deny = async () => false;
  return Object.freeze({ authorizeRequestHandoff:deny,authorizeTakeover:deny,authorizeTransfer:deny,authorizeRelease:deny,authorizeCancel:deny,authorizeReadCursor:deny,authorizeGenerationInvalidation:deny,authorizeCommunication:deny });
}

export function createConversationControlService({ pool, enabled = false, authorize = createDenyAllConversationControlAuthorization(), realtimeAppender, now = () => new Date(), onInternalError = null }: ControlOptions = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof enabled !== 'boolean' || typeof realtimeAppender !== 'function' || typeof now !== 'function' || (onInternalError !== null && typeof onInternalError !== 'function')) throw new TypeError('Conversation control service configuration is invalid.');
  const guarded: <T>(operation: () => Promise<T>) => Promise<T | ControlFailure> = async (operation) => { if (!enabled) return publicError(CONVERSATION_CONTROL_ERROR_CODES.disabled); try { return await operation(); } catch (error) { if (onInternalError) onInternalError(error); const codeValue = error instanceof ConversationControlError ? error.code : (error as ErrorObservation)?.message === CONVERSATION_CONTROL_ERROR_CODES.schemaDrift ? (error as { message: ControlErrorCode }).message : CONVERSATION_CONTROL_ERROR_CODES.storageFailed; return publicError(codeValue, codeValue === CONVERSATION_CONTROL_ERROR_CODES.storageFailed); } };
  const stamp = () => clockStamp(now);
  async function execute<K extends ConversationControlCommandType>(input: ControlCommandFor<K>, operation: (context: ExecutionContext) => Promise<ControlSuccess>, transaction: PostgresTransaction | null = null): Promise<ControlResult> {
    const run = async () => {
      const command = normalizeConversationControlCommand(input); const hash = computeConversationControlCommandHash(command);
      const inTransaction = async (tx: PostgresTransaction) => {
        const session = await lockSession(tx, command.session_id);
        const replay = await eventReplay(tx, command, hash); if (replay) return replay;
        if (command.command_type !== 'ADVANCE_READ_CURSOR') assertVersion(session, command.expected_row_version);
        return operation({ tx, command, hash, session, occurredAt: stamp() });
      };
      return transaction === null ? withTransaction(pool as PostgresPool, inTransaction) : inTransaction(transaction);
    };
    if (transaction !== null) {
      if (!enabled) fail(CONVERSATION_CONTROL_ERROR_CODES.disabled);
      return run();
    }
    return guarded(run);
  }
  async function appendRealtime(tx: PostgresTransaction, commands: readonly RealtimeCommand[]) { for (const command of commands) await (realtimeAppender as ControlRealtimeAppender)({ transaction: tx, command }); }
  function projectionContext(event: ControlEventRow & { session_id?: string }, session: SessionState, occurredAt: string) { return { event, session_id: event.session_id ?? null, session, occurred_at: occurredAt, expires_at: expiryFrom(occurredAt) }; }

  async function requestHandoff(input: ControlCommandFor<'REQUEST_HANDOFF'>) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    await authorizeCall(authorize,'authorizeRequestHandoff',{transaction:tx,command,session}); if (await activeHandoff(tx,command.session_id,true)) fail(CONVERSATION_CONTROL_ERROR_CODES.handoffStateConflict);
    const inserted = await tx.query<HandoffRow>(`INSERT INTO conversation.handoff (session_id,status,requested_by_kind,requested_by_principal_id,reason_code,from_mode,to_mode,request_command_id,request_hash,requested_at,updated_at) VALUES ($1::uuid,'REQUESTED',$2,$3::uuid,$4,$5,'HUMAN',$6::uuid,$7,$8::timestamp without time zone,$8::timestamp without time zone) RETURNING id::text,status,reason_code,from_mode,to_mode,row_version::text,requested_at,accepted_at,released_at,cancelled_at`,[command.session_id,command.requested_by_kind,command.actor_principal_id,command.reason_code,session.control_mode,command.client_command_id,hash,occurredAt]);
    const next = await advanceSession(tx,command,occurredAt); const event = await appendControlEvent(tx,command,hash,{event_type:'HANDOFF_REQUESTED',handoff_id:(inserted.rows[0] as HandoffRow).id,old_control_mode:session.control_mode,new_control_mode:next.control_mode,generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt});
    await appendRealtime(tx,[mapControlRealtime('conversation.handoff.requested','HANDOFF_EVENT',(inserted.rows[0] as HandoffRow).id,'HANDOFF_REQUESTED','CONVERSATION_HANDOFF',command.session_id,next,{handoff_status:'REQUESTED',handoff_row_version:1},occurredAt)]);
    return result({event,session:next,assignment:await currentAssignment(tx,command.session_id),handoff:(inserted.rows[0] as HandoffRow)});
  }); }

  async function takeoverSession(input: ControlCommandFor<'TAKEOVER'>, transaction: PostgresTransaction | null = null) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    const assignment = await currentAssignment(tx,command.session_id,true); if (assignment?.assignment_status==='ASSIGNED' && assignment.assigned_principal_id===command.target_principal_id) return result({session,assignment,handoff:await activeHandoff(tx,command.session_id,true),replayed:true,noOp:true});
    await authorizeCall(authorize,'authorizeTakeover',{transaction:tx,command,session,assignment}); if (assignment?.assignment_status==='ASSIGNED') fail(CONVERSATION_CONTROL_ERROR_CODES.alreadyAssigned);
    const handoff = await activeHandoff(tx,command.session_id,true); if (command.handoff_id && handoff?.id!==command.handoff_id) fail(CONVERSATION_CONTROL_ERROR_CODES.handoffNotFound);
    const nextAssignment = await tx.query<AssignmentViewRow>(`INSERT INTO conversation.assignment (session_id,assignment_status,assigned_principal_id,assigned_by_principal_id,assignment_version,assigned_at,released_at,updated_at) VALUES ($1::uuid,'ASSIGNED',$2::uuid,$3::uuid,1,$4::timestamp without time zone,NULL,$4::timestamp without time zone) ON CONFLICT (session_id) DO UPDATE SET assignment_status='ASSIGNED',assigned_principal_id=EXCLUDED.assigned_principal_id,assigned_by_principal_id=EXCLUDED.assigned_by_principal_id,assignment_version=conversation.assignment.assignment_version+1,assigned_at=EXCLUDED.assigned_at,released_at=NULL,updated_at=EXCLUDED.updated_at RETURNING assignment_status,assigned_principal_id::text,assignment_version::text,assigned_at,released_at`,[command.session_id,command.target_principal_id,command.actor_principal_id,occurredAt]);
    let nextHandoff=handoff; if(handoff){ const q=await tx.query<HandoffRow>(`UPDATE conversation.handoff SET status='ACCEPTED',assigned_principal_id=$2::uuid,row_version=row_version+1,accepted_at=$3::timestamp without time zone,updated_at=$3::timestamp without time zone WHERE id=$1::uuid AND status='REQUESTED' RETURNING id::text,status,reason_code,from_mode,to_mode,row_version::text,requested_at,accepted_at,released_at,cancelled_at`,[handoff.id,command.target_principal_id,occurredAt]); if(q.rowCount!==1) fail(CONVERSATION_CONTROL_ERROR_CODES.handoffStateConflict); nextHandoff=q.rows[0] as HandoffRow; }
    const next=await advanceSession(tx,command,occurredAt,{mode:'HUMAN'}); const event=await appendControlEvent(tx,command,hash,{event_type:handoff?'HANDOFF_ACCEPTED':'ASSIGNMENT_ASSIGNED',handoff_id:handoff?.id,old_assignment_status:assignment?.assignment_status??'UNASSIGNED',new_assignment_status:'ASSIGNED',old_control_mode:session.control_mode,new_control_mode:'HUMAN',generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt});
    const events=[mapControlRealtime('conversation.assigned','HANDOFF_EVENT',event.id,'ASSIGNMENT_ASSIGNED','CONVERSATION_SESSION',command.session_id,next,{assignment_status:'ASSIGNED',assignment_version:Number((nextAssignment.rows[0] as AssignmentViewRow).assignment_version)},occurredAt)];
    if(handoff) events.push(mapControlRealtime('conversation.handoff.accepted','HANDOFF_EVENT',handoff.id,'HANDOFF_ACCEPTED','CONVERSATION_HANDOFF',command.session_id,next,{handoff_status:'ACCEPTED',handoff_row_version:Number((nextHandoff as HandoffRow).row_version)},occurredAt));
    if(session.control_mode!=='HUMAN') events.push(mapControlRealtime('conversation.mode.changed','CONVERSATION_SESSION',command.session_id,'MODE_HUMAN','CONVERSATION_SESSION',command.session_id,next,{control_mode:'HUMAN'},occurredAt));
    await appendRealtime(tx,events); return result({event,session:next,assignment:(nextAssignment.rows[0] as AssignmentViewRow),handoff:nextHandoff});
  }, transaction); }

  async function transferAssignment(input: ControlCommandFor<'TRANSFER'>) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    const assignment=await currentAssignment(tx,command.session_id,true); if(!assignment||assignment.assignment_status!=='ASSIGNED') fail(CONVERSATION_CONTROL_ERROR_CODES.assignmentConflict); if(assignment.assigned_principal_id===command.target_principal_id) fail(CONVERSATION_CONTROL_ERROR_CODES.targetInvalid);
    await authorizeCall(authorize,'authorizeTransfer',{transaction:tx,command,session,assignment});
    const updated=await tx.query<AssignmentViewRow>(`UPDATE conversation.assignment SET assigned_principal_id=$2::uuid,assigned_by_principal_id=$3::uuid,assignment_version=assignment_version+1,assigned_at=$4::timestamp without time zone,released_at=NULL,updated_at=$4::timestamp without time zone WHERE session_id=$1::uuid RETURNING assignment_status,assigned_principal_id::text,assignment_version::text,assigned_at,released_at`,[command.session_id,command.target_principal_id,command.actor_principal_id,occurredAt]);
    const next=await advanceSession(tx,command,occurredAt,{mode:'HUMAN'}); const event=await appendControlEvent(tx,command,hash,{event_type:'ASSIGNMENT_TRANSFERRED',old_assignment_status:'ASSIGNED',new_assignment_status:'ASSIGNED',old_control_mode:session.control_mode,new_control_mode:'HUMAN',generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt});
    await appendRealtime(tx,[mapControlRealtime('conversation.assigned','HANDOFF_EVENT',event.id,'ASSIGNMENT_TRANSFERRED','CONVERSATION_SESSION',command.session_id,next,{assignment_status:'ASSIGNED',assignment_version:Number((updated.rows[0] as AssignmentViewRow).assignment_version)},occurredAt)]); return result({event,session:next,assignment:(updated.rows[0] as AssignmentViewRow),handoff:await activeHandoff(tx,command.session_id)});
  }); }

  async function releaseAssignment(input: ControlCommandFor<'RELEASE'>) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    const assignment=await currentAssignment(tx,command.session_id,true); if(!assignment||assignment.assignment_status!=='ASSIGNED') fail(CONVERSATION_CONTROL_ERROR_CODES.assignmentConflict); await authorizeCall(authorize,'authorizeRelease',{transaction:tx,command,session,assignment});
    const updated=await tx.query<AssignmentViewRow>(`UPDATE conversation.assignment SET assignment_status='UNASSIGNED',assigned_principal_id=NULL,assigned_by_principal_id=$2::uuid,assignment_version=assignment_version+1,assigned_at=NULL,released_at=$3::timestamp without time zone,updated_at=$3::timestamp without time zone WHERE session_id=$1::uuid RETURNING assignment_status,assignment_version::text,assigned_at,released_at`,[command.session_id,command.actor_principal_id,occurredAt]);
    const handoff=await activeHandoff(tx,command.session_id,true); let nextHandoff=handoff; if(handoff?.status==='ACCEPTED'){ const q=await tx.query<HandoffRow>(`UPDATE conversation.handoff SET status='RELEASED',row_version=row_version+1,released_at=$2::timestamp without time zone,updated_at=$2::timestamp without time zone WHERE id=$1::uuid RETURNING id::text,status,reason_code,from_mode,to_mode,row_version::text,requested_at,accepted_at,released_at,cancelled_at`,[handoff.id,occurredAt]); nextHandoff=q.rows[0] as HandoffRow; }
    const next=await advanceSession(tx,command,occurredAt,{mode:'HUMAN'}); const event=await appendControlEvent(tx,command,hash,{event_type:'ASSIGNMENT_RELEASED',handoff_id:handoff?.id,old_assignment_status:'ASSIGNED',new_assignment_status:'UNASSIGNED',old_control_mode:session.control_mode,new_control_mode:'HUMAN',generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt});
    await appendRealtime(tx,[mapControlRealtime('conversation.assigned','HANDOFF_EVENT',event.id,'ASSIGNMENT_RELEASED','CONVERSATION_SESSION',command.session_id,next,{assignment_status:'UNASSIGNED',assignment_version:Number((updated.rows[0] as AssignmentViewRow).assignment_version)},occurredAt)]); return result({event,session:next,assignment:(updated.rows[0] as AssignmentViewRow),handoff:nextHandoff});
  }); }

  async function cancelHandoff(input: ControlCommandFor<'CANCEL_HANDOFF'>) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    const handoff=await activeHandoff(tx,command.session_id,true); if(!handoff) fail(CONVERSATION_CONTROL_ERROR_CODES.handoffNotFound); if(handoff.status!=='REQUESTED'||(command.handoff_id&&command.handoff_id!==handoff.id)) fail(CONVERSATION_CONTROL_ERROR_CODES.handoffStateConflict); await authorizeCall(authorize,'authorizeCancel',{transaction:tx,command,session,handoff});
    const updated=await tx.query<HandoffRow>(`UPDATE conversation.handoff SET status='CANCELLED',row_version=row_version+1,cancelled_at=$2::timestamp without time zone,updated_at=$2::timestamp without time zone WHERE id=$1::uuid RETURNING id::text,status,reason_code,from_mode,to_mode,row_version::text,requested_at,accepted_at,released_at,cancelled_at`,[handoff.id,occurredAt]);
    const next=await advanceSession(tx,command,occurredAt); const event=await appendControlEvent(tx,command,hash,{event_type:'HANDOFF_CANCELLED',handoff_id:handoff.id,old_control_mode:session.control_mode,new_control_mode:next.control_mode,generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt});
    await appendRealtime(tx,[mapControlRealtime('conversation.handoff.requested','HANDOFF_EVENT',handoff.id,'HANDOFF_CANCELLED','CONVERSATION_HANDOFF',command.session_id,next,{handoff_status:'CANCELLED',handoff_row_version:Number((updated.rows[0] as HandoffRow).row_version)},occurredAt)]); return result({event,session:next,assignment:await currentAssignment(tx,command.session_id),handoff:updated.rows[0] as HandoffRow});
  }); }

  async function advanceReadCursor(input: ControlCommandFor<'ADVANCE_READ_CURSOR'>) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    await authorizeCall(authorize,'authorizeReadCursor',{transaction:tx,command,session}); const existingQ=await tx.query<CursorRow>('SELECT last_read_sequence::text,row_version::text,created_at,updated_at FROM conversation.read_cursor WHERE principal_id=$1::uuid AND session_id=$2::uuid FOR UPDATE',[command.actor_principal_id,command.session_id]); const existing=existingQ.rows[0]??null;
    if(existing && Number(existing.row_version)!==command.expected_cursor_row_version) fail(CONVERSATION_CONTROL_ERROR_CODES.cursorInvalid); if(!existing&&command.expected_cursor_row_version!==0) fail(CONVERSATION_CONTROL_ERROR_CODES.cursorInvalid); if(existing&&(command.last_read_sequence as number)<=Number(existing.last_read_sequence)) return result({session,assignment:await currentAssignment(tx,command.session_id),handoff:await activeHandoff(tx,command.session_id),cursor:existing,replayed:true,noOp:true});
    const visibility=await authorize?.resolveTimelineAudience?.({transaction:tx,command,session})??'WORKBENCH'; const maxQ=await tx.query<{ maximum: string }>(`SELECT COALESCE(max(sequence_no),0)::text AS maximum FROM conversation.item WHERE session_id=$1::uuid AND (visibility='EXTERNAL' OR ($2 IN ('WORKBENCH','RESTRICTED_ADMIN') AND visibility='INTERNAL') OR ($2='RESTRICTED_ADMIN' AND visibility='RESTRICTED'))`,[command.session_id,visibility]); if((command.last_read_sequence as number)>Number((maxQ.rows[0] as { maximum: string }).maximum)) fail(CONVERSATION_CONTROL_ERROR_CODES.cursorAhead);
    const cursorQ=await tx.query<CursorRow>(`INSERT INTO conversation.read_cursor (principal_id,session_id,last_read_sequence,row_version,created_at,updated_at) VALUES ($1::uuid,$2::uuid,$3::bigint,1,$4::timestamp without time zone,$4::timestamp without time zone) ON CONFLICT (principal_id,session_id) DO UPDATE SET last_read_sequence=GREATEST(conversation.read_cursor.last_read_sequence,EXCLUDED.last_read_sequence),row_version=CASE WHEN EXCLUDED.last_read_sequence>conversation.read_cursor.last_read_sequence THEN conversation.read_cursor.row_version+1 ELSE conversation.read_cursor.row_version END,updated_at=CASE WHEN EXCLUDED.last_read_sequence>conversation.read_cursor.last_read_sequence THEN EXCLUDED.updated_at ELSE conversation.read_cursor.updated_at END RETURNING last_read_sequence::text,row_version::text,created_at,updated_at`,[command.actor_principal_id,command.session_id,command.last_read_sequence,occurredAt]);
    const cursor=(cursorQ.rows[0] as CursorRow); const event=await appendControlEvent(tx,command,hash,{event_type:'READ_CURSOR_ADVANCED',old_read_sequence:existing?.last_read_sequence??0,new_read_sequence:cursor.last_read_sequence,generation_version_after:session.generation_version,session_row_version_after:session.row_version,occurred_at:occurredAt});
    await appendRealtime(tx,[mapControlRealtime('conversation.read_cursor.changed','READ_CURSOR',event.id,'READ_CURSOR_ADVANCED','CONVERSATION_READ_CURSOR',command.session_id,session,{cursor_row_version:Number(cursor.row_version),last_read_sequence:Number(cursor.last_read_sequence)},occurredAt)]); return result({event,session,assignment:await currentAssignment(tx,command.session_id),handoff:await activeHandoff(tx,command.session_id),cursor});
  }); }

  async function invalidateGeneration(input: ControlCommandFor<'INVALIDATE_GENERATION'>) { return execute(input, async ({tx,command,hash,session,occurredAt}) => {
    await authorizeCall(authorize,'authorizeGenerationInvalidation',{transaction:tx,command,session}); const next=await advanceSession(tx,command,occurredAt); const event=await appendControlEvent(tx,command,hash,{event_type:'GENERATION_INVALIDATED',old_control_mode:session.control_mode,new_control_mode:next.control_mode,generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt});
    await appendRealtime(tx,[mapControlRealtime('conversation.session.updated','CONVERSATION_SESSION',event.id,'GENERATION_INVALIDATED','CONVERSATION_SESSION',command.session_id,next,{session_row_version:Number(next.row_version),generation_version:Number(next.generation_version)},occurredAt)]); return result({event,session:next,assignment:await currentAssignment(tx,command.session_id),handoff:await activeHandoff(tx,command.session_id)});
  }); }

  async function getAssignment({sessionId,actor}: { sessionId: string; actor: { principal_id: string } }) { return guarded(async()=>{ const id=uuid(sessionId); return withTransaction(pool as PostgresPool,async tx=>{const session=await lockSession(tx,id); await authorizeCall(authorize,'authorizeReadCursor',{transaction:tx,command:{actor_principal_id:uuid(actor?.principal_id),session_id:id},session}); return Object.freeze({ok:true as const,assignment:safeAssignment(await currentAssignment(tx,id))});});}); }
  async function getHandoff({sessionId,actor}: { sessionId: string; actor: { principal_id: string } }) { return guarded(async()=>{ const id=uuid(sessionId); return withTransaction(pool as PostgresPool,async tx=>{const session=await lockSession(tx,id); await authorizeCall(authorize,'authorizeReadCursor',{transaction:tx,command:{actor_principal_id:uuid(actor?.principal_id),session_id:id},session}); return Object.freeze({ok:true as const,handoff:safeHandoff(await activeHandoff(tx,id))});});}); }
  async function getReadCursor({sessionId,principalId}: { sessionId: string; principalId: string }) { return guarded(async()=>{const id=uuid(sessionId),pid=uuid(principalId);const q=await (pool as PostgresPool).query<CursorRow>('SELECT last_read_sequence::text,row_version::text,created_at,updated_at FROM conversation.read_cursor WHERE principal_id=$1::uuid AND session_id=$2::uuid',[pid,id]);return Object.freeze({ok:true as const,cursor:safeCursor(q.rows[0])});}); }
  async function countUnreadItems({sessionId,principalId,audience='WORKBENCH'}: { sessionId: string; principalId: string; audience?: 'EXTERNAL' | 'WORKBENCH' | 'RESTRICTED_ADMIN' }) { return guarded(async()=>{const id=uuid(sessionId),pid=uuid(principalId);if(!['EXTERNAL','WORKBENCH','RESTRICTED_ADMIN'].includes(audience)) fail(CONVERSATION_CONTROL_ERROR_CODES.cursorInvalid);const q=await (pool as PostgresPool).query<{ unread_count: number }>(`SELECT count(*)::integer AS unread_count FROM conversation.item i LEFT JOIN conversation.read_cursor c ON c.session_id=i.session_id AND c.principal_id=$2::uuid WHERE i.session_id=$1::uuid AND i.sequence_no>COALESCE(c.last_read_sequence,0) AND (i.visibility='EXTERNAL' OR ($3 IN ('WORKBENCH','RESTRICTED_ADMIN') AND i.visibility='INTERNAL') OR ($3='RESTRICTED_ADMIN' AND i.visibility='RESTRICTED'))`,[id,pid,audience]);return Object.freeze({ok:true as const,unread_count:(q.rows[0] as { unread_count: number }).unread_count});}); }
  async function takeoverSessionInTransaction({ transaction, command }: { transaction: PostgresTransaction; command: ControlCommandFor<'TAKEOVER'> }) {
    if (!transaction || typeof transaction.query !== 'function'
      || normalizeConversationControlCommand(command).command_type !== 'TAKEOVER') fail();
    return takeoverSession(command, transaction);
  }
  return Object.freeze({requestHandoff,takeoverSession,takeoverSessionInTransaction,transferAssignment,releaseAssignment,cancelHandoff,advanceReadCursor,invalidateGeneration,getAssignment,getHandoff,getReadCursor,countUnreadItems});
}

function mapControlRealtime(eventType: string,sourceType: string,sourceId: string,variant: string,aggregateType: string,aggregateId: string,session: SessionState,payload: Record<string, unknown>,occurredAt: string) {
  const expiresAt=expiryFrom(occurredAt); return Object.freeze({schema_version:1,publisher_name:'P2_005_CONVERSATION_CONTROL',publisher_version:'1.0.0',source_type:sourceType,source_id:sourceId,event_variant:variant,event_type:eventType,aggregate_type:aggregateType,aggregate_id:aggregateId,aggregate_version:String(session.row_version),authorization_scope_type:'SESSION',authorization_scope_id:aggregateId,visibility_scope:'WORKBENCH',payload:Object.freeze({...payload,session_row_version:Number(session.row_version),generation_version:Number(session.generation_version)}),occurred_at:occurredAt,expires_at:expiresAt});
}

export async function captureGenerationFence({transaction,sessionId}: { transaction: PostgresTransaction; sessionId: string }) { const selected=await transaction.query<Pick<SessionRow, 'id' | 'status' | 'control_mode' | 'generation_version'>>('SELECT id::text,status,control_mode,generation_version::text FROM conversation.session WHERE id=$1::uuid',[uuid(sessionId)]); if(selected.rowCount!==1) fail(CONVERSATION_CONTROL_ERROR_CODES.sessionNotFound); const row=selected.rows[0] as Pick<SessionRow, 'id' | 'status' | 'control_mode' | 'generation_version'>; if(row.status==='ENDED') fail(CONVERSATION_CONTROL_ERROR_CODES.sessionEnded); return Object.freeze({session_id:row.id,generation_version_at_start:Number(row.generation_version),control_mode:row.control_mode,captured_at:nowShanghaiLocal()}); }
export async function assertGenerationFence({transaction,sessionId,generationVersionAtStart,allowedModes}: { transaction: PostgresTransaction; sessionId: string; generationVersionAtStart: number | undefined; allowedModes: readonly ConversationControlMode[] }) { const expected=integer(generationVersionAtStart,{minimum:1}); if(!Array.isArray(allowedModes)||allowedModes.some(mode=>!['HUMAN','COPILOT','AUTO'].includes(mode))) fail(); const q=await transaction.query<Pick<SessionState, 'status' | 'control_mode' | 'generation_version'>>('SELECT status,control_mode,generation_version::text FROM conversation.session WHERE id=$1::uuid FOR UPDATE',[uuid(sessionId)]); if(q.rowCount!==1) fail(CONVERSATION_CONTROL_ERROR_CODES.sessionNotFound); const row=q.rows[0] as Pick<SessionState, 'status' | 'control_mode' | 'generation_version'>; if(row.status==='ENDED') fail(CONVERSATION_CONTROL_ERROR_CODES.sessionEnded); if(Number(row.generation_version)!==expected) return Object.freeze({ok:false,status:'STALE',error:Object.freeze({code:CONVERSATION_CONTROL_ERROR_CODES.generationStale,retryable:false})}); if(!allowedModes.includes(row.control_mode)||row.control_mode==='HUMAN') return publicError(CONVERSATION_CONTROL_ERROR_CODES.aiSendForbidden); return Object.freeze({ok:true as const,status:'CURRENT',generation_version:expected,control_mode:row.control_mode}); }
export async function invalidateGenerationFence({transaction,sessionId,expectedRowVersion,reason,actor,clientCommandId,realtimeAppender,now=()=>new Date()}: { transaction: PostgresTransaction; sessionId: string; expectedRowVersion: number; reason: string; actor: { principal_id: string } | null; clientCommandId: string; realtimeAppender: ControlRealtimeAppender; now?: () => Date }) {
  if(!transaction||typeof transaction.query!=='function'||typeof realtimeAppender!=='function'||typeof now!=='function') fail();
  const command=normalizeConversationControlCommand({command_type:'INVALIDATE_GENERATION',session_id:sessionId,client_command_id:clientCommandId,idempotency_scope:'GENERATION_FENCE',expected_row_version:expectedRowVersion,actor_principal_id:actor?.principal_id??null,reason_code:reason});
  const hash=computeConversationControlCommandHash(command); const session=await lockSession(transaction,command.session_id); const replay=await eventReplay(transaction,command,hash); if(replay)return replay; assertVersion(session,command.expected_row_version); const occurredAt=clockStamp(now); const next=await advanceSession(transaction,command,occurredAt); const event=await appendControlEvent(transaction,command,hash,{event_type:'GENERATION_INVALIDATED',old_control_mode:session.control_mode,new_control_mode:next.control_mode,generation_version_after:next.generation_version,session_row_version_after:next.row_version,occurred_at:occurredAt}); await (realtimeAppender as ControlRealtimeAppender)({transaction,command:mapControlRealtime('conversation.session.updated','CONVERSATION_SESSION',event.id,'GENERATION_INVALIDATED','CONVERSATION_SESSION',command.session_id,next,{session_row_version:Number(next.row_version),generation_version:Number(next.generation_version)},occurredAt)}); return result({event,session:next,assignment:await currentAssignment(transaction,command.session_id),handoff:await activeHandoff(transaction,command.session_id)});
}

async function loadPilotPrincipal(transaction: PostgresTransaction,id: string) { const q=await transaction.query<PilotPrincipalRow>(`SELECT p.id::text,p.is_active,COALESCE(array_agg(DISTINCT r.role) FILTER(WHERE r.role IS NOT NULL),'{}') roles,COALESCE(array_agg(DISTINCT m.team_id) FILTER(WHERE m.team_id IS NOT NULL),'{}') teams FROM pilot_ticket.pilot_principal p LEFT JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id LEFT JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id WHERE p.id=$1::uuid GROUP BY p.id`,[id]); return q.rows[0]??null; }
async function resolverTeam(transaction: PostgresTransaction,sessionId: string) { const q=await transaction.query<{ resolver_team_id: string | null }>(`SELECT t.resolver_team_id FROM conversation.session s LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=s.service_intake_id WHERE s.id=$1::uuid`,[sessionId]); return q.rows[0]?.resolver_team_id??null; }
export function createPilotConversationControlAuthorization({pool}: { pool?: PostgresTransaction }={}): ControlAuthorization {
  if(!pool||typeof pool.query!=='function') throw new TypeError('A PostgreSQL pool is required.');
  async function context({transaction,command}: ControlAuthorizationContext): Promise<PilotContext> { const actor=command.actor_principal_id?await loadPilotPrincipal(transaction,command.actor_principal_id):null; const target=command.target_principal_id?await loadPilotPrincipal(transaction,command.target_principal_id):null; const team=await resolverTeam(transaction,command.session_id); return {actor,target,team}; }
  function activeWorker(p: PilotPrincipalRow | null | undefined): p is PilotPrincipalRow{return p?.is_active===true&&p.roles.some(role=>['HANDLER','DISPATCHER','ADMIN'].includes(role));}
  function actorCan(c: PilotContext,{allowHandler=true}={}): c is PilotContext & { actor: PilotPrincipalRow }{if(!activeWorker(c.actor))return false;if(c.actor.roles.includes('ADMIN')||c.actor.roles.includes('DISPATCHER'))return true;return allowHandler&&c.actor.roles.includes('HANDLER')&&c.team!==null&&c.actor.teams.includes(c.team);}
  async function ordinary(input: ControlAuthorizationContext,{target=false,allowHandler=true}={}){const c=await context(input);return actorCan(c,{allowHandler})&&(!target||activeWorker(c.target));}
  return Object.freeze<ControlAuthorization>({
    authorizeRequestHandoff:input=>ordinary(input), authorizeTakeover:input=>ordinary(input,{target:true}),
    authorizeTransfer:async input=>{const c=await context(input);if(input.command.force&&!c.actor?.roles.includes('ADMIN'))fail(CONVERSATION_CONTROL_ERROR_CODES.forceTransferForbidden);return actorCan(c)&&activeWorker(c.target);},
    authorizeRelease:async input=>{const c=await context(input);return actorCan(c)&&(c.actor.roles.some(r=>['ADMIN','DISPATCHER'].includes(r))||input.assignment?.assigned_principal_id===c.actor.id);},
    authorizeCancel:input=>ordinary(input), authorizeReadCursor:async input=>{const c=await context(input);return activeWorker(c.actor);},
    resolveTimelineAudience:async input=>{const c=await context(input);return c.actor?.roles.includes('ADMIN')?'RESTRICTED_ADMIN':'WORKBENCH';},
    authorizeGenerationInvalidation:input=>ordinary(input), authorizeCommunication:input=>ordinary(input),
  });
}

export function createAssignedCommunicationAuthorizer({controlService,featureFlags={},authorization}: { controlService?: object; featureFlags?: { AI_CONVERSATION_ENABLED?: boolean; AI_AUTO_REPLY_ENABLED?: boolean }; authorization?: ControlAuthorization }={}): (context: CommunicationAuthorizationContext) => Promise<boolean> {
  if(!controlService||typeof controlService!=='object') throw new TypeError('controlService is required.');
  return async ({transaction,command,actor,session}: CommunicationAuthorizationContext)=>{
    try {
      if(command.purpose==='SYSTEM_NOTIFICATION') return false;
      if(command.sender_kind==='AI') {
        if(featureFlags.AI_CONVERSATION_ENABLED!==true||featureFlags.AI_AUTO_REPLY_ENABLED!==true||session.control_mode==='HUMAN') return false;
        const fence=await assertGenerationFence({transaction,sessionId:command.session_id as string,generationVersionAtStart:actor?.generation_version_at_start,allowedModes:['COPILOT','AUTO']}); return fence.ok===true;
      }
      const principalId=uuid(actor?.principal_id); const principal=await loadPilotPrincipal(transaction,principalId); if(!principal?.is_active) return false;
      const q=await transaction.query<{ assigned_principal_id: string }>('SELECT assigned_principal_id::text FROM conversation.assignment WHERE session_id=$1::uuid AND assignment_status=\'ASSIGNED\'',[command.session_id]);
      if(q.rowCount===1&&(q.rows[0] as { assigned_principal_id: string }).assigned_principal_id===principalId)return true;
      return actor?.admin_override===true&&principal.roles.includes('ADMIN')&&await authorization?.authorizeCommunication?.({transaction,command:{...command,actor_principal_id:principalId,session_id:command.session_id as string}})===true;
    } catch { return false; }
  };
}

export async function applyConversationControlMigration({pool}: { pool: PostgresTransaction }) { if(!pool||typeof pool.query!=='function') throw new TypeError('A PostgreSQL pool is required.'); if(await arch005MigrationApplied(pool)) return Object.freeze({status:'LEGACY_MIGRATION_SUPERSEDED'}); const sql=await readFile(MIGRATION_URL,'utf8'); try{await pool.query(sql);}catch(error){if((error as ErrorObservation)?.message===CONVERSATION_CONTROL_ERROR_CODES.schemaDrift)throw new ConversationControlError(CONVERSATION_CONTROL_ERROR_CODES.schemaDrift);throw error;} }
