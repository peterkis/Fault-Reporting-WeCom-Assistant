import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {DeliveryAttemptAdmission} from './conversation-rule-admission.mjs';
import {appendCommunication} from './p2-004-communication-core.mjs';
import {textHashP2016,failP2016} from './p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {SESSION_JOURNEY_JOIN_SQL} from './conversation-topic-scope.mjs';

export const MVP_GROUP_RECEIVED='收到啦～小修记下了，工程师马上联系您，稍等哦 🛠️';
export const MVP_GROUP_CLARIFY='这条小修没完全看懂😅 麻烦您私信我一下啦，回复两句就能安排～';
export const MVP_GROUP_THANKS='不用客气噢，这是小修应该做的啦~';
export function groupMessageDescription(text:string){return text.replace(/^@[^\s@]+(?:\s+|$)/u,'').trim();}
export function isPureGroupThanks(text:string){
 const v=groupMessageDescription(text).replace(/[\s!！。,.，、~～🙏😊☺️👍]+/gu,'');
 return /^(?:(?:谢谢|感谢|多谢)(?:您|你|小修|医小修|工程师|大家)?|辛苦(?:了|啦|你了|您了))+(?:啦|了|哦|噢|啊|呀)?$/u.test(v);
}
function commandId(key:string){const h=textHashP2016(key);return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
type Kind='RECEIVED'|'CLARIFY'|'THANKS';
function verifiedGroupName(value:unknown):string|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const p=value as Record<string,unknown>;
 return p.source==='WECOM_DIRECTORY'&&p.account_status==='ACTIVE'&&typeof p.display_name==='string'&&p.display_name.length<=80&&!/[\r\n<>@\x00-\x1f]/u.test(p.display_name)?p.display_name.trim()||null:null;
}
interface Source {intake_id:string;journey_id:string;session_id:string|null;bot_id:string;group_id:string;reporter:string;primary_message_id:string;result_code:string;ticket_id:string|null;retention_epoch:string;previous:boolean;previous_end:number;profile_snapshot:unknown}

export async function appendMvpGroupReplies({transaction:tx,intakeId,decisionId,append=appendCommunication}:{transaction:PostgresTransaction;intakeId:string;decisionId:string;append?:typeof appendCommunication}){
 const q=await tx.query<Source>(`SELECT i.id::text AS intake_id,d.journey_id::text,d.conversation_session_id::text AS session_id,
   i.source_bot_id AS bot_id,i.source_chat_id AS group_id,i.reporter_wecom_userid AS reporter,i.primary_message_id::text,
   d.result_code,i.pilot_ticket_id::text AS ticket_id,j.profile_snapshot,
   LEAST(i.retention_until_epoch_ms,j.retention_until_epoch_ms)::text AS retention_epoch,
   EXISTS(SELECT 1 FROM intake.deterministic_decision old WHERE old.service_intake_id=i.id AND old.decision_ordinal<d.decision_ordinal) AS previous,
   COALESCE((SELECT max(old.source_window_end_sequence) FROM intake.deterministic_decision old WHERE old.service_intake_id=i.id AND old.decision_ordinal<d.decision_ordinal),0)::integer AS previous_end
   FROM intake.deterministic_decision d JOIN intake.service_intake i ON i.id=d.service_intake_id
   JOIN intake.contact_journey j ON j.id=d.journey_id
   WHERE d.id=$1::uuid AND i.id=$2::uuid AND d.status='RECORDED' AND i.source_provider='WECOM_AIBOT'
     AND i.source_chat_type='group' AND i.source_chat_id IS NOT NULL
     AND LEAST(i.retention_until_epoch_ms,j.retention_until_epoch_ms)>platform.physical_epoch_ms()`,[decisionId,intakeId]);
 const source=q.rows[0];if(q.rowCount!==1||!source)return;
 const messages=await tx.query<{id:string;clean_text:string|null;retention_epoch:string}>(`SELECT m.id::text,m.clean_text,m.retention_until_epoch_ms::text AS retention_epoch
   FROM intake.service_intake_message r JOIN channel.message_inbox m ON m.id=r.channel_message_id
   WHERE r.intake_id=$1::uuid AND m.provider='WECOM_AIBOT' AND m.bot_id=$2 AND m.chat_type='group' AND m.chat_id=$3 AND m.sender_user_id=$4
     AND r.sequence_no>$5 AND m.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY r.sequence_no LIMIT 51`,[intakeId,source.bot_id,source.group_id,source.reporter,source.previous_end]);
 const appendReply=async(kind:Kind,messageId:string,retention:string)=>{
  const id=commandId(kind==='THANKS'?'MVP_GROUP_THANKS:'+messageId:'MVP_GROUP_FIRST:'+intakeId);
  // Replays keep the original immutable text, decision and Delivery identity.
  if((await tx.query("SELECT 1 FROM communication.message WHERE idempotency_scope='SYSTEM' AND client_command_id=$1::uuid",[id])).rowCount)return;
  const name=verifiedGroupName(source.profile_snapshot);
  const text=kind==='RECEIVED'?MVP_GROUP_RECEIVED:kind==='THANKS'?MVP_GROUP_THANKS:(name?'@'+name+' ':'')+MVP_GROUP_CLARIFY;
  const expiry=String(BigInt(source.retention_epoch)<BigInt(retention)?BigInt(source.retention_epoch):BigInt(retention));
  const result=await append({transaction:tx,actor:null,command:{session_id:null,sender_kind:'SYSTEM',sender_system_code:'MVP_GROUP_REPLY',purpose:'SYSTEM_NOTIFICATION',
   client_command_id:id,message_type:'text',visibility:'EXTERNAL',destination_policy:'MVP_GROUP_REPLY',privacy_class:'INTERNAL',
   content:{text,group_reply:{kind,source_message_id:messageId,decision_id:decisionId}},retention_until:formatEpochMsToShanghaiLocal(expiry),retention_until_epoch_ms:expiry},
   resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.bot_id,target_type:'GROUP',target_id:source.group_id}]});
  if(!result||!('message_id'in result)||!result.outbox_id||result.delivery_ids.length!==1)failP2016('NOTIFICATION_FAILED',503);
 };
 const primary=messages.rows.find(m=>m.id===source.primary_message_id);
 if(!source.previous&&primary){
  if(isPureGroupThanks(primary.clean_text??''))await appendReply('THANKS',primary.id,primary.retention_epoch);
  else if(['TICKET_ELIGIBLE','INCIDENT_REVIEW_CANDIDATE'].includes(source.result_code)||source.result_code==='MANUAL_REVIEW_REQUIRED'&&source.ticket_id){
   if(source.ticket_id)await appendReply('RECEIVED',primary.id,primary.retention_epoch);
  }else if(['NEEDS_DESCRIPTION','MANUAL_REVIEW_REQUIRED'].includes(source.result_code))await appendReply('CLARIFY',primary.id,primary.retention_epoch);
 }
 for(const message of messages.rows)if(isPureGroupThanks(message.clean_text??''))await appendReply('THANKS',message.id,message.retention_epoch);
}

export interface MvpGroupReplyBasis {retention_epoch:string;kind:Kind;bot_id:string;group_id:string;reporter:string;journey_id:string;session_id:string|null;intake_id:string;content:unknown}
/** Validate persisted source + classifier + fixed template together; text equality is insufficient. */
export async function readMvpGroupReplyBasis(tx:PostgresTransaction,deliveryId:string):Promise<MvpGroupReplyBasis|null>{
 const q=await tx.query<MvpGroupReplyBasis&{profile_snapshot:unknown;command_id:string;source_text:string|null;ticket_id:string|null;result_code:string;source_message_id:string;primary_message_id:string}>(`SELECT
   m.content->'group_reply'->>'kind' AS kind,i.source_bot_id AS bot_id,i.source_chat_id AS group_id,i.reporter_wecom_userid AS reporter,
   d.journey_id::text,d.conversation_session_id::text AS session_id,i.id::text AS intake_id,m.content,cm.clean_text AS source_text,
   i.pilot_ticket_id::text AS ticket_id,d.result_code,j.profile_snapshot,cm.id::text AS source_message_id,i.primary_message_id::text,m.client_command_id::text AS command_id,
   LEAST(m.retention_until_epoch_ms,i.retention_until_epoch_ms,j.retention_until_epoch_ms,cm.retention_until_epoch_ms)::text AS retention_epoch
   FROM communication.delivery delivery JOIN communication.outbox o ON o.id=delivery.outbox_id JOIN communication.message m ON m.id=o.message_id
   JOIN intake.deterministic_decision d ON d.id::text=m.content->'group_reply'->>'decision_id'
   JOIN intake.service_intake i ON i.id=d.service_intake_id JOIN intake.contact_journey j ON j.id=d.journey_id
   JOIN intake.service_intake_message rel ON rel.intake_id=i.id AND rel.channel_message_id::text=m.content->'group_reply'->>'source_message_id'
   JOIN channel.message_inbox cm ON cm.id=rel.channel_message_id
   WHERE delivery.id=$1::uuid AND delivery.status IN ('LEASED','SENDING') AND delivery.provider='WECOM_AIBOT' AND delivery.target_type='GROUP'
     AND delivery.channel_account_id=i.source_bot_id AND delivery.target_id=i.source_chat_id
     AND m.sender_kind='SYSTEM' AND m.sender_system_code='MVP_GROUP_REPLY' AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL'
     AND m.message_type='text' AND o.route_policy='MVP_GROUP_REPLY' AND d.status='RECORDED'
     AND cm.provider=i.source_provider AND cm.bot_id=i.source_bot_id AND cm.sender_user_id=i.reporter_wecom_userid
     AND cm.chat_type='group' AND cm.chat_id=i.source_chat_id AND i.source_provider='WECOM_AIBOT' AND i.source_chat_type='group'
     AND LEAST(m.retention_until_epoch_ms,i.retention_until_epoch_ms,j.retention_until_epoch_ms,cm.retention_until_epoch_ms)>platform.physical_epoch_ms()`,[deliveryId]);
 const row=q.rows[0];if(q.rowCount!==1||!row||!row.content||typeof row.content!=='object')return null;
 const content=row.content as {text?:unknown;group_reply?:unknown};
 if(row.command_id!==commandId(row.kind==='THANKS'?'MVP_GROUP_THANKS:'+row.source_message_id:'MVP_GROUP_FIRST:'+row.intake_id))return null;
 if(row.kind==='THANKS')return isPureGroupThanks(row.source_text??'')&&content.text===MVP_GROUP_THANKS?row:null;
 if(row.source_message_id!==row.primary_message_id)return null;
 if(row.kind==='RECEIVED')return row.ticket_id&&content.text===MVP_GROUP_RECEIVED&&['TICKET_ELIGIBLE','INCIDENT_REVIEW_CANDIDATE','MANUAL_REVIEW_REQUIRED'].includes(row.result_code)?row:null;
 const name=verifiedGroupName(row.profile_snapshot);
 if(row.kind==='CLARIFY'&&['NEEDS_DESCRIPTION','MANUAL_REVIEW_REQUIRED'].includes(row.result_code)
  &&content.text===(name?'@'+name+' ':'')+MVP_GROUP_CLARIFY)return row;
 return null;
}

export function createMvpNotificationAdmission(existing:DeliveryAttemptAdmission|null=null):DeliveryAttemptAdmission{
 return Object.assign(async({transaction:tx,deliveryId}:Parameters<DeliveryAttemptAdmission>[0])=>{
  if(existing&&!await existing({transaction:tx,deliveryId}))return false;
  const q=await tx.query<{sender_system_code:string|null;target_type:string;route_policy:string;node:string|null}>(`SELECT m.sender_system_code,d.target_type,o.route_policy,r.node
   FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id
   LEFT JOIN communication.ticket_notification_binding b ON b.delivery_id=d.id LEFT JOIN communication.ticket_round_notification_binding r ON r.notification_binding_id=b.id WHERE d.id=$1::uuid`,[deliveryId]);
  const row=q.rows[0];if(q.rowCount!==1||!row)return false;
  if(row.sender_system_code==='MVP_GROUP_REPLY'){
   await lockP2016Realtime(tx);const basis=await readMvpGroupReplyBasis(tx,deliveryId);if(!basis)return false;
   if(basis.kind==='THANKS')return true;
   const paused=await tx.query(`SELECT 1 FROM conversation.session s JOIN conversation.thread th ON th.id=s.thread_id
    JOIN intake.service_intake i ON i.id=s.service_intake_id ${SESSION_JOURNEY_JOIN_SQL}
    WHERE (j.id=$1::uuid OR s.id=$2::uuid OR s.service_intake_id=$3::uuid)
      AND (EXISTS(SELECT 1 FROM conversation.assignment a WHERE a.session_id=s.id AND (a.assignment_status='ASSIGNED' OR a.released_at IS NOT NULL))
       OR EXISTS(SELECT 1 FROM conversation.control_event e WHERE e.session_id=s.id AND e.event_type IN ('ASSIGNMENT_ASSIGNED','ASSIGNMENT_TRANSFERRED','HANDOFF_ACCEPTED'))
       OR EXISTS(SELECT 1 FROM conversation.handoff h WHERE h.session_id=s.id AND h.status IN ('ACCEPTED','RELEASED'))) LIMIT 1`,[basis.journey_id,basis.session_id,basis.intake_id]);
   return paused.rowCount===0;
  }
  if(row.node==='FIRST_RESPONSIBILITY')return false;
  if(row.target_type==='GROUP')return row.sender_system_code==='TICKET_LIFECYCLE'&&row.node==='STAFF_COMPLETED'&&row.route_policy==='P2_016_ORIGIN_GROUP_ROUND';
  return true;
 },{mvpRepliesEnabled:true as const});
}
