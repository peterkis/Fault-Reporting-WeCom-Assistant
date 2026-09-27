import { createPilotWorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { getTicketActionTransitions } from './p1-006-ticket-state-actions.mjs';
import { failP2016,guardP2016,uuidP2016,limitP2016,localP2016,cursorP2016,decodeCursorP2016,publicP2016 } from './p2-016-domain-contracts.mjs';

const BROAD=p=>p.roles.some(r=>['ADMIN','DISPATCHER'].includes(r));
const HISTORICAL_MEMBERSHIP_ROLES=Object.freeze({
  WECOM_DIRECTORY:Object.freeze(['PRIMARY','SECONDARY','ROTATION']),
  THIRD_PARTY_STAFF_DIRECTORY:Object.freeze(['MEMBER']),
});
const historicalMembershipRole=(source,role)=>HISTORICAL_MEMBERSHIP_ROLES[source]?.includes(role)?role:'UNKNOWN';
export const ticketFieldsP2016=`t.id::text,t.ticket_no,t.request_type,t.status,t.priority,t.resolver_team_id,
 t.assignee_id::text,t.version,t.created_at,t.updated_at,t.source_intake_id::text AS intake_id`;
export function ticketPredicateP2016(principal,start=1) {
  return {sql:`($${start}::boolean OR t.assignee_id=$${start+1}::uuid OR t.resolver_team_id=ANY($${start+2}::text[]))`,
    values:[BROAD(principal),principal.principal_id,principal.roles.includes('HANDLER')?principal.team_ids:[]]};
}
export function ticketActionAllowedP2016(principal,ticket,action) {
  if(!principal?.is_active)return false;
  if(action==='auto-close')return false;
  if(BROAD(principal))return true;
  if(!principal.roles.includes('HANDLER')||!principal.team_ids.includes(ticket.resolver_team_id))return false;
  if(action==='accept')return true;
  if(!['start','request-information','resume','wait-vendor','resolve','reopen','add-note','transfer-assignment'].includes(action))return false;
  return ticket.assignee_id===principal.principal_id;
}
export function ticketViewP2016(row,principal,extra={}) {
  return publicP2016({...row,...extra,created_at:localP2016(row.created_at),updated_at:localP2016(row.updated_at),
    external_status:EXTERNAL_TICKET_STATUS[row.status],
    allowed_actions:[...getTicketActionTransitions().filter(a=>a.from.includes(row.status)&&ticketActionAllowedP2016(principal,row,a.action)).map(a=>a.action),
      ...(ticketActionAllowedP2016(principal,row,'transfer-assignment')?['transfer-assignment']:[])]});
}
async function webReportForTicket(queryable,ticket) {
  let q;
  try { q=await queryable.query(`SELECT i.source_provider,initial.safe_content AS initial_content,
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
  catch(error) { if(error?.code==='42P01')return null; throw error; }
  const row=q.rows[0];if(q.rowCount!==1||row.source_provider!=='YIXIAOXIU_WEB')return null;
  const initial=row.initial_content&&typeof row.initial_content==='object'?row.initial_content:{};
  const supplements=Array.isArray(row.supplement_items)?row.supplement_items:[];
  return publicP2016({source_kind:'WEB_REQUEST',description:typeof initial.description==='string'?initial.description:null,
    location:initial.location??null,service_code:initial.service_code??null,impact_scope:initial.impact_scope??null,
    reported_department_text:initial.reported_department_text??null,extension:initial.extension??null,
    supplements:supplements.map(item=>({input_revision:String(item.input_revision),text:typeof item.text==='string'?item.text:null}))});
}
export function createP2016TicketQuery({pool,enabled=false,authorization=createPilotWorkbenchAuthorizationAdapter({pool}),directoryStore=null,directorySourceScope='FORMAL'}) {
  async function principal(authContext,queryable=pool) {
    guardP2016(enabled);const p=await authorization.resolvePrincipal(authContext,{queryable});
    if(!p)failP2016('FORBIDDEN',403);return p;
  }
  async function authorizedTicket({authContext,ticketId,transaction=pool,lock=false}) {
    const p=await principal(authContext,transaction);const predicate=ticketPredicateP2016(p,2);
    const q=await transaction.query(`SELECT ${ticketFieldsP2016} FROM pilot_ticket.ticket t WHERE t.id=$1::uuid AND ${predicate.sql}${lock?' FOR UPDATE OF t':''}`,[uuidP2016(ticketId),...predicate.values]);
    if(q.rowCount!==1)failP2016('NOT_FOUND',404);return {principal:p,ticket:q.rows[0]};
  }
  return Object.freeze({
    principal,authorizedTicket,
    async list({authContext,state='queued',cursor=null,limit}) {
      const p=await principal(authContext),n=limitP2016(limit),predicate=ticketPredicateP2016(p);
      const aliases={queued:'QUEUED',accepted:'ACCEPTED',in_progress:'IN_PROGRESS',waiting_requester:'WAITING_REQUESTER',waiting_vendor:'WAITING_VENDOR',resolved:'RESOLVED',closed:'CLOSED',reopened:'REOPENED',cancelled:'CANCELLED'};
      if(!Object.hasOwn(aliases,state)&&!['unassigned','mine','failed_delivery'].includes(state))failP2016();
      const page=cursor?decodeCursorP2016(cursor,['v','state','at','id']):null;
      if(page&&(page.v!==1||page.state!==state))failP2016('CURSOR_INVALID');
      const at=page?localP2016(page.at):null,id=page?uuidP2016(page.id):null;
      const filter=state==='unassigned'?"t.assignee_id IS NULL AND t.status IN ('NEW','QUEUED','REOPENED')":state==='mine'?'t.assignee_id=$2::uuid':state==='failed_delivery'?
        "EXISTS(SELECT 1 FROM communication.ticket_notification_binding b JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=t.id AND d.status IN ('DEAD_LETTER','RECONCILIATION_REQUIRED'))":'TRUE';
      const q=await pool.query(`SELECT ${ticketFieldsP2016} FROM pilot_ticket.ticket t WHERE ${predicate.sql}
        AND ${filter} AND ($4::text[] IS NULL OR t.status=ANY($4::text[]))
        AND ($5::timestamp without time zone IS NULL OR (t.updated_at,t.id)<($5::timestamp without time zone,$6::uuid))
        ORDER BY t.updated_at DESC,t.id DESC LIMIT $7`,[...predicate.values,state==='queued'?['NEW','QUEUED']:aliases[state]?[aliases[state]]:null,at,id,n+1]);
      const items=q.rows.slice(0,n).map(r=>ticketViewP2016(r,p)),last=items.at(-1);
      return publicP2016({items,next_cursor:q.rows.length>n?cursorP2016({v:1,state,at:last.updated_at,id:last.id}):null});
    },
    async detail(input) {const {ticket,principal:p}=await authorizedTicket(input);const report=await webReportForTicket(pool,ticket);return ticketViewP2016(ticket,p,report?{web_report:report}:{});},
    async reporterContact(input) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT j.profile_resolution_status,j.profile_snapshot,j.reporter_identity_hash FROM intake.channel_leg l
        JOIN intake.contact_journey j ON j.id=l.journey_id
        JOIN intake.service_intake i ON i.id=j.origin_intake_id
        WHERE l.source_intake_id=$1::uuid AND l.reporter_identity_hash=j.reporter_identity_hash
          AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          AND i.retention_until_epoch_ms>platform.physical_epoch_ms() LIMIT 1`,[ticket.intake_id]);
      const row=q.rows[0],snapshot=row?.profile_snapshot;
      const string=value=>typeof value==='string'&&value.length>0&&value.length<=256?value:null;
      const url=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&value.startsWith('https://')?value:null;
      if(row?.profile_resolution_status!=='RESOLVED'||!['WECOM_DIRECTORY','THIRD_PARTY_STAFF_DIRECTORY'].includes(snapshot?.source)||!string(snapshot.version))
        return publicP2016({status:'DEFERRED',contact:null,departments:[],fetched_at:null});
      const historical={status:'RESOLVED',contact:snapshot.contact?{
        name:string(snapshot.contact.name),userid:string(snapshot.contact.userid),
        mobile:string(snapshot.contact.mobile),telephone:string(snapshot.contact.telephone)}:null,
        departments:(Array.isArray(snapshot.memberships)?snapshot.memberships:[]).slice(0,20).map(m=>({
          name:string(m?.name),department_ref:string(m?.department_ref),role:historicalMembershipRole(snapshot.source,m?.role)})),
        ...(snapshot.source==='THIRD_PARTY_STAFF_DIRECTORY'?{sex:string(snapshot.sex)}:{}),fetched_at:string(snapshot.fetched_at)};
      if(snapshot.source!=='THIRD_PARTY_STAFF_DIRECTORY'||!directoryStore)return publicP2016(historical);
      let current=null;
      try { current=await directoryStore.findByReporterHash({source_scope:directorySourceScope,reporter_identity_hash:row.reporter_identity_hash}); }
      catch { current=null; }
      return publicP2016({...historical,current_profile:current?{
        status:'RESOLVED',contact:{name:string(current.nickname),mobile:string(current.phone)},sex:string(current.sex),
        avatar_url:url(current.avatar_url),departments:(Array.isArray(current.memberships)?current.memberships:[]).slice(0,20).map(m=>({
          name:string(m?.name),department_ref:string(m?.department_ref),role:'MEMBER'})),fetched_at:string(current.fetched_at),
      }:{status:'STALE',contact:null,sex:null,avatar_url:null,departments:[],fetched_at:null}});
    },
    async events({cursor=null,limit,...input}) {
      const {ticket}=await authorizedTicket(input),n=limitP2016(limit,200);
      const page=cursor?decodeCursorP2016(cursor,['ticket','ordinal']):null;
      if(page&&(page.ticket!==ticket.id||!Number.isInteger(page.ordinal)||page.ordinal<0))failP2016('CURSOR_INVALID');
      const q=await pool.query(`SELECT event_id::text,event_type,old_status,new_status,aggregate_version,event_ordinal,created_at,
        CASE WHEN internal_note IS NOT NULL THEN true ELSE false END AS has_internal_note,
        CASE WHEN external_note IS NOT NULL THEN true ELSE false END AS has_external_note
        FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_ordinal>$2 ORDER BY event_ordinal LIMIT $3`,[ticket.id,page?.ordinal??0,n+1]);
      return publicP2016({items:q.rows.slice(0,n),next_cursor:q.rows.length>n?cursorP2016({ticket:ticket.id,ordinal:q.rows[n-1].event_ordinal}):null});
    },
    async responsibility(input) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT s.id::text AS session_id,s.row_version::text AS session_row_version,
        COALESCE(s.service_intake_id=$1::uuid AND s.status<>'ENDED',false) AS combined_accept_allowed,
        a.assigned_principal_id::text AS conversation_principal_id,p.display_name AS conversation_principal_name,a.assignment_status,a.assignment_version::text
        FROM conversation.session s LEFT JOIN conversation.assignment a ON a.session_id=s.id
        LEFT JOIN pilot_ticket.pilot_principal p ON p.id=a.assigned_principal_id
        WHERE s.service_intake_id=$1::uuid OR s.id IN (
          SELECT related.conversation_session_id FROM intake.channel_leg own
          JOIN intake.channel_leg related ON related.journey_id=own.journey_id WHERE own.source_intake_id=$1::uuid)
        ORDER BY s.created_at,s.id LIMIT 100`,[ticket.intake_id]);
      const owner=await pool.query('SELECT p.display_name,rt.display_name AS team_name FROM pilot_ticket.resolver_team rt LEFT JOIN pilot_ticket.pilot_principal p ON p.id=$1::uuid WHERE rt.team_id=$2',[ticket.assignee_id,ticket.resolver_team_id]);
      return publicP2016({ticket_id:ticket.id,ticket_assignee_id:ticket.assignee_id,ticket_assignee_name:owner.rows[0]?.display_name??null,
        resolver_team_id:ticket.resolver_team_id,resolver_team_name:owner.rows[0]?.team_name??null,conversations:q.rows});
    },
    async eligiblePrincipals(input) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT p.id::text AS principal_id,p.display_name FROM pilot_ticket.pilot_principal p
        JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id WHERE m.team_id=$1 AND p.is_active
        AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))
        ORDER BY p.display_name,p.id LIMIT 100`,[ticket.resolver_team_id]);return publicP2016({items:q.rows});
    },
    async deliveries(input) {
      const {ticket}=await authorizedTicket(input);
      const q=await pool.query(`SELECT b.notification_type,b.destination_type,d.id::text AS delivery_id,d.status,
        d.side_effect_state,d.attempt_count,d.sent_at,b.created_at FROM communication.ticket_notification_binding b
        JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=$1::uuid
        ORDER BY b.created_at DESC,b.id DESC LIMIT 100`,[ticket.id]);return publicP2016({items:q.rows});
    },
  });
}
