import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {P2016AssignmentHistoryItem,P2016AssignmentHistoryName,P2016AssignmentHistoryPage} from '../contracts/p2_016_assignment_history_contracts.js';
import {hashP2016,limitP2016,cursorP2016,decodeCursorP2016,uuidP2016,versionP2016,localP2016,failP2016} from './p2-016-domain-contracts.mjs';

interface HistoryRow {
 event_id:string;event_ordinal:number;occurred_at:string;first:boolean;cycle_no:number|null;
 actor_name:string|null;previous_person_id:string|null;next_person_id:string|null;
 previous_team_id:string|null;next_team_id:string|null;previous_person_name:string|null;next_person_name:string|null;
 previous_team_name:string|null;next_team_name:string|null;previous_proven:boolean;next_proven:boolean;
}
interface CommunicationRow {ticket_event_id:string;session_id:string;control_event_id:string;occurred_at:string;actor_name:string|null;old_assignment_status:string|null;new_assignment_status:string|null;previous_target:string|null;previous_status:string|null;previous_name:string|null;next_target:string|null;next_name:string|null}
type Predicate={sql:string;values:readonly unknown[]};
const assignmentTypes="'ticket.accepted','ticket.assignment_transferred','ticket.unassigned','ticket.returned_to_dispatch'";
const assignmentControls="'ASSIGNMENT_ASSIGNED','ASSIGNMENT_TRANSFERRED','ASSIGNMENT_RELEASED','HANDOFF_ACCEPTED','HANDOFF_RELEASED'";
const known=(name:unknown):P2016AssignmentHistoryName=>typeof name==='string'&&name.trim().length>0&&name.length<=128&&!/[\u0000-\u001f\u007f]/u.test(name)?{state:'KNOWN',name}:{state:'UNKNOWN'};
function person(id:string|null,name:string|null,proven:boolean):P2016AssignmentHistoryName{return !proven?{state:'UNKNOWN'}:id===null?{state:'NONE'}:known(name);}

/** Existing append-only facts only. No command, snapshot, raw identity or current owner is returned. */
export async function assignmentHistoryPage({queryable,ticketId,principal,sessionPredicate,cursor=null,limit}:{queryable:PostgresTransaction;ticketId:string;principal:WorkbenchPrincipal;sessionPredicate:Predicate;cursor?:unknown;limit?:unknown}):Promise<P2016AssignmentHistoryPage>{
 const n=limitP2016(limit??20,100),scope=hashP2016({principal:principal.principal_id,roles:[...principal.roles].sort(),teams:[...principal.team_ids].sort()});
 const page=cursor===null||cursor===undefined?null:decodeCursorP2016(cursor,['v','ticket','scope','ordinal','id']);
 if(page&&(page.v!==1||page.ticket!==ticketId||page.scope!==scope))failP2016('CURSOR_INVALID');
 const ordinal=page?versionP2016(page.ordinal):0,id=page?uuidP2016(page.id):null;
 const basis=await queryable.query<{recorded:boolean}>(`SELECT EXISTS(SELECT 1 FROM pilot_ticket.ticket_handling_cycle c JOIN pilot_ticket.ticket_event e
   ON e.ticket_id=c.ticket_id AND e.event_id=c.first_responsibility_event_id
   WHERE c.ticket_id=$1::uuid AND c.cycle_no=1 AND e.event_type IN ('ticket.accepted','ticket.assignment_transferred')
     AND e.operator_type='PILOT_USER' AND e.operator_id=c.first_responsibility_principal_id::text) AS recorded`,[ticketId]);
 const result=await queryable.query<HistoryRow>(`SELECT e.event_id::text,e.event_ordinal,e.created_at AS occurred_at,
   COALESCE(c.first_responsibility_event_id=e.event_id,false) AS first,c.cycle_no,actor.display_name AS actor_name,
   CASE WHEN e.assignment_metadata IS NOT NULL THEN e.assignment_metadata->>'old_assignee_id' ELSE NULL END AS previous_person_id,
   CASE WHEN e.assignment_metadata IS NOT NULL THEN e.assignment_metadata->>'new_assignee_id'
     WHEN c.first_responsibility_event_id=e.event_id THEN c.first_responsibility_principal_id::text ELSE NULL END AS next_person_id,
   CASE WHEN e.assignment_metadata IS NOT NULL THEN e.assignment_metadata->>'old_team_id'
     WHEN prefix.proven THEN c.first_responsibility_team_id ELSE NULL END AS previous_team_id,
   CASE WHEN e.assignment_metadata IS NOT NULL THEN e.assignment_metadata->>'new_team_id'
     WHEN c.first_responsibility_event_id=e.event_id THEN c.first_responsibility_team_id ELSE NULL END AS next_team_id,
   previous_person.display_name AS previous_person_name,next_person.display_name AS next_person_name,
   previous_team.display_name AS previous_team_name,next_team.display_name AS next_team_name,
   (e.assignment_metadata IS NOT NULL OR COALESCE(prefix.proven,false)) AS previous_proven,
   (e.assignment_metadata IS NOT NULL OR (c.first_responsibility_event_id=e.event_id AND e.operator_type='PILOT_USER'
     AND e.operator_id=c.first_responsibility_principal_id::text AND e.event_type='ticket.accepted')) AS next_proven
   FROM pilot_ticket.ticket_event e
   LEFT JOIN pilot_ticket.ticket_handling_cycle_event link ON link.ticket_id=e.ticket_id AND link.ticket_event_id=e.event_id
   LEFT JOIN pilot_ticket.ticket_handling_cycle c ON c.ticket_id=link.ticket_id AND c.id=link.cycle_id
   LEFT JOIN LATERAL (SELECT count(*)=e.event_ordinal-1 AND min(h.event_ordinal)=1
     AND bool_or(h.event_ordinal=1 AND (h.event_type='ticket.created' OR (h.event_type='ticket.queued' AND h.old_status='NEW')))
     AND bool_and(h.event_type NOT IN (${assignmentTypes})) AS proven
     FROM (SELECT event_ordinal,event_type,old_status FROM pilot_ticket.ticket_event h WHERE h.ticket_id=e.ticket_id
       AND h.event_ordinal<e.event_ordinal ORDER BY h.event_ordinal DESC LIMIT 200) h
     WHERE c.cycle_no=1 AND c.first_responsibility_event_id=e.event_id AND e.event_type='ticket.accepted'
       AND e.operator_type='PILOT_USER' AND e.operator_id=c.first_responsibility_principal_id::text) prefix ON TRUE
   LEFT JOIN pilot_ticket.pilot_principal actor ON actor.id::text=e.operator_id AND e.operator_type='PILOT_USER'
   LEFT JOIN pilot_ticket.pilot_principal previous_person ON previous_person.id::text=e.assignment_metadata->>'old_assignee_id'
   LEFT JOIN pilot_ticket.pilot_principal next_person ON next_person.id::text=COALESCE(e.assignment_metadata->>'new_assignee_id',c.first_responsibility_principal_id::text)
   LEFT JOIN pilot_ticket.resolver_team previous_team ON previous_team.team_id=COALESCE(e.assignment_metadata->>'old_team_id',CASE WHEN prefix.proven THEN c.first_responsibility_team_id END)
   LEFT JOIN pilot_ticket.resolver_team next_team ON next_team.team_id=COALESCE(e.assignment_metadata->>'new_team_id',c.first_responsibility_team_id)
   WHERE e.ticket_id=$1::uuid AND (e.event_type IN (${assignmentTypes}) OR c.first_responsibility_event_id=e.event_id)
     AND (e.event_ordinal,e.event_id)>($2::integer,COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid))
   ORDER BY e.event_ordinal,e.event_id LIMIT $4`,[ticketId,ordinal,id,n+1]);
 const selected=result.rows.slice(0,n),communication=new Map<string,CommunicationRow[]>();
 if(selected.length){
  const controls=await queryable.query<CommunicationRow>(`SELECT e.event_id::text AS ticket_event_id,visible.* FROM pilot_ticket.ticket_event e
    JOIN pilot_ticket.ticket_command_receipt l ON l.ticket_id=e.ticket_id AND l.state='COMMITTED'
      AND l.actor_principal_id::text=e.operator_id AND e.operator_type='PILOT_USER'
      AND l.command_scope='P2_016:'||l.actor_principal_id::text
      AND e.trace_id IN ('t04:'||l.client_command_id::text,'t05:'||l.client_command_id::text,'p2-016:'||l.client_command_id::text)
      AND l.command_type IN ('take-and-start','accept-for-later','take-and-start-with-conversations','accept-for-later-with-conversations',
        'WORKBENCH_TICKET_ASSIGNMENT','WORKBENCH_TICKET_TAKEOVER','WORKBENCH_TICKET_TAKEOVER_COMPLETION','WORKBENCH_TICKET_UNASSIGN','WORKBENCH_TICKET_RETURN_TO_DISPATCH')
    JOIN pilot_ticket.ticket_event final ON final.ticket_id=l.ticket_id AND final.event_id=l.result_ticket_event_id
      AND final.aggregate_version=l.result_ticket_version AND final.operator_type='PILOT_USER'
      AND final.operator_id=l.actor_principal_id::text AND final.event_ordinal>=e.event_ordinal
      AND right(final.trace_id,36)=l.client_command_id::text
    JOIN pilot_ticket.ticket t ON t.id=e.ticket_id
    JOIN LATERAL (SELECT s.id::text AS session_id,ce.id::text AS control_event_id,ce.occurred_at,actor.display_name AS actor_name,
      ce.old_assignment_status,ce.new_assignment_status,prior.target_principal_id::text AS previous_target,
      prior.new_assignment_status AS previous_status,previous.display_name AS previous_name,
      ce.target_principal_id::text AS next_target,next.display_name AS next_name
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(l.result_snapshot->'conversations')='array' THEN l.result_snapshot->'conversations' ELSE '[]'::jsonb END) ref
      JOIN conversation.control_event ce ON ce.id::text=ref->>'control_event_id' AND ce.session_id::text=ref->>'session_id'
        AND ce.client_command_id=l.client_command_id AND ce.actor_principal_id=l.actor_principal_id
        AND ce.session_row_version_after::text=ref->>'session_row_version' AND ref->'changed'='true'::jsonb
        AND ce.event_type IN (${assignmentControls})
      JOIN conversation.session s ON s.id=ce.session_id
      JOIN intake.service_intake retained ON retained.id=s.service_intake_id AND retained.retention_until>platform.local_now()
      LEFT JOIN conversation.assignment a ON a.session_id=s.id
      LEFT JOIN pilot_ticket.ticket st ON st.source_intake_id=s.service_intake_id
      LEFT JOIN LATERAL (SELECT before.target_principal_id,before.new_assignment_status FROM conversation.control_event before
        WHERE before.session_id=ce.session_id AND before.event_ordinal<ce.event_ordinal AND before.event_type IN (${assignmentControls})
        ORDER BY before.event_ordinal DESC LIMIT 1) prior ON TRUE
      LEFT JOIN pilot_ticket.pilot_principal actor ON actor.id=ce.actor_principal_id
      LEFT JOIN pilot_ticket.pilot_principal previous ON previous.id=prior.target_principal_id
      LEFT JOIN pilot_ticket.pilot_principal next ON next.id=ce.target_principal_id
      WHERE ${sessionPredicate.sql} AND (s.service_intake_id=t.source_intake_id OR EXISTS(SELECT 1 FROM intake.channel_leg own
        JOIN intake.channel_leg related ON related.journey_id=own.journey_id WHERE own.source_intake_id=t.source_intake_id
          AND related.conversation_session_id=s.id AND related.source_intake_id=s.service_intake_id
          AND related.conversation_thread_id=s.thread_id AND related.reporter_identity_hash=own.reporter_identity_hash))
      ORDER BY ce.event_ordinal,ce.id LIMIT 8) visible ON TRUE
    WHERE e.ticket_id=$1::uuid AND e.event_id=ANY($2::uuid[])`,[ticketId,selected.map(row=>row.event_id),...sessionPredicate.values]);
  for(const control of controls.rows){const list=communication.get(control.ticket_event_id)??[];list.push(control);communication.set(control.ticket_event_id,list);}
 }
 const items:P2016AssignmentHistoryItem[]=selected.map(row=>({ticket_event_id:uuidP2016(row.event_id),event_ordinal:versionP2016(row.event_ordinal),kind:row.first?'FIRST_RESPONSIBILITY':'RESPONSIBILITY_CHANGE',occurred_at:localP2016(row.occurred_at),actor:known(row.actor_name),handling_cycle:row.cycle_no===null?{state:'UNKNOWN'}:{state:'KNOWN',cycle_no:versionP2016(row.cycle_no)},previous:{person:person(row.previous_person_id,row.previous_person_name,row.previous_proven),team:row.previous_proven?known(row.previous_team_name):{state:'UNKNOWN'}},next:{person:person(row.next_person_id,row.next_person_name,row.next_proven),team:row.next_proven?known(row.next_team_name):{state:'UNKNOWN'}},communication:(communication.get(row.event_id)??[]).map(control=>({session_id:uuidP2016(control.session_id),control_event_id:uuidP2016(control.control_event_id),occurred_at:localP2016(control.occurred_at),actor:known(control.actor_name),previous:control.old_assignment_status==='UNASSIGNED'?{state:'NONE'}:control.previous_status==='ASSIGNED'?person(control.previous_target,control.previous_name,control.previous_target!==null):{state:'UNKNOWN'},next:control.new_assignment_status==='UNASSIGNED'?{state:'NONE'}:person(control.next_target,control.next_name,control.next_target!==null)}))}));
 const last=items.at(-1);
 return {schema_version:1,ticket_id:ticketId,initial_basis:basis.rows[0]?.recorded?'RECORDED':'UNKNOWN',items,next_cursor:result.rows.length>n&&last?cursorP2016({v:1,ticket:ticketId,scope,ordinal:last.event_ordinal,id:last.ticket_event_id}):null};
}