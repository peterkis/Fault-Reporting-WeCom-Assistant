import {createHmac} from 'node:crypto';

/** A retained, same-account/person Leg proves a topic; a shared Ticket never does. */
export const SESSION_JOURNEY_JOIN_SQL=`
 LEFT JOIN LATERAL (SELECT count(DISTINCT l.journey_id)::integer AS count,min(l.journey_id::text) AS journey_id
   FROM intake.channel_leg l WHERE l.source_intake_id=i.id) jb ON TRUE
 LEFT JOIN intake.contact_journey j ON jb.count=1 AND j.id=jb.journey_id::uuid
   AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
   AND EXISTS(SELECT 1 FROM intake.channel_leg l WHERE l.journey_id=j.id AND l.source_intake_id=i.id
     AND l.reporter_identity_hash=j.reporter_identity_hash
     AND (l.conversation_session_id=s.id OR (l.conversation_session_id IS NULL
       AND NOT EXISTS(SELECT 1 FROM conversation.session other WHERE other.service_intake_id=i.id AND other.id<>s.id)))
     AND (l.conversation_thread_id=s.thread_id OR l.conversation_thread_id IS NULL))
   AND EXISTS(SELECT 1 FROM intake.service_intake origin WHERE origin.id=j.origin_intake_id
     AND origin.source_provider=th.provider AND origin.source_bot_id=th.channel_account_id
     AND origin.reporter_wecom_userid=s.participant_key AND origin.retention_until_epoch_ms>platform.physical_epoch_ms())`;

export interface ContactIdentity {provider:string;channel_account_id:string;participant_key:string}
export function conversationReference(key:string,purpose:'contact'|'topic',identity:ContactIdentity,topic?:string):string{
  const tuple=[`WORKBENCH_CONVERSATION_${purpose.toUpperCase()}:v1`,identity.provider,identity.channel_account_id,identity.participant_key,...(topic===undefined?[]:[topic])];
  return `${purpose==='contact'?'cci':'ctp'}_v1_`+createHmac('sha256',key).update(JSON.stringify(tuple)).digest('hex');
}
