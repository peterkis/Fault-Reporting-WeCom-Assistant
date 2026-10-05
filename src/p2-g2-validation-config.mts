import type { BinaryLike } from 'node:crypto';
type TicketNotificationAdditionalEvent = string;
declare const g2DigestKind: unique symbol;
export type G2Digest<Kind extends string> = string & { readonly [g2DigestKind]: Kind };
export type CandidateFingerprint = G2Digest<'CANDIDATE'>;
export type ApprovalScopeHash = G2Digest<'APPROVAL_SCOPE'>;
export type SourceSHA256 = G2Digest<'SOURCE'>;
export type EvidenceSHA256 = G2Digest<'EVIDENCE'>;
export type DatabaseIdentityHash = G2Digest<'DATABASE_IDENTITY'>;
export type G2Role = 'APP' | 'WORKER' | 'GATEWAY';
export type G2FaultId = 'G2-F01' | 'G2-F02' | 'G2-F03' | 'G2-F04' | 'G2-N03' | 'G2-R02';
export type G2TemplateCode = 'RULE_FIRST_ORCHESTRATOR' | 'TICKET_LIFECYCLE' | 'HUMAN_CONFIRMED_INCIDENT';
export interface G2Scope {
 bot_hash: string; group_hashes: string[]; person_hashes: string[]; direct_organic_person_hash: string;
 principal_ids: string[]; database_identity_hash: DatabaseIdentityHash; test_prefix: '【p2-g2测试】';
 approved_inputs: string[]; approved_replies: string[]; approved_templates: G2TemplateCode[];
 allowed_faults: G2FaultId[]; send_budget: {group:number;person:number;total:number};
 ticket_notification_additional_events?: TicketNotificationAdditionalEvent[];
 group_webhook_routes?: {group_hash:string;endpoint_hash:string}[];
 member_directory?: {enabled:boolean;internal_member_ids_confirmed:boolean};
 reporter_access_policy?: 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED'; member_entry_config_sha256?: string;
}
interface G2ManifestBase {schema_version:1;gate:'P2-G2';run_id:string;candidate_fingerprint:CandidateFingerprint;
 feature_flags: Record<G2RequiredFlag,true> & Record<G2ForbiddenFlag,false>;
 listen_port:number;reporter_origin:string;scope:G2Scope;}
export interface G2Approval {approved:boolean;authority:'PROJECT_OWNER' | null;source_ref:string|null;
 source_sha256:SourceSHA256|null;valid_from_epoch_ms:string;expires_epoch_ms:string;}
export type SyntheticManifest = G2ManifestBase & {mode:'synthetic';approval:G2Approval};
export type LiveManifest = G2ManifestBase & {mode:'live';approval:G2Approval};
export type G2Manifest = SyntheticManifest | LiveManifest;
export type G2RequiredFlag = typeof G2_REQUIRED_FLAGS[number];
export type G2ForbiddenFlag = typeof G2_FORBIDDEN_FLAGS[number];
// An exact-key checked object still has unvalidated values until the scalar guards below pass.
type InputObject = Record<string, unknown>;
type ManifestInput = {schema_version?:unknown;gate?:unknown;mode?:unknown;run_id?:unknown;candidate_fingerprint?:unknown;
 feature_flags?:InputObject;listen_port?:unknown;reporter_origin?:unknown;scope?:InputObject;approval?:InputObject};
export interface G2Configuration {manifest:G2Manifest;liveApproved:boolean;databaseUrl:string;
 reporterPolicy:'LEGACY_BOUND_GRANT'|'MEMBER_REQUIRED';memberDirectoryEnabled:boolean;memberDirectoryAccessToken:string|null;
 botId:string;secret:string|undefined;wsUrl:string|undefined;identityHashKey:string;reporterHmacSecret:string;
 groupClosureWebhookRoutes:readonly {botId:string;groupId:string;url:string}[];
 ticketNotificationAdditionalEvents:readonly TicketNotificationAdditionalEvent[];}
export interface G2ConfigurationInput {manifest?:unknown;env?:NodeJS.ProcessEnv;candidateFingerprint?:CandidateFingerprint;
 nowEpochMs?:string;role?:G2Role|'CONTROLLER';}
import { createHash } from 'node:crypto';
import { assertPlainJson, deepFreeze } from './p2-007-domain-utils.mjs';
import { ticketNotificationP2016 } from './p2-016-ticket-notification-policy.mjs';

export const G2_REQUIRED_FLAGS = Object.freeze(['CONVERSATION_CENTER_ENABLED', 'CONVERSATION_REALTIME_SSE_ENABLED',
  'HUMAN_WORKBENCH_V2_ENABLED', 'RULE_FIRST_ORCHESTRATION_ENABLED', 'MANUAL_REVIEW_QUEUE_ENABLED',
  'TICKET_LIFECYCLE_WORKBENCH_ENABLED', 'REPORTER_TIMELINE_ENABLED', 'WECOM_TEMPLATE_CARD_ENABLED',
  'INCIDENT_CORRELATION_ENABLED', 'INCIDENT_PUBLIC_NOTICE_ENABLED', 'INCIDENT_PRIVATE_NOTICE_ENABLED'] as const);
export const G2_FORBIDDEN_FLAGS = Object.freeze(['AI_TRIAGE_ENABLED', 'AI_CONVERSATION_ENABLED', 'AI_AUTO_REPLY_ENABLED',
  'OCR_ENABLED', 'INTEGRATION_CONNECTOR_ENABLED', 'HOSPITAL_IDENTITY_ENABLED', 'INTRANET_PORTAL_SOURCE_ENABLED',
  'HOSPITAL_API_SOURCE_ENABLED', 'MONITORING_SOURCE_ENABLED'] as const);
export const G2_LIVE_FUSES = Object.freeze(['P2_G2_LIVE_TEST_APPROVED', 'P2_G2_TEST_SCOPE_CONFIGURED',
  'P2_G2_REAL_WECOM_SEND_APPROVED', 'P2_G2_INCIDENT_PUBLIC_NOTICE_APPROVED', 'P2_G2_INCIDENT_PRIVATE_NOTICE_APPROVED'] as const);
export const G2_TEST_PREFIX = '【p2-g2测试】';
export const G2_TEMPLATE_CODES = Object.freeze(['RULE_FIRST_ORCHESTRATOR', 'TICKET_LIFECYCLE', 'HUMAN_CONFIRMED_INCIDENT'] as const);
export const G2_FAULT_IDS = Object.freeze(['G2-F01', 'G2-F02', 'G2-F03', 'G2-F04', 'G2-N03', 'G2-R02'] as const);
export const G2_LIMITS = Object.freeze({ app_pool: 4, worker_pool: 2, gateway_pool: 1, controller_pool: 1,
  batch: 20, sse_clients: 32, input_turns: 50, input_characters: 20000, list: 100, direct_session_idle_timeout_ms: 1800000,
  observation_ms: 3600000, sample_interval_ms: 15000, maximum_sample_gap_ms: 30000, business_activity_gap_ms: 900000 });
const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export const g2Hash = (text: BinaryLike) => createHash('sha256').update(text).digest('hex');
export function failG2(code = 'INPUT_INVALID'): never { throw Object.assign(new Error('P2_G2_' + code), { code: 'P2_G2_' + code }); }
function exact(value: unknown, keys: readonly string[]): asserts value is InputObject {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) failG2('MANIFEST_INVALID');
}
function list(value: unknown, minimum: number, maximum: number, accepts: (value: unknown) => boolean): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
    || new Set(value).size !== value.length || value.some(v => !accepts(v))) failG2('SCOPE_INVALID');
}
function epoch(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n) failG2('EPOCH_INVALID');
  return BigInt(value);
}
export function minimalG2Environment(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => typeof value === 'string'
    && /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|HOME|LANG|LC_ALL)$/iu.test(key)));
}
export function g2DatabaseIdentity(databaseUrl: unknown) {
  let parsed; try { parsed = new URL(databaseUrl as string); } catch { failG2('DATABASE_CONFIGURATION_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.pathname || parsed.pathname === '/') failG2('DATABASE_CONFIGURATION_INVALID');
  return { parsed, fingerprint: g2Hash(JSON.stringify({ hostname: parsed.hostname, port: parsed.port || '5432', database: decodeURIComponent(parsed.pathname.slice(1)) })) as DatabaseIdentityHash };
}

// Pure configuration validation: no filesystem approval lookup, database, listener, SDK or network.
// The assembly additionally verifies the referenced approval file and freshly computed source fingerprint.
export function validateG2Manifest(manifest: unknown): G2Manifest {
  let m: ManifestInput; try { m = assertPlainJson(manifest, { maxNodes: 5000, maxArrayLength: 250, maxStringLength: 20000 }) as ManifestInput; }
  catch { failG2('MANIFEST_INVALID'); }
  exact(m, ['schema_version', 'gate', 'mode', 'run_id', 'candidate_fingerprint', 'feature_flags',
    'listen_port', 'reporter_origin', 'scope', 'approval']);
  if (m.schema_version !== 1 || m.gate !== 'P2-G2' || !['synthetic', 'live'].includes(m.mode as string) || !UUID.test((m.run_id) as string)) failG2('MANIFEST_INVALID');
  if (!HASH.test((m.candidate_fingerprint) as string)) failG2('CANDIDATE_CHANGED');
  if (!m.feature_flags || G2_REQUIRED_FLAGS.some(k => (m.feature_flags as InputObject)[k] !== true)) failG2('REQUIRED_FLAG_MISSING');
  if (G2_FORBIDDEN_FLAGS.some(k => (m.feature_flags as InputObject)[k] !== false)) failG2('FORBIDDEN_FLAG');
  exact(m.feature_flags, [...G2_REQUIRED_FLAGS, ...G2_FORBIDDEN_FLAGS]);
  if (!Number.isInteger(m.listen_port) || (m.listen_port as number) < 1024 || (m.listen_port as number) > 65535) failG2('LISTEN_PORT_INVALID');
  let origin; try { origin = new URL(m.reporter_origin as string); } catch { failG2('REPORTER_ORIGIN_INVALID'); }
  if (origin.origin !== m.reporter_origin || origin.username || origin.password
    || (m.mode === 'live' ? origin.protocol !== 'https:' || loopback(origin.hostname)
      : origin.protocol !== 'http:' || !loopback(origin.hostname) || Number(origin.port) !== m.listen_port)) failG2('REPORTER_ORIGIN_INVALID');
  const s = m.scope;
  exact(s, ['bot_hash', 'group_hashes', 'person_hashes', 'direct_organic_person_hash', 'principal_ids', 'database_identity_hash',
    'test_prefix', 'approved_inputs', 'approved_replies', 'approved_templates', 'allowed_faults', 'send_budget',
    ...['ticket_notification_additional_events','group_webhook_routes','member_directory','reporter_access_policy','member_entry_config_sha256'].filter(k=>Object.hasOwn((s as InputObject),k))]);
  if(s.reporter_access_policy!==undefined&&!['LEGACY_BOUND_GRANT','MEMBER_REQUIRED'].includes(s.reporter_access_policy as string))failG2('MEMBER_POLICY_REQUIRED');
  if(m.mode==='live'&&s.reporter_access_policy!=='MEMBER_REQUIRED')failG2('MEMBER_POLICY_REQUIRED');
  if(s.reporter_access_policy==='MEMBER_REQUIRED'&&!HASH.test((s.member_entry_config_sha256??'') as string))failG2('MEMBER_POLICY_REQUIRED');
  if(s.member_directory!==undefined){
    exact(s.member_directory,['enabled','internal_member_ids_confirmed']);
    if(typeof s.member_directory.enabled!=='boolean'||typeof s.member_directory.internal_member_ids_confirmed!=='boolean'
      ||(s.member_directory.enabled&&!s.member_directory.internal_member_ids_confirmed))failG2('DIRECTORY_CONFIGURATION_INVALID');
  }
  if (!HASH.test((s.bot_hash) as string) || !HASH.test((s.database_identity_hash) as string) || s.test_prefix !== G2_TEST_PREFIX) failG2('SCOPE_INVALID');
  list(s.group_hashes, 1, 20, v => typeof v === 'string' && HASH.test(v));
  list(s.person_hashes, 3, 20, v => typeof v === 'string' && HASH.test(v));
  if (!(s.person_hashes as unknown[]).includes(s.direct_organic_person_hash)) failG2('DIRECT_ORGANIC_SCOPE_REQUIRED');
  list(s.principal_ids, 3, 4, v => typeof v === 'string' && UUID.test(v));
  const safeText = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 2000 && !v.includes('\0');
  list(s.approved_inputs, 1, 200, safeText); list(s.approved_replies, 1, 30, safeText);
  list(s.approved_templates, 3, 3, v => (G2_TEMPLATE_CODES as readonly unknown[]).includes(v));
  list(s.allowed_faults, 0, G2_FAULT_IDS.length, v => (G2_FAULT_IDS as readonly unknown[]).includes(v));
  const additional=s.ticket_notification_additional_events??[];
  list(additional,0,11,v=>typeof v==='string');
  try{ticketNotificationP2016({event_type:'ticket.accepted',new_status:'ACCEPTED'},{additionalEventTypes:additional as TicketNotificationAdditionalEvent[]});}
  catch{failG2('NOTIFICATION_POLICY_INVALID');}
  const routes=s.group_webhook_routes??[];
  if(!Array.isArray(routes)||routes.length>20)failG2('WEBHOOK_ROUTE_MISMATCH');
  const groups=new Set(),endpoints=new Set();
  for(const route of routes){
    exact(route,['group_hash','endpoint_hash']);
    if(!(s.group_hashes as unknown[]).includes(route.group_hash)||!HASH.test((route.endpoint_hash) as string)||groups.has(route.group_hash)||endpoints.has(route.endpoint_hash))failG2('WEBHOOK_ROUTE_MISMATCH');
    groups.add(route.group_hash);endpoints.add(route.endpoint_hash);
  }
  exact(s.send_budget, ['group', 'person', 'total']);
  if (Object.values(s.send_budget).some(v => !Number.isInteger(v) || (v as number) < 1 || (v as number) > 1000)
    || (s.send_budget.total as number) > (s.send_budget.group as number) + (s.send_budget.person as number)) failG2('SEND_BUDGET_INVALID');
  const a = m.approval;
  exact(a, ['approved', 'authority', 'source_ref', 'source_sha256', 'valid_from_epoch_ms', 'expires_epoch_ms']);
  if (typeof a.approved !== 'boolean') failG2('OWNER_START_APPROVAL_REQUIRED');
  const start = epoch(a.valid_from_epoch_ms), end = epoch(a.expires_epoch_ms);
  if (end <= start || end - start > 21600000n) failG2('APPROVAL_WINDOW_INVALID');
  if (a.approved && (a.authority !== 'PROJECT_OWNER' || typeof a.source_ref !== 'string'
    || !/^evidence\/p2-g2-live-start-approval(?:-[a-z0-9-]+)?\.md$/u.test(a.source_ref)
    || !HASH.test((a.source_sha256 ?? '') as string))) failG2('OWNER_START_APPROVAL_REQUIRED');
  return deepFreeze(m) as ManifestInput & G2Manifest;
}

export function readG2Configuration({ manifest, env = process.env, candidateFingerprint, nowEpochMs = String(Date.now()), role = 'CONTROLLER' }: G2ConfigurationInput = {}): G2Configuration {
  if (!['CONTROLLER', 'APP', 'WORKER', 'GATEWAY'].includes(role)) failG2('PROCESS_ROLE_INVALID');
  const m = validateG2Manifest(manifest), s = m.scope, a = m.approval;
  if (!HASH.test(candidateFingerprint ?? '') || m.candidate_fingerprint !== candidateFingerprint) failG2('CANDIDATE_CHANGED');
  const start = epoch(a.valid_from_epoch_ms), end = epoch(a.expires_epoch_ms), now = epoch(nowEpochMs);
  if (m.mode === 'live') {
    if (G2_LIVE_FUSES.some(k => env[k] !== 'true')) failG2('LIVE_APPROVAL_REQUIRED');
    if (!a.approved || a.authority !== 'PROJECT_OWNER' || typeof a.source_ref !== 'string'
      || !/^evidence\/p2-g2-live-start-approval(?:-[a-z0-9-]+)?\.md$/u.test(a.source_ref)
      || !HASH.test((a.source_sha256 ?? '') as string)) failG2('OWNER_START_APPROVAL_REQUIRED');
    if (now < start) failG2('APPROVAL_NOT_STARTED');
    if (now >= end) failG2('APPROVAL_EXPIRED');
  } else if (a.approved || a.authority !== null || a.source_ref !== null || a.source_sha256 !== null) failG2('SYNTHETIC_APPROVAL_INVALID');
  const databaseUrl = env.PILOT_DATABASE_URL, db = g2DatabaseIdentity(databaseUrl);
  if (db.fingerprint !== s.database_identity_hash) failG2('DATABASE_SCOPE_MISMATCH');
  if (m.mode === 'synthetic' && (!loopback(db.parsed.hostname) || !/^p2_015_g2[a-z0-9_]+$/u.test(db.parsed.pathname.slice(1)))) failG2('OWNED_SYNTHETIC_DATABASE_REQUIRED');
  const botId = env.WECOM_BOT_ID, secret = env.WECOM_BOT_SECRET;
  const identityHashKey = env.PILOT_LOG_IDENTITY_HASH_KEY;
  const reporterHmacSecret = env.P2_G2_REPORTER_HMAC_SECRET ?? env.P2_012_REPORTER_HMAC_SECRET;
  if (typeof botId !== 'string' || g2Hash(botId) !== s.bot_hash
    || (['CONTROLLER', 'GATEWAY'].includes(role) && (typeof secret !== 'string' || secret.length < 8))
    || typeof identityHashKey !== 'string' || identityHashKey.length < 16
    || typeof reporterHmacSecret !== 'string' || reporterHmacSecret.length < 32) failG2('PRIVATE_CONFIGURATION_INVALID');
  if (m.mode === 'live' && ['CONTROLLER', 'GATEWAY'].includes(role)
    && !/^wss:\/\/openws\.work\.weixin\.qq\.com\/?$/u.test(env.WECOM_WS_URL ?? '')) failG2('WECOM_ENDPOINT_INVALID');
  const approvedRoutes=s.group_webhook_routes??[];
  let groupClosureWebhookRoutes: {botId:string;groupId:string;url:string}[]=[];
  if(['CONTROLLER','GATEWAY'].includes(role)){
    let privateRoutes:unknown;try{privateRoutes=JSON.parse(env.P2_G2_GROUP_WEBHOOK_ROUTES??'[]');}catch{failG2('WEBHOOK_ROUTE_MISMATCH');}
    if(!Array.isArray(privateRoutes)||privateRoutes.length!==approvedRoutes.length)failG2('WEBHOOK_ROUTE_MISMATCH');
    const seen=new Set();
    groupClosureWebhookRoutes=privateRoutes.map(route=>{
      exact(route,['group_id','url']);
      if(typeof route.group_id!=='string'||typeof route.url!=='string')failG2('WEBHOOK_ROUTE_MISMATCH');
      let url;try{url=new URL(route.url);}catch{failG2('WEBHOOK_ROUTE_MISMATCH');}
      const groupHash=g2Hash(route.group_id),approval=approvedRoutes.find(r=>r.group_hash===groupHash);
      if(!approval||seen.has(groupHash)||approval.endpoint_hash!==g2Hash(url.href)
        ||url.protocol!=='https:'||url.hostname!=='qyapi.weixin.qq.com'||url.port||url.username||url.password||url.hash
        ||url.pathname!=='/cgi-bin/webhook/send'||url.searchParams.size!==1||!url.searchParams.get('key'))failG2('WEBHOOK_ROUTE_MISMATCH');
      seen.add(groupHash);return Object.freeze({botId,groupId:route.group_id,url:url.href});
    });
  }
  return Object.freeze({ manifest: deepFreeze(m), liveApproved: m.mode === 'live', databaseUrl,reporterPolicy:s.reporter_access_policy??'LEGACY_BOUND_GRANT',
    memberDirectoryEnabled:s.member_directory?.enabled===true,
    memberDirectoryAccessToken:['CONTROLLER','WORKER'].includes(role)&&s.member_directory?.enabled===true
      &&typeof env.P2_G2_DIRECTORY_ACCESS_TOKEN==='string'&&env.P2_G2_DIRECTORY_ACCESS_TOKEN.length>0
      &&env.P2_G2_DIRECTORY_ACCESS_TOKEN.length<=4096?env.P2_G2_DIRECTORY_ACCESS_TOKEN:null,
    botId, secret, wsUrl: m.mode === 'live' ? env.WECOM_WS_URL : 'wss://synthetic.invalid', identityHashKey, reporterHmacSecret,
    groupClosureWebhookRoutes:Object.freeze(groupClosureWebhookRoutes),ticketNotificationAdditionalEvents:s.ticket_notification_additional_events??Object.freeze([]) }) as G2Configuration;
}
