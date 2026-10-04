import type { RuleResult } from '../../src/p2-007-rule-engine.mjs';
import { routeP2007Decision } from '../../src/p2-015-decision-router.mjs';
import type { SafeActionSuggestion } from '../../src/p2-015-decision-router.mjs';
import type { DecisionInput } from '../../src/p2-015-decision-store.mjs';
import type { ReporterDirectoryResult } from '../../contracts/p2_015_contracts.js';
import type { ReviewResolution } from '../../src/p2-015-manual-review.mjs';
import type { IntakeDecisionPort, ActionExecutionResult } from '../../src/p2-015-safe-action-executor.mjs';
import type { WorkerBatchResult, PostBatchMaintenanceError, WorkerOptions } from '../../src/p2-015-worker.mjs';
import type { ManualReviewLedgerResult } from '../../src/p2-016-manual-review-facade.mjs';
import type { P2016IncidentExtension } from '../../src/p2-016-runtime.mjs';
import type { P2016RoleMessage, P2016SupervisorCommand } from '../../scripts/p2-016-management-supervisor.mjs';
import type { P2016LiveCheckSummary } from '../../src/p2-016-live-configuration.mjs';
import { createContinuationRefService } from '../../src/p2-015-continuation-ref.mjs';
import { createDecisionStore } from '../../src/p2-015-decision-store.mjs';

declare const rules: RuleResult;
declare const externalRules: unknown;
const decision = routeP2007Decision({ rule_output: rules });
const external = routeP2007Decision({ rule_output: externalRules });
const suggestion: SafeActionSuggestion = decision.safe_action_suggestions[0] as SafeActionSuggestion;
// @ts-expect-error -- A result code cannot replace an explicit executable safe-action type.
const resultAsAction: SafeActionSuggestion['action_type'] = 'TICKET_ELIGIBLE';
// @ts-expect-error -- A custom engine's unverified fact JSON is not trusted provenance.
const unverifiedFact: string = external.fact_provenance[0].fact_id;
declare const bot: Extract<DecisionInput, { source_kind?: 'BOT' }>;
// @ts-expect-error -- WEB decisions require both the submission identity and positive basis revision.
const incompleteWeb: DecisionInput = { ...bot, source_kind: 'WEB' };
// @ts-expect-error -- A BOT decision must not carry a WEB basis revision.
const crossedSource: DecisionInput = { ...bot, source_kind: 'BOT', basis_input_revision: 1 };
declare const directory: ReporterDirectoryResult;
if (directory.status === 'RESOLVED') {
  const profile = directory.snapshot;
  void profile;
} else {
  // @ts-expect-error -- An unresolved directory result cannot be promoted to a resolved profile.
  const resolved: Extract<ReporterDirectoryResult, { status: 'RESOLVED' }> = directory;
  void resolved;
}
// @ts-expect-error -- A newly resolved review requires the committed resolution decision and string row version.
const missingResolution: ReviewResolution = { id: 'synthetic', status: 'RESOLVED', replayed: false };
declare const intakePort: IntakeDecisionPort;
declare const intakeInput: Parameters<IntakeDecisionPort['apply']>[0];
void intakePort.apply(intakeInput);
// @ts-expect-error -- Safe-action callbacks cannot release or own the outer transaction connection.
intakeInput.transaction.release();
declare const action: ActionExecutionResult;
if (action.failed_safe) {
  const review: string = action.review_id;
  void review;
} else {
  // @ts-expect-error -- Ordinary execution and replay cannot be treated as a failed-safe review result.
  const failedReview: string = action.review_id;
  void failedReview;
}
declare const worker: WorkerBatchResult;
if (worker.disabled) {
  // @ts-expect-error -- Disabled workers do not claim a Web result or committed Bot result list.
  void worker.web_result;
} else {
  void worker.results; void worker.web_result; void worker.directory_sync;
}
declare const maintenance: PostBatchMaintenanceError;
const committed: true = maintenance.accepted_batch_committed;
const processed: number = maintenance.processed;
// @ts-expect-error -- Post-batch maintenance failure must not claim accepted reports were rolled back.
const rolledBack: false = maintenance.accepted_batch_committed;
declare const workerOptions: WorkerOptions;
// @ts-expect-error -- A Web lane must implement the current bounded worker operation.
const wrongWeb: WorkerOptions = { ...workerOptions, webOrchestrator: { runOnce: async () => ({ processed: 1 }) } };
const extension: P2016IncidentExtension = { ready: async () => true, runOnce: async () => {}, reporterAdapter: { milestones: async () => [] } };
// @ts-expect-error -- The Incident extension needs its current readiness capability.
const missingReadiness: P2016IncidentExtension = { runOnce: async () => {} };
declare const ipc: P2016RoleMessage;
if (ipc.type === 'role-failed') {
  const code: string = ipc.error_code;
  void code;
}
// @ts-expect-error -- Process roles are limited to APP, WORKER and GATEWAY.
const foreignRole: P2016RoleMessage = { type: 'role-stopped', role: 'MODEL' };
// @ts-expect-error -- Peer status commands must carry both current readiness facts.
const partialPeer: P2016SupervisorCommand = { type: 'peer-status', worker_ready: true };
declare const review: ManualReviewLedgerResult;
if (review.ok && !review.replayed) {
  const id: string = review.resolution_decision_id;
  const count: number = review.action_count;
  void id; void count;
} else if (review.ok && review.replayed) {
  // @ts-expect-error -- A stored ledger replay must not be asserted as a current ManualReview consumer result.
  const replayId: string = review.resolution_decision_id;
  // @ts-expect-error -- A stored replay's action count is unknown until a consumer validates it.
  const replayCount: number = review.action_count;
  void replayId; void replayCount;
}
declare const summary: P2016LiveCheckSummary;
// @ts-expect-error -- The public live-check summary excludes the private bot secret.
void summary.secret;
// @ts-expect-error -- The public live-check summary excludes the private reporter HMAC key.
void summary.reporterHmacSecret;
declare const continuations: ReturnType<typeof createContinuationRefService>;
declare const consumed: Awaited<ReturnType<typeof continuations.consume>>;
if (consumed) {
  const consumedAt: string = consumed.consumed_epoch_ms;
  // @ts-expect-error -- The consume projection does not return the original issue timestamp.
  void consumed.issued_at;
  void consumedAt;
}
declare const revoked: Awaited<ReturnType<typeof continuations.revoke>>;
if (revoked) {
  const version: string = revoked.row_version;
  // @ts-expect-error -- Revoke RETURNING contains no reporter binding or journey projection.
  void revoked.reporter_binding_hash;
  void version;
}
declare const actions: ReturnType<typeof createDecisionStore>;
declare const marked: Awaited<ReturnType<typeof actions.markAction>>;
if (marked) {
  // @ts-expect-error -- Marking an action returns execution state, not its proposal payload.
  void marked.safe_payload;
}
void suggestion; void resultAsAction; void unverifiedFact; void incompleteWeb; void crossedSource; void missingResolution;
void committed; void processed; void rolledBack; void wrongWeb; void extension; void missingReadiness; void foreignRole; void partialPeer;
