import type {ManualReporterVerificationAuthority,ManualReporterVerificationEnvelope,ManualReporterVerificationInput,ManualReporterVerifiedProof,VerifiedManualReportCommand} from '../contracts/workbench_reporter_candidates_contracts.js';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import {exactP2016,failP2016,hashP2016,publicP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {assertEpochMsString,assertLocalDateTime,formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';

function unavailable():never {failP2016('ACTION_FAILED',503);}
function label(value:unknown,maximum=100):string {
  if(typeof value!=='string'||!value.trim()||[...value].length>maximum||/[\u0000-\u001f\u007f]/u.test(value))unavailable();return value;
}
function hash(value:unknown):string {if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))unavailable();return value;}
function reference(value:unknown):string {if(typeof value!=='string'||value.length>256||!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(value))unavailable();return value;}
function scope(value:unknown):YxxMemberScope {
  const v=exactP2016(value,['scopeHash','sourceCorpScope','sourceAppScope','proofRef']);
  return {scopeHash:hash(v.scopeHash) as YxxMemberScope['scopeHash'],sourceCorpScope:label(v.sourceCorpScope,128),sourceAppScope:label(v.sourceAppScope,128),proofRef:reference(v.proofRef)};
}
function clock(local:unknown,epoch:unknown):string {
  const milliseconds=assertEpochMsString(epoch);if(milliseconds.length>19||assertLocalDateTime(local)!==formatEpochMsToShanghaiLocal(milliseconds))unavailable();return milliseconds;
}
export function reporterSelection(input:unknown):VerifiedManualReportCommand['reporter'] {
  const v=exactP2016(input,['verification','candidate_ref','candidate_version']);
  if(v.verification!=='VERIFIED_SELECTION'||typeof v.candidate_ref!=='string'||!/^[A-Za-z0-9_-]{32,256}$/u.test(v.candidate_ref)
    ||typeof v.candidate_version!=='string'||!/^[a-f0-9]{64}$/u.test(v.candidate_version))failP2016();
  return publicP2016({verification:'VERIFIED_SELECTION',candidate_ref:v.candidate_ref,candidate_version:v.candidate_version});
}
export function verifiedManualReportCommand(input:unknown):VerifiedManualReportCommand {
  const v=exactP2016(input,['schema_version','client_command_id','source','description','location','reporter']);
  const l=exactP2016(v.location,['text','unknown']);
  if(v.schema_version!==1||(v.source!=='PHONE'&&v.source!=='ON_SITE')||typeof v.description!=='string'
    ||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v.description)||!v.description.trim()||[...v.description.trim()].length>4000
    ||typeof l.unknown!=='boolean'||l.unknown&&l.text!==null||!l.unknown&&(typeof l.text!=='string'||!l.text.trim()||[...l.text.trim()].length>200||/[\u0000-\u001f\u007f]/u.test(l.text)))failP2016();
  return publicP2016({schema_version:1,client_command_id:uuidP2016(v.client_command_id),source:v.source,description:v.description.trim(),
    location:{unknown:l.unknown,text:l.unknown?null:(l.text as string).trim()},reporter:reporterSelection(v.reporter)});
}
export function reporterVerificationAuthority(input:ManualReporterVerificationAuthority|null|undefined):ManualReporterVerificationAuthority {
  if(!input||(input.proofKind!=='LIVE'&&input.proofKind!=='SYNTHETIC')||(input.validationProfile!=='DEPLOYMENT'&&input.validationProfile!=='ISOLATED_TEST')
    ||input.proofKind==='SYNTHETIC'&&input.validationProfile!=='ISOLATED_TEST')unavailable();
  return Object.freeze({mappingConfigHash:hash(input.mappingConfigHash),mappingProofRef:reference(input.mappingProofRef),proofKind:input.proofKind,validationProfile:input.validationProfile});
}
/** Existing mapped-identity and Directory authorities are represented by this
 * configured Port. Closed fields/hashes alone never make an untrusted producer valid. */
export function parseReporterVerification(input:unknown,request:ManualReporterVerificationInput,authority:ManualReporterVerificationAuthority):ManualReporterVerificationEnvelope {
  try {
    const v=exactP2016(input,['schema_version','purpose','selection','application','directory_source_scope','actor_principal_id','object_access',
      'authorized_at','authorized_at_epoch_ms','valid_until','valid_until_epoch_ms',request.purpose==='ADMISSION'?'proof':'target_scope']);
    if(Buffer.byteLength(JSON.stringify(v),'utf8')>16*1024||v.schema_version!==1||v.purpose!==request.purpose||v.object_access!=='ALLOWED')unavailable();
    const selected=reporterSelection(v.selection),application=exactP2016(v.application,['sourceCorpScope','sourceAppScope']);
    if(selected.candidate_ref!==request.selection.candidate_ref||selected.candidate_version!==request.selection.candidate_version
      ||uuidP2016(v.actor_principal_id)!==request.principal_id||v.directory_source_scope!==request.directory_source_scope
      ||application.sourceCorpScope!==request.application.sourceCorpScope||application.sourceAppScope!==request.application.sourceAppScope)unavailable();
    const issued=clock(v.authorized_at,v.authorized_at_epoch_ms),expires=clock(v.valid_until,v.valid_until_epoch_ms),now=BigInt(Date.now());
    if(BigInt(issued)>now||now-BigInt(issued)>300_000n||BigInt(expires)<=now||BigInt(expires)<=BigInt(issued)||BigInt(expires)-BigInt(issued)>300_000n)unavailable();
    const base={schema_version:1 as const,selection:selected,application:{...request.application},directory_source_scope:request.directory_source_scope,
      actor_principal_id:request.principal_id,object_access:'ALLOWED' as const,authorized_at:formatEpochMsToShanghaiLocal(issued),authorized_at_epoch_ms:issued,
      valid_until:formatEpochMsToShanghaiLocal(expires),valid_until_epoch_ms:expires};
    if(request.purpose==='READ_COMMITTED') {
      const target=scope(v.target_scope);if(hashP2016(target)!==hashP2016(request.committed_target_scope)
        ||target.sourceCorpScope!==request.application.sourceCorpScope||target.sourceAppScope!==request.application.sourceAppScope)unavailable();
      return publicP2016({...base,purpose:'READ_COMMITTED',target_scope:target});
    }
    const p=exactP2016(v.proof,['source','scope','mapping_config_hash','verification_method','profile_source','directory_source_scope','directory_snapshot_version',
      'profile_at_report','binding_proof_ref','account_status','binding_state','proof_kind','reachability','verified_at','verified_at_epoch_ms','actor_principal_id']);
    const target=scope(p.scope),profile=exactP2016(p.profile_at_report,['display_name','departments']),reach=exactP2016(p.reachability,['status','target_scope_hash','checked_at','checked_at_epoch_ms','proof_ref']);
    if(p.source!=='VERIFIED_DIRECTORY_SELECTION'||p.verification_method!=='VERIFIED_DELEGATED_MAPPING'
      ||(p.profile_source!=='WECOM_DIRECTORY'&&p.profile_source!=='THIRD_PARTY_STAFF_DIRECTORY')
      ||p.mapping_config_hash!==authority.mappingConfigHash||target.proofRef!==authority.mappingProofRef||p.proof_kind!==authority.proofKind
      ||target.sourceCorpScope!==request.application.sourceCorpScope||target.sourceAppScope!==request.application.sourceAppScope
      ||p.directory_source_scope!==request.directory_source_scope||uuidP2016(p.actor_principal_id)!==request.principal_id
      ||!Array.isArray(profile.departments)||profile.departments.length>20||new Set(profile.departments).size!==profile.departments.length
      ||(reach.status!=='REACHABLE'&&reach.status!=='UNREACHABLE'&&reach.status!=='UNKNOWN')||reach.target_scope_hash!==target.scopeHash)unavailable();
    if(p.account_status!=='ACTIVE'||p.binding_state!=='VERIFIED')failP2016('VERSION_CONFLICT',409);
    const verified=clock(p.verified_at,p.verified_at_epoch_ms),checked=clock(reach.checked_at,reach.checked_at_epoch_ms);
    if(verified!==issued||BigInt(checked)>BigInt(verified)||BigInt(verified)-BigInt(checked)>300_000n)unavailable();
    const reachRef=reach.proof_ref===null?null:reference(reach.proof_ref);if(reach.status==='REACHABLE'&&reachRef===null)unavailable();
    const proof:ManualReporterVerifiedProof={source:'VERIFIED_DIRECTORY_SELECTION',scope:target,mapping_config_hash:authority.mappingConfigHash,
      verification_method:'VERIFIED_DELEGATED_MAPPING',profile_source:p.profile_source,directory_source_scope:request.directory_source_scope,
      directory_snapshot_version:label(p.directory_snapshot_version,256),profile_at_report:{display_name:label(profile.display_name),departments:profile.departments.map((value:unknown)=>label(value))},
      binding_proof_ref:reference(p.binding_proof_ref),account_status:'ACTIVE',binding_state:'VERIFIED',proof_kind:authority.proofKind,
      reachability:{status:reach.status,target_scope_hash:target.scopeHash,checked_at:formatEpochMsToShanghaiLocal(checked),checked_at_epoch_ms:checked,proof_ref:reachRef},
      verified_at:formatEpochMsToShanghaiLocal(verified),verified_at_epoch_ms:verified,actor_principal_id:request.principal_id};
    const {reachability,...observation}=proof;
    // Match the frozen stable observation basis, excluding clocks/temporary proof refs/actor/source.
    const version=hashP2016({candidate_ref:selected.candidate_ref,scope:observation.scope,mapping_config_hash:observation.mapping_config_hash,
      verification_method:observation.verification_method,profile_source:observation.profile_source,directory_source_scope:observation.directory_source_scope,
      directory_snapshot_version:observation.directory_snapshot_version,profile_at_report:observation.profile_at_report,binding_proof_ref:observation.binding_proof_ref,
      account_status:observation.account_status,binding_state:observation.binding_state,proof_kind:observation.proof_kind,
      reachability:{status:reachability.status,target_scope_hash:reachability.target_scope_hash}});
    if(version!==selected.candidate_version)failP2016('VERSION_CONFLICT',409);
    return publicP2016({...base,purpose:'ADMISSION',proof});
  }catch(error){if(error instanceof Error&&'code' in error&&error.code==='P2_016_VERSION_CONFLICT')throw error;unavailable();}
}
/** Historical retained observation: check its original actor/selection/target,
 * never treat its expired admission clock as a new authorization. */
export function retainedReporterTarget(input:unknown,principalId:string,selection:VerifiedManualReportCommand['reporter']):YxxMemberScope {
  try {
    const v=exactP2016(input,['schema_version','purpose','selection','application','directory_source_scope','actor_principal_id','object_access','authorized_at','authorized_at_epoch_ms','valid_until','valid_until_epoch_ms','proof']);
    const original=reporterSelection(v.selection),p=exactP2016(v.proof,['source','scope','mapping_config_hash','verification_method','profile_source','directory_source_scope','directory_snapshot_version','profile_at_report','binding_proof_ref','account_status','binding_state','proof_kind','reachability','verified_at','verified_at_epoch_ms','actor_principal_id']);
    const application=exactP2016(v.application,['sourceCorpScope','sourceAppScope']),target=scope(p.scope);
    if(v.schema_version!==1||v.purpose!=='ADMISSION'||v.object_access!=='ALLOWED'||uuidP2016(v.actor_principal_id)!==principalId
      ||uuidP2016(p.actor_principal_id)!==principalId||original.candidate_ref!==selection.candidate_ref||original.candidate_version!==selection.candidate_version
      ||p.source!=='VERIFIED_DIRECTORY_SELECTION'||p.account_status!=='ACTIVE'||p.binding_state!=='VERIFIED'
      ||application.sourceCorpScope!==target.sourceCorpScope||application.sourceAppScope!==target.sourceAppScope)unavailable();
    return publicP2016(target);
  }catch{unavailable();}
}
