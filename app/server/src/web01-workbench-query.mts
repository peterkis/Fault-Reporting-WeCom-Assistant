import type {WorkbenchSessionPredicate,createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {ServiceCatalog} from './p2-007-service-catalog.mjs';
import {FINAL_EPOCH_SQL,FINAL_LOCAL_SQL,finalCardReadSql,intakeJourneyIdsSql,withFinalStatementClock,projectWorkbenchCatalog,projectWorkbenchClosure,readWorkbenchCardProjections,verifyWorkbenchReadAccess,workbenchCanRestore} from './workbench-card-projections.mjs';
import type {ClosureEvidence,WorkbenchClock,WorkbenchReadAccess} from './workbench-card-projections.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {FollowProjectionPort} from './workbench-follow.mjs';
import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { BoardColumn, BoardCompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail } from '../../../contracts/web01_workbench_contracts.js';
import {assertLocalDate} from './platform/time-contract.mjs';
import { boundReader,liveReader,ticketReadSql,ticketReviewReasonSql,currentItemReaderSql,withCurrentCardReader,currentReviewRouteSql,ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
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

export type {WorkbenchClock};
export interface SqlParamBuilder {
  once(key: string, value: unknown, cast: string): string;
  add(value: unknown, cast: string): string;
  readonly values: unknown[];
  nextIndex(): number;
}
export function createParamBuilder(initialValues: readonly unknown[] = []): SqlParamBuilder {
  const values: unknown[] = [...initialValues];
  const bound = new Map<string, string>();
  const add = (value: unknown, cast: string): string => {
    values.push(value);
    return `$${values.length}::${cast}`;
  };
  const once = (key: string, value: unknown, cast: string): string => {
    const existing = bound.get(key);
    if (existing !== undefined) return existing;
    const token = add(value, cast);
    bound.set(key, token);
    return token;
  };
  return { once, add, values, nextIndex: () => values.length + 1 };
}
export const WEB01_COLUMNS: readonly BoardColumn[] = ['pending', 'active', 'handled'];
const STATUS_COLUMNS = {
  pending: ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'],
  active: ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'],
  handled: ['RESOLVED','COMPLETED','DISMISSED'],
} as const;
const TICKET_PENDING_STATUSES = ['NEW','QUEUED','ACCEPTED','REOPENED'] as const;
const TICKET_ACTIVE_STATUSES = ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'] as const;
const INTAKE_PENDING_STATUSES = ['RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'] as const;

export function boardColumn(status: string): BoardColumn {
  for(const column of WEB01_COLUMNS)if(STATUS_COLUMNS[column].some(value=>value===status))return column;
  failP2016();
}
export interface CardRelationRow {kind:string;id:string;handling:boolean;communication:boolean}
interface CardRow extends Omit<WorkbenchCard, 'column'|'source_label'|'source_group'|'follow_up_schedule'|'closure'> { sort_at: string; closure_evidence:ClosureEvidence|null }
interface Input { authContext: unknown; column: string | null; range: string | null; scope?: string | null; handledFrom?:string|null; handledTo?:string|null; cursor: unknown; limit: unknown }
const UUID_TEXT_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export async function readWorkbenchClock(pool: Pick<PostgresTransaction, 'query'>): Promise<WorkbenchClock> {
  const row=(await pool.query<{now_epoch:string;now_local:string}>("SELECT platform.physical_epoch_ms()::text AS now_epoch,to_char(platform.local_now(),'YYYY-MM-DD HH24:MI:SS') AS now_local")).rows[0];
  if(!row)failP2016('ACTION_FAILED',503);
  return {nowEpoch:row.now_epoch,nowLocal:row.now_local};
}

function reporterProfileSql(nowEpochParam:string):string{
  return `LEFT JOIN LATERAL (SELECT j.profile_snapshot->'contact'->>'name' AS name,
   (SELECT string_agg(m->>'name','、' ORDER BY ord) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.profile_snapshot->'memberships')='array' THEN j.profile_snapshot->'memberships' ELSE '[]'::jsonb END) WITH ORDINALITY AS members(m,ord)) AS department
 FROM (${intakeJourneyIdsSql('i.id')}) candidate
 JOIN intake.contact_journey j ON j.id=candidate.id
 WHERE i.id IS NOT NULL AND j.profile_resolution_status='RESOLVED'
   AND j.retention_until_epoch_ms>${nowEpochParam}
 ORDER BY (j.origin_intake_id=i.id) DESC,j.reported_at,j.id LIMIT 1) profile ON TRUE`;
}
// Manual BOT decisions retain their original observed_at. The resolved review is
// the actual human closing instant; updated_at is never a closing-time fallback.
function intakeCompletedClosingSql(nowEpochParam:string,eventIntakeId='i.id'):string{
  return `LEFT JOIN LATERAL (SELECT e.event_type,e.occurred_at,e.payload,e.aggregate_version,e.event_ordinal
  FROM intake.service_intake_event e WHERE e.intake_id=${eventIntakeId}
    AND i.status='COMPLETED'
    AND (e.event_type='intake.rule_decision_applied' AND e.payload->>'new_status'=i.status
      AND e.payload->>'old_status' IS DISTINCT FROM e.payload->>'new_status'
      OR e.event_type='intake.received' AND e.payload->>'status'=i.status)
  ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) closing ON TRUE
 LEFT JOIN intake.deterministic_decision closing_decision ON closing_decision.id=CASE
   WHEN closing.payload->>'decision_id' ~ '${UUID_TEXT_PATTERN}' THEN (closing.payload->>'decision_id')::uuid END
   AND closing_decision.service_intake_id=i.id
   AND EXISTS(SELECT 1 FROM intake.contact_journey retained WHERE retained.id=closing_decision.journey_id
     AND retained.retention_until_epoch_ms>${nowEpochParam})
 LEFT JOIN intake.manual_review_item closing_review ON closing_review.resolution_decision_id=closing_decision.id
   AND closing_review.service_intake_id=i.id AND closing_review.journey_id=closing_decision.journey_id
   AND closing_review.status='RESOLVED' AND closing_decision.status='HUMAN_OVERRIDDEN'
   AND closing_review.resolved_by_principal_id::text=closing_decision.safe_result#>>'{human_override,principal_id}'`;
}
function intakeClosureSql(nowEpochParam:string):string{
  return `${intakeCompletedClosingSql(nowEpochParam)}
 LEFT JOIN pilot_ticket.pilot_principal closing_actor ON closing_actor.id=closing_review.resolved_by_principal_id
 LEFT JOIN pilot_ticket.closure_record intake_closure ON intake_closure.intake_id=i.id AND intake_closure.restored_at IS NULL
 LEFT JOIN pilot_ticket.pilot_principal intake_closing_actor ON intake_closing_actor.id::text=intake_closure.ended_by`;
}
const INTAKE_CLOSURE_EVIDENCE_SQL=`CASE WHEN i.status='DISMISSED' THEN CASE WHEN intake_closure.id IS NOT NULL THEN jsonb_build_object('record_id',intake_closure.id::text,'source',intake_closure.source,'reason_code',intake_closure.reason_code,'secondary_reason_code',intake_closure.secondary_reason_code,'reason_note',intake_closure.note,'ended_by_display_name',intake_closing_actor.display_name,'ended_at',to_char(intake_closure.ended_at,'YYYY-MM-DD HH24:MI:SS'),'duplicate_of_ref',intake_closure.duplicate_of_ref) END ELSE (CASE WHEN i.status='COMPLETED' THEN jsonb_build_object(
  'source',CASE WHEN closing_review.id IS NOT NULL THEN 'MANUAL'
    WHEN closing_decision.status='RECORDED' AND closing_decision.safe_result->'human_override' IS NULL THEN 'SYSTEM'
    WHEN closing.event_type='intake.received' AND closing.aggregate_version=1 AND closing.event_ordinal=1 AND i.status='DISMISSED' THEN 'SYSTEM' END,
  'reason_code',CASE WHEN closing_review.id IS NOT NULL THEN closing_decision.reason_code END,
  'reason_note',NULL,'ended_by_display_name',closing_actor.display_name,
  'ended_at',to_char(CASE WHEN closing_review.id IS NOT NULL THEN closing_review.resolved_at
    WHEN closing.event_type='intake.received' AND closing.aggregate_version=1 AND closing.event_ordinal=1 AND i.status='DISMISSED'
      THEN i.created_at END,'YYYY-MM-DD HH24:MI:SS')) END) END`;

// Closing actor/note lookup runs only on final-page RESOLVED/COMPLETED rows; terminal timestamp comes directly from t.terminal_at.
const TICKET_ENDED_ACTOR_JOIN_SQL=`LEFT JOIN LATERAL (SELECT e.operator_type,e.operator_id,e.internal_note FROM pilot_ticket.ticket_event e
   WHERE t.status IN ('RESOLVED','COMPLETED') AND e.ticket_id=t.id AND e.new_status=t.status
     AND e.old_status IS DISTINCT FROM e.new_status
     AND e.event_type IN ('ticket.resolved','ticket.completed')
   ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) ended ON TRUE
 LEFT JOIN pilot_ticket.pilot_principal closing_actor ON closing_actor.id=CASE
   WHEN ended.operator_id ~ '${UUID_TEXT_PATTERN}' THEN ended.operator_id::uuid END AND ended.operator_type='PILOT_USER'`;

type CardFields='full'|'freshness'|'projection';
// The matched search row already covers kind, ID, intake, number, title, status and location.
// The matched row also signs sort_at and the resolved origin. Hash the remaining card fields on both reads.
const EXTRA_CARD_FIELDS=['priority','reporter_name','reporter_department','source','assignee_name','review_reason','created_at','updated_at','completed_at','closure_evidence'] as const;
const TICKET_CLOSURE_SQL=`CASE WHEN t.status='DISMISSED' THEN CASE WHEN ticket_closure.id IS NOT NULL THEN jsonb_build_object('record_id',ticket_closure.id::text,'source',ticket_closure.source,'reason_code',ticket_closure.reason_code,'secondary_reason_code',ticket_closure.secondary_reason_code,'reason_note',ticket_closure.note,'ended_by_display_name',ticket_closing_actor.display_name,'ended_at',to_char(COALESCE(ticket_closure.ended_at,t.terminal_at),'YYYY-MM-DD HH24:MI:SS'),'duplicate_of_ref',ticket_closure.duplicate_of_ref,'resolver_team_id',t.resolver_team_id,'assignee_id',t.assignee_id::text) END WHEN t.status IN ('RESOLVED','COMPLETED') THEN jsonb_build_object(
     'source',CASE WHEN ended.operator_type IN ('PILOT_USER','REPORTER') THEN 'MANUAL' WHEN ended.operator_type='SYSTEM' THEN 'SYSTEM' END,
     'reason_code',NULL,'reason_note',ended.internal_note,'ended_by_display_name',closing_actor.display_name,
     'ended_at',to_char(t.terminal_at,'YYYY-MM-DD HH24:MI:SS'),'resolver_team_id',t.resolver_team_id,'assignee_id',t.assignee_id::text) END`;
const TICKET_CLOSURE_JOINS=`LEFT JOIN pilot_ticket.closure_record ticket_closure ON ticket_closure.ticket_id=t.id AND ticket_closure.restored_at IS NULL
 LEFT JOIN pilot_ticket.pilot_principal ticket_closing_actor ON ticket_closing_actor.id::text=ticket_closure.ended_by
 ${TICKET_ENDED_ACTOR_JOIN_SQL}`;

function ticketCardSelectSql(nowEpochParam:string,nowLocalParam:string,fields:CardFields='full',reader=boundReader):string{
  const keys="'ticket'::text AS kind,t.id::text,t.source_intake_id::text AS intake_id,t.status";
  if(fields==='projection')return `SELECT ${keys},${TICKET_CLOSURE_SQL} AS closure_evidence FROM pilot_ticket.ticket t ${TICKET_CLOSURE_JOINS}`;
  return `SELECT ${keys},${fields==='full'?`t.ticket_no AS number,t.title,t.reported_location_text AS location,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at,`:''}
   t.priority,profile.name AS reporter_name,profile.department AS reporter_department,COALESCE(i.source_channel,'未提供') AS source,
   p.display_name AS assignee_name,review.review_reason_code AS review_reason,
   to_char(t.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
   to_char(CASE WHEN t.status='DISMISSED' THEN COALESCE(ticket_closure.ended_at,t.terminal_at) WHEN t.status='COMPLETED' THEN t.terminal_at END,'YYYY-MM-DD HH24:MI:SS') AS completed_at,
   ${TICKET_CLOSURE_SQL} AS closure_evidence
 FROM pilot_ticket.ticket t
 LEFT JOIN intake.service_intake i ON i.id=t.source_intake_id AND i.retention_until>${nowLocalParam}
 LEFT JOIN pilot_ticket.pilot_principal p ON p.id=t.assignee_id
 ${reporterProfileSql(nowEpochParam)} ${TICKET_CLOSURE_JOINS} LEFT JOIN LATERAL (${ticketReviewReasonSql('t.id','t.source_intake_id',nowEpochParam,reader)}) review ON TRUE`;
}
const REVIEW_FROM_SQL=`FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id
 JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id`;
function reviewCardSelectSql(fields:CardFields='full'):string{
  const keys="'review'::text AS kind,r.id::text,r.service_intake_id::text AS intake_id,'PENDING'::text AS status";
  if(fields==='projection')return `SELECT ${keys},NULL::jsonb AS closure_evidence ${REVIEW_FROM_SQL}`;
  return `SELECT ${keys},${fields==='full'?`i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,i.reported_location_text AS location,to_char(r.updated_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at,`:''}
   r.priority,CASE WHEN j.profile_resolution_status='RESOLVED' THEN j.profile_snapshot->'contact'->>'name' END AS reporter_name,
   CASE WHEN j.profile_resolution_status='RESOLVED' THEN (SELECT string_agg(m->>'name','、' ORDER BY ord) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.profile_snapshot->'memberships')='array' THEN j.profile_snapshot->'memberships' ELSE '[]'::jsonb END) WITH ORDINALITY AS members(m,ord)) END AS reporter_department,i.source_channel AS source,NULL::text AS assignee_name,r.review_reason_code AS review_reason,
   to_char(r.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(r.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
   NULL::text AS completed_at,NULL::jsonb AS closure_evidence ${REVIEW_FROM_SQL}`;
}
function intakeCardSelectSql(nowEpochParam:string,fields:CardFields='full'):string{
  const keys="'intake'::text AS kind,i.id::text,i.id::text AS intake_id,i.status";
  if(fields==='projection')return `SELECT ${keys},${INTAKE_CLOSURE_EVIDENCE_SQL} AS closure_evidence FROM intake.service_intake i ${intakeClosureSql(nowEpochParam)}`;
  return `SELECT ${keys},${fields==='full'?`i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,i.reported_location_text AS location,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at,`:''}
   NULL::text AS priority,profile.name AS reporter_name,profile.department AS reporter_department,i.source_channel AS source,NULL::text AS assignee_name,NULL::text AS review_reason,
   to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
   NULL::text AS completed_at,${INTAKE_CLOSURE_EVIDENCE_SQL} AS closure_evidence
 FROM intake.service_intake i ${reporterProfileSql(nowEpochParam)} ${intakeClosureSql(nowEpochParam)}`;
}

const REVIEW_ELIGIBLE_WHERE_SQL=(nowEpochParam:string,nowLocalParam:string,reader=boundReader)=>`r.status='PENDING' AND i.retention_until>${nowLocalParam}
   AND j.retention_until_epoch_ms>${nowEpochParam}
   AND ${ticketReadSql('t',reader)}
   AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=r.service_intake_id)
   AND (r.linked_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=r.linked_ticket_id))
   AND (j.linked_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=j.linked_ticket_id))
   AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item earlier
     WHERE earlier.service_intake_id=r.service_intake_id AND earlier.status='PENDING'
       AND (earlier.created_at,earlier.id)<(r.created_at,r.id))`;

// Both IDs are NOT NULL. For the completed cohort, build the exclusion set once per statement.
export const TICKET_SOURCE_SET_SQL="i.id NOT IN (SELECT actual.source_intake_id FROM pilot_ticket.ticket actual)";
// A scalar lookup on the UNIQUE NOT NULL source key cannot be flattened to a nested-loop anti join.
export const TICKET_SOURCE_PROBE_SQL='(SELECT actual.source_intake_id FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=i.id) IS NULL';
export const standaloneIntakePredicateSql=(nowLocalParam:string,isAdminParam='$1::boolean',sourceCheck='NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=i.id)')=>`${isAdminParam} AND i.retention_until>${nowLocalParam}
   AND ${sourceCheck}
   AND (i.pilot_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=i.pilot_ticket_id))
   AND NOT EXISTS (SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
     WHERE l.source_intake_id=i.id AND j.linked_ticket_id IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING')`;

export function canonicalWebMaterialSql():string{
  return withFinalStatementClock(`SELECT 1 FROM intake.service_intake web WHERE web.source_provider='YIXIAOXIU_WEB' AND web.retention_until_epoch_ms>${FINAL_EPOCH_SQL}
   AND (EXISTS(SELECT 1 FROM pilot_ticket.ticket t WHERE t.source_intake_id=web.id
         AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[])))
     OR EXISTS(SELECT 1 ${REVIEW_FROM_SQL} WHERE r.service_intake_id=web.id AND ${REVIEW_ELIGIBLE_WHERE_SQL(FINAL_EPOCH_SQL,FINAL_LOCAL_SQL)})
     OR EXISTS(SELECT 1 FROM intake.service_intake i WHERE i.id=web.id AND ${standaloneIntakePredicateSql(FINAL_LOCAL_SQL)}
         AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED'))) LIMIT 1`);
}

/** Canonical card CTE accepting ($1 is_admin, $2 principal_id, $3 team_ids, $4 now_epoch, $5 now_local). */
export function buildCardsCteSql(nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone'):string{
  return `WITH cards AS (
 ${ticketCardSelectSql(nowEpochParam,nowLocalParam)}
 WHERE ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
 UNION ALL
 ${reviewCardSelectSql()}
 WHERE ${REVIEW_ELIGIBLE_WHERE_SQL(nowEpochParam,nowLocalParam)}
 UNION ALL
 ${intakeCardSelectSql(nowEpochParam)}
 WHERE ${standaloneIntakePredicateSql(nowLocalParam)}
   AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED')
)`;
}
export const CARD_SQL = buildCardsCteSql('$4::bigint','$5::timestamp without time zone');

export function buildCommunicationPredicateSql({kind,idExpr,intakeIdExpr,principalParam='$2::uuid',nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone'}:{kind:'ticket'|'review'|'intake'|'any';idExpr:string;intakeIdExpr:string;principalParam?:string;nowEpochParam?:string;nowLocalParam?:string}):string{
  const ticketLegBranch=kind==='review'||kind==='intake'
    ?''
    :` OR (${kind==='ticket'?'TRUE':'cards.kind=\'ticket\''} AND EXISTS(
        SELECT 1 FROM intake.channel_leg linked JOIN intake.contact_journey j ON j.id=linked.journey_id
        JOIN intake.service_intake linked_material ON linked_material.id=linked.source_intake_id
        WHERE j.linked_ticket_id=${idExpr} AND j.retention_until_epoch_ms>${nowEpochParam}
          AND linked_material.retention_until>${nowLocalParam} AND linked_material.reporter_wecom_userid=s.participant_key
          AND linked.reporter_identity_hash=j.reporter_identity_hash
          AND (linked.conversation_session_id=s.id OR linked.source_intake_id=s.service_intake_id)
          AND (linked.conversation_thread_id=s.thread_id OR linked.conversation_thread_id IS NULL)))`;
  return `EXISTS(SELECT 1 FROM conversation.session s JOIN conversation.assignment a ON a.session_id=s.id
  JOIN intake.service_intake anchor ON anchor.id=${intakeIdExpr} AND anchor.retention_until>${nowLocalParam}
  JOIN intake.service_intake material ON material.id=s.service_intake_id AND material.retention_until>${nowLocalParam}
  WHERE a.assignment_status='ASSIGNED' AND a.assigned_principal_id=${principalParam} AND s.status<>'ENDED'
    AND (s.service_intake_id=anchor.id OR EXISTS(
      SELECT 1 FROM intake.channel_leg own JOIN intake.contact_journey j ON j.id=own.journey_id
      JOIN intake.channel_leg related ON related.journey_id=own.journey_id
      WHERE own.source_intake_id=anchor.id AND related.conversation_session_id=s.id
        AND related.source_intake_id=s.service_intake_id AND related.conversation_thread_id=s.thread_id
        AND own.reporter_identity_hash=j.reporter_identity_hash AND related.reporter_identity_hash=own.reporter_identity_hash
        AND j.retention_until_epoch_ms>${nowEpochParam})${ticketLegBranch}))`;
}
export function buildFollowPredicateSql({kind,idExpr,intakeIdExpr,principalParam='$2::uuid',nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone'}:{kind:'ticket'|'review'|'intake'|'any';idExpr:string;intakeIdExpr:string;principalParam?:string;nowEpochParam?:string;nowLocalParam?:string}):string{
  const ticketFollowBranch=kind==='review'||kind==='intake'
    ?''
    :` OR (${kind==='ticket'?'TRUE':'cards.kind=\'ticket\''} AND material.retention_until>${nowLocalParam} AND (
  EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=f.source_intake_id AND j.linked_ticket_id=${idExpr} AND j.retention_until_epoch_ms>${nowEpochParam})
  OR EXISTS(SELECT 1 FROM intake.manual_review_item r JOIN intake.contact_journey j ON j.id=r.journey_id WHERE r.service_intake_id=f.source_intake_id AND r.linked_ticket_id=${idExpr} AND j.retention_until_epoch_ms>${nowEpochParam})))`;
  return `EXISTS(SELECT 1 FROM pilot_ticket.workbench_item_follow f JOIN intake.service_intake material ON material.id=f.source_intake_id
 WHERE f.principal_id=${principalParam} AND f.following AND (f.source_intake_id=${intakeIdExpr}${ticketFollowBranch}))`;
}
// Narrow the already authorized canonical card, without multiplying it by Sessions or Legs.
const HANDLING_CARD_SQL = `cards.kind='ticket' AND EXISTS(SELECT 1 FROM pilot_ticket.ticket handling
  WHERE handling.id=cards.id::uuid AND handling.assignee_id=$2::uuid)`;
const COMMUNICATION_CARD_SQL = buildCommunicationPredicateSql({kind:'any',idExpr:'cards.id::uuid',intakeIdExpr:'cards.intake_id::uuid'});
export const RELATED_CARD_SQL = `(${HANDLING_CARD_SQL} OR ${COMMUNICATION_CARD_SQL})`;
export const FOLLOW_CARD_SQL = buildFollowPredicateSql({kind:'any',idExpr:'cards.id::uuid',intakeIdExpr:'cards.intake_id::uuid'});

function buildBranchScopeSql({kind,idExpr,intakeIdExpr,ticketAssigneeExpr,includeFollow,nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone'}:{kind:'ticket'|'review'|'intake';idExpr:string;intakeIdExpr:string;ticketAssigneeExpr?:string;includeFollow:boolean;nowEpochParam?:string;nowLocalParam?:string}):string{
  const parts:string[]=[];
  if(kind==='ticket'&&ticketAssigneeExpr)parts.push(`${ticketAssigneeExpr}=$2::uuid`);
  parts.push(buildCommunicationPredicateSql({kind,idExpr,intakeIdExpr,nowEpochParam,nowLocalParam}));
  if(includeFollow)parts.push(buildFollowPredicateSql({kind,idExpr,intakeIdExpr,nowEpochParam,nowLocalParam}));
  return '('+parts.join(' OR ')+')';
}

interface HandledScope {relatedOnly:boolean;includeFollow:boolean;nowEpochParam?:string;nowLocalParam?:string;allRangeParam?:string;fromParam?:string;untilParam?:string}

/** Only a matching RESOLVED review supplies a closing time. Other completed Intakes belong to group zero. */
function completedIntakeKeysSql({relatedOnly,includeFollow,nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone',allRangeParam='$6::boolean',fromParam='$7::timestamp without time zone',untilParam='$8::timestamp without time zone'}:HandledScope,options:{allRange?:boolean;candidates?:string}={}):string{
  const related=relatedOnly?' AND '+buildBranchScopeSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',includeFollow,nowEpochParam,nowLocalParam}):'';
  const eligible=`i.status='COMPLETED' AND ${standaloneIntakePredicateSql(nowLocalParam,'$1::boolean',options.candidates?TICKET_SOURCE_PROBE_SQL:TICKET_SOURCE_SET_SQL)}${related}`;
  const range=`(${allRangeParam} OR (closing_review.id IS NOT NULL AND closing_review.resolved_at>=${fromParam} AND closing_review.resolved_at<${untilParam}))`;
  const keys=`SELECT CASE WHEN closing_review.id IS NOT NULL THEN 1 ELSE 0 END AS order_group,
    date_trunc('second',COALESCE(closing_review.resolved_at,i.updated_at)) AS order_at,'intake'::text AS kind,i.id,i.id AS intake_id,i.status`;
  if(options.allRange){
    // The post-wait count includes every eligible Intake. Only reviewed ones can require an event/decision lookup.
    return `WITH eligible AS MATERIALIZED (
      SELECT i.id,i.updated_at,i.status,i.id IN (SELECT r.service_intake_id FROM intake.manual_review_item r WHERE r.status='RESOLVED') AS reviewed
      FROM intake.service_intake i WHERE ${eligible}
    ), reviewed_intakes AS MATERIALIZED (
      SELECT id,updated_at,status FROM eligible WHERE reviewed
    ) ${keys} FROM reviewed_intakes i ${intakeCompletedClosingSql(nowEpochParam)} WHERE ${range}
      UNION ALL SELECT 0,date_trunc('second',i.updated_at),'intake'::text,i.id,i.id,i.status
        FROM eligible i WHERE NOT i.reviewed AND ${allRangeParam}`;
  }
  const reviewedIntake=options.candidates?'i.id':`CASE WHEN i.id IN (SELECT r.service_intake_id FROM intake.manual_review_item r WHERE r.status='RESOLVED') THEN i.id END`;
  return `${keys} FROM intake.service_intake i ${options.candidates?'JOIN ('+options.candidates+') candidate ON candidate.service_intake_id=i.id':''}
    ${intakeCompletedClosingSql(nowEpochParam,reviewedIntake)}
    WHERE ${eligible} AND ${range}`;
}

function terminalTicketCursorSql(kind:string|undefined,atParam:string,idParam:string):string{
  return kind==='ticket'?` AND (t.terminal_at,t.id)<(${atParam},${idParam})`:` AND t.terminal_at<${atParam}`;
}

/** Lightweight keyset-only selection for board columns, pushing status/range/visibility/related/cursor into each branch. */
export function buildBoardKeysSql({column,relatedOnly,includeFollow,hasCursor,cursorOrderGroup,cursorKind,nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone',allRangeParam='$6::boolean',fromParam='$7::timestamp without time zone',untilParam='$8::timestamp without time zone',limitParam='$9::integer',cursorGroupParam='$10::integer',cursorAtParam='$11::timestamp without time zone',cursorKindParam='$12::text',cursorIdParam='$13::uuid'}:{column:BoardColumn;relatedOnly:boolean;includeFollow:boolean;hasCursor:boolean;cursorOrderGroup?:number;cursorKind?:string;nowEpochParam?:string;nowLocalParam?:string;allRangeParam?:string;fromParam?:string;untilParam?:string;limitParam?:string;cursorGroupParam?:string;cursorAtParam?:string;cursorKindParam?:string;cursorIdParam?:string},completedIntakes?:string):string{
  const ticketRelated=relatedOnly?' AND '+buildBranchScopeSql({kind:'ticket',idExpr:'t.id',intakeIdExpr:'t.source_intake_id',ticketAssigneeExpr:'t.assignee_id',includeFollow,nowEpochParam,nowLocalParam}):'';
  const reviewRelated=relatedOnly?' AND '+buildBranchScopeSql({kind:'review',idExpr:'r.id',intakeIdExpr:'r.service_intake_id',includeFollow,nowEpochParam,nowLocalParam}):'';
  const intakeRelated=relatedOnly?' AND '+buildBranchScopeSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',includeFollow,nowEpochParam,nowLocalParam}):'';
  if(column==='active'){
    const cursorFilter=hasCursor?` AND (date_trunc('second',t.updated_at),t.id)<(${cursorAtParam},${cursorIdParam})`:'';
    return `SELECT 0::integer AS order_group,date_trunc('second',t.updated_at) AS order_at,'ticket'::text AS kind,t.id,t.source_intake_id AS intake_id,t.status
 FROM pilot_ticket.ticket t
 WHERE t.status=ANY(ARRAY[${TICKET_ACTIVE_STATUSES.map(s=>`'${s}'`).join(',')}]::text[])
   AND t.status NOT IN ('RESOLVED','COMPLETED','DISMISSED')
   AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))${ticketRelated}${cursorFilter}
 ORDER BY date_trunc('second',t.updated_at) DESC,t.id DESC LIMIT ${limitParam}`;
  }
  if(column==='pending'){
    const ticketCursor=hasCursor?(cursorKind==='ticket'?` AND (date_trunc('second',t.updated_at),t.id)<(${cursorAtParam},${cursorIdParam})`:` AND date_trunc('second',t.updated_at)<${cursorAtParam}`):'';
    const reviewCursor=hasCursor?(cursorKind==='ticket'?` AND date_trunc('second',r.updated_at)<=${cursorAtParam}`:cursorKind==='review'?` AND (date_trunc('second',r.updated_at),r.id)<(${cursorAtParam},${cursorIdParam})`:` AND date_trunc('second',r.updated_at)<${cursorAtParam}`):'';
    const intakeCursor=hasCursor?(cursorKind==='intake'?` AND (date_trunc('second',i.updated_at),i.id)<(${cursorAtParam},${cursorIdParam})`:` AND date_trunc('second',i.updated_at)<=${cursorAtParam}`):'';
    return `SELECT order_group,order_at,kind,id,intake_id,status FROM (
 (SELECT 0::integer AS order_group,date_trunc('second',t.updated_at) AS order_at,'ticket'::text AS kind,t.id,t.source_intake_id AS intake_id,t.status
  FROM pilot_ticket.ticket t
  WHERE t.status=ANY(ARRAY[${TICKET_PENDING_STATUSES.map(s=>`'${s}'`).join(',')}]::text[])
    AND t.status NOT IN ('RESOLVED','COMPLETED','DISMISSED')
    AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))${ticketRelated}${ticketCursor}
  ORDER BY date_trunc('second',t.updated_at) DESC,t.id DESC LIMIT ${limitParam})
 UNION ALL
 (SELECT 0::integer,date_trunc('second',r.updated_at),'review'::text,r.id,r.service_intake_id,'PENDING'::text
  FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id
  JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
  WHERE ${REVIEW_ELIGIBLE_WHERE_SQL(nowEpochParam,nowLocalParam)}${reviewRelated}${reviewCursor}
  ORDER BY date_trunc('second',r.updated_at) DESC,r.id DESC LIMIT ${limitParam})
 UNION ALL
 (SELECT 0::integer,date_trunc('second',i.updated_at),'intake'::text,i.id,i.id,i.status
  FROM intake.service_intake i
  WHERE ${standaloneIntakePredicateSql(nowLocalParam,'$1::boolean',TICKET_SOURCE_PROBE_SQL)}
    AND i.status=ANY(ARRAY[${INTAKE_PENDING_STATUSES.map(s=>`'${s}'`).join(',')}]::text[])${intakeRelated}${intakeCursor}
  ORDER BY date_trunc('second',i.updated_at) DESC,i.id DESC LIMIT ${limitParam})
) pending_keys ORDER BY order_group DESC,order_at DESC,kind DESC,id DESC LIMIT ${limitParam}`;
  }
  const groupOneOnly=(!hasCursor||cursorOrderGroup===1);
  const ticketCursor=hasCursor&&cursorOrderGroup===1
    ?terminalTicketCursorSql(cursorKind,cursorAtParam,cursorIdParam)
    :'';
  const intakeDismissedCursor=hasCursor&&cursorOrderGroup===1
    ?(cursorKind==='intake'?` AND (date_trunc('second',intake_closure.ended_at),i.id)<(${cursorAtParam},${cursorIdParam})`:` AND date_trunc('second',intake_closure.ended_at)<=${cursorAtParam}`)
    :'';
  const intakeCompletedCursor=hasCursor
    ?`WHERE (order_group,order_at,kind,id)<(${cursorGroupParam},${cursorAtParam},${cursorKindParam},${cursorIdParam})`
    :'';
  const branches:string[]=[];
  if(groupOneOnly){
    branches.push(`(SELECT 1::integer AS order_group,t.terminal_at AS order_at,'ticket'::text AS kind,t.id,t.source_intake_id AS intake_id,t.status
  FROM pilot_ticket.ticket t
  WHERE t.status IN ('COMPLETED','DISMISSED')
    AND (${allRangeParam} OR (t.terminal_at>=${fromParam} AND t.terminal_at<${untilParam}))
    AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))${ticketRelated}${ticketCursor}
  ORDER BY t.terminal_at DESC,t.id DESC LIMIT ${limitParam})`);
    branches.push(`(SELECT 1::integer,t.terminal_at,'ticket'::text,t.id,t.source_intake_id,t.status
  FROM pilot_ticket.ticket t
  WHERE t.status='RESOLVED'
    AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))${ticketRelated}${ticketCursor}
  ORDER BY t.terminal_at DESC,t.id DESC LIMIT ${limitParam})`);
    branches.push(`(SELECT 1::integer,date_trunc('second',intake_closure.ended_at),'intake'::text,i.id,i.id,i.status
  FROM pilot_ticket.closure_record intake_closure JOIN intake.service_intake i ON i.id=intake_closure.intake_id
  WHERE intake_closure.subject_type='INTAKE' AND intake_closure.restored_at IS NULL
    AND i.status='DISMISSED' AND ${standaloneIntakePredicateSql(nowLocalParam)}
    AND (${allRangeParam} OR (intake_closure.ended_at>=${fromParam} AND intake_closure.ended_at<${untilParam}))${intakeRelated}${intakeDismissedCursor}
  ORDER BY date_trunc('second',intake_closure.ended_at) DESC,i.id DESC LIMIT ${limitParam})`);
  }
  const completed=completedIntakes??'('+completedIntakeKeysSql({relatedOnly,includeFollow,nowEpochParam,nowLocalParam,allRangeParam,fromParam,untilParam})+')';
  branches.push(`(SELECT order_group,order_at,kind,id,intake_id,status FROM ${completed} completed
    ${intakeCompletedCursor} ORDER BY order_group DESC,order_at DESC,id DESC LIMIT ${limitParam})`);
  return `SELECT order_group,order_at,kind,id,intake_id,status FROM (\n ${branches.join('\n UNION ALL\n ')}\n) handled_keys ORDER BY order_group DESC,order_at DESC,kind DESC,id DESC LIMIT ${limitParam}`;
}

interface BoardKeysQuery {
  sql:string;
  values:unknown[];
  handled?:Pick<NonNullable<WorkbenchReadAccess['groupCounts']>,'completedIntakesSql'|'pageKeysSql'|'countsSql'>;
}

/** Builds board key SQL + contiguous $6..$N parameter array matching only referenced placeholders. */
export function buildBoardKeysQuery({column,relatedOnly,includeFollow,allRange,from,until,limit,cursor}:{column:BoardColumn;relatedOnly:boolean;includeFollow:boolean;allRange:boolean;from:string;until:string;limit:number;cursor:{order_group:number;at:string;kind:string;id:string}|null}):BoardKeysQuery{
  if(column==='handled'){
    const values:unknown[]=[allRange,from,until,limit];
    if(cursor)values.push(cursor.order_group,cursor.at,cursor.kind,cursor.id);
    const completedIntakesSql=completedIntakeKeysSql({relatedOnly,includeFollow},{allRange});
    const relation='handled_completed_intakes';
    const pageKeysSql=buildBoardKeysSql({
      column,relatedOnly,includeFollow,hasCursor:Boolean(cursor),
      ...(cursor?{cursorOrderGroup:cursor.order_group,cursorKind:cursor.kind}:{}),
    },relation);
    let selectionCompleted=completedIntakesSql;
    if(allRange&&!relatedOnly&&(!cursor||cursor.order_group===1)){
      // K authorized terminal tickets after the cursor put a lower bound on this page's group-one time.
      // A completed Intake can compete only with a RESOLVED review at or after that second (ties included).
      // Without K tickets, group zero may enter the page and the full cohort is required.
      const ticketCursor=cursor?terminalTicketCursorSql(cursor.kind,'$11::timestamp without time zone','$13::uuid'):'';
      const floor='(SELECT terminal_at FROM ticket_page_floor)';
      const candidates=`SELECT DISTINCT r.service_intake_id FROM intake.manual_review_item r
        WHERE r.status='RESOLVED' AND r.resolved_at>=${floor}`;
      const contenders=completedIntakeKeysSql({relatedOnly,includeFollow},{candidates});
      selectionCompleted=`WITH ticket_page_floor AS MATERIALIZED (
        SELECT t.terminal_at FROM pilot_ticket.ticket t WHERE t.status IN ('COMPLETED','DISMISSED')
          AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[])) ${ticketCursor}
        ORDER BY t.terminal_at DESC,t.id DESC LIMIT 1 OFFSET ($9::integer-1)
      ) SELECT * FROM (${contenders}) ranked WHERE ${floor} IS NOT NULL AND ranked.order_group=1 AND ranked.order_at>=${floor}
        UNION ALL SELECT * FROM (${completedIntakesSql}) unbounded WHERE ${floor} IS NULL`;
    }
    return {
      sql:`WITH ${relation} AS (${selectionCompleted}) ${pageKeysSql}`,values,
      handled:{
        completedIntakesSql,countsSql:buildHandledGroupCountsSql({relatedOnly,includeFollow},relation),
        pageKeysSql,
      },
    };
  }
  const values:unknown[]=[limit];
  if(cursor)values.push(cursor.at,cursor.id);
  const sql=buildBoardKeysSql({
    column,relatedOnly,includeFollow,hasCursor:Boolean(cursor),
    ...(cursor?{cursorKind:cursor.kind}:{}),
    limitParam:'$6::integer',
    ...(cursor?{cursorAtParam:'$7::timestamp without time zone',cursorIdParam:'$8::uuid'}:{}),
  });
  return {sql,values};
}

/** Enriches at most limit+1 rows returned by buildBoardKeysSql. */
export function buildEnrichSelectedCardsSql(keysCteName:string,nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone'):string{
  return `SELECT k.kind AS key_kind,k.id::text AS key_id,k.order_group,to_char(k.order_at,'YYYY-MM-DD HH24:MI:SS') AS order_at,
   reader.id IS NOT NULL AS reader_valid,card.*
 FROM ${keysCteName} k
 LEFT JOIN (${currentItemReaderSql('$2::uuid')}) reader ON TRUE
 LEFT JOIN LATERAL (
   ${ticketCardSelectSql(nowEpochParam,nowLocalParam,'full',liveReader)} WHERE k.kind='ticket' AND t.id=k.id
     AND ${ticketReadSql('t',boundReader)} AND ${ticketReadSql('t',liveReader)}
   UNION ALL
   ${reviewCardSelectSql()} WHERE k.kind='review' AND r.id=k.id AND ${ticketReadSql('t',liveReader)}
   UNION ALL
   ${intakeCardSelectSql(nowEpochParam)} WHERE k.kind='intake' AND i.id=k.id AND reader.broad
 ) card ON TRUE
 ORDER BY k.order_group DESC,k.order_at DESC,k.kind DESC,k.id DESC`;
}

/** Lightweight aggregate for handled column group_counts without LATERAL enrichment. */
export function buildHandledGroupCountsSql({relatedOnly,includeFollow,nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone',allRangeParam='$6::boolean',fromParam='$7::timestamp without time zone',untilParam='$8::timestamp without time zone'}:HandledScope,completedIntakes?:string):string{
  const completed=completedIntakes??'('+completedIntakeKeysSql({relatedOnly,includeFollow,nowEpochParam,nowLocalParam,allRangeParam,fromParam,untilParam})+')';
  const ticketRelated=relatedOnly?' AND '+buildBranchScopeSql({kind:'ticket',idExpr:'t.id',intakeIdExpr:'t.source_intake_id',ticketAssigneeExpr:'t.assignee_id',includeFollow,nowEpochParam,nowLocalParam}):'';
  const intakeRelated=relatedOnly?' AND '+buildBranchScopeSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',includeFollow,nowEpochParam,nowLocalParam}):'';
  return `SELECT jsonb_build_object(
   'completed',(
     (SELECT count(*) FROM pilot_ticket.ticket t WHERE t.status='RESOLVED'
       AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))${ticketRelated})
     +(SELECT count(*) FROM pilot_ticket.ticket t WHERE t.status='COMPLETED'
       AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
       AND (${allRangeParam} OR (t.terminal_at>=${fromParam} AND t.terminal_at<${untilParam}))${ticketRelated})
     +(SELECT count(*) FROM ${completed} completed)
   )::integer,
   'dismissed',(
     (SELECT count(*) FROM pilot_ticket.ticket t WHERE t.status='DISMISSED'
       AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
       AND (${allRangeParam} OR (t.terminal_at>=${fromParam} AND t.terminal_at<${untilParam}))${ticketRelated})
     +CASE WHEN $1::boolean THEN (SELECT count(*) FROM pilot_ticket.closure_record intake_closure JOIN intake.service_intake i ON i.id=intake_closure.intake_id
       WHERE intake_closure.subject_type='INTAKE' AND intake_closure.restored_at IS NULL
         AND i.status='DISMISSED' AND ${standaloneIntakePredicateSql(nowLocalParam)}
         AND (${allRangeParam} OR (intake_closure.ended_at>=${fromParam} AND intake_closure.ended_at<${untilParam}))${intakeRelated}) ELSE 0 END
   )::integer
  )`;
}

/** PK-targeted card CTE for already-selected items ($6::jsonb = [{kind,id,intake_id}]). */
// Card 42A: each branch is driven by primary key from the requested set (an index condition via ARRAY(...)).
// A JOIN to requested_cards after the card select's many outer joins exceeds join_collapse_limit and would
// enrich every ticket before filtering (measured ~350 ms on 50k tickets).
export function buildTargetedCardsSql(requestedJsonParam='$6::jsonb',nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone',fields:'full'|'projection'='full'):string{
  return `WITH requested_cards AS (
  SELECT DISTINCT kind,id::uuid AS id,intake_id::uuid AS intake_id
    FROM jsonb_to_recordset(${requestedJsonParam}) AS req(kind text,id text,intake_id text)
), cards AS (
 ${ticketCardSelectSql(nowEpochParam,nowLocalParam,fields)}
 WHERE t.id=ANY(ARRAY(SELECT req.id FROM requested_cards req WHERE req.kind='ticket'))
   AND EXISTS(SELECT 1 FROM requested_cards req WHERE req.kind='ticket' AND req.id=t.id AND req.intake_id=t.source_intake_id)
   AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
 UNION ALL
 ${reviewCardSelectSql(fields)}
 WHERE r.id=ANY(ARRAY(SELECT req.id FROM requested_cards req WHERE req.kind='review'))
   AND EXISTS(SELECT 1 FROM requested_cards req WHERE req.kind='review' AND req.id=r.id AND req.intake_id=r.service_intake_id)
   AND ${REVIEW_ELIGIBLE_WHERE_SQL(nowEpochParam,nowLocalParam)}
 UNION ALL
 ${intakeCardSelectSql(nowEpochParam,fields)}
 WHERE i.id=ANY(ARRAY(SELECT req.id FROM requested_cards req WHERE req.kind='intake' AND req.intake_id=req.id))
   AND ${standaloneIntakePredicateSql(nowLocalParam)}
   AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED')
)`;
}

export function targetedProjectionSql():string{
  return buildTargetedCardsSql('$6::jsonb','$4::bigint','$5::timestamp without time zone','projection');
}

/** PK-targeted card query by kind+id ($6::jsonb = [{kind,id}]) without requiring intake_id upfront. */
export function buildTargetedCardsByIdsSql(requestedJsonParam='$6::jsonb',nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone',fields:'full'|'freshness'='full'):string{
  return `WITH requested_cards AS (
  SELECT DISTINCT kind,id::uuid AS id
    FROM jsonb_to_recordset(${requestedJsonParam}) AS req(kind text,id text)
), cards AS (
 ${ticketCardSelectSql(nowEpochParam,nowLocalParam,fields)}
 WHERE t.id=ANY(ARRAY(SELECT req.id FROM requested_cards req WHERE req.kind='ticket'))
   AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
 UNION ALL
 ${reviewCardSelectSql(fields)}
 WHERE r.id=ANY(ARRAY(SELECT req.id FROM requested_cards req WHERE req.kind='review'))
   AND ${REVIEW_ELIGIBLE_WHERE_SQL(nowEpochParam,nowLocalParam)}
 UNION ALL
 ${intakeCardSelectSql(nowEpochParam,fields)}
 WHERE i.id=ANY(ARRAY(SELECT req.id FROM requested_cards req WHERE req.kind='intake'))
   AND ${standaloneIntakePredicateSql(nowLocalParam)}
   AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED')
)`;
}

const CARD_SIGNATURE_SQL=`encode(sha256(convert_to(jsonb_build_array(${EXTRA_CARD_FIELDS.map(field=>'cards.'+field).join(',')})::text,'UTF8')),'hex')`;

/**
 * Signature of the canonical fields not already signed in the matched search row
 * for the given targets, as a jsonb object {"kind:id": sha256}. The canonical $1..$6 slots are re-bound on the
 * caller's parameter builder so the fragment can be embedded in any statement.
 */
export function buildCardSignaturesSql(pb:SqlParamBuilder,predicateValues:readonly unknown[],targets:readonly {kind:string;id:string}[]):string{
  const slots:Readonly<Record<string,string>>={
    '1':pb.once('isAdmin',predicateValues[0],'boolean'),'2':pb.once('principalId',predicateValues[1],'uuid'),'3':pb.once('teamIds',predicateValues[2],'text[]'),
    '4':FINAL_EPOCH_SQL,'5':FINAL_LOCAL_SQL,
    '6':pb.add(JSON.stringify(targets.map(({kind,id})=>({kind,id}))),'jsonb'),
  };
  const sql=buildTargetedCardsByIdsSql('$6::jsonb',FINAL_EPOCH_SQL,FINAL_LOCAL_SQL,'freshness')+` SELECT COALESCE(jsonb_object_agg(cards.kind||':'||cards.id,${CARD_SIGNATURE_SQL}),'{}'::jsonb) FROM cards`;
  return '('+sql.replace(/\$([1-6])(?![0-9])/gu,(token,index:string)=>slots[index]??token)+')';
}
function itemIntakeEligibilitySql(nowLocal:string,isAdmin:string,includeRetained:boolean):string {
  const normal=`(${standaloneIntakePredicateSql(nowLocal,isAdmin)}
    AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED'))`;
  return includeRetained?`(${normal} OR (${isAdmin} AND ${retainedClosedIntakePredicate(nowLocal)}))`:normal;
}

/** Single-item branch query using typed UUID and executing only the requested kind branch. */
export function buildSingleCardSql(kind:'ticket'|'review'|'intake',idParam?:string,nowEpochParam?:string,nowLocalParam?:string,scope:typeof boundReader|string=boundReader,includeRetained=false):string{
  const reader=typeof scope==='string'?{...boundReader,broad:scope}:scope;
  if(kind==='ticket'){
    return `${ticketCardSelectSql(nowEpochParam??'$4::bigint',nowLocalParam??'$5::timestamp without time zone','full',reader)}
 WHERE t.id=${idParam??'$6::uuid'} AND ${ticketReadSql('t',reader)}`;
  }
  if(kind==='review'){
    return `${reviewCardSelectSql()}
 WHERE r.id=${idParam??'$6::uuid'} AND ${REVIEW_ELIGIBLE_WHERE_SQL(nowEpochParam??'$4::bigint',nowLocalParam??'$5::timestamp without time zone',reader)}`;
  }
  return `${intakeCardSelectSql(nowEpochParam??'$2::bigint')}
 WHERE i.id=${idParam??'$4::uuid'} AND ${itemIntakeEligibilitySql(nowLocalParam??'$3::timestamp without time zone',reader.broad,includeRetained)}`;
}

// Resolve exactly one key before executing the matching CASE arm. All joins,
// retention checks and card fields use this statement's snapshot and clock.
function reviewItemCardSql():string {
  const routeReader={broad:'route.broad',id:'route.reader_id',teams:'route.teams'};
  const project=(kind:'ticket'|'review'|'intake')=>{
    const branch=buildSingleCardSql(kind,'route.id',FINAL_EPOCH_SQL,FINAL_LOCAL_SQL,routeReader,true);
    return `(SELECT row_to_json(projected) FROM (${branch} LIMIT 1) projected)`;
  };
  return `WITH review_item_route AS MATERIALIZED (
    ${currentReviewRouteSql('$2::uuid','$1::uuid',FINAL_EPOCH_SQL,FINAL_LOCAL_SQL)}
  )
  SELECT route.roles,route.teams,CASE route.kind
    WHEN 'ticket' THEN ${project('ticket')}
    WHEN 'review' THEN ${project('review')}
    WHEN 'intake' THEN ${project('intake')}
  END AS projected_card FROM review_item_route route`;
}

function canonicalLabelsSql(kind:'ticket'|'review'|'intake'):string {
  return kind==='ticket'?',t.ticket_no AS number,t.title':",i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title";
}

/** Lightweight single-item readability check (zero LATERAL profile/review/closure joins). */
export function buildSingleItemReadableSql(kind:'ticket'|'review'|'intake',idParam:string,intakeIdParam:string|null=null,nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone',scopeParams:{isAdmin?:string;principalId?:string;teamIds?:string;summary?:boolean;includeRetained?:boolean}={}):string{
  const isAdmin=scopeParams.isAdmin??'$1::boolean';
  const principalId=scopeParams.principalId??'$2::uuid';
  const teamIds=scopeParams.teamIds??'$3::text[]';
  const labels=scopeParams.summary?canonicalLabelsSql(kind):'';
  if(kind==='ticket'){
    return `SELECT t.id,t.source_intake_id AS intake_id${labels} FROM pilot_ticket.ticket t
 WHERE t.id=${idParam}${intakeIdParam?` AND t.source_intake_id=${intakeIdParam}`:''}
   AND (${isAdmin} OR t.assignee_id=${principalId} OR t.resolver_team_id=ANY(${teamIds}))`;
  }
  if(kind==='review'){
    return `SELECT r.id,r.service_intake_id AS intake_id${labels} FROM intake.manual_review_item r
 JOIN intake.service_intake i ON i.id=r.service_intake_id
 JOIN intake.contact_journey j ON j.id=r.journey_id
 LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
 WHERE r.id=${idParam}${intakeIdParam?` AND r.service_intake_id=${intakeIdParam}`:''}
   AND r.status='PENDING' AND i.retention_until>${nowLocalParam}
   AND j.retention_until_epoch_ms>${nowEpochParam}
   AND (${isAdmin} OR t.assignee_id=${principalId} OR t.resolver_team_id=ANY(${teamIds}))
   AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=r.service_intake_id)
   AND (r.linked_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=r.linked_ticket_id))
   AND (j.linked_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=j.linked_ticket_id))
   AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item earlier
     WHERE earlier.service_intake_id=r.service_intake_id AND earlier.status='PENDING'
       AND (earlier.created_at,earlier.id)<(r.created_at,r.id))`;
  }
  return `SELECT i.id,i.id AS intake_id${labels} FROM intake.service_intake i
 WHERE i.id=${idParam}${intakeIdParam?` AND i.id=${intakeIdParam}`:''}
   AND ${itemIntakeEligibilitySql(nowLocalParam,isAdmin,scopeParams.includeRetained===true)}`;
}

/** Lightweight key+visibility CTE for reminders (no LATERAL profile, review, or closure enrichment). */
export function buildLightweightCardsCteSql(nowEpochParam='$4::bigint',nowLocalParam='$5::timestamp without time zone'):string{
  return `cards AS (
 SELECT 'ticket'::text AS kind,t.id::text,t.source_intake_id::text AS intake_id,t.status
   FROM pilot_ticket.ticket t
  WHERE t.id=ANY(ARRAY(SELECT id FROM window_targets WHERE kind='ticket'))
    AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
 UNION ALL
 SELECT 'review'::text,r.id::text,r.service_intake_id::text,'PENDING'::text
   FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id
   JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
  WHERE r.id=ANY(ARRAY(SELECT id FROM window_targets WHERE kind='review'))
    AND ${REVIEW_ELIGIBLE_WHERE_SQL(nowEpochParam,nowLocalParam)}
 UNION ALL
 SELECT 'intake'::text,i.id::text,i.id::text,i.status
   FROM intake.service_intake i
  WHERE i.id=ANY(ARRAY(SELECT id FROM window_targets WHERE kind='intake'))
    AND ${standaloneIntakePredicateSql(nowLocalParam)}
    AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED')
)`;
}

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
function retainedClosedIntakePredicate(nowLocal:string):string{
  return `i.retention_until>${nowLocal}
          AND i.status IN ('COMPLETED','DISMISSED')
          AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id)
          AND (i.pilot_ticket_id IS NULL OR NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket t WHERE t.id=i.pilot_ticket_id))
          AND NOT EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
            JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id WHERE l.source_intake_id=i.id)`;
}
export const CLOSED_INTAKE_CARD_SQL=intakeCardSelectSql('$2::bigint')+' WHERE i.id=$1::uuid AND '+retainedClosedIntakePredicate('$3::timestamp without time zone');
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
  async function decorate(items:WorkbenchCard[],authContext?:unknown,includeWebReports=true,page:'board'|'search'|false=false,skipRecheck=false,readerId?:string):Promise<WorkbenchCard[]>{
    if(!items.length)return items;
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
      const p=await scope(authContext);
      const relationRows=(await pool.query<CardRelationRow>(
        withCurrentCardReader(finalCardReadSql(targetedProjectionSql()+' SELECT kind,id,('+HANDLING_CARD_SQL+') AS handling,('+COMMUNICATION_CARD_SQL+') AS communication FROM cards')),
        [p.principal.principal_id,JSON.stringify(sourced.map(({kind,id,intake_id})=>({kind,id,intake_id})))],
      )).rows;
      const relationMap=new Map(relationRows.map(row=>[row.kind+':'+row.id,row]));
      const inputs:{item:WorkbenchCard;reasons:('HANDLING'|'COMMUNICATION')[]}[]=sourced.map(item=>{
        const relation=relationMap.get(item.kind+':'+item.id);
        const reasons:('HANDLING'|'COMMUNICATION')[]=[];
        if(relation?.handling)reasons.push('HANDLING');
        if(relation?.communication)reasons.push('COMMUNICATION');
        return {item,reasons};
      });
      const attention:Awaited<ReturnType<FollowProjectionPort['attention']>>[]=[];
      for(const {item,reasons} of inputs)attention.push(await follow.attention({authContext,kind:item.kind,id:item.id},item,reasons));
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
    const recheckReason=!page&&sourced.some(item=>item.kind==='ticket'&&item.review_reason!==null);
    if(page&&follow&&authContext!==undefined){
      const attention=await follow.attentionMany(authContext,sourced,page);
      sourced=sourced.map((item,index)=>{const value=attention[index];if(!value)failP2016('ACTION_FAILED',503);return {...item,attention:value};});
    }else if(!skipRecheck&&(page||recheckReason||reporterProfilesEnabled&&sourced.some(item=>item.kind==='ticket'))&&authContext!==undefined&&sourced.length){
      const principalId=readerId??(await query.principal(authContext)).principal_id;
      const reason=recheckReason?`,CASE WHEN cards.kind='ticket' THEN (${ticketReviewReasonSql('cards.id::uuid','cards.intake_id::uuid',FINAL_EPOCH_SQL,boundReader)}) END AS review_reason`:'';
      // Keep a valid reader's row even when none of the requested cards is readable.
      const current=await pool.query<{kind:string|null;id:string|null;review_reason?:string|null}>(withCurrentCardReader(
        finalCardReadSql(targetedProjectionSql()+' SELECT cards.kind,cards.id'+reason+' FROM card_reader LEFT JOIN cards ON TRUE')),
        [principalId,JSON.stringify(sourced.map(({kind,id,intake_id})=>({kind,id,intake_id})))]);
      if(!current.rows.length)failP2016('FORBIDDEN',403);
      if(current.rows[0]?.id===null||current.rows.length!==sourced.length)failP2016('NOT_FOUND',404);
      if(recheckReason){
        const reasons=new Map(current.rows.filter(row=>row.kind==='ticket').map(row=>[row.id,row.review_reason??null]));
        sourced=sourced.map(item=>item.kind==='ticket'&&item.review_reason!==null?{...item,review_reason:reasons.get(item.id)??null}:item);
      }
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
    // Keep physical_epoch_ms() here: sessionProof runs on the single-row final snapshot check after read waits.
    return {sql:`platform.physical_epoch_ms()<$${start}::bigint`,values:[expiry]};
  }
  async function rangeWithClock(mode: BoardCompletionRange,handledFrom?:string|null,handledTo?:string|null): Promise<{window:BoardPage['range'];clock:WorkbenchClock}> {
    if(mode==='custom'){
      let from:string,to:string;try{from=assertLocalDate(handledFrom);to=assertLocalDate(handledTo);}catch{failP2016();}
      if(from>to||to==='9999-12-31')failP2016();
      const result=await pool.query<{from:string;until:string;now_epoch:string;now_local:string}>(
        `SELECT to_char($1::date,'YYYY-MM-DD HH24:MI:SS') AS "from",to_char($2::date+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until,platform.physical_epoch_ms()::text AS now_epoch,to_char(platform.local_now(),'YYYY-MM-DD HH24:MI:SS') AS now_local`,[from,to]);
      const row=result.rows[0];if(!row)failP2016();
      return {window:{from:row.from,until:row.until,mode,timezone:'Asia/Shanghai'},clock:{nowEpoch:row.now_epoch,nowLocal:row.now_local}};
    }
    if(handledFrom!=null||handledTo!=null)failP2016();
    const r=await pool.query<{from:string;until:string;now_epoch:string;now_local:string}>(`WITH stamp AS (SELECT platform.physical_epoch_ms()::text AS now_epoch,platform.local_now() AS local_ts)
      SELECT to_char(date_trunc('day',stamp.local_ts)-interval '1 day','YYYY-MM-DD HH24:MI:SS') AS "from",
      to_char(date_trunc('day',stamp.local_ts)+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until,
      stamp.now_epoch,to_char(stamp.local_ts,'YYYY-MM-DD HH24:MI:SS') AS now_local FROM stamp`);
    const row=r.rows[0];if(!row)failP2016();
    return {window:{from:row.from,until:row.until,mode,timezone:'Asia/Shanghai'},clock:{nowEpoch:row.now_epoch,nowLocal:row.now_local}};
  }
  type ItemIdentity=Pick<WorkbenchCard,'kind'|'id'|'intake_id'>;
  function requireSameItem(selected:ItemIdentity,current:ItemIdentity):void {
    if(selected.kind!==current.kind||selected.id!==current.id||selected.intake_id!==current.intake_id)failP2016('VERSION_CONFLICT',409);
  }
  async function item(authContext: unknown,kind: string,id: unknown,includeWebReports=true): Promise<WorkbenchCard> {
    if(kind!=='ticket'&&kind!=='review'&&kind!=='intake')failP2016('NOT_FOUND',404);
    const principal=await query.principal(authContext);
    const typedId=uuidP2016(id);
    type ReaderFacts={roles:string[];teams:string[]};
    let row:CardRow|null|undefined,reader:ReaderFacts|undefined;
    const params=[principal.principal_id,typedId];
    if(kind==='review'&&manualReviewEnabled&&reviews){
      const result=await pool.query<ReaderFacts&{projected_card:CardRow|null}>(withFinalStatementClock(reviewItemCardSql()),params);
      const projected=result.rows[0];
      row=projected?.projected_card;reader=projected;
      if(!row||row.kind!=='review'||row.id!==typedId){
        // The statement chose the card. This check can veto it if the original
        // Review's material or route is no longer readable.
        const current=await routeIdentity(authContext,'review',typedId);
        if(row)requireSameItem(row,current);
      }
    }else{
      const branch=buildSingleCardSql(kind,'$2::uuid',FINAL_EPOCH_SQL,FINAL_LOCAL_SQL,liveReader,manualReviewEnabled);
      const sql=`SELECT projected.*,reader.roles,reader.teams FROM (${currentItemReaderSql('$1::uuid')}) reader
        CROSS JOIN LATERAL (${branch}) projected`;
      const result=await pool.query<CardRow&ReaderFacts>(withFinalStatementClock(sql),params);
      const projected=result.rows[0];row=projected;reader=projected;
    }
    if(!row||!reader){
      await query.principal(authContext);
      failP2016('NOT_FOUND',404);
    }
    const selected=card(row,{...principal,roles:reader.roles,team_ids:reader.teams});
    return (await decorate([selected],authContext,includeWebReports,false,false,principal.principal_id))[0]??selected;
  }
  type RouteRow={intake_id:string}&Partial<Pick<WorkbenchCard,'number'|'title'>>;
  async function routeIdentity(authContext:unknown,kind:string,id:unknown,summary=false):Promise<ItemIdentity&RouteRow>{
    if(kind!=='ticket'&&kind!=='review'&&kind!=='intake')failP2016('NOT_FOUND',404);
    const principal=await query.principal(authContext),typedId=uuidP2016(id);
    const readable=buildSingleItemReadableSql(kind,'$2::uuid',null,FINAL_EPOCH_SQL,FINAL_LOCAL_SQL,
      {isAdmin:liveReader.broad,principalId:liveReader.id,teamIds:liveReader.teams,summary,includeRetained:manualReviewEnabled});
    const direct=(await pool.query<RouteRow>(withFinalStatementClock(`SELECT candidate.* FROM (
      ${currentItemReaderSql('$1::uuid')}
    ) reader CROSS JOIN LATERAL (${readable}) candidate`),[principal.principal_id,typedId])).rows[0];
    if(direct)return {...direct,kind,id:typedId};
    // A deactivated or role-less principal receives the normal principal denial.
    await query.principal(authContext);
    if(kind==='review'&&manualReviewEnabled&&reviews){
      const route=await reviews.canonicalItem({authContext,reviewId:typedId});
      if(route.kind!==kind||route.id!==typedId)return routeIdentity(authContext,route.kind,route.id,summary);
    }
    failP2016('NOT_FOUND',404);
  }
  async function authorizedRoute(authContext:unknown,kind:string,id:unknown,summary:boolean){
    if(!follow)return routeIdentity(authContext,kind,id,summary);
    const basis=await routeIdentity(authContext,kind,id);
    await follow.checkRead({authContext,kind:basis.kind,id:basis.id},basis);
    const item=await routeIdentity(authContext,kind,id,summary);
    if(basis.kind!==item.kind||basis.id!==item.id||basis.intake_id!==item.intake_id)failP2016('VERSION_CONFLICT',409);
    return item;
  }
  function authorizedIdentity(authContext:unknown,kind:string,id:unknown):Promise<ItemIdentity>{
    return authorizedRoute(authContext,kind,id,false);
  }
  async function reviewReferences(authContext:unknown,selected:ItemIdentity){
    const principal=await query.principal(authContext);
    const refs=await pool.query<ReviewReference>(withFinalStatementClock(`SELECT r.id::text,r.status,r.row_version::text FROM (${currentItemReaderSql('$1::uuid')}) reader CROSS JOIN intake.manual_review_item r
      JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
      JOIN intake.service_intake i ON i.id=r.service_intake_id
      WHERE ($2='ticket' AND (r.service_intake_id=$3::uuid OR r.linked_ticket_id=$4::uuid OR j.linked_ticket_id=$4::uuid)
        OR $2<>'ticket' AND r.service_intake_id=$3::uuid)
        AND ${ticketReadSql('t',liveReader)} AND i.retention_until>${FINAL_LOCAL_SQL}
        AND j.retention_until_epoch_ms>${FINAL_EPOCH_SQL} ORDER BY r.created_at,r.id LIMIT 101`),
    [principal.principal_id,selected.kind,selected.intake_id,selected.id]);
    if(refs.rows.length>100)failP2016('REVIEW_SCOPE_TOO_LARGE',503);
    return refs.rows;
  }
  async function authorizedSummary(authContext:unknown,kind:string,id:unknown){
    const item=await authorizedRoute(authContext,kind,id,true);
    if(typeof item.number!=='string'||typeof item.title!=='string')failP2016('ACTION_FAILED',503);
    return {kind:item.kind,id:item.id,number:item.number,title:item.title};
  }
  async function readSearchCards(tx:PostgresTransaction,principal:WorkbenchPrincipal,clock:WorkbenchClock,targets:readonly {kind:string;id:string}[]) {
    if(!targets.length)return [];
    const scope=ticketPredicateP2016(principal);
    const result=await tx.query<CardRow&{card_signature:string}>(buildTargetedCardsByIdsSql()+
      ` SELECT cards.*,${CARD_SIGNATURE_SQL} AS card_signature FROM cards`,
      [...scope.values,clock.nowEpoch,clock.nowLocal,JSON.stringify(targets.map(({kind,id})=>({kind,id})))]);
    const byKey=new Map(result.rows.map(row=>[row.kind+':'+row.id,row]));
    return targets.map(target=>{
      const row=byKey.get(target.kind+':'+target.id);
      if(!row)failP2016('CURSOR_INVALID');
      return {item:card(row,principal),signature:row.card_signature};
    });
  }
  function decorateSearchCards(authContext:unknown,items:WorkbenchCard[],_clock?:WorkbenchClock){
    return decorate(items,authContext,false,'search',true);
  }
  /** Card 29 L6: search results carry the same read-only service and stage timing as board cards. */
  async function projectSearchItems(authContext:unknown,items:WorkbenchCard[],clock?:WorkbenchClock):Promise<WorkbenchCard[]>{
    if(!items.length)return items;
    const resolvedClock=clock??await readWorkbenchClock(pool);
    return readWorkbenchCardProjections(pool,CARD_SQL,{authority:()=>scope(authContext),session:start=>sessionProof(authContext,start),clock:resolvedClock,searchRoute:item=>authorizedIdentity(authContext,item.kind,item.id),targetedCardsSql:targetedProjectionSql()},items,serviceCatalog,manualReportsEnabled);
  }
  return Object.freeze({
    async authorizedItem(authContext:unknown,kind:string,id:unknown,includeWebReports=true,_clock?:WorkbenchClock){
      const selected=await item(authContext,kind,id,includeWebReports);
      if(kind==='review'&&(selected.kind!=='review'||selected.id!==uuidP2016(id))){
        requireSameItem(selected,await routeIdentity(authContext,kind,id));
      }
      return selected;
    },
    authorizedIdentity,
    authorizedSummary,
    async activityReviewReferences(authContext:unknown,item:ItemIdentity){
      const refs=await reviewReferences(authContext,item);
      const current=await authorizedIdentity(authContext,item.kind,item.id);
      if(current.kind!==item.kind||current.id!==item.id||current.intake_id!==item.intake_id)failP2016('VERSION_CONFLICT',409);
      await verifyWorkbenchReadAccess(pool,{authority:()=>scope(authContext),session:start=>sessionProof(authContext,start)});
      return refs;
    },
    readSearchCards,
    decorateSearchCards,
    decorateWebReportUrgency,
    projectSearchItems,
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
      if(!WEB01_COLUMNS.includes(column as BoardColumn)||!['recent','all','custom'].includes(mode))failP2016();
      const selectedColumn=column as BoardColumn,selectedRange=mode as BoardCompletionRange,custom=selectedRange==='custom';
      const {window,clock}=await rangeWithClock(selectedRange,input.handledFrom,input.handledTo),limit=limitP2016(input.limit??'50');
      const page=input.cursor?decodeCursorP2016(input.cursor,['v','principal','scope','column','range','from',...(custom?['until']:[]),'at','kind','id','order_group']):null;
      // Bind cursors to both filters and the current authorized scope, including a changed team/role.
      const scopeKey=JSON.stringify(workbenchFollowEnabled?[authorized.values,boardScope]:authorized.values);
      if(page&&(page.v!==(custom?2:1)||page.principal!==authorized.values[1]||page.scope!==scopeKey||page.column!==column||page.range!==mode||page.from!==window.from||custom&&page.until!==window.until))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,id=page?uuidP2016(page.id):null;
      if(page&&(typeof page.kind!=='string'||!['ticket','review','intake'].includes(page.kind)))failP2016('CURSOR_INVALID');
      if(page&&page.order_group!==0&&page.order_group!==1)failP2016('CURSOR_INVALID');
      if(follow&&!await follow.ready())failP2016('DISABLED',503);
      const relatedOnly=boardScope==='related',includeFollow=Boolean(follow);
      const allRange=selectedColumn!=='handled'||(selectedRange!=='recent'&&!custom);
      const keyCursor=page?{order_group:page.order_group as number,at:at as string,kind:page.kind as string,id:id as string}:null;
      const keyQuery=buildBoardKeysQuery({column:selectedColumn,relatedOnly,includeFollow,allRange,from:window.from,until:window.until,limit:limit+1,cursor:keyCursor});
      const pageSql=`WITH page_keys AS (\n${keyQuery.sql}\n)\n${buildEnrichSelectedCardsSql('page_keys')}`;
      type PageKey={key_kind:WorkbenchCard['kind'];key_id:string;order_at:string;order_group:number;reader_valid:boolean};
      const r=await pool.query<PageKey & (CardRow|{id:null})>(finalCardReadSql(pageSql),[...authorized.values,...keyQuery.values]);
      // Membership, complete totals and the limit+1 sentinel are re-read after decoration.
      const groupCounts:WorkbenchReadAccess['groupCounts']=keyQuery.handled?{
        ...keyQuery.handled,
        values:keyQuery.values,
        expectedPage:r.rows.map(({key_kind:kind,key_id:id,order_group,order_at})=>({kind,id,order_group,order_at})),
        value:null,
      }:undefined;
      const rows=r.rows.slice(0,limit),last=rows.at(-1);
      const selected=rows.map(row=>{
        if(!row.reader_valid)failP2016('FORBIDDEN',403);
        if(row.id===null)failP2016('NOT_FOUND',404);
        return card(row);
      });
      const decorated=await decorate(selected,input.authContext,true,'board',true);
      const items=await readWorkbenchCardProjections(pool,CARD_SQL,{authority:()=>scope(input.authContext),session:start=>sessionProof(input.authContext,start),clock,targetedCardsSql:targetedProjectionSql(),...(groupCounts?{groupCounts}:{})},decorated,serviceCatalog,manualReportsEnabled);
      const counts=groupCounts?.value;if(selectedColumn==='handled'&&!counts)failP2016('ACTION_FAILED',503);
      return publicP2016({items,column:selectedColumn,range:window,...(counts?{group_counts:counts}:{}),next_cursor:r.rows.length>limit&&last?cursorP2016({v:custom?2:1,
        principal:authorized.values[1],scope:scopeKey,column,range:mode,from:window.from,...(custom?{until:window.until}:{}),at:last.order_at,order_group:last.order_group,kind:last.key_kind,id:last.key_id}):null});
    },
    async detail({authContext,kind,id,cursor,limit}: {authContext:unknown;kind:string;id:unknown;cursor:unknown;limit:unknown}): Promise<WorkbenchDetail> {
      const clock=await readWorkbenchClock(pool);
      const selected=await item(authContext,kind,id,true),n=limitP2016(limit??'50');
      const page=cursor?decodeCursorP2016(cursor,['kind','id','at','record_id']):null;
      if(page&&(page.kind!==kind||page.id!==uuidP2016(id)))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,recordId=page?.record_id??null;
      if(page&&(typeof recordId!=='string'||recordId.length>100))failP2016('CURSOR_INVALID');
      // Known safe report text, not raw frames, identity tokens, arbitrary payloads or delivery metadata.
      const report=await pool.query<{source_provider:string}>(`SELECT source_provider FROM intake.service_intake
        WHERE id=$1::uuid AND retention_until>$2::timestamp without time zone`,[selected.intake_id,clock.nowLocal]);
      const web=report.rows[0]?.source_provider==='YIXIAOXIU_WEB';
      const manual=personalReadEnabled&&manualReportsEnabled&&report.rows[0]?.source_provider==='STAFF_MANUAL_REPORT'?await readManualReportSource(pool,selected.intake_id):null;
      const manualRecords=manual?`UNION ALL
        SELECT 'manual:'||i.id::text,to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS'),'报修原文',i.manual_report_snapshot->>'description',
          'REPORT',NULL,NULL,NULL,'manual:'||i.id::text,'1'::text,NULL::text FROM intake.service_intake i
        WHERE i.id IN (SELECT id FROM retained_intake) AND i.source_provider='STAFF_MANUAL_REPORT' AND i.source_channel='MANUAL'` : '';
      const webRecords=web?`UNION ALL
        SELECT 'web:'||s.id::text,to_char(s.received_at,'YYYY-MM-DD HH24:MI:SS'),
          CASE WHEN s.kind='SUBMIT' THEN '报修原文' ELSE '报修补充' END,
          CASE WHEN s.kind='SUBMIT' THEN s.safe_content->>'description' ELSE s.safe_content->>'text' END,
          'REPORT',NULL,NULL,NULL,${personalReadEnabled?"'web:'||s.id::text,s.input_revision::text":"NULL::text,NULL::text"},NULL::text FROM intake.web_submission s
        JOIN intake.web_request_binding b ON b.intake_id=s.intake_id
        WHERE s.intake_id IN (SELECT id FROM retained_intake WHERE source_provider='YIXIAOXIU_WEB') AND b.revoked_at IS NULL AND b.retention_until>${FINAL_LOCAL_SQL}
          AND s.retention_until>${FINAL_LOCAL_SQL}` : '';
      const recordsSql=`WITH retained_intake AS (
        SELECT id,summary,source_provider FROM intake.service_intake WHERE id=$1::uuid AND retention_until>${FINAL_LOCAL_SQL}
      ), readable_intakes AS (
        SELECT id FROM retained_intake
        UNION SELECT i.id FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id
        JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE $2='ticket' AND j.linked_ticket_id=$3::uuid
          AND j.retention_until_epoch_ms>${FINAL_EPOCH_SQL} AND i.retention_until>${FINAL_LOCAL_SQL}
      ), records AS (
        SELECT 'message:'||m.id::text AS id,to_char(rel.linked_at,'YYYY-MM-DD HH24:MI:SS') AS at,
          CASE WHEN rel.intake_id=$1::uuid AND rel.relation_type='PRIMARY' THEN '报修原文' ELSE '报修补充' END AS type,
          m.clean_text AS text,'REPORT'::text AS audience,NULL::text AS actor,NULL::text AS old_status,NULL::text AS new_status,
          ${personalReadEnabled?"CASE WHEN i.source_provider='WECOM_AIBOT' THEN 'channel:'||m.id::text END":"NULL::text"} AS material_source_ref,
          ${personalReadEnabled?"CASE WHEN i.source_provider='WECOM_AIBOT' THEN rel.sequence_no::text END":"NULL::text"} AS material_revision,NULL::text AS actor_ref
        FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        JOIN intake.service_intake i ON i.id=rel.intake_id
        WHERE rel.intake_id IN (SELECT id FROM readable_intakes) AND i.retention_until>${FINAL_LOCAL_SQL} AND m.retention_until>${FINAL_LOCAL_SQL}
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
      ), page AS (SELECT * FROM records WHERE ($4::text IS NULL OR (at,id)<($4::text,$5::text))
        ORDER BY at DESC,id DESC LIMIT $6)`;
      // The legacy responsibility view retains history. Filter current ownership
      // before its bounded result, without changing historical assignment facts.
      const responsibility=selected.kind==='ticket'?await query.responsibility({authContext,ticketId:selected.id,currentConversationsOnly:true}):null;
      const names: string[]=[];
      if(responsibility&&Array.isArray(responsibility.conversations))for(const conversation of responsibility.conversations){
        if(typeof conversation.conversation_principal_name==='string')names.push(conversation.conversation_principal_name);
      }
      const reviewRefs=manualReviewEnabled?await reviewReferences(authContext,selected):undefined;
      const reportedSql=web?`SELECT to_char(s.received_at,'YYYY-MM-DD HH24:MI:SS') AS at
        FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id
        JOIN intake.web_submission s ON s.intake_id=i.id AND s.kind='SUBMIT'
        WHERE i.id=$1::uuid AND i.retention_until>${FINAL_LOCAL_SQL}
          AND b.revoked_at IS NULL AND b.retention_until>${FINAL_LOCAL_SQL} AND s.retention_until>${FINAL_LOCAL_SQL}
        ORDER BY s.input_revision LIMIT 1`:`SELECT to_char(CASE WHEN i.source_provider='STAFF_MANUAL_REPORT' THEN i.created_at ELSE m.received_at END,'YYYY-MM-DD HH24:MI:SS') AS at
        FROM intake.service_intake i LEFT JOIN channel.message_inbox m ON m.id=i.primary_message_id AND m.retention_until>${FINAL_LOCAL_SQL}
        WHERE i.id=$1::uuid AND i.retention_until>${FINAL_LOCAL_SQL}`;
      const detailSource:NonNullable<WorkbenchReadAccess['detailSource']>={
        // JSON preserves the record column order of the original detail response.
        sql:recordsSql+` SELECT json_build_object('description',(SELECT summary FROM retained_intake),
          'reported_at',(${reportedSql}),'records',COALESCE((SELECT json_agg(row_to_json(page) ORDER BY at DESC,id DESC) FROM page),'[]'::json))`,
        values:[selected.intake_id,selected.kind,selected.id,at,recordId,n+1],value:null,
        ...(follow&&kind==='review'?{reviewIds:[...new Set([uuidP2016(id),...(selected.kind==='review'?[selected.id]:[])])]}:{}),
      };
      const projected=(await readWorkbenchCardProjections(pool,CARD_SQL,{authority:()=>scope(authContext),session:start=>sessionProof(authContext,start),clock,detailSource,targetedCardsSql:targetedProjectionSql(),finalRouteCheck:async()=>{
        const current=await authorizedIdentity(authContext,kind,id);
        requireSameItem(selected,current);
      }},[selected],serviceCatalog,manualReportsEnabled))[0];
      if(!projected)failP2016('NOT_FOUND',404);
      if(!detailSource.value)failP2016('ACTION_FAILED',503);
      const {description,reported_at,records}=detailSource.value;
      const items=records.slice(0,n).map(({material_source_ref,material_revision,actor_ref,...record})=>{
        if(record.id.startsWith('manual:')){
          if(!manual||record.text?.trim()!==manual.report.description)failP2016('VERSION_CONFLICT',409);
          record.text=manual.report.description;
        }
        return {...record,...(actorAvatarsEnabled?{actor_ref:actor_ref??null}:{}),
          ...(material_source_ref&&material_revision?{read_material:{source_ref:material_source_ref,revision:material_revision}}:{})};
      });
      const last=items.at(-1);
      return publicP2016({item:projected,description,reported_at,records:items,
        next_cursor:records.length>n&&last?cursorP2016({kind,id:uuidP2016(id),at:last.at,record_id:last.id}):null,
        responsibility:{ticket_assignee_name:selected.assignee_name,conversation_assignees:[...new Set(names)]},...(reviewRefs?{review_refs:reviewRefs}:{}),
        ...(selected.kind!==kind||selected.id!==id?{requested_item:{kind:kind as WorkbenchCard['kind'],id:uuidP2016(id)}}:{})});
    },
  });
}

// Internal SQL seams preserve the original authorized canonical relation and responsibility predicates.
export {CARD_SQL as WEB01_AUTHORIZED_CARDS_SQL,HANDLING_CARD_SQL,COMMUNICATION_CARD_SQL};
export type {CardRow as Web01CardRow};
