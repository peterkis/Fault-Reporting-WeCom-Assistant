
import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import type { CommunicationDeliveryStatus, ProviderSideEffectState } from '../contracts/communication_contracts.js';
import type { createCommunicationDeliveryOperatorPort, createCommunicationReconciliationPort } from './p2-004-communication-delivery-worker.mjs';
type Authorizer = Pick<WorkbenchAuthorizationAdapter, 'resolvePrincipal' | 'authorizeSession' | 'isAdmin'>;
type Operator = ReturnType<typeof createCommunicationDeliveryOperatorPort>;
type Reconciler = ReturnType<typeof createCommunicationReconciliationPort>;
export type DeliveryResolution = 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT_REQUEUE' | 'CANCEL';
interface DeliveryRow { id: string; status: CommunicationDeliveryStatus; side_effect_state: ProviderSideEffectState; session_id: string | null }
interface Options { pool?: PostgresTransaction; authorize?: Authorizer; operatorPort?: Operator; reconciliationPort?: Reconciler; enabled?: boolean; externalSendEnabled?: boolean }
export interface WorkbenchDeliveryRetry { authContext: unknown; deliveryId: string; reason_code?: string | undefined }
export interface WorkbenchDeliveryReconcile { authContext: unknown; deliveryId: string; resolution: DeliveryResolution; reason_code: string }

import { WORKBENCH_ERROR_CODES, WorkbenchError } from './p2-006-workbench-query.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOLUTIONS = new Set(['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT_REQUEUE', 'CANCEL']);

function invalid(): never { throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400); }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(); return value.toLowerCase(); }
function reason(value: unknown): string { if (typeof value !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(value)) invalid(); return value; }

export function createWorkbenchDeliveryControl({ pool, authorize, operatorPort, reconciliationPort, enabled = false,
  externalSendEnabled = true }: Options = {}) {
  if (!pool || typeof pool.query !== 'function' || !authorize
    || !operatorPort || typeof (operatorPort as Operator).scheduleRetry !== 'function'
    || !reconciliationPort || typeof (reconciliationPort as Reconciler).reconcileUnknownDelivery !== 'function'
    || typeof enabled !== 'boolean' || typeof externalSendEnabled !== 'boolean') throw new TypeError('Workbench delivery control configuration is invalid.');

  async function context({ authContext, deliveryId }: { authContext: unknown; deliveryId: string }) {
    if (!enabled) throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled, 503);
    const principal = await (authorize as Authorizer).resolvePrincipal(authContext);
    if (principal === null) throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    const id = uuid(deliveryId);
    const result = await (pool as PostgresTransaction).query<DeliveryRow>(
      `SELECT d.id::text,d.status,d.side_effect_state,m.session_id::text
         FROM communication.delivery d
         JOIN communication.outbox o ON o.id=d.outbox_id
         JOIN communication.message m ON m.id=o.message_id
        WHERE d.id=$1::uuid`, [id]);
    if (result.rowCount !== 1 || !await (authorize as Authorizer).authorizeSession({ principal, sessionId: (result.rows[0] as DeliveryRow).session_id as string, action: 'VIEW' })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound, 404);
    }
    return { principal, row: result.rows[0] as DeliveryRow, deliveryId: id };
  }

  async function retry({ authContext, deliveryId, reason_code = 'OPERATOR_RETRY' }: WorkbenchDeliveryRetry) {
    if (!externalSendEnabled) throw new WorkbenchError(WORKBENCH_ERROR_CODES.externalSendDisabled, 403);
    const { principal, row, deliveryId: id } = await context({ authContext, deliveryId });
    if (!await (authorize as Authorizer).authorizeSession({ principal, sessionId: row.session_id as string, action: 'DELIVERY_RETRY' })) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    }
    if (row.status === 'RECONCILIATION_REQUIRED') {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.deliveryReconciliationRequired, 409);
    }
    const result = await (operatorPort as Operator).scheduleRetry({ deliveryId: id, authorized: true, reasonCode: reason(reason_code) });
    if ((result as { ok?: unknown } | null | undefined)?.ok === false) throw new WorkbenchError(WORKBENCH_ERROR_CODES.deliveryRetryForbidden, 409);
    return result;
  }

  async function reconcile({ authContext, deliveryId, resolution, reason_code }: WorkbenchDeliveryReconcile) {
    if (!externalSendEnabled) throw new WorkbenchError(WORKBENCH_ERROR_CODES.externalSendDisabled, 403);
    const { principal, row, deliveryId: id } = await context({ authContext, deliveryId });
    if (!(authorize as Authorizer).isAdmin(principal) || !RESOLUTIONS.has(resolution)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden, 403);
    }
    const result = await (reconciliationPort as Reconciler).reconcileUnknownDelivery({
      deliveryId: id, expectedStatus: 'RECONCILIATION_REQUIRED', resolution,
      reasonCode: reason(reason_code), authorized: true,
    });
    if ((result as { ok?: unknown } | null | undefined)?.ok === false) throw new WorkbenchError(WORKBENCH_ERROR_CODES.versionConflict, 409);
    return result;
  }

  return Object.freeze({ retry, reconcile });
}
