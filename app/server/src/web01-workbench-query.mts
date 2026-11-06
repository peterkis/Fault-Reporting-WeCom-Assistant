import type {WorkbenchSessionPredicate,createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {ServiceCatalog} from './p2-007-service-catalog.mjs';
import {projectWorkbenchCatalog,projectWorkbenchClosure,readWorkbenchCardProjections,verifyWorkbenchReadAccess,workbenchCanRestore} from './workbench-card-projections.mjs';
import type {ClosureEvidence,WorkbenchReadAccess} from './workbench-card-projections.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {FollowProjectionPort} from './workbench-follow.mjs';
import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { BoardColumn, BoardCompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail, WorkbenchRecord } from '../../../contracts/web01_workbench_contracts.js';
import {assertLocalDate} from './platform/time-contract.mjs';
import { ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
import { failP2016, uuidP2016, localP2016, limitP2016, cursorP2016, decodeCursorP2016, publicP2016 } from './p2-016-domain-contracts.mjs';
import {sourceLabel} from './workbench-source-groups.mjs';
import type {createWorkbenchSourceGroups} from './workbench-source-groups.mjs';
import type {createWorkbenchFollowUpSchedules} from './workbench-follow-up-schedules.mjs';
import type {ReviewReference} from '../../../contracts/workbench_review_contracts.js';
import type {createP2016ManualReviewFacade} from './p2-016-manual-review-facade.mjs';
import {readManualReportSource,readManualReportSources} from './workbench-manual-report-source.mjs';
import type {WorkbenchWebReportLifecyclePort} from './workbench-web-report.mjs';
import {decodeWebUrge} from '../../../shared/workbench-web-report-browser-contracts.mjs';
import {readTicketReporterProfiles} from './ticket-reporter-profiles.mjs';

export const WEB01_COLUMNS: readonly BoardColumn[] = ['pending', 'active', 'closed'];
const STATUS_COLUMNS = {
  pending: ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'],
  active: ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'],
  closed: ['RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED','COMPLETED','IGNORED'],
} as const;
export function boardColumn(status: string): BoardColumn {
  for(const column of WEB01_COLUMNS)if(STATUS_COLUMNS[column].some(value=>value===status))return column;
  failP2016();
}
interface CardRow extends Omit<WorkbenchCard, 'column'|'source_label'|'source_group'|'follow_up_schedule'|'closure'> { sort_at: string; closure_evidence:ClosureEvidence|null }
interface Input { authContext: unknown; column: string | null; range: string | null; scope?: string | null; closedFrom?:string|null; closedTo?:string|null; cursor: unknown; limit: unknown }
const UUID_TEXT_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const REPORTER_PROFILE_SQL=`LEFT JOIN LATERAL (SELECT j.profile_snapshot->'contact'->>'name' AS name,
   (SELECT string_agg(m->>'name','、' ORDER BY ord) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.profile_snapshot->'memberships')='array' THEN j.profile_snapshot->'memberships' ELSE '[]'::jsonb END) WITH ORDINALITY AS members(m,ord)) AS department
 FROM (SELECT origin.id FROM intake.contact_journey origin WHERE origin.origin_intake_id=i.id
       UNION SELECT leg.journey_id FROM intake.channel_leg leg WHERE leg.source_intake_id=i.id) candidate
 JOIN intake.contact_journey j ON j.id=candidate.id
 WHERE i.id IS NOT NULL AND j.profile_resolution_status='RESOLVED'
   AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
 ORDER BY (j.origin_intake_id=i.id) DESC,j.reported_at,j.id LIMIT 1) profile ON TRUE`;
// Manual BOT decisions retain their original observed_at. The resolved review is
// the actual human closing instant; updated_at is never a closing-time fallback.
const INTAKE_CLOSURE_SQL=`LEFT JOIN LATERAL (SELECT e.event_type,e.occurred_at,e.payload,e.aggregate_version,e.event_ordinal
  FROM intake.service_intake_event e WHERE e.intake_id=i.id
    AND i.status IN ('COMPLETED','IGNORED')
    AND (e.event_type='intake.rule_decision_applied' AND e.payload->>'new_status'=i.status
      AND e.payload->>'old_status' IS DISTINCT FROM e.payload->>'new_status'
      OR e.event_type='intake.received' AND e.payload->>'status'=i.status)
  ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) closing ON TRUE
 LEFT JOIN intake.deterministic_decision closing_decision ON closing_decision.id=CASE
   WHEN closing.payload->>'decision_id' ~ '${UUID_TEXT_PATTERN}' THEN (closing.payload->>'decision_id')::uuid END
   AND closing_decision.service_intake_id=i.id
   AND EXISTS(SELECT 1 FROM intake.contact_journey retained WHERE retained.id=closing_decision.journey_id
     AND retained.retention_until_epoch_ms>platform.physical_epoch_ms())
 LEFT JOIN intake.manual_review_item closing_review ON closing_review.resolution_decision_id=closing_decision.id
   AND closing_review.service_intake_id=i.id AND closing_review.journey_id=closing_decision.journey_id
   AND closing_review.status='RESOLVED' AND closing_decision.status='HUMAN_OVERRIDDEN'
   AND closing_review.resolved_by_principal_id::text=closing_decision.safe_result#>>'{human_override,principal_id}'
 LEFT JOIN pilot_ticket.pilot_principal closing_actor ON closing_actor.id=closing_review.resolved_by_principal_id`;
const INTAKE_CLOSURE_EVIDENCE_SQL=`CASE WHEN i.status IN ('COMPLETED','IGNORED') THEN jsonb_build_object(
  'source',CASE WHEN closing_review.id IS NOT NULL THEN 'MANUAL'
    WHEN closing_decision.status='RECORDED' AND closing_decision.safe_result->'human_override' IS NULL THEN 'SYSTEM'
    WHEN closing.event_type='intake.received' AND closing.aggregate_version=1 AND closing.event_ordinal=1 AND i.status='IGNORED' THEN 'SYSTEM' END,
  'reason_code',CASE WHEN closing_review.id IS NOT NULL THEN closing_decision.reason_code END,
  'reason_note',NULL,'closed_by_display_name',closing_actor.display_name,
  'closed_at',to_char(CASE WHEN closing_review.id IS NOT NULL THEN closing_review.resolved_at
    WHEN closing.event_type='intake.received' AND closing.aggregate_version=1 AND closing.event_ordinal=1 AND i.status='IGNORED'
      THEN i.created_at END,'YYYY-MM-DD HH24:MI:SS')) END`;
export const CARD_SQL = `WITH cards AS (
 SELECT 'ticket'::text AS kind,t.id::text,t.source_intake_id::text AS intake_id,t.ticket_no AS number,
   t.title,t.status,t.priority,t.reported_location_text AS location,profile.name AS reporter_name,profile.department AS reporter_department,
   COALESCE(i.source_channel,'未提供') AS source,p.display_name AS assignee_name,
   review.review_reason_code AS review_reason,
   to_char(t.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
   to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
   to_char(CASE WHEN t.status<>'RESOLVED' THEN ended.at END,'YYYY-MM-DD HH24:MI:SS') AS completed_at,
   to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at,
   CASE WHEN t.status IN ('RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED') THEN jsonb_build_object(
     'source',CASE WHEN ended.operator_type IN ('PILOT_USER','REPORTER') THEN 'MANUAL' WHEN ended.operator_type='SYSTEM' THEN 'SYSTEM' END,
     'reason_code',NULL,'reason_note',ended.internal_note,'closed_by_display_name',closing_actor.display_name,
     'closed_at',to_char(ended.at,'YYYY-MM-DD HH24:MI:SS'),'resolver_team_id',t.resolver_team_id,'assignee_id',t.assignee_id::text) END AS closure_evidence
 FROM pilot_ticket.ticket t
 LEFT JOIN intake.service_intake i ON i.id=t.source_intake_id AND i.retention_until>platform.local_now()
 LEFT JOIN pilot_ticket.pilot_principal p ON p.id=t.assignee_id
 ${REPORTER_PROFILE_SQL}
 LEFT JOIN LATERAL (SELECT e.created_at AS at,e.operator_type,e.operator_id,e.internal_note FROM pilot_ticket.ticket_event e
   WHERE t.status IN ('RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED') AND e.ticket_id=t.id AND e.new_status=t.status
     AND e.old_status IS DISTINCT FROM e.new_status
     AND e.event_type IN ('ticket.resolved','ticket.closed','ticket.cancelled','ticket.duplicate_linked')
   ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) ended ON TRUE
 LEFT JOIN pilot_ticket.pilot_principal closing_actor ON closing_actor.id=CASE
   WHEN ended.operator_id ~ '${UUID_TEXT_PATTERN}' THEN ended.operator_id::uuid END AND ended.operator_type='PILOT_USER'
 LEFT JOIN LATERAL (SELECT r.review_reason_code FROM intake.manual_review_item r
   JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket jt ON jt.id=j.linked_ticket_id
   WHERE r.status='PENDING' AND (r.linked_ticket_id=t.id OR r.service_intake_id=t.source_intake_id OR j.linked_ticket_id=t.id)
     AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
     AND ($1::boolean OR jt.assignee_id=$2::uuid OR jt.resolver_team_id=ANY($3::text[]))
   ORDER BY r.created_at,r.id LIMIT 1) review ON TRUE
 WHERE ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
 UNION ALL
 SELECT 'review',r.id::text,r.service_intake_id::text,i.intake_no,
   COALESCE(NULLIF(i.summary,''),'未提供报修描述'),'PENDING',r.priority,i.reported_location_text,CASE WHEN j.profile_resolution_status='RESOLVED' THEN j.profile_snapshot->'contact'->>'name' END,
   CASE WHEN j.profile_resolution_status='RESOLVED' THEN (SELECT string_agg(m->>'name','、' ORDER BY ord) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.profile_snapshot->'memberships')='array' THEN j.profile_snapshot->'memberships' ELSE '[]'::jsonb END) WITH ORDINALITY AS members(m,ord)) END,i.source_channel,
   NULL,r.review_reason_code,to_char(r.created_at,'YYYY-MM-DD HH24:MI:SS'),
   to_char(r.updated_at,'YYYY-MM-DD HH24:MI:SS'),NULL,to_char(r.updated_at,'YYYY-MM-DD HH24:MI:SS'),NULL::jsonb
 FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id
 JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
 WHERE r.status='PENDING' AND i.retention_until>platform.local_now()
   AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
   AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
   AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual
     WHERE actual.source_intake_id=r.service_intake_id OR actual.id=r.linked_ticket_id OR actual.id=j.linked_ticket_id)
   AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item earlier
     WHERE earlier.service_intake_id=r.service_intake_id AND earlier.status='PENDING'
       AND (earlier.created_at,earlier.id)<(r.created_at,r.id))
 UNION ALL
 SELECT 'intake',i.id::text,i.id::text,i.intake_no,COALESCE(NULLIF(i.summary,''),'未提供报修描述'),
   i.status,NULL,i.reported_location_text,profile.name,profile.department,i.source_channel,NULL,NULL,
   to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS'),to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS'),
   NULL,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS'),${INTAKE_CLOSURE_EVIDENCE_SQL}
 FROM intake.service_intake i ${REPORTER_PROFILE_SQL} ${INTAKE_CLOSURE_SQL}
 WHERE $1::boolean AND i.retention_until>platform.local_now()
   AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','IGNORED')
   AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=i.id OR actual.id=i.pilot_ticket_id)
   AND NOT EXISTS (SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
     JOIN pilot_ticket.ticket actual ON actual.id=j.linked_ticket_id WHERE l.source_intake_id=i.id)
   AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING')
)`;
// Narrow the already authorized canonical card, without multiplying it by Sessions or Legs.
const HANDLING_CARD_SQL = `cards.kind='ticket' AND EXISTS(SELECT 1 FROM pilot_ticket.ticket handling
  WHERE handling.id=cards.id::uuid AND handling.assignee_id=$2::uuid)`;
const COMMUNICATION_CARD_SQL = `EXISTS(SELECT 1 FROM conversation.session s JOIN conversation.assignment a ON a.session_id=s.id
  JOIN intake.service_intake anchor ON anchor.id=cards.intake_id::uuid AND anchor.retention_until>platform.local_now()
  JOIN intake.service_intake material ON material.id=s.service_intake_id AND material.retention_until>platform.local_now()
  WHERE a.assignment_status='ASSIGNED' AND a.assigned_principal_id=$2::uuid AND s.status<>'ENDED'
    AND (s.service_intake_id=anchor.id OR EXISTS(
      SELECT 1 FROM intake.channel_leg own JOIN intake.contact_journey j ON j.id=own.journey_id
      JOIN intake.channel_leg related ON related.journey_id=own.journey_id
      WHERE own.source_intake_id=anchor.id AND related.conversation_session_id=s.id
        AND related.source_intake_id=s.service_intake_id AND related.conversation_thread_id=s.thread_id
        AND own.reporter_identity_hash=j.reporter_identity_hash AND related.reporter_identity_hash=own.reporter_identity_hash
        AND j.retention_until_epoch_ms>platform.physical_epoch_ms())
      OR (cards.kind='ticket' AND EXISTS(
        SELECT 1 FROM intake.channel_leg linked JOIN intake.contact_journey j ON j.id=linked.journey_id
        JOIN intake.service_intake linked_material ON linked_material.id=linked.source_intake_id
        WHERE j.linked_ticket_id=cards.id::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          AND linked_material.retention_until>platform.local_now() AND linked_material.reporter_wecom_userid=s.participant_key
          AND linked.reporter_identity_hash=j.reporter_identity_hash
          AND (linked.conversation_session_id=s.id OR linked.source_intake_id=s.service_intake_id)
          AND (linked.conversation_thread_id=s.thread_id OR linked.conversation_thread_id IS NULL)))))`;
export const RELATED_CARD_SQL = `(${HANDLING_CARD_SQL} OR ${COMMUNICATION_CARD_SQL})`;
export const FOLLOW_CARD_SQL = `EXISTS(SELECT 1 FROM pilot_ticket.workbench_item_follow f JOIN intake.service_intake material ON material.id=f.source_intake_id
 WHERE f.principal_id=$2::uuid AND f.following AND (f.source_intake_id=cards.intake_id::uuid OR (cards.kind='ticket' AND material.retention_until>platform.local_now() AND (
  EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=f.source_intake_id AND j.linked_ticket_id=cards.id::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms())
  OR EXISTS(SELECT 1 FROM intake.manual_review_item r JOIN intake.contact_journey j ON j.id=r.journey_id WHERE r.service_intake_id=f.source_intake_id AND r.linked_ticket_id=cards.id::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms())))))`;

function card(row: CardRow,principal?:WorkbenchPrincipal): WorkbenchCard {
  return { kind: row.kind, id: row.id, intake_id: row.intake_id, number: row.number, title: row.title,
    status: row.status, column: boardColumn(row.status), priority: row.priority, source: row.source,
    source_label:sourceLabel(row.source),source_group:null,
    location: row.location, reporter_name: row.reporter_name,reporter_department:row.reporter_department??null,
    assignee_name: row.assignee_name, review_reason: row.review_reason,
    created_at: localP2016(row.created_at), updated_at: localP2016(row.updated_at),
    completed_at: row.completed_at === null ? null : localP2016(row.completed_at),
    closure:projectWorkbenchClosure(row.status,row.closure_evidence,workbenchCanRestore(row.kind,row.status,row.closure_evidence,principal)) };
}
const CLOSED_INTAKE_CARD_SQL=`SELECT 'intake'::text AS kind,i.id::text,i.id::text AS intake_id,i.intake_no AS number,
        COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,i.status,NULL::text AS priority,i.reported_location_text AS location,
        profile.name AS reporter_name,profile.department AS reporter_department,i.source_channel AS source,NULL::text AS assignee_name,NULL::text AS review_reason,
        to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
        NULL::text AS completed_at,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at,${INTAKE_CLOSURE_EVIDENCE_SQL} AS closure_evidence
        FROM intake.service_intake i ${REPORTER_PROFILE_SQL} ${INTAKE_CLOSURE_SQL} WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()
          AND i.status IN ('COMPLETED','IGNORED')
          AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id OR t.id=i.pilot_ticket_id)
          AND NOT EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
            JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id WHERE l.source_intake_id=i.id)`;
export function workbenchSearchCardsSql(includeClosedIntakes:boolean):string {
  // Closed Intakes are now part of the same default canonical relation.
  // Keep the existing call signature while consumers still pass the review flag.
  void includeClosedIntakes;return CARD_SQL;
}
export function createWeb01WorkbenchQuery({pool,query,sourceGroups=null,workbenchFollowEnabled=false,follow=null,followUpSchedules=null,manualReviewEnabled=false,manualReportsEnabled=false,personalReadEnabled=false,reviews=null,supplementFollowUp=null,webReports=null,reporterProfilesEnabled=false,actorAvatarsEnabled=false,serviceCatalog=null,currentSessionPredicate}: {pool: PostgresTransaction; query: P2016TicketQuery;sourceGroups?:ReturnType<typeof createWorkbenchSourceGroups>|null;workbenchFollowEnabled?:boolean;follow?:FollowProjectionPort|null;followUpSchedules?:Pick<ReturnType<typeof createWorkbenchFollowUpSchedules>,'activeForAuthorizedTickets'>|null;manualReviewEnabled?:boolean;manualReportsEnabled?:boolean;personalReadEnabled?:boolean;reviews?:Pick<ReturnType<typeof createP2016ManualReviewFacade>,'canonicalItem'>|null;supplementFollowUp?:Pick<ReturnType<typeof import('./workbench-supplement-follow-up.mjs').createWorkbenchSupplementFollowUp>,'summary'|'summariesForAuthorizedTickets'>|null;webReports?:Pick<WorkbenchWebReportLifecyclePort,'activeForAuthorizedTickets'>|null;reporterProfilesEnabled?:boolean;actorAvatarsEnabled?:boolean;serviceCatalog?:ServiceCatalog|null;currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate']}) {
  async function decorateWebReportUrgency(items:WorkbenchCard[]):Promise<WorkbenchCard[]>{
    if(!webReports)return items;const ids=[...new Set(items.filter(item=>item.kind==='ticket').map(item=>item.id))];if(!ids.length)return items;
    const active=await webReports.activeForAuthorizedTickets(ids);
    return items.map(item=>{if(item.kind!=='ticket')return item;const value=active.get(item.id)??{active:false,count:0,last_urged_at:null};return {...item,web_report_urge:decodeWebUrge({active:value.active,count:value.count,last_urged_at:value.last_urged_at})};});
  }
  async function decorate(items:WorkbenchCard[],authContext?:unknown,includeWebReports=true,page=false):Promise<WorkbenchCard[]>{
    let sourced=sourceGroups?await sourceGroups.decorate(items):items;
    if(reporterProfilesEnabled){
      const profiles=await readTicketReporterProfiles(pool,items.filter(item=>item.kind==='ticket').map(item=>item.id));
      sourced=sourced.map(item=>{
        const profile=item.kind==='ticket'?profiles.get(item.id):null;
        if(!profile||profile.source_intake_id!==item.intake_id)return item;
        return {...item,source:profile.source_channel,source_label:item.source==='未提供'||profile.source_channel==='MANUAL'?profile.source_label:item.source_label,reporter_name:profile.name,reporter_department:profile.department,
          reporter_profile:{state:profile.state,source:profile.source,captured_at:profile.captured_at}};
      });
    }
    if(includeWebReports)sourced=await decorateWebReportUrgency(sourced);
    if(followUpSchedules){
      const ticketIds=[...new Set(sourced.filter(item=>item.kind==='ticket').map(item=>item.id))];
      if(ticketIds.length){
        const active=await followUpSchedules.activeForAuthorizedTickets(ticketIds);
        sourced=sourced.map(item=>item.kind==='ticket'?{...item,follow_up_schedule:active.get(item.id)??null}:item);
      }
    }
    if(follow&&authContext!==undefined&&!page){
      const p=await scope(authContext);const inputs:{item:WorkbenchCard;reasons:('HANDLING'|'COMMUNICATION')[]}[]=[];
      for(const item of sourced){
        const relation=(await pool.query<{handling:boolean;communication:boolean}>(CARD_SQL+` SELECT (${HANDLING_CARD_SQL}) AS handling,(${COMMUNICATION_CARD_SQL}) AS communication FROM cards WHERE kind=$4 AND id=$5`,[...p.values,item.kind,item.id])).rows[0];
        const reasons:('HANDLING'|'COMMUNICATION')[]=[];if(relation?.handling)reasons.push('HANDLING');if(relation?.communication)reasons.push('COMMUNICATION');
        inputs.push({item,reasons});
      }
      const attention:Awaited<ReturnType<FollowProjectionPort['attention']>>[]=[];for(const {item,reasons} of inputs)attention.push(await follow.attention({authContext,kind:item.kind,id:item.id},item,reasons));
      sourced=inputs.map(({item},index)=>{const value=attention[index];if(!value)failP2016('ACTION_FAILED',503);return {...item,attention:value};});
    }
    if(supplementFollowUp&&authContext!==undefined){
      const summaries=await supplementFollowUp.summariesForAuthorizedTickets(authContext,sourced.filter(item=>item.kind==='ticket').map(({id,intake_id})=>({id,intake_id})));
      sourced=sourced.map(item=>item.kind==='ticket'?{...item,supplement_follow_up:summaries.get(item.id)??{has_pending_supplements:false}}:item);
    }
    if(manualReportsEnabled){
      const reports=await readManualReportSources(pool,sourced.filter(item=>item.source==='MANUAL').map(item=>item.intake_id));
      sourced=sourced.map(item=>{const manual=reports.get(item.intake_id);return manual?{...item,source_label:manual.report.source==='PHONE'?'电话代录':'现场代录',reporter_name:manual.report.reporter.name+(manual.report.reporter.verification==='VERIFIED'?'（本次已核实）':'（身份未核实）'),reporter_department:manual.report.reporter.verification==='VERIFIED'?(manual.report.reporter.departments.join('、')||null):manual.report.reporter.department}:item;});
    }
    if(page&&follow&&authContext!==undefined){
      const attention=await follow.attentionMany(authContext,sourced);
      sourced=sourced.map((item,index)=>{const value=attention[index];if(!value)failP2016('ACTION_FAILED',503);return {...item,attention:value};});
    }else if((page||reporterProfilesEnabled&&sourced.some(item=>item.kind==='ticket'))&&authContext!==undefined&&sourced.length){
      // The page may have awaited source, manual or supplement projections.
      // Recheck current READ once for the entire page, including when Follow is OFF.
      const p=await scope(authContext);
      const current=await pool.query(CARD_SQL+` SELECT cards.kind,cards.id FROM cards
        JOIN jsonb_to_recordset($4::jsonb) AS page(kind text,id text,intake_id text)
          ON cards.kind=page.kind AND cards.id=page.id AND cards.intake_id=page.intake_id`,
      [...p.values,JSON.stringify(sourced.map(({kind,id,intake_id})=>({kind,id,intake_id})))]);
      if(current.rows.length!==sourced.length)failP2016('NOT_FOUND',404);
    }
    return sourced;
  }
  async function scope(authContext:unknown){
    const principal=await query.principal(authContext);
    return {...ticketPredicateP2016(principal),roles:principal.roles,teams:principal.team_ids,principal};
  }
  function sessionProof(authContext:unknown,start:number):WorkbenchSessionPredicate{
    const auth=authContext&&typeof authContext==='object'&&!Array.isArray(authContext)?authContext as Record<string,unknown>:{};
    if(currentSessionPredicate)return currentSessionPredicate(authContext,uuidP2016(auth.principal_id),start);
    const expiry=auth.expires_epoch_ms;
    if(expiry===undefined)return {sql:'TRUE',values:[]}; // Internal/direct and synthetic profiles have no persistent Cookie session.
    if(typeof expiry!=='string'||!/^[1-9][0-9]{0,15}$/u.test(expiry))throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
    return {sql:`platform.physical_epoch_ms()<$${start}::bigint`,values:[expiry]};
  }
  async function range(mode: BoardCompletionRange,closedFrom?:string|null,closedTo?:string|null): Promise<BoardPage['range']> {
    if(mode==='custom'){
      let from:string,to:string;try{from=assertLocalDate(closedFrom);to=assertLocalDate(closedTo);}catch{failP2016();}
      if(from>to||to==='9999-12-31')failP2016();
      const result=await pool.query<{from:string;until:string}>(`SELECT to_char($1::date,'YYYY-MM-DD HH24:MI:SS') AS "from",to_char($2::date+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until`,[from,to]);
      const row=result.rows[0];if(!row)failP2016();return {...row,mode,timezone:'Asia/Shanghai'};
    }
    if(closedFrom!=null||closedTo!=null)failP2016();
    const r=await pool.query<{from:string;until:string}>(`SELECT
      to_char(date_trunc('day',platform.local_now())-interval '1 day','YYYY-MM-DD HH24:MI:SS') AS "from",
      to_char(date_trunc('day',platform.local_now())+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until`);
    const row=r.rows[0];if(!row)failP2016();return {...row,mode,timezone:'Asia/Shanghai'};
  }
  async function item(authContext: unknown,kind: string,id: unknown,includeWebReports=true): Promise<WorkbenchCard> {
    if(!['ticket','review','intake'].includes(kind))failP2016('NOT_FOUND',404);
    const authorized=await scope(authContext);
    const r=await pool.query<CardRow>(CARD_SQL+' SELECT * FROM cards WHERE kind=$4 AND id=$5', [...authorized.values,kind,uuidP2016(id)]);
    let row=r.rows[0];
    if(!row&&manualReviewEnabled&&reviews&&kind==='review'){
      const canonical=await reviews.canonicalItem({authContext,reviewId:uuidP2016(id)});
      if(canonical.kind!==kind||canonical.id!==id)return item(authContext,canonical.kind,canonical.id,includeWebReports);
    }
    if(!row&&manualReviewEnabled&&kind==='intake'&&authorized.values[0]===true){
      const retained=await pool.query<CardRow>(CLOSED_INTAKE_CARD_SQL,[uuidP2016(id)]);
      row=retained.rows[0];
    }
    if(!row)failP2016('NOT_FOUND',404);
    const selected=card(row,authorized.principal);return (await decorate([selected],authContext,includeWebReports))[0]??selected;
  }
  return Object.freeze({
    authorizedItem:item,
    decorateWebReportUrgency,
    async serviceCatalog(authContext:unknown){
      await verifyWorkbenchReadAccess(pool,{authority:()=>scope(authContext),session:start=>sessionProof(authContext,start)});
      let catalog;
      try{catalog=projectWorkbenchCatalog(serviceCatalog);}catch{failP2016('ACTION_FAILED',503);}
      return publicP2016(catalog);
    },
    async list(input: Input): Promise<BoardPage> {
      const authorized=await scope(input.authContext);
      const column=input.column??'pending',mode=input.range??'recent';
      const boardScope=input.scope??'team';
      if((boardScope!=='team'&&boardScope!=='related')||(!workbenchFollowEnabled&&input.scope!=null))failP2016();
      if(!WEB01_COLUMNS.includes(column as BoardColumn)||!['recent','all','cancelled','custom'].includes(mode))failP2016();
      const selectedColumn=column as BoardColumn,selectedRange=mode as BoardCompletionRange,custom=selectedRange==='custom';
      const window=await range(selectedRange,input.closedFrom,input.closedTo),limit=limitP2016(input.limit??'50');
      const page=input.cursor?decodeCursorP2016(input.cursor,['v','principal','scope','column','range','from',...(custom?['until']:[]),'at','kind','id','order_group']):null;
      // Bind cursors to both filters and the current authorized scope, including a changed team/role.
      const scopeKey=JSON.stringify(workbenchFollowEnabled?[authorized.values,boardScope]:authorized.values);
      if(page&&(page.v!==(custom?2:1)||page.principal!==authorized.values[1]||page.scope!==scopeKey||page.column!==column||page.range!==mode||page.from!==window.from||custom&&page.until!==window.until))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,id=page?uuidP2016(page.id):null;
      if(page&&(typeof page.kind!=='string'||!['ticket','review','intake'].includes(page.kind)))failP2016('CURSOR_INVALID');
      if(page&&page.order_group!==0&&page.order_group!==1)failP2016('CURSOR_INVALID');
      const states=STATUS_COLUMNS[selectedColumn].filter(state=>selectedColumn!=='closed'||selectedRange!=='cancelled'||state==='CANCELLED');
      if(follow&&!await follow.ready())failP2016('DISABLED',503);
      const related=boardScope==='related'?` AND (${RELATED_CARD_SQL}${follow?` OR ${FOLLOW_CARD_SQL}`:''})`:'';
      const closedAt=`COALESCE(completed_at,closure_evidence->>'closed_at')`;
      const predicate=`status=ANY($4::text[]) AND ($5::boolean OR status='RESOLVED'
        OR (${closedAt})::timestamp>=$6::timestamp AND (${closedAt})::timestamp<$7::timestamp)${related}`;
      const filterValues=[states,selectedColumn!=='closed'||selectedRange!=='recent'&&!custom,window.from,window.until];
      const pageSql=` SELECT * FROM (SELECT *,
        CASE WHEN $12::boolean AND ${closedAt} IS NOT NULL THEN 1 ELSE 0 END AS order_group,
        CASE WHEN $12::boolean AND ${closedAt} IS NOT NULL THEN ${closedAt} ELSE sort_at END AS order_at FROM cards) cards
        WHERE ${predicate}
        AND ($8::text IS NULL OR (order_group,order_at,kind,id)<($13::integer,$8::text,$9::text,$10::text))
        ORDER BY order_group DESC,order_at DESC,kind DESC,id DESC LIMIT $11`;
      const pageValues=[...filterValues,at,page?.kind??null,id,limit+1,selectedColumn==='closed',page?.order_group??null];
      const r=await pool.query<CardRow & {order_at:string;order_group:number}>(CARD_SQL+pageSql,[...authorized.values,...pageValues]);
      // Recheck the ordered prefix including the limit+1 sentinel. Checking only
      // the returned cards cannot detect a newly matching row or a stale has_more.
      const groupCounts:WorkbenchReadAccess['groupCounts']=selectedColumn==='closed'?{predicate,pageSql,values:pageValues,
        expectedPage:r.rows.map(({kind,id,order_group,order_at})=>({kind,id,order_group,order_at})),
        value:null}:undefined;
      const rows=r.rows.slice(0,limit),decorated=await decorate(rows.map(row=>card(row)),input.authContext,true,true),last=rows.at(-1);
      const items=await readWorkbenchCardProjections(pool,CARD_SQL,{authority:()=>scope(input.authContext),session:start=>sessionProof(input.authContext,start),...(groupCounts?{groupCounts}:{})},decorated,serviceCatalog,manualReportsEnabled);
      const counts=groupCounts?.value;if(selectedColumn==='closed'&&!counts)failP2016('ACTION_FAILED',503);
      return publicP2016({items,column:selectedColumn,range:window,...(counts?{group_counts:counts}:{}),next_cursor:r.rows.length>limit&&last?cursorP2016({v:custom?2:1,
        principal:authorized.values[1],scope:scopeKey,column,range:mode,from:window.from,...(custom?{until:window.until}:{}),at:last.order_at,order_group:last.order_group,kind:last.kind,id:last.id}):null});
    },
    async detail({authContext,kind,id,cursor,limit}: {authContext:unknown;kind:string;id:unknown;cursor:unknown;limit:unknown}): Promise<WorkbenchDetail> {
      const selected=await item(authContext,kind,id),n=limitP2016(limit??'50');
      const page=cursor?decodeCursorP2016(cursor,['kind','id','at','record_id']):null;
      if(page&&(page.kind!==kind||page.id!==uuidP2016(id)))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,recordId=page?.record_id??null;
      if(page&&(typeof recordId!=='string'||recordId.length>100))failP2016('CURSOR_INVALID');
      // Known safe report text, not raw frames, identity tokens, arbitrary payloads or delivery metadata.
      const report=await pool.query<{summary:string|null;source_provider:string}>(`SELECT summary,source_provider FROM intake.service_intake
        WHERE id=$1::uuid AND retention_until>platform.local_now()`,[selected.intake_id]);
      const web=report.rows[0]?.source_provider==='YIXIAOXIU_WEB';
      const manual=personalReadEnabled&&manualReportsEnabled&&report.rows[0]?.source_provider==='STAFF_MANUAL_REPORT'?await readManualReportSource(pool,selected.intake_id):null;
      const manualRecords=manual?`UNION ALL
        SELECT 'manual:'||i.id::text,to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS'),'报修原文',$7::text,
          'REPORT',NULL,NULL,NULL,'manual:'||i.id::text,'1'::text,NULL::text FROM intake.service_intake i
        WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()` : '';
      const webRecords=web?`UNION ALL
        SELECT 'web:'||s.id::text,to_char(s.received_at,'YYYY-MM-DD HH24:MI:SS'),
          CASE WHEN s.kind='SUBMIT' THEN '报修原文' ELSE '报修补充' END,
          CASE WHEN s.kind='SUBMIT' THEN s.safe_content->>'description' ELSE s.safe_content->>'text' END,
          'REPORT',NULL,NULL,NULL,${personalReadEnabled?"'web:'||s.id::text,s.input_revision::text":"NULL::text,NULL::text"},NULL::text FROM intake.web_submission s
        JOIN intake.web_request_binding b ON b.intake_id=s.intake_id
        WHERE s.intake_id=$1::uuid AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
          AND s.retention_until>platform.local_now()` : '';
      const records=await pool.query<WorkbenchRecord&{material_source_ref:string|null;material_revision:string|null}>(`WITH readable_intakes AS (
        SELECT id FROM intake.service_intake WHERE id=$1::uuid AND retention_until>platform.local_now()
        UNION SELECT i.id FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id
        JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE $2='ticket' AND j.linked_ticket_id=$3::uuid
          AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until>platform.local_now()
      ), records AS (
        SELECT 'message:'||m.id::text AS id,to_char(rel.linked_at,'YYYY-MM-DD HH24:MI:SS') AS at,
          CASE WHEN rel.intake_id=$1::uuid AND rel.relation_type='PRIMARY' THEN '报修原文' ELSE '报修补充' END AS type,
          m.clean_text AS text,'REPORT'::text AS audience,NULL::text AS actor,NULL::text AS old_status,NULL::text AS new_status,
          ${personalReadEnabled?"CASE WHEN i.source_provider='WECOM_AIBOT' THEN 'channel:'||m.id::text END":"NULL::text"} AS material_source_ref,
          ${personalReadEnabled?"CASE WHEN i.source_provider='WECOM_AIBOT' THEN rel.sequence_no::text END":"NULL::text"} AS material_revision,NULL::text AS actor_ref
        FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        JOIN intake.service_intake i ON i.id=rel.intake_id
        WHERE rel.intake_id IN (SELECT id FROM readable_intakes) AND i.retention_until>platform.local_now() AND m.retention_until>platform.local_now()
        UNION ALL
        SELECT 'event:'||e.event_id::text,to_char(e.created_at,'YYYY-MM-DD HH24:MI:SS'),e.event_type,
          e.internal_note,'INTERNAL',COALESCE(p.display_name,e.operator_type),e.old_status,e.new_status,NULL,NULL,p.id::text
        FROM pilot_ticket.ticket_event e LEFT JOIN pilot_ticket.pilot_principal p ON p.id::text=e.operator_id
        WHERE $2='ticket' AND e.ticket_id=$3::uuid
        UNION ALL
        SELECT 'external:'||e.event_id::text,to_char(e.created_at,'YYYY-MM-DD HH24:MI:SS'),'对外摘要',
          e.external_note,'EXTERNAL',COALESCE(p.display_name,e.operator_type),NULL,NULL,NULL,NULL,p.id::text
        FROM pilot_ticket.ticket_event e LEFT JOIN pilot_ticket.pilot_principal p ON p.id::text=e.operator_id
        WHERE $2='ticket' AND e.ticket_id=$3::uuid AND e.external_note IS NOT NULL
        UNION ALL
        SELECT 'intake-event:'||e.event_id::text,to_char(e.occurred_at,'YYYY-MM-DD HH24:MI:SS'),
          e.event_type,NULL,'INTERNAL','SYSTEM',NULL,NULL,NULL,NULL,NULL FROM intake.service_intake_event e
        WHERE $2='intake' AND e.intake_id=$1::uuid
        ${webRecords}
        ${manualRecords}
      ) SELECT * FROM records WHERE ($4::text IS NULL OR (at,id)<($4::text,$5::text))
        ORDER BY at DESC,id DESC LIMIT $6`,[selected.intake_id,selected.kind,selected.id,at,recordId,n+1,...(manual?[manual.report.description]:[])]);
      const items=records.rows.slice(0,n).map(({material_source_ref,material_revision,actor_ref,...record})=>({...record,...(actorAvatarsEnabled?{actor_ref:actor_ref??null}:{}),...(material_source_ref&&material_revision?{read_material:{source_ref:material_source_ref,revision:material_revision}}:{})})),last=items.at(-1);
      // The legacy responsibility view retains history. Filter current ownership
      // before its bounded result, without changing historical assignment facts.
      const responsibility=selected.kind==='ticket'?await query.responsibility({authContext,ticketId:selected.id,currentConversationsOnly:true}):null;
      const names: string[]=[];
      if(responsibility&&Array.isArray(responsibility.conversations))for(const conversation of responsibility.conversations){
        if(typeof conversation.conversation_principal_name==='string')names.push(conversation.conversation_principal_name);
      }
      let reviewRefs:ReviewReference[]|undefined;
      if(manualReviewEnabled){
        const authorized=await scope(authContext);
        const refs=await pool.query<ReviewReference>(`SELECT r.id::text,r.status,r.row_version::text FROM intake.manual_review_item r
          JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
          JOIN intake.service_intake i ON i.id=r.service_intake_id
          WHERE ($4='ticket' AND (r.service_intake_id=$5::uuid OR r.linked_ticket_id=$6::uuid OR j.linked_ticket_id=$6::uuid)
            OR $4<>'ticket' AND r.service_intake_id=$5::uuid)
            AND ${authorized.sql} AND i.retention_until>platform.local_now()
            AND j.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY r.created_at,r.id LIMIT 101`,
        [...authorized.values,selected.kind,selected.intake_id,selected.id]);
        if(refs.rows.length>100)failP2016('REVIEW_SCOPE_TOO_LARGE',503);
        reviewRefs=refs.rows;
      }
      const reported=await pool.query<{at:string|null}>(web?`SELECT to_char(s.received_at,'YYYY-MM-DD HH24:MI:SS') AS at
        FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id
        JOIN intake.web_submission s ON s.intake_id=i.id AND s.kind='SUBMIT'
        WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()
          AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND s.retention_until>platform.local_now()
        ORDER BY s.input_revision LIMIT 1`:`SELECT to_char(CASE WHEN i.source_provider='STAFF_MANUAL_REPORT' THEN i.created_at ELSE m.received_at END,'YYYY-MM-DD HH24:MI:SS') AS at
        FROM intake.service_intake i LEFT JOIN channel.message_inbox m ON m.id=i.primary_message_id AND m.retention_until>platform.local_now()
        WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()`,[selected.intake_id]);
      const projected=(await readWorkbenchCardProjections(pool,workbenchSearchCardsSql(manualReviewEnabled),{authority:()=>scope(authContext),session:start=>sessionProof(authContext,start),finalRouteCheck:async()=>{
        // Preserve the original requested route check after the projection wait.
        const currentItem=await item(authContext,kind,id);
        if(currentItem.kind!==selected.kind||currentItem.id!==selected.id)failP2016('VERSION_CONFLICT',409);
      }},[selected],serviceCatalog,manualReportsEnabled))[0];
      if(!projected)failP2016('NOT_FOUND',404);
      return publicP2016({item:projected,description:report.rows[0]?.summary??null,reported_at:reported.rows[0]?.at??null,records:items,
        next_cursor:records.rows.length>n&&last?cursorP2016({kind,id:uuidP2016(id),at:last.at,record_id:last.id}):null,
        responsibility:{ticket_assignee_name:selected.assignee_name,conversation_assignees:[...new Set(names)]},...(reviewRefs?{review_refs:reviewRefs}:{}),
        ...(selected.kind!==kind||selected.id!==id?{requested_item:{kind:kind as WorkbenchCard['kind'],id:uuidP2016(id)}}:{})});
    },
  });
}

// Internal SQL seams preserve the original authorized canonical relation and responsibility predicates.
export {CARD_SQL as WEB01_AUTHORIZED_CARDS_SQL,HANDLING_CARD_SQL,COMMUNICATION_CARD_SQL};
export type {CardRow as Web01CardRow};
