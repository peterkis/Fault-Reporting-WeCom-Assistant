import { appendP2016Realtime } from './p2-016-realtime-appender.mjs';
import { transaction } from './p2-012-domain-contracts.mjs';
const TYPES=Object.freeze({'candidate.review_started':'incident.candidate.review_started','candidate.rejected':'incident.candidate.rejected',
  'candidate.expired':'incident.candidate.expired','candidate.confirmed':'incident.candidate.confirmed','incident.confirmed':'incident.confirmed',
  'incident.investigating':'incident.status.changed','incident.resolved':'incident.status.changed','incident.closed':'incident.status.changed',
  'incident.scope.corrected':'incident.scope.changed','incident.primary_ticket_changed':'incident.primary_ticket.changed',
  'incident.report.linked':'incident.report.linked','incident.report.unlinked':'incident.report.unlinked','incident.report.recovered':'incident.report.recovered',
  'incident.subscription.created':'incident.subscription.changed','incident.subscription.activated':'incident.subscription.changed',
  'incident.subscription.paused':'incident.subscription.changed','incident.subscription.ended':'incident.subscription.changed'});
export function createP2012RealtimeProjector({pool,enabled=false,wakeup=null}){
  async function emit(tx,{id,type,incidentId=null,candidateId=null,version='1',payload,variant='V1',source='INCIDENT_EVENT'}){
    const stamp=(await tx.query("SELECT platform.local_now() AS at,platform.local_now()+interval '7 days' AS expires")).rows[0];
    async function appendScope(scope){await appendP2016Realtime({transaction:tx,command:{schema_version:1,publisher_name:'P2_012_WORKBENCH',publisher_version:'1',
      source_type:source,source_id:id,event_variant:variant,event_type:type,aggregate_type:candidateId?'INCIDENT_CANDIDATE':'INCIDENT',aggregate_id:incidentId??candidateId,
      aggregate_version:String(version),authorization_scope_type:scope?'SESSION':'SYSTEM',authorization_scope_id:scope,visibility_scope:'WORKBENCH',payload,occurred_at:stamp.at,expires_at:stamp.expires}});}
    let after=null;
    for(;;){
      const sessions=incidentId?await tx.query(`SELECT DISTINCT d.conversation_session_id AS id FROM incident.incident_report r
        JOIN intake.deterministic_decision d ON d.id=r.source_decision_id WHERE r.incident_id=$1::uuid AND r.link_state='LINKED'
        AND d.conversation_session_id IS NOT NULL AND ($2::uuid IS NULL OR d.conversation_session_id>$2::uuid) ORDER BY id LIMIT 100`,[incidentId,after]):
        await tx.query(`SELECT d.conversation_session_id AS id FROM incident.candidate_review c JOIN intake.deterministic_decision d ON d.id=c.source_decision_id WHERE c.id=$1::uuid AND d.conversation_session_id IS NOT NULL`,[candidateId]);
      for(const session of sessions.rows)await appendScope(session.id);
      if(!incidentId||sessions.rows.length<100)break;after=sessions.rows.at(-1).id;
    }
    await appendScope(null);
  }
  return Object.freeze({wakeup,
    async append({transaction:tx,event,incident,candidate}){if(!enabled)return;
      await emit(tx,{id:event.id,type:TYPES[event.event_type],incidentId:event.incident_id,candidateId:event.candidate_review_id,
        version:event.candidate_review_id?(candidate?.row_version??'1'):(incident?.row_version??'1'),payload:{event_id:event.id,resource_id:event.incident_id??event.candidate_review_id,status:event.new_status??'UPDATED'}});
    },
    async runOnce(){if(!enabled)return {processed:0};return transaction(pool,async tx=>{
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
      const q=await tx.query(`SELECT d.id,b.incident_id,i.row_version,d.status,d.attempt_count FROM communication.incident_notification_binding b
        JOIN incident.incident i ON i.id=b.incident_id JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id
        WHERE NOT EXISTS(SELECT 1 FROM conversation.realtime_event e WHERE e.publisher_name='P2_012_WORKBENCH' AND e.source_id=d.id::text
          AND e.event_type='incident.notification.changed' AND e.event_variant=d.status||'_'||d.attempt_count::text)
        ORDER BY d.updated_at,d.id LIMIT 20`);
      for(const d of q.rows)await emit(tx,{id:d.id,type:'incident.notification.changed',incidentId:d.incident_id,variant:d.status+'_'+d.attempt_count,version:d.row_version,
        source:'COMMUNICATION_DELIVERY',payload:{incident_id:d.incident_id,delivery_id:d.id,status:d.status}});
      return {processed:q.rowCount};
    });},
  });
}
