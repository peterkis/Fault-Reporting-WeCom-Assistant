import {randomUUID} from 'node:crypto';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {appendCommunication,computeCommunicationContentHash} from './p2-004-communication-core.mjs';
import {isDeepStrictEqual} from 'node:util';
import type {ClosureRecord} from './service-closure-records.mjs';
import {CLOSURE_REASONS,CLOSURE_NOTIFICATION_TEMPLATES,reporterClosureText} from './service-closure-records.mjs';
import {failP2016,textHashP2016} from './p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import {cancelUnattemptedDeliveryInTransaction} from './p2-004-communication-delivery-worker.mjs';
export interface ClosureNotificationOptions {communicationAppend?:typeof appendCommunication;personDestinationAuthorizer?:((input:{transaction:PostgresTransaction;bot_id:string;reporter_user_id:string})=>boolean|Promise<boolean>)|null}
export const SERVICE_CLOSURE_TRANSPORT='SERVICE_CLOSURE_TEXT';
const SOURCE_JOIN_SQL=`LEFT JOIN pilot_ticket.ticket t ON t.id=c.ticket_id
 JOIN intake.service_intake i ON i.id=COALESCE(c.intake_id,t.source_intake_id)`;
// Subject versions are monotonic even when multiple cycles share a wall-clock second.
const LATEST_CLOSURE_SQL=`NOT EXISTS(SELECT 1 FROM pilot_ticket.closure_record newer
 WHERE newer.subject_type=c.subject_type AND newer.before_version>c.before_version
 AND (newer.ticket_id=c.ticket_id OR newer.intake_id=c.intake_id))`;
const CURRENT_RESTORATION_SQL=`c.restored_at IS NOT NULL AND ${LATEST_CLOSURE_SQL} AND
 CASE WHEN c.ticket_id IS NOT NULL THEN t.status NOT IN ('RESOLVED','COMPLETED','DISMISSED')
 ELSE i.status NOT IN ('COMPLETED','DISMISSED') AND NOT EXISTS(
  SELECT 1 FROM pilot_ticket.ticket canonical WHERE canonical.status IN ('RESOLVED','COMPLETED','DISMISSED')
  AND (canonical.id=i.pilot_ticket_id OR canonical.source_intake_id=i.id OR EXISTS(
   SELECT 1 FROM intake.contact_journey j WHERE j.linked_ticket_id=canonical.id
    AND (j.origin_intake_id=i.id OR EXISTS(SELECT 1 FROM intake.channel_leg leg WHERE leg.journey_id=j.id AND leg.source_intake_id=i.id)))))
 END`;

export interface ServiceClosureDeliveryBinding {record_id:string;restoring:boolean;provider:string;channel_account_id:string;target_id:string;idempotency_key:string;content_hash:string;text:string;retention_epoch:string}
/** Dedicated immutable message/source binding. Never returns the internal note. */
export async function readServiceClosureDeliveryBinding(tx:PostgresTransaction,deliveryId:string):Promise<ServiceClosureDeliveryBinding|null>{
 const row=(await tx.query<ServiceClosureDeliveryBinding&Pick<ClosureRecord,'reason_code'|'duplicate_of_ref'>&{content:unknown}>(`SELECT c.id::text AS record_id,
  (c.restoration_notification_message_id IS NOT NULL AND m.id=c.restoration_notification_message_id) AS restoring,
  d.provider,d.channel_account_id,d.target_id,d.idempotency_key,m.content_hash,m.content,c.reason_code,c.duplicate_of_ref,
  LEAST(i.retention_until_epoch_ms,m.retention_until_epoch_ms)::text AS retention_epoch
 FROM pilot_ticket.closure_record c ${SOURCE_JOIN_SQL}
 JOIN communication.message m ON m.id=c.notification_message_id OR m.id=c.restoration_notification_message_id
 JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
 WHERE d.id=$1::uuid AND d.status='SENDING' AND c.notify_reporter
  AND m.sender_kind='SYSTEM' AND m.sender_system_code='TICKET_LIFECYCLE'
  AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL' AND m.message_type='text'
  AND d.provider='WECOM_AIBOT' AND d.target_type='PERSON'
  AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid
  AND NOT(i.source_channel='PORTAL' AND i.source_provider='YIXIAOXIU_WEB')
  AND NOT(i.source_channel='MANUAL' AND i.source_provider='STAFF_MANUAL_REPORT')
  AND i.retention_until_epoch_ms>platform.physical_epoch_ms() AND m.retention_until_epoch_ms>platform.physical_epoch_ms()
  AND ((m.id=c.notification_message_id AND c.restored_at IS NULL AND ${LATEST_CLOSURE_SQL})
    OR (m.id=c.restoration_notification_message_id AND (${CURRENT_RESTORATION_SQL})))`,[deliveryId])).rows[0];
 if(!row||!Object.hasOwn(CLOSURE_REASONS,row.reason_code))return null;
 const text=row.restoring?CLOSURE_NOTIFICATION_TEMPLATES.RESTORED:reporterClosureText(row),content={text,transport:SERVICE_CLOSURE_TRANSPORT};
 if(!isDeepStrictEqual(row.content,content)||row.content_hash!==computeCommunicationContentHash(content))return null;
 return {record_id:row.record_id,restoring:row.restoring,provider:row.provider,channel_account_id:row.channel_account_id,target_id:row.target_id,
  idempotency_key:row.idempotency_key,content_hash:row.content_hash,text,retention_epoch:row.retention_epoch};
}
/** Called only by the current runtime notification projector, in its caller's Tx. */
export async function projectServiceClosureNotification({transaction:tx,recordId,restoring=false,communicationAppend=appendCommunication,personDestinationAuthorizer=null}:{transaction:PostgresTransaction;recordId:string;restoring?:boolean}&ClosureNotificationOptions){
 const record=(await tx.query<ClosureRecord>('SELECT * FROM pilot_ticket.closure_record WHERE id=$1::uuid FOR UPDATE',[recordId])).rows[0];if(!record)failP2016('NOTIFICATION_EVENT_INVALID');
 const messageColumn=restoring?'restoration_notification_message_id':'notification_message_id',processedColumn=restoring?'restoration_notification_processed_at':'notification_processed_at';
 const processed=(await tx.query<{processed:boolean;message:string|null}>(`SELECT ${processedColumn} IS NOT NULL AS processed,${messageColumn}::text AS message FROM pilot_ticket.closure_record WHERE id=$1::uuid`,[recordId])).rows[0];
 if(processed?.processed)return {created:false,replayed:true,message_id:processed.message};
 let reason:string|null=!record.notify_reporter?'NO_EXTERNAL_NOTIFICATION':restoring?record.restored_at===null||record.notification_message_id===null?'CLOSURE_NOT_NOTIFIED':null:record.restored_at!==null?'ALREADY_RESTORED':null;
 if(restoring&&!reason){
  const current=(await tx.query<{current:boolean}>(`SELECT (${CURRENT_RESTORATION_SQL}) AS current
   FROM pilot_ticket.closure_record c ${SOURCE_JOIN_SQL} WHERE c.id=$1::uuid`,[recordId])).rows[0];
  if(current?.current!==true)reason='RESTORATION_SUPERSEDED';
 }
 if(restoring&&!reason){
  const deliveries=(await tx.query<{id:string;status:string;side_effect_state:string;lease_token:string|null;acknowledged:boolean}>(`SELECT d.id::text,d.status,d.side_effect_state,d.lease_token::text,
   d.status='SENT' AND d.side_effect_state='ACKNOWLEDGED' AND d.sent_epoch_ms IS NOT NULL AND EXISTS(SELECT 1 FROM communication.delivery_attempt a WHERE a.delivery_id=d.id AND a.attempt_no=d.attempt_count AND a.outcome='SENT' AND a.side_effect_state='ACKNOWLEDGED' AND a.completed_epoch_ms IS NOT NULL) AS acknowledged
   FROM communication.outbox o JOIN communication.delivery d ON d.outbox_id=o.id WHERE o.message_id=$1::uuid ORDER BY d.id FOR UPDATE OF d`,[record.notification_message_id])).rows;
  if(!deliveries.some(d=>d.acknowledged)){
   if(deliveries.some(d=>d.status==='SENDING'||d.side_effect_state==='UNKNOWN'))return {created:false,reason:'CLOSURE_DELIVERY_UNRESOLVED'};
   for(const delivery of deliveries)if(delivery.side_effect_state==='NOT_ATTEMPTED'){
    const expected:{status:'LEASED';leaseToken:string}|{status:'PENDING'|'DEAD_LETTER'}|null=delivery.status==='LEASED'&&delivery.lease_token?{status:'LEASED',leaseToken:delivery.lease_token}:delivery.status==='PENDING'||delivery.status==='DEAD_LETTER'?{status:delivery.status}:null;
    if(expected)await cancelUnattemptedDeliveryInTransaction({transaction:tx,deliveryId:delivery.id,expected,reasonCode:'CLOSURE_RESTORED_BEFORE_NOTIFICATION',occurredEpochMs:String(Date.now())});
   }
   reason='CLOSURE_NOT_NOTIFIED';
  }
 }
 const source=(await tx.query<{id:string;source_channel:string;source_provider:string;source_bot_id:string;reporter_wecom_userid:string}>(`SELECT i.id::text,i.source_channel,i.source_provider,i.source_bot_id,i.reporter_wecom_userid FROM intake.service_intake i WHERE i.id=COALESCE($1::uuid,(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$2::uuid))`,[record.intake_id,record.ticket_id])).rows[0];
 if(!source)failP2016('NOTIFICATION_BINDING_INVALID');
 if(source.source_channel==='PORTAL'&&source.source_provider==='YIXIAOXIU_WEB')reason='WEB_APP_ONLY';
 if(source.source_channel==='MANUAL'&&source.source_provider==='STAFF_MANUAL_REPORT')reason='MANUAL_APP_ONLY';
 if(!reason&&personDestinationAuthorizer&&await personDestinationAuthorizer({transaction:tx,bot_id:source.source_bot_id,reporter_user_id:source.reporter_wecom_userid})!==true)reason='DIRECT_DESTINATION_NOT_ESTABLISHED';
 if(reason){await tx.query(`UPDATE pilot_ticket.closure_record SET ${processedColumn}=platform.local_now() WHERE id=$1::uuid`,[record.id]);return {created:false,reason};}
 const expiry=String(Date.now()+2592000000),message=await communicationAppend({transaction:tx,actor:null,command:{session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',message_type:'text',visibility:'EXTERNAL',
  client_command_id:randomUUID(),content:{text:restoring?CLOSURE_NOTIFICATION_TEMPLATES.RESTORED:reporterClosureText(record),transport:SERVICE_CLOSURE_TRANSPORT},destination_policy:'P2_016_REPORTER',privacy_class:'INTERNAL',retention_until:formatEpochMsToShanghaiLocal(expiry),retention_until_epoch_ms:expiry},
  resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,target_type:'PERSON',target_id:source.reporter_wecom_userid}]});
 if(!message||'error' in message)failP2016('NOTIFICATION_FAILED',503);
 const deliveryId=message.delivery_ids[0];if(message.outbox_id===null||!deliveryId)failP2016('NOTIFICATION_FAILED',503);
 await tx.query(`UPDATE pilot_ticket.closure_record SET ${messageColumn}=$2::uuid,${processedColumn}=platform.local_now() WHERE id=$1::uuid`,[record.id,message.message_id]);
 if(record.ticket_id)await tx.query(`INSERT INTO communication.ticket_notification_binding(ticket_event_id,ticket_id,notification_type,recipient_binding_hash,destination_type,template_version,message_id,outbox_id,delivery_id)
  VALUES($1::uuid,$2::uuid,$3,$4,'PERSON','service-closure/1',$5::uuid,$6::uuid,$7::uuid)`,[restoring?record.restoration_event_id:record.closure_ticket_event_id,record.ticket_id,restoring?'TICKET_REOPENED':'TICKET_CANCELLED',textHashP2016(JSON.stringify(['WECOM_AIBOT',source.source_bot_id,source.reporter_wecom_userid])),message.message_id,message.outbox_id,deliveryId]);
 return {created:true,message_id:message.message_id,outbox_id:message.outbox_id,delivery_id:deliveryId};
}
