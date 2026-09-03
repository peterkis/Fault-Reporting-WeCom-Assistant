import { WORKBENCH_ERROR_CODES, WorkbenchError } from './p2-006-workbench-query.mjs';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMMAND_ACTION = Object.freeze({
  REQUEST_HANDOFF: 'REQUEST_HANDOFF', TAKEOVER: 'TAKEOVER', TRANSFER: 'TRANSFER', RELEASE: 'RELEASE',
  CANCEL_HANDOFF: 'CANCEL_HANDOFF', ADVANCE_READ_CURSOR: 'READ_CURSOR',
});

function invalid() { throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400); }
function uuid(value) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(); return value.toLowerCase(); }
function code(value, fallback) { const actual = value ?? fallback; if (typeof actual !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(actual)) invalid(); return actual; }
function version(value, { zero = false } = {}) { if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) invalid(); return value; }
function text(value) { if (typeof value !== 'string' || value.length < 1 || value.length > 20_480) invalid(); return value; }

function mapPortFailure(result) {
  if (result?.ok !== false) return result;
  const codeValue = result.error?.code ?? '';
  if (/VERSION|CONFLICT|ALREADY|CURSOR_AHEAD|STALE/u.test(codeValue)) throw new WorkbenchError(WORKBENCH_ERROR_CODES.versionConflict, 409);
  if (/UNAUTHORIZED|FORBIDDEN/u.test(codeValue)) throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
  if (/NOT_FOUND/u.test(codeValue)) throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound, 404);
  if (/DISABLED/u.test(codeValue)) throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled, 503);
  throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400);
}

export function createConversationWorkbenchCommandFacade({ controlService, communicationService, deliveryControl, authorize, enabled = false, now = () => new Date() } = {}) {
  if (!controlService || !communicationService || !deliveryControl || !authorize || typeof enabled !== 'boolean' || typeof now !== 'function') {
    throw new TypeError('Workbench command facade configuration is invalid.');
  }
  function retention() {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0) invalid();
    const epochMs = String(value.getTime() + 30 * 24 * 60 * 60 * 1000);
    return Object.freeze({ retention_until: formatEpochMsToShanghaiLocal(epochMs), retention_until_epoch_ms: epochMs });
  }
  function guard() { if (!enabled) throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled, 503); }
  async function principal(authContext) {
    const value = await authorize.resolvePrincipal(authContext);
    if (value === null) throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    return value;
  }

  async function control({ authContext, sessionId, commandType, body }) {
    guard();
    const actor = await principal(authContext);
    const id = uuid(sessionId);
    const action = COMMAND_ACTION[commandType];
    if (!action) invalid();
    const force = body.force === true;
    const authorizationAction = force && commandType === 'TRANSFER' ? 'FORCE_TRANSFER' : action;
    if (!await authorize.authorizeSession({ principal: actor, sessionId: id, action: authorizationAction })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound, 404);
    }
    const common = {
      command_type: commandType, session_id: id, client_command_id: uuid(body.client_command_id),
      idempotency_scope: `WORKBENCH_${commandType}`, actor_principal_id: actor.principal_id,
      reason_code: code(body.reason_code, `WORKBENCH_${commandType}`),
    };
    let result;
    if (commandType === 'ADVANCE_READ_CURSOR') {
      result = await controlService.advanceReadCursor({ ...common,
        expected_cursor_row_version: version(body.expected_cursor_row_version, { zero: true }),
        last_read_sequence: Number(body.last_read_sequence),
      });
    } else {
      const command = { ...common, expected_row_version: version(body.expected_row_version) };
      if (commandType === 'REQUEST_HANDOFF') {
        command.requested_by_kind = 'AGENT';
        result = await controlService.requestHandoff(command);
      } else if (commandType === 'TAKEOVER') {
        command.target_principal_id = uuid(body.target_principal_id ?? actor.principal_id);
        command.handoff_id = body.handoff_id ? uuid(body.handoff_id) : null;
        result = await controlService.takeoverSession(command);
      } else if (commandType === 'TRANSFER') {
        command.target_principal_id = uuid(body.target_principal_id);
        command.force = force;
        result = await controlService.transferAssignment(command);
      } else if (commandType === 'RELEASE') {
        result = await controlService.releaseAssignment(command);
      } else if (commandType === 'CANCEL_HANDOFF') {
        command.handoff_id = body.handoff_id ? uuid(body.handoff_id) : null;
        result = await controlService.cancelHandoff(command);
      }
    }
    return mapPortFailure(result);
  }

  async function reply({ authContext, sessionId, body }) {
    guard();
    const actor = await principal(authContext);
    const id = uuid(sessionId);
    if (!await authorize.authorizeSession({ principal: actor, sessionId: id, action: 'REPLY' })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound, 404);
    }
    const result = await communicationService.commitExternalMessage({
      actor: Object.freeze({ principal_id: actor.principal_id, admin_override: authorize.isAdmin(actor) }),
      command: {
        session_id: id, expected_row_version: version(body.expected_row_version), sender_kind: 'AGENT',
        purpose: 'HUMAN_REPLY', message_type: body.message_type ?? 'text', visibility: 'EXTERNAL',
        client_command_id: uuid(body.client_command_id), text: text(body.text), reply_to_item_id: body.reply_to_item_id ?? null,
        attachment_ids: [], destination_policy: 'SESSION_THREAD', privacy_class: 'INTERNAL',
        ...retention(),
      },
    });
    return mapPortFailure(result);
  }

  async function internalNote({ authContext, sessionId, body }) {
    guard();
    const actor = await principal(authContext);
    const id = uuid(sessionId);
    if (!await authorize.authorizeSession({ principal: actor, sessionId: id, action: 'INTERNAL_NOTE' })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound, 404);
    }
    const result = await communicationService.commitInternalNote({
      actor: Object.freeze({ principal_id: actor.principal_id, admin_override: authorize.isAdmin(actor) }),
      command: {
        session_id: id, expected_row_version: version(body.expected_row_version), sender_kind: 'AGENT',
        client_command_id: uuid(body.client_command_id), text: text(body.text), reply_to_item_id: null,
        attachment_ids: [], destination_policy: 'NONE', privacy_class: 'INTERNAL',
        ...retention(),
      },
    });
    return mapPortFailure(result);
  }

  return Object.freeze({
    requestHandoff: (input) => control({ ...input, commandType: 'REQUEST_HANDOFF' }),
    takeover: (input) => control({ ...input, commandType: 'TAKEOVER' }),
    transfer: (input) => control({ ...input, commandType: 'TRANSFER' }),
    release: (input) => control({ ...input, commandType: 'RELEASE' }),
    cancelHandoff: (input) => control({ ...input, commandType: 'CANCEL_HANDOFF' }),
    advanceReadCursor: (input) => control({ ...input, commandType: 'ADVANCE_READ_CURSOR' }),
    reply, internalNote,
    retryDelivery: (input) => deliveryControl.retry(input),
    reconcileDelivery: (input) => deliveryControl.reconcile(input),
  });
}
