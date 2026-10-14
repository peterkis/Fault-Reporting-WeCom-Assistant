import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../src/p2-001-conversation-contracts.mjs';
import {t33WholeHttp,t33Record,t33Text} from './helpers/t33-whole-fixture.mjs';

test('T33 Conversation v2 binds a later real attempt and preserves original UUID result across another UNKNOWN',{timeout:120000},async t=>{
 await t33WholeHttp(async({pool,origin,cookies,get,post,deliver,senderCalls})=>{
  const id=randomUUID(),identity=buildConversationThreadIdentity({provider:'WECOM_AIBOT',botId:'synthetic-t33-v2-'+id,chatType:'group',chatId:'synthetic-v2-group-'+id,senderUserId:'synthetic-v2-person-'+id});
  const thread=(await pool.query<{id:string}>('INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at) VALUES($1,$2,$3,$4,$5,platform.local_now()) RETURNING id::text',[identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key])).rows[0];assert.ok(thread);
  const scope=buildConversationSessionScope({threadKey:identity.thread_key,participantKey:identity.participant_key,creationIdempotencyKey:'T33_V2:'+id});
  const session=(await pool.query<{id:string}>("INSERT INTO conversation.session(thread_id,participant_key,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at) VALUES($1::uuid,$2,$3,$4,'OPEN','HUMAN',platform.local_now()) RETURNING id::text",[thread.id,scope.participant_key,scope.session_scope_key,scope.creation_idempotency_key])).rows[0];assert.ok(session);
  const parent='/api/conversations/'+session.id,before=await get(parent);assert.equal(before.status,200);assert.equal(before.body.ticket,null);
  assert.equal((await post(parent+'/takeover',{client_command_id:randomUUID(),expected_row_version:t33Record(before.body.session).row_version,reason_code:'OPERATOR_TAKEOVER'})).status,200);
  const owned=await get(parent),reply=await post(parent+'/messages',{client_command_id:randomUUID(),expected_row_version:t33Record(owned.body.session).row_version,message_type:'text',text:'Synthetic T33 v2 Conversation reply'});assert.equal(reply.status,202);assert.ok(Array.isArray(reply.body.delivery_ids));assert.equal(reply.body.delivery_ids.length,1);
  const deliveryId=t33Text(reply.body.delivery_ids[0]),bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const cookie=cookies[0];assert.ok(cookie);
  const send=async(body:Record<string,unknown>)=>{const response=await fetch(origin+'/api/deliveries/'+deliveryId+'/reconcile',{method:'POST',headers:{cookie:cookie.name+'='+cookie.value,origin,'content-type':'application/json','x-csrf-token':t33Text(bootstrap.body.csrf_token),'idempotency-key':t33Text(body.client_command_id)},body:JSON.stringify(body)});return{status:response.status,body:t33Record(await response.json())};};
  const row=async()=>{const response=await get(parent+'/deliveries');assert.equal(response.status,200);assert.ok(Array.isArray(response.body.items));const value=response.body.items.map(t33Record).find(item=>item.delivery_id===deliveryId);assert.ok(value);return value;};
  await deliver(deliveryId);assert.equal((await row()).attempt_count,1);
  const requeue={client_command_id:randomUUID(),resolution:'CONFIRMED_NOT_SENT_REQUEUE',reason_code:'V2_CONFIRMED_NOT_SENT',expected_delivery_attempt_count:1},first=await send(requeue);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.attempt_count,2);
  await deliver(deliveryId);const next=await row();assert.equal(next.status,'RECONCILIATION_REQUIRED');assert.equal(next.attempt_count,3);assert.equal(senderCalls(),2);
  const historical=await send(requeue);assert.equal(historical.status,200,JSON.stringify(historical.body));assert.deepEqual(historical.body,{...first.body,replayed:true});assert.deepEqual(await row(),next);
  const stale=await send({client_command_id:randomUUID(),resolution:'CONFIRMED_SENT',reason_code:'V2_CONFIRMED_SENT',expected_delivery_attempt_count:1});assert.equal(stale.status,409);assert.deepEqual(await row(),next);
  for(const attempt of [-1,2147483648,1.5,'3',null])assert.equal((await send({client_command_id:randomUUID(),resolution:'CONFIRMED_SENT',reason_code:'V2_CONFIRMED_SENT',expected_delivery_attempt_count:attempt})).status,400);
  const command={client_command_id:randomUUID(),resolution:'CONFIRMED_SENT',reason_code:'V2_CONFIRMED_SENT',expected_delivery_attempt_count:3},ack=await send(command);assert.equal(ack.status,200,JSON.stringify(ack.body));
  assert.deepEqual(Object.keys(ack.body).sort(),['ok','session_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed'].sort());assert.equal(ack.body.session_id,session.id);assert.equal(ack.body.delivery_id,deliveryId);assert.equal(ack.body.status,'SENT');assert.equal(ack.body.side_effect_state,'ACKNOWLEDGED');assert.equal(ack.body.attempt_count,4);assert.equal(ack.body.replayed,false);assert.equal(senderCalls(),2);
  assert.deepEqual((await send(command)).body,{...ack.body,replayed:true});assert.equal((await send({...command,expected_delivery_attempt_count:1})).status,409);assert.equal((await row()).attempt_count,4);assert.equal(senderCalls(),2);
  t.diagnostic(JSON.stringify({old_attempt:1,new_attempt:3,explicit_v2_status:ack.status,receipt_attempt:ack.body.attempt_count,sender_calls:senderCalls()}));
 },{externalSend:true});
});
