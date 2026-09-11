import { reporterIdentityHash } from './p2-015-contact-journey.mjs';
import { hmacIdentity } from './p2-015-domain-contracts.mjs';

// Conversation projection and rule evaluation have independent owners. A late
// projection may fill a previously unavailable reference, never rebind a Leg.
export async function reconcileP2016ConversationBindings({pool,identityHmacKey,beforeTransaction,afterLegId=null}){
  const tx=await pool.connect();let filled=0;
  try{
    await tx.query('BEGIN');if(beforeTransaction)await beforeTransaction(tx);
    const rows=(await tx.query(`SELECT leg.id::text,leg.journey_id::text,leg.source_intake_id::text,leg.leg_ordinal,
      leg.reporter_identity_hash,leg.channel_identity_hash,i.source_provider,i.source_bot_id,i.source_chat_type,i.source_chat_id,i.reporter_wecom_userid,
      s.id::text AS session_id,t.id::text AS thread_id
      FROM intake.channel_leg leg JOIN intake.contact_journey journey ON journey.id=leg.journey_id AND journey.reporter_identity_hash=leg.reporter_identity_hash
      JOIN intake.service_intake i ON i.id=leg.source_intake_id AND i.primary_message_id=leg.origin_channel_message_id
      JOIN intake.service_intake origin ON origin.id=journey.origin_intake_id AND origin.source_provider=i.source_provider
        AND origin.source_bot_id=i.source_bot_id AND origin.reporter_wecom_userid=i.reporter_wecom_userid
      JOIN conversation.session s ON s.service_intake_id=i.id AND s.participant_key=i.reporter_wecom_userid
        AND s.creation_idempotency_key='P2-G1:CHANNEL_MESSAGE:'||i.primary_message_id::text
      JOIN conversation.thread t ON t.id=s.thread_id AND t.provider=i.source_provider AND t.channel_account_id=i.source_bot_id
        AND t.chat_type=i.source_chat_type AND t.external_thread_key=CASE WHEN i.source_chat_type='single' THEN i.reporter_wecom_userid ELSE i.source_chat_id END
      WHERE (leg.conversation_session_id IS NULL OR leg.conversation_thread_id IS NULL)
        AND ($1::uuid IS NULL OR leg.id>$1::uuid)
        AND (leg.conversation_session_id IS NULL OR leg.conversation_session_id=s.id)
        AND (leg.conversation_thread_id IS NULL OR leg.conversation_thread_id=t.id)
        AND NOT EXISTS(SELECT 1 FROM conversation.session other WHERE other.service_intake_id=i.id AND other.id<>s.id)
      ORDER BY leg.id LIMIT 20 FOR UPDATE OF leg,journey SKIP LOCKED`,[afterLegId])).rows;
    for(const r of rows){
      const reporterHash=reporterIdentityHash({provider:r.source_provider,bot_id:r.source_bot_id,reporter_external_id:r.reporter_wecom_userid,hmac_key:identityHmacKey});
      const channelHash=hmacIdentity(r.source_bot_id+'\u0000'+r.source_chat_type+'\u0000'+(r.source_chat_id??reporterHash),identityHmacKey);
      if(reporterHash!==r.reporter_identity_hash||channelHash!==r.channel_identity_hash)continue;
      await tx.query(`UPDATE intake.channel_leg SET conversation_session_id=COALESCE(conversation_session_id,$2::uuid),
        conversation_thread_id=COALESCE(conversation_thread_id,$3::uuid),row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid`,[r.id,r.session_id,r.thread_id]);
      await tx.query(`UPDATE intake.contact_journey SET
        origin_session_id=CASE WHEN origin_intake_id=$2::uuid AND origin_session_id IS NULL THEN $3::uuid ELSE origin_session_id END,
        current_session_id=CASE WHEN current_session_id IS NULL AND NOT EXISTS(SELECT 1 FROM intake.channel_leg newer WHERE newer.journey_id=$1::uuid AND newer.leg_ordinal>$4)
          THEN $3::uuid ELSE current_session_id END,row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now())
        WHERE id=$1::uuid AND ((origin_intake_id=$2::uuid AND origin_session_id IS NULL) OR
          (current_session_id IS NULL AND NOT EXISTS(SELECT 1 FROM intake.channel_leg newer WHERE newer.journey_id=$1::uuid AND newer.leg_ordinal>$4)))`,
      [r.journey_id,r.source_intake_id,r.session_id,r.leg_ordinal]);filled++;
    }
    await tx.query('COMMIT');return {filled,last_examined_id:rows.at(-1)?.id??null,scan_exhausted:rows.length<20};
  }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}
  finally{tx.release();}
}
