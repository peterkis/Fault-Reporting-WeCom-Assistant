import type {YxxMemberScope} from '../src/yxx-self-service-authorization.mjs';
import type {LocalDateTime,PhysicalEpochMs} from './time_contracts.js';

/** T25 original-source App notification options implemented by the existing round consumer/runtime. */
export type TicketAppNotificationSource='WEB_REQUEST'|'VERIFIED_MANUAL_REPORT';

/** Existing mapping/application authority supplied by server composition, never HTTP JSON. */
export interface TicketAppNotificationAuthority {
  readonly sourceCorpScope:string;
  readonly sourceAppScope:string;
  readonly channelAccountId:string;
  readonly mappingConfigHash:string;
  readonly mappingProofRef:string;
  readonly proofKind:'LIVE'|'SYNTHETIC';
  readonly validationProfile:'DEPLOYMENT'|'ISOLATED_TEST';
}

export interface TicketAppNotificationTargetInput {
  readonly source_kind:TicketAppNotificationSource;
  readonly scope:YxxMemberScope;
  readonly signal:AbortSignal;
}

interface TicketAppNotificationTargetResultBase {
  readonly schema_version:1;
  readonly source_kind:TicketAppNotificationSource;
  readonly scope:YxxMemberScope;
  readonly checked_at:LocalDateTime;
  readonly checked_at_epoch_ms:PhysicalEpochMs;
}

/** Private target and evidence stay in the resolver/Communication boundary. */
export interface EligibleTicketAppNotificationTarget extends TicketAppNotificationTargetResultBase {
  readonly state:'ELIGIBLE';
  readonly target:{readonly provider:'WECOM_APP';readonly channel_account_id:string;readonly target_type:'PERSON';readonly target_id:string};
  readonly verification:{
    readonly mapping_config_hash:string;
    readonly mapping_proof_ref:string;
    readonly binding_proof_ref:string;
    readonly proof_kind:'LIVE'|'SYNTHETIC';
    readonly account_status:'ACTIVE';
    readonly binding_state:'VERIFIED';
    readonly message_reachability:'REACHABLE';
  };
}

export interface IneligibleTicketAppNotificationTarget extends TicketAppNotificationTargetResultBase {
  readonly state:'NOT_ELIGIBLE';
  readonly reason:'NO_MAPPING'|'SCOPE_MISMATCH'|'STALE'|'REVOKED'|'UNREACHABLE'|'UNKNOWN';
}
export type TicketAppNotificationTargetResult=EligibleTicketAppNotificationTarget|IneligibleTicketAppNotificationTarget;

/** Resolves current, already verified authority locally; no Provider/SDK call in a DB transaction.
 * Hosts must validate the closed unknown envelope, original scope and configured authority.
 * A candidate label, hash, old ADMISSION proof or directory ID cannot grant send authority.
 */
export interface TicketAppNotificationTargetResolver {
  readonly localOnly:true;
  resolveCurrentTarget(input:TicketAppNotificationTargetInput):Promise<unknown>;
}

export interface TicketAppNotificationOptions {
  readonly enabled:boolean;
  readonly authority:TicketAppNotificationAuthority;
  readonly targetResolver:TicketAppNotificationTargetResolver;
}

/** Additive safe Delivery field; PERSON continues to describe the recipient kind. */
export interface TicketAppNotificationPublicRoute {readonly route_kind:'YIXIAOXIU_APP'}
