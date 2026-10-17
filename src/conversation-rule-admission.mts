import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {SESSION_JOURNEY_JOIN_SQL} from './conversation-topic-scope.mjs';

function derivedSql(prefix:string){const hash=`encode(sha256(convert_to('${prefix}'||a.id::text,'UTF8')),'hex')`;
  return `substr(${hash},1,8)||'-'||substr(${hash},9,4)||'-5'||substr(${hash},14,3)||'-8'||substr(${hash},18,3)||'-'||substr(${hash},21,12)`;
}
export const RULE_ACTION_MESSAGE_JOIN_SQL=`(a.id=m.client_command_id OR (a.result_ref_type='COMMUNICATION' AND a.result_ref_id=m.id::text)
  OR (a.action_type='REQUEST_ONE_DESCRIPTION' AND m.client_command_id::text IN ((${derivedSql('P2016_GUIDANCE:')}),(${derivedSql('P2016_PERSON_GUIDANCE:')}))))`;
export interface RuleAdmissionInput {transaction:PostgresTransaction;deliveryId:string}
export type DeliveryAttemptAdmission=(input:RuleAdmissionInput)=>Promise<boolean>;
/** Existing producers' primary/derived command identities, never text/time correlation. */
export function createConversationRuleAdmission({existingAdmissionMounted=false}:{existingAdmissionMounted?:boolean}={}):DeliveryAttemptAdmission{
  return async({transaction:tx,deliveryId})=>{
    const source=(await tx.query<{sender_system_code:string|null}>(`SELECT m.sender_system_code FROM communication.delivery d
      JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id WHERE d.id=$1::uuid`,[deliveryId])).rows[0];
    // Mounting this hook must not turn the worker's existing no-hook rejection
    // for Incident progress into a permissive rule-only admission.
    if(source?.sender_system_code==='INCIDENT_PUBLIC_PROGRESS'&&!existingAdmissionMounted)return false;
    if(source?.sender_system_code!=='RULE_FIRST_ORCHESTRATOR')return true;
    await tx.query("SET LOCAL statement_timeout='2000ms'");
    // Control and binding writers already take this lock first. Hold it through
    // LEASED->SENDING/CANCELLED commit, never through the external Sender call.
    await lockP2016Realtime(tx);
    const matches=await tx.query<{journey_id:string;session_id:string|null;decision_status:string;source_intake_id:string}>(`SELECT dec.journey_id::text,m.session_id::text,dec.status AS decision_status,i.id::text AS source_intake_id
      FROM communication.delivery delivery JOIN communication.outbox o ON o.id=delivery.outbox_id JOIN communication.message m ON m.id=o.message_id
      JOIN intake.safe_action_suggestion a ON ${RULE_ACTION_MESSAGE_JOIN_SQL}
      JOIN intake.deterministic_decision dec ON dec.id=a.decision_id JOIN intake.contact_journey journey ON journey.id=dec.journey_id
      JOIN intake.channel_leg leg ON leg.id=dec.channel_leg_id AND leg.journey_id=journey.id AND leg.source_intake_id=dec.service_intake_id
        AND leg.reporter_identity_hash=journey.reporter_identity_hash
      JOIN intake.service_intake i ON i.id=dec.service_intake_id JOIN intake.service_intake origin ON origin.id=journey.origin_intake_id
      WHERE delivery.id=$1::uuid AND m.sender_kind='SYSTEM' AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL'
        AND m.sender_system_code='RULE_FIRST_ORCHESTRATOR' AND m.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND a.state IN ('EXECUTED','REPLAYED') AND a.result_ref_type='COMMUNICATION'
        AND a.action_type IN ('REQUEST_ONE_DESCRIPTION','SEND_FIXED_ACKNOWLEDGEMENT','SEND_FIXED_SCOPE_NOTICE')
        AND (m.client_command_id=a.id OR EXISTS(SELECT 1 FROM communication.message parent WHERE parent.id::text=a.result_ref_id
          AND parent.client_command_id=a.id AND parent.sender_system_code='RULE_FIRST_ORCHESTRATOR' AND parent.session_id IS NOT DISTINCT FROM m.session_id))
        AND journey.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND origin.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.source_provider='WECOM_AIBOT'
        AND origin.source_provider=i.source_provider AND origin.source_bot_id=i.source_bot_id AND origin.reporter_wecom_userid=i.reporter_wecom_userid
        AND NOT EXISTS(SELECT 1 FROM intake.channel_leg conflicting WHERE conflicting.source_intake_id=i.id AND conflicting.journey_id<>journey.id)
        AND delivery.provider=i.source_provider AND delivery.channel_account_id=i.source_bot_id
        AND ((delivery.target_type='PERSON' AND delivery.target_id=i.reporter_wecom_userid)
          OR (delivery.target_type='GROUP' AND i.source_chat_type='group' AND delivery.target_id=i.source_chat_id))
        AND (m.session_id IS NULL OR EXISTS(SELECT 1 FROM conversation.session s JOIN conversation.thread th ON th.id=s.thread_id
          WHERE s.id=m.session_id AND s.service_intake_id=i.id AND s.participant_key=i.reporter_wecom_userid AND th.provider=i.source_provider
            AND th.channel_account_id=i.source_bot_id AND th.chat_type=i.source_chat_type
            AND th.external_thread_key=CASE WHEN i.source_chat_type='single' THEN i.reporter_wecom_userid ELSE i.source_chat_id END)) LIMIT 2`,[deliveryId]);
    if(matches.rows.length!==1)return false;
    const topic=matches.rows[0];if(!topic)return false;
    if(topic.decision_status==='HUMAN_OVERRIDDEN')return true;
    if(topic.decision_status!=='RECORDED')return false;
    const accepted=await tx.query(`SELECT 1 FROM conversation.session s JOIN conversation.thread th ON th.id=s.thread_id
      JOIN intake.service_intake i ON i.id=s.service_intake_id
        AND i.source_provider=th.provider AND i.source_bot_id=th.channel_account_id AND i.reporter_wecom_userid=s.participant_key
      ${SESSION_JOURNEY_JOIN_SQL}
      WHERE (j.id=$1::uuid OR s.id=$2::uuid OR s.service_intake_id=$3::uuid)
        AND (EXISTS(SELECT 1 FROM conversation.assignment a WHERE a.session_id=s.id AND (a.assignment_status='ASSIGNED' OR a.released_at IS NOT NULL))
          OR EXISTS(SELECT 1 FROM conversation.control_event e WHERE e.session_id=s.id AND e.event_type IN ('ASSIGNMENT_ASSIGNED','ASSIGNMENT_TRANSFERRED','HANDOFF_ACCEPTED'))
          OR EXISTS(SELECT 1 FROM conversation.handoff h WHERE h.session_id=s.id AND h.status IN ('ACCEPTED','RELEASED'))) LIMIT 1`,[topic.journey_id,topic.session_id,topic.source_intake_id]);
    return accepted.rowCount===0;
  };
}
export function composeConversationRuleAdmission(existing:DeliveryAttemptAdmission|null=null):DeliveryAttemptAdmission{
  const rules=createConversationRuleAdmission({existingAdmissionMounted:existing!==null});return async input=>(existing===null||await existing(input))&&await rules(input);
}
