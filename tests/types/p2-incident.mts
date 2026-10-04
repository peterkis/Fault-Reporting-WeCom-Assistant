import type { IncidentCommand, IncidentCommandResult, Incident, CandidateReview, ReporterMilestone } from '../../src/p2-012-domain-contracts.mjs';
import { normalizeCommand, validateCandidate } from '../../src/p2-012-domain-contracts.mjs';
import type { P2012CommandReceipt } from '../../src/p2-012-incident-command-service.mjs';
import type { IncidentNarrowDetail, IncidentBroadDetail, CandidateQueryRow } from '../../src/p2-012-incident-query.mjs';
import type { IncidentGroupTarget, IncidentDirectTarget } from '../../src/p2-012-notification-policy.mjs';
import type { IncidentCorrelationResult } from '../../src/p2-015-incident-correlation.mjs';
import { createP2012CandidateSourceAdapter } from '../../src/p2-012-candidate-source-adapter.mjs';
import { createP2012LiveReporterScope } from '../../src/p2-012-live-reporter-scope.mjs';
import { createP2012WorkbenchExtension } from '../../src/p2-012-workbench-assembly.mjs';
import type { P2016IncidentExtension } from '../../src/p2-016-runtime.mjs';
import type { P2012LiveCheckSummary } from '../../src/p2-012-live-configuration.mjs';
import type { P2012Role, P2012RoleMessage, P2012RoleArgument } from '../../scripts/p2-012-process-role.mjs';
import type { TicketCommand } from '../../src/p2-016-ticket-command-facade.mjs';

declare const candidate: CandidateReview;
declare const incident: Incident;
// @ts-expect-error -- A review candidate has no confirmed Incident identity or status.
const candidateAsIncident: Incident = candidate;
// @ts-expect-error -- A confirmed Incident cannot replace the candidate source/review record.
const incidentAsCandidate: CandidateReview = incident;
declare const start: Extract<IncidentCommand, { action: 'START_REVIEW' }>;
declare const confirm: Extract<IncidentCommand, { action: 'CONFIRM_INCIDENT' }>;
declare const investigate: Extract<IncidentCommand, { action: 'START_INVESTIGATING' }>;
const confirmed: IncidentCommand = confirm;
// @ts-expect-error -- Candidate commands cannot target an Incident resource.
const crossedResource: IncidentCommand = { ...start, incident_id: 'synthetic' };
// @ts-expect-error -- Confirmation requires its dedicated candidate version.
const wrongConfirmVersion: IncidentCommand = { ...confirm, expected_candidate_version: 1 };
// @ts-expect-error -- Confirmation-only scope and owner fields cannot be attached to another Action.
const leakedScope: IncidentCommand = { ...investigate, confirmed_scope: 'LOCAL' };
// @ts-expect-error -- An ordinary review must not select reports for confirmation.
const leakedReports: IncidentCommand = { ...start, selected_report_refs: [] };
// @ts-expect-error -- Incident row versions remain strings at the command boundary.
const numericVersion: IncidentCommand = { ...investigate, expected_row_version: 1 };
declare const ticket: TicketCommand;
// @ts-expect-error -- The Ticket command boundary retains its numeric version.
const stringTicketVersion: TicketCommand = { ...ticket, expected_version: '1' };
const normalized = normalizeCommand(confirm);
const normalizedVersion: string = normalized.expected_row_version;

declare const result: IncidentCommandResult;
if (result.ok) {
  const version: string = result.result_row_version;
  const replayed: boolean = result.replayed;
  const ref: 'INCIDENT' | 'CANDIDATE' = result.result_ref_type;
  void version; void replayed; void ref;
  // @ts-expect-error -- Successful command results do not carry a failure code.
  void result.error;
} else {
  const retryable: false = result.error.retryable;
  // @ts-expect-error -- Stable failures must not claim a committed event reference.
  void result.result_event_id;
  void retryable;
}
declare const receipt: P2012CommandReceipt;
if (receipt.state === 'COMMITTED') {
  const ref: 'INCIDENT' | 'CANDIDATE' = receipt.result_ref_type;
  const id: string = receipt.result_ref_id;
  const version: string = receipt.result_row_version;
  const event: string = receipt.result_event_id;
  void ref; void id; void version; void event;
} else if (receipt.state === 'STARTED') {
  // @ts-expect-error -- Migration 032 only permits committed scalar success on COMMITTED receipts.
  const premature: string = receipt.result_ref_id;
  void premature;
}

declare const narrow: IncidentNarrowDetail;
declare const broad: IncidentBroadDetail;
const owner: string = broad.owner_principal_id;
// @ts-expect-error -- The ordinary Incident projection excludes internal ownership.
void narrow.owner_principal_id;
// @ts-expect-error -- The ordinary Incident projection excludes the internal primary Ticket.
void narrow.primary_ticket_id;
declare const rawCandidateRow: CandidateQueryRow;
// @ts-expect-error -- A PostgreSQL JSONB source_versions field has not been schema-validated.
const sourceHash: string = rawCandidateRow.source_versions.source_hash;
declare const milestone: ReporterMilestone;
const publicMilestone: 'PUBLIC_INCIDENT_CONFIRMED' | 'PUBLIC_INCIDENT_INVESTIGATING' | 'PUBLIC_INCIDENT_RESOLVED' | 'PUBLIC_INCIDENT_CLOSED' = milestone.milestone;
// @ts-expect-error -- Reporter milestones exclude internal Principal identity.
void milestone.actor_principal_id;
// @ts-expect-error -- Reporter milestones exclude internal event payloads and notes.
void milestone.safe_payload;
// @ts-expect-error -- Reporter milestones exclude internal Report identity.
void milestone.report_id;

declare const group: IncidentGroupTarget;
declare const direct: IncidentDirectTarget;
const subscription: string = direct.subscription_id;
// @ts-expect-error -- A Group destination cannot claim a Reporter Direct subscription.
const crossedTarget: IncidentGroupTarget = direct;
// @ts-expect-error -- Reporter Direct requires its persisted Subscription binding.
const missingSubscription: IncidentDirectTarget = group;
declare const scope: ReturnType<typeof createP2012LiveReporterScope>;
const accepted: Promise<boolean> = scope.accepts({});
const authorized: Promise<boolean> = scope.authorizesDestination({ target_type: 'PERSON', target_id: 'synthetic' });
// @ts-expect-error -- Dynamic Reporter discovery cannot be consumed as a synchronous decision.
const synchronous: boolean = scope.accepts({});
declare const correlation: IncidentCorrelationResult;
if (correlation.correlation_overflow) {
  const overflowCount: 0 = correlation.correlated;
  void overflowCount;
}
const flagOff: IncidentCorrelationResult = { correlated: 0, correlation_overflow: false };
// @ts-expect-error -- Overflow cannot claim partially correlated groups.
const partialOverflow: IncidentCorrelationResult = { correlated: 1, correlation_overflow: true };

declare const source: ReturnType<typeof createP2012CandidateSourceAdapter>;
declare const sourceInput: Parameters<typeof source.record>[0];
const recorded = source.record(sourceInput);
recorded.then(value => {
  const review: boolean = value.incident_review_candidate;
  // @ts-expect-error -- The Candidate source seam records a Decision, never a created Incident.
  const createdIncident: Incident = value;
  void review; void createdIncident;
});
const projection = validateCandidate({});
// @ts-expect-error -- Validated candidate metadata does not claim Incident creation.
void projection.incident_id;
declare const extension: ReturnType<typeof createP2012WorkbenchExtension>;
const runtimeExtension: P2016IncidentExtension = extension;
declare const summary: P2012LiveCheckSummary;
// @ts-expect-error -- The public live-check summary excludes the bot secret.
void summary.secret;
// @ts-expect-error -- The public live-check summary excludes the Reporter HMAC secret.
void summary.reporterHmacSecret;
declare const ipc: P2012RoleMessage;
// @ts-expect-error -- IPC status messages never carry bot secrets.
void ipc.secret;
const appRole: P2012Role = 'APP';
const workerArg: P2012RoleArgument = '--role=worker';
// @ts-expect-error -- Only APP, WORKER and GATEWAY are process roles.
const foreignRole: P2012RoleMessage = { type: 'role-stopped', role: 'MODEL' };
// @ts-expect-error -- The process launcher does not permit arbitrary role arguments.
const foreignArg: P2012RoleArgument = '--role=model';
void confirmed; void normalizedVersion; void owner; void publicMilestone; void subscription;
void accepted; void authorized; void flagOff; void runtimeExtension; void appRole; void workerArg;
