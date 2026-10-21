import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createWeb01WorkbenchQuery,Web01CardRow} from './web01-workbench-query.mjs';
import {workbenchSearchCardsSql,HANDLING_CARD_SQL,COMMUNICATION_CARD_SQL,FOLLOW_CARD_SQL} from './web01-workbench-query.mjs';
import type {WorkbenchSessionPredicate,createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {SOURCE_GROUP_ORIGIN_BINDING_SQL,GROUP_REF_SQL,VALID_GROUP_SQL} from './workbench-source-groups.mjs';
import {SUPPLEMENT_MATERIALS_SQL,SUPPLEMENT_RESOLUTION_SQL} from './workbench-supplement-follow-up.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {failP2016,localP2016,uuidP2016,limitP2016,publicP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {normalizeSearchCriteria,searchCriteriaKey} from './workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria,WorkbenchSearchRequest,WorkbenchSearchPage} from '../contracts/workbench_search_contracts.js';
import {FOLLOW_UP_ACTIVE_SQL} from './workbench-follow-up-schedules.mjs';
import {manualReportsSchemaReady} from './workbench-manual-reports.mjs';
import {followUpSchemaReady} from '../scripts/workbench-follow-up-schedules-migrate.mjs';
import {supplementFollowUpSchemaReady} from '../scripts/workbench-supplement-follow-up-migrate.mjs';
import {followSchemaReady} from '../scripts/workbench-follow-migrate.mjs';
import type {WorkbenchSearchPort} from './workbench-search-port.mjs';

interface Features {follow:boolean;supplements:boolean;schedules:boolean;manual:boolean;manualReview:boolean;sourceGroups:boolean}
interface Options {pool:PostgresPool;query:P2016TicketQuery;cards:ReturnType<typeof createWeb01WorkbenchQuery>;enabled?:boolean;localTestProfile?:boolean;features:Features;
 currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate']|undefined}
interface SearchRow extends Web01CardRow {order_at:string;order_group:number;safety_signature:string}
interface Window {from:string;until:string}
interface Cursor {v:1;binding:string;criteria:string;from:string;until:string;at:string;order_group:0|1;kind:'ticket'|'review'|'intake';id:string}
function hash(value:string):string{return createHash('sha256').update(value).digest('hex');}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))failP2016('CURSOR_INVALID');return value as Record<string,unknown>;
}
export function createWorkbenchSearch({pool,query,cards,enabled=false,localTestProfile=false,features,currentSessionPredicate}:Options):WorkbenchSearchPort{
 if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
 const secret=randomBytes(32),rates=new Map<string,{started:number;count:number}>();let busy=false;
 function rate(principalId:string){
  const now=performance.now();for(const [id,state]of rates)if(now-state.started>=60000)rates.delete(id);
  let state=rates.get(principalId);
  if(!state){if(rates.size>=256)throw new WorkbenchError('P2_016_SEARCH_RATE_LIMITED',429);state={started:now,count:0};rates.set(principalId,state);}
  if(state.count>=20||busy)throw new WorkbenchError('P2_016_SEARCH_RATE_LIMITED',429);state.count++;busy=true;
 }
 function binding(authContext:unknown,p:WorkbenchPrincipal):string{
  const auth=object(authContext);let session:string;
  if(typeof auth.session_id==='string')session=uuidP2016(auth.session_id);
  else if(localTestProfile&&typeof auth.csrf_token==='string'&&auth.csrf_token.length>=16)session='local-test:'+auth.csrf_token;
  else failP2016('DISABLED',503);
  return createHmac('sha256',secret).update(JSON.stringify([p.principal_id,session,auth.auth_method,auth.expires_epoch_ms,[...p.roles].sort(),[...p.team_ids].sort()])).digest('hex');
 }
 function sessionPredicate(authContext:unknown,p:WorkbenchPrincipal,start=1):WorkbenchSessionPredicate{
  const auth=object(authContext);
  if(currentSessionPredicate)return currentSessionPredicate(authContext,p.principal_id,start);
  if(!localTestProfile||auth.session_id!==undefined)failP2016('DISABLED',503);
  if(auth.principal_id!==p.principal_id||typeof auth.expires_epoch_ms!=='string'||!/^[1-9][0-9]{0,15}$/u.test(auth.expires_epoch_ms))throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
  return {sql:`$${start}::bigint>platform.physical_epoch_ms()`,values:[auth.expires_epoch_ms]};
 }
 function encode(value:Cursor):string{
  const payload=Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('base64url');const cursor=payload+'.'+signature;
  if(cursor.length>2048)failP2016('ACTION_FAILED',503);return cursor;
 }
 function decode(value:unknown):Cursor|null{
  if(value===null)return null;
  if(typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value))failP2016('CURSOR_INVALID');
  const [payload,signature]=value.split('.');if(!payload||!signature)failP2016('CURSOR_INVALID');
  const actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',secret).update(payload).digest();
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))failP2016('CURSOR_INVALID');
  let raw:unknown;try{raw=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{failP2016('CURSOR_INVALID');}
  const c=object(raw),keys=['v','binding','criteria','from','until','at','order_group','kind','id'];
  if(Object.keys(c).length!==keys.length||Object.keys(c).some(key=>!keys.includes(key))||c.v!==1||
   typeof c.binding!=='string'||!/^[a-f0-9]{64}$/u.test(c.binding)||typeof c.criteria!=='string'||!/^[a-f0-9]{64}$/u.test(c.criteria)||
   (c.order_group!==0&&c.order_group!==1)||(c.kind!=='ticket'&&c.kind!=='review'&&c.kind!=='intake'))failP2016('CURSOR_INVALID');
  return {v:1,binding:c.binding,criteria:c.criteria,from:localP2016(c.from),until:localP2016(c.until),at:localP2016(c.at),
   order_group:c.order_group,kind:c.kind,id:uuidP2016(c.id)};
 }
 async function ready(tx:PostgresTransaction,c:WorkbenchSearchCriteria){
  if((c.scope==='related'||c.responsibility==='following')&&(!features.follow||!await followSchemaReady(tx)))failP2016('DISABLED',503);
  if(c.supplement!=='any'&&(!features.supplements||!await supplementFollowUpSchemaReady(tx)))failP2016('DISABLED',503);
  if(c.schedule!=='any'&&(!features.schedules||!await followUpSchemaReady(tx)))failP2016('DISABLED',503);
  if(features.manual&&!await manualReportsSchemaReady(tx))failP2016('DISABLED',503);
  if(c.source_group_ref!==null&&!features.sourceGroups)failP2016('DISABLED',503);
  if(c.sources.some(source=>source==='MANUAL_PHONE'||source==='MANUAL_ON_SITE')&&!features.manual)failP2016('DISABLED',503);
 }
 function sql({web,manual,supplements,schedules}:{web:boolean;manual:boolean;supplements:boolean;schedules:boolean}){
  const followed=features.follow?FOLLOW_CARD_SQL:'FALSE';
  const supplement=supplements?`LEFT JOIN LATERAL (
   ${SUPPLEMENT_MATERIALS_SQL.replaceAll('$1::uuid','cards.intake_id::uuid').replaceAll('$2::uuid','cards.id::uuid')}
   SELECT count(*)::integer AS material_count,COALESCE(bool_or(proof.id IS NULL),FALSE) AS pending
   FROM materials m LEFT JOIN LATERAL (${SUPPLEMENT_RESOLUTION_SQL.replaceAll('$2::uuid','cards.id::uuid')}) proof ON TRUE
  ) supplement ON cards.kind='ticket'`:`LEFT JOIN LATERAL (SELECT 0 AS material_count,FALSE AS pending) supplement ON TRUE`;
  const schedule=schedules?`LEFT JOIN LATERAL (
   SELECT s.due_epoch_ms FROM pilot_ticket.follow_up_schedule s
   JOIN pilot_ticket.ticket t ON t.id=s.ticket_id
   LEFT JOIN pilot_ticket.ticket_event start_event ON start_event.ticket_id=s.ticket_id AND start_event.event_id=s.scheduled_event_id
   WHERE cards.kind='ticket' AND s.ticket_id=cards.id::uuid AND s.due_at IS NOT NULL AND s.due_epoch_ms IS NOT NULL
    AND (${FOLLOW_UP_ACTIVE_SQL})
  ) schedule ON TRUE`:`LEFT JOIN LATERAL (SELECT NULL::bigint AS due_epoch_ms) schedule ON TRUE`;
  const webText=web?`LEFT JOIN LATERAL (
   SELECT string_agg(concat_ws(' ',s.safe_content->>'description',s.safe_content->'location'->>'text',s.safe_content->>'reported_department_text'),' ') AS value
   FROM intake.web_request_binding b JOIN intake.web_submission s ON s.intake_id=b.intake_id
   WHERE b.intake_id=i.id AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms()
    AND s.retention_until_epoch_ms>platform.physical_epoch_ms() AND s.kind='SUBMIT' AND i.source_provider='YIXIAOXIU_WEB'
  ) web_text ON TRUE`:`LEFT JOIN LATERAL (SELECT NULL::text AS value) web_text ON TRUE`;
  const manualText=manual?`CASE WHEN i.source_channel='MANUAL' AND i.source_provider='STAFF_MANUAL_REPORT' THEN concat_ws(' ',
    i.manual_report_snapshot->>'description',i.manual_report_snapshot->'location'->>'text',
    i.manual_report_snapshot->'reporter'->>'name',i.manual_report_snapshot->'reporter'->>'contact',
    i.manual_report_snapshot->'reporter'->>'department',
    (SELECT string_agg(d.value#>>'{}',' ') FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(i.manual_report_snapshot->'reporter'->'departments')='array'
      THEN i.manual_report_snapshot->'reporter'->'departments' ELSE '[]'::jsonb END) d(value)))
    ELSE NULL END`:'NULL::text';
  const source=manual?`CASE WHEN i.source_provider='YIXIAOXIU_WEB' THEN 'WEB_REQUEST'
    WHEN i.source_channel='MANUAL' THEN CASE i.manual_report_snapshot->>'source' WHEN 'PHONE' THEN 'MANUAL_PHONE' WHEN 'ON_SITE' THEN 'MANUAL_ON_SITE' END
    ELSE i.source_channel END`:`CASE WHEN i.source_provider='YIXIAOXIU_WEB' THEN 'WEB_REQUEST' ELSE i.source_channel END`;
  return workbenchSearchCardsSql(features.manualReview).replace('WITH cards AS (','WITH cards AS MATERIALIZED (')+`,
  origins AS (SELECT r.*,CASE WHEN binding.count=0 THEN r.intake_id::uuid
    WHEN binding.count=1 AND binding.retained THEN binding.origin::uuid ELSE NULL END AS origin_intake_id
   FROM cards r LEFT JOIN LATERAL (${SOURCE_GROUP_ORIGIN_BINDING_SQL}) binding ON TRUE),
  enriched AS MATERIALIZED (
   SELECT cards.*,${source} AS search_source,
    CASE WHEN ${VALID_GROUP_SQL} THEN ${GROUP_REF_SQL} ELSE NULL END AS group_ref,
    (${HANDLING_CARD_SQL}) AS handling,(${COMMUNICATION_CARD_SQL}) AS communication,(${followed}) AS following,
    handling.resolver_team_id AS handling_team,handling.assignee_id::text AS handling_person,
    supplement.material_count,supplement.pending AS pending_supplement,schedule.due_epoch_ms,
    lower(concat_ws(' ',cards.number,cards.title,cards.location,
     CASE WHEN i.source_provider<>'STAFF_MANUAL_REPORT' OR ${manual?'TRUE':'FALSE'} THEN i.summary END,
     profile.value,web_text.value,${manualText})) AS search_text,
    CASE WHEN $5::text='all' THEN CASE WHEN cards.status IN ('RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED','COMPLETED','IGNORED') THEN 0 ELSE 1 END
     ELSE CASE WHEN cards.completed_at IS NOT NULL THEN 1 ELSE 0 END END AS order_group,
    CASE WHEN cards.completed_at IS NOT NULL THEN cards.completed_at ELSE cards.sort_at END AS order_at
   FROM origins cards
   LEFT JOIN intake.service_intake i ON i.id=cards.origin_intake_id AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
   LEFT JOIN pilot_ticket.ticket handling ON cards.kind='ticket' AND handling.id=cards.id::uuid
   LEFT JOIN LATERAL (
    SELECT concat_ws(' ',CASE WHEN jsonb_typeof(j.profile_snapshot->'contact'->'name')='string' AND char_length(j.profile_snapshot->'contact'->>'name') BETWEEN 1 AND 256 THEN j.profile_snapshot->'contact'->>'name' END,
     CASE WHEN jsonb_typeof(j.profile_snapshot->'contact'->'mobile')='string' AND char_length(j.profile_snapshot->'contact'->>'mobile') BETWEEN 1 AND 256 THEN j.profile_snapshot->'contact'->>'mobile' END,
     CASE WHEN jsonb_typeof(j.profile_snapshot->'contact'->'telephone')='string' AND char_length(j.profile_snapshot->'contact'->>'telephone') BETWEEN 1 AND 256 THEN j.profile_snapshot->'contact'->>'telephone' END,
     (SELECT string_agg(d.value->>'name',' ') FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(j.profile_snapshot->'memberships')='array' THEN j.profile_snapshot->'memberships' ELSE '[]'::jsonb END)
       WITH ORDINALITY d(value,ordinal) WHERE d.ordinal<=20 AND jsonb_typeof(d.value->'name')='string' AND char_length(d.value->>'name') BETWEEN 1 AND 256)) AS value
    FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
    WHERE l.source_intake_id=i.id AND l.reporter_identity_hash=j.reporter_identity_hash
     AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND j.profile_resolution_status='RESOLVED'
     AND j.profile_snapshot->>'source' IN ('WECOM_DIRECTORY','THIRD_PARTY_STAFF_DIRECTORY')
     AND jsonb_typeof(j.profile_snapshot->'version')='string' AND char_length(j.profile_snapshot->>'version') BETWEEN 1 AND 256
    ORDER BY l.leg_ordinal,l.id LIMIT 1
   ) profile ON TRUE
   ${webText} ${supplement} ${schedule}
  ), matched AS MATERIALIZED (SELECT * FROM enriched WHERE
   ($4::text='' OR strpos(search_text,lower($4))>0)
   AND ($5::text='all' OR ($5='pending' AND status IN ('NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'))
    OR ($5='active' AND status IN ('IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'))
    OR ($5='closed' AND status IN ('RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED','COMPLETED','IGNORED')))
   AND (status NOT IN ('RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED','COMPLETED','IGNORED')
    OR CASE WHEN $6::text='all' THEN TRUE WHEN $6='cancelled' THEN status='CANCELLED' ELSE status<>'CANCELLED' AND
      (status='RESOLVED' OR COALESCE(completed_at,CASE WHEN kind='intake' AND status IN ('COMPLETED','IGNORED') THEN updated_at END)::timestamp>=$7::timestamp
       AND COALESCE(completed_at,CASE WHEN kind='intake' AND status IN ('COMPLETED','IGNORED') THEN updated_at END)::timestamp<$8::timestamp) END)
   AND ($9::text='team' OR handling OR communication OR following)
   AND ($10::text='any' OR $10='handling' AND handling OR $10='communication' AND communication
    OR $10='following' AND following OR $10='unassigned' AND kind='ticket' AND handling_person IS NULL)
   AND ($11::text IS NULL OR kind='ticket' AND handling_team=$11)
   AND ($12::text IS NULL OR kind='ticket' AND handling_person=$12)
   AND (cardinality($13::text[])=0 OR search_source=ANY($13::text[]))
   AND ($14::text IS NULL OR group_ref=$14)
   AND (cardinality($15::text[])=0 OR status=ANY($15::text[]))
   AND ($16::text='any' OR kind='ticket' AND (
    $16='pending' AND pending_supplement OR $16='followed' AND material_count>0 AND NOT pending_supplement OR $16='none' AND material_count=0))
   AND ($17::text='any' OR kind='ticket' AND (
    $17='active' AND due_epoch_ms IS NOT NULL OR $17='due' AND due_epoch_ms<=platform.physical_epoch_ms() OR $17='none' AND due_epoch_ms IS NULL))
  )`;
 }
 return Object.freeze({async search({authContext,request}:{authContext:unknown;request:WorkbenchSearchRequest}):Promise<WorkbenchSearchPage>{
  if(!enabled)failP2016('NOT_FOUND',404);
  let c:WorkbenchSearchCriteria;try{c=normalizeSearchCriteria(request.criteria);}catch{failP2016();}
  const limit=limitP2016(request.limit),cursor=decode(request.cursor),criteria=hash(searchCriteriaKey(c));
  const initial=await query.principal(authContext);rate(initial.principal_id);
  try{
   const prepared=await transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
    const p=await query.principal(authContext,tx),scope=ticketPredicateP2016(p),bound=binding(authContext,p);await ready(tx,c);
    const session=sessionPredicate(authContext,p),valid=(await tx.query<{valid:boolean}>('SELECT '+session.sql+' AS valid',session.values)).rows[0];
    if(valid?.valid!==true)throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
    const window=(await tx.query<Window>(`SELECT to_char(date_trunc('day',platform.local_now())-interval '1 day','YYYY-MM-DD HH24:MI:SS') AS "from",
      to_char(date_trunc('day',platform.local_now())+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until`)).rows[0];if(!window)failP2016('ACTION_FAILED',503);
    if(cursor&&(cursor.binding!==bound||cursor.criteria!==criteria||cursor.from!==window.from||cursor.until!==window.until))failP2016('CURSOR_INVALID');
    const optional=(await tx.query<{web:boolean}>(`SELECT to_regclass('intake.web_submission') IS NOT NULL AND to_regclass('intake.web_request_binding') IS NOT NULL AS web`)).rows[0];
    if(features.supplements&&!await supplementFollowUpSchemaReady(tx))failP2016('DISABLED',503);
    if(features.schedules&&!await followUpSchemaReady(tx))failP2016('DISABLED',503);
    if(features.follow&&!await followSchemaReady(tx))failP2016('DISABLED',503);
    if(optional?.web!==true){
     const material=await tx.query(workbenchSearchCardsSql(features.manualReview)+" SELECT 1 FROM cards c JOIN intake.service_intake i ON i.id=c.intake_id::uuid WHERE i.source_provider='YIXIAOXIU_WEB' AND i.retention_until_epoch_ms>platform.physical_epoch_ms() LIMIT 1",scope.values);
     if(material.rowCount||c.sources.includes('WEB_REQUEST'))failP2016('DISABLED',503);
    }
    const relation=sql({web:optional?.web===true,manual:features.manual,supplements:features.supplements,schedules:features.schedules});
    const values=[...scope.values,c.q,c.column,c.range,window.from,window.until,c.scope,c.responsibility,c.resolver_team_id,c.assignee_id,[...c.sources],c.source_group_ref,[...c.statuses],c.supplement,c.schedule];
    if(cursor){
     const anchor=await tx.query(relation+' SELECT 1 FROM matched WHERE kind=$18 AND id=$19 AND order_at=$20 AND order_group=$21',[...values,cursor.kind,cursor.id,cursor.at,cursor.order_group]);
     if(anchor.rowCount!==1)failP2016('CURSOR_INVALID');
    }
    const result=await tx.query<SearchRow>(relation+` SELECT *,encode(sha256(convert_to(to_jsonb(matched)::text,'UTF8')),'hex') AS safety_signature FROM matched
     WHERE ($18::text IS NULL OR (order_group,order_at,kind,id)<($19::integer,$18::text,$20::text,$21::text))
     ORDER BY order_group DESC,order_at DESC,kind DESC,id DESC LIMIT $22`,
     [...values,cursor?.at??null,cursor?.order_group??null,cursor?.kind??null,cursor?.id??null,limit+1]);
    return {selected:result.rows.slice(0,limit),relation,values,bound,window};
   });
   // Release the query connection before original public projections; a pool of one cannot deadlock.
   const items:WorkbenchSearchPage['items'][number][]=[];
   for(const row of prepared.selected){
    const current=await cards.authorizedItem(authContext,row.kind,row.id,false);
    if(current.kind!==row.kind||current.id!==row.id)failP2016('CURSOR_INVALID');items.push(current);
   }
   const decoratedItems=await cards.decorateWebReportUrgency(items);
   const more=await transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
    const p=await query.principal(authContext,tx);if(binding(authContext,p)!==prepared.bound)failP2016('CURSOR_INVALID');await ready(tx,c);
    const values:unknown[]=[...prepared.values],session=sessionPredicate(authContext,p,values.length+1);values.push(...session.values);
    const parameter=(value:unknown)=>{values.push(value);return '$'+values.length;};
    const principalId=parameter(p.principal_id),roles=parameter([...p.roles]),teams=parameter([...p.team_ids]);
    const scope=`EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal scope_principal
      CROSS JOIN LATERAL (SELECT
        ARRAY(SELECT DISTINCT r.role::text FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=scope_principal.id) AS roles,
        ARRAY(SELECT DISTINCT m.team_id::text FROM pilot_ticket.pilot_team_member m WHERE m.principal_id=scope_principal.id) AS teams) scope_current
      WHERE scope_principal.id=${principalId}::uuid AND scope_principal.is_active
        AND scope_current.roles @> ${roles}::text[] AND scope_current.roles <@ ${roles}::text[]
        AND scope_current.teams @> ${teams}::text[] AND scope_current.teams <@ ${teams}::text[])`;
    const selected=parameter(prepared.selected.map(row=>row.kind+':'+row.id));
    const anchor=cursor?`EXISTS(SELECT 1 FROM matched WHERE kind=${parameter(cursor.kind)}::text AND id=${parameter(cursor.id)}::text
      AND order_at=${parameter(cursor.at)}::text AND order_group=${parameter(cursor.order_group)}::integer)`:'TRUE';
    const last=prepared.selected.at(-1);
    const next=last?`EXISTS(SELECT 1 FROM matched WHERE (order_group,order_at,kind,id)<(${parameter(last.order_group)}::integer,
      ${parameter(last.order_at)}::text,${parameter(last.kind)}::text,${parameter(last.id)}::text))`:'FALSE';
    // The original principal role/member facts must still equal the bound scope
    // in this final statement, after any readiness or projection wait. Session,
    // retention inputs and scope therefore share the same final READ snapshot.
    const proof=(await tx.query<{session_valid:boolean;scope_valid:boolean;anchor_valid:boolean;more:boolean;
      items:{kind:string;id:string;safety_signature:string}[]}>(prepared.relation+` SELECT (${session.sql}) AS session_valid,
      (${scope}) AS scope_valid,(${anchor}) AS anchor_valid,(${next}) AS more,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',m.kind,'id',m.id,'safety_signature',encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')))
        FROM matched m WHERE (m.kind||':'||m.id)=ANY(${selected}::text[])),'[]'::jsonb) AS items`,values)).rows[0];
    if(proof?.session_valid!==true)throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
    if(proof.scope_valid!==true)failP2016('CURSOR_INVALID');
    if(!proof.anchor_valid)failP2016('CURSOR_INVALID');
    const current=new Map(proof.items.map(row=>[row.kind+':'+row.id,row.safety_signature]));
    if(proof.items.length!==prepared.selected.length||prepared.selected.some(row=>current.get(row.kind+':'+row.id)!==row.safety_signature))failP2016('CURSOR_INVALID');
    return proof.more;
   });
   const last=prepared.selected.at(-1),next=more&&last?encode({v:1,binding:prepared.bound,criteria,...prepared.window,at:last.order_at,order_group:last.order_group===1?1:0,kind:last.kind,id:last.id}):null;
   return publicP2016({items:decoratedItems,next_cursor:next,column:c.column,range:{...prepared.window,mode:c.range,timezone:'Asia/Shanghai' as const},criteria:c});
  }catch(error){if(error instanceof WorkbenchError)throw error;failP2016('ACTION_FAILED',503);}finally{busy=false;}
 }});
}
