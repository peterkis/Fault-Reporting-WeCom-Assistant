import type {PostgresTransaction} from './platform/postgres-pool.mjs';
/** Existing committed purpose and binding, rechecked at attempt admission. */
export function createIncidentPublicProgressAdmission({enabled=false}:{enabled?:boolean}={}){
  return async({transaction:tx,deliveryId}:{transaction:PostgresTransaction;deliveryId:string})=>{
    const purpose=await tx.query<{sender_system_code:string}>(`SELECT m.sender_system_code FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id WHERE d.id=$1::uuid`,[deliveryId]);
    if(purpose.rows[0]?.sender_system_code!=='INCIDENT_PUBLIC_PROGRESS')return true;
    if(!enabled)return false;
    // Same lock as publication and pause/change commands, held until the
    // LEASED->SENDING transaction commits. After admission it is in-flight.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_012_COMMAND',0))");
    const current=await tx.query(`SELECT s.id FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
      JOIN communication.incident_notification_binding b ON b.communication_message_id=o.message_id
      JOIN incident.incident_event e ON e.id=b.incident_event_id AND e.incident_id=b.incident_id AND e.event_type='incident.public_progress_published'
      JOIN incident.reporter_subscription s ON s.id=b.reporter_subscription_id AND s.incident_id=b.incident_id AND s.reporter_identity_hash=b.audience_binding_hash AND s.direct_channel_leg_id=b.direct_channel_leg_id
      JOIN intake.channel_leg l ON l.id=b.direct_channel_leg_id AND l.reporter_identity_hash=s.reporter_identity_hash
      JOIN intake.contact_journey j ON j.id=l.journey_id AND j.reporter_identity_hash=l.reporter_identity_hash
      JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE d.id=$1::uuid AND b.template_code='INCIDENT_PUBLIC_PROGRESS_DIRECT'
      AND b.audience_type='REPORTER_DIRECT' AND s.status='ACTIVE' AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')
      AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
      AND i.source_chat_type='single' AND d.provider='WECOM_AIBOT' AND d.target_type='PERSON'
      AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid FOR SHARE OF s,l,j,i`,[deliveryId]);
    return current.rowCount===1;
  };
}
