import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { IncidentCommand as ContractCommand, CandidateReview, Incident, IncidentPublicView, ReporterMilestone } from '../contracts/p2_012_contracts.js';
export type { CandidateReview, Incident, IncidentPublicView, ReporterMilestone };
type UnionKeys<T> = T extends T ? keyof T : never;
type Exclusive<T, All = T> = T extends T ? T & Partial<Record<Exclude<UnionKeys<All>, keyof T>, never>> : never;
export type IncidentCommand = Exclusive<ContractCommand>;
type Normalize<T> = T extends T ? Omit<T, 'expected_row_version'> & { readonly expected_row_version: string } : never;
export type NormalizedIncidentCommand = Exclusive<Normalize<ContractCommand>>;
export type IncidentCommandSuccess = { readonly ok: true; readonly result_ref_type: 'INCIDENT' | 'CANDIDATE'; readonly result_ref_id: string; readonly result_row_version: string; readonly result_event_id: string; readonly replayed: boolean };
export type IncidentCommandFailure = { readonly ok: false; readonly error: { readonly code: string; readonly retryable: false }; readonly replayed: boolean };
export type IncidentCommandResult = IncidentCommandSuccess | IncidentCommandFailure;
export type CandidateProjection = Pick<CandidateReview, 'cluster_key_hash' | 'service_family' | 'symptom_family' | 'scope_candidate' | 'clinical_severity_candidate' | 'distinct_reporters' | 'distinct_departments' | 'distinct_locations' | 'correlation_window_ms' | 'first_seen_at' | 'last_seen_at' | 'reason_codes' | 'evidence_fact_ids'>;
export type P2012Flags = Record<'INCIDENT_CORRELATION_ENABLED' | 'INCIDENT_PUBLIC_NOTICE_ENABLED' | 'INCIDENT_PRIVATE_NOTICE_ENABLED', boolean>;
// A field observation is not a validated JSONB domain object. Existing guards below
// validate the individual command/candidate fields before their strong return types.
type JsonObservation = Record<string, unknown>;
import { createHash } from 'node:crypto';
import { assertPlainJson,deepFreeze } from './p2-007-domain-utils.mjs';
import { WorkbenchError } from './p2-006-workbench-query.mjs';
import { assertLocalDateTime,assertEpochMsString } from './platform/time-contract.mjs';

export const SCOPES=Object.freeze(['LOCAL','BUILDING','CAMPUS','HOSPITAL_WIDE']);
export const INCIDENT_STATES=Object.freeze([...SCOPES.map(s=>'CONFIRMED_'+s),'INVESTIGATING','RESOLVED','CLOSED']);
export const CANDIDATE_STATES=Object.freeze(['CANDIDATE','UNDER_REVIEW','CONFIRMED','REJECTED','EXPIRED']);
export const REASONS=Object.freeze(['OPERATOR_REVIEWED','CONFIRMED_SHARED_FAULT','INCORRECT_ASSOCIATION','RECOVERY_CONFIRMED','SUBSCRIPTION_REQUEST','SCOPE_CORRECTION','MAINTENANCE_EXPIRED','WORKBENCH_CONFIRMED']);
export const ACTIONS=Object.freeze(['START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT','START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT']);
export const LIMITS=Object.freeze({pool:4,list:30,maximumList:100,events:200,sse:32});
export const ERROR_CODES=Object.freeze(["P2_012_COMMAND_CONFLICT","P2_012_COMMAND_FAILED","P2_012_CURSOR_INVALID","P2_012_DIRECT_DESTINATION_REQUIRED","P2_012_DISABLED","P2_012_EXPIRY_CONFLICT","P2_012_FLAG_INVALID","P2_012_FORBIDDEN","P2_012_INPUT_INVALID","P2_012_LIMIT_INVALID","P2_012_LIVE_APPROVAL_REQUIRED","P2_012_NOTIFICATION_EVENT_INVALID","P2_012_NOTIFICATION_FAILED","P2_012_NOT_FOUND","P2_012_OWNER_INVALID","P2_012_PRIMARY_NOT_LINKED","P2_012_PRIMARY_STILL_LINKED","P2_012_REPORT_ALREADY_LINKED","P2_012_SOURCE_CONFLICT","P2_012_SOURCE_EVIDENCE_INCOMPLETE","P2_012_SOURCE_NOT_FOUND","P2_012_STATE_CONFLICT","P2_012_TICKET_ALREADY_LINKED","P2_012_VERSION_CONFLICT"]);
export function fail(code: string='INPUT_INVALID',status=400): never{const value='P2_012_'+code;throw new WorkbenchError(ERROR_CODES.includes(value)?value:'P2_012_INPUT_INVALID',status);}
const HTTP_ERROR_STATUS=Object.freeze(Object.fromEntries(Object.entries({
  400:['INPUT_INVALID','LIMIT_INVALID','CURSOR_INVALID'],
  403:['FORBIDDEN','LIVE_APPROVAL_REQUIRED'],
  404:['NOT_FOUND','SOURCE_NOT_FOUND'],
  409:['COMMAND_CONFLICT','VERSION_CONFLICT','STATE_CONFLICT','EXPIRY_CONFLICT','SOURCE_CONFLICT','OWNER_INVALID',
    'PRIMARY_NOT_LINKED','PRIMARY_STILL_LINKED','REPORT_ALREADY_LINKED','TICKET_ALREADY_LINKED','DIRECT_DESTINATION_REQUIRED','SOURCE_EVIDENCE_INCOMPLETE'],
  503:['NOTIFICATION_FAILED','COMMAND_FAILED','NOTIFICATION_EVENT_INVALID','DISABLED','FLAG_INVALID'],
}).flatMap(([status,codes])=>codes.map(code=>['P2_012_'+code,Number(status)]))));
export function p2012HttpStatusForErrorCode(code: unknown){
  return typeof code==='string'&&Object.hasOwn(HTTP_ERROR_STATUS,code)?((HTTP_ERROR_STATUS as Record<string, number>)[code] as number):503;
}
export function p2012HttpStatusForCommandResult(result: unknown){
  try{
    const r=snapshot(result) as JsonObservation;
    if(r?.ok===false){
      exact(r,['ok','error','replayed']);exact(r.error,['code','retryable']);
      if(typeof r.replayed!=='boolean'||(r.error as JsonObservation).retryable!==false)return 503;
      return p2012HttpStatusForErrorCode((r.error as JsonObservation).code);
    }
    exact(r,['ok','result_ref_type','result_ref_id','result_row_version','result_event_id','replayed']);
    if(r.ok!==true||typeof r.replayed!=='boolean'||!['INCIDENT','CANDIDATE'].includes(r.result_ref_type as string))return 503;
    uuid(r.result_ref_id);uuid(r.result_event_id);version(r.result_row_version);return 200;
  }catch{return 503;}
}
export function snapshot<T>(value: T): T{try{return assertPlainJson(value,{maxDepth:12,maxNodes:12000,maxArrayLength:1000,maxStringLength:4096});}catch{fail();}}
export const frozen=<T,>(value: T): T=>deepFreeze(snapshot(value));
export function exact(input: unknown,keys: readonly string[],required=keys){const v=snapshot(input);if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail();return v as JsonObservation;}
export function uuid(v: unknown): string{if(typeof v!=='string'||v.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))fail();return v.toLowerCase();}
export function version(v: unknown): string{if(typeof v!=='string'||!/^[1-9][0-9]{0,18}$/u.test(v)||v.trim()!==v||BigInt(v)>9223372036854775807n)fail();return v;}
export function code(v: unknown): string{if(typeof v!=='string'||v.trim()!==v||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(v))fail();return v;}
export function hashText(v: string | Buffer){return createHash('sha256').update(v).digest('hex');}
export function hash(value: unknown){const canonical=(v: unknown): unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as JsonObservation)[k])])):v;return hashText(JSON.stringify(canonical(snapshot(value))));}
export function guard(enabled: unknown){if(enabled!==true)fail('DISABLED',503);}
export function limit(v: unknown,maximum=100){if(v===undefined||v===null)return 30;if(!['number','string'].includes(typeof v))fail('LIMIT_INVALID');if(typeof v==='string'&&!/^[1-9][0-9]{0,2}$/u.test(v))fail('LIMIT_INVALID');const n=Number(v);if(!Number.isInteger(n)||n<1||n>maximum)fail('LIMIT_INVALID');return n;}
export function flags(input: unknown={}): P2012Flags{const keys=['INCIDENT_CORRELATION_ENABLED','INCIDENT_PUBLIC_NOTICE_ENABLED','INCIDENT_PRIVATE_NOTICE_ENABLED'],v=exact(input,keys,[]),out: Record<string, boolean>={};for(const k of keys){if(v[k]!==undefined&&![true,false,'true','false'].includes(v[k] as boolean | string))fail('FLAG_INVALID',503);out[k]=v[k]===true||v[k]==='true';}return frozen(out) as P2012Flags;}
export const cursor=(v: unknown)=>Buffer.from(JSON.stringify(snapshot(v))).toString('base64url');
export function decodeCursor(v: unknown,keys: readonly string[]){try{if(typeof v!=='string'||v.length>2048)fail();const p=exact(JSON.parse(Buffer.from(v,'base64url').toString('utf8')),keys);if(cursor(p)!==v)fail();return p;}catch{fail('CURSOR_INVALID');}}
export async function transaction<T>(pool: PostgresPool,run: (tx: PostgresTransaction) => Promise<T>): Promise<T>{const tx=await pool.connect();let destroy=false;try{await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");const r=await run(tx);await tx.query('COMMIT');return r;}catch(e){try{await tx.query('ROLLBACK');}catch{destroy=true;}throw e;}finally{tx.release(destroy);}}
export function normalizeCommand(input: unknown): NormalizedIncidentCommand{
  const base=['action','client_command_id','reason_code'];
  const v=snapshot(input) as JsonObservation;if(!ACTIONS.includes(v?.action as string))fail();
  const candidate=['START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT'].includes(v.action as string);
  const identity=candidate?'candidate_review_id':'incident_id',versionKey=v.action==='CONFIRM_INCIDENT'?'expected_candidate_version':'expected_row_version';
  const extras=({CONFIRM_INCIDENT:['confirmed_scope','owner_principal_id','owner_team_id','primary_ticket_id','selected_report_refs'],CORRECT_SCOPE:['confirmed_scope'],SET_PRIMARY_TICKET:['primary_ticket_id'],LINK_REPORT:['source_decision_id'],UNLINK_REPORT:['incident_report_id','expected_report_version'],MARK_REPORTER_RECOVERED:['incident_report_id','expected_report_version'],PAUSE_SUBSCRIPTION:['subscription_id','expected_subscription_version'],RESUME_SUBSCRIPTION:['subscription_id','expected_subscription_version','direct_channel_leg_id']} as Record<string, string[]>)[v.action as string]??[];
  const required=extras.filter(k=>!['owner_team_id','primary_ticket_id','direct_channel_leg_id'].includes(k));
  exact(v,[...base,identity,versionKey,...extras],[...base,identity,versionKey,...required]);
  if(!REASONS.includes(v.reason_code as string))fail();
  const out: JsonObservation={...v,client_command_id:uuid(v.client_command_id),[identity]:uuid(v[identity]),expected_row_version:version(v[versionKey])};
  for(const k of ['owner_principal_id','primary_ticket_id','source_decision_id','incident_report_id','subscription_id','direct_channel_leg_id'])if(v[k]!=null)out[k]=uuid(v[k]);
  for(const k of ['expected_report_version','expected_subscription_version'])if(v[k]!==undefined)out[k]=version(v[k]);
  if(v.confirmed_scope!==undefined&&!SCOPES.includes(v.confirmed_scope as string))fail();
  if(v.owner_team_id!=null)out.owner_team_id=code(v.owner_team_id);
  if(v.action==='SET_PRIMARY_TICKET'&&!Object.hasOwn(v,'primary_ticket_id'))fail();
  if(v.selected_report_refs!==undefined){if(!Array.isArray(v.selected_report_refs)||!v.selected_report_refs.length||v.selected_report_refs.length>100)fail();out.selected_report_refs=v.selected_report_refs.map(uuid).sort();if(new Set(out.selected_report_refs as string[]).size!==(out.selected_report_refs as string[]).length)fail();}
  return frozen(out) as NormalizedIncidentCommand;
}
export function validateCandidate(input: unknown): CandidateProjection{
  const v=snapshot(input) as JsonObservation;
  if(v?.is_candidate!==true||v.creates_incident!==false||v.human_confirmation_required!==true)fail('SOURCE_EVIDENCE_INCOMPLETE',409);
  if(typeof v.cluster_key_hash!=='string'||!/^[a-f0-9]{64}$/u.test(v.cluster_key_hash))fail();
  code(v.service_family);code(v.symptom_family);
  if(!['ROOM','DEPARTMENT','CAMPUS','HOSPITAL_WIDE'].includes(v.scope_candidate as string)||!['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL'].includes(v.clinical_severity_candidate as string))fail();
  for(const k of ['distinct_reporters','distinct_departments','distinct_locations','correlation_window_ms'])if(!Number.isSafeInteger(v[k])||(v[k] as number)<0||(v[k] as number)>2147483647)fail();
  if(!Array.isArray(v.reason_codes)||v.reason_codes.length>100||!Array.isArray(v.evidence_fact_ids)||v.evidence_fact_ids.length>1000)fail();
  v.reason_codes.forEach(code);if(v.evidence_fact_ids.some(x=>typeof x!=='string'||!/^fact_[A-Za-z0-9_-]{8,96}$/u.test(x)))fail();
  for(const k of ['first_seen_at','last_seen_at'])if(v[k]!=null)assertLocalDateTime(v[k]);
  return frozen(Object.fromEntries(['cluster_key_hash','service_family','symptom_family','scope_candidate','clinical_severity_candidate','distinct_reporters','distinct_departments','distinct_locations','correlation_window_ms','first_seen_at','last_seen_at','reason_codes','evidence_fact_ids'].map(k=>[k,v[k]??null]))) as CandidateProjection;
}
export {assertLocalDateTime,assertEpochMsString};
