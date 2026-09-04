import { appendRealtimeEvent,REALTIME_STREAM_NAME } from './p2-003-realtime-event-log.mjs';
import { transactionP2016,guardP2016,limitP2016,uuidP2016 } from './p2-016-domain-contracts.mjs';

const publisher='P2_016_WORKBENCH';
export function createP2016RealtimeProjector({pool,enabled=false,wakeup=null}) {
  const lock=tx=>tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
  async function emit(tx,{source,id,type,aggregate,aggregateId,version,variant='V1',sessionId=null,payload}) {
    await lock(tx);
    const existing=await tx.query(`SELECT event_id::text FROM conversation.realtime_event WHERE publisher_name=$1
      AND source_type=$2 AND source_id=$3 AND event_type=$4 AND event_variant=$5
      AND authorization_scope_id IS NOT DISTINCT FROM $6::uuid LIMIT 1`,[publisher,source,id,type,variant,sessionId]);
    if(existing.rowCount)return {replayed:true};
    // Emission time is monotonic under the existing stream lock; the historical fact time stays in its source.
    const stamp=(await tx.query(`WITH clock AS (SELECT GREATEST(platform.local_now(),COALESCE(
      (SELECT max(occurred_at) FROM conversation.realtime_event WHERE stream_name=$1),platform.local_now())) AS at)
      SELECT at,at+interval '7 days' AS expires FROM clock`,[REALTIME_STREAM_NAME])).rows[0];
    return appendRealtimeEvent({transaction:tx,command:{schema_version:1,publisher_name:publisher,publisher_version:'1',
      source_type:source,source_id:id,event_variant:variant,event_type:type,aggregate_type:aggregate,aggregate_id:aggregateId,
      aggregate_version:String(version),authorization_scope_type:sessionId?'SESSION':'SYSTEM',authorization_scope_id:sessionId,
      visibility_scope:'WORKBENCH',payload,occurred_at:stamp.at,expires_at:stamp.expires}});
  }
  async function ticket({transaction:tx,ticket,event,command=null}) {
    guardP2016(enabled);
    const sessions=await tx.query('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid ORDER BY id LIMIT 100',[ticket.intake_id??ticket.source_intake_id]);
    const scopes=sessions.rowCount?sessions.rows.map(r=>r.id):[null];
    for(const sessionId of scopes){
      const base={source:'TICKET_EVENT',id:event.event_id,aggregate:'TICKET',aggregateId:ticket.id,version:event.aggregate_version,sessionId,
        payload:{ticket_id:ticket.id,ticket_event_id:event.event_id,version:String(event.aggregate_version)}};
      if(event.old_status!==event.new_status)await emit(tx,{...base,type:'ticket.status.changed'});
      if(event.event_type==='ticket.assignment_transferred'||event.event_type==='ticket.accepted')await emit(tx,{...base,type:'ticket.assignment.changed'});
      if(command)await emit(tx,{...base,type:'ticket.command.committed'});
      const notifications=await tx.query('SELECT delivery_id::text FROM communication.ticket_notification_binding WHERE ticket_event_id=$1::uuid',[event.event_id]);
      for(const row of notifications.rows)await emit(tx,{...base,source:'COMMUNICATION_DELIVERY',id:row.delivery_id,type:'ticket.notification.created',payload:{ticket_id:ticket.id,delivery_id:row.delivery_id}});
    }
  }
  ticket.lock=lock;
  async function review({transaction:tx,reviewId}) {
    guardP2016(enabled);
    const q=await tx.query(`SELECT r.id::text,r.row_version::text,r.status,d.conversation_session_id::text AS session_id
      FROM intake.manual_review_item r JOIN intake.deterministic_decision d ON d.id=r.decision_id WHERE r.id=$1::uuid`,[uuidP2016(reviewId)]);
    if(!q.rowCount)return;
    const r=q.rows[0];await emit(tx,{source:'MANUAL_REVIEW',id:r.id,type:r.status==='PENDING'?'manual_review.created':'manual_review.resolved',
      aggregate:'MANUAL_REVIEW',aggregateId:r.id,version:r.row_version,sessionId:r.session_id,payload:{review_id:r.id,status:r.status,version:r.row_version}});
  }
  async function runOnce({limit=20}={}) {
    if(!enabled)return {disabled:true,processed:0};const size=limitP2016(limit,100);
    const processed=await transactionP2016(pool,async tx=>{
      await lock(tx);let count=0;
      const reviews=await tx.query(`SELECT r.id::text FROM intake.manual_review_item r WHERE NOT EXISTS(
        SELECT 1 FROM conversation.realtime_event e WHERE e.publisher_name=$1 AND e.source_type='MANUAL_REVIEW'
        AND e.source_id=r.id::text AND e.event_type=CASE WHEN r.status='PENDING' THEN 'manual_review.created' ELSE 'manual_review.resolved' END)
        ORDER BY r.created_at,r.id LIMIT $2`,[publisher,size]);
      for(const r of reviews.rows){await review({transaction:tx,reviewId:r.id});count++;}
      const deliveries=await tx.query(`SELECT d.id::text,d.attempt_count,d.status,b.ticket_id::text,t.source_intake_id::text
        FROM communication.delivery d JOIN communication.ticket_notification_binding b ON b.delivery_id=d.id
        JOIN pilot_ticket.ticket t ON t.id=b.ticket_id WHERE NOT EXISTS(SELECT 1 FROM conversation.realtime_event e
          WHERE e.publisher_name=$1 AND e.source_type='COMMUNICATION_DELIVERY' AND e.source_id=d.id::text
          AND e.event_type='ticket.notification.delivery_changed' AND e.event_variant=d.status||'_'||d.attempt_count::text)
        ORDER BY d.updated_at,d.id LIMIT $2`,[publisher,size]);
      for(const d of deliveries.rows){
        const sessions=await tx.query('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid ORDER BY id LIMIT 100',[d.source_intake_id]);
        for(const sessionId of sessions.rowCount?sessions.rows.map(s=>s.id):[null])await emit(tx,{source:'COMMUNICATION_DELIVERY',id:d.id,
          type:'ticket.notification.delivery_changed',aggregate:'TICKET',aggregateId:d.ticket_id,version:d.attempt_count,
          variant:d.status+'_'+d.attempt_count,sessionId,payload:{ticket_id:d.ticket_id,delivery_id:d.id,status:d.status}});
        count++;
      }
      return count;
    });
    try{await wakeup?.();}catch{/* Advisory only. Committed durable facts are not rolled back. */}
    return {disabled:false,processed};
  }
  return Object.freeze({ticket,review,lock,runOnce});
}
