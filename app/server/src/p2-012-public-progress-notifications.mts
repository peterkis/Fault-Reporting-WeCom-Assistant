import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {Incident} from '../../../contracts/p2_012_contracts.js';
import {appendCommunication} from './p2-004-communication-core.mjs';
import {randomUUID} from 'node:crypto';
import {fail} from './p2-012-domain-contracts.mjs';
export const PUBLIC_PROGRESS_TEMPLATE='INCIDENT_PUBLIC_PROGRESS_DIRECT';
export function createPublicProgressNotifications({testLabel=false,communicationAppend=appendCommunication}:{testLabel?:boolean;communicationAppend?:typeof appendCommunication|undefined}={}){
  return async({transaction:tx,incident,eventId,summary}:{transaction:PostgresTransaction;incident:Incident;eventId:string;summary:string})=>{
    const destinations=await tx.query<{subscription_id:string;leg_id:string;binding:string;account:string;target:string}>(`SELECT s.id::text AS subscription_id,l.id::text AS leg_id,s.reporter_identity_hash AS binding,i.source_bot_id AS account,i.reporter_wecom_userid AS target
      FROM incident.reporter_subscription s JOIN intake.channel_leg l ON l.id=s.direct_channel_leg_id AND l.reporter_identity_hash=s.reporter_identity_hash
      JOIN intake.contact_journey j ON j.id=l.journey_id AND j.reporter_identity_hash=l.reporter_identity_hash
      JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE s.incident_id=$1::uuid AND s.status='ACTIVE'
      AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
      AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC') AND i.source_chat_type='single'
      AND length(i.source_bot_id)>0 AND length(i.reporter_wecom_userid)>0 ORDER BY s.reporter_identity_hash,s.id LIMIT 201 FOR SHARE OF s,l,j,i`,[incident.id]);
    if(destinations.rows.length>200)fail('LIMIT_INVALID');
    for(const d of destinations.rows){
      const text=(testLabel?'【P2-012测试】':'')+'【IT故障进展】'+summary;
      const result=await communicationAppend({transaction:tx,actor:null,command:{session_id:null,sender_kind:'SYSTEM',sender_system_code:'INCIDENT_PUBLIC_PROGRESS',purpose:'SYSTEM_NOTIFICATION',message_type:'text',visibility:'EXTERNAL',client_command_id:randomUUID(),content:{text},destination_policy:'INCIDENT_PUBLIC_PROGRESS_DIRECT',privacy_class:'INTERNAL',retention_until:incident.retention_until,retention_until_epoch_ms:incident.retention_until_epoch_ms},resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:d.account,target_type:'PERSON',target_id:d.target}]});
      if(!result||!('message_id' in result))fail('NOTIFICATION_FAILED',503);
      await tx.query(`INSERT INTO communication.incident_notification_binding(incident_id,incident_event_id,audience_type,audience_binding_hash,reporter_subscription_id,origin_channel_leg_id,direct_channel_leg_id,template_code,template_version,communication_message_id)
        VALUES($1::uuid,$2::uuid,'REPORTER_DIRECT',$3,$4::uuid,NULL,$5::uuid,$6,'1',$7::uuid)`,[incident.id,eventId,d.binding,d.subscription_id,d.leg_id,PUBLIC_PROGRESS_TEMPLATE,result.message_id]);
      await tx.query('UPDATE incident.reporter_subscription SET last_notified_incident_version=$2,updated_at=platform.local_now() WHERE id=$1::uuid',[d.subscription_id,incident.row_version]);
    }
    return {created:destinations.rows.length};
  };
}
