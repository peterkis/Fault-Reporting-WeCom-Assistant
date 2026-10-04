import { createCommunicationDeliveryWorker } from '../../src/p2-004-communication-delivery-worker.mjs';
import { createCommunicationService, normalizeCommunicationCommand } from '../../src/p2-004-communication-core.mjs';
import type { CommunicationCommand } from '../../src/p2-004-communication-core.mjs';
import { createCommunicationSenderPort, validateCommunicationSenderResult } from '../../src/p2-004-communication-sender-port.mjs';
import type { CommunicationSenderResult } from '../../src/p2-004-communication-sender-port.mjs';
import { createConversationControlService } from '../../src/p2-005-conversation-control.mjs';
import type { ControlCommandFor, ControlResult, ControlConflict, ControlRejection } from '../../src/p2-005-conversation-control.mjs';
import { createConversationWorkbenchHttpServer } from '../../src/p2-006-workbench-http.mjs';
import { createConversationWorkbenchCommandFacade } from '../../src/p2-006-workbench-command-facade.mjs';
import { createWorkbenchDeliveryControl } from '../../src/p2-006-workbench-delivery-control.mjs';
import { createConversationWorkbenchQueryService } from '../../src/p2-006-workbench-query.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from '../../src/p2-006-workbench-authorization.mjs';
import type { PostgresPool, PostgresTransaction } from '../../src/platform/postgres-pool.mjs';

declare const pool: PostgresPool;
declare const tx: PostgresTransaction;
declare const externalReceipt: unknown;
const authorize = createPilotWorkbenchAuthorizationAdapter({ pool });
const control = createConversationControlService({ pool });
const communication = createCommunicationService({ pool });
const delivery = createWorkbenchDeliveryControl({ pool, authorize });
const facade = createConversationWorkbenchCommandFacade({ controlService: control, communicationService: communication, deliveryControl: delivery, authorize });
const query = createConversationWorkbenchQueryService({ pool, authorize });
createConversationWorkbenchHttpServer({ queryService: query, commandFacade: facade,
  authenticate: async () => ({ principal_id: 'synthetic', auth_method: 'COOKIE', expires_epoch_ms: '1' }) });
facade.reply({ authContext: { principal_id: 'synthetic' }, sessionId: 'synthetic', body: { text: 'synthetic' } });
const command: CommunicationCommand = { client_command_id: 'synthetic', privacy_class: 'INTERNAL', retention_until: '2026-10-04T00:00:00+08:00', purpose: 'HUMAN_REPLY', text: 'synthetic' };
communication.commitExternalMessage({ command, actor: { principal_id: 'synthetic' } });
normalizeCommunicationCommand(externalReceipt);
const sender = createCommunicationSenderPort(async () => externalReceipt);
createCommunicationDeliveryWorker({ pool, sender });
createCommunicationDeliveryWorker({ pool, sender: { send: async () => ({ outcome: 'ACKNOWLEDGED', provider_message_id: 'synthetic', error_code: null, retryable: false }) } });
// @ts-expect-error -- Worker senders cannot acknowledge a delivery while reporting an error.
createCommunicationDeliveryWorker({ pool, sender: { send: async () => ({ outcome: 'ACKNOWLEDGED', provider_message_id: null, error_code: 'FAILED', retryable: false }) } });
// @ts-expect-error -- Unknown provider outcomes cannot carry a confirmed provider message ID.
createCommunicationDeliveryWorker({ pool, sender: { send: async () => ({ outcome: 'UNKNOWN', provider_message_id: 'synthetic', error_code: null, retryable: false }) } });
const receipt = validateCommunicationSenderResult(externalReceipt);
if (receipt.outcome === 'ACKNOWLEDGED') { const error: null = receipt.error_code; void error; }
const takeover: ControlCommandFor<'TAKEOVER'> = { command_type: 'TAKEOVER', session_id: 'synthetic', client_command_id: 'synthetic', idempotency_scope: 'WORKBENCH', expected_row_version: 1, reason_code: 'SYNTHETIC', target_principal_id: 'synthetic' };
control.takeoverSession(takeover);
control.takeoverSessionInTransaction({ transaction: tx, command: takeover });
declare const result: ControlResult;
if (result.ok) { const version: number | undefined = result.session?.row_version; void version; }
else { const code: string = result.error.code; void code;
  // @ts-expect-error -- Failed control commands do not expose a successful session result.
  result.session;
}
declare const conflict: ControlConflict;
const conflictCode: ControlConflict['error']['code'] = conflict.error.code;
declare const rejection: ControlRejection;
// @ts-expect-error -- Rejections cannot be classified as a conflict merely by sharing ok=false.
const rejectedConflict: typeof conflictCode = rejection.error.code;
// @ts-expect-error -- Communication purposes are the existing explicit business actions.
communication.commitExternalMessage({ command: { ...command, purpose: 'AUTO_SEND' }, actor: {} });
// @ts-expect-error -- Principal identifiers must be strings at the typed service boundary.
communication.commitExternalMessage({ command, actor: { principal_id: 1 } });
// @ts-expect-error -- Takeover accepts its own action, never a release command.
control.takeoverSession({ ...takeover, command_type: 'RELEASE' });
// @ts-expect-error -- External raw receipts must pass the validator before becoming a result.
const trustedReceipt: CommunicationSenderResult = externalReceipt;
// @ts-expect-error -- Acknowledged receipts cannot contain a rejection error code.
const falseAck: CommunicationSenderResult = { outcome: 'ACKNOWLEDGED', provider_message_id: 'synthetic', error_code: 'FAILED', retryable: false };
// @ts-expect-error -- Sender requests use only the supported target types.
sender.send({ provider: 'synthetic', channel_account_id: 'synthetic', target_type: 'BROADCAST', target_id: 'synthetic', delivery_id: 'synthetic', idempotency_key: 'synthetic', message: { message_type: 'text', content: {} }, signal: new AbortController().signal });
// @ts-expect-error -- HTTP authenticators return a typed principal context, never a bare identifier.
createConversationWorkbenchHttpServer({ queryService: query, commandFacade: facade, authenticate: async () => 'synthetic' });
// @ts-expect-error -- HTTP requires the complete typed facade rather than an unrelated service.
createConversationWorkbenchHttpServer({ queryService: query, commandFacade: control, authenticate: async () => null });
// @ts-expect-error -- Transaction callbacks have query capability, never pool release ownership.
tx.release();
void [trustedReceipt, falseAck, rejectedConflict];
