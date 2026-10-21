import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import type {H5LifecycleReadProjection} from './yxx-h5-v2-lifecycle.mjs';
import type {H5ReadSection,H5SupplementItem,H5SupplementPage} from '../contracts/yxx_h5_entry_contracts.js';
import type {TicketStatus} from './p1-005-pilot-ticket-core.mjs';
import {H5_CURRENT_URGE_SQL} from './yxx-h5-v2-lifecycle.mjs';
import {hashP2016} from './p2-016-domain-contracts.mjs';
import {h5Fail,h5RequestRef} from './yxx-h5-v2-contracts.mjs';

export type H5EntryReadRow=H5LifecycleReadProjection['source'] & {
 request_ref:string;processed_revision:string;revoked_at:string|null;intake_no:string;status:string;
 pilot_ticket_id:string|null;created_at:string;updated_at:string;safe_description:string;safe_location:string|null;
 supplement_items:H5SupplementItem[];ticket_no:string|null;ticket_status:TicketStatus|null;ticket_updated_at:string|null;has_pending_review:boolean;
 completed_round:H5LifecycleReadProjection['round'];urge_read:H5LifecycleReadProjection['urge'];read_epoch:string;
 progress_read:H5LifecycleReadProjection['progress'];evaluation_read:H5LifecycleReadProjection['evaluation'];already_reopened:boolean;
}
interface SupplementCursor {purpose:'H5_SUPPLEMENTS';scope:string;request_ref:string;snapshot_revision:string;before_revision:string}
const BINDING_WHERE=`b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.proof_ref=$5
 AND i.source_provider='YIXIAOXIU_WEB' AND i.canonical_reporter_binding=b.canonical_reporter_binding AND i.source_app_scope=b.source_app_scope
 AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()`;
function bindingArgs(scope:YxxMemberScope,requestRef:string){return [h5RequestRef(requestRef),scope.scopeHash,scope.sourceCorpScope,scope.sourceAppScope,scope.proofRef];}
function revision(value:unknown){if(typeof value!=='string'||!(/^[1-9][0-9]{0,18}$/u).test(value)||BigInt(value)>9223372036854775807n)h5Fail('YXX_CURSOR_INVALID');return value;}
function cursor(value:unknown,scope:YxxMemberScope,requestRef:string,secret:string):SupplementCursor{
 if(typeof value!=='string'||value.length>2048)h5Fail('YXX_CURSOR_INVALID');const parts=value.split('.'),data=parts[0],signature=parts[1];
 if(parts.length!==2||!data||!signature)h5Fail('YXX_CURSOR_INVALID');
 const expected=Buffer.from(createHmac('sha256',secret).update(data).digest('base64url')),actual=Buffer.from(signature);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))h5Fail('YXX_CURSOR_INVALID');
 let parsed:unknown;try{parsed=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));}catch{h5Fail('YXX_CURSOR_INVALID');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))h5Fail('YXX_CURSOR_INVALID');const raw=parsed as Record<string,unknown>;
 if(Object.keys(raw).sort().join(',')!=='before_revision,purpose,request_ref,scope,snapshot_revision'||raw.purpose!=='H5_SUPPLEMENTS'||raw.scope!==hashP2016(scope)||raw.request_ref!==requestRef)h5Fail('YXX_CURSOR_INVALID');
 const snapshot=revision(raw.snapshot_revision),before=revision(raw.before_revision);if(BigInt(before)>BigInt(snapshot))h5Fail('YXX_CURSOR_INVALID');
 return {purpose:'H5_SUPPLEMENTS',scope:hashP2016(scope),request_ref:requestRef,snapshot_revision:snapshot,before_revision:before};
}
export function h5SupplementPage(rows:readonly H5SupplementItem[],scope:YxxMemberScope,requestRef:string,snapshotRevision:string,secret:string,limit=20):H5SupplementPage{
 const selected=rows.slice(0,limit),last=selected.at(-1);let next:string|null=null;
 if(rows.length>limit&&last){const value:SupplementCursor={purpose:'H5_SUPPLEMENTS',scope:hashP2016(scope),request_ref:requestRef,snapshot_revision:revision(snapshotRevision),before_revision:revision(last.input_revision)};
  const data=Buffer.from(JSON.stringify(value)).toString('base64url');next=data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
 return {items:selected.map(item=>({input_revision:String(item.input_revision),text:typeof item.text==='string'?item.text:null})).reverse(),next_cursor:next};
}

/** One safe set projection replaces repeated source, round, progress and evaluation lookups. */
export async function readH5EntryRow(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string):Promise<H5EntryReadRow>{
 const row=(await tx.query<H5EntryReadRow>(`SELECT b.request_ref,b.intake_id::text,b.input_revision::text,b.processed_revision::text,b.revoked_at,
  LEAST(b.retention_until_epoch_ms,i.retention_until_epoch_ms)::text AS retention_epoch,
  i.intake_no,i.status,i.pilot_ticket_id::text,i.pilot_ticket_id::text AS ticket_id,
  to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
  COALESCE(initial.safe_content->>'description','') AS safe_description,
  CASE WHEN (initial.safe_content->'location'->>'unknown')::boolean THEN NULL ELSE initial.safe_content->'location'->>'text' END AS safe_location,
  CASE WHEN initial.safe_content->>'intent'='CONTACT_REQUEST' THEN 'CONTACT_REQUEST' ELSE 'FAULT' END AS intent,
  COALESCE((SELECT jsonb_agg(row_to_json(supplement) ORDER BY supplement.input_revision::bigint DESC) FROM
   (SELECT s.input_revision::text,s.safe_content->>'text' AS text FROM intake.web_submission s
    WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT' AND s.input_revision<=b.input_revision
     AND s.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY s.input_revision DESC LIMIT 21) supplement),'[]'::jsonb) AS supplement_items,
  t.ticket_no,t.status AS ticket_status,t.version AS ticket_version,t.current_handling_cycle_id::text AS cycle_id,
  to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,p.display_name AS handler_name,rt.display_name AS team_name,
  EXISTS(SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING') AS has_pending_review,
  CASE WHEN completed.id IS NULL THEN NULL ELSE to_jsonb(completed) END AS completed_round,
  CASE WHEN t.id IS NULL THEN NULL ELSE to_jsonb(urge) END AS urge_read,
  CASE WHEN progress.ticket_version IS NULL THEN NULL ELSE to_jsonb(progress) END AS progress_read,
  CASE WHEN evaluation.rating IS NULL THEN NULL ELSE to_jsonb(evaluation) END AS evaluation_read,
  EXISTS(SELECT 1 FROM pilot_ticket.ticket_cycle_reopen r WHERE r.new_cycle_id=t.current_handling_cycle_id AND r.ticket_id=t.id AND t.status='REOPENED') AS already_reopened,
  platform.physical_epoch_ms()::text AS read_epoch
 FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
 LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
 LEFT JOIN pilot_ticket.pilot_principal p ON p.id=t.assignee_id AND p.is_active
 LEFT JOIN pilot_ticket.resolver_team rt ON rt.team_id=t.resolver_team_id AND rt.is_active
 LEFT JOIN LATERAL(SELECT s.safe_content FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUBMIT'
  AND s.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY s.input_revision LIMIT 1) initial ON TRUE
 LEFT JOIN LATERAL(SELECT c.id::text,c.ticket_id::text,c.source_intake_id::text,c.cycle_no,c.staff_completion_event_id::text,
  e.operator_id AS completed_by,t.resolver_team_id,t.ticket_no,t.version,t.status
  FROM pilot_ticket.ticket_handling_cycle c JOIN pilot_ticket.ticket_event e ON e.event_id=c.staff_completion_event_id AND e.ticket_id=t.id
  JOIN pilot_ticket.staff_completion_notification_commitment n ON n.cycle_id=c.id AND n.ticket_id=t.id AND n.ticket_event_id=e.event_id AND n.source_intake_id=t.source_intake_id
  WHERE c.id=t.current_handling_cycle_id AND c.ticket_id=t.id AND c.source_intake_id=t.source_intake_id AND t.status='CLOSED'
   AND e.event_type='ticket.closed' AND e.reason_code='STAFF_COMPLETED' AND e.operator_type='PILOT_USER'
   AND e.old_status='IN_PROGRESS' AND e.new_status='CLOSED'
   AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket_cycle_reopen r WHERE r.completed_cycle_id=c.id)) completed ON TRUE
 LEFT JOIN LATERAL(SELECT t.id::text AS ticket_id,count(u.id)::integer AS count,max(u.occurred_epoch_ms)::text AS last_epoch,
  t.status=ANY(ARRAY['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','REOPENED']) AS active
  FROM intake.web_report_urge u WHERE u.ticket_id=t.id AND ${H5_CURRENT_URGE_SQL} AND u.retention_until_epoch_ms>platform.physical_epoch_ms()
   AND EXISTS(SELECT 1 FROM intake.web_request_binding ub JOIN intake.service_intake ui ON ui.id=ub.intake_id
    WHERE ub.intake_id=u.source_intake_id AND ub.canonical_reporter_binding=u.scope_hash AND ub.revoked_at IS NULL
     AND ub.retention_until_epoch_ms>platform.physical_epoch_ms() AND ui.retention_until_epoch_ms>platform.physical_epoch_ms()
     AND ui.pilot_ticket_id=t.id AND ui.source_provider='YIXIAOXIU_WEB' AND ui.canonical_reporter_binding=ub.canonical_reporter_binding AND ui.source_app_scope=ub.source_app_scope)) urge ON TRUE
 LEFT JOIN LATERAL(SELECT pp.summary,to_char(pp.estimated_at,'YYYY-MM-DD HH24:MI:SS') AS estimated_at,pp.estimated_epoch_ms::text,pp.ticket_version,
  to_char(pp.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,pp.occurred_epoch_ms::text
  FROM pilot_ticket.ticket_public_progress pp WHERE pp.ticket_id=t.id ORDER BY pp.ticket_version DESC LIMIT 1) progress ON TRUE
 LEFT JOIN LATERAL(SELECT ev.rating,ev.comment,to_char(ev.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,ev.occurred_epoch_ms::text
  FROM intake.web_report_evaluation ev WHERE ev.ticket_id=t.id AND ev.completed_cycle_id=t.current_handling_cycle_id
   AND ev.retention_until_epoch_ms>platform.physical_epoch_ms() LIMIT 1) evaluation ON TRUE
 WHERE ${BINDING_WHERE}`,bindingArgs(scope,requestRef))).rows[0];
 return row??h5Fail('YXX_NOT_FOUND',404);
}

export async function recheckH5EntryBinding(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string){
 if((await tx.query(`SELECT 1 FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE ${BINDING_WHERE}`,bindingArgs(scope,requestRef))).rowCount!==1)h5Fail('YXX_NOT_FOUND',404);
}
/** Rolling back the read-only savepoint also restores the caller's timeout setting. */
export async function withH5TimelineBudget<T>(tx:PostgresTransaction,read:()=>Promise<T>):Promise<H5ReadSection<T>>{
 await tx.query('SAVEPOINT h5_entry_timeline');
 try{
  await tx.query("SET LOCAL statement_timeout='250ms'");
  return {status:'READY',data:await read()};
 }catch(error){
  if(error instanceof Error&&'code' in error&&error.code==='57014'&&/statement timeout/iu.test(error.message))return {status:'UNAVAILABLE',code:'YXX_UNAVAILABLE'};
  throw error;
 }finally{
  await tx.query('ROLLBACK TO SAVEPOINT h5_entry_timeline');
  await tx.query('RELEASE SAVEPOINT h5_entry_timeline');
 }
}
export async function readH5Supplements(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string,secret:string,rawCursor:string|null=null,limit=20):Promise<H5SupplementPage>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)h5Fail('YXX_LIMIT_INVALID');
 const boundary=rawCursor===null?null:cursor(rawCursor,scope,requestRef,secret);
 const row=(await tx.query<{input_revision:string;items:H5SupplementItem[]}>(`SELECT b.input_revision::text,
  COALESCE((SELECT jsonb_agg(row_to_json(supplement) ORDER BY supplement.input_revision::bigint DESC) FROM
   (SELECT s.input_revision::text,s.safe_content->>'text' AS text FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT'
    AND s.input_revision<=COALESCE($6::bigint,b.input_revision) AND ($7::bigint IS NULL OR s.input_revision<$7::bigint)
    AND s.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY s.input_revision DESC LIMIT $8) supplement),'[]'::jsonb) AS items
  FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE ${BINDING_WHERE}`,
  [...bindingArgs(scope,requestRef),boundary?.snapshot_revision??null,boundary?.before_revision??null,limit+1])).rows[0];
 if(!row)h5Fail('YXX_NOT_FOUND',404);
 await recheckH5EntryBinding(tx,scope,requestRef);
 return h5SupplementPage(row.items,scope,requestRef,boundary?.snapshot_revision??row.input_revision,secret,limit);
}
