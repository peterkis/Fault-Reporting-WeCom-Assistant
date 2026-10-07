import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail, WorkbenchRecord } from '../contracts/web01_workbench_contracts.js';
import { ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
import { failP2016, uuidP2016, localP2016, limitP2016, cursorP2016, decodeCursorP2016, publicP2016 } from './p2-016-domain-contracts.mjs';

export const WEB01_COLUMNS: readonly BoardColumn[] = ['pending', 'active', 'closed'];
export function boardColumn(status: string): BoardColumn {
  if (['NEW', 'QUEUED', 'ACCEPTED', 'REOPENED', 'PENDING', 'RECEIVED', 'WAITING_DESCRIPTION', 'WAITING_TRIAGE', 'FAILED'].includes(status)) return 'pending';
  if (['IN_PROGRESS', 'WAITING_REQUESTER', 'WAITING_VENDOR'].includes(status)) return 'active';
  if (['RESOLVED', 'CLOSED', 'CANCELLED', 'DUPLICATE_LINKED'].includes(status)) return 'closed';
  failP2016();
}
interface CardRow extends Omit<WorkbenchCard, 'column'> { sort_at: string }
interface Input { authContext: unknown; column: string | null; range: string | null; cursor: unknown; limit: unknown }
const CARD_SQL = `WITH cards AS (
 SELECT 'ticket'::text AS kind,t.id::text,t.source_intake_id::text AS intake_id,t.ticket_no AS number,
   t.title,t.status,t.priority,t.reported_location_text AS location,profile.name AS reporter_name,
   COALESCE(i.source_channel,'未提供') AS source,p.display_name AS assignee_name,
   review.review_reason_code AS review_reason,
   to_char(t.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
   to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
   to_char(ended.at,'YYYY-MM-DD HH24:MI:SS') AS completed_at,
   to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at
 FROM pilot_ticket.ticket t
 LEFT JOIN intake.service_intake i ON i.id=t.source_intake_id AND i.retention_until>platform.local_now()
 LEFT JOIN pilot_ticket.pilot_principal p ON p.id=t.assignee_id
 LEFT JOIN LATERAL (SELECT j.profile_snapshot->'contact'->>'name' AS name
   FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
   WHERE l.source_intake_id=t.source_intake_id AND j.profile_resolution_status='RESOLVED'
     AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
     AND i.id IS NOT NULL ORDER BY l.leg_ordinal LIMIT 1) profile ON TRUE
 LEFT JOIN LATERAL (SELECT e.created_at AS at FROM pilot_ticket.ticket_event e
   WHERE e.ticket_id=t.id AND e.new_status=t.status
     AND e.event_type IN ('ticket.closed','ticket.cancelled','ticket.duplicate_linked')
   ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) ended ON TRUE
 LEFT JOIN LATERAL (SELECT r.review_reason_code FROM intake.manual_review_item r
   JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket jt ON jt.id=j.linked_ticket_id
   WHERE r.status='PENDING' AND (r.linked_ticket_id=t.id OR r.service_intake_id=t.source_intake_id)
     AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
     AND ($1::boolean OR jt.assignee_id=$2::uuid OR jt.resolver_team_id=ANY($3::text[]))
   ORDER BY r.created_at,r.id LIMIT 1) review ON TRUE
 WHERE ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[]))
 UNION ALL
 SELECT 'review',r.id::text,r.service_intake_id::text,i.intake_no,
   COALESCE(NULLIF(i.summary,''),'未提供报修描述'),'PENDING',r.priority,NULL,NULL,i.source_channel,
   NULL,r.review_reason_code,to_char(r.created_at,'YYYY-MM-DD HH24:MI:SS'),
   to_char(r.updated_at,'YYYY-MM-DD HH24:MI:SS'),NULL,to_char(r.updated_at,'YYYY-MM-DD HH24:MI:SS')
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
   i.status,NULL,i.reported_location_text,NULL,i.source_channel,NULL,NULL,
   to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS'),to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS'),
   NULL,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS')
 FROM intake.service_intake i
 WHERE $1::boolean AND i.retention_until>platform.local_now()
   AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED')
   AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=i.id OR actual.id=i.pilot_ticket_id)
   AND NOT EXISTS (SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
     JOIN pilot_ticket.ticket actual ON actual.id=j.linked_ticket_id WHERE l.source_intake_id=i.id)
   AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING')
)`;
function card(row: CardRow): WorkbenchCard {
  return { kind: row.kind, id: row.id, intake_id: row.intake_id, number: row.number, title: row.title,
    status: row.status, column: boardColumn(row.status), priority: row.priority, source: row.source,
    location: row.location, reporter_name: row.reporter_name,
    assignee_name: row.assignee_name, review_reason: row.review_reason,
    created_at: localP2016(row.created_at), updated_at: localP2016(row.updated_at),
    completed_at: row.completed_at === null ? null : localP2016(row.completed_at) };
}
export function createWeb01WorkbenchQuery({pool,query}: {pool: PostgresTransaction; query: P2016TicketQuery}) {
  async function scope(authContext: unknown) { return ticketPredicateP2016(await query.principal(authContext)); }
  async function range(mode: CompletionRange): Promise<BoardPage['range']> {
    const r=await pool.query<{from:string;until:string}>(`SELECT
      to_char(date_trunc('day',platform.local_now())-interval '1 day','YYYY-MM-DD HH24:MI:SS') AS "from",
      to_char(date_trunc('day',platform.local_now())+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until`);
    const row=r.rows[0];if(!row)failP2016();return {...row,mode,timezone:'Asia/Shanghai'};
  }
  async function item(authContext: unknown,kind: string,id: unknown): Promise<WorkbenchCard> {
    if(!['ticket','review','intake'].includes(kind))failP2016('NOT_FOUND',404);
    const authorized=await scope(authContext);
    const r=await pool.query<CardRow>(CARD_SQL+' SELECT * FROM cards WHERE kind=$4 AND id=$5', [...authorized.values,kind,uuidP2016(id)]);
    const row=r.rows[0];if(!row)failP2016('NOT_FOUND',404);return card(row);
  }
  return Object.freeze({
    async list(input: Input): Promise<BoardPage> {
      const authorized=await scope(input.authContext);
      const column=input.column??'pending',mode=input.range??'recent';
      if(!WEB01_COLUMNS.includes(column as BoardColumn)||!['recent','all'].includes(mode))failP2016();
      const selectedColumn=column as BoardColumn,selectedRange=mode as CompletionRange;
      const window=await range(selectedRange),limit=limitP2016(input.limit??'50');
      const page=input.cursor?decodeCursorP2016(input.cursor,['v','principal','scope','column','range','from','at','kind','id']):null;
      // Bind cursors to both filters and the current authorized scope, including a changed team/role.
      const scopeKey=JSON.stringify(authorized.values);
      if(page&&(page.v!==1||page.principal!==authorized.values[1]||page.scope!==scopeKey||page.column!==column||page.range!==mode||page.from!==window.from))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,id=page?uuidP2016(page.id):null;
      if(page&&(typeof page.kind!=='string'||!['ticket','review','intake'].includes(page.kind)))failP2016('CURSOR_INVALID');
      const states=selectedColumn==='pending'?['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED']:
        selectedColumn==='active'?['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR']:['CLOSED','RESOLVED','CANCELLED','DUPLICATE_LINKED'];
      const r=await pool.query<CardRow>(CARD_SQL+` SELECT * FROM cards WHERE status=ANY($4::text[])
        AND ($5::boolean OR status='RESOLVED' OR completed_at::timestamp>=$6::timestamp AND completed_at::timestamp<$7::timestamp)
        AND ($8::text IS NULL OR (sort_at,kind,id)<($8::text,$9::text,$10::text))
        ORDER BY sort_at DESC,kind DESC,id DESC LIMIT $11`, [...authorized.values,states,
          selectedColumn!=='closed'||selectedRange==='all',window.from,window.until,at,page?.kind??null,id,limit+1]);
      const items=r.rows.slice(0,limit).map(card),last=items.at(-1);
      return publicP2016({items,column:selectedColumn,range:window,next_cursor:r.rows.length>limit&&last?cursorP2016({v:1,
        principal:authorized.values[1],scope:scopeKey,column,range:mode,from:window.from,at:last.updated_at,kind:last.kind,id:last.id}):null});
    },
    async detail({authContext,kind,id,cursor,limit}: {authContext:unknown;kind:string;id:unknown;cursor:unknown;limit:unknown}): Promise<WorkbenchDetail> {
      const selected=await item(authContext,kind,id),n=limitP2016(limit??'50');
      const page=cursor?decodeCursorP2016(cursor,['kind','id','at','record_id']):null;
      if(page&&(page.kind!==kind||page.id!==selected.id))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,recordId=page?.record_id??null;
      if(page&&(typeof recordId!=='string'||recordId.length>100))failP2016('CURSOR_INVALID');
      // Known safe report text, not raw frames, identity tokens, arbitrary payloads or delivery metadata.
      const report=await pool.query<{summary:string|null;source_provider:string}>(`SELECT summary,source_provider FROM intake.service_intake
        WHERE id=$1::uuid AND retention_until>platform.local_now()`,[selected.intake_id]);
      const web=report.rows[0]?.source_provider==='YIXIAOXIU_WEB';
      const webRecords=web?`UNION ALL
        SELECT 'web:'||s.id::text,to_char(s.created_at,'YYYY-MM-DD HH24:MI:SS'),
          CASE WHEN s.kind='SUBMIT' THEN '报修原文' ELSE '报修补充' END,
          CASE WHEN s.kind='SUBMIT' THEN s.safe_content->>'description' ELSE s.safe_content->>'text' END,
          'REPORT',NULL,NULL,NULL FROM intake.web_submission s
        JOIN intake.web_request_binding b ON b.intake_id=s.intake_id
        WHERE s.intake_id=$1::uuid AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
          AND s.retention_until>platform.local_now()` : '';
      const records=await pool.query<WorkbenchRecord>(`WITH records AS (
        SELECT 'message:'||m.id::text AS id,to_char(rel.linked_at,'YYYY-MM-DD HH24:MI:SS') AS at,
          CASE WHEN rel.relation_type='PRIMARY' THEN '报修原文' ELSE '报修补充' END AS type,
          m.clean_text AS text,'REPORT'::text AS audience,NULL::text AS actor,NULL::text AS old_status,NULL::text AS new_status
        FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        JOIN intake.service_intake i ON i.id=rel.intake_id
        WHERE rel.intake_id=$1::uuid AND i.retention_until>platform.local_now() AND m.retention_until>platform.local_now()
        UNION ALL
        SELECT 'event:'||e.event_id::text,to_char(e.created_at,'YYYY-MM-DD HH24:MI:SS'),e.event_type,
          e.internal_note,'INTERNAL',COALESCE(p.display_name,e.operator_type),e.old_status,e.new_status
        FROM pilot_ticket.ticket_event e LEFT JOIN pilot_ticket.pilot_principal p ON p.id::text=e.operator_id
        WHERE $2='ticket' AND e.ticket_id=$3::uuid
        UNION ALL
        SELECT 'external:'||e.event_id::text,to_char(e.created_at,'YYYY-MM-DD HH24:MI:SS'),'对外摘要',
          e.external_note,'EXTERNAL',COALESCE(p.display_name,e.operator_type),NULL,NULL
        FROM pilot_ticket.ticket_event e LEFT JOIN pilot_ticket.pilot_principal p ON p.id::text=e.operator_id
        WHERE $2='ticket' AND e.ticket_id=$3::uuid AND e.external_note IS NOT NULL
        UNION ALL
        SELECT 'intake-event:'||e.event_id::text,to_char(e.occurred_at,'YYYY-MM-DD HH24:MI:SS'),
          e.event_type,NULL,'INTERNAL','SYSTEM',NULL,NULL FROM intake.service_intake_event e
        WHERE $2='intake' AND e.intake_id=$1::uuid
        ${webRecords}
      ) SELECT * FROM records WHERE ($4::text IS NULL OR (at,id)<($4::text,$5::text))
        ORDER BY at DESC,id DESC LIMIT $6`,[selected.intake_id,kind,selected.id,at,recordId,n+1]);
      const items=records.rows.slice(0,n),last=items.at(-1);
      const responsibility=kind==='ticket'?await query.responsibility({authContext,ticketId:selected.id}):null;
      const names: string[]=[];
      if(responsibility&&Array.isArray(responsibility.conversations))for(const conversation of responsibility.conversations){
        if(typeof conversation.conversation_principal_name==='string')names.push(conversation.conversation_principal_name);
      }
      return publicP2016({item:selected,description:report.rows[0]?.summary??null,records:items,
        next_cursor:records.rows.length>n&&last?cursorP2016({kind,id:selected.id,at:last.at,record_id:last.id}):null,
        responsibility:{ticket_assignee_name:selected.assignee_name,conversation_assignees:[...new Set(names)]}});
    },
  });
}
