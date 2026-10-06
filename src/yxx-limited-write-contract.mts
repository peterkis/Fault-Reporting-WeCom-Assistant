import type { YxxEntryConfig } from './p2-g2-yixiaoxiu-contract.mjs';
import type { DatabaseIdentityHash, CandidateFingerprint, ApprovalScopeHash } from './p2-g2-validation-config.mjs';
export type LimitedPermission = typeof permissions[number];
type RequiredPermission = 'database_connect'|'real_oauth_identity'|'background_processing'|'web_submit'|'web_supplement'|'internal_review_ticket_actions';
export type LimitedPermissions = Record<RequiredPermission,true> & Record<'real_message_send'|'parent_p2_g2_live',false> & Record<Exclude<LimitedPermission,RequiredPermission|'real_message_send'|'parent_p2_g2_live'>,boolean>;
export type LimitedTemplate = ReturnType<typeof limitedTemplate>;
export interface ApprovedLimitedManifest {schema_version:1;kind:'OWNER_APPROVED_LIMITED_WRITE';status:'APPROVED';ticket:'YXX-SS-011';run_id:unknown;
 candidate_commit:unknown;candidate_tree:unknown;candidate_fingerprint:unknown;app_version:unknown;config_sha256:unknown;
 identity_proof_ref:string;database:{name:unknown;oid:unknown;identity_sha256:unknown;dedicated_test_only:true};
 reporter_aliases:['A']|['A','B'];principal_ids:[unknown,unknown];window:{starts_at:string;starts_epoch_ms:string;ends_at:string;ends_epoch_ms:string};
 limits:{max_new_intakes:number;max_supplements:number;max_new_tickets:number;per_member_intakes:number;per_member_supplements:number};
 permissions:LimitedPermissions;owner:string;approver:string;approval_record_ref:string;approval_record_sha256:unknown;
 backup_ref:string;rollback_ref:string;public_origin:string;listen_port:number}
export type LimitedMemberConfig = Extract<YxxEntryConfig,{enabled:true}> & {identityMode:'VERIFIED_DELEGATED_MAPPING';reporterUserIds:string[];proofRef:string};
export interface LimitedConfiguration {env:NodeJS.ProcessEnv;member:LimitedMemberConfig}
export interface LimitedArguments {mode:'check'|'run'|'require-ready'|'help';resume:boolean;manifest?:string;'env-file'?:string;'state-dir'?:string}
type InputObject = Record<string,unknown>;
import {createHash,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseEnv,isDeepStrictEqual} from 'node:util';
import {validateYxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';
import {shanghaiLocalToEpochMs} from './platform/time-contract.mjs';

export const SS010_BASE='c1af81a86951054f4898f043c43381a5842abbf2';
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as InputObject)[key])])):value;
export const digest=(value:unknown)=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(canonical(value))).digest('hex');
export function reject(code='CONFIG_INVALID'): never{throw Object.assign(new Error('SS010_'+code),{code:'SS010_'+code});}
export const permissions=Object.freeze(['database_connect','real_oauth_identity','background_processing','web_submit','web_supplement','internal_review_ticket_actions',
  'app_deploy','proxy_change','database_backup','migration_033_check','migration_034_check','migration_033_apply','migration_034_apply','fault_injection','real_message_send','parent_p2_g2_live'] as const);
const requiredPermissions=permissions.slice(0,6);
const hash=/^[a-f0-9]{64}$/u,sha=/^[a-f0-9]{40}$/u,uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
export function limitedTemplate(){return {
  schema_version:1,kind:'TEMPLATE_NOT_AUTHORIZATION',status:'NOT_AUTHORIZED',ticket:'YXX-SS-011',run_id:null,
  candidate_commit:null,candidate_tree:null,candidate_fingerprint:null,app_version:null,config_sha256:null,
  identity_proof_ref:null,database:{name:null,oid:null,identity_sha256:null,dedicated_test_only:true},
  reporter_aliases:['A','B'],principal_ids:[],window:{starts_at:null,starts_epoch_ms:null,ends_at:null,ends_epoch_ms:null},
  limits:{max_new_intakes:null,max_supplements:null,max_new_tickets:null,per_member_intakes:null,per_member_supplements:null},
  permissions:Object.fromEntries(permissions.map(key=>[key,false])) as Record<LimitedPermission,false>,owner:null,approver:null,approval_record_ref:null,approval_record_sha256:null,
  backup_ref:null,rollback_ref:null,public_origin:null,listen_port:null,
} as const;}
function exact(value:unknown,keys:readonly string[]): asserts value is InputObject{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())reject();}
const nonempty=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512;
export function validateLimitedManifest(value:unknown,options:{template:true;now?:number;checkWindow?:boolean}): LimitedTemplate;
export function validateLimitedManifest(value:unknown,options?:{template?:false;now?:number;checkWindow?:boolean}): ApprovedLimitedManifest;
export function validateLimitedManifest(value:unknown,{template=false,now=Date.now(),checkWindow=true}: {template?:boolean;now?:number;checkWindow?:boolean}={}): LimitedTemplate|ApprovedLimitedManifest{
  exact(value,Object.keys(limitedTemplate()));
  exact(value.database,Object.keys(limitedTemplate().database));exact(value.window,Object.keys(limitedTemplate().window));
  exact(value.limits,Object.keys(limitedTemplate().limits));exact(value.permissions,permissions);
  if(value.schema_version!==1||value.ticket!=='YXX-SS-011'||(value.database as InputObject).dedicated_test_only!==true
    ||permissions.some(key=>typeof (value.permissions as InputObject)[key]!=='boolean'))reject();
  if(template){if(!isDeepStrictEqual(value,limitedTemplate()))reject('TEMPLATE_CHANGED');return value as InputObject & LimitedTemplate;}
  if(value.kind!=='OWNER_APPROVED_LIMITED_WRITE'||value.status!=='APPROVED'
    ||!/^ss011-[a-z0-9-]{1,48}$/u.test((value.run_id??'') as string)||!sha.test((value.candidate_commit??'') as string)||!sha.test((value.candidate_tree??'') as string)
    ||!hash.test((value.candidate_fingerprint??'') as string)||value.app_version!==value.candidate_commit||!hash.test((value.config_sha256??'') as string)
    ||!hash.test((value.approval_record_sha256??'') as string)||!hash.test(((value.database as InputObject).identity_sha256??'') as string)
    ||!/^p2_015_ss010_[a-f0-9_]+$/u.test(((value.database as InputObject).name??'') as string)||!/^\d+$/u.test(((value.database as InputObject).oid??'') as string)
    ||!['identity_proof_ref','owner','approver','approval_record_ref','backup_ref','rollback_ref'].every(key=>nonempty(value[key])))reject('AUTHORIZATION_REQUIRED');
  if(!requiredPermissions.every(key=>(value.permissions as InputObject)[key])||(value.permissions as InputObject).real_message_send||(value.permissions as InputObject).parent_p2_g2_live)reject('PERMISSION_INVALID');
  if(!Array.isArray(value.reporter_aliases)||![1,2].includes(value.reporter_aliases.length)||value.reporter_aliases[0]!=='A'||value.reporter_aliases.length===2&&value.reporter_aliases[1]!=='B'
    ||!Array.isArray(value.principal_ids)||value.principal_ids.length!==2||new Set(value.principal_ids).size!==2||value.principal_ids.some(x=>!uuid.test(x as string)))reject();
  for(const side of ['starts','ends']){
    const epoch=(value.window as InputObject)[side+'_epoch_ms'];
    if(typeof epoch!=='string'||!/^\d{13}$/u.test(epoch)||String(shanghaiLocalToEpochMs((value.window as InputObject)[side+'_at']))!==epoch)reject('WINDOW_INVALID');
  }
  const start=Number((value.window as InputObject).starts_epoch_ms),end=Number((value.window as InputObject).ends_epoch_ms);
  if(end<=start||end-start>65*60_000||checkWindow&&(now<start||now>=end))reject('WINDOW_CLOSED');
  for(const number of Object.values(value.limits))if(!Number.isInteger(number)||(number as number)<1||(number as number)>100)reject('LIMIT_INVALID');
  if((value.limits as ApprovedLimitedManifest['limits']).max_new_intakes>(value.limits as ApprovedLimitedManifest['limits']).max_new_tickets||(value.limits as ApprovedLimitedManifest['limits']).per_member_intakes>(value.limits as ApprovedLimitedManifest['limits']).max_new_intakes
    ||(value.limits as ApprovedLimitedManifest['limits']).per_member_supplements>(value.limits as ApprovedLimitedManifest['limits']).max_supplements)reject('LIMIT_INVALID');
  let origin;try{origin=new URL(value.public_origin as string);}catch{reject();}
  if(origin.origin!==value.public_origin||origin.protocol!=='https:'||origin.username||origin.password
    ||!Number.isInteger(value.listen_port)||(value.listen_port as number)<1024||(value.listen_port as number)>65535)reject();
  return value as InputObject & ApprovedLimitedManifest;
}
export function databaseIdentity(databaseUrl: unknown){
  let url;try{url=new URL(databaseUrl as string);}catch{reject('DATABASE_INVALID');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash)reject('DATABASE_INVALID');
  return {name:decodeURIComponent(url.pathname.slice(1)),identity_sha256:digest([url.hostname,url.port||'5432',decodeURIComponent(url.pathname.slice(1)),decodeURIComponent(url.username)]) as DatabaseIdentityHash};
}
export function readLimitedConfiguration(file:string,manifest:ApprovedLimitedManifest): LimitedConfiguration{
  const env=parseEnv(readFileSync(file,'utf8'));
  if(Object.keys(env).some(key=>!['PILOT_DATABASE_URL','YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG','APP_SECRET','P2_G2_REPORTER_HMAC_SECRET','PILOT_LOG_IDENTITY_HASH_KEY'].includes(key)))reject('UNRELATED_CAPABILITY');
  const member=validateYxxEntryConfig(JSON.parse(readFileSync(env.YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG as string,'utf8')).reporterMemberEntry);
  if(!member.enabled||member.identityMode!=='VERIFIED_DELEGATED_MAPPING'||member.validationProfile!=='DEPLOYMENT'||member.proofKind!=='LIVE'
    ||member.proofRef!==manifest.identity_proof_ref||(member.reporterUserIds as string[]).length!==manifest.reporter_aliases.length
    ||!nonempty(env.APP_SECRET)||Buffer.byteLength(env.P2_G2_REPORTER_HMAC_SECRET??'')<32||Buffer.byteLength(env.PILOT_LOG_IDENTITY_HASH_KEY??'')<16)reject();
  const database=databaseIdentity(env.PILOT_DATABASE_URL);
  if(database.name!==manifest.database.name||database.identity_sha256!==manifest.database.identity_sha256)reject('DATABASE_IDENTITY_MISMATCH');
  const config_sha256=limitedConfigurationDigest({env,member,manifest});
  if(config_sha256!==manifest.config_sha256)reject('CONFIG_DIGEST_MISMATCH');
  return {env,member} as LimitedConfiguration;
}
export function limitedConfigurationDigest({env,member,manifest}: {env:NodeJS.ProcessEnv;member:YxxEntryConfig;manifest:Pick<ApprovedLimitedManifest,'public_origin'|'listen_port'>}){
  return digest({member,database:databaseIdentity(env.PILOT_DATABASE_URL),public_origin:manifest.public_origin,listen_port:manifest.listen_port,
    reporter_secret_sha256:digest(env.P2_G2_REPORTER_HMAC_SECRET),identity_key_sha256:digest(env.PILOT_LOG_IDENTITY_HASH_KEY),app_secret_sha256:digest(env.APP_SECRET)});
}
export function memberBindings(member:LimitedMemberConfig,secret:string){return member.reporterUserIds.map(id=>createHmac('sha256',secret).update(JSON.stringify(['member',member.corpId,member.agentId,id])).digest('hex'));}
export function approvalScope(manifest:ApprovedLimitedManifest): ApprovalScopeHash{const {approval_record_ref,approval_record_sha256,...scope}=manifest;return digest(scope) as ApprovalScopeHash;}
export function verifyLimitedApproval(manifest:ApprovedLimitedManifest,text:string){
  if(digest(text)!==manifest.approval_record_sha256)reject('APPROVAL_RECORD_MISMATCH');
  let record:unknown;try{record=JSON.parse(text);}catch{reject('APPROVAL_RECORD_MISMATCH');}
  exact(record,['kind','run_id','scope_sha256','candidate_commit','owner','approver']);
  if(record.kind!=='SS011_LIMITED_WRITE_APPROVED'||record.run_id!==manifest.run_id||record.scope_sha256!==approvalScope(manifest)
    ||record.candidate_commit!==manifest.candidate_commit||record.owner!==manifest.owner||record.approver!==manifest.approver)reject('APPROVAL_SCOPE_MISMATCH');
}
export function parseLimitedArguments(argv:readonly string[]): LimitedArguments{
  const result:LimitedArguments={mode:'check',resume:false};const seen=new Set();
  for(const arg of argv){
    const mode=/^--(check|run|require-ready|help)$/u.exec(arg),option=/^--(manifest|env-file|state-dir)=(.+)$/u.exec(arg);
    const key=mode?'mode':arg==='--resume'?'resume':option?.[1];
    if(!key||seen.has(key))reject('ARGUMENT_INVALID');seen.add(key);
    if(mode)result.mode=mode[1] as LimitedArguments['mode'];else if(key==='resume')result.resume=true;else result[key as 'manifest'|'env-file'|'state-dir']=(option as RegExpExecArray)[2] as string;
  }
  if(result.resume&&result.mode!=='run')reject('ARGUMENT_INVALID');return result;
}
