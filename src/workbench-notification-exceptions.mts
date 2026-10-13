import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import type {PostgresPool, PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from './p2-006-workbench-authorization.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {NotificationExceptionItem, NotificationExceptionPage} from '../contracts/workbench_notification_exception_contracts.js';
import {failP2016, limitP2016, uuidP2016, transactionP2016, publicP2016} from './p2-016-domain-contracts.mjs';

export interface NotificationExceptionIncidentScope {lifecycle:boolean;publicProgress:boolean;publicScopes:readonly string[]}
export type NotificationExceptionIncidentScopePort=(input:{authContext:unknown;tx:PostgresTransaction})=>Promise<NotificationExceptionIncidentScope|null>;
interface Options {pool:PostgresPool; query:Pick<P2016TicketQuery,'principal'>; enabled?:boolean; externalSendEnabled?:boolean;incidentScope?:NotificationExceptionIncidentScopePort|null}
interface Filters {domain:string;route:string;state:string;limit:number;cursor:string|null;scopeKey:string}
interface Position {at:string;id:string}
interface ExceptionRow extends Omit<NotificationExceptionItem,'allowed_actions'|'parent_link'|'safe_summary'|'error_code'> {assignee_id:string|null;summary?:string}
type HttpContext=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
const stamp=(column:string)=>`to_char(${column},'YYYY-MM-DD"T"HH24:MI:SS.US')`;
const route=`CASE WHEN d.target_type='GROUP' THEN 'GROUP' WHEN d.provider='WECOM_APP' THEN 'YIXIAOXIU_APP' ELSE 'BOT_DIRECT' END`;
const exception=`(d.status='DEAD_LETTER' OR (d.status IN ('RECONCILIATION_REQUIRED','CANCELLED') AND d.side_effect_state='UNKNOWN'))`;

/** A bounded read of the existing binding/Delivery/Attempt facts, never a second queue ledger. */
export function createWorkbenchNotificationExceptions({pool,query,enabled=false,externalSendEnabled=true,incidentScope=null}:Options) {
  if(typeof enabled!=='boolean'||typeof externalSendEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  const cursorKey=randomBytes(32);
  const authorization=createPilotWorkbenchAuthorizationAdapter({pool});
  function filters(url:URL):Filters {
    const keys=['domain','route','state','limit','cursor'];
    if([...url.searchParams.keys()].some(k=>!keys.includes(k))||keys.some(k=>url.searchParams.getAll(k).length>1))failP2016();
    const domain=url.searchParams.get('domain')??'ALL', selectedRoute=url.searchParams.get('route')??'ALL',state=url.searchParams.get('state')??'ALL';
    if(!['ALL','TICKET','SESSION','INCIDENT'].includes(domain)||!['ALL','GROUP','BOT_DIRECT','YIXIAOXIU_APP'].includes(selectedRoute)||!['ALL','FAILED','UNKNOWN'].includes(state))failP2016();
    return {domain,route:selectedRoute,state,limit:limitP2016(url.searchParams.get('limit'),50),cursor:url.searchParams.get('cursor'),scopeKey:''};
  }
  const context=(p:WorkbenchPrincipal,f:Filters)=>JSON.stringify([p.principal_id,p.roles,p.team_ids,f.domain,f.route,f.state,f.scopeKey]);
  const mac=(body:string,p:WorkbenchPrincipal,f:Filters)=>createHmac('sha256',cursorKey).update(context(p,f)).update('\n'+body).digest();
  function encode(position:Position,p:WorkbenchPrincipal,f:Filters) {
    const body=Buffer.from(JSON.stringify(position)).toString('base64url');return body+'.'+mac(body,p,f).toString('base64url');
  }
  function decode(value:string|null,p:WorkbenchPrincipal,f:Filters):Position|null {
    if(value===null)return null;
    if(value.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value))failP2016('CURSOR_INVALID');
    const [body,signature]=value.split('.');if(!body||!signature)failP2016('CURSOR_INVALID');
    const actual=Buffer.from(signature,'base64url'),expected=mac(body,p,f);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))failP2016('CURSOR_INVALID');
    try {
      const v:unknown=JSON.parse(Buffer.from(body,'base64url').toString());
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='at,id')failP2016('CURSOR_INVALID');
      const pos=v as Position;
      if(typeof pos.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u.test(pos.at))failP2016('CURSOR_INVALID');
      uuidP2016(pos.id);if(Buffer.from(JSON.stringify(pos)).toString('base64url')!==body)failP2016('CURSOR_INVALID');
      return pos;
    }catch {failP2016('CURSOR_INVALID');}
  }
  function project(row:ExceptionRow,p:WorkbenchPrincipal):NotificationExceptionItem {
    const unknown=row.side_effect_state==='UNKNOWN';
    const allowed:NotificationExceptionItem['allowed_actions']=[];
    if(row.domain!=='INCIDENT'&&externalSendEnabled&&row.status==='DEAD_LETTER'&&row.side_effect_state==='NOT_ATTEMPTED'&&(row.domain==='SESSION'||p.roles.some(r=>['ADMIN','DISPATCHER'].includes(r))||row.assignee_id===p.principal_id))allowed.push('RETRY');
    if(row.domain!=='INCIDENT'&&externalSendEnabled&&row.status==='RECONCILIATION_REQUIRED'&&unknown&&p.roles.includes('ADMIN'))allowed.push('RECONCILE');
    return {domain:row.domain,parent_id:row.parent_id,delivery_id:row.delivery_id,source_kind:row.source_kind,route_kind:row.route_kind,destination_type:row.destination_type,status:row.status,side_effect_state:row.side_effect_state,attempt_count:row.attempt_count,last_attempt:row.last_attempt,safe_summary:row.summary??(row.domain==='SESSION'?'会话外部消息':'工单通知'),error_code:unknown?'RESULT_UNCONFIRMED':'FAILURE_RECORDED',created_at:row.created_at,updated_at:row.updated_at,sent_at:row.sent_at,allowed_actions:allowed,parent_link:row.domain==='INCIDENT'?'/workbench/app/incidents/'+row.parent_id:row.domain==='SESSION'?'/workbench/app/conversations/'+row.parent_id:'/workbench/app/items/ticket/'+row.parent_id};
  }
  async function ticketRows(tx:PostgresTransaction,p:WorkbenchPrincipal,f:Filters,pos:Position|null,item?:{parent:string;delivery:string}) {
    const predicate=ticketPredicateP2016(p);
    const values:unknown[]=[...predicate.values,f.route,f.state,pos?.at??null,pos?.id??null,item?.parent??null,item?.delivery??null,f.limit+1];
    const result=await tx.query<ExceptionRow>(`WITH visible AS (
      SELECT d.*,b.ticket_id,b.destination_type,t.assignee_id FROM communication.ticket_notification_binding b
      JOIN pilot_ticket.ticket t ON t.id=b.ticket_id JOIN communication.delivery d ON d.id=b.delivery_id
      WHERE ${predicate.sql} AND ${exception}
        AND ($4='ALL' OR ${route}=$4)
        AND ($5='ALL' OR ($5='UNKNOWN' AND d.side_effect_state='UNKNOWN') OR ($5='FAILED' AND d.side_effect_state='NOT_ATTEMPTED'))
        AND ($6::timestamp IS NULL OR (d.created_at,d.id)<($6::timestamp,$7::uuid))
        AND ($8::uuid IS NULL OR (t.id=$8::uuid AND d.id=$9::uuid))
      ORDER BY d.created_at DESC,d.id DESC LIMIT $10
    ) SELECT 'TICKET' AS domain,d.ticket_id::text AS parent_id,d.id::text AS delivery_id,'TICKET_NOTIFICATION' AS source_kind,
      ${route} AS route_kind,d.destination_type,d.status,d.side_effect_state,d.attempt_count,d.assignee_id::text,
      ${stamp('d.created_at')} AS created_at,${stamp('d.updated_at')} AS updated_at,${stamp('d.sent_at')} AS sent_at,
      CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('attempt_no',a.attempt_no,'outcome',a.outcome,'side_effect_state',a.side_effect_state,'started_at',${stamp('a.started_at')},'finished_at',${stamp('a.completed_at')}) END AS last_attempt
      FROM visible d LEFT JOIN LATERAL (SELECT id,attempt_no,outcome,side_effect_state,started_at,completed_at FROM communication.delivery_attempt a WHERE a.delivery_id=d.id ORDER BY attempt_no DESC LIMIT 1) a ON TRUE
      ORDER BY d.created_at DESC,d.id DESC`,values);
    return result.rows;
  }
  async function incidentRows(tx:PostgresTransaction,f:Filters,pos:Position|null,scope:NotificationExceptionIncidentScope|null,publication:boolean,item?:{parent:string;delivery:string}) {
    if(!scope?.lifecycle||publication&&!scope.publicProgress)return [];
    // The 058-only summary column is parsed only after the original full purpose
    // guard succeeds. Old lifecycle facts stay readable in a 032-only host.
    const purpose=publication?"b.template_code='INCIDENT_PUBLIC_PROGRESS_DIRECT' AND e.event_type='incident.public_progress_published' AND m.sender_system_code='INCIDENT_PUBLIC_PROGRESS' AND c.confirmed_scope=ANY($8::text[])":"b.template_code<>'INCIDENT_PUBLIC_PROGRESS_DIRECT' AND m.sender_system_code='HUMAN_CONFIRMED_INCIDENT'";
    const summary=publication?'e.public_progress_summary':"CASE WHEN b.template_code LIKE 'INCIDENT_CONFIRMED_%' THEN '公共故障确认通知' WHEN b.template_code='INCIDENT_INVESTIGATING_DIRECT' THEN '公共故障调查通知' WHEN b.template_code LIKE 'INCIDENT_RESOLVED_%' THEN '公共故障恢复通知' ELSE '公共故障关闭通知' END";
    const q=await tx.query<ExceptionRow>(`WITH visible AS (
      SELECT d.*,c.id AS incident_id,${summary} AS summary FROM communication.incident_notification_binding b
      JOIN incident.incident c ON c.id=b.incident_id JOIN incident.incident_event e ON e.id=b.incident_event_id AND e.incident_id=c.id
      JOIN communication.message m ON m.id=b.communication_message_id JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
      WHERE ${purpose} AND m.visibility='EXTERNAL' AND m.purpose='SYSTEM_NOTIFICATION' AND ${exception}
        AND NOT EXISTS(SELECT 1 FROM communication.ticket_notification_binding tb WHERE tb.delivery_id=d.id)
        AND ($1='ALL' OR ${route}=$1)
        AND ($2='ALL' OR ($2='UNKNOWN' AND d.side_effect_state='UNKNOWN') OR ($2='FAILED' AND d.side_effect_state='NOT_ATTEMPTED'))
        AND ($3::timestamp IS NULL OR (d.created_at,d.id)<($3::timestamp,$4::uuid))
        AND ($5::uuid IS NULL OR (c.id=$5::uuid AND d.id=$6::uuid))
      ORDER BY d.created_at DESC,d.id DESC LIMIT $7
    ) SELECT 'INCIDENT' AS domain,d.incident_id::text AS parent_id,d.id::text AS delivery_id,'${publication?'INCIDENT_PUBLIC_PROGRESS':'INCIDENT_LIFECYCLE'}' AS source_kind,
      ${route} AS route_kind,d.target_type AS destination_type,d.status,d.side_effect_state,d.attempt_count,NULL::text AS assignee_id,d.summary,
      ${stamp('d.created_at')} AS created_at,${stamp('d.updated_at')} AS updated_at,${stamp('d.sent_at')} AS sent_at,
      CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('attempt_no',a.attempt_no,'outcome',a.outcome,'side_effect_state',a.side_effect_state,'started_at',${stamp('a.started_at')},'finished_at',${stamp('a.completed_at')}) END AS last_attempt
      FROM visible d LEFT JOIN LATERAL (SELECT id,attempt_no,outcome,side_effect_state,started_at,completed_at FROM communication.delivery_attempt a WHERE a.delivery_id=d.id ORDER BY attempt_no DESC LIMIT 1) a ON TRUE
      ORDER BY d.created_at DESC,d.id DESC`,[f.route,f.state,pos?.at??null,pos?.id??null,item?.parent??null,item?.delivery??null,f.limit+1,...(publication?[scope.publicScopes]:[])]);
    return q.rows;
  }
  async function sessionRows(tx:PostgresTransaction,p:WorkbenchPrincipal,f:Filters,pos:Position|null,item?:{parent:string;delivery:string}) {
    const predicate=authorization.sessionAccessPredicate(p);
    // A 031-only host must remain usable. Bindings, when installed, take domain
    // precedence; an unreadable Ticket/Incident must never fall through as a Session.
    const incidentBindings=(await tx.query<{present:boolean}>("SELECT to_regclass('communication.incident_notification_binding') IS NOT NULL AS present")).rows[0]?.present===true;
    const result=await tx.query<ExceptionRow>(`WITH visible AS (
      SELECT d.*,s.id AS session_id FROM communication.message m JOIN conversation.session s ON s.id=m.session_id
      LEFT JOIN conversation.assignment a ON a.session_id=s.id LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=s.service_intake_id
      JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
      WHERE ${predicate.sql} AND m.visibility='EXTERNAL' AND m.purpose<>'INTERNAL_NOTE' AND ${exception}
        AND NOT EXISTS(SELECT 1 FROM communication.ticket_notification_binding b WHERE b.delivery_id=d.id)
        ${incidentBindings?'AND NOT EXISTS(SELECT 1 FROM communication.incident_notification_binding b WHERE b.communication_message_id=m.id)':''}
        AND m.sender_system_code IS DISTINCT FROM 'HUMAN_CONFIRMED_INCIDENT' AND m.sender_system_code IS DISTINCT FROM 'INCIDENT_PUBLIC_PROGRESS'
        AND ($5='ALL' OR ${route}=$5)
        AND ($6='ALL' OR ($6='UNKNOWN' AND d.side_effect_state='UNKNOWN') OR ($6='FAILED' AND d.side_effect_state='NOT_ATTEMPTED'))
        AND ($7::timestamp IS NULL OR (d.created_at,d.id)<($7::timestamp,$8::uuid))
        AND ($9::uuid IS NULL OR (s.id=$9::uuid AND d.id=$10::uuid))
      ORDER BY d.created_at DESC,d.id DESC LIMIT $11
    ) SELECT 'SESSION' AS domain,d.session_id::text AS parent_id,d.id::text AS delivery_id,'SESSION_MESSAGE' AS source_kind,
      ${route} AS route_kind,d.target_type AS destination_type,d.status,d.side_effect_state,d.attempt_count,NULL::text AS assignee_id,
      ${stamp('d.created_at')} AS created_at,${stamp('d.updated_at')} AS updated_at,${stamp('d.sent_at')} AS sent_at,
      CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('attempt_no',a.attempt_no,'outcome',a.outcome,'side_effect_state',a.side_effect_state,'started_at',${stamp('a.started_at')},'finished_at',${stamp('a.completed_at')}) END AS last_attempt
      FROM visible d LEFT JOIN LATERAL (SELECT id,attempt_no,outcome,side_effect_state,started_at,completed_at FROM communication.delivery_attempt a WHERE a.delivery_id=d.id ORDER BY attempt_no DESC LIMIT 1) a ON TRUE
      ORDER BY d.created_at DESC,d.id DESC`,[...predicate.values,f.route,f.state,pos?.at??null,pos?.id??null,item?.parent??null,item?.delivery??null,f.limit+1]);
    return result.rows;
  }
  async function read<T>(authContext:unknown,run:(tx:PostgresTransaction,p:WorkbenchPrincipal)=>Promise<T>) {
    if(!enabled)failP2016('NOT_FOUND',404);
    return transactionP2016(pool,async tx=>{
      await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
      const principal=await query.principal(authContext,tx);return run(tx,principal);
    });
  }
  async function list(authContext:unknown,url:URL):Promise<NotificationExceptionPage> {
    return read(authContext,async(tx,p)=>{
      const f=filters(url),scope=['ALL','INCIDENT'].includes(f.domain)?await incidentScope?.({authContext,tx})??null:null;
      f.scopeKey=JSON.stringify(scope);const pos=decode(f.cursor,p,f);
      const rows:ExceptionRow[]=[];
      if(['ALL','TICKET'].includes(f.domain))rows.push(...await ticketRows(tx,p,f,pos));
      if(['ALL','SESSION'].includes(f.domain))rows.push(...await sessionRows(tx,p,f,pos));
      if(['ALL','INCIDENT'].includes(f.domain)){rows.push(...await incidentRows(tx,f,pos,scope,false));rows.push(...await incidentRows(tx,f,pos,scope,true));}
      rows.sort((a,b)=>a.created_at===b.created_at?(a.delivery_id<b.delivery_id?1:a.delivery_id>b.delivery_id?-1:0):a.created_at<b.created_at?1:-1);
      const hasMore=rows.length>f.limit,items=rows.slice(0,f.limit).map(row=>project(row,p)),last=items.at(-1);
      return publicP2016({items,has_more:hasMore,next_cursor:hasMore&&last?encode({at:last.created_at,id:last.delivery_id},p,f):null});
    });
  }
  async function item(authContext:unknown,domain:string,parent:string,delivery:string):Promise<NotificationExceptionItem> {
    return read(authContext,async(tx,p)=>{
      const f:Filters={domain:domain.toUpperCase(),route:'ALL',state:'ALL',limit:1,cursor:null,scopeKey:''};
      const target={parent:uuidP2016(parent),delivery:uuidP2016(delivery)};
      const scope=domain==='incident'?await incidentScope?.({authContext,tx})??null:null;
      const rows=domain==='ticket'?await ticketRows(tx,p,f,null,target):domain==='session'?await sessionRows(tx,p,f,null,target):domain==='incident'?[...await incidentRows(tx,f,null,scope,false,target),...await incidentRows(tx,f,null,scope,true,target)]:[];
      if(rows.length!==1)failP2016('NOT_FOUND',404);return publicP2016(project(rows[0] as ExceptionRow,p));
    });
  }
  return Object.freeze({list,item,async handler({request,response,url,authContext,json}:HttpContext) {
    if(!enabled||!/^\/api\/notification-exceptions(?:\/|$)/u.test(url.pathname))return false;
    if(request.method!=='GET')failP2016('NOT_FOUND',404);
    if(url.pathname==='/api/notification-exceptions'){json(response,200,await list(authContext,url));return true;}
    const match=/^\/api\/notification-exceptions\/(ticket|session|incident)\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/iu.exec(url.pathname);
    if(!match||url.searchParams.size)failP2016('NOT_FOUND',404);
    json(response,200,await item(authContext,(match[1] as string).toLowerCase(),match[2] as string,match[3] as string));return true;
  }});
}
