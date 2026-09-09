import { createHash } from 'node:crypto';

// Application text syntax, not a Provider field or an access credential.
export function parseExplicitContinuation(text){
  if(typeof text!=='string'||!/^\s*续接工单(?:\s|$)/u.test(text))return null;
  const match=/^\s*续接工单\s+([A-Za-z0-9_-]{32})[：:]\s*([\s\S]*)$/u.exec(text);
  return {public_ref:match?.[1]??null,description:match?.[2]??text.split(/[：:]/u).slice(1).join('：')};
}

export async function resolveExplicitContinuation({transaction:tx,intakeId,reporterHash,nowEpochMs}){
  const current=(await tx.query(`SELECT i.source_provider,i.source_bot_id,i.reporter_wecom_userid,i.source_chat_type,
    m.raw_text,m.clean_text FROM intake.service_intake i JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE i.id=$1::uuid`,[intakeId])).rows[0];
  if(current?.source_chat_type!=='single')return null;
  // Normalized clean text lowercases Latin characters; opaque refs retain raw case.
  const rawText=current.raw_text?.trimStart();
  const raw=rawText?.startsWith('【p2-g2测试】')&&parseExplicitContinuation(current.clean_text)
    ?rawText.slice('【p2-g2测试】'.length):current.raw_text;
  const claim=parseExplicitContinuation(raw);if(!claim)return null;
  if(!claim.public_ref)return {journey:null};
  const binding=createHash('sha256').update(JSON.stringify(['WECOM_AIBOT',current.source_bot_id,current.reporter_wecom_userid])).digest('hex');
  const target=await tx.query(`SELECT j.* FROM pilot_ticket.reporter_public_ref r
    JOIN pilot_ticket.ticket t ON t.id=r.ticket_id JOIN intake.service_intake origin ON origin.id=t.source_intake_id
    JOIN intake.channel_leg source_leg ON source_leg.source_intake_id=origin.id
    JOIN intake.contact_journey j ON j.id=source_leg.journey_id AND j.linked_ticket_id=t.id
    WHERE r.public_ref=$1 AND r.status='ACTIVE' AND r.reporter_binding_hash=$2
      AND origin.source_provider=$3 AND origin.source_bot_id=$4 AND origin.reporter_wecom_userid=$5
      AND j.reporter_identity_hash=$6 AND j.status<>'ENDED' AND t.status NOT IN ('CLOSED','CANCELLED')
      AND source_leg.reporter_identity_hash=j.reporter_identity_hash
      AND origin.retention_until_epoch_ms>$7::bigint AND j.retention_until_epoch_ms>$7::bigint
    LIMIT 2 FOR UPDATE OF j,r`,[claim.public_ref,binding,current.source_provider,current.source_bot_id,
      current.reporter_wecom_userid,reporterHash,nowEpochMs]);
  return {journey:target.rowCount===1?target.rows[0]:null};
}
