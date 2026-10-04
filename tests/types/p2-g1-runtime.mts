import type { G1ProviderResponse } from '../../scripts/p2-g1-process-role.mjs';
import type { G1SenderPort } from '../../src/p2-g1-runtime.mjs';
import { createP2G1Runtime } from '../../src/p2-g1-runtime.mjs';
import { createP2G1TimelineProjector } from '../../src/p2-g1-inbound-projection-coordinator.mjs';
const sender: G1SenderPort = { async send() { return { outcome: 'ACKNOWLEDGED', provider_message_id: 'synthetic', error_code: null, retryable: false }; } };
createP2G1Runtime({ senderAdapter: sender });
// @ts-expect-error -- Internal SenderPort must return the validated receipt union.
createP2G1Runtime({ senderAdapter: { async send(): Promise<unknown> { return {}; } } });
// @ts-expect-error -- An acknowledged internal IPC reply cannot carry an error code.
const contradictory: G1ProviderResponse = { type: 'provider-send-response', request_id: 'synthetic', ok: true, result: { outcome: 'ACKNOWLEDGED', provider_message_id: 'synthetic', error_code: 'REJECTED', retryable: false } };
// @ts-expect-error -- A rejected internal IPC reply cannot carry an acknowledged provider ID.
const rejected: G1ProviderResponse = { type: 'provider-send-response', request_id: 'synthetic', ok: true, result: { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: 'synthetic', error_code: 'REJECTED', retryable: false } };
createP2G1TimelineProjector({ transactionStartHook: ({ transaction }) => transaction.query('SELECT 1') });
void contradictory; void rejected;
