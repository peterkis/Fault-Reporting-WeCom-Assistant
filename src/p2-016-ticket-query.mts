import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WorkbenchPrincipal, WorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import type { TicketStatus, TicketPriority, TicketRequestType } from './p1-005-pilot-ticket-core.mjs';
import type { StaffDirectoryStore, StoredDirectoryMember } from './p2-007-staff-directory-store.mjs';
export interface P2016TicketRow { id: string; ticket_no: string; request_type: TicketRequestType; status: TicketStatus; priority: TicketPriority; resolver_team_id: string; assignee_id: string | null; version: number; created_at: string; updated_at: string; intake_id: string }
export interface TicketQueryInput { authContext: unknown; ticketId: unknown; transaction?: PostgresTransaction; lock?: boolean }
interface QueryOptions { pool: PostgresTransaction; enabled?: boolean; authorization?: Pick<WorkbenchAuthorizationAdapter, 'resolvePrincipal'>; directoryStore?: Pick<StaffDirectoryStore, 'findByReporterHash'> | null; directorySourceScope?: string; ticketSelfHandlingEnabled?:boolean;ticketConversationSelfHandlingEnabled?:boolean;ticketStaffCompletionEnabled?:boolean;ticketAssignmentEnabled?:boolean;ticketUnassignEnabled?:boolean;ticketReturnToDispatchEnabled?:boolean }
// JSON projection values remain unknown until the existing visible-field guards narrow them.
interface ProfileObservation { source?: string; version?: unknown; contact?: { name?: unknown; userid?: unknown; mobile?: unknown; telephone?: unknown } | null; memberships?: { name?: unknown; department_ref?: unknown; role?: string }[]; sex?: unknown; fetched_at?: unknown }
export type P2016TicketQuery = ReturnType<typeof createP2016TicketQuery>;

import { createPilotWorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { getTicketActionTransitions } from './p1-006-ticket-state-actions.mjs';
import { failP2016,guardP2016,uuidP2016,codeP2016,limitP2016,localP2016,cursorP2016,decodeCursorP2016,publicP2016 } from './p2-016-domain-contracts.mjs';

import {staffCompletionEligibility} from './workbench-ticket-completion.mjs';
import {assignmentActions,assignmentCycle} from './workbench-ticket-assignment.mjs';
import {unassignEligible,unassignSchemaReady} from './workbench-ticket-unassign.mjs';
import {returnToDispatchSchemaReady} from './workbench-ticket-return-to-dispatch.mjs';
import {selfHandlingEligibility,selfHandlingResponsibilityEligibility,selfHandlingSchemaReady} from './workbench-ticket-self-handling.mjs';

export interface RelatedConversationRow {session_id:string;session_row_version:string;status:string;conversation_principal_id:string|null;conversation_principal_name:string|null;assignment_status:string|null}
const relatedConversationSql=`(s.service_intake_id=$1::uuid OR EXISTS(SELECT 1 FROM intake.channel_leg own
  JOIN intake.channel_leg related ON related.journey_id=own.journey_id
  WHERE own.source_intake_id=$1::uuid AND related.conversation_session_id=s.id
    AND related.source_intake_id=s.service_intake_id AND related.conversation_thread_id=s.thread_id
    AND related.reporter_identity_hash=own.reporter_identity_hash))`;
const relatedFields=`s.id::text AS session_id,s.row_version::text AS session_row_version,s.status,
  a.assigned_principal_id::text AS conversation_principal_id,p.display_name AS conversation_principal_name,a.assignment_status`;

const BROAD: (p: WorkbenchPrincipal) => boolean=p=>p.roles.some(r=>['ADMIN','DISPATCHER'].includes(r));
const HISTORICAL_MEMBERSHIP_ROLES=Object.freeze({
  WECOM_DIRECTORY:Object.freeze(['PRIMARY','SECONDARY','ROTATION']),
  THIRD_PARTY_STAFF_DIRECTORY:Object.freeze(['MEMBER']),
});
const historicalMembershipRole=(source: string,role: string | undefined)=>(HISTORICAL_MEMBERSHIP_ROLES as Readonly<Record<string, readonly string[]>>)[source]?.includes(role as string)?role:'UNKNOWN';
export const ticketFieldsP2016=`t.id::text,t.ticket_no,t.request_type,t.status,t.priority,t.resolver_team_id,
 t.assignee_id::text,t.version,t.created_at,t.updated_at,t.source_intake_id::text AS intake_id`;
export function ticketPredicateP2016(principal: WorkbenchPrincipal,start=1) {
  return {sql:`($${start}::boolean OR t.assignee_id=$${start+1}::uuid OR t.resolver_team_id=ANY($${start+2}::text[]))`,
    values:[BROAD(principal),principal.principal_id,principal.roles.includes('HANDLER')?principal.team_ids:[]]};
}
export function ticketActionAllowedP2016(principal: WorkbenchPrincipal | null | undefined,ticket: { resolver_team_id: string; assignee_id: string | null;status?:string },action: string) {
  if(!principal?.is_active)return false;
  if(action==='transfer-assignment'&&['RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED'].includes(ticket.status??''))return false;
  if(action==='auto-close'||action==='complete')return false;
  if(BROAD(principal))return true;
  if(!principal.roles.includes('HANDLER')||!principal.team_ids.includes(ticket.resolver_team_id))return false;
  if(action==='accept')return true;
  if(!['start','request-information','resume','wait-vendor','resolve','reopen','add-note','transfer-assignment'].includes(action))return false;
  return ticket.assignee_id===principal.principal_id;
}
export function ticketViewP2016<T extends P2016TicketRow, E extends object>(row: T,principal: WorkbenchPrincipal,extra: E | Record<string, never> = {}) {
  return publicP2016({...row,...extra,created_at:localP2016(row.created_at),updated_at:localP2016(row.updated_at),
    external_status:EXTERNAL_TICKET_STATUS[row.status],
    allowed_actions:[...getTicketActionTransitions().filter(a=>a.from.includes(row.status)&&ticketActionAllowedP2016(principal,row,a.action)).map(a=>a.action),
      ...(ticketActionAllowedP2016(principal,row,'transfer-assignment')?['transfer-assignment']:[])]});
}
async function webReportForTicket(queryable: PostgresTransaction,ticket: P2016TicketRow) {
  let q;
  try { q=await queryable.query<{ source_provider: string; initial_content: Record<string, unknown> | null; supplement_items: { input_revision: unknown; text: unknown }[] }>(`SELECT i.source_provider,initial.safe_content AS initial_content,
      COALESCE(supplements.items,'[]'::jsonb) AS supplement_items
    FROM intake.service_intake i
    JOIN intake.web_request_binding b ON b.intake_id=i.id
      AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
    LEFT JOIN LATERAL (SELECT s.safe_content FROM intake.web_submission s
      WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until>platform.local_now() ORDER BY s.input_revision LIMIT 1) initial ON TRUE
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('input_revision',s.input_revision::text,
      'text',s.safe_content->>'text') ORDER BY s.input_revision) AS items
      FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT' AND s.retention_until>platform.local_now()) supplements ON TRUE
    WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()`,[ticket.intake_id]); }
  catch(error) { if((error as { code?: unknown } | null)?.code==='42P01')return null; throw error; }
  const row=(q.rows[0] as (typeof q.rows)[number]);if(q.rowCount!==1||row.source_provider!=='YIXIAOXIU_WEB')return null;
  const initial=row.initial_content&&typeof row.initial_content==='object'?row.initial_content:{};
  const supplements=Array.isArray(row.supplement_items)?row.supplement_items:[];
  return publicP2016({source_kind:'WEB_REQUEST',description:typeof initial.description==='string'?initial.description:null,
    location:initial.location??null,service_code:initial.service_code??null,impact_scope:initial.impact_scope??null,
    reported_department_text:initial.reported_department_text??null,extension:initial.extension??null,
    supplements:supplements.map(item=>({input_revision:String(item.input_revision),text:typeof item.text==='string'?item.text:null}))});
}
export function createP2016TicketQuery({pool,enabled=false,authorization=createPilotWorkbenchAuthorizationAdapter({pool}),directoryStore=null,directorySourceScope='FORMAL',ticketSelfHandlingEnabled=false,ticketConversationSelfHandlingEnabled=false,ticketStaffCompletionEnabled=false,ticketAssignmentEnabled=false,ticketUnassignEnabled=false,ticketReturnToDispatchEnabled=false}: QueryOptions) {
  const conversationAuthorization=createPilotWorkbenchAuthorizationAdapter({pool});
  async function principal(authContext: unknown,queryable: PostgresTransaction=pool) {
    guardP2016(enabled);const p=await authorization.resolvePrincipal(authContext,{queryable});
    if(!p)failP2016('FORBIDDEN',403);return p;
  }
  async function authorizedTicket({authContext,ticketId,transaction=pool,lock=false}: TicketQueryInput) {
    const p=await principal(authContext,transaction);const predicate=ticketPredicateP2016(p,2);
    const q=await transaction.query<P2016TicketRow>(`SELECT ${ticketFieldsP2016} FROM pilot_ticket.ticket t WHERE t.id=$1::uuid AND ${predicate.sql}${lock?' FOR UPDATE OF t':''}`,[uuidP2016(ticketId),...predicate.values]);
    if(q.rowCount!==1)failP2016('NOT_FOUND',404);return {principal:p,ticket:(q.rows[0] as (typeof q.rows)[number])};
  }
  return Object.freeze({
    principal,authorizedTicket,
    async assignmentTargets({authContext,ticketId,resolverTeamId=null,targetPrincipalId=null}: {authContext:unknown;ticketId:unknown;resolverTeamId?:unknown;targetPrincipalId?:unknown}) {
      guardP2016(ticketAssignmentEnabled);
      const {ticket,principal:p}=await authorizedTicket({authContext,ticketId});
      if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
      if(assignmentActions(p,ticket).length===0)failP2016('FORBIDDEN',403);
      const selected=resolverTeamId===null?null:codeP2016(resolverTeamId);
      const selectedPerson=targetPrincipalId===null?null:uuidP2016(targetPrincipalId);if(selectedPerson&&selected===null)failP2016();
      const effectiveGroupsSql=`SELECT rt.team_id,rt.display_name FROM pilot_ticket.resolver_team rt
        WHERE rt.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.pilot_principal p ON p.id=m.principal_id
          WHERE m.team_id=rt.team_id AND p.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER')))`;
      const selectedGroup=selected===null?null:(await pool.query<{team_id:string;display_name:string}>(effectiveGroupsSql+' AND rt.team_id=$1',[selected])).rows[0]??failP2016('FORBIDDEN',403);
      const groups=await pool.query<{team_id:string;display_name:string}>(effectiveGroupsSql+' ORDER BY rt.team_id LIMIT 100');
      const resolverTeams=selectedGroup&&!groups.rows.some(group=>group.team_id===selectedGroup.team_id)
        ?[...groups.rows.slice(0,99),selectedGroup].sort((a,b)=>a.team_id<b.team_id?-1:a.team_id===b.team_id?0:1):groups.rows;
      const candidatesSql=`SELECT p.id::text AS principal_id,p.display_name
        FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id
        WHERE m.team_id=$1 AND p.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))`;
      if(selectedPerson&&!(await pool.query(candidatesSql+' AND p.id=$2::uuid',[selected,selectedPerson])).rows[0])failP2016('FORBIDDEN',403);
      const candidates=selected===null?[]:(await pool.query<{principal_id:string;display_name:string}>(selectedPerson
        ?'SELECT principal_id,display_name FROM ('+candidatesSql+' ORDER BY (p.id=$2::uuid) DESC,p.display_name,p.id LIMIT 100) bounded ORDER BY display_name,principal_id'
        :candidatesSql+' ORDER BY p.display_name,p.id LIMIT 100',selectedPerson?[selected,selectedPerson]:[selected])).rows;
      return publicP2016({resolver_teams:resolverTeams,resolver_team_id:selected,items:candidates});
    },
    async list({authContext,state='queued',cursor=null,limit}: { authContext: unknown; state?: string; cursor?: unknown; limit?: unknown }) {
      const p=await principal(authContext),n=limitP2016(limit),predicate=ticketPredicateP2016(p);
      const aliases: Record<string, TicketStatus>={queued:'QUEUED',accepted:'ACCEPTED',in_progress:'IN_PROGRESS',waiting_requester:'WAITING_REQUESTER',waiting_vendor:'WAITING_VENDOR',resolved:'RESOLVED',closed:'CLOSED',reopened:'REOPENED',cancelled:'CANCELLED'};
      if(!Object.hasOwn(aliases,state)&&!['unassigned','mine','failed_delivery'].includes(state))failP2016();
      const page=cursor?decodeCursorP2016(cursor,['v','state','at','id']):null;
      if(page&&(page.v!==1||page.state!==state))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,id=page?uuidP2016(page.id):null;
      const filter=state==='unassigned'?"t.assignee_id IS NULL AND t.status IN ('NEW','QUEUED','REOPENED')":state==='mine'?'t.assignee_id=$2::uuid':state==='failed_delivery'?
        "EXISTS(SELECT 1 FROM communication.ticket_notification_binding b JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=t.id AND d.status IN ('DEAD_LETTER','RECONCILIATION_REQUIRED'))":'TRUE';
      const q=await pool.query<P2016TicketRow>(`SELECT ${ticketFieldsP2016} FROM pilot_ticket.ticket t WHERE ${predicate.sql}
        AND ${filter} AND ($4::text[] IS NULL OR t.status=ANY($4::text[]))
        AND ($5::timestamp without time zone IS NULL OR (t.updated_at,t.id)<($5::timestamp without time zone,$6::uuid))
        ORDER BY t.updated_at DESC,t.id DESC LIMIT $7`,[...predicate.values,state==='queued'?['NEW','QUEUED']:aliases[state]?[aliases[state]]:null,at,id,n+1]);
      const items=q.rows.slice(0,n).map(r=>ticketViewP2016(r,p)),last=items.at(-1);
      return publicP2016({items,next_cursor:q.rows.length>n?cursorP2016({v:1,state,at:(last as NonNullable<typeof last>).updated_at,id:(last as NonNullable<typeof last>).id}):null});
    },
    async detail(input: TicketQueryInput) {
      const {ticket,principal:p}=await authorizedTicket(input),report=await webReportForTicket(pool,ticket);
      const view=ticketViewP2016(ticket,p,report?{web_report:report}:{});
      let result=view;
      if(ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled){
        const eligibility=await (ticketSelfHandlingEnabled?selfHandlingEligibility:selfHandlingResponsibilityEligibility)(pool,p,ticket);
        const combined=ticketConversationSelfHandlingEnabled?await selfHandlingResponsibilityEligibility(pool,p,ticket):null;
        result=publicP2016({...result,handling_cycle:eligibility.cycle,allowed_actions:[...result.allowed_actions,...(ticketSelfHandlingEnabled?eligibility.actions:[]),...(combined?.actions.map(a=>a+'-with-conversations')??[])]});
      }
      if(ticketAssignmentEnabled){if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);result=publicP2016({...result,handling_cycle:await assignmentCycle(pool,ticket.id),allowed_actions:[...new Set([...result.allowed_actions,...assignmentActions(p,ticket)])]});}
      if(ticketReturnToDispatchEnabled){if(!await returnToDispatchSchemaReady(pool))failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);result=publicP2016({...result,handling_cycle:await assignmentCycle(pool,ticket.id)});}
      if(ticketUnassignEnabled){if(!await unassignSchemaReady(pool))failP2016('UNASSIGN_UNAVAILABLE',503);if(await unassignEligible(pool,p,ticket))result=publicP2016({...result,allowed_actions:[...result.allowed_actions,'unassign']});}
      if(ticketStaffCompletionEnabled){const eligibility=await staffCompletionEligibility(pool,p,ticket),cycle=eligibility.cycle;result=publicP2016({...result,handling_cycle:cycle?{id:cycle.id,cycle_no:cycle.cycle_no,first_responsibility_event_id:cycle.first_responsibility_event_id,staff_completion_event_id:cycle.staff_completion_event_id}:null,allowed_actions:[...result.allowed_actions,...(eligibility.allowed?['complete']:[])]});}
      return result;
    },
    async reporterContact(input: TicketQueryInput) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query<{ profile_resolution_status: string; profile_snapshot: ProfileObservation | null; reporter_identity_hash: string | null }>(`SELECT j.profile_resolution_status,j.profile_snapshot,j.reporter_identity_hash FROM intake.channel_leg l
        JOIN intake.contact_journey j ON j.id=l.journey_id
        JOIN intake.service_intake i ON i.id=j.origin_intake_id
        WHERE l.source_intake_id=$1::uuid AND l.reporter_identity_hash=j.reporter_identity_hash
          AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          AND i.retention_until_epoch_ms>platform.physical_epoch_ms() LIMIT 1`,[ticket.intake_id]);
      const row=q.rows[0],snapshot=row?.profile_snapshot as ProfileObservation;
      const string: (value: unknown) => string | null=value=>typeof value==='string'&&value.length>0&&value.length<=256?value:null;
      const url: (value: unknown) => string | null=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&value.startsWith('https://')?value:null;
      const resolved=row?.profile_resolution_status==='RESOLVED'&&['WECOM_DIRECTORY','THIRD_PARTY_STAFF_DIRECTORY'].includes(snapshot?.source as string)&&string(snapshot.version);
      const historical=!resolved?{status:'DEFERRED',contact:null,departments:[],fetched_at:null}:{status:'RESOLVED',contact:snapshot.contact?{
        name:string(snapshot.contact.name),userid:string(snapshot.contact.userid),
        mobile:string(snapshot.contact.mobile),telephone:string(snapshot.contact.telephone)}:null,
        departments:(Array.isArray(snapshot.memberships)?snapshot.memberships:[]).slice(0,20).map(m=>({
          name:string(m?.name),department_ref:snapshot.source==='THIRD_PARTY_STAFF_DIRECTORY'?null:string(m?.department_ref),role:historicalMembershipRole((snapshot.source as string),m?.role)})),
        ...(snapshot.source==='THIRD_PARTY_STAFF_DIRECTORY'?{sex:string(snapshot.sex)}:{}),fetched_at:string(snapshot.fetched_at)};
      if(!directoryStore||!row?.reporter_identity_hash||(resolved&&snapshot.source!=='THIRD_PARTY_STAFF_DIRECTORY'))return publicP2016(historical);
      let current: StoredDirectoryMember | null=null;
      try { current=await directoryStore.findByReporterHash({source_scope:directorySourceScope,reporter_identity_hash:row.reporter_identity_hash}); }
      catch { current=null; }
      return publicP2016({...historical,current_profile:current?{
        status:'RESOLVED',contact:{name:string(current.nickname),mobile:string(current.phone)},sex:string(current.sex),
        avatar_url:url(current.avatar_url),departments:(Array.isArray(current.memberships)?current.memberships:[]).slice(0,20).map(m=>({
          name:string(m?.name),department_ref:null,role:'MEMBER'})),fetched_at:string(current.fetched_at),
      }:{status:'STALE',contact:null,sex:null,avatar_url:null,departments:[],fetched_at:null}});
    },
    async events({cursor=null,limit,...input}: TicketQueryInput & { cursor?: unknown; limit?: unknown }) {
      const {ticket}=await authorizedTicket(input),n=limitP2016(limit,200);
      const page=cursor?decodeCursorP2016(cursor,['ticket','ordinal']):null;
      if(page&&(page.ticket!==ticket.id||!Number.isInteger(page.ordinal)||(page.ordinal as number)<0))failP2016('CURSOR_INVALID');
      const q=await pool.query(`SELECT event_id::text,event_type,old_status,new_status,aggregate_version,event_ordinal,created_at,
        CASE WHEN internal_note IS NOT NULL THEN true ELSE false END AS has_internal_note,
        CASE WHEN external_note IS NOT NULL THEN true ELSE false END AS has_external_note
        FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_ordinal>$2 ORDER BY event_ordinal LIMIT $3`,[ticket.id,page?.ordinal??0,n+1]);
      return publicP2016({items:q.rows.slice(0,n),next_cursor:q.rows.length>n?cursorP2016({ticket:ticket.id,ordinal:(q.rows[n-1] as (typeof q.rows)[number]).event_ordinal}):null});
    },
    async responsibility(input: TicketQueryInput & { currentConversationsOnly?: boolean }) {
      if(input.currentConversationsOnly!==undefined&&typeof input.currentConversationsOnly!=='boolean')failP2016();
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT s.id::text AS session_id,s.row_version::text AS session_row_version,
        COALESCE(s.service_intake_id=$1::uuid AND s.status<>'ENDED',false) AS combined_accept_allowed,
        a.assigned_principal_id::text AS conversation_principal_id,p.display_name AS conversation_principal_name,a.assignment_status,a.assignment_version::text
        FROM conversation.session s LEFT JOIN conversation.assignment a ON a.session_id=s.id
        LEFT JOIN pilot_ticket.pilot_principal p ON p.id=a.assigned_principal_id
        WHERE (s.service_intake_id=$1::uuid OR s.id IN (
          SELECT related.conversation_session_id FROM intake.channel_leg own
          JOIN intake.channel_leg related ON related.journey_id=own.journey_id WHERE own.source_intake_id=$1::uuid))
        AND (NOT $2::boolean OR (s.status<>'ENDED' AND a.assignment_status='ASSIGNED'))
        ORDER BY s.created_at,s.id LIMIT 100`,[ticket.intake_id,input.currentConversationsOnly===true]);
      const owner=await pool.query('SELECT p.display_name,rt.display_name AS team_name FROM pilot_ticket.resolver_team rt LEFT JOIN pilot_ticket.pilot_principal p ON p.id=$1::uuid WHERE rt.team_id=$2',[ticket.assignee_id,ticket.resolver_team_id]);
      return publicP2016({ticket_id:ticket.id,ticket_assignee_id:ticket.assignee_id,ticket_assignee_name:owner.rows[0]?.display_name??null,
        resolver_team_id:ticket.resolver_team_id,resolver_team_name:owner.rows[0]?.team_name??null,conversations:q.rows});
    },
    async authorizedRelatedConversation({authContext,ticketId,sessionId,transaction=pool,lock=false}:TicketQueryInput&{sessionId:string}){
      guardP2016(ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketUnassignEnabled||ticketReturnToDispatchEnabled);
      const {ticket,principal:p}=await authorizedTicket({authContext,ticketId,transaction});
      const q=await transaction.query<RelatedConversationRow>(`SELECT ${relatedFields} FROM conversation.session s
        LEFT JOIN conversation.assignment a ON a.session_id=s.id LEFT JOIN pilot_ticket.pilot_principal p ON p.id=a.assigned_principal_id
        WHERE ${relatedConversationSql} AND s.id=$2::uuid${lock?' FOR UPDATE OF s':''}`,[ticket.intake_id,uuidP2016(sessionId)]);
      const session=q.rows[0];
      if(!session||!await conversationAuthorization.authorizeSession({principal:p,sessionId:session.session_id,queryable:transaction,action:'VIEW'}))failP2016('NOT_FOUND',404);
      return {principal:p,ticket,session};
    },
    async conversationTakeAllowed({principal:p,session,transaction=pool}:{principal:WorkbenchPrincipal;session:RelatedConversationRow;transaction?:PostgresTransaction}){
      if(session.status==='ENDED'||!/^\d+$/u.test(session.session_row_version)||BigInt(session.session_row_version)<1n||BigInt(session.session_row_version)>2147483647n)return false;
      return conversationAuthorization.authorizeSession({principal:p,sessionId:session.session_id,queryable:transaction,
        action:session.assignment_status==='ASSIGNED'&&session.conversation_principal_id!==p.principal_id?'TRANSFER':'TAKEOVER'});
    },
    async relatedConversations({cursor=null,limit,...input}:TicketQueryInput&{cursor?:unknown;limit?:unknown}){
      guardP2016(ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketUnassignEnabled);
      if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
      const {ticket,principal:p}=await authorizedTicket(input),n=limitP2016(limit??20,20);
      const page=cursor?decodeCursorP2016(cursor,['v','ticket','id']):null;
      if(page&&(page.v!==1||page.ticket!==ticket.id))failP2016('CURSOR_INVALID');
      const after=page?uuidP2016(page.id):null,predicate=conversationAuthorization.sessionAccessPredicate(p,{ticketAlias:'st',start:3});
      const q=await pool.query<RelatedConversationRow>(`SELECT ${relatedFields} FROM conversation.session s
        LEFT JOIN conversation.assignment a ON a.session_id=s.id LEFT JOIN pilot_ticket.pilot_principal p ON p.id=a.assigned_principal_id
        LEFT JOIN pilot_ticket.ticket st ON st.source_intake_id=s.service_intake_id
        WHERE ${relatedConversationSql} AND s.status<>'ENDED' AND ($2::uuid IS NULL OR s.id>$2::uuid) AND ${predicate.sql}
        ORDER BY s.id LIMIT $7`,[ticket.intake_id,after,...predicate.values,n+1]);
      const items=await Promise.all(q.rows.slice(0,n).map(async session=>({session_id:session.session_id,session_row_version:session.session_row_version,
        conversation_principal_id:session.conversation_principal_id,conversation_principal_name:session.conversation_principal_name,assignment_status:session.assignment_status,
        take_allowed:await conversationAuthorization.authorizeSession({principal:p,sessionId:session.session_id,action:session.assignment_status==='ASSIGNED'&&session.conversation_principal_id!==p.principal_id?'TRANSFER':'TAKEOVER'})
          &&BigInt(session.session_row_version)>=1n&&BigInt(session.session_row_version)<=2147483647n})));
      const last=items.at(-1);
      return publicP2016({items,next_cursor:q.rows.length>n&&last?cursorP2016({v:1,ticket:ticket.id,id:last.session_id}):null});
    },
    async eligiblePrincipals(input: TicketQueryInput) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT p.id::text AS principal_id,p.display_name FROM pilot_ticket.pilot_principal p
        JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id WHERE m.team_id=$1 AND p.is_active
        AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))
        ORDER BY p.display_name,p.id LIMIT 100`,[ticket.resolver_team_id]);return publicP2016({items:q.rows});
    },
    async deliveries(input: TicketQueryInput) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT b.notification_type,b.destination_type,d.id::text AS delivery_id,d.status,
        d.side_effect_state,d.attempt_count,d.sent_at,b.created_at FROM communication.ticket_notification_binding b
        JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=$1::uuid
        ORDER BY b.created_at DESC,b.id DESC LIMIT 100`,[ticket.id]);return publicP2016({items:q.rows});
    },
  });
}
