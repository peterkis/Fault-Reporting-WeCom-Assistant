import {createHash,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseEnv,isDeepStrictEqual} from 'node:util';
import {validateYxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';
import {shanghaiLocalToEpochMs} from './platform/time-contract.mjs';

export const SS010_BASE='c1af81a86951054f4898f043c43381a5842abbf2';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(canonical(value))).digest('hex');
export function reject(code='CONFIG_INVALID'){throw Object.assign(new Error('SS010_'+code),{code:'SS010_'+code});}
export const permissions=Object.freeze(['database_connect','real_oauth_identity','background_processing','web_submit','web_supplement','internal_review_ticket_actions',
  'app_deploy','proxy_change','database_backup','migration_033_check','migration_034_check','migration_033_apply','migration_034_apply','fault_injection','real_message_send','parent_p2_g2_live']);
const requiredPermissions=permissions.slice(0,6);
const hash=/^[a-f0-9]{64}$/u,sha=/^[a-f0-9]{40}$/u,uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
export function limitedTemplate(){return {
  schema_version:1,kind:'TEMPLATE_NOT_AUTHORIZATION',status:'NOT_AUTHORIZED',ticket:'YXX-SS-011',run_id:null,
  candidate_commit:null,candidate_tree:null,candidate_fingerprint:null,app_version:null,config_sha256:null,
  identity_proof_ref:null,database:{name:null,oid:null,identity_sha256:null,dedicated_test_only:true},
  reporter_aliases:['A','B'],principal_ids:[],window:{starts_at:null,starts_epoch_ms:null,ends_at:null,ends_epoch_ms:null},
  limits:{max_new_intakes:null,max_supplements:null,max_new_tickets:null,per_member_intakes:null,per_member_supplements:null},
  permissions:Object.fromEntries(permissions.map(key=>[key,false])),owner:null,approver:null,approval_record_ref:null,approval_record_sha256:null,
  backup_ref:null,rollback_ref:null,public_origin:null,listen_port:null,
};}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())reject();}
const nonempty=value=>typeof value==='string'&&value.length>0&&value.length<=512;
export function validateLimitedManifest(value,{template=false,now=Date.now(),checkWindow=true}={}){
  exact(value,Object.keys(limitedTemplate()));
  exact(value.database,Object.keys(limitedTemplate().database));exact(value.window,Object.keys(limitedTemplate().window));
  exact(value.limits,Object.keys(limitedTemplate().limits));exact(value.permissions,permissions);
  if(value.schema_version!==1||value.ticket!=='YXX-SS-011'||value.database.dedicated_test_only!==true
    ||permissions.some(key=>typeof value.permissions[key]!=='boolean'))reject();
  if(template){if(!isDeepStrictEqual(value,limitedTemplate()))reject('TEMPLATE_CHANGED');return value;}
  if(value.kind!=='OWNER_APPROVED_LIMITED_WRITE'||value.status!=='APPROVED'
    ||!/^ss011-[a-z0-9-]{1,48}$/u.test(value.run_id??'')||!sha.test(value.candidate_commit??'')||!sha.test(value.candidate_tree??'')
    ||!hash.test(value.candidate_fingerprint??'')||value.app_version!==value.candidate_commit||!hash.test(value.config_sha256??'')
    ||!hash.test(value.approval_record_sha256??'')||!hash.test(value.database.identity_sha256??'')
    ||!/^p2_015_ss010_[a-f0-9_]+$/u.test(value.database.name??'')||!/^\d+$/u.test(value.database.oid??'')
    ||!['identity_proof_ref','owner','approver','approval_record_ref','backup_ref','rollback_ref'].every(key=>nonempty(value[key])))reject('AUTHORIZATION_REQUIRED');
  if(!requiredPermissions.every(key=>value.permissions[key])||value.permissions.real_message_send||value.permissions.parent_p2_g2_live)reject('PERMISSION_INVALID');
  if(!Array.isArray(value.reporter_aliases)||value.reporter_aliases.length!==2||value.reporter_aliases[0]!=='A'||value.reporter_aliases[1]!=='B'
    ||!Array.isArray(value.principal_ids)||value.principal_ids.length!==2||new Set(value.principal_ids).size!==2||value.principal_ids.some(x=>!uuid.test(x)))reject();
  for(const side of ['starts','ends']){
    const epoch=value.window[side+'_epoch_ms'];
    if(typeof epoch!=='string'||!/^\d{13}$/u.test(epoch)||String(shanghaiLocalToEpochMs(value.window[side+'_at']))!==epoch)reject('WINDOW_INVALID');
  }
  const start=Number(value.window.starts_epoch_ms),end=Number(value.window.ends_epoch_ms);
  if(end<=start||end-start>65*60_000||checkWindow&&(now<start||now>=end))reject('WINDOW_CLOSED');
  for(const number of Object.values(value.limits))if(!Number.isInteger(number)||number<1||number>100)reject('LIMIT_INVALID');
  if(value.limits.max_new_intakes>value.limits.max_new_tickets||value.limits.per_member_intakes>value.limits.max_new_intakes
    ||value.limits.per_member_supplements>value.limits.max_supplements)reject('LIMIT_INVALID');
  let origin;try{origin=new URL(value.public_origin);}catch{reject();}
  if(origin.origin!==value.public_origin||origin.protocol!=='https:'||origin.username||origin.password
    ||!Number.isInteger(value.listen_port)||value.listen_port<1024||value.listen_port>65535)reject();
  return value;
}
export function databaseIdentity(databaseUrl){
  let url;try{url=new URL(databaseUrl);}catch{reject('DATABASE_INVALID');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash)reject('DATABASE_INVALID');
  return {name:decodeURIComponent(url.pathname.slice(1)),identity_sha256:digest([url.hostname,url.port||'5432',decodeURIComponent(url.pathname.slice(1)),decodeURIComponent(url.username)])};
}
export function readLimitedConfiguration(file,manifest){
  const env=parseEnv(readFileSync(file,'utf8'));
  if(Object.keys(env).some(key=>!['PILOT_DATABASE_URL','YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG','APP_SECRET','P2_G2_REPORTER_HMAC_SECRET','PILOT_LOG_IDENTITY_HASH_KEY'].includes(key)))reject('UNRELATED_CAPABILITY');
  const member=validateYxxEntryConfig(JSON.parse(readFileSync(env.YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG,'utf8')).reporterMemberEntry);
  if(!member.enabled||member.identityMode!=='VERIFIED_DELEGATED_MAPPING'||member.validationProfile!=='DEPLOYMENT'||member.proofKind!=='LIVE'
    ||member.proofRef!==manifest.identity_proof_ref||member.reporterUserIds.length!==2
    ||!nonempty(env.APP_SECRET)||Buffer.byteLength(env.P2_G2_REPORTER_HMAC_SECRET??'')<32||Buffer.byteLength(env.PILOT_LOG_IDENTITY_HASH_KEY??'')<16)reject();
  const database=databaseIdentity(env.PILOT_DATABASE_URL);
  if(database.name!==manifest.database.name||database.identity_sha256!==manifest.database.identity_sha256)reject('DATABASE_IDENTITY_MISMATCH');
  const config_sha256=limitedConfigurationDigest({env,member,manifest});
  if(config_sha256!==manifest.config_sha256)reject('CONFIG_DIGEST_MISMATCH');
  return {env,member};
}
export function limitedConfigurationDigest({env,member,manifest}){
  return digest({member,database:databaseIdentity(env.PILOT_DATABASE_URL),public_origin:manifest.public_origin,listen_port:manifest.listen_port,
    reporter_secret_sha256:digest(env.P2_G2_REPORTER_HMAC_SECRET),identity_key_sha256:digest(env.PILOT_LOG_IDENTITY_HASH_KEY),app_secret_sha256:digest(env.APP_SECRET)});
}
export function memberBindings(member,secret){return member.reporterUserIds.map(id=>createHmac('sha256',secret).update(JSON.stringify(['member',member.corpId,member.agentId,id])).digest('hex'));}
export function approvalScope(manifest){const {approval_record_ref,approval_record_sha256,...scope}=manifest;return digest(scope);}
export function verifyLimitedApproval(manifest,text){
  if(digest(text)!==manifest.approval_record_sha256)reject('APPROVAL_RECORD_MISMATCH');
  let record;try{record=JSON.parse(text);}catch{reject('APPROVAL_RECORD_MISMATCH');}
  exact(record,['kind','run_id','scope_sha256','candidate_commit','owner','approver']);
  if(record.kind!=='SS011_LIMITED_WRITE_APPROVED'||record.run_id!==manifest.run_id||record.scope_sha256!==approvalScope(manifest)
    ||record.candidate_commit!==manifest.candidate_commit||record.owner!==manifest.owner||record.approver!==manifest.approver)reject('APPROVAL_SCOPE_MISMATCH');
}
export function parseLimitedArguments(argv){
  const result={mode:'check',resume:false};const seen=new Set();
  for(const arg of argv){
    const mode=/^--(check|run|require-ready|help)$/u.exec(arg),option=/^--(manifest|env-file|state-dir)=(.+)$/u.exec(arg);
    const key=mode?'mode':arg==='--resume'?'resume':option?.[1];
    if(!key||seen.has(key))reject('ARGUMENT_INVALID');seen.add(key);
    if(mode)result.mode=mode[1];else if(key==='resume')result.resume=true;else result[key]=option[2];
  }
  if(result.resume&&result.mode!=='run')reject('ARGUMENT_INVALID');return result;
}
