import type {ManualReportCommand,ManualReportResult} from './workbench_manual_report_contracts.js';
import type {YxxMemberScope} from '../src/yxx-self-service-authorization.mjs';

/** T18 frozen planned boundary; production assembly awaits the first real RED. */
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
/** External/current-directory authority only; neither method accepts browser identity fields. */
export interface ManualReporterDirectoryPort {
  searchAuthorizedCandidates(input:ManualReporterSearch):Promise<unknown>;
  verifyAuthorizedCandidate(input:Omit<ManualReporterSearch,'query'|'limit'|'cursor'>&{
    readonly selection:ManualReporterSelection;
  }):Promise<unknown>;
}
export interface ManualReporterDirectoryOptions {
  readonly application:ManualReporterApplicationScope;
  readonly directorySourceScope:string;
  readonly port:ManualReporterDirectoryPort;
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
  readonly reachability:{readonly status:WorkbenchReporterCandidate['message_reachability'];readonly checked_at:string;readonly proof_ref:string|null};
  readonly verified_at:string;
  readonly actor_principal_id:string;
}
