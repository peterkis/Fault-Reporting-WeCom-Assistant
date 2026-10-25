// T33 Conversation ABA: old v1 intent with a fresh UUID cannot settle a later UNKNOWN.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../app/server/src/p2-001-conversation-contracts.mjs';
import {t33WholeHttp,t33Record,t33Text} from './helpers/t33-whole-fixture.mjs';

function version(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1);
  return value;
}
function attempt(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647);
  return value;
}

test('T33 Conversation rejects an old v1 UNKNOWN intent with a fresh UUID after another actual Worker attempt',{timeout:120000},async t=>{
  await t33WholeHttp(async({pool,adminId,origin,cookies,get,post,deliver,senderCalls})=>{
    // Reuse the original 8483B first's persisted Thread/Session and public reply
    // setup. A second real group route proves isolation without inserting Delivery.
    const newRoute=async(kind:string)=>{
      const label=kind+'-'+randomUUID();
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
      const session=(await pool.query<{id:string;service_intake_id:string|null}>(
        "INSERT INTO conversation.session(thread_id,participant_key,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at) VALUES($1::uuid,$2,$3,$4,'OPEN','HUMAN',platform.local_now()) RETURNING id::text,service_intake_id::text",
        [thread.id,scope.participant_key,scope.session_scope_key,scope.creation_idempotency_key],
      )).rows[0];
      assert.ok(session);
      assert.equal(session.service_intake_id,null);
      const parent='/api/conversations/'+session.id;
      const before=await get(parent);
      assert.equal(before.status,200,JSON.stringify(before.body));
      assert.equal(before.body.ticket,null);
      const takeover=await post(parent+'/takeover',{
        client_command_id:randomUUID(),
        expected_row_version:version(t33Record(before.body.session).row_version),
        target_principal_id:adminId,reason_code:'WORKBENCH_TAKEOVER',
      });
      assert.equal(takeover.status,200,JSON.stringify(takeover.body));
      assert.equal(takeover.body.ok,true);
      const owned=await get(parent);
      assert.equal(owned.status,200,JSON.stringify(owned.body));
      assert.equal(owned.body.ticket,null);
      const reply=await post(parent+'/messages',{
        client_command_id:randomUUID(),
        expected_row_version:version(t33Record(owned.body.session).row_version),
        message_type:'text',text:'Synthetic T33 Conversation ABA '+kind+' reply',
      });
      assert.equal(reply.status,202,JSON.stringify(reply.body));
      assert.equal(reply.body.command_status,'COMMITTED');
      assert.ok(Array.isArray(reply.body.delivery_ids));
      assert.equal(reply.body.delivery_ids.length,1);
      return {parent,deliveryId:t33Text(reply.body.delivery_ids[0])};
    };
    const primary=await newRoute('primary');
    const sibling=await newRoute('sibling');
    assert.notEqual(primary.deliveryId,sibling.deliveryId);
    const row=async(route:{parent:string;deliveryId:string}):Promise<Record<string,unknown>>=>{
      const response=await get(route.parent+'/deliveries');
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body.items));
      const matches=response.body.items.map(t33Record).filter(value=>value.delivery_id===route.deliveryId);
      assert.equal(matches.length,1);
      const selected=matches[0];assert.ok(selected);
      return selected;
    };
    const sessionSnapshot=async()=>{
      const response=await get(primary.parent);
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.equal(response.body.ticket,null);
      const value=t33Record(response.body.session);
      return {row_version:version(value.row_version),generation_version:version(value.generation_version)};
    };
    const initial=await row(primary),other=await row(sibling);
    assert.equal(initial.status,'PENDING');
    assert.equal(initial.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(attempt(initial.attempt_count),0);
    assert.equal(other.status,'PENDING');
    assert.equal(other.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(attempt(other.attempt_count),0);
    assert.equal(senderCalls(),0);
    const bootstrap=await get('/api/lifecycle/bootstrap');
    assert.equal(bootstrap.status,200,JSON.stringify(bootstrap.body));
    const csrf=t33Text(bootstrap.body.csrf_token),cookie=cookies[0];assert.ok(cookie);
    const controlPost=async(body:Record<string,unknown>)=>{
      // Exact original v1 route: Cookie/CSRF/UUID, without If-Match or snapshot fields.
      const response=await fetch(origin+'/api/deliveries/'+primary.deliveryId+'/reconcile',{
        method:'POST',headers:{
          cookie:cookie.name+'='+cookie.value,origin,'content-type':'application/json',
          'x-csrf-token':csrf,'idempotency-key':t33Text(body.client_command_id),
        },body:JSON.stringify(body),
      });
      return {status:response.status,body:t33Record(await response.json())};
    };

    await deliver(primary.deliveryId);
    const oldUnknown=await row(primary);
    assert.equal(oldUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(oldUnknown.side_effect_state,'UNKNOWN');
    const oldAttempt=attempt(oldUnknown.attempt_count);
    assert.equal(oldAttempt,1);
    assert.equal(senderCalls(),1);
    assert.deepEqual(await row(sibling),other);
    const oldSession=await sessionSnapshot();
    // Keep only the original old intent; its future command UUID is not captured.
    const oldIntent={reason_code:'OPERATOR_CONFIRMED_SENT',resolution:'CONFIRMED_SENT'};
    const requeueCommandId=randomUUID();
    const requeued=await controlPost({
      client_command_id:requeueCommandId,
      reason_code:'OPERATOR_CONFIRMED_NOT_SENT',resolution:'CONFIRMED_NOT_SENT_REQUEUE',
    });
    assert.equal(requeued.status,200,JSON.stringify(requeued.body));
    assert.equal(requeued.body.status,'PENDING');
    assert.equal(requeued.body.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(attempt(requeued.body.attempt_count),2);
    const queued=await row(primary);
    assert.equal(queued.status,'PENDING');
    assert.equal(queued.side_effect_state,'NOT_ATTEMPTED');
    const requeueAttempt=attempt(queued.attempt_count);
    assert.equal(requeueAttempt,2);
    assert.equal(senderCalls(),1,'the explicit not-sent decision itself must not send');
    assert.deepEqual(await row(sibling),other);

    await deliver(primary.deliveryId);
    const newUnknown=await row(primary);
    assert.equal(newUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(newUnknown.side_effect_state,'UNKNOWN');
    const newAttempt=attempt(newUnknown.attempt_count);
    assert.equal(newAttempt,3);
    assert.equal(senderCalls(),2);
    assert.deepEqual(await row(sibling),other);
    const newSession=await sessionSnapshot();
    t.diagnostic(JSON.stringify({
      observation:'T33_CONVERSATION_ABA_BEFORE_OLD_INTENT',
      old_session_row_version:oldSession.row_version,new_session_row_version:newSession.row_version,
      old_generation_version:oldSession.generation_version,new_generation_version:newSession.generation_version,
      old_unknown_attempt_count:oldAttempt,requeued_attempt_count:requeueAttempt,
      new_unknown_attempt_count:newAttempt,sender_calls:senderCalls(),
    }));

    // This fresh UUID is a new command, not replay of the requeue receipt.
    // The later Session/attempt observations above are diagnostics only.
    const staleCommandId=randomUUID();assert.notEqual(staleCommandId,requeueCommandId);
    const stale=await controlPost({...oldIntent,client_command_id:staleCommandId});
    const after=await row(primary);
    const afterSession=await sessionSnapshot();
    const afterSibling=await row(sibling);
    const diagnostic=JSON.stringify({
      observation:'T33_CONVERSATION_ABA_OLD_INTENT_RESULT',
      old_session_row_version:oldSession.row_version,new_session_row_version:newSession.row_version,
      after_session_row_version:afterSession.row_version,
      old_generation_version:oldSession.generation_version,new_generation_version:newSession.generation_version,
      after_generation_version:afterSession.generation_version,
      old_unknown_attempt_count:oldAttempt,new_unknown_attempt_count:newAttempt,
      stale_http_status:stale.status,actual_status:after.status,
      actual_side_effect_state:after.side_effect_state,actual_attempt_count:attempt(after.attempt_count),
      sender_calls:senderCalls(),
    });
    t.diagnostic(diagnostic);
    assert.equal(stale.status,409,'old v1 intent must not settle a later UNKNOWN attempt: '+diagnostic);
    assert.deepEqual(after,newUnknown);
    assert.deepEqual(afterSibling,other);
    assert.equal(senderCalls(),2);
  },{externalSend:true});
});
