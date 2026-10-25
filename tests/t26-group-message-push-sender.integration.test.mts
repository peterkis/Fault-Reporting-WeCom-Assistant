import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createP2016WeComSender} from '../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}

test('the configured group route renders an exact low-sensitivity text and native explicit mention through the real Sender and Worker',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const intake=await seedPersistedIntake({pool:context.pool,text:'T26_NATIVE_GROUP_PRIVATE_MATERIAL',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag:'t26-native'});
  const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t26-native'});assert.ok(created.ticket);
  const http=await t11Http(context),id=created.ticket.id,started=await http.start(id);await context.runtime.roundNotifications.runOnce();
  const read=async()=>{const response=await http.get('/api/tickets/'+id+'/deliveries');assert.equal(response.status,200);const data=object(await response.json());assert.ok(Array.isArray(data.items));return data.items.map(object);};
  const before=await read(),group=before.find(row=>row.destination_type==='GROUP');assert.ok(group);
  const payloads:unknown[]=[];let personalCalls=0;
  const fetchImpl:typeof fetch=async(_url,init)=>{payloads.push(JSON.parse(String(init?.body)));return new Response('{"errcode":0}',{status:200});};
  // Explicit synthetic namespace qualification at the external adapter seam. This
  // deliberately differs from the Bot Reporter ID and is not a live mapping proof.
  const options={gateway:{getAuthenticatedClient:()=>({sendMessage:async()=>{personalCalls++;return {errcode:0};}})},enabled:true,cardEnabled:true,
    allowedTargetHashes:[createHash('sha256').update('user-test').digest('hex')],reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED' as const,
    groupRoundNotifications:{pool:context.pool,routes:[{botId:'bot-test',groupId:'group-t26-native',url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=t26-synthetic'}],fetchImpl,
      resolveMentionUserId:async({reporterUserId}:{reporterUserId:string})=>{assert.equal(reporterUserId,'user-test');return 't26-verified-webhook-user';}}};
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:createP2016WeComSender(options)});
  const result=await worker.deliver({deliveryId:String(group.delivery_id)});assert.ok(result&&'status' in result);assert.equal(result.status,'SENT');
  assert.deepEqual(payloads,[{msgtype:'text',text:{content:'工单尾号 '+started.ticket_no.slice(-4)+' 已有人员处理。',mentioned_list:['t26-verified-webhook-user']}}]);assert.equal(personalCalls,0);
  const after=await read(),sent=after.find(row=>row.delivery_id===group.delivery_id);assert.ok(sent);assert.equal(sent.side_effect_state,'ACKNOWLEDGED');assert.equal(sent.attempt_count,1);
  assert.deepEqual(after.find(row=>row.destination_type==='PERSON'),before.find(row=>row.destination_type==='PERSON'));
  await context.runtime.roundNotifications.runOnce();assert.equal(await worker.deliver({deliveryId:String(group.delivery_id)}),null);assert.equal(payloads.length,1);
  assert.deepEqual(await http.detail(id),started);
  assert.equal(JSON.stringify(payloads).includes('T26_NATIVE_GROUP_PRIVATE_MATERIAL'),false);
 },{manualRoundConsumption:true});
});
