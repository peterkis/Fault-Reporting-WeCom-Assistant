import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { G2Manifest, G2TemplateCode } from './p2-g2-validation-config.mjs';
import type { CommunicationSenderRequest } from '../contracts/communication_contracts.js';
import type { ValidatedSenderRequest } from './p2-004-communication-sender-port.mjs';
import type { createP2012DynamicWeComSender } from './p2-012-live-reporter-scope.mjs';
type ProviderGateway = NonNullable<Parameters<typeof createP2012DynamicWeComSender>[0]>['gateway'];
export interface G2SendGuardOptions {pool:PostgresTransaction;sender:{send(request:ValidatedSenderRequest):unknown|Promise<unknown>};manifest:unknown;env:NodeJS.ProcessEnv;budgetFile:string;root?:string}
type SenderPartialResult = {outcome:'REJECTED_NOT_APPLIED'|'UNKNOWN';error_code:string;retryable:boolean};
import { isDeepStrictEqual } from 'node:util';
import { createCommunicationSenderPort, validateCommunicationSenderResult } from './p2-004-communication-sender-port.mjs';
import { readG2Configuration, validateG2Manifest, g2Hash, G2_TEST_PREFIX } from './p2-g2-validation-config.mjs';
import { verifyG2Candidate, verifyG2ApprovalFile, G2_ROOT } from './p2-g2-candidate.mjs';
import { openG2SendBudget } from './p2-g2-send-budget.mjs';
import { withG2ProviderReceipt, captureG2ProviderReceipt } from './p2-g2-provider-receipts.mjs';

const rejected = (code: string): SenderPartialResult => ({ outcome: 'REJECTED_NOT_APPLIED', error_code: code, retryable: false });
const unknown = (): SenderPartialResult => ({ outcome: 'UNKNOWN', error_code: 'P2_G2_SEND_RECONCILIATION_REQUIRED', retryable: false });

export function approvalCheck(manifest: G2Manifest, env: NodeJS.ProcessEnv, root = G2_ROOT) {
  readG2Configuration({ manifest, env, role: 'GATEWAY', candidateFingerprint: manifest.candidate_fingerprint });
  verifyG2Candidate(manifest.candidate_fingerprint, root);
  verifyG2ApprovalFile(manifest, root);
}

// Direct Leg and card-grant lookup may await a database. Recheck approval at
// the actual SDK call too, so an expired/revoked permission cannot cross that await.
export function createG2ProviderGate({ gateway, manifest, env, root = G2_ROOT, receiptFile = null }: {gateway:ProviderGateway;manifest:unknown;env:NodeJS.ProcessEnv;root?:string;receiptFile?:string|null}) {
  manifest = validateG2Manifest(manifest);
  return Object.freeze({ getAuthenticatedClient() {
    const client = (gateway as NonNullable<ProviderGateway>).getAuthenticatedClient();
    return Object.freeze({ sendMessage(...args: Parameters<typeof client.sendMessage>) {
      approvalCheck(manifest as G2Manifest, env, root);
      return receiptFile ? captureG2ProviderReceipt({ file: receiptFile, manifest, send: () => client.sendMessage(...args) }) : client.sendMessage(...args);
    } });
  } });
}

// Wrap the existing dynamic sender. This does not replace its Direct Leg,
// destination, card-grant, SDK numeric-ACK or pre-send abort checks.
export function createG2SendGuard({ pool, sender, manifest, env, budgetFile, root = G2_ROOT }: G2SendGuardOptions) {
  manifest = validateG2Manifest(manifest);
  const budget = openG2SendBudget({ file: budgetFile, manifest });
  const check = () => approvalCheck(manifest as G2Manifest, env, root);
  check();
  return createCommunicationSenderPort(async request => {
    try { check(); } catch (error) { return rejected(/^P2_G2_[A-Z_]+$/u.test((error as {code?:string} | null)?.code ?? '') ? (error as {code:string}).code : 'P2_G2_SEND_APPROVAL_INVALID'); }
    if (request.signal.aborted) return rejected('P2_G2_SEND_ABORTED');
    if (!/^[a-f0-9-]{36}$/u.test(request.delivery_id)) return rejected('P2_G2_SEND_BINDING_INVALID');
    // Database errors propagate as UNKNOWN to the existing Worker. They are
    // never converted into a permanent lack of destination eligibility.
    const { rows } = await pool.query(`SELECT d.outbox_id::text,d.provider,d.channel_account_id,d.target_type,d.target_id,d.target_hash,
        d.idempotency_key,d.status,d.attempt_count,m.message_type,m.content,m.sender_kind,m.sender_principal_id::text,
        m.sender_system_code,m.purpose,m.visibility,
        (m.created_at>=platform.local_from_epoch_ms(($2::bigint/1000)*1000)
          AND m.created_at<platform.local_from_epoch_ms($3::bigint)) AS created_in_window,
        m.retention_until_epoch_ms::text,
        platform.physical_epoch_ms()::text AS now_epoch_ms
      FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
      JOIN communication.message m ON m.id=o.message_id WHERE d.id=$1::uuid`,
    [request.delivery_id, (manifest as G2Manifest).approval.valid_from_epoch_ms, (manifest as G2Manifest).approval.expires_epoch_ms]);
    const row = rows[0], scope = (manifest as G2Manifest).scope;
    if (!row || row.status !== 'SENDING' || row.visibility !== 'EXTERNAL'
      || row.provider !== 'WECOM_AIBOT' || g2Hash(row.channel_account_id as string) !== scope.bot_hash
      || !['provider', 'channel_account_id', 'target_type', 'target_id', 'idempotency_key'].every(k => row[k] === request[k as keyof ValidatedSenderRequest])
      || row.target_hash !== g2Hash(request.target_id)
      || row.message_type !== request.message.message_type || !isDeepStrictEqual(row.content, request.message.content)
      || row.created_in_window !== true
      || BigInt(row.retention_until_epoch_ms as string) <= BigInt(row.now_epoch_ms as string)) return rejected('P2_G2_SEND_BINDING_INVALID');
    const human = row.sender_kind === 'AGENT' && row.purpose === 'HUMAN_REPLY'
      && scope.principal_ids.includes(row.sender_principal_id as string) && row.message_type === 'text'
      && scope.approved_replies.includes((row.content as {text?:string}).text as string);
    const system = row.sender_kind === 'SYSTEM' && row.purpose === 'SYSTEM_NOTIFICATION'
      && scope.approved_templates.includes(row.sender_system_code as G2TemplateCode) && ['text', 'template_card'].includes(row.message_type as string);
    if (!human && !system) return rejected('P2_G2_SEND_CONTENT_NOT_APPROVED');
    if (request.target_type === 'GROUP' && (!scope.group_hashes.includes(row.target_hash as string)
      || row.message_type !== 'text' || !(row.content as {text?:string}).text?.startsWith(G2_TEST_PREFIX))) return rejected('P2_G2_SEND_GROUP_LABEL_REQUIRED');
    // Recheck after asynchronous database work, immediately before reservation.
    try { check(); } catch (error) { return rejected((error as {code?:string} | null)?.code ?? 'P2_G2_SEND_APPROVAL_INVALID'); }
    if (request.signal.aborted) return rejected('P2_G2_SEND_ABORTED');
    let reservation;
    try {
      reservation = budget.reserve({ delivery_id: request.delivery_id, target_type: request.target_type,
        target_hash: row.target_hash as string, message_hash: g2Hash(JSON.stringify(request.message)), idempotency_hash: g2Hash(request.idempotency_key) });
    } catch (error) { return rejected((error as {code?:string} | null)?.code ?? 'P2_G2_SEND_BUDGET_UNAVAILABLE'); }
    if (reservation.kind === 'REPLAY') return reservation.outcome === 'ACKNOWLEDGED'
      ? { outcome: 'ACKNOWLEDGED', provider_message_id: null, error_code: null, retryable: false } : unknown();
    let result: ReturnType<typeof validateCommunicationSenderResult> | SenderPartialResult;
    try { result = validateCommunicationSenderResult(await withG2ProviderReceipt({ delivery_id: request.delivery_id,
      outbox_id: row.outbox_id as string, attempt_no: row.attempt_count as number }, () => sender.send(request))); }
    catch (error) { result = (error as {code?:string} | null)?.code === 'GATEWAY_UNAVAILABLE_BEFORE_SEND'
      ? { outcome: 'REJECTED_NOT_APPLIED', error_code: 'GATEWAY_UNAVAILABLE', retryable: true } : unknown(); }
    // If fsync fails, no retry may infer that the Provider did not apply it.
    try { budget.complete(reservation.ordinal, result.outcome); } catch { return unknown(); }
    return result;
  });
}
