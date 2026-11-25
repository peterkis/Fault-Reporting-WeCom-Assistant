import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createWeb01WorkbenchQuery,WorkbenchClock} from './web01-workbench-query.mjs';
import {buildCardSignaturesSql,buildCommunicationPredicateSql,buildFollowPredicateSql,createParamBuilder,readWorkbenchClock} from './web01-workbench-query.mjs';
import type {SqlParamBuilder} from './web01-workbench-query.mjs';
import type {WorkbenchSessionPredicate,createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {sourceGroupOriginBindingSql,GROUP_REF_SQL,validGroupSql} from './workbench-source-groups.mjs';
import {supplementMaterialsSql,SUPPLEMENT_RESOLUTION_SQL} from './workbench-supplement-follow-up.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {failP2016,localP2016,uuidP2016,limitP2016,publicP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {normalizeSearchCriteria,searchCriteriaKey} from '../../../shared/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria,WorkbenchSearchStatus,WorkbenchSearchRequest,WorkbenchSearchPage} from '../../../contracts/workbench_search_contracts.js';
import {FOLLOW_UP_ACTIVE_SQL} from './workbench-follow-up-schedules.mjs';
import {manualReportsSchemaReady} from './workbench-manual-reports.mjs';
import {followUpSchemaReady} from '../scripts/workbench-follow-up-schedules-migrate.mjs';
import {supplementFollowUpSchemaReady} from '../scripts/workbench-supplement-follow-up-migrate.mjs';
import {followSchemaReady} from '../scripts/workbench-follow-migrate.mjs';
import type {WorkbenchSearchPort} from './workbench-search-port.mjs';

interface Features {follow:boolean;supplements:boolean;schedules:boolean;manual:boolean;manualReview:boolean;sourceGroups:boolean}
interface Options {pool:PostgresPool;query:P2016TicketQuery;cards:ReturnType<typeof createWeb01WorkbenchQuery>;enabled?:boolean;localTestProfile?:boolean;features:Features;
 currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate']|undefined}
interface SearchRow {kind:'ticket'|'review'|'intake';id:string;intake_id:string;order_at:string;order_group:number;safety_signature:string;card_signature?:string|null}
interface Window {from:string;until:string}
interface WindowClock {from:string;until:string;now_epoch:string;now_local:string}
interface Cursor {v:1;binding:string;criteria:string;from:string;until:string;at:string;order_group:0|1;kind:'ticket'|'review'|'intake';id:string}
const TICKET_OPEN_STATUSES=new Set(['NEW','QUEUED','ACCEPTED','REOPENED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR']);
const TICKET_PENDING_STATUSES=['NEW','QUEUED','ACCEPTED','REOPENED'];
const TICKET_ACTIVE_STATUSES=['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'];
const INTAKE_PENDING_STATUSES:readonly WorkbenchSearchStatus[]=['RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'];
const TICKET_ALL_STATUSES=new Set([...TICKET_OPEN_STATUSES,'RESOLVED','COMPLETED','DISMISSED']);
const INTAKE_ALL_STATUSES=new Set([...INTAKE_PENDING_STATUSES,'COMPLETED','DISMISSED']);

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

 /**
  * Builds a pushed-down search query allocating only parameters actually referenced in SQL.
  * When keyLimitParam / targetIdsParam are provided, bounds inner scans before LATERAL enrichment.
  */
 function sql({pb,principal,clock,c,window,web,manual,supplements,schedules,targetIdsParam,keyLimitParam,keyset,ctePrefix=''}:{pb:SqlParamBuilder;principal:WorkbenchPrincipal;clock:WorkbenchClock;c:WorkbenchSearchCriteria;window:Window;web:boolean;manual:boolean;supplements:boolean;schedules:boolean;targetIdsParam?:string;keyLimitParam?:string;keyset?:{atParam:string;groupParam:string;kindParam:string;idParam:string};ctePrefix?:string}){
  const pred=ticketPredicateP2016(principal);
  const isAdmin=()=>pb.once('isAdmin',pred.values[0],'boolean');
  const principalId=()=>pb.once('principalId',pred.values[1],'uuid');
  const teamIds=()=>pb.once('teamIds',pred.values[2],'text[]');
  const nowEpoch=()=>pb.once('nowEpoch',clock.nowEpoch,'bigint');
  const nowLocal=()=>pb.once('nowLocal',clock.nowLocal,'timestamp without time zone');
  const qParam=()=>pb.once('q',c.q,'text');
  const fromParam=()=>pb.once('from',window.from,'timestamp without time zone');
  const untilParam=()=>pb.once('until',window.until,'timestamp without time zone');
  const teamFilterParam=()=>pb.once('teamFilter',c.resolver_team_id,'text');
  const assigneeFilterParam=()=>pb.once('assigneeFilter',c.assignee_id,'text');
  const sourcesParam=()=>pb.once('sources',[...c.sources],'text[]');
  const groupRefParam=()=>pb.once('groupRef',c.source_group_ref,'text');
  const statusesParam=()=>pb.once('statuses',[...c.statuses],'text[]');

  const ticketOnly=c.responsibility==='handling'||c.responsibility==='unassigned'||c.resolver_team_id!==null||c.assignee_id!==null||c.supplement!=='any'||c.schedule!=='any'||c.column==='active';
  // Ticket filters allocate parameters only when a ticket branch is actually emitted (Codex 42A r1 H3):
  // an intake- or review-only status filter must not leave an untyped, unreferenced $n slot.
  const ticketFilters=()=>{
   const ticketScopeParts:string[]=[];
   if(c.scope==='related'){
    const parts=[`t.assignee_id=${principalId()}`,buildCommunicationPredicateSql({kind:'ticket',idExpr:'t.id',intakeIdExpr:'t.source_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()})];
    if(features.follow)parts.push(buildFollowPredicateSql({kind:'ticket',idExpr:'t.id',intakeIdExpr:'t.source_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}));
    ticketScopeParts.push('('+parts.join(' OR ')+')');
   }
   if(c.responsibility==='handling')ticketScopeParts.push(`t.assignee_id=${principalId()}`);
   else if(c.responsibility==='unassigned')ticketScopeParts.push(`t.assignee_id IS NULL`);
   else if(c.responsibility==='communication')ticketScopeParts.push(buildCommunicationPredicateSql({kind:'ticket',idExpr:'t.id',intakeIdExpr:'t.source_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}));
   else if(c.responsibility==='following')ticketScopeParts.push(features.follow?buildFollowPredicateSql({kind:'ticket',idExpr:'t.id',intakeIdExpr:'t.source_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}):'FALSE');
   if(c.resolver_team_id!==null)ticketScopeParts.push(`t.resolver_team_id=${teamFilterParam()}`);
   if(c.assignee_id!==null)ticketScopeParts.push(`t.assignee_id::text=${assigneeFilterParam()}`);
   if(c.statuses.length>0)ticketScopeParts.push(`t.status=ANY(${statusesParam()})`);
   if(targetIdsParam)ticketScopeParts.push(`t.id=ANY(${targetIdsParam})`);
   const ticketExtraWhere=ticketScopeParts.length?' AND '+ticketScopeParts.join(' AND '):'';
   const ticketVis=`(${isAdmin()} OR t.assignee_id=${principalId()} OR t.resolver_team_id=ANY(${teamIds()}))`;
   return {ticketExtraWhere,ticketVis};
  };

  const canPushBranchLimit=Boolean(keyLimitParam)&&c.q===''&&c.sources.length===0&&c.source_group_ref===null&&c.supplement==='any'&&c.schedule==='any';
  const branchKeyset=(groupExpr:string,atExpr:string,kindLiteral:string,idExpr:string)=>
   canPushBranchLimit&&keyset?` AND (${groupExpr},${atExpr},${kindLiteral}::text,${idExpr})<(${keyset.groupParam},${keyset.atParam},${keyset.kindParam},${keyset.idParam})`:'';
  const branchLimit=(orderBy:string)=>canPushBranchLimit&&keyLimitParam?` ORDER BY ${orderBy} LIMIT ${keyLimitParam}`:'';

  const ticketBranches:string[]=[];
  const wantsTicket=!c.statuses.length||c.statuses.some(s=>TICKET_ALL_STATUSES.has(s));
  if(wantsTicket){
   const {ticketExtraWhere,ticketVis}=ticketFilters();
   if(c.column==='all'||c.column==='pending'||c.column==='active'){
    const openCond=c.column==='pending'
     ?`t.status=ANY(ARRAY[${TICKET_PENDING_STATUSES.map(s=>`'${s}'`).join(',')}]::text[]) AND t.status NOT IN ('RESOLVED','COMPLETED','DISMISSED')`
     :c.column==='active'
      ?`t.status=ANY(ARRAY[${TICKET_ACTIVE_STATUSES.map(s=>`'${s}'`).join(',')}]::text[]) AND t.status NOT IN ('RESOLVED','COMPLETED','DISMISSED')`
      :`t.status NOT IN ('RESOLVED','COMPLETED','DISMISSED')`;
    const openGroup=c.column==='all'?'1::integer':'0::integer';
    ticketBranches.push(`(SELECT 'ticket'::text AS kind,t.id,t.source_intake_id AS intake_id,t.ticket_no AS number,t.title,t.status,t.reported_location_text AS location,
     t.resolver_team_id AS handling_team,t.assignee_id::text AS handling_person,(t.assignee_id=${principalId()}) AS ticket_handling,
     ${openGroup} AS order_group,date_trunc('second',t.updated_at) AS order_at,t.terminal_at AS ended_at,t.updated_at AS sort_at
     FROM pilot_ticket.ticket t
     WHERE ${openCond} AND ${ticketVis}${ticketExtraWhere}${branchKeyset(openGroup,"date_trunc('second',t.updated_at)","'ticket'",'t.id')}${branchLimit("date_trunc('second',t.updated_at) DESC,t.id DESC")})`);
   }
   if(c.column==='all'||c.column==='handled'){
    const handledGroup=c.column==='all'?'0::integer':'1::integer';
    if(c.closure_kind!=='dismissed'&&(!c.statuses.length||c.statuses.includes('RESOLVED'))){
     ticketBranches.push(`(SELECT 'ticket'::text AS kind,t.id,t.source_intake_id AS intake_id,t.ticket_no AS number,t.title,t.status,t.reported_location_text AS location,
      t.resolver_team_id AS handling_team,t.assignee_id::text AS handling_person,(t.assignee_id=${principalId()}) AS ticket_handling,
      ${handledGroup} AS order_group,t.terminal_at AS order_at,t.terminal_at AS ended_at,t.updated_at AS sort_at
      FROM pilot_ticket.ticket t
      WHERE t.status='RESOLVED' AND ${ticketVis}${ticketExtraWhere}${branchKeyset(handledGroup,'t.terminal_at',"'ticket'",'t.id')}${branchLimit('t.terminal_at DESC,t.id DESC')})`);
    }
    const termStatuses:readonly WorkbenchSearchStatus[]=c.closure_kind==='completed'?['COMPLETED']:c.closure_kind==='dismissed'?['DISMISSED']:['COMPLETED','DISMISSED'];
    if(!c.statuses.length||termStatuses.some(s=>c.statuses.includes(s))){
     const rangeWhere=c.range==='all'?'':` AND t.terminal_at>=${fromParam()} AND t.terminal_at<${untilParam()}`;
     ticketBranches.push(`(SELECT 'ticket'::text AS kind,t.id,t.source_intake_id AS intake_id,t.ticket_no AS number,t.title,t.status,t.reported_location_text AS location,
      t.resolver_team_id AS handling_team,t.assignee_id::text AS handling_person,(t.assignee_id=${principalId()}) AS ticket_handling,
      ${handledGroup} AS order_group,t.terminal_at AS order_at,t.terminal_at AS ended_at,t.updated_at AS sort_at
      FROM pilot_ticket.ticket t
      WHERE t.status IN (${termStatuses.map(s=>`'${s}'`).join(',')})${rangeWhere} AND ${ticketVis}${ticketExtraWhere}${branchKeyset(handledGroup,'t.terminal_at',"'ticket'",'t.id')}${branchLimit('t.terminal_at DESC,t.id DESC')})`);
    }
   }
  }

  const candidateBranches:string[]=[...ticketBranches];
  const wantsReview=!ticketOnly&&(c.column==='all'||c.column==='pending')&&(!c.statuses.length||c.statuses.includes('PENDING'));
  if(wantsReview){
   const reviewScope:string[]=[];
   if(c.scope==='related'){
    const parts=[buildCommunicationPredicateSql({kind:'review',idExpr:'r.id',intakeIdExpr:'r.service_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()})];
    if(features.follow)parts.push(buildFollowPredicateSql({kind:'review',idExpr:'r.id',intakeIdExpr:'r.service_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}));
    reviewScope.push('('+parts.join(' OR ')+')');
   }
   if(c.responsibility==='communication')reviewScope.push(buildCommunicationPredicateSql({kind:'review',idExpr:'r.id',intakeIdExpr:'r.service_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}));
   else if(c.responsibility==='following')reviewScope.push(features.follow?buildFollowPredicateSql({kind:'review',idExpr:'r.id',intakeIdExpr:'r.service_intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}):'FALSE');
   if(targetIdsParam)reviewScope.push(`r.id=ANY(${targetIdsParam})`);
   const reviewExtra=reviewScope.length?' AND '+reviewScope.join(' AND '):'';
   const reviewGroup=c.column==='all'?'1::integer':'0::integer';
   candidateBranches.push(`(SELECT 'review'::text AS kind,r.id,r.service_intake_id AS intake_id,i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,
    'PENDING'::text AS status,i.reported_location_text AS location,NULL::text AS handling_team,NULL::text AS handling_person,FALSE AS ticket_handling,
    ${reviewGroup} AS order_group,date_trunc('second',r.updated_at) AS order_at,NULL::timestamp without time zone AS ended_at,r.updated_at AS sort_at
    FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id
    JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
    WHERE r.status='PENDING' AND i.retention_until>${nowLocal()} AND j.retention_until_epoch_ms>${nowEpoch()}
     AND (${isAdmin()} OR t.assignee_id=${principalId()} OR t.resolver_team_id=ANY(${teamIds()}))
     AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=r.service_intake_id)
     AND (r.linked_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=r.linked_ticket_id))
     AND (j.linked_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=j.linked_ticket_id))
     AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item earlier WHERE earlier.service_intake_id=r.service_intake_id AND earlier.status='PENDING' AND (earlier.created_at,earlier.id)<(r.created_at,r.id))
     ${reviewExtra}${branchKeyset(reviewGroup,"date_trunc('second',r.updated_at)","'review'",'r.id')}${branchLimit("date_trunc('second',r.updated_at) DESC,r.id DESC")})`);
  }

  const wantsIntake=!ticketOnly&&(!c.statuses.length||c.statuses.some(s=>INTAKE_ALL_STATUSES.has(s)));
  if(wantsIntake){
   const intakeScope:string[]=[];
   if(c.scope==='related'){
    const parts=[buildCommunicationPredicateSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()})];
    if(features.follow)parts.push(buildFollowPredicateSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}));
    intakeScope.push('('+parts.join(' OR ')+')');
   }
   if(c.responsibility==='communication')intakeScope.push(buildCommunicationPredicateSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}));
   else if(c.responsibility==='following')intakeScope.push(features.follow?buildFollowPredicateSql({kind:'intake',idExpr:'i.id',intakeIdExpr:'i.id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}):'FALSE');
   if(c.statuses.length>0)intakeScope.push(`i.status=ANY(${statusesParam()})`);
   if(targetIdsParam)intakeScope.push(`i.id=ANY(${targetIdsParam})`);
   const intakeCommon=`${isAdmin()} AND i.retention_until>${nowLocal()}
    AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.source_intake_id=i.id)
    AND (i.pilot_ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual WHERE actual.id=i.pilot_ticket_id))
    AND NOT EXISTS (SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id JOIN pilot_ticket.ticket actual ON actual.id=j.linked_ticket_id WHERE l.source_intake_id=i.id)
    AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING')`+(intakeScope.length?' AND '+intakeScope.join(' AND '):'');

   if((c.column==='all'||c.column==='pending')&&(!c.statuses.length||INTAKE_PENDING_STATUSES.some(s=>c.statuses.includes(s)))){
    const openGroup=c.column==='all'?'1::integer':'0::integer';
    candidateBranches.push(`(SELECT 'intake'::text AS kind,i.id,i.id AS intake_id,i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,
     i.status,i.reported_location_text AS location,NULL::text AS handling_team,NULL::text AS handling_person,FALSE AS ticket_handling,
     ${openGroup} AS order_group,date_trunc('second',i.updated_at) AS order_at,NULL::timestamp without time zone AS ended_at,i.updated_at AS sort_at
     FROM intake.service_intake i
     WHERE ${intakeCommon} AND i.status=ANY(ARRAY[${INTAKE_PENDING_STATUSES.map(s=>`'${s}'`).join(',')}]::text[])${branchKeyset(openGroup,"date_trunc('second',i.updated_at)","'intake'",'i.id')}${branchLimit("date_trunc('second',i.updated_at) DESC,i.id DESC")})`);
   }
   if((c.column==='all'||c.column==='handled')&&c.closure_kind!=='completed'&&(!c.statuses.length||c.statuses.includes('DISMISSED'))){
    const handledGroup=c.column==='all'?'0::integer':'1::integer';
    const rangeWhere=c.range==='all'?'':` AND intake_closure.ended_at>=${fromParam()} AND intake_closure.ended_at<${untilParam()}`;
    candidateBranches.push(`(SELECT 'intake'::text AS kind,i.id,i.id AS intake_id,i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,
     i.status,i.reported_location_text AS location,NULL::text AS handling_team,NULL::text AS handling_person,FALSE AS ticket_handling,
     ${handledGroup} AS order_group,date_trunc('second',intake_closure.ended_at) AS order_at,intake_closure.ended_at AS ended_at,i.updated_at AS sort_at
     FROM pilot_ticket.closure_record intake_closure JOIN intake.service_intake i ON i.id=intake_closure.intake_id
     WHERE intake_closure.subject_type='INTAKE' AND intake_closure.restored_at IS NULL AND i.status='DISMISSED'${rangeWhere} AND ${intakeCommon}${branchKeyset(handledGroup,"date_trunc('second',intake_closure.ended_at)","'intake'",'i.id')}${branchLimit("date_trunc('second',intake_closure.ended_at) DESC,i.id DESC")})`);
   }
   if((c.column==='all'||c.column==='handled')&&c.closure_kind!=='dismissed'&&(!c.statuses.length||c.statuses.includes('COMPLETED'))){
    const rangeWhere=c.range==='all'?'':` AND closing_review.id IS NOT NULL AND closing_review.resolved_at>=${fromParam()} AND closing_review.resolved_at<${untilParam()}`;
    const compGroup=c.column==='all'?'0::integer':'CASE WHEN closing_review.id IS NOT NULL THEN 1 ELSE 0 END';
    const compAt=`date_trunc('second',COALESCE(closing_review.resolved_at,i.updated_at))`;
    candidateBranches.push(`(SELECT 'intake'::text AS kind,i.id,i.id AS intake_id,i.intake_no AS number,COALESCE(NULLIF(i.summary,''),'未提供报修描述') AS title,
     i.status,i.reported_location_text AS location,NULL::text AS handling_team,NULL::text AS handling_person,FALSE AS ticket_handling,
     ${compGroup} AS order_group,${compAt} AS order_at,CASE WHEN closing_review.id IS NOT NULL THEN closing_review.resolved_at END AS ended_at,i.updated_at AS sort_at
     FROM intake.service_intake i
     LEFT JOIN LATERAL (SELECT e.event_type,e.occurred_at,e.payload,e.aggregate_version,e.event_ordinal
       FROM intake.service_intake_event e WHERE e.intake_id=i.id AND i.status='COMPLETED'
         AND (e.event_type='intake.rule_decision_applied' AND e.payload->>'new_status'=i.status AND e.payload->>'old_status' IS DISTINCT FROM e.payload->>'new_status'
           OR e.event_type='intake.received' AND e.payload->>'status'=i.status)
       ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) closing ON TRUE
     LEFT JOIN intake.deterministic_decision closing_decision ON closing_decision.id=CASE
       WHEN closing.payload->>'decision_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (closing.payload->>'decision_id')::uuid END
       AND closing_decision.service_intake_id=i.id
       AND EXISTS(SELECT 1 FROM intake.contact_journey retained WHERE retained.id=closing_decision.journey_id AND retained.retention_until_epoch_ms>${nowEpoch()})
     LEFT JOIN intake.manual_review_item closing_review ON closing_review.resolution_decision_id=closing_decision.id
       AND closing_review.service_intake_id=i.id AND closing_review.journey_id=closing_decision.journey_id
       AND closing_review.status='RESOLVED' AND closing_decision.status='HUMAN_OVERRIDDEN'
       AND closing_review.resolved_by_principal_id::text=closing_decision.safe_result#>>'{human_override,principal_id}'
     WHERE i.status='COMPLETED'${rangeWhere} AND ${intakeCommon}${branchKeyset(compGroup,compAt,"'intake'",'i.id')}${branchLimit('order_group DESC,order_at DESC,i.id DESC')})`);
   }
  }

  const candidateSql=candidateBranches.length?candidateBranches.join('\n  UNION ALL\n  '):`SELECT NULL::text AS kind,NULL::uuid AS id,NULL::uuid AS intake_id,NULL::text AS number,NULL::text AS title,NULL::text AS status,NULL::text AS location,NULL::text AS handling_team,NULL::text AS handling_person,FALSE AS ticket_handling,0::integer AS order_group,NULL::timestamp without time zone AS order_at,NULL::timestamp without time zone AS ended_at,NULL::timestamp without time zone AS sort_at WHERE FALSE`;

  const commCards=buildCommunicationPredicateSql({kind:'any',idExpr:'cards.id',intakeIdExpr:'cards.intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()});
  const handlingCards=`cards.kind='ticket' AND EXISTS(SELECT 1 FROM pilot_ticket.ticket handling WHERE handling.id=cards.id AND handling.assignee_id=${principalId()})`;
  const followed=features.follow?buildFollowPredicateSql({kind:'any',idExpr:'cards.id',intakeIdExpr:'cards.intake_id',principalParam:principalId(),nowEpochParam:nowEpoch(),nowLocalParam:nowLocal()}):'FALSE';
  const supplement=supplements?`LEFT JOIN LATERAL (
   ${supplementMaterialsSql('cards.intake_id','cards.id',nowEpoch())}
   SELECT count(*)::integer AS material_count,COALESCE(bool_or(proof.id IS NULL),FALSE) AS pending
   FROM materials m LEFT JOIN LATERAL (${SUPPLEMENT_RESOLUTION_SQL.replaceAll('$2::uuid','cards.id')}) proof ON TRUE
  ) supplement ON cards.kind='ticket'`:`LEFT JOIN LATERAL (SELECT 0 AS material_count,FALSE AS pending) supplement ON TRUE`;
  const schedule=schedules?`LEFT JOIN LATERAL (
   SELECT s.due_epoch_ms FROM pilot_ticket.follow_up_schedule s
   JOIN pilot_ticket.ticket t ON t.id=s.ticket_id
   LEFT JOIN pilot_ticket.ticket_event start_event ON start_event.ticket_id=s.ticket_id AND start_event.event_id=s.scheduled_event_id
   WHERE cards.kind='ticket' AND s.ticket_id=cards.id AND s.due_at IS NOT NULL AND s.due_epoch_ms IS NOT NULL
    AND (${FOLLOW_UP_ACTIVE_SQL})
  ) schedule ON TRUE`:`LEFT JOIN LATERAL (SELECT NULL::bigint AS due_epoch_ms) schedule ON TRUE`;
  const webText=web?`LEFT JOIN LATERAL (
   SELECT string_agg(concat_ws(' ',s.safe_content->>'description',s.safe_content->'location'->>'text',s.safe_content->>'reported_department_text'),' ') AS value
   FROM intake.web_request_binding b JOIN intake.web_submission s ON s.intake_id=b.intake_id
   WHERE b.intake_id=i.id AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>${nowEpoch()}
    AND s.retention_until_epoch_ms>${nowEpoch()} AND s.kind='SUBMIT' AND i.source_provider='YIXIAOXIU_WEB'
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
  const validGroup=validGroupSql(nowLocal());
  const originBinding=sourceGroupOriginBindingSql(nowEpoch()).replaceAll('r.intake_id::uuid','r.intake_id').replaceAll('r.id::uuid','r.id');

  const matchedPredicates:string[]=[];
  if(c.q!=='')matchedPredicates.push(`strpos(search_text,lower(${qParam()}))>0`);
  if(c.scope!=='team')matchedPredicates.push(`(handling OR communication OR following)`);
  if(c.responsibility==='handling')matchedPredicates.push(`handling`);
  else if(c.responsibility==='communication')matchedPredicates.push(`communication`);
  else if(c.responsibility==='following')matchedPredicates.push(`following`);
  else if(c.responsibility==='unassigned')matchedPredicates.push(`kind='ticket' AND handling_person IS NULL`);
  if(c.resolver_team_id!==null)matchedPredicates.push(`kind='ticket' AND handling_team=${teamFilterParam()}`);
  if(c.assignee_id!==null)matchedPredicates.push(`kind='ticket' AND handling_person=${assigneeFilterParam()}`);
  if(c.sources.length>0)matchedPredicates.push(`search_source=ANY(${sourcesParam()})`);
  if(c.source_group_ref!==null)matchedPredicates.push(`group_ref=${groupRefParam()}`);
  if(c.supplement==='pending')matchedPredicates.push(`kind='ticket' AND pending_supplement`);
  else if(c.supplement==='followed')matchedPredicates.push(`kind='ticket' AND material_count>0 AND NOT pending_supplement`);
  else if(c.supplement==='none')matchedPredicates.push(`kind='ticket' AND material_count=0`);
  if(c.schedule==='active')matchedPredicates.push(`kind='ticket' AND due_epoch_ms IS NOT NULL`);
  else if(c.schedule==='due')matchedPredicates.push(`kind='ticket' AND due_epoch_ms<=${nowEpoch()}`);
  else if(c.schedule==='none')matchedPredicates.push(`kind='ticket' AND due_epoch_ms IS NULL`);
  const matchedWhere=matchedPredicates.length?'WHERE '+matchedPredicates.join('\n   AND '):'';

  return `WITH ${ctePrefix}candidate_keys AS (
  ${candidateSql}
  ), ${ctePrefix}origins AS (
   SELECT r.*,CASE WHEN binding.count=0 THEN r.intake_id
     WHEN binding.count=1 AND binding.retained THEN binding.origin::uuid ELSE NULL END AS origin_intake_id
    FROM ${ctePrefix}candidate_keys r LEFT JOIN LATERAL (${originBinding}) binding ON TRUE
  ), ${ctePrefix}enriched AS (
   SELECT cards.kind,cards.id,cards.intake_id,cards.number,cards.title,cards.status,cards.location,
    cards.handling_team,cards.handling_person,cards.order_group,cards.order_at,
    ${source} AS search_source,
    CASE WHEN ${validGroup} THEN ${GROUP_REF_SQL} ELSE NULL END AS group_ref,
    (${handlingCards}) AS handling,(${commCards}) AS communication,(${followed}) AS following,
    supplement.material_count,supplement.pending AS pending_supplement,schedule.due_epoch_ms,
    lower(concat_ws(' ',cards.number,cards.title,cards.location,
     CASE WHEN i.source_provider<>'STAFF_MANUAL_REPORT' OR ${manual?'TRUE':'FALSE'} THEN i.summary END,
     profile.value,web_text.value,${manualText})) AS search_text
   FROM ${ctePrefix}origins cards
   LEFT JOIN intake.service_intake i ON i.id=cards.origin_intake_id AND i.retention_until_epoch_ms>${nowEpoch()}
   LEFT JOIN LATERAL (
    SELECT concat_ws(' ',CASE WHEN jsonb_typeof(j.profile_snapshot->'contact'->'name')='string' AND char_length(j.profile_snapshot->'contact'->>'name') BETWEEN 1 AND 256 THEN j.profile_snapshot->'contact'->>'name' END,
     CASE WHEN jsonb_typeof(j.profile_snapshot->'contact'->'mobile')='string' AND char_length(j.profile_snapshot->'contact'->>'mobile') BETWEEN 1 AND 256 THEN j.profile_snapshot->'contact'->>'mobile' END,
     CASE WHEN jsonb_typeof(j.profile_snapshot->'contact'->'telephone')='string' AND char_length(j.profile_snapshot->'contact'->>'telephone') BETWEEN 1 AND 256 THEN j.profile_snapshot->'contact'->>'telephone' END,
     (SELECT string_agg(d.value->>'name',' ') FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(j.profile_snapshot->'memberships')='array' THEN j.profile_snapshot->'memberships' ELSE '[]'::jsonb END)
       WITH ORDINALITY d(value,ordinal) WHERE d.ordinal<=20 AND jsonb_typeof(d.value->'name')='string' AND char_length(d.value->>'name') BETWEEN 1 AND 256)) AS value
    FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
    WHERE l.source_intake_id=i.id AND l.reporter_identity_hash=j.reporter_identity_hash
     AND j.retention_until_epoch_ms>${nowEpoch()} AND j.profile_resolution_status='RESOLVED'
     AND j.profile_snapshot->>'source' IN ('WECOM_DIRECTORY','THIRD_PARTY_STAFF_DIRECTORY')
     AND jsonb_typeof(j.profile_snapshot->'version')='string' AND char_length(j.profile_snapshot->>'version') BETWEEN 1 AND 256
    ORDER BY l.leg_ordinal,l.id LIMIT 1
   ) profile ON TRUE
   ${webText} ${supplement} ${schedule}
  ), ${ctePrefix}matched AS (SELECT * FROM ${ctePrefix}enriched ${matchedWhere})`;
 }
 return Object.freeze({async search({authContext,request}:{authContext:unknown;request:WorkbenchSearchRequest}):Promise<WorkbenchSearchPage>{
  if(!enabled)failP2016('NOT_FOUND',404);
  let c:WorkbenchSearchCriteria;try{c=normalizeSearchCriteria(request.criteria);}catch{failP2016();}
  const limit=limitP2016(request.limit),cursor=decode(request.cursor),criteria=hash(searchCriteriaKey(c));
  const initial=await query.principal(authContext);rate(initial.principal_id);
  try{
   const prepared=await transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
    // Closure joins can cross LLVM cost thresholds even for a small interactive page.
    // Keep both bounded READ phases free of compilation work; the SQL limit is unchanged.
    await tx.query('SET LOCAL jit=off');
    const p=await query.principal(authContext,tx),scope=ticketPredicateP2016(p),bound=binding(authContext,p);await ready(tx,c);
    const session=sessionPredicate(authContext,p),valid=(await tx.query<{valid:boolean}>('SELECT '+session.sql+' AS valid',session.values)).rows[0];
    if(valid?.valid!==true)throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
    // The shared normalizer validates the calendar pair. Reuse the board's
    // inclusive civil-date convention and capture the transaction clock in one round trip.
    const windowClock=c.range==='custom'
     ?(await tx.query<WindowClock>(`SELECT to_char($1::date,'YYYY-MM-DD HH24:MI:SS') AS "from",
       to_char($2::date+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until,
       platform.physical_epoch_ms()::text AS now_epoch,to_char(platform.local_now(),'YYYY-MM-DD HH24:MI:SS') AS now_local`,[c.handled_from,c.handled_to])).rows[0]
     :(await tx.query<WindowClock>(`WITH stamp AS (SELECT platform.physical_epoch_ms()::text AS now_epoch,platform.local_now() AS local_ts)
       SELECT to_char(date_trunc('day',stamp.local_ts)-interval '1 day','YYYY-MM-DD HH24:MI:SS') AS "from",
       to_char(date_trunc('day',stamp.local_ts)+interval '1 day','YYYY-MM-DD HH24:MI:SS') AS until,
       stamp.now_epoch,to_char(stamp.local_ts,'YYYY-MM-DD HH24:MI:SS') AS now_local FROM stamp`)).rows[0];
    if(!windowClock)failP2016('ACTION_FAILED',503);
    const window={from:windowClock.from,until:windowClock.until};
    const clock:WorkbenchClock={nowEpoch:windowClock.now_epoch,nowLocal:windowClock.now_local};
    if(cursor&&(cursor.binding!==bound||cursor.criteria!==criteria||cursor.from!==window.from||cursor.until!==window.until))failP2016('CURSOR_INVALID');
    const optional=(await tx.query<{web:boolean}>(`SELECT to_regclass('intake.web_submission') IS NOT NULL AND to_regclass('intake.web_request_binding') IS NOT NULL AS web`)).rows[0];
    if(features.supplements&&!await supplementFollowUpSchemaReady(tx))failP2016('DISABLED',503);
    if(features.schedules&&!await followUpSchemaReady(tx))failP2016('DISABLED',503);
    if(features.follow&&!await followSchemaReady(tx))failP2016('DISABLED',503);
    if(optional?.web!==true){
     const material=await tx.query(
      `SELECT 1 FROM intake.service_intake i WHERE i.source_provider='YIXIAOXIU_WEB' AND i.retention_until_epoch_ms>$4::bigint AND (
        EXISTS(SELECT 1 FROM pilot_ticket.ticket t WHERE (t.source_intake_id=i.id OR t.id=i.pilot_ticket_id) AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[])))
        OR EXISTS(SELECT 1 FROM intake.manual_review_item r JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id WHERE r.service_intake_id=i.id AND r.status='PENDING' AND j.retention_until_epoch_ms>$4::bigint AND ($1::boolean OR t.assignee_id=$2::uuid OR t.resolver_team_id=ANY($3::text[])))
        OR ($1::boolean AND i.status IN ('RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','DISMISSED'))
      ) LIMIT 1`,
      [...scope.values,clock.nowEpoch],
     );
     if(material.rowCount||c.sources.includes('WEB_REQUEST'))failP2016('DISABLED',503);
    }
    const baseOpts={principal:p,clock,c,window,web:optional?.web===true,manual:features.manual,supplements:features.supplements,schedules:features.schedules};
    if(cursor){
     const anchorPb=createParamBuilder();
     const anchorId=anchorPb.add(cursor.id,'uuid');
     const anchorRelation=sql({...baseOpts,pb:anchorPb,targetIdsParam:`ARRAY[${anchorId}]`});
     const anchorKind=anchorPb.add(cursor.kind,'text'),anchorAt=anchorPb.add(cursor.at,'timestamp without time zone'),anchorGroup=anchorPb.add(cursor.order_group,'integer');
     const anchor=await tx.query(anchorRelation+` SELECT 1 FROM matched WHERE kind=${anchorKind} AND id=${anchorId} AND order_at=${anchorAt} AND order_group=${anchorGroup}`,anchorPb.values);
     if(anchor.rowCount!==1)failP2016('CURSOR_INVALID');
    }
    const pagePb=createParamBuilder();
    const limitParam=pagePb.add(limit+1,'integer');
    const keyset=cursor?{atParam:pagePb.add(cursor.at,'timestamp without time zone'),groupParam:pagePb.add(cursor.order_group,'integer'),kindParam:pagePb.add(cursor.kind,'text'),idParam:pagePb.add(cursor.id,'uuid')}:undefined;
    const pageRelation=sql({...baseOpts,pb:pagePb,keyLimitParam:limitParam,...(keyset?{keyset}:{})});
    const keysetWhere=keyset?`\n     WHERE (order_group,order_at,kind,id)<(${keyset.groupParam},${keyset.atParam},${keyset.kindParam},${keyset.idParam})`:'';
    const result=await tx.query<SearchRow>(pageRelation+` SELECT kind,id::text,intake_id::text,to_char(order_at,'YYYY-MM-DD HH24:MI:SS') AS order_at,order_group,encode(sha256(convert_to(to_jsonb(matched)::text,'UTF8')),'hex') AS safety_signature FROM matched${keysetWhere}
     ORDER BY order_group DESC,order_at DESC,kind DESC,id DESC LIMIT ${limitParam}`,pagePb.values);
    // Codex 42A r1 H2: the final proof must still cover the complete public card (the baseline digested cards.*),
    // not only the narrower search match row. Sign the complete canonical card of each selected row here.
    const selectedRows=result.rows.slice(0,limit);
    let cardSignatures:Record<string,string>={};
    if(selectedRows.length){
     const sigPb=createParamBuilder();
     const sigSql=buildCardSignaturesSql(sigPb,scope.values,clock,selectedRows);
     cardSignatures=(await tx.query<{signatures:Record<string,string>|null}>('SELECT '+sigSql+' AS signatures',sigPb.values)).rows[0]?.signatures??{};
    }
    const selected=selectedRows.map(row=>({...row,card_signature:cardSignatures[row.kind+':'+row.id]??null}));
    return {selected,web:optional?.web===true,bound,window,clock,hasMoreRows:result.rows.length>limit};
   });
   // Release the query connection before original public projections; a pool of one cannot deadlock.
   const items=await cards.authorizedItems(authContext,prepared.selected.map(row=>({kind:row.kind,id:row.id})),false,prepared.clock);
   for(const [index,row]of prepared.selected.entries()){
    const current=items[index];if(!current||current.kind!==row.kind||current.id!==row.id)failP2016('CURSOR_INVALID');
   }
   const decoratedItems=await cards.decorateWebReportUrgency(await cards.projectSearchItems(authContext,items,prepared.clock));
   const more=await transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
    await tx.query('SET LOCAL jit=off');
    const p=await query.principal(authContext,tx);if(binding(authContext,p)!==prepared.bound)failP2016('CURSOR_INVALID');await ready(tx,c);
    const proofClock=await readWorkbenchClock(tx);
    const pb=createParamBuilder();
    const principalCheckId=pb.once('principalId',p.principal_id,'uuid');
    const rolesParam=pb.add([...p.roles],'text[]'),teamsParam=pb.add([...p.team_ids],'text[]');
    const scopeCheck=`EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal scope_principal
      CROSS JOIN LATERAL (SELECT
        ARRAY(SELECT DISTINCT r.role::text FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=scope_principal.id) AS roles,
        ARRAY(SELECT DISTINCT m.team_id::text FROM pilot_ticket.pilot_team_member m WHERE m.principal_id=scope_principal.id) AS teams) scope_current
      WHERE scope_principal.id=${principalCheckId} AND scope_principal.is_active
        AND scope_current.roles @> ${rolesParam} AND scope_current.roles <@ ${rolesParam}
        AND scope_current.teams @> ${teamsParam} AND scope_current.teams <@ ${teamsParam})`;
    const baseOpts={principal:p,clock:proofClock,c,window:prepared.window,web:prepared.web,manual:features.manual,supplements:features.supplements,schedules:features.schedules};
    const targetIds=[...new Set([...(cursor?[cursor.id]:[]),...prepared.selected.map(row=>row.id)])];
    const targetIdsParam=targetIds.length?pb.add(targetIds,'uuid[]'):undefined;
    const targetedRelation=targetIdsParam?sql({...baseOpts,pb,targetIdsParam}):null;
    const anchorSql=cursor&&targetedRelation?`EXISTS(SELECT 1 FROM matched WHERE kind=${pb.add(cursor.kind,'text')} AND id=${pb.add(cursor.id,'uuid')}
      AND order_at=${pb.add(cursor.at,'timestamp without time zone')} AND order_group=${pb.add(cursor.order_group,'integer')})`:'TRUE';
    const last=prepared.selected.at(-1);
    const moreKeyset=last?{groupParam:pb.add(last.order_group,'integer'),atParam:pb.add(last.order_at,'timestamp without time zone'),kindParam:pb.add(last.kind,'text'),idParam:pb.add(last.id,'uuid')}:undefined;
    const canPushMoreLimit=c.q===''&&c.sources.length===0&&c.source_group_ref===null&&c.supplement==='any'&&c.schedule==='any';
    const moreLimitParam=last&&canPushMoreLimit?pb.add(1,'integer'):undefined;
    const moreRelation=last&&moreKeyset?sql({...baseOpts,pb,...(moreLimitParam?{keyLimitParam:moreLimitParam}:{}),keyset:moreKeyset,ctePrefix:'more_'}):null;
    const moreClause=moreRelation&&moreKeyset
     ?`EXISTS(SELECT 1 FROM more_matched WHERE (order_group,order_at,kind,id)<(${moreKeyset.groupParam},${moreKeyset.atParam},${moreKeyset.kindParam},${moreKeyset.idParam}))`
     :'FALSE';
    const selectedPairsParam=prepared.selected.length&&targetedRelation?pb.add(prepared.selected.map(row=>row.kind+':'+row.id),'text[]'):null;
    const cardSignaturesSql=prepared.selected.length?buildCardSignaturesSql(pb,ticketPredicateP2016(p).values,proofClock,prepared.selected):null;
    const session=sessionPredicate(authContext,p,pb.nextIndex());
    const finalValues=[...pb.values,...session.values];
    // The original principal role/member facts, session, anchor, selected items and next-page check
    // share the exact same final READ statement, after any readiness or projection wait.
    const ctes=[targetedRelation,moreRelation?moreRelation.replace(/^WITH /u,''):null].filter((v):v is string=>Boolean(v));
    const finalSql=(ctes.length?ctes.join(', ')+' ':'')
     +`SELECT (${session.sql}) AS session_valid,(${scopeCheck}) AS scope_valid,(${anchorSql}) AS anchor_valid,(${moreClause}) AS more,`
     +(cardSignaturesSql?`${cardSignaturesSql} AS card_signatures,`:`'{}'::jsonb AS card_signatures,`)
     +(selectedPairsParam
       ?`COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',m.kind,'id',m.id::text,'safety_signature',encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')))
           FROM matched m WHERE (m.kind||':'||m.id::text)=ANY(${selectedPairsParam})),'[]'::jsonb) AS items`
       :`'[]'::jsonb AS items`);
    const proof=(await tx.query<{session_valid:boolean;scope_valid:boolean;anchor_valid:boolean;more:boolean;card_signatures:Record<string,string>|null;items:{kind:string;id:string;safety_signature:string}[]}>(finalSql,finalValues)).rows[0];
    if(proof?.session_valid!==true)throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
    if(proof.scope_valid!==true)failP2016('CURSOR_INVALID');
    if(!proof.anchor_valid)failP2016('CURSOR_INVALID');
    const current=new Map(proof.items.map(row=>[row.kind+':'+row.id,row.safety_signature]));
    if(proof.items.length!==prepared.selected.length||prepared.selected.some(row=>current.get(row.kind+':'+row.id)!==row.safety_signature))failP2016('CURSOR_INVALID');
    const liveCards=proof.card_signatures??{};
    if(prepared.selected.some(row=>(liveCards[row.kind+':'+row.id]??null)!==(row.card_signature??null)))failP2016('CURSOR_INVALID');
    return proof.more===true;
   });
   const last=prepared.selected.at(-1),next=more&&last?encode({v:1,binding:prepared.bound,criteria,...prepared.window,at:last.order_at,order_group:last.order_group===1?1:0,kind:last.kind,id:last.id}):null;
   return publicP2016({items:decoratedItems,next_cursor:next,column:c.column,range:{...prepared.window,mode:c.range,timezone:'Asia/Shanghai' as const},criteria:c});
  }catch(error){if(error instanceof WorkbenchError)throw error;failP2016('ACTION_FAILED',503);}finally{busy=false;}
 }});
}
