import { createPilotWorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import { ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
import { guard,uuid,limit,cursor,decodeCursor,frozen,fail,assertLocalDateTime,version,CANDIDATE_STATES,INCIDENT_STATES } from './p2-012-domain-contracts.mjs';

export const broad=p=>p.roles.some(r=>['ADMIN','DISPATCHER'].includes(r));
export function createP2012IncidentQuery({pool,enabled=false,authorization=createPilotWorkbenchAuthorizationAdapter({pool})}){
  async function principal(authContext,tx=pool){guard(enabled);const p=await authorization.resolvePrincipal(authContext,{queryable:tx});if(!p)fail('FORBIDDEN',403);return p;}
  function access(p,kind,start=2){const pred=ticketPredicateP2016(p,start);return {values:pred.values,sql:kind==='candidate'?
    `EXISTS(SELECT 1 FROM intake.deterministic_decision d LEFT JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE d.id=c.source_decision_id AND ${pred.sql})`:
    `($${start}::boolean OR EXISTS(SELECT 1 FROM incident.incident_report r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id WHERE r.incident_id=c.id AND r.link_state='LINKED' AND ${pred.sql}))`};}
  async function resource({authContext,id,kind,tx=pool,lock=false}){
    const p=await principal(authContext,tx),a=access(p,kind);
    const r=await tx.query(`SELECT c.* FROM incident.${kind==='candidate'?'candidate_review':'incident'} c WHERE c.id=$1::uuid AND ${a.sql}${lock?' FOR UPDATE OF c':''}`,[uuid(id),...a.values]);
    if(r.rowCount!==1)fail('NOT_FOUND',404);return {principal:p,row:r.rows[0]};
  }
  async function source({tx=pool,principal:p,id}){
    const pred=ticketPredicateP2016(p,2);
    const q=await tx.query(`SELECT d.id::text,d.journey_id::text,d.service_intake_id::text,d.linked_ticket_id::text AS ticket_id,
      d.channel_leg_id::text,t.ticket_no,j.reporter_identity_hash,j.origin_intake_id::text,t.assignee_id::text,t.resolver_team_id
      FROM intake.deterministic_decision d JOIN intake.contact_journey j ON j.id=d.journey_id
      LEFT JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE d.id=$1::uuid AND ${pred.sql}`,[uuid(id),...pred.values]);
    if(q.rowCount!==1)fail('SOURCE_NOT_FOUND',404);return q.rows[0];
  }
  const publicIncident=r=>Object.fromEntries(['id','incident_no','status','confirmed_scope','service_family','symptom_family','severity','safe_title','row_version','confirmed_at','investigating_at','resolved_at','closed_at','created_at','updated_at'].map(k=>[k,r[k]]));
  return Object.freeze({principal,resource,source,
    async list({authContext,kind='incident',state=null,after=null,pageLimit}){
      const p=await principal(authContext),n=limit(pageLimit),a=access(p,kind,1),allowed=kind==='candidate'?CANDIDATE_STATES:INCIDENT_STATES;
      if(state!==null&&!allowed.includes(state)&&!['ACTIVE','FINISHED'].includes(state))fail();
      const c=after?decodeCursor(after,['kind','state','at','id']):null;
      if(c&&(c.kind!==kind||c.state!==state))fail('CURSOR_INVALID');
      if(c){uuid(c.id);assertLocalDateTime(c.at);}
      const states=state==='ACTIVE'?INCIDENT_STATES.filter(s=>!['RESOLVED','CLOSED'].includes(s)):state==='FINISHED'?['RESOLVED','CLOSED']:state?[state]:null;
      const q=await pool.query(`SELECT c.* FROM incident.${kind==='candidate'?'candidate_review':'incident'} c WHERE ${a.sql}
        AND ($4::text[] IS NULL OR c.status=ANY($4::text[])) AND ($5::timestamp without time zone IS NULL OR (c.created_at,c.id)>($5::timestamp without time zone,$6::uuid))
        ORDER BY c.created_at,c.id LIMIT $7`,[...a.values,states,c?.at??null,c?.id??null,n+1]);
      const items=q.rows.slice(0,n).map(r=>kind==='candidate'?r:publicIncident(r)),last=items.at(-1);
      return frozen({items,next_cursor:q.rows.length>n?cursor({kind,state,at:last.created_at,id:last.id}):null});
    },
    async detail({authContext,id,kind='incident'}){
      const {principal:p,row}=await resource({authContext,id,kind});
      if(kind==='incident'){
        const refs=broad(p)?(await pool.query('SELECT owner.display_name AS owner_display_name,t.ticket_no AS primary_ticket_no FROM pilot_ticket.pilot_principal owner LEFT JOIN pilot_ticket.ticket t ON t.id=$2::uuid WHERE owner.id=$1::uuid',[row.owner_principal_id,row.primary_ticket_id])).rows[0]:null;
        return frozen({...publicIncident(row),...(broad(p)?{owner_principal_id:row.owner_principal_id,owner_display_name:refs?.owner_display_name??null,owner_team_id:row.owner_team_id,primary_ticket_id:row.primary_ticket_id,primary_ticket_no:refs?.primary_ticket_no??null}:{}),roles:p.roles});
      }
      const d=(await pool.query('SELECT id,result_code,reason_code,catalog_version,rule_set_version,engine_version,decision_policy_version,input_hash,result_hash,safe_result FROM intake.deterministic_decision WHERE id=$1::uuid',[row.source_decision_id])).rows[0];
      const refs=d.safe_result.incident_report_decision_ids??[row.source_decision_id];const sources=[];
      for(const ref of refs.slice(0,100)){try{const s=await source({principal:p,id:ref});sources.push({source_decision_id:s.id,journey_id:s.journey_id,ticket_id:s.ticket_id,ticket_no:s.ticket_no,service_intake_id:s.service_intake_id});}catch(e){if(e.code!=='P2_012_SOURCE_NOT_FOUND')throw e;}}
      const manual=row.source_manual_review_id?(await pool.query('SELECT id,status,priority,review_reason_code,row_version,resolution_code,created_at,resolved_at FROM intake.manual_review_item WHERE id=$1::uuid',[row.source_manual_review_id])).rows[0]??null:null;
      const safeRefs=(Array.isArray(d.safe_result?.source_refs)?d.safe_result.source_refs:[]).filter(x=>typeof x==='string'&&/^(?:channel:[1-9][0-9]{0,18}|intake:[a-f0-9-]{36})$/iu.test(x)).slice(0,100);
      const decision={id:d.id,result_code:d.result_code,reason_code:d.reason_code,catalog_version:d.catalog_version,rule_set_version:d.rule_set_version,engine_version:d.engine_version,decision_policy_version:d.decision_policy_version,input_hash:d.input_hash,result_hash:d.result_hash,source_refs:safeRefs};
      const owners=broad(p)?(await pool.query("SELECT p.id,p.display_name FROM pilot_ticket.pilot_principal p WHERE p.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER')) ORDER BY p.id LIMIT 100")).rows:[];
      return frozen({...row,source_decision:decision,manual_review:manual,report_sources:sources,eligible_owners:owners,roles:p.roles});
    },
    async children({authContext,id,part,after=null,pageLimit}){
      const {principal:p,row}=await resource({authContext,id,kind:'incident'}),n=limit(pageLimit,part==='events'?200:100);
      const c=after?decodeCursor(after,part==='events'?['incident','part','id','ordinal']:['incident','part','id']):null;if(c&&(c.incident!==id||c.part!==part))fail('CURSOR_INVALID');if(c){uuid(c.id);if(part==='events')version(c.ordinal);}
      const directSubscription=/^subscriptions\/([a-f0-9-]{36})\/direct-destinations$/iu.exec(part);
      let sql,values=[row.id,c?.id??null,n+1];
      if(part==='events'){
        sql=`SELECT id,event_type,event_ordinal,old_status,new_status,old_scope,new_scope,occurred_at FROM incident.incident_event WHERE incident_id=$1::uuid AND ($2::bigint IS NULL OR event_ordinal>$2::bigint) AND ($4::boolean OR event_type IN ('incident.confirmed','incident.investigating','incident.resolved','incident.closed')) ORDER BY event_ordinal,id LIMIT $3`;values[1]=c?.ordinal??null;values.push(broad(p));
      }else if(part==='reports'){
        const pred=ticketPredicateP2016(p,4);values.push(...pred.values);
        sql=`SELECT r.id,r.ticket_id,t.ticket_no,r.service_intake_id,r.link_state,r.impact_state,r.row_version,r.linked_at,r.unlinked_at,r.recovered_at FROM incident.incident_report r LEFT JOIN pilot_ticket.ticket t ON t.id=r.ticket_id WHERE r.incident_id=$1::uuid AND ($2::uuid IS NULL OR r.id>$2::uuid) AND ${pred.sql} ORDER BY r.id LIMIT $3`;
      }else if(part==='linkable-reports'){
        if(!broad(p))fail('FORBIDDEN',403);
        sql=`SELECT d.id AS source_decision_id,d.id,t.ticket_no FROM intake.deterministic_decision d
          JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE ($2::uuid IS NULL OR d.id>$2::uuid)
          AND NOT EXISTS(SELECT 1 FROM incident.incident_report r JOIN incident.incident i ON i.id=r.incident_id
            WHERE r.ticket_id=t.id AND r.link_state='LINKED' AND i.status<>'CLOSED')
          AND $1::uuid IS NOT NULL ORDER BY d.id LIMIT $3`;
      }else if(part==='direct-destinations'||directSubscription){
        if(!p.roles.includes('ADMIN'))fail('FORBIDDEN',403);
        values.push(directSubscription?uuid(directSubscription[1]):null);
        sql=`SELECT l.id,s.id AS subscription_id,i.intake_no AS source_intake_no FROM incident.reporter_subscription s
          JOIN intake.channel_leg l ON l.reporter_identity_hash=s.reporter_identity_hash
          JOIN intake.service_intake i ON i.id=l.source_intake_id
          WHERE s.incident_id=$1::uuid AND ($4::uuid IS NULL OR s.id=$4::uuid) AND s.status<>'ENDED' AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')
            AND i.source_chat_type='single' AND ($2::uuid IS NULL OR l.id>$2::uuid) ORDER BY l.id LIMIT $3`;
      }else if(part==='subscriptions'){
        if(!broad(p))fail('FORBIDDEN',403);
        sql=`SELECT id,representative_report_id,status,impact_state,row_version,last_notified_incident_version,created_at,updated_at FROM incident.reporter_subscription WHERE incident_id=$1::uuid AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`;
      }else if(part==='notifications'){
        if(!broad(p))fail('FORBIDDEN',403);
        sql=`SELECT b.id,b.audience_type,b.template_code,d.id AS delivery_id,d.status,d.side_effect_state,d.attempt_count,b.created_at FROM communication.incident_notification_binding b JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_id=$1::uuid AND ($2::uuid IS NULL OR b.id>$2::uuid) ORDER BY b.id LIMIT $3`;
      }else fail();
      const q=await pool.query(sql,values),items=q.rows.slice(0,n);return frozen({items,next_cursor:q.rows.length>n?cursor({incident:id,part,id:items.at(-1).id,...(part==='events'?{ordinal:String(items.at(-1).event_ordinal)}:{})}):null});
    },
  });
}
