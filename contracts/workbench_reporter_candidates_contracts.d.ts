import type {ManualReportCommand,ManualReportResult} from './workbench_manual_report_contracts.js';
import type {YxxMemberScope} from '../src/yxx-self-service-authorization.mjs';

/** T18 GET locally validated; verified admission contracts await their own real first RED. */
export interface ManualReporterApplicationScope {readonly sourceCorpScope:string;readonly sourceAppScope:string}
export interface WorkbenchReporterCandidate {
  readonly candidate_ref:string;
  readonly candidate_version:string;
  readonly display_name:string;
  readonly departments:readonly string[];
  readonly profile_source:'WECOM_DIRECTORY'|'THIRD_PARTY_STAFF_DIRECTORY';
  readonly binding_verified:true;
  readonly message_reachability:'REACHABLE'|'UNREACHABLE'|'UNKNOWN';
}
export interface WorkbenchReporterCandidates {
  readonly schema_version:1;
  readonly candidates:readonly WorkbenchReporterCandidate[];
  readonly next_cursor:string|null;
  readonly manual_fallback_available:true;
}
export interface ManualReporterSearch {
  readonly principal_id:string;
  readonly application:ManualReporterApplicationScope;
  readonly directory_source_scope:string;
  readonly query:string;
  readonly limit:number;
  readonly cursor:string|null;
  readonly signal:AbortSignal;
}
export interface ManualReporterSelection {
  readonly verification:'VERIFIED_SELECTION';
  readonly candidate_ref:string;
  readonly candidate_version:string;
}
/** External/current-directory authority only; neither method accepts browser identity fields.
 * GET search must filter the principal's configured application/object scope before paging.
 * The Port owns opaque cursor principal/application/directory/query/limit/version binding,
 * rejects mismatched/expired cursors (maximum 5min), and honors the supplied abort signal.
 * The host validates the closed 16KiB page, bounded labels/references, 2s deadline and
 * concurrency/rate limits; it never derives identity equivalence from returned labels.
 * Verification returns the closed ADMISSION or READ_COMMITTED envelope below. A
 * controlled adapter must resolve existing mapped identity and directory authority;
 * binding_verified on a candidate page is not admission proof. No browser supplies
 * proof, actor, application, target scope or mapping configuration.
 */
export interface ManualReporterDirectoryPort {
  searchAuthorizedCandidates(input:ManualReporterSearch):Promise<unknown>;
  verifyAuthorizedCandidate(input:ManualReporterVerificationInput):Promise<unknown>;
}
export type ManualReporterVerificationInput=Omit<ManualReporterSearch,'query'|'limit'|'cursor'>&{readonly selection:ManualReporterSelection}&(
  {readonly purpose:'ADMISSION';readonly committed_target_scope:null}
  |{readonly purpose:'READ_COMMITTED';readonly committed_target_scope:YxxMemberScope}
);
/** Server configuration pinned from the existing mapping/config authority, never request JSON. */
export interface ManualReporterVerificationAuthority {
  readonly mappingConfigHash:string;
  readonly mappingProofRef:string;
  readonly proofKind:'LIVE'|'SYNTHETIC';
  readonly validationProfile:'DEPLOYMENT'|'ISOLATED_TEST';
}
export interface ManualReporterDirectoryOptions {
  readonly application:ManualReporterApplicationScope;
  readonly directorySourceScope:string;
  readonly port:ManualReporterDirectoryPort;
  /** Optional for GET only; missing/invalid authority cannot enable VERIFIED admission. */
  readonly verificationAuthority?:ManualReporterVerificationAuthority|null;
}
export interface VerifiedManualReportCommand extends Omit<ManualReportCommand,'reporter'> {
  readonly reporter:ManualReporterSelection;
}
export interface VerifiedManualReportResult extends Omit<ManualReportResult,'reporter_verification'|'manual_contact_required'> {
  readonly reporter_verification:'VERIFIED';
  readonly manual_contact_required:boolean;
  readonly notification_eligibility:'ELIGIBLE'|'NOT_REACHABLE';
}
/** Immutable observation of existing authorities, not a replacement identity registry. */
export interface ManualReporterVerifiedProof {
  readonly source:'VERIFIED_DIRECTORY_SELECTION';
  readonly scope:YxxMemberScope;
  readonly mapping_config_hash:string;
  readonly verification_method:'VERIFIED_DELEGATED_MAPPING';
  readonly profile_source:WorkbenchReporterCandidate['profile_source'];
  readonly directory_source_scope:string;
  readonly directory_snapshot_version:string;
  readonly profile_at_report:{readonly display_name:string;readonly departments:readonly string[]};
  readonly binding_proof_ref:string;
  readonly account_status:'ACTIVE';
  readonly binding_state:'VERIFIED';
  readonly proof_kind:'LIVE'|'SYNTHETIC';
  readonly reachability:{readonly status:WorkbenchReporterCandidate['message_reachability'];readonly target_scope_hash:string;readonly checked_at:string;readonly checked_at_epoch_ms:string;readonly proof_ref:string|null};
  readonly verified_at:string;
  readonly verified_at_epoch_ms:string;
  readonly actor_principal_id:string;
}
interface ManualReporterVerificationEnvelopeBase {
  readonly schema_version:1;
  readonly selection:ManualReporterSelection;
  readonly application:ManualReporterApplicationScope;
  readonly directory_source_scope:string;
  readonly actor_principal_id:string;
  readonly object_access:'ALLOWED';
  readonly authorized_at:string;
  readonly authorized_at_epoch_ms:string;
  readonly valid_until:string;
  readonly valid_until_epoch_ms:string;
}
export interface ManualReporterAdmissionEnvelope extends ManualReporterVerificationEnvelopeBase {
  readonly purpose:'ADMISSION';readonly proof:ManualReporterVerifiedProof;
}
export interface ManualReporterObjectReadEnvelope extends ManualReporterVerificationEnvelopeBase {
  readonly purpose:'READ_COMMITTED';readonly target_scope:YxxMemberScope;
}
export type ManualReporterVerificationEnvelope=ManualReporterAdmissionEnvelope|ManualReporterObjectReadEnvelope;
/** Public retained data excludes contacts, raw member IDs, mapping and private proof references. */
export interface VerifiedManualReportProjection extends Omit<ManualReportCommand,'reporter'|'schema_version'|'client_command_id'> {
  readonly source_kind:'MANUAL_REPORT';readonly identity_source:'VERIFIED_DIRECTORY_SELECTION';
  readonly reporter:{readonly verification:'VERIFIED';readonly name:string;readonly departments:readonly string[]};
  readonly actor_principal_id:string;readonly manual_contact_required:boolean;readonly external_notification:false;
  readonly notification_eligibility:'ELIGIBLE'|'NOT_REACHABLE';
}
export type VerifiedManualReportReceipt={readonly client_command_id:string}&(
  {readonly state:'UNKNOWN'}|{readonly state:'FAILED';readonly error:{readonly code:string;readonly retryable:false}}
  |{readonly state:'COMMITTED';readonly result:VerifiedManualReportResult&{readonly replayed:true}}
);
