import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import type {TicketAppNotificationOptions,TicketAppNotificationAuthority} from '../contracts/workbench_app_notification_contracts.js';
import {isDeepStrictEqual} from 'node:util';
import {exactP2016,failP2016} from './p2-016-domain-contracts.mjs';
import {assertEpochMsString,assertLocalDateTime,formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import {reporterSelection,retainedReporterTarget} from './workbench-reporter-verification.mjs';

interface WebSourceRow {scope_hash:string;source_corp_scope:string;source_app_scope:string;proof_ref:string|null;request_ref:string;journey_id:string;retention_epoch:string}
interface ManualSourceRow {proof:unknown;actor:string;reporter_hash:string;journey_id:string;retention_epoch:string}
export interface OriginalAppNotificationSource {source_kind:'WEB_REQUEST'|'VERIFIED_MANUAL_REPORT';scope:YxxMemberScope;binding_proof_ref:string;request_ref:string|null;journey_id:string;retention_epoch:string}
export interface EligibleOriginalAppTarget {source:OriginalAppNotificationSource;target:{provider:'WECOM_APP';channel_account_id:string;target_type:'PERSON';target_id:string}}
const text=(value:unknown,maximum:number)=>{if(typeof value!=='string'||!value||value.length>maximum)failP2016('FLAG_INVALID',503);return value;};
const HASH=/^[a-f0-9]{64}$/u;

export function normalizeAppNotificationOptions(input:TicketAppNotificationOptions|null):TicketAppNotificationOptions|null {
 if(input===null)return null;
 if(typeof input.enabled!=='boolean'||input.targetResolver?.localOnly!==true||typeof input.targetResolver.resolveCurrentTarget!=='function')failP2016('FLAG_INVALID',503);
 const a=exactP2016(input.authority,['sourceCorpScope','sourceAppScope','channelAccountId','mappingConfigHash','mappingProofRef','proofKind','validationProfile']);
 if(!HASH.test(text(a.mappingConfigHash,64))||!['LIVE','SYNTHETIC'].includes(text(a.proofKind,16))||!['DEPLOYMENT','ISOLATED_TEST'].includes(text(a.validationProfile,16))
   ||a.proofKind==='SYNTHETIC'&&a.validationProfile!=='ISOLATED_TEST')failP2016('FLAG_INVALID',503);
 const authority:TicketAppNotificationAuthority={sourceCorpScope:text(a.sourceCorpScope,128),sourceAppScope:text(a.sourceAppScope,128),channelAccountId:text(a.channelAccountId,128),
   mappingConfigHash:text(a.mappingConfigHash,64),mappingProofRef:text(a.mappingProofRef,256),proofKind:a.proofKind as TicketAppNotificationAuthority['proofKind'],validationProfile:a.validationProfile as TicketAppNotificationAuthority['validationProfile']};
 return Object.freeze({enabled:input.enabled,authority:Object.freeze(authority),targetResolver:input.targetResolver});
}

/** The retained original Web facts, not a recent page or a later channel. */
export async function readOriginalAppNotificationSource(tx:PostgresTransaction,intakeId:string):Promise<OriginalAppNotificationSource|null>{
 const q=await tx.query<WebSourceRow>(`SELECT b.canonical_reporter_binding AS scope_hash,b.source_corp_scope,b.source_app_scope,b.proof_ref,b.request_ref,j.id::text AS journey_id,
   LEAST(i.retention_until_epoch_ms,b.retention_until_epoch_ms,s.retention_until_epoch_ms,j.retention_until_epoch_ms)::text AS retention_epoch
   FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id AND b.canonical_reporter_binding=i.canonical_reporter_binding AND b.source_app_scope=i.source_app_scope
   JOIN intake.web_submission s ON s.id=i.primary_web_submission_id AND s.intake_id=i.id AND s.canonical_reporter_binding=b.canonical_reporter_binding AND s.kind='SUBMIT'
   JOIN intake.channel_leg l ON l.source_intake_id=i.id AND l.web_submission_id=s.id AND l.leg_type='WEB_FORM' AND l.reporter_identity_hash=b.canonical_reporter_binding
   JOIN intake.contact_journey j ON j.id=l.journey_id AND j.origin_intake_id=i.id AND j.entry_mode='APP_WEB_SELF_SERVICE' AND j.origin_channel='PORTAL'
     AND j.source_app_scope=b.source_app_scope AND j.reporter_identity_hash=b.canonical_reporter_binding
   WHERE i.id=$1::uuid AND i.source_channel='PORTAL' AND i.source_provider='YIXIAOXIU_WEB' AND b.revoked_at IS NULL
     AND LEAST(i.retention_until_epoch_ms,b.retention_until_epoch_ms,s.retention_until_epoch_ms,j.retention_until_epoch_ms)>platform.physical_epoch_ms()
   FOR SHARE OF i,b,s,l,j`,[intakeId]);
 const row=q.rows[0];
 if(q.rowCount===1&&row&&HASH.test(row.scope_hash)&&row.proof_ref){
  const scope:YxxMemberScope=Object.freeze({scopeHash:row.scope_hash as YxxMemberScope['scopeHash'],sourceCorpScope:row.source_corp_scope,sourceAppScope:row.source_app_scope,proofRef:row.proof_ref});
  return {source_kind:'WEB_REQUEST',scope,binding_proof_ref:row.proof_ref,request_ref:row.request_ref,journey_id:row.journey_id,retention_epoch:row.retention_epoch};
 }
 // A denied Web/Bot source is not a MANUAL source or a requirement to install its optional schema.
 const origin=await tx.query<{is_manual:boolean}>("SELECT source_channel='MANUAL' AND source_provider='STAFF_MANUAL_REPORT' AS is_manual FROM intake.service_intake WHERE id=$1::uuid",[intakeId]);
 if(origin.rowCount!==1||origin.rows[0]?.is_manual!==true)return null;
 const manual=await tx.query<ManualSourceRow>(`SELECT i.manual_reporter_verification AS proof,i.manual_actor_principal_id::text AS actor,
   j.reporter_identity_hash AS reporter_hash,j.id::text AS journey_id,LEAST(i.retention_until_epoch_ms,j.retention_until_epoch_ms)::text AS retention_epoch
   FROM intake.service_intake i JOIN intake.contact_journey j ON j.origin_intake_id=i.id AND j.entry_mode='STAFF_MANUAL_REPORT' AND j.origin_channel='MANUAL'
   JOIN intake.channel_leg l ON l.journey_id=j.id AND l.source_intake_id=i.id AND l.leg_type='MANUAL_REPORT' AND l.leg_ordinal=1 AND l.reporter_identity_hash=j.reporter_identity_hash
   WHERE i.id=$1::uuid AND i.source_channel='MANUAL' AND i.source_provider='STAFF_MANUAL_REPORT'
     AND i.manual_report_snapshot->>'identity_source'='VERIFIED_DIRECTORY_SELECTION' AND i.manual_reporter_verification IS NOT NULL
     AND LEAST(i.retention_until_epoch_ms,j.retention_until_epoch_ms)>platform.physical_epoch_ms() FOR SHARE OF i,j,l`,[intakeId]);
 const retained=manual.rows[0];if(manual.rowCount!==1||!retained)return null;
 try{
  const envelope=exactP2016(retained.proof,['schema_version','purpose','selection','application','directory_source_scope','actor_principal_id','object_access','authorized_at','authorized_at_epoch_ms','valid_until','valid_until_epoch_ms','proof']);
  const scope=retainedReporterTarget(retained.proof,retained.actor,reporterSelection(envelope.selection));
  const proof=exactP2016(envelope.proof,['source','scope','mapping_config_hash','verification_method','profile_source','directory_source_scope','directory_snapshot_version','profile_at_report','binding_proof_ref','account_status','binding_state','proof_kind','reachability','verified_at','verified_at_epoch_ms','actor_principal_id']);
  if(scope.scopeHash!==retained.reporter_hash||typeof proof.binding_proof_ref!=='string'||!proof.binding_proof_ref||proof.binding_proof_ref.length>256)return null;
  return {source_kind:'VERIFIED_MANUAL_REPORT',scope,binding_proof_ref:proof.binding_proof_ref,request_ref:null,journey_id:retained.journey_id,retention_epoch:retained.retention_epoch};
 }catch{return null;}
}

/** Current local qualification is bounded; no external call belongs in this transaction. */
export async function resolveOriginalAppTarget(tx:PostgresTransaction,intakeId:string,options:TicketAppNotificationOptions|null):Promise<EligibleOriginalAppTarget|null>{
 if(!options?.enabled)return null;
 const source=await readOriginalAppNotificationSource(tx,intakeId);if(!source)return null;
 const current=await readOriginalAppNotificationSource(tx,intakeId);if(!isDeepStrictEqual(current,source))return null;
 return qualifyOriginalAppTarget(source,options);
}

/** Qualify the retained source after DB waits; no further DB await can stale this local result. */
export async function qualifyOriginalAppTarget(source:OriginalAppNotificationSource,options:TicketAppNotificationOptions|null):Promise<EligibleOriginalAppTarget|null>{
 if(!options?.enabled)return null;
 const a=options.authority;
 if(source.scope.sourceCorpScope!==a.sourceCorpScope||source.scope.sourceAppScope!==a.sourceAppScope||source.scope.proofRef!==a.mappingProofRef)return null;
 const signal=AbortSignal.timeout(1000),started=BigInt(Date.now());
 let raw:unknown;
 try{raw=await Promise.race([options.targetResolver.resolveCurrentTarget({source_kind:source.source_kind,scope:source.scope,signal}),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);}
 catch{return null;}
 try{
  const value=exactP2016(raw,['schema_version','state','source_kind','scope','checked_at','checked_at_epoch_ms','target','verification','reason'],['schema_version','state','source_kind','scope','checked_at','checked_at_epoch_ms']);
  if(Buffer.byteLength(JSON.stringify(value))>8192||value.schema_version!==1||value.source_kind!==source.source_kind||!isDeepStrictEqual(value.scope,source.scope))return null;
  const epoch=assertEpochMsString(value.checked_at_epoch_ms),local=assertLocalDateTime(value.checked_at);
  if(formatEpochMsToShanghaiLocal(epoch)!==local||BigInt(epoch)<started||BigInt(epoch)>BigInt(Date.now())||BigInt(source.retention_epoch)<=BigInt(Date.now())||signal.aborted)return null;
  if(value.state==='NOT_ELIGIBLE'){
   if(Object.hasOwn(value,'target')||Object.hasOwn(value,'verification')||!['NO_MAPPING','SCOPE_MISMATCH','STALE','REVOKED','UNREACHABLE','UNKNOWN'].includes(String(value.reason)))return null;
   return null;
  }
  if(value.state!=='ELIGIBLE'||Object.hasOwn(value,'reason'))return null;
  const target=exactP2016(value.target,['provider','channel_account_id','target_type','target_id']);
  const verification=exactP2016(value.verification,['mapping_config_hash','mapping_proof_ref','binding_proof_ref','proof_kind','account_status','binding_state','message_reachability']);
  if(target.provider!=='WECOM_APP'||target.channel_account_id!==a.channelAccountId||target.target_type!=='PERSON'||typeof target.target_id!=='string'||!target.target_id||target.target_id.length>256
    ||verification.mapping_config_hash!==a.mappingConfigHash||verification.mapping_proof_ref!==a.mappingProofRef||verification.binding_proof_ref!==source.binding_proof_ref||verification.proof_kind!==a.proofKind
    ||verification.account_status!=='ACTIVE'||verification.binding_state!=='VERIFIED'||verification.message_reachability!=='REACHABLE')return null;
  return {source,target:{provider:'WECOM_APP',channel_account_id:a.channelAccountId,target_type:'PERSON',target_id:target.target_id}};
 }catch{return null;}
}
