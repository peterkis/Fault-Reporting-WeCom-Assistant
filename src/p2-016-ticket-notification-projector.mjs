import { randomUUID } from 'node:crypto';
import { appendCommunication } from './p2-004-communication-core.mjs';
import { ticketNotificationP2016 } from './p2-016-ticket-notification-policy.mjs';
import { failP2016,guardP2016,textHashP2016,stampP2016 } from './p2-016-domain-contracts.mjs';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';

export function createP2016TicketNotificationProjector({enabled=false,cardEnabled=false,reporterAccess,now=()=>String(Date.now())}) {
  return Object.freeze({
    async project({transaction:tx,ticket,event}) {
      guardP2016(enabled);
      const fact=await tx.query(`SELECT e.event_id::text,e.ticket_id::text,e.event_type,e.new_status,e.created_at,e.aggregate_version,
        t.ticket_no,t.source_intake_id::text AS intake_id FROM pilot_ticket.ticket_event e
        JOIN pilot_ticket.ticket t ON t.id=e.ticket_id WHERE e.event_id=$1::uuid AND e.ticket_id=$2::uuid FOR UPDATE OF e`,[event.event_id,ticket.id]);
      if(fact.rowCount!==1)failP2016('NOTIFICATION_EVENT_INVALID');
      event=fact.rows[0];ticket={id:event.ticket_id,ticket_no:event.ticket_no,intake_id:event.intake_id};
      const policy=ticketNotificationP2016({event_type:event.event_type,new_status:event.new_status});
      if(!policy)return {created:false,reason:'NO_EXTERNAL_NOTIFICATION'};
      const legacy=await tx.query('SELECT 1 FROM notification.outbox WHERE ticket_event_id=$1::uuid LIMIT 1',[event.event_id]);
      if(legacy.rowCount)return {created:false,reason:'P1_NOTIFICATION_OWNS_EVENT'};
      const origin=await tx.query(`SELECT i.source_bot_id,i.reporter_wecom_userid,
        CASE WHEN origin.source_chat_type='group' THEN origin.source_chat_type ELSE i.source_chat_type END AS source_chat_type,
        CASE WHEN origin.source_chat_type='group' THEN origin.source_chat_id ELSE i.source_chat_id END AS source_chat_id
        FROM intake.service_intake i LEFT JOIN intake.channel_leg leg ON leg.source_intake_id=i.id
        LEFT JOIN intake.contact_journey j ON j.id=leg.journey_id
        LEFT JOIN intake.service_intake origin ON origin.id=j.origin_intake_id
          AND origin.source_bot_id=i.source_bot_id AND origin.reporter_wecom_userid=i.reporter_wecom_userid
        WHERE i.id=$1::uuid`,[ticket.intake_id]);
      if(origin.rowCount!==1)failP2016('NOTIFICATION_BINDING_INVALID');
      const source=origin.rows[0],binding=textHashP2016(JSON.stringify(['WECOM_AIBOT',source.source_bot_id,source.reporter_wecom_userid]));
      const existing=await tx.query(`SELECT message_id::text,outbox_id::text,delivery_id::text FROM communication.ticket_notification_binding
        WHERE ticket_event_id=$1::uuid AND notification_type=$2 AND recipient_binding_hash=$3 AND destination_type='PERSON' AND template_version=$4`,
      [event.event_id,policy.notification_type,binding,policy.template_version]);
      if(existing.rowCount)return {created:false,replayed:true,...existing.rows[0]};
      const suffix=ticket.ticket_no.slice(-4),stamp=stampP2016(now),expiry=String(BigInt(stamp.epoch)+2592000000n);
      const commandId=randomUUID();
      // Persist a capability-free view model. The Sender reconstructs the grant only at the network boundary.
      let content={text:'工单尾号 '+suffix+'：'+policy.external_status+'。如需补充，请在机器人单聊中回复。'};
      let publicRef=null;
      if(cardEnabled){
        const ref=await reporterAccess.ensurePublicRefInTransaction({transaction:tx,ticketId:ticket.id,reporterBindingHash:binding});
        publicRef=ref.public_ref;
        content={public_ref:publicRef,suffix,status:event.new_status,occurred_at:event.created_at,version:event.aggregate_version,
          notification_type:policy.notification_type,source:source.source_chat_type==='group'?'GROUP':'DIRECT'};
      }
      const message=await appendCommunication({transaction:tx,actor:null,command:{
        session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',
        message_type:cardEnabled?'template_card':'text',visibility:'EXTERNAL',client_command_id:commandId,content,
        destination_policy:'P2_016_REPORTER',privacy_class:'INTERNAL',retention_until:formatEpochMsToShanghaiLocal(expiry),retention_until_epoch_ms:expiry,
      },resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,target_type:'PERSON',target_id:source.reporter_wecom_userid}]});
      if(message.error)failP2016('NOTIFICATION_FAILED',503);
      await tx.query(`INSERT INTO communication.ticket_notification_binding(ticket_event_id,ticket_id,notification_type,recipient_binding_hash,
        destination_type,template_version,message_id,outbox_id,delivery_id) VALUES($1::uuid,$2::uuid,$3,$4,'PERSON',$5,$6::uuid,$7::uuid,$8::uuid)`,
      [event.event_id,ticket.id,policy.notification_type,binding,policy.template_version,message.message_id,message.outbox_id,message.delivery_ids[0]]);
      if(cardEnabled)await reporterAccess.issueInTransaction({transaction:tx,ticketId:ticket.id,deliveryId:message.delivery_ids[0],messageId:message.message_id,reporterBindingHash:binding});
      if(policy.notification_type==='TICKET_CREATED'&&source.source_chat_type==='group'){
        const groupBinding=textHashP2016(JSON.stringify(['WECOM_AIBOT',source.source_bot_id,source.source_chat_id]));
        const group=await appendCommunication({transaction:tx,actor:null,command:{
          session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',
          message_type:'text',visibility:'EXTERNAL',client_command_id:randomUUID(),
          content:{text:'工单已受理，尾号为 '+suffix+'。后续进度将通过机器人单聊通知。'},
          destination_policy:'P2_016_GROUP_RECEIPT',privacy_class:'INTERNAL',
          retention_until:formatEpochMsToShanghaiLocal(expiry),retention_until_epoch_ms:expiry,
        },resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,target_type:'GROUP',target_id:source.source_chat_id}]});
        if(group.error)failP2016('NOTIFICATION_FAILED',503);
        await tx.query(`INSERT INTO communication.ticket_notification_binding(ticket_event_id,ticket_id,notification_type,recipient_binding_hash,
          destination_type,template_version,message_id,outbox_id,delivery_id) VALUES($1::uuid,$2::uuid,$3,$4,'GROUP',$5,$6::uuid,$7::uuid,$8::uuid)`,
        [event.event_id,ticket.id,policy.notification_type,groupBinding,policy.template_version,group.message_id,group.outbox_id,group.delivery_ids[0]]);
      }
      return {created:true,message_id:message.message_id,outbox_id:message.outbox_id,delivery_id:message.delivery_ids[0]};
    },
  });
}
