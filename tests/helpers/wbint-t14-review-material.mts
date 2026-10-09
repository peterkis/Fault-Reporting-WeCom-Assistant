import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {createChannelMessageInbox} from '../../src/p1-003-channel-message-inbox.mjs';
import {createServiceIntakeProcessor} from '../../src/p1-004-service-intake.mjs';
import {formatEpochMsToShanghaiLocal} from '../../src/platform/time-contract.mjs';
export async function appendReviewMaterial(pool:PostgresPool,intakeId:string,text:string){
  const source=(await pool.query<{source_bot_id:string;source_chat_type:string;source_chat_id:string|null;reporter_wecom_userid:string;retention_until:string}>(
    'SELECT source_bot_id,source_chat_type,source_chat_id,reporter_wecom_userid,retention_until FROM intake.service_intake WHERE id=$1::uuid',[intakeId])).rows[0];assert.ok(source);
  const epoch=(await pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;assert.ok(epoch);
  const msgId='t14-'+randomUUID(),message={schema_version:1,provider:'WECOM_AIBOT',idempotency_key:'WECOM_AIBOT:'+msgId,msg_id:msgId,req_id:msgId,
    bot_id:source.source_bot_id,chat_type:source.source_chat_type,chat_id:source.source_chat_id,sender_user_id:source.reporter_wecom_userid,msg_type:'text',
    provider_create_epoch_ms:null,create_time:null,received_epoch_ms:epoch,received_at:formatEpochMsToShanghaiLocal(epoch),content:[{kind:'text',text:{raw:text,clean:text}}],quote:null};
  const appended=await createChannelMessageInbox({pool}).accept({message,traceId:'t14-synthetic',privacyClass:'INTERNAL',retentionUntil:source.retention_until},createServiceIntakeProcessor());
  assert.equal(appended.ok,true);if(!appended.ok)assert.fail('actual Inbox did not accept the synthetic supplement');
  const association=(await pool.query<{intake_id:string}>('SELECT rel.intake_id::text FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id WHERE m.idempotency_key=$1',[message.idempotency_key])).rows[0];
  assert.equal(association?.intake_id,intakeId,'the actual producer must append to the original source');
}
