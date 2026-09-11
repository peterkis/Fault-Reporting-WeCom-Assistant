import type {P2016ReporterSession,P2016ReporterTicketView,P2016ReporterTimeline} from './p2_016_contracts';
import type {ReporterMilestone} from './p2_012_contracts';

export type ReporterAccessPolicy = 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED';
export type YixiaoxiuRuntimeProfile = 'OAUTH_ONLY' | 'MEMBER_TICKET_READONLY' | 'FULL_SERVICE_LOOP';
export type YixiaoxiuMemberSession = Readonly<{identity_mode:'MEMBER_REQUIRED'; authenticated:true; read_only:true}>;
export type ReporterBootstrap = P2016ReporterSession | YixiaoxiuMemberSession;
export type YixiaoxiuTicketView = P2016ReporterTicketView & Readonly<{incident_milestones:ReadonlyArray<ReporterMilestone>}>;
export type YixiaoxiuTimeline = P2016ReporterTimeline;
export type YixiaoxiuLegacyPrepare = Readonly<{grant:string}>;
export type YixiaoxiuLegacyPrepared = Readonly<{entry_path:string}>;
export type YixiaoxiuLogout = Readonly<Record<string,never>>;
export type YixiaoxiuLoggedOut = Readonly<{logged_out:true}>;
export type YixiaoxiuMemberEntryConfig = Readonly<{
  enabled:boolean; identityMode:'UNVERIFIED'|'VERIFIED_SAME_NAMESPACE'; memberIdsConfirmed:boolean;
  proofRef:string|null; proofKind:'LIVE'|'SYNTHETIC'|null; corpId:string|null; agentId:string|null; botId:string|null;
  validationProfile:'DEPLOYMENT'|'ISOLATED_TEST';
}>;
export type YixiaoxiuErrorCode = 'YXX_ENTRY_CONFIG_INVALID'|'YXX_ENTRY_DISABLED'|'YXX_ENTRY_IDENTITY_NAMESPACE_UNVERIFIED'
  |'YXX_ENTRY_AUTH_REQUIRED'|'YXX_ENTRY_MEMBER_REQUIRED'|'YXX_ENTRY_NOT_FOUND'|'YXX_ENTRY_INPUT_INVALID'
  |'YXX_ENTRY_ORIGIN_INVALID'|'YXX_ENTRY_LEGACY_EXCHANGE_DISABLED'|'YXX_ENTRY_UNAVAILABLE'|'YXX_ENTRY_BUSY';
export type YixiaoxiuError = Readonly<{error:Readonly<{code:YixiaoxiuErrorCode;retryable:boolean}>}>;
