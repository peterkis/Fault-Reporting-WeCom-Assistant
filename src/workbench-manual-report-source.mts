import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {ManualReportFields,ManualReportProjection} from '../contracts/workbench_manual_report_contracts.js';
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
// Only callers that have already authorized this Intake/Journey and enabled the
// MANUAL source may invoke this retained source projection.
export async function readManualReportSource(transaction:PostgresTransaction,intakeId:string):Promise<{report:ManualReportProjection;source_hash:string}|null>{
  const row=(await transaction.query<{snapshot:unknown;actor:string}>(`SELECT manual_report_snapshot AS snapshot,manual_actor_principal_id::text AS actor
    FROM intake.service_intake WHERE id=$1::uuid AND source_channel='MANUAL' AND source_provider='STAFF_MANUAL_REPORT'
      AND retention_until>platform.local_now()`,[intakeId])).rows[0];if(!row)return null;
  const snapshot=exactP2016(row.snapshot,['source','description','location','reporter','identity_source','manual_contact_required','external_notification']);
  if(snapshot.identity_source!=='HAND_ENTERED'||snapshot.manual_contact_required!==true||snapshot.external_notification!==false)failP2016('ACTION_FAILED',503);
  const fields=manualReportFields({source:snapshot.source,description:snapshot.description,location:snapshot.location,reporter:snapshot.reporter});
  return publicP2016({report:{...fields,source_kind:'MANUAL_REPORT',identity_source:'HAND_ENTERED',actor_principal_id:uuidP2016(row.actor),
    manual_contact_required:true,external_notification:false},source_hash:safeHash(snapshot)});
}
