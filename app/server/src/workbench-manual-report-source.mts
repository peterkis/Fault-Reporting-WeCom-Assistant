import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {ManualReportFields,ManualReportProjection} from '../../../contracts/workbench_manual_report_contracts.js';
import type {VerifiedManualReportProjection} from '../../../contracts/workbench_reporter_candidates_contracts.js';
import {exactP2016,failP2016,publicP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {safeHash} from './p2-015-domain-contracts.mjs';
function text(value:unknown,max:number,multiline=false):string{
  if(typeof value!=='string'||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(value))failP2016();
  const result=value.trim();if(!result||[...result].length>max)failP2016();return result;
}
export function manualReportFields(input:unknown):ManualReportFields{
  const v=exactP2016(input,['source','description','location','reporter']);
  if(v.source!=='PHONE'&&v.source!=='ON_SITE')failP2016();
  const location=exactP2016(v.location,['text','unknown']),reporter=exactP2016(v.reporter,['verification','name','contact','department']);
  if(typeof location.unknown!=='boolean'||location.unknown&&location.text!==null||reporter.verification!=='UNVERIFIED')failP2016();
  return publicP2016({source:v.source,description:text(v.description,4000,true),location:{unknown:location.unknown,text:location.unknown?null:text(location.text,200)},
    reporter:{verification:'UNVERIFIED',name:text(reporter.name,100),contact:text(reporter.contact,100),department:reporter.department===null?null:text(reporter.department,100)}});
}
function verifiedSnapshotLabel(value:unknown):string{
  if(typeof value!=='string'||!value.trim()||[...value].length>100||/[\u0000-\u001f\u007f]/u.test(value))failP2016('ACTION_FAILED',503);
  return value;
}
function verifiedManualReportSnapshot(input:unknown,actor:string):VerifiedManualReportProjection{
  const snapshot=exactP2016(input,['source','description','location','reporter','identity_source','manual_contact_required','notification_eligibility','external_notification']);
  if(snapshot.identity_source!=='VERIFIED_DIRECTORY_SELECTION'||snapshot.external_notification!==false
    ||snapshot.source!=='PHONE'&&snapshot.source!=='ON_SITE'
    ||snapshot.notification_eligibility!=='ELIGIBLE'&&snapshot.notification_eligibility!=='NOT_REACHABLE'
    ||typeof snapshot.manual_contact_required!=='boolean'||snapshot.manual_contact_required!==(snapshot.notification_eligibility==='NOT_REACHABLE'))failP2016('ACTION_FAILED',503);
  const location=exactP2016(snapshot.location,['text','unknown']),reporter=exactP2016(snapshot.reporter,['verification','name','departments']);
  if(typeof location.unknown!=='boolean'||location.unknown&&location.text!==null||reporter.verification!=='VERIFIED'
    ||!Array.isArray(reporter.departments)||reporter.departments.length>20)failP2016('ACTION_FAILED',503);
  const departments=reporter.departments.map((value:unknown)=>verifiedSnapshotLabel(value));
  if(new Set(departments).size!==departments.length)failP2016('ACTION_FAILED',503);
  return {source_kind:'MANUAL_REPORT',source:snapshot.source,description:text(snapshot.description,4000,true),
    location:{unknown:location.unknown,text:location.unknown?null:text(location.text,200)},
    reporter:{verification:'VERIFIED',name:verifiedSnapshotLabel(reporter.name),departments},identity_source:'VERIFIED_DIRECTORY_SELECTION',
    actor_principal_id:uuidP2016(actor),manual_contact_required:snapshot.manual_contact_required,external_notification:false,notification_eligibility:snapshot.notification_eligibility};
}
// Only callers that have already authorized this Intake/Journey and enabled the
// MANUAL source may invoke this retained source projection.
export async function readManualReportSource(transaction:PostgresTransaction,intakeId:string):Promise<{report:ManualReportProjection|VerifiedManualReportProjection;source_hash:string}|null>{
  const row=(await transaction.query<{snapshot:unknown;actor:string}>(`SELECT manual_report_snapshot AS snapshot,manual_actor_principal_id::text AS actor
    FROM intake.service_intake WHERE id=$1::uuid AND source_channel='MANUAL' AND source_provider='STAFF_MANUAL_REPORT'
      AND retention_until>platform.local_now()`,[intakeId])).rows[0];if(!row)return null;
  if(row.snapshot!==null&&typeof row.snapshot==='object'&&!Array.isArray(row.snapshot)
    &&'identity_source' in row.snapshot&&row.snapshot.identity_source==='VERIFIED_DIRECTORY_SELECTION'){
    const report=verifiedManualReportSnapshot(row.snapshot,row.actor);
    return publicP2016({report,source_hash:safeHash(row.snapshot)});
  }
  const snapshot=exactP2016(row.snapshot,['source','description','location','reporter','identity_source','manual_contact_required','external_notification']);
  if(snapshot.identity_source!=='HAND_ENTERED'||snapshot.manual_contact_required!==true||snapshot.external_notification!==false)failP2016('ACTION_FAILED',503);
  const fields=manualReportFields({source:snapshot.source,description:snapshot.description,location:snapshot.location,reporter:snapshot.reporter});
  return publicP2016({report:{...fields,source_kind:'MANUAL_REPORT',identity_source:'HAND_ENTERED',actor_principal_id:uuidP2016(row.actor),
    manual_contact_required:true,external_notification:false},source_hash:safeHash(snapshot)});
}
