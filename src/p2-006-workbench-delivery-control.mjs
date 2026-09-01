import { WORKBENCH_ERROR_CODES, WorkbenchError } from './p2-006-workbench-query.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOLUTIONS = new Set(['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT_REQUEUE', 'CANCEL']);

function invalid() { throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400); }
function uuid(value) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(); return value.toLowerCase(); }
function reason(value) { if (typeof value !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(value)) invalid(); return value; }

export function createWorkbenchDeliveryControl({ pool, authorize, operatorPort, reconciliationPort, enabled = false } = {}) {
  if (!pool || typeof pool.query !== 'function' || !authorize
    || !operatorPort || typeof operatorPort.scheduleRetry !== 'function'
    || !reconciliationPort || typeof reconciliationPort.reconcileUnknownDelivery !== 'function'
    || typeof enabled !== 'boolean') throw new TypeError('Workbench delivery control configuration is invalid.');

  async function context({ authContext, deliveryId }) {
    if (!enabled) throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled, 503);
    const principal = await authorize.resolvePrincipal(authContext);
    if (principal === null) throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    const id = uuid(deliveryId);
    const result = await pool.query(
      `SELECT d.id::text,d.status,d.side_effect_state,m.session_id::text
         FROM communication.delivery d
         JOIN communication.outbox o ON o.id=d.outbox_id
         JOIN communication.message m ON m.id=o.message_id
        WHERE d.id=$1::uuid`, [id]);
    if (result.rowCount !== 1 || !await authorize.authorizeSession({ principal, sessionId: result.rows[0].session_id, action: 'VIEW' })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound, 404);
    }
    return { principal, row: result.rows[0], deliveryId: id };
  }

  async function retry({ authContext, deliveryId, reason_code = 'OPERATOR_RETRY' }) {
    const { principal, row, deliveryId: id } = await context({ authContext, deliveryId });
    if (!await authorize.authorizeSession({ principal, sessionId: row.session_id, action: 'DELIVERY_RETRY' })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    }
    if (row.status === 'RECONCILIATION_REQUIRED') {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.deliveryReconciliationRequired, 409);
    }
    const result = await operatorPort.scheduleRetry({ deliveryId: id, authorized: true, reasonCode: reason(reason_code) });
    if (result?.ok === false) throw new WorkbenchError(WORKBENCH_ERROR_CODES.deliveryRetryForbidden, 409);
    return result;
  }

  async function reconcile({ authContext, deliveryId, resolution, reason_code }) {
    const { principal, row, deliveryId: id } = await context({ authContext, deliveryId });
    if (!authorize.isAdmin(principal) || !RESOLUTIONS.has(resolution)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    }
    const result = await reconciliationPort.reconcileUnknownDelivery({
      deliveryId: id, expectedStatus: 'RECONCILIATION_REQUIRED', resolution,
      reasonCode: reason(reason_code), authorized: true,
    });
    if (result?.ok === false) throw new WorkbenchError(WORKBENCH_ERROR_CODES.versionConflict, 409);
    return result;
  }

  return Object.freeze({ retry, reconcile });
}
