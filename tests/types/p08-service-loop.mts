import { validateG2Manifest, readG2Configuration } from '../../src/p2-g2-validation-config.mjs';
import type { SyntheticManifest, LiveManifest, CandidateFingerprint, ApprovalScopeHash, SourceSHA256, EvidenceSHA256, DatabaseIdentityHash, G2Role } from '../../src/p2-g2-validation-config.mjs';
import type { CandidateInventory, G2CandidateFile, PreparedG2Candidate } from '../../src/p2-g2-candidate.mjs';
import type { G2EvidenceType, G2ResultValue, G2MetricName, G2BooleanFact } from '../../src/p2-g2-evidence.mjs';
import type { G2ScenarioId } from '../../src/p2-g2-gate-evaluator.mjs';
import { createG2SourceAudit } from '../../src/p2-g2-source-audit.mjs';
import type { G2HostMetrics, G2ResourceDatabaseMetrics } from '../../src/p2-g2-resource-sampler.mjs';
import type { ReconciliationCounts, ReconciliationDelivery } from '../../src/p2-g2-reconciliation.mjs';

declare const json: unknown;
const manifest = validateG2Manifest(json);
if (manifest.mode === 'synthetic') {
  const synthetic: SyntheticManifest = manifest;
  // @ts-expect-error -- A synthetic run cannot supply the live manifest path.
  const live: LiveManifest = manifest;
  void synthetic; void live;
}
// @ts-expect-error -- Unverified external JSON cannot bypass the manifest validator.
const unverified: LiveManifest = json;
// @ts-expect-error -- Role selection belongs to the controller's three known capabilities.
const role: G2Role = 'MODEL';
declare const candidate: CandidateFingerprint;
declare const approval: ApprovalScopeHash;
declare const source: SourceSHA256;
declare const evidence: EvidenceSHA256;
declare const database: DatabaseIdentityHash;
// @ts-expect-error -- Approval scope digest cannot identify the candidate's source inventory.
const wrongCandidate: CandidateFingerprint = approval;
// @ts-expect-error -- Source content and evidence chain digests have different binding roles.
const wrongEvidence: EvidenceSHA256 = source;
// @ts-expect-error -- Evidence integrity does not establish database identity.
const wrongDatabase: DatabaseIdentityHash = evidence;
// @ts-expect-error -- Database identity does not establish owner approval scope.
const wrongApproval: ApprovalScopeHash = database;
void readG2Configuration({ manifest, candidateFingerprint: candidate });
declare const inventory: CandidateInventory;
const encoding: 'BINARY' | 'UTF8_LF' = (inventory.files[0] as G2CandidateFile).encoding;
// @ts-expect-error -- Candidate text hashes require normalized UTF8 LF, not arbitrary text encodings.
const wrongEncoding: typeof encoding = 'UTF16';
declare const prepared: PreparedG2Candidate;
const ready: 'READY_FOR_LIVE_E2E' = prepared.preparation_status;
// @ts-expect-error -- A stale report is not an accepted prepared candidate.
const stale: PreparedG2Candidate = { ...prepared, preparation_status: 'STALE' };
// @ts-expect-error -- Evidence producers cannot add a new live proof category.
const type: G2EvidenceType = 'INFERRED_LIVE_PASS';
// @ts-expect-error -- Not-run evidence cannot be called a successful result.
const result: G2ResultValue = 'SUCCESS';
// @ts-expect-error -- Only declared resource sensors may enter evidence metrics.
const metric: G2MetricName = 'model_secret';
// @ts-expect-error -- Only declared boolean facts may enter evidence details.
const fact: G2BooleanFact = 'live_authorization_assumed';
// @ts-expect-error -- The gate's scenario set cannot be extended by an arbitrary label.
const scenario: G2ScenarioId = 'G2-E09';
const audit = createG2SourceAudit({ tap: '', run: json, root: '/synthetic' });
const accounting: boolean = audit.accounting_complete;
declare const host: G2HostMetrics;
declare const dbMetrics: G2ResourceDatabaseMetrics;
const hostCpu: number = host.host_cpu_count;
// @ts-expect-error -- Database metrics do not claim a host CPU sensor.
const incorrectHost: G2HostMetrics = dbMetrics;
declare const counts: ReconciliationCounts;
declare const delivery: ReconciliationDelivery;
const outOfScope: unknown = counts.out_of_scope_deliveries;
// @ts-expect-error -- SQL reconciliation fields remain raw until their existing evidence consumer validates them.
const uncheckedCount: number = counts.out_of_scope_deliveries;
// @ts-expect-error -- Reconciliation exposes hashes and audit metadata, not message content.
void delivery.raw_content;
void [unverified,role,wrongCandidate,wrongEvidence,wrongDatabase,wrongApproval,wrongEncoding,ready,stale,type,result,metric,fact,scenario,accounting,hostCpu,incorrectHost,outOfScope];

import type { SendBudgetReservation } from '../../src/p2-g2-send-budget.mjs';
import type { CommunicationSenderResult, ValidatedSenderRequest } from '../../src/p2-004-communication-sender-port.mjs';
import type { ProviderReceipt } from '../../src/p2-g2-provider-receipts.mjs';
import type { StoredWebhookReceipt } from '../../src/p2-g2-webhook-receipts.mjs';
import type { G2SendGuardOptions } from '../../src/p2-g2-send-guard.mjs';
import type { G2NetworkCapabilities } from '../../src/p2-g2-network-boundary.mjs';
import { inspectG2DatabaseScope } from '../../src/p2-g2-database-scope.mjs';
import { limitedTemplate, validateLimitedManifest } from '../../src/yxx-limited-write-contract.mjs';
import type { ApprovedLimitedManifest, LimitedPermission, LimitedPermissions } from '../../src/yxx-limited-write-contract.mjs';
import { createLimitedGuard } from '../../src/yxx-limited-write-guard.mjs';

declare const reservation: SendBudgetReservation;
if (reservation.kind === 'REPLAY') {
  const outcome: 'ACKNOWLEDGED'|'REJECTED_NOT_APPLIED'|'UNKNOWN' = reservation.outcome;
  // @ts-expect-error -- A replay cannot create a new reservation journal ordinal.
  void reservation.ordinal;
  void outcome;
} else {
  const ordinal: number = reservation.ordinal;
  // @ts-expect-error -- A new reservation has no provider outcome yet.
  void reservation.outcome;
  void ordinal;
}
declare const unknownResult: Extract<CommunicationSenderResult,{outcome:'UNKNOWN'|'REJECTED_NOT_APPLIED'}>;
// @ts-expect-error -- An unknown delivery result cannot become a provider acknowledgement.
const ack: Extract<CommunicationSenderResult,{outcome:'ACKNOWLEDGED'}> = unknownResult;
declare const providerReceipt: ProviderReceipt;
// @ts-expect-error -- SDK receipt proof cannot be used as a group webhook receipt.
const webhookReceipt: StoredWebhookReceipt = providerReceipt;
declare const sendOptions: G2SendGuardOptions;
declare const request: ValidatedSenderRequest;
void sendOptions.sender.send(request);
// @ts-expect-error -- Send Guard's sender cannot accept unverified JSON as a request.
void sendOptions.sender.send(json);
// @ts-expect-error -- Network capabilities expose only the two existing member endpoint switches.
const network: G2NetworkCapabilities = { arbitraryUrl: 'https://synthetic.invalid' };
declare const scopeResult: Awaited<ReturnType<typeof inspectG2DatabaseScope>>;
const databaseReady: boolean = scopeResult.ready;
const template = limitedTemplate();
const notAuthorized: 'NOT_AUTHORIZED' = template.status;
// @ts-expect-error -- A populated template remains incapable of authorizing Limited Write.
const approvedTemplate: ApprovedLimitedManifest = template;
const approved = validateLimitedManifest(json);
// @ts-expect-error -- Limited permission keys are closed to the existing operation contract.
const newPermission: LimitedPermission = 'hospital_database_write';
// @ts-expect-error -- Limited Write cannot enable real messaging.
const messaging: LimitedPermissions = { ...approved.permissions, real_message_send: true };
// @ts-expect-error -- Limited Write cannot activate the parent live gate.
const parentLive: LimitedPermissions = { ...approved.permissions, parent_p2_g2_live: true };
declare const limitedGuard: ReturnType<typeof createLimitedGuard>;
const localQuota: true = limitedGuard.quota.localOnly;
declare const guardResult: Awaited<ReturnType<typeof limitedGuard.quota>>;
if (guardResult) { const allowed:true = guardResult; void allowed; }
else { const rejected:false = guardResult; void rejected; }
void [ack,webhookReceipt,network,databaseReady,notAuthorized,approvedTemplate,newPermission,messaging,parentLive,localQuota];

import { createYxxProfile } from '../../src/p2-g2-yixiaoxiu-profile.mjs';
import type { OAuthOnlyProfileOptions, SelfServiceProfileOptions, FullServiceProfileOptions, YxxProfileOptions } from '../../src/p2-g2-yixiaoxiu-profile.mjs';
import type { YxxG2AppConfiguration } from '../../src/p2-g2-yixiaoxiu-g2-config.mjs';
import { yxxSelfServiceRoleEnvironment } from '../../src/p2-g2-yixiaoxiu-g2-config.mjs';
import { createG2ProcessCluster } from '../../src/p2-g2-service-loop-assembly.mjs';
import type { G2RoleEnvironment } from '../../src/p2-g2-service-loop-assembly.mjs';
import type { G2ResourceCluster } from '../../src/p2-g2-resource-sampler.mjs';
import type { G2ControlMessage, G2RoleControl, SyntheticG2ProviderResult } from '../../scripts/p2-g2-process-role.mjs';
import type { YxxIdentityMapping } from '../../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import type { YxxMemberFlags } from '../../src/yxx-self-service-authorization.mjs';

declare const oauthOnlyOptions: OAuthOnlyProfileOptions;
const oauthOnly = createYxxProfile(oauthOnlyOptions);
const noSelfService: null = oauthOnly.selfService;
// @ts-expect-error -- OAuth-only profile does not expose the Ticket Workbench command interface.
void oauthOnly.tickets;
declare const selfServiceOptions: SelfServiceProfileOptions;
const selfService = createYxxProfile(selfServiceOptions);
void selfService.selfService.handler;
// @ts-expect-error -- A profile cannot introduce a fifth runtime capability.
const fifthProfile: YxxProfileOptions = { ...selfServiceOptions, profile:'HOSPITAL_LIVE' };
declare const fullOptions: FullServiceProfileOptions;
// @ts-expect-error -- Full service loop cannot weaken its required member reporter policy.
const legacyFull: FullServiceProfileOptions = { ...fullOptions,reporterPolicy:'LEGACY_BOUND_GRANT' };
// @ts-expect-error -- Member OAuth configuration belongs only to the App's environment.
const workerMember: G2RoleEnvironment<'WORKER'> = { YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG_JSON:'{}' };
// @ts-expect-error -- Gateway cannot inherit App's web OAuth secret.
const gatewaySecret: G2RoleEnvironment<'GATEWAY'> = { APP_SECRET:'synthetic' };
// @ts-expect-error -- Only the Worker owns its member directory token capability.
const appDirectory: G2RoleEnvironment<'APP'> = { P2_G2_DIRECTORY_ACCESS_TOKEN:'synthetic' };
const gatewayFlags = yxxSelfServiceRoleEnvironment('GATEWAY',{});
// @ts-expect-error -- Gateway receives no web self-service flags.
void gatewayFlags.YIXIAOXIU_SELF_SERVICE_ENABLED;
const workerFlags = yxxSelfServiceRoleEnvironment('WORKER',{});
const workerFlag: 'true'|'false' = workerFlags.YIXIAOXIU_SELF_SERVICE_ENABLED;
declare const cluster: ReturnType<typeof createG2ProcessCluster>;
const samplerCluster: G2ResourceCluster = cluster;
void cluster.start(); void cluster.stop(); void cluster.metrics();
// @ts-expect-error -- Fault control cannot invent an additional approved fault identifier.
void cluster.disconnectGatewayForFault('G2-F99');
declare const control: G2ControlMessage;
if(control.type==='g2-synthetic-inbound') { const frame:unknown = control.frame; void frame; }
// @ts-expect-error -- IPC request data cannot replace the controller-selected process role.
const overriddenRole: G2ControlMessage = {type:'g2-provider-counts',request_id:'synthetic',role:'APP'};
// @ts-expect-error -- App control cannot accept a Gateway-only synthetic inbound operation.
const appInbound: G2RoleControl<'APP'> = {type:'g2-synthetic-inbound',request_id:'synthetic',frame:{}};
// @ts-expect-error -- Live provider JSON cannot claim the synthetic provider's numeric zero ACK.
const syntheticResult: SyntheticG2ProviderResult = json;
declare const memberConfig: YxxG2AppConfiguration;
declare const identityMapping: YxxIdentityMapping;
declare const memberFlags: YxxMemberFlags;
const p07Profile: SelfServiceProfileOptions = {...selfServiceOptions,reporterMemberEntry:memberConfig,identityMapping,yxxSelfService:{featureFlags:memberFlags}};
void [noSelfService,fifthProfile,legacyFull,workerMember,gatewaySecret,appDirectory,workerFlag,samplerCluster,overriddenRole,appInbound,syntheticResult,p07Profile];

// Existing regex checks coerce values rather than normalize their JSON representation.
// These negative cases protect the honest public return contracts.
if (!manifest.approval.approved) {
  const rawAuthority: unknown = manifest.approval.authority;
  // @ts-expect-error -- An unapproved authority has not passed the owner's literal guard.
  const ownerAuthority: 'PROJECT_OWNER' | null = manifest.approval.authority;
  void [rawAuthority,ownerAuthority];
}
// @ts-expect-error -- Regex-only candidate input has not become a generated candidate digest.
const uncheckedFingerprint: CandidateFingerprint = manifest.candidate_fingerprint;
// @ts-expect-error -- Regex-only manifest run IDs may still have their original JSON shape.
const uncheckedRun: string = manifest.run_id;
// @ts-expect-error -- The optional member hash is not checked on the legacy policy path.
const uncheckedMemberHash: string | undefined = manifest.scope.member_entry_config_sha256;
const optionalEvents: string[] | null | undefined = manifest.scope.ticket_notification_additional_events;
// @ts-expect-error -- A raw manifest permits explicit null before configuration normalization.
const normalizedEvents: string[] | undefined = manifest.scope.ticket_notification_additional_events;
// @ts-expect-error -- Stored SDK receipt time has only passed a coercing regular expression.
const sdkTime: string = providerReceipt.physical_epoch_ms;
declare const storedWebhook: StoredWebhookReceipt;
// @ts-expect-error -- Stored webhook receipt time has only passed a coercing regular expression.
const webhookTime: string = storedWebhook.physical_epoch_ms;
// @ts-expect-error -- Limited manifest OID may retain a number accepted by the original regex.
const databaseOid: string = approved.database.oid;
import { validateG2EvidenceRecord } from '../../src/p2-g2-evidence.mjs';
import { validateTargetedCreationConfig } from '../../src/p2-g2-yxx-targeted-creation.mjs';
const evidenceRecord = validateG2EvidenceRecord(json);
// @ts-expect-error -- Regex-only source digests do not prove a normalized source string.
const evidenceSource: SourceSHA256 = evidenceRecord.source_refs[0]?.sha256;
// @ts-expect-error -- Regex-only assertion labels do not prove normalized strings.
const assertionCode: string | undefined = evidenceRecord.details.assertions?.[0]?.code;
const verifiedRecordHash: EvidenceSHA256 = evidenceRecord.record_hash;
// @ts-expect-error -- The previous hash is only regex-checked by the single-record validator.
const uncheckedPrevious: EvidenceSHA256 = evidenceRecord.previous_hash;
const targetedConfig = validateTargetedCreationConfig(json);
// @ts-expect-error -- The creation run ID is not normalized by its regex-only guard.
const creationRun: string = targetedConfig.runId;
void [uncheckedFingerprint,uncheckedRun,uncheckedMemberHash,optionalEvents,normalizedEvents,sdkTime,webhookTime,databaseOid,evidenceSource,assertionCode,verifiedRecordHash,uncheckedPrevious,creationRun];
