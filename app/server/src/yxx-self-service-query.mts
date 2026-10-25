import type {IncomingMessage} from 'node:http';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxSelfServiceStore,YxxStoreRead} from './yxx-self-service-store.mjs';
import type {YxxMemberContext,YxxMemberSource,YxxMemberScope,createYxxSelfServiceAuthorization} from './yxx-self-service-authorization.mjs';
import type {TicketStatus} from './p1-005-pilot-ticket-core.mjs';
import type {YxxFeedbackStore} from './yxx-self-service-feedback.mjs';
import type {YxxH5Lifecycle} from './yxx-h5-v2-lifecycle.mjs';
import type {YxxH5Profile} from './yxx-h5-v2-profile.mjs';
import type {H5Media,H5ReportFilters,H5BootstrapExtension} from '../../../contracts/yxx_h5_v2_contracts.js';
import type {H5EntryInput,H5EntryResponse,H5EntryDetail,H5EntryMedia,H5SupplementPage,H5DepartmentSummary} from '../../../contracts/yxx_h5_entry_contracts.js';
import type {LocalDateTime,EpochMs,YxxSelfServiceBootstrap,YxxRequestDetail,YxxReportItem,YxxReportPage,YxxTimeline} from '../../../contracts/yxx_self_service_contracts.js';
import {parseH5ReportFilters} from './yxx-h5-v2-contracts.mjs';
import {h5RecentSql} from './yxx-h5-batch-sql.mjs';
import {beginH5Read,checkH5Read,finishH5Read,createH5ReadBatch,type H5ReadBudget,type H5ReadLease} from './yxx-h5-read-batch.mjs';
import {readH5EntryRow,h5SupplementPage,readH5Supplements,recheckH5EntryBinding,withH5TimelineBudget} from './yxx-h5-entry.mjs';
type ActiveContext=YxxMemberContext & {scope:YxxMemberScope};
export interface YxxQueryOptions {pool:PostgresPool;authorization:ReturnType<typeof createYxxSelfServiceAuthorization<IncomingMessage>>;store?:(Pick<YxxSelfServiceStore,'timeline'|'command'>&Partial<Pick<YxxSelfServiceStore,'timelineInTransaction'>>)|null;scopeSecret?:string;now?:()=>string;h5Lifecycle?:YxxH5Lifecycle|null;h5Profile?:YxxH5Profile|null;h5Media?:((input:{transaction:PostgresTransaction;scope:YxxMemberScope;requestRef:string})=>Promise<H5Media[]>)|null;h5MediaEntry?:((input:{transaction:PostgresTransaction;scope:YxxMemberScope;requestRef:string})=>Promise<H5EntryMedia[]>)|null}
export interface YxxQueryInput {request:IncomingMessage;source?:YxxMemberSource|null;limit?:unknown;cursor?:string|null;requestRef?:string|undefined;publicRef?:string|undefined;ref?:string|undefined;kind?:'WEB_REQUEST'|'BOT_TICKET';ifNoneMatch?:string|null;after?:string|null;before?:string|null;clientCommandId?:unknown;v2?:boolean;search?:string|null;status?:H5ReportFilters['status']}
declare const cursorMember:unique symbol;
export type YxxReportCursor<Member extends string=string> = string & {readonly [cursorMember]:Member};
export interface YxxReportCursorPayload<Member extends string=string> {v:1;scope_hash:YxxMemberScope<Member>['scopeHash'];source:YxxMemberSource|null;source_corp_scope:string;source_app_scope:string;snapshot_epoch:string;created_at:string;kind_rank:number;immutable_id:string}
interface ReportRow {kind:'WEB_REQUEST'|'BOT_TICKET';ref:string;created_at:string;kind_rank:number;immutable_id:string;status:string;input_revision:string;processed_revision:string;pilot_ticket_id:string|null;ticket_no:string|null;ticket_status:TicketStatus|null;ticket_updated_at:string|null;has_pending_review:boolean;safe_summary:string|null;safe_location:string|null;updated_at?:string}
interface WebDetailRow {request_ref:string;input_revision:string;processed_revision:string;revoked_at:string|null;intake_no:string;status:string;pilot_ticket_id:string|null;created_at:string;updated_at:string;safe_description:unknown;safe_location:string|null;supplement_items:{input_revision:unknown;text:unknown}[];ticket_no:string|null;ticket_status:TicketStatus|null;ticket_updated_at:string|null;has_pending_review:boolean;safe_clarification?:null}
interface BotTicketRow {public_ref:string;ticket_no:string;ticket_status:TicketStatus;created_at:string;ticket_updated_at:string;intake_retention:string}
type CursorFields={v?:unknown;scope_hash?:unknown;source?:unknown;source_corp_scope?:unknown;source_app_scope?:unknown;snapshot_epoch?:unknown;created_at?:unknown;kind_rank?:unknown;immutable_id?:unknown};
import { createHmac, timingSafeEqual } from 'node:crypto';
import { textHashP2016, transactionP2016, publicP2016 } from './p2-016-domain-contracts.mjs';
import { shanghaiLocalToEpochMs } from './platform/time-contract.mjs';
import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { YXX_MEMBER_READ_OPERATIONS } from './yxx-self-service-authorization.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REF = /^[A-Za-z0-9_-]{32}$/u;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
const SOURCES = new Set(['WEB', 'BOT']);
const MAX_LIST = 50;

function fail(code:string,status=400):never {
  const error = new Error(code) as Error & {code:string;status:number};
  error.code = code;
  error.status = status;
  throw error;
}

function requestRef(value:unknown) {
  if (typeof value !== 'string' || !REF.test(value)) fail('YXX_REQUEST_REF_INVALID');
  return value as string;
}

function source(value:unknown):YxxMemberSource|null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !SOURCES.has(value)) fail('YXX_MEMBER_SOURCE_INVALID');
  return value as YxxMemberSource;
}

function limit(value:unknown) {
  if (value === undefined || value === null) return 20;
  if (typeof value === 'string' && !/^[1-9][0-9]?$/u.test(value) && value !== '50') fail('YXX_LIMIT_INVALID');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LIST) fail('YXX_LIMIT_INVALID');
  return n;
}

function localTime(value:unknown) {
  const text = String(value);
  if (!LOCAL_TIME.test(text)) fail('YXX_TIME_INVALID', 503);
  return text as LocalDateTime;
}

function epoch(value:unknown) {
  try {
    const text = String(value);
    if (!/^(0|[1-9][0-9]*)$/u.test(text)) throw new Error('epoch');
    const n = BigInt(text);
    if (n < 0n || n > 9223372036854775807n) throw new Error('epoch');
    return text as EpochMs;
  } catch { fail('YXX_CURSOR_INVALID'); }
}

function cursorToken<Member extends string>(payload:YxxReportCursorPayload<Member>,secret:string):YxxReportCursor<Member> {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}` as YxxReportCursor<Member>;
}

function decodeCursor<Member extends string>(value:YxxReportCursor<NoInfer<Member>>,secret:string,scopeHash:YxxMemberScope<Member>['scopeHash'],selectedSource:YxxMemberSource|null,sourceCorpScope:string,sourceAppScope:string) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 2048) fail('YXX_CURSOR_INVALID');
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) fail('YXX_CURSOR_INVALID');
  const [data, signature] = parts as [string,string];
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  const actual = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) fail('YXX_CURSOR_INVALID');
  let parsed:CursorFields|null;
  try { parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { fail('YXX_CURSOR_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).some((key) => !['v', 'scope_hash', 'source', 'source_corp_scope', 'source_app_scope', 'snapshot_epoch', 'created_at', 'kind_rank', 'immutable_id'].includes(key))
    || parsed.v !== 1 || parsed.scope_hash !== scopeHash || parsed.source !== selectedSource
    || parsed.source_corp_scope !== sourceCorpScope || parsed.source_app_scope !== sourceAppScope
    || typeof parsed.created_at !== 'string' || !LOCAL_TIME.test(parsed.created_at)
    || !Number.isInteger(parsed.kind_rank) || ![0, 1].includes(parsed.kind_rank as number)
    || typeof parsed.immutable_id !== 'string' || !UUID.test(parsed.immutable_id)) fail('YXX_CURSOR_INVALID');
  return Object.freeze({
    v: 1,
    scope_hash: parsed.scope_hash,
    source: parsed.source,
    source_corp_scope: parsed.source_corp_scope,
    source_app_scope: parsed.source_app_scope,
    snapshot_epoch: epoch(parsed.snapshot_epoch),
    created_at: parsed.created_at,
    kind_rank: parsed.kind_rank as number,
    immutable_id: parsed.immutable_id.toLowerCase(),
  });
}

function ticketSummary(row:Pick<ReportRow,'ticket_no'|'ticket_status'|'ticket_updated_at'|'created_at'|'updated_at'>) {
  return row.ticket_no ? Object.freeze({
    ticket_no: row.ticket_no,
    status: row.ticket_status??fail('YXX_QUERY_ROW_INVALID',503),
    updated_at: localTime(row.ticket_updated_at ?? row.updated_at ?? row.created_at),
  }) : null;
}

function webDisplayStatus(row:Pick<ReportRow,'ticket_no'|'input_revision'|'processed_revision'|'status'|'has_pending_review'>) {
  if (row.ticket_no) return 'TICKET_CREATED';
  if (String(row.input_revision) !== String(row.processed_revision)) return 'RECEIVED_PROCESSING';
  if (row.status === 'WAITING_DESCRIPTION') return 'WAITING_FOR_DETAILS';
  if (row.status === 'WAITING_REVIEW' || row.status === 'WAITING_TRIAGE' || row.has_pending_review) return 'UNDER_REVIEW';
  if (row.status === 'IGNORED' || row.status === 'COMPLETED') return 'NOT_SERVICE';
  return 'RECEIVED_PROCESSING';
}

function reportItem(row:ReportRow):YxxReportItem {
  const created = localTime(row.created_at);
  const kind = row.kind === 'BOT_TICKET' ? 'BOT_TICKET' : 'WEB_REQUEST';
  const displayStatus = kind === 'BOT_TICKET'
    ? (EXTERNAL_TICKET_STATUS[row.ticket_status as TicketStatus] ?? String(row.ticket_status))
    : webDisplayStatus(row);
  let createdEpoch;
  try { createdEpoch = String(shanghaiLocalToEpochMs(localTime(created))); } catch { fail('YXX_TIME_INVALID', 503); }
  return Object.freeze({
    kind,
    ref: row.ref,
    display_status: displayStatus,
    created_at: created,
    created_epoch_ms: epoch(createdEpoch),
    ticket: ticketSummary(row),
    safe_summary: kind === 'WEB_REQUEST' ? row.safe_summary : null,
    safe_location: kind === 'WEB_REQUEST' ? row.safe_location : null,
  });
}

function reportItems(rows:ReportRow[],n:number){
  const page=rows.slice(0,n).map(reportItem);
  for(const item of page)if(!REF.test(item.ref))fail('YXX_QUERY_ROW_INVALID',503);
  return page;
}
function batchRecord(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function batchString(value:unknown){if(typeof value==='string')return value;return fail('YXX_QUERY_ROW_INVALID',503);}
function batchNullableString(value:unknown){if(value===null||typeof value==='string')return value;return fail('YXX_QUERY_ROW_INVALID',503);}
function knownTicketStatus(value:unknown):value is TicketStatus{return typeof value==='string'&&Object.hasOwn(EXTERNAL_TICKET_STATUS,value);}
function batchHomeData(value:unknown){
  if(!batchRecord(value)||!Array.isArray(value.recent_reports)||value.recent_reports.length>4||!batchRecord(value.department_summary))fail('YXX_QUERY_ROW_INVALID',503);
  const counts=value.department_summary;if(typeof counts.total!=='number'||!Number.isSafeInteger(counts.total)||counts.total<0||typeof counts.active_count!=='number'||!Number.isSafeInteger(counts.active_count)||counts.active_count<0||counts.active_count>counts.total)fail('YXX_QUERY_ROW_INVALID',503);
  const rows:ReportRow[]=value.recent_reports.map((item:unknown)=>{
    if(!batchRecord(item)||(item.kind!=='WEB_REQUEST'&&item.kind!=='BOT_TICKET')||typeof item.kind_rank!=='number'||!Number.isInteger(item.kind_rank)||typeof item.has_pending_review!=='boolean'||(item.ticket_status!==null&&!knownTicketStatus(item.ticket_status)))fail('YXX_QUERY_ROW_INVALID',503);
    const input=batchString(item.input_revision),processed=batchString(item.processed_revision);if(!/^[0-9]+$/u.test(input)||!/^[0-9]+$/u.test(processed))fail('YXX_QUERY_ROW_INVALID',503);
    return {kind:item.kind,ref:batchString(item.ref),created_at:batchString(item.created_at),kind_rank:item.kind_rank,immutable_id:batchString(item.immutable_id),status:batchString(item.status),input_revision:input,processed_revision:processed,pilot_ticket_id:batchNullableString(item.pilot_ticket_id),ticket_no:batchNullableString(item.ticket_no),ticket_status:item.ticket_status,ticket_updated_at:batchNullableString(item.ticket_updated_at),has_pending_review:item.has_pending_review,safe_summary:batchNullableString(item.safe_summary),safe_location:batchNullableString(item.safe_location)};
  });
  return {reports:reportItems(rows,3),total:counts.total,active_count:counts.active_count};
}

function safeNeedsAction(row:WebDetailRow) {
  if (String(row.input_revision) !== String(row.processed_revision)) return null;
  if (row.status === 'WAITING_DESCRIPTION') return '请补充故障现象';
  if (row.status === 'WAITING_TRIAGE' || row.has_pending_review) return '正在人工审核';
  return null;
}

function safeWebDetail(row:WebDetailRow):YxxRequestDetail {
  const created = localTime(row.created_at);
  const updated = localTime(row.updated_at);
  const safeDescription = typeof row.safe_description === 'string' ? row.safe_description : '';
  let createdEpoch = '0'; let updatedEpoch = '0';
  try {
    createdEpoch = String(shanghaiLocalToEpochMs(created));
    updatedEpoch = String(shanghaiLocalToEpochMs(updated));
  } catch { fail('YXX_TIME_INVALID', 503); }
  return Object.freeze({
    request_ref: row.request_ref,
    intake_no: row.intake_no,
    source_kind: 'WEB_REQUEST',
    input_revision: String(row.input_revision),
    processed_revision: String(row.processed_revision),
    display_status: webDisplayStatus(row),
    needs_action: safeNeedsAction(row),
    safe_description: safeDescription,
    supplements: (Array.isArray(row.supplement_items) ? row.supplement_items : []).map((item) => ({
      input_revision: String(item.input_revision), text: typeof item.text === 'string' ? item.text : null,
    })),
    safe_location: row.safe_location ?? null,
    created_at: created,
    created_epoch_ms: epoch(createdEpoch),
    updated_at: updated,
    updated_epoch_ms: epoch(updatedEpoch),
    ticket: ticketSummary(row),
    safe_clarification: row.safe_clarification ?? null,
    can_supplement: BigInt(row.input_revision) < 50n
      && !['CLOSED', 'CANCELLED'].includes(row.ticket_status ?? '')
      && row.revoked_at === null,
  });
}

function botBindingHash(botId:string|null,userId:string|null) {
  return textHashP2016(JSON.stringify(['WECOM_AIBOT', botId, userId]));
}

function snapshotNow(now:(()=>string)|unknown) {
  const value = typeof now === 'function' ? now() : now;
  return epoch(value === undefined ? Date.now() : value);
}

function unfilteredReportsStatement(context:ActiveContext,selectedSource:YxxMemberSource|null,n:number,cursor:ReturnType<typeof decodeCursor>|null,snapshotEpoch:string) {
  const owner = context.bot_owner;
  const botId = owner?.botId ?? null;
  const botUserId = owner?.userId ?? null;
  const binding = owner ? botBindingHash(botId, botUserId) : null;
  const args = [context.scope.scopeHash, n + 1, selectedSource, snapshotEpoch, cursor?.created_at ?? null,
    cursor?.kind_rank ?? null, cursor?.immutable_id ?? null, botId, botUserId, binding,
    context.scope.sourceCorpScope, context.scope.sourceAppScope];
  // Each source contributes at most N keys before public summaries are read.
  // Their bounded union still contains the exact first N rows of the shared order.
  return {text:h5RecentSql(),values:args};
}

async function listRows(transaction:PostgresTransaction,context:ActiveContext,selectedSource:YxxMemberSource|null,n:number,cursor:ReturnType<typeof decodeCursor>|null,snapshotEpoch:string,filters:Required<H5ReportFilters>|null=null) {
  const prepared=unfilteredReportsStatement(context,selectedSource,n,cursor,snapshotEpoch);
  if(filters===null||filters.search===null&&filters.status===null){
    return (await transaction.query<ReportRow>(prepared.text,prepared.values)).rows;
  }
  const args=[...prepared.values,filters.search,filters.status];
  const q = await transaction.query<ReportRow>(`
    WITH report_rows AS (
      SELECT 'WEB_REQUEST'::text AS kind, b.request_ref AS ref, b.created_at::timestamp without time zone AS created_at,
             0::integer AS kind_rank, b.intake_id::text AS immutable_id,
             i.status, b.input_revision, b.processed_revision, i.pilot_ticket_id::text,
             t.ticket_no, t.status AS ticket_status, to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,
             EXISTS (SELECT 1 FROM intake.manual_review_item r
                      WHERE r.service_intake_id=i.id AND r.status='PENDING') AS has_pending_review,
             NULLIF(left(initial.safe_content->>'description',120),'') AS safe_summary,
             CASE WHEN (initial.safe_content->'location'->>'unknown')::boolean THEN NULL
                  ELSE NULLIF(left(initial.safe_content->'location'->>'text',80),'') END AS safe_location
        FROM intake.web_request_binding b
        JOIN intake.service_intake i ON i.id=b.intake_id
        LEFT JOIN LATERAL (
          SELECT s.safe_content FROM intake.web_submission s
           WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until>platform.local_now()
           ORDER BY s.input_revision LIMIT 1
        ) initial ON TRUE
        LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
       WHERE b.canonical_reporter_binding=$1
         AND b.source_corp_scope=$11 AND b.source_app_scope=$12
         AND b.revoked_at IS NULL
         AND b.retention_until_epoch_ms>platform.physical_epoch_ms()
         AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
         AND i.source_provider='YIXIAOXIU_WEB'
      UNION ALL
      SELECT 'BOT_TICKET'::text AS kind, r.public_ref AS ref, t.created_at::timestamp without time zone AS created_at,
             1::integer AS kind_rank, t.id::text AS immutable_id,
             i.status, 1::bigint AS input_revision, 1::bigint AS processed_revision, i.pilot_ticket_id::text,
             t.ticket_no, t.status AS ticket_status, to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,
             false AS has_pending_review, NULL::text AS safe_summary, NULL::text AS safe_location
        FROM pilot_ticket.reporter_public_ref r
        JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
        JOIN intake.service_intake i ON i.id=t.source_intake_id
       WHERE r.status='ACTIVE'
         AND r.reporter_binding_hash=$10
         AND i.source_provider='WECOM_AIBOT'
         AND i.source_bot_id=$8
         AND i.reporter_wecom_userid=$9
         AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
         AND (r.journey_id IS NULL OR EXISTS (
           SELECT 1 FROM intake.contact_journey j
            WHERE j.id=r.journey_id AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
         ))
    )
    SELECT * FROM report_rows
     WHERE ($3::text IS NULL OR kind=CASE WHEN $3='WEB' THEN 'WEB_REQUEST' ELSE 'BOT_TICKET' END)
       AND ($13::text IS NULL OR strpos(lower(COALESCE(ticket_no,'')||' '||COALESCE(safe_summary,'')||' '||COALESCE(safe_location,'')),lower($13))>0)
       AND ($14::text IS NULL OR CASE WHEN $14='COMPLETED' THEN ticket_status IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED')
         WHEN $14='ACTIVE' THEN ticket_status IN ('IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR')
         ELSE ticket_status IS NULL OR ticket_status IN ('NEW','QUEUED','ACCEPTED','REOPENED') END)
       AND created_at<=platform.local_from_epoch_ms($4::bigint)
       AND ($5::timestamp without time zone IS NULL
         OR created_at<$5::timestamp without time zone
         OR (created_at=$5::timestamp without time zone AND kind_rank>$6::integer)
         OR (created_at=$5::timestamp without time zone AND kind_rank=$6::integer AND immutable_id<$7::text))
     ORDER BY created_at DESC,kind_rank ASC,immutable_id DESC
     LIMIT $2`, args);
  return q.rows;
}

export function createYxxSelfServiceQuery({
  pool,
  feedbackStore = null,
  authorization,
  store = null,
  scopeSecret = 'yxx-self-service-query-secret-32-bytes',
  now = () => String(Date.now()),
  h5Lifecycle=null,h5Profile=null,h5Media=null,h5MediaEntry=null,
}:YxxQueryOptions & {feedbackStore?:YxxFeedbackStore|null}={} as YxxQueryOptions) {
  if (!pool?.connect || !authorization?.read || typeof scopeSecret !== 'string' || Buffer.byteLength(scopeSecret) < 16) {
    fail('YXX_QUERY_CONFIG_INVALID', 503);
  }
  const h5Reads=createH5ReadBatch({pool});

  async function listForContext(context:ActiveContext,selectedSource:YxxMemberSource|null,n:number,cursorValue:string|null,filters:Required<H5ReportFilters>|null=null,transaction?:PostgresTransaction):Promise<YxxReportPage> {
    const cursorSecret=filters===null?scopeSecret:createHmac('sha256',scopeSecret).update(JSON.stringify(['H5_FILTERS',filters])).digest('hex');
    const cursor = cursorValue === null || cursorValue === undefined
      ? null
      : decodeCursor(cursorValue as YxxReportCursor, cursorSecret, context.scope.scopeHash, selectedSource,
        context.scope.sourceCorpScope, context.scope.sourceAppScope);
    const snapshotEpoch = cursor?.snapshot_epoch ?? snapshotNow(now);
    const rows = transaction?await listRows(transaction,context,selectedSource,n,cursor,snapshotEpoch,filters)
      :await transactionP2016(pool, async tx => listRows(tx, context, selectedSource, n, cursor, snapshotEpoch,filters));
    const page=reportItems(rows,n);
    const next = rows.length > n && page.length > 0
      ? cursorToken({
        v: 1,
        scope_hash: context.scope.scopeHash,
        source: selectedSource,
        source_corp_scope: context.scope.sourceCorpScope,
        source_app_scope: context.scope.sourceAppScope,
        snapshot_epoch: snapshotEpoch,
        created_at: (page.at(-1) as Readonly<{ kind: "WEB_REQUEST" | "BOT_TICKET"; ref: string; display_status: string; created_at: string; created_epoch_ms: string; ticket: Readonly<{ ticket_no: string; status: TicketStatus | null; updated_at: string; }> | null; }>).created_at,
        kind_rank: (rows[n - 1] as ReportRow).kind_rank,
        immutable_id: (rows[n - 1] as ReportRow).immutable_id,
      }, cursorSecret)
      : null;
    return publicP2016({ items: page, next_cursor: next });
  }

  async function webDetailForContext(context:ActiveContext,ref:unknown,v2=false) {
    requestRef(ref);
    return transactionP2016(pool, async (transaction) => {
      const q = await transaction.query<WebDetailRow>(`
        SELECT b.request_ref,b.input_revision,b.processed_revision,b.revoked_at,
               i.intake_no,i.status,i.pilot_ticket_id::text,
               to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
               to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
               COALESCE(initial.safe_content->>'description','') AS safe_description,
               CASE WHEN (initial.safe_content->'location'->>'unknown')::boolean THEN NULL
                    ELSE initial.safe_content->'location'->>'text' END AS safe_location,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('input_revision',s.input_revision::text,
                       'text',s.safe_content->>'text') ORDER BY s.input_revision)
                         FROM intake.web_submission s
                        WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT'
                          AND s.retention_until>platform.local_now()),'[]'::jsonb) AS supplement_items,
               t.ticket_no,t.status AS ticket_status,
               to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,
               EXISTS (SELECT 1 FROM intake.manual_review_item r
                        WHERE r.service_intake_id=i.id AND r.status='PENDING') AS has_pending_review
          FROM intake.web_request_binding b
          JOIN intake.service_intake i ON i.id=b.intake_id
          LEFT JOIN LATERAL (
            SELECT s.safe_content FROM intake.web_submission s
             WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until>platform.local_now()
             ORDER BY s.input_revision LIMIT 1
          ) initial ON TRUE
          LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
          WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2
           AND b.source_corp_scope=$3 AND b.source_app_scope=$4
           AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms()
           AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
           AND i.source_provider='YIXIAOXIU_WEB'`, [ref, context.scope.scopeHash, context.scope.sourceCorpScope, context.scope.sourceAppScope]);
      if (q.rowCount !== 1) fail('YXX_NOT_FOUND', 404);
      const detail=safeWebDetail({ ...(q.rows[0] as WebDetailRow), safe_clarification: null });
      return {...detail,can_supplement:detail.can_supplement&&context.write_flag===true&&context.flags.YIXIAOXIU_SELF_SERVICE_ENABLED===true,
        ...(feedbackStore?{feedback_context:await feedbackStore.context(transaction,context,ref as string)}:{}),
        ...(v2&&h5Lifecycle?{h5:{...await h5Lifecycle.context(transaction,context,ref as string),media:h5Media?await h5Media({transaction,scope:context.scope,requestRef:ref as string}):[]}}:{})};
    });
  }

  async function botTicketForContext(context:ActiveContext,ref:unknown) {
    requestRef(ref);
    const owner = context.bot_owner;
    if (!owner) fail('YXX_NOT_FOUND', 404);
    return transactionP2016(pool, async (transaction) => {
      const q = await transaction.query<BotTicketRow>(`
        SELECT r.public_ref,t.ticket_no,t.status AS ticket_status,
               t.created_at,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,
               i.retention_until_epoch_ms::text AS intake_retention,
               to_char(t.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at
          FROM pilot_ticket.reporter_public_ref r
          JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
          JOIN intake.service_intake i ON i.id=t.source_intake_id
         WHERE r.public_ref=$1 AND r.status='ACTIVE'
           AND r.reporter_binding_hash=$2
           AND i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$3
           AND i.reporter_wecom_userid=$4
           AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
           AND (r.journey_id IS NULL OR EXISTS (
             SELECT 1 FROM intake.contact_journey j
              WHERE j.id=r.journey_id AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
           ))`, [ref, botBindingHash(owner.botId, owner.userId), owner.botId, owner.userId]);
      if (q.rowCount !== 1) fail('YXX_NOT_FOUND', 404);
      const row = (q.rows[0] as BotTicketRow);
      const created = localTime(row.created_at);
      return publicP2016({ kind: 'BOT_TICKET', ref: row.public_ref,
        display_status: EXTERNAL_TICKET_STATUS[row.ticket_status as TicketStatus] ?? row.ticket_status,
        created_at: created, created_epoch_ms: String(shanghaiLocalToEpochMs(created)),
        ticket: { ticket_no: row.ticket_no, status: row.ticket_status, updated_at: String(row.ticket_updated_at) } });
    });
  }

  async function list({ request, source: requestedSource = null, limit: requestedLimit, cursor = null,v2=false,search,status }:YxxQueryInput={} as YxxQueryInput) {
    const selectedSource = source(requestedSource);
    const operation = selectedSource === 'BOT' ? YXX_MEMBER_READ_OPERATIONS.BOT_LIST : YXX_MEMBER_READ_OPERATIONS.MY_REPORTS;
    const filters=v2?parseH5ReportFilters({...(search===undefined?{}:{search}),...(status===undefined?{}:{status})}):null;
    return authorization.read({ request, operation, source: selectedSource as YxxMemberSource|null, run: (context) => listForContext(context, selectedSource, limit(requestedLimit), cursor,filters) });
  }

  async function getWebRequest({ request, requestRef: ref,v2=false }:YxxQueryInput={} as YxxQueryInput) {
    return authorization.read({ request, operation: YXX_MEMBER_READ_OPERATIONS.WEB_DETAIL,
      source: 'WEB', run: (context) => webDetailForContext(context, ref,v2) });
  }

  async function getBotTicket({ request, publicRef: ref, ref: alternateRef }:YxxQueryInput={} as YxxQueryInput) {
    return authorization.read({ request, operation: YXX_MEMBER_READ_OPERATIONS.BOT_TICKET,
      source: 'BOT', run: (context) => botTicketForContext(context, ref ?? alternateRef) });
  }

  async function detail({ request, kind = 'WEB_REQUEST', ref, requestRef: requestRefValue, publicRef,v2=false }:YxxQueryInput={} as YxxQueryInput) {
    if (kind === 'BOT_TICKET') return getBotTicket({ request, publicRef: publicRef ?? ref });
    if (kind !== 'WEB_REQUEST') fail('YXX_MEMBER_SOURCE_INVALID');
    return getWebRequest({ request, requestRef: requestRefValue ?? ref,v2 });
  }

  async function detailWithEtag({ request, requestRef: ref, ifNoneMatch = null,v2=false }:YxxQueryInput={} as YxxQueryInput) {
    return authorization.read({ request, operation: YXX_MEMBER_READ_OPERATIONS.WEB_DETAIL, source: 'WEB', run: async (context) => {
      const body = await webDetailForContext(context, ref,v2);
      const etag = `"${textHashP2016(JSON.stringify(body))}"`;
      return { status: ifNoneMatch === etag ? 304 : 200, etag, body: ifNoneMatch === etag ? null : body };
    }});
  }

  async function timeline({ request, requestRef: ref, ...input }:Omit<YxxQueryInput,'limit'> & {limit?:number|undefined}={} as Omit<YxxQueryInput,'limit'> & {limit?:number|undefined}) {
    if (!store?.timeline) fail('YXX_QUERY_TIMELINE_UNAVAILABLE', 503);
    return authorization.read({ request, operation: YXX_MEMBER_READ_OPERATIONS.WEB_TIMELINE, source: 'WEB',
      run: (context) => store.timeline({ ...input, scope: context.scope, requestRef: ref }) });
  }

  async function commandStatus({ request, clientCommandId }:YxxQueryInput={} as YxxQueryInput) {
    if (!store?.command) fail('YXX_QUERY_COMMAND_UNAVAILABLE', 503);
    return authorization.read({ request, operation: YXX_MEMBER_READ_OPERATIONS.WEB_COMMAND,
      source: 'WEB', run: (context) => store.command({ scope: context.scope, clientCommandId }) });
  }

  function timelineBody(body:Awaited<ReturnType<YxxSelfServiceStore['timeline']>>):YxxTimeline{
    return {items:body.items.map(item=>({event_type:item.event_type,occurred_at:localTime(item.occurred_at),occurred_epoch_ms:epoch(item.occurred_epoch_ms),summary:item.summary,
      ticket:item.ticket?{ticket_no:item.ticket.ticket_no,status:typeof item.ticket.status==='string'?item.ticket.status:fail('YXX_QUERY_ROW_INVALID',503),updated_at:localTime(item.ticket.updated_at)}:null})),next_cursor:body.next_cursor};
  }
  async function h5Entry({request,input,bootstrap,sdk}:{request:IncomingMessage;input:H5EntryInput;bootstrap:YxxSelfServiceBootstrap;sdk?:H5BootstrapExtension['sdk']}):Promise<H5EntryResponse>{
    const profile=h5Profile;if(!profile)fail('YXX_UNAVAILABLE',503);
    const selectedSource=input.view==='reports'?source(input.source):input.view==='home'?null:'WEB';
    const operation=input.view==='request'?YXX_MEMBER_READ_OPERATIONS.WEB_DETAIL:YXX_MEMBER_READ_OPERATIONS.MY_REPORTS;
    beginH5Read(request);let budget:H5ReadBudget|null=null,lease:H5ReadLease|null=null,committed=false;
    let admitted!:(value:H5ReadBudget)=>void;const ready=new Promise<H5ReadBudget>(resolve=>{admitted=resolve;});
    const work=authorization.read({request,operation,source:selectedSource,run:async context=>{
      authorization.assertOperationAllowed(context,YXX_MEMBER_READ_OPERATIONS.MY_REPORTS,null);
      if(input.view==='request')authorization.assertOperationAllowed(context,YXX_MEMBER_READ_OPERATIONS.WEB_TIMELINE,'WEB');
      if(input.view==='reports'&&selectedSource==='BOT')authorization.assertOperationAllowed(context,YXX_MEMBER_READ_OPERATIONS.BOT_LIST,'BOT');
      const currentBudget=h5Reads.open(request);budget=currentBudget;admitted(currentBudget);
      if(bootstrap.csrf_token!==context.csrf_token)fail('YXX_MEMBER_AUTH_RECHECK_FAILED',503);
      const filters=input.view==='department'?parseH5ReportFilters({...(input.search===undefined?{}:{search:input.search}),...(input.status===undefined?{}:{status:input.status})}):null;
      if(input.view==='home'||input.view==='department'&&filters?.search===null&&filters.status===null){
        const member=await h5Reads.transaction(currentBudget,tx=>profile.resolveInTransaction(tx,context.scope));
        const mayWrite=bootstrap.can_submit&&context.write_flag&&context.flags.YIXIAOXIU_SELF_SERVICE_ENABLED;
        const base={schema_version:1 as const,bootstrap:{...bootstrap,can_submit:mayWrite,can_supplement:bootstrap.can_supplement&&mayWrite,read_only:!mayWrite,h5:profile.bootstrapFromResolved(context,member,sdk)},membership_revision:member.membership_hash};
        if(input.view==='home'&&!member.can_view_department){
          const rows=await h5Reads.transaction(currentBudget,async tx=>{const rows=await listRows(tx,context,null,3,null,snapshotNow(now));await profile.revalidateInTransaction(tx,context.scope,member);return rows;});
          return {...base,view:'home',data:{recent_reports:reportItems(rows,3),department_summary:null}} satisfies H5EntryResponse;
        }
        const recent=input.view==='home'?unfilteredReportsStatement(context,null,3,null,snapshotNow(now)).values:[];
        const currentLease=h5Reads.enqueue(currentBudget,input.view,profile.batchInput(context.scope,member,recent));lease=currentLease;
        const raw=await currentLease.result;currentBudget.check();profile.verifyBatchProof(member,raw.proof);
        let result:H5EntryResponse;
        if(input.view==='home'){const data=batchHomeData(raw.data);result={...base,view:'home',data:{recent_reports:data.reports,department_summary:{total:data.total,active_count:data.active_count,membership_revision:member.membership_hash}}};}
        else result={...base,view:'department',data:{department:profile.departmentPageFromBatch(context.scope,member,raw.data)}};
        h5Reads.terminalStart(currentBudget);await h5Reads.transaction(currentBudget,tx=>profile.revalidateInTransaction(tx,context.scope,member));h5Reads.terminalEnd(currentBudget);currentBudget.check();return result;
      }
      return h5Reads.transaction(currentBudget,async tx=>{
      if(bootstrap.csrf_token!==context.csrf_token)fail('YXX_MEMBER_AUTH_RECHECK_FAILED',503);
      const member=await profile.resolveInTransaction(tx,context.scope);
      const mayWrite=bootstrap.can_submit&&context.write_flag&&context.flags.YIXIAOXIU_SELF_SERVICE_ENABLED;
      const base={schema_version:1 as const,bootstrap:{...bootstrap,can_submit:mayWrite,can_supplement:bootstrap.can_supplement&&mayWrite,read_only:!mayWrite,
        h5:profile.bootstrapFromResolved(context,member,sdk)},membership_revision:member.membership_hash};
      let result:H5EntryResponse;
      switch(input.view){
        case 'report':result={...base,view:'report',data:null};break;
        case 'reports':{
          const filters=parseH5ReportFilters({...(input.search===undefined?{}:{search:input.search}),...(input.status===undefined?{}:{status:input.status})});
          const reports=await listForContext(context,selectedSource,20,null,filters,tx);
          result={...base,view:'reports',data:{reports}};break;
        }
        case 'department':{
          const filters=parseH5ReportFilters({...(input.search===undefined?{}:{search:input.search}),...(input.status===undefined?{}:{status:input.status})});
          const department=await profile.departmentInTransaction(tx,context.scope,{limit:20,...filters,resolved:member});
          // The department projection itself performs the current-relationship terminal check.
          return {...base,view:'department',data:{department}} satisfies H5EntryResponse;
        }
        case 'request':{
          const lifecycle=h5Lifecycle,feedback=feedbackStore,timelineRead=store?.timelineInTransaction;
          if(!lifecycle||!timelineRead)fail('YXX_UNAVAILABLE',503);
          const ref=requestRef(input.request_ref),row=await readH5EntryRow(tx,context.scope,ref);
          const supplements=h5SupplementPage(row.supplement_items,context.scope,ref,row.input_revision,scopeSecret);
          const projection={source:row,round:row.completed_round,urge:row.urge_read,epoch:row.read_epoch,progress:row.progress_read,evaluation:row.evaluation_read};
          const detail:H5EntryDetail={...safeWebDetail({...row,supplement_items:supplements.items}),
            can_supplement:BigInt(row.input_revision)<50n&&!['CLOSED','CANCELLED'].includes(row.ticket_status??'')&&context.write_flag&&context.flags.YIXIAOXIU_SELF_SERVICE_ENABLED,
            supplements_cursor:supplements.next_cursor,
            ...(feedback?{feedback_context:feedback.contextFromAuthorizedProjection(context,ref,{source:row,round:row.completed_round,already_reopened:row.already_reopened})}:{}),
            h5:{...lifecycle.contextFromAuthorizedProjection(context,ref,projection),media:h5MediaEntry?await h5MediaEntry({transaction:tx,scope:context.scope,requestRef:ref}):[]}};
          const timeline=await withH5TimelineBudget(tx,async()=>timelineBody(await timelineRead({transaction:tx,scope:context.scope,requestRef:ref,authorizedIntakeId:row.intake_id,limit:20})));
          await recheckH5EntryBinding(tx,context.scope,ref);
          result={...base,view:'request',data:{detail,timeline}};break;
        }
        default:fail('YXX_INPUT_INVALID');
      }
      await profile.revalidateInTransaction(tx,context.scope,member);
      return result;
    });}});
    const completed=work.then(result=>{if(budget)budget.check();else checkH5Read(request);committed=true;return result;}).finally(()=>{lease?.release();if(budget)h5Reads.finish(budget,committed?'committed':budget.signal.aborted?'cancelled':'failed');else finishH5Read(request,committed?'committed':'failed');});
    return Promise.race([completed,ready.then(current=>current.wait(h5Reads.watch(current,completed)))]);
  }
  async function departmentSummary({request}:{request:IncomingMessage}):Promise<H5DepartmentSummary>{
    const profile=h5Profile;if(!profile)fail('YXX_UNAVAILABLE',503);
    return authorization.read({request,operation:YXX_MEMBER_READ_OPERATIONS.MY_REPORTS,source:'WEB',run:context=>transactionP2016(pool,async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      return profile.departmentSummaryInTransaction(tx,context.scope);
    })});
  }
  async function supplements({request,requestRef:rawRef,cursor=null,limit:requestedLimit=20}:{request:IncomingMessage;requestRef:string;cursor?:string|null;limit?:unknown}):Promise<H5SupplementPage>{
    const ref=requestRef(rawRef),n=limit(requestedLimit);
    return authorization.read({request,operation:YXX_MEMBER_READ_OPERATIONS.WEB_DETAIL,source:'WEB',run:context=>transactionP2016(pool,async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      return readH5Supplements(tx,context.scope,ref,scopeSecret,cursor,n);
    })});
  }

  return Object.freeze({
    h5Entry,departmentSummary,supplements,closeH5Reads:h5Reads.close,
    async h5Bootstrap({request,sdk}:{request:IncomingMessage;sdk?:H5BootstrapExtension['sdk']}){
      if(!h5Profile)fail('YXX_UNAVAILABLE',503);
      return authorization.read({request,operation:YXX_MEMBER_READ_OPERATIONS.MY_REPORTS,run:context=>h5Profile.bootstrap(context,sdk)});
    },
    async department({request,limit:requestedLimit,cursor=null,search,status}:YxxQueryInput){
      if(!h5Profile)fail('YXX_UNAVAILABLE',503);const filters=parseH5ReportFilters({...(search===undefined?{}:{search}),...(status===undefined?{}:{status})});
      return authorization.read({request,operation:YXX_MEMBER_READ_OPERATIONS.MY_REPORTS,source:'WEB',run:context=>h5Profile.department(context.scope,{limit:limit(requestedLimit),cursor,...filters})});
    },
    async lifecycleReceipt({request,requestRef:ref,clientCommandId,purpose}:YxxQueryInput&{purpose:'URGE'|'EVALUATION'}){
      if(!h5Lifecycle)fail('YXX_UNAVAILABLE',503);requestRef(ref);
      return authorization.read({request,operation:YXX_MEMBER_READ_OPERATIONS.WEB_COMMAND,source:'WEB',run:context=>transactionP2016(pool,tx=>h5Lifecycle.receipt(tx,context.scope,ref as string,clientCommandId,purpose))});
    },
    async feedbackReceipt({request,requestRef:ref,clientCommandId}:YxxQueryInput){
      if(!feedbackStore)fail('YXX_UNAVAILABLE',503);requestRef(ref);
      return authorization.read({request,operation:YXX_MEMBER_READ_OPERATIONS.WEB_COMMAND,source:'WEB',run:context=>transactionP2016(pool,tx=>feedbackStore.receipt(tx,context.scope,ref as string,clientCommandId))});
    },
    list,
    listMyReports: list,
    detail,
    getWebRequest,
    getBotTicket,
    detailWithEtag,
    timeline,
    commandStatus,
  });
}

export { decodeCursor as decodeYxxReportCursor, cursorToken as encodeYxxReportCursor };
