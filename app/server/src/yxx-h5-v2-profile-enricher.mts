import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {ReporterDirectoryPort} from '../../../contracts/p2_015_contracts.js';
import type {LocalOnly} from './yxx-self-service-authorization.mjs';
import {hashReporterProfile,snapshotReporterProfile} from './p2-015-reporter-profile.mjs';
import {applicationRecipientProof} from './yxx-application-member-auth.mjs';
import {transactionP2016} from './p2-016-domain-contracts.mjs';
import {h5Fail} from './yxx-h5-v2-contracts.mjs';

export interface H5ProfileMemberIdentity {memberId:string;namespace:'APP_OPEN_USERID';corpId:string;appId:string}
interface Pending {intake_id:string;journey_id:string;request_ref:string;canonical_reporter_binding:string;source_corp_scope:string;source_app_scope:string;proof_ref:string;notify_recipient_id:string;notify_proof_ref:string}
export interface H5ProfileEnricherOptions {pool:PostgresPool;scopeSecret:string;directoryPort:ReporterDirectoryPort;enabled?:boolean;verifyCurrentMember?:LocalOnly<H5ProfileMemberIdentity,boolean>|null}

/** Worker-only finite job. All Provider calls occur after releasing the claim transaction. */
export function createYxxH5ProfileEnricher({pool,scopeSecret,directoryPort,enabled=false,verifyCurrentMember=null}:H5ProfileEnricherOptions){
  if(typeof enabled!=='boolean'||typeof directoryPort?.resolve!=='function'||Buffer.byteLength(scopeSecret)<32||verifyCurrentMember!==null&&verifyCurrentMember.localOnly!==true)h5Fail('YXX_UNAVAILABLE',503);
  let running=false;
  async function runOnce({limit=1}:{limit?:number}={}){
    if(!enabled||!verifyCurrentMember||running)return {claimed:0,resolved:0,deferred:0};
    if(!Number.isSafeInteger(limit)||limit<1||limit>5)h5Fail();running=true;
    let claimed=0,resolved=0,deferred=0;
    try{
      for(let index=0;index<limit;index++){
        const row=await transactionP2016(pool,async tx=>{
          const r=(await tx.query<Pending>(`SELECT b.intake_id::text,j.id::text AS journey_id,b.request_ref,b.canonical_reporter_binding,b.source_corp_scope,b.source_app_scope,b.proof_ref,b.notify_recipient_id,b.notify_proof_ref
            FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id AND i.canonical_reporter_binding=b.canonical_reporter_binding AND i.source_app_scope=b.source_app_scope
            JOIN intake.contact_journey j ON j.origin_intake_id=i.id AND j.reporter_identity_hash=b.canonical_reporter_binding AND j.source_app_scope=b.source_app_scope AND j.entry_mode='APP_WEB_SELF_SERVICE'
            WHERE i.source_provider='YIXIAOXIU_WEB' AND b.revoked_at IS NULL AND b.notify_identity_namespace='APP_OPEN_USERID'
             AND b.notify_recipient_id IS NOT NULL AND b.notify_proof_ref IS NOT NULL
             AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms() AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
             AND j.profile_resolution_status IN ('NOT_REQUIRED','DEFERRED','NOT_FOUND')
             AND (j.profile_snapshot='{}'::jsonb OR j.profile_snapshot->>'source'='YIXIAOXIU_WEB')
             AND (b.h5_profile_next_attempt_epoch_ms IS NULL OR b.h5_profile_next_attempt_epoch_ms<=platform.physical_epoch_ms())
            ORDER BY b.created_at,b.intake_id LIMIT 1 FOR UPDATE OF b SKIP LOCKED`)).rows[0];
          if(r)await tx.query(`UPDATE intake.web_request_binding SET h5_profile_attempts=LEAST(h5_profile_attempts+1,1000),h5_profile_next_attempt_epoch_ms=platform.physical_epoch_ms()+LEAST(3600000,300000*(1+h5_profile_attempts)) WHERE intake_id=$1::uuid`,[r.intake_id]);
          return r??null;
        });
        if(!row)break;claimed++;
        const identity:H5ProfileMemberIdentity={memberId:row.notify_recipient_id,namespace:'APP_OPEN_USERID',corpId:row.source_corp_scope,appId:row.source_app_scope};
        // The signed report-time recipient cannot be supplied or redirected by a browser/Provider.
        if(applicationRecipientProof(scopeSecret,{scopeHash:row.canonical_reporter_binding,sourceCorpScope:row.source_corp_scope,sourceAppScope:row.source_app_scope},row.notify_recipient_id)!==row.notify_proof_ref){deferred++;continue;}
        try{
          if(await verifyCurrentMember(identity)!==true){deferred++;continue;}
          const result=await directoryPort.resolve({source:'THIRD_PARTY_STAFF_DIRECTORY',source_provider:'YIXIAOXIU_WEB',source_namespace:'APP_OPEN_USERID',
            reporter_identity_hash:row.canonical_reporter_binding,reporter_external_id:row.notify_recipient_id});
          if(result.status!=='RESOLVED'){deferred++;continue;}
          const profile=snapshotReporterProfile(result.snapshot);
          if(profile.source!=='THIRD_PARTY_STAFF_DIRECTORY'){deferred++;continue;}
          if(await verifyCurrentMember(identity)!==true){deferred++;continue;}
          const hash=hashReporterProfile(profile);
          const committed=await transactionP2016(pool,async tx=>{
            // Current binding and source are checked after Provider waits, before any snapshot write.
            const current=(await tx.query(`SELECT 1 FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
              WHERE b.intake_id=$1::uuid AND b.request_ref=$2 AND b.canonical_reporter_binding=$3 AND b.source_corp_scope=$4 AND b.source_app_scope=$5 AND b.proof_ref=$6
               AND b.notify_identity_namespace='APP_OPEN_USERID' AND b.notify_recipient_id=$7 AND b.notify_proof_ref=$8
               AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
               AND i.source_provider='YIXIAOXIU_WEB' AND i.canonical_reporter_binding=b.canonical_reporter_binding AND i.source_app_scope=b.source_app_scope
              FOR SHARE OF b,i`,[row.intake_id,row.request_ref,row.canonical_reporter_binding,row.source_corp_scope,row.source_app_scope,row.proof_ref,row.notify_recipient_id,row.notify_proof_ref])).rowCount===1;
            if(!current)return false;
            const updated=await tx.query(`UPDATE intake.contact_journey SET profile_resolution_status='RESOLVED',profile_snapshot=$2::jsonb,profile_snapshot_hash=$3,
              row_version=row_version+1,updated_at=GREATEST(updated_at,platform.local_now()) WHERE id=$1::uuid AND origin_intake_id=$4::uuid AND reporter_identity_hash=$5
               AND source_app_scope=$6 AND entry_mode='APP_WEB_SELF_SERVICE' AND retention_until_epoch_ms>platform.physical_epoch_ms()
               AND profile_resolution_status IN ('NOT_REQUIRED','DEFERRED','NOT_FOUND') AND (profile_snapshot='{}'::jsonb OR profile_snapshot->>'source'='YIXIAOXIU_WEB')`,
              [row.journey_id,JSON.stringify(profile),hash,row.intake_id,row.canonical_reporter_binding,row.source_app_scope]);
            return updated.rowCount===1;
          });
          if(committed)resolved++;else deferred++;
        }catch{deferred++;}
      }
      return {claimed,resolved,deferred};
    }finally{running=false;}
  }
  return Object.freeze({runOnce});
}
export type YxxH5ProfileEnricher=ReturnType<typeof createYxxH5ProfileEnricher>;
