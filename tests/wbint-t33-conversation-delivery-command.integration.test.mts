// T33 original Conversation control: public Cookie HTTP must carry its UUID to Core.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../src/p2-001-conversation-contracts.mjs';
import {t33WholeHttp,t33Record,t33Text} from './helpers/t33-whole-fixture.mjs';

function sessionVersion(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1);
  return value;
}

test('T33 original Conversation reconcile preserves one UUID ACK and rejects changed body or lost authority',{timeout:120000},async t=>{
  await t33WholeHttp(async({pool,adminId,origin,cookies,get,post,deliver,senderCalls})=>{
    // Original P2-006 persisted Thread/Session setup. Delivery is created later by
    // the original public reply -> Communication Service, never inserted here.
    const label=randomUUID();
    const identity=buildConversationThreadIdentity({
      provider:'WECOM_AIBOT',botId:'synthetic-t33-conversation-'+label,
      chatType:'group',chatId:'synthetic-t33-group-'+label,
      senderUserId:'synthetic-t33-participant-'+label,
    });
    const thread=(await pool.query<{id:string}>(
      'INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at) VALUES($1,$2,$3,$4,$5,platform.local_now()) RETURNING id::text',
      [identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key],
    )).rows[0];
    assert.ok(thread);
    const scope=buildConversationSessionScope({
      threadKey:identity.thread_key,participantKey:identity.participant_key,
      creationIdempotencyKey:'T33_CONVERSATION:'+label,
    });
    const session=(await pool.query<{id:string}>(
      "INSERT INTO conversation.session(thread_id,participant_key,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at) VALUES($1::uuid,$2,$3,$4,'OPEN','HUMAN',platform.local_now()) RETURNING id::text",
      [thread.id,scope.participant_key,scope.session_scope_key,scope.creation_idempotency_key],
    )).rows[0];
    assert.ok(session);
    const parent='/api/conversations/'+session.id;
    const before=await get(parent);
    assert.equal(before.status,200,JSON.stringify(before.body));
    const takeover=await post(parent+'/takeover',{
      client_command_id:randomUUID(),
      expected_row_version:sessionVersion(t33Record(before.body.session).row_version),
      target_principal_id:adminId,reason_code:'WORKBENCH_TAKEOVER',
    });
    assert.equal(takeover.status,200,JSON.stringify(takeover.body));
    assert.equal(takeover.body.ok,true);
    const owned=await get(parent);
    assert.equal(owned.status,200,JSON.stringify(owned.body));
    const reply=await post(parent+'/messages',{
      client_command_id:randomUUID(),
      expected_row_version:sessionVersion(t33Record(owned.body.session).row_version),
      message_type:'text',text:'Synthetic T33 original Conversation reply',
    });
    assert.equal(reply.status,202,JSON.stringify(reply.body));
    assert.equal(reply.body.command_status,'COMMITTED');
    assert.ok(Array.isArray(reply.body.delivery_ids));
    assert.equal(reply.body.delivery_ids.length,1);
    const deliveryId=t33Text(reply.body.delivery_ids[0]);
    const row=async(actor=0):Promise<Record<string,unknown>>=>{
      const response=await get(parent+'/deliveries',actor);
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body.items));
      const matches=response.body.items.map(t33Record).filter(value=>value.delivery_id===deliveryId);
      assert.equal(matches.length,1);
      const selected=matches[0];
      assert.ok(selected);
      return selected;
    };
    const pending=await row();
    assert.equal(pending.status,'PENDING');
    assert.equal(pending.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(pending.attempt_count,0);
    assert.equal(senderCalls(),0);
    const bootstrap=await get('/api/lifecycle/bootstrap');
    assert.equal(bootstrap.status,200,JSON.stringify(bootstrap.body));
    const csrf=t33Text(bootstrap.body.csrf_token),cookie=cookies[0];
    assert.ok(cookie);
    const controlPost=async(body:Record<string,unknown>)=>{
      // This frozen original delivery route has no expected_row_version/If-Match.
      const response=await fetch(origin+'/api/deliveries/'+deliveryId+'/reconcile',{
        method:'POST',headers:{
          cookie:cookie.name+'='+cookie.value,origin,'content-type':'application/json',
          'x-csrf-token':csrf,'idempotency-key':t33Text(body.client_command_id),
        },body:JSON.stringify(body),
      });
      return {status:response.status,body:t33Record(await response.json())};
    };

    await deliver(deliveryId);
    const firstUnknown=await row();
    assert.equal(firstUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(firstUnknown.side_effect_state,'UNKNOWN');
    assert.equal(firstUnknown.attempt_count,1);
    assert.equal(senderCalls(),1);
    const command={
      client_command_id:randomUUID(),resolution:'CONFIRMED_NOT_SENT_REQUEUE',
      reason_code:'OPERATOR_CONFIRMED_NOT_SENT',
    };
    const first=await controlPost(command);
    assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.status,'PENDING');
    assert.equal(first.body.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(first.body.attempt_count,2);
    const requeued=await row();
    assert.equal(requeued.status,'PENDING');
    assert.equal(requeued.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(requeued.attempt_count,2);
    assert.equal(senderCalls(),1,'reconciliation itself must not send');

    const replay=await controlPost(command);
    const afterReplay=await row();
    t.diagnostic(JSON.stringify({
      observation:'T33_CONVERSATION_UUID_REPEAT',
      initial_http_status:first.status,initial_status:first.body.status,
      initial_attempt_count:first.body.attempt_count,replay_http_status:replay.status,
      actual_status:afterReplay.status,actual_attempt_count:afterReplay.attempt_count,
      sender_calls:senderCalls(),
    }));
    // A current real 409 here is RED only after the original successful command.
    assert.equal(replay.status,200,JSON.stringify(replay.body));
    assert.deepEqual(replay.body,{...first.body,replayed:true});
    assert.deepEqual(afterReplay,requeued);
    assert.equal(senderCalls(),1);

    await deliver(deliveryId);
    const nextUnknown=await row();
    assert.equal(nextUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(nextUnknown.side_effect_state,'UNKNOWN');
    assert.equal(nextUnknown.attempt_count,3);
    assert.equal(senderCalls(),2);
    const changed=await controlPost({...command,resolution:'CONFIRMED_SENT'});
    const afterChanged=await row();
    t.diagnostic(JSON.stringify({
      observation:'T33_CONVERSATION_UUID_CHANGED_RESOLUTION',
      changed_http_status:changed.status,actual_status:afterChanged.status,
      actual_side_effect_state:afterChanged.side_effect_state,
      actual_attempt_count:afterChanged.attempt_count,sender_calls:senderCalls(),
    }));
    assert.equal(changed.status,409,JSON.stringify(changed.body));
    assert.deepEqual(afterChanged,nextUnknown);
    assert.equal(senderCalls(),2);

    // Withdraw actual current roles, then prove this Cookie no longer has READ.
    // A still-authorized Dispatcher observes the retained Delivery through HTTP.
    assert.equal((await get(parent,1)).status,200);
    const removed=await pool.query(
      'DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[adminId],
    );
    assert.ok((removed.rowCount??0)>0);
    const deniedRead=await get(parent);
    assert.ok([401,403,404].includes(deniedRead.status),JSON.stringify(deniedRead.body));
    const deniedReplay=await controlPost(command);
    t.diagnostic(JSON.stringify({
      observation:'T33_CONVERSATION_UUID_CURRENT_AUTHORITY_WITHDRAWN',
      current_read_http_status:deniedRead.status,
      original_uuid_http_status:deniedReplay.status,sender_calls:senderCalls(),
    }));
    assert.ok([401,403,404].includes(deniedReplay.status),JSON.stringify(deniedReplay.body));
    assert.notEqual(deniedReplay.body.replayed,true);
    assert.deepEqual(await row(1),nextUnknown);
    assert.equal(senderCalls(),2);
  },{externalSend:true});
});
