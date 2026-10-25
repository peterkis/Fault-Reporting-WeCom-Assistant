// EXTERNAL SOURCE_DRAFT_NOT_REGISTERED_NOT_RUN. Future selection uses real loopback HTTP/PG with the unchanged 240000ms budget.
// One race/replay/reaccept seam plus one same-UUID race. Synthetic Delivery ACK only, never a real external sender.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT09Fixture,object,rows,text,version} from './helpers/t09-fixture.mjs';
import type {T09Fixture,T09Http} from './helpers/t09-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
async function get(http:T09Http,path:string){const response=await http.get(path);assert.equal(response.status,200,path);return response.value;}
const body=(v:number)=>({client_command_id:randomUUID(),expected_version:v,reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'合成停止原因：重新安排。',unfinished_work:'合成未完成工作：仍需维修。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
async function started(f:T09Fixture){const admin=await f.http(0),handler=await f.http(2),path='/api/tickets/'+await f.createTicket();const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:f.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200);await f.runtime.coordinator.runOnce();
 const source=rows((await get(handler,path+'/responsibility')).conversations)[0];assert.ok(source);assert.equal((await handler.post('/api/conversations/'+text(source.session_id)+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(text(source.session_row_version))),reason_code:'T09_RACE_REAL_COMMUNICATOR'})).status,200);
 for(const action of ['accept','start']as const)assert.equal((await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version((await get(handler,path)).version),reason_code:'T09_RACE_REAL_'+action.toUpperCase()})).status,200);
 const current=await get(admin,path);assert.equal(current.status,'IN_PROGRESS');assert.equal(current.assignee_id,f.handler);assert.equal(object(current.handling_cycle).first_responsibility_event_id,assigned.value.ticket_event_id);return{admin,handler,path,current};
}

test('two authorized return intents commit once and historical replay stays read-authorized after another handler reaccepts the same acknowledged round',async()=>{
 await withT09Fixture(async f=>{
  const {admin,path,current}=await started(f),dispatcher=await f.http(1),nextHandler=await f.http(3),cycle=object(current.handling_cycle),communication=(await get(admin,path+'/responsibility')).conversations;
  const promised=rows((await get(admin,path+'/deliveries')).items).filter(row=>row.notification_type==='TICKET_ACCEPTED');assert.equal(promised.length,1);const notice=promised[0];assert.ok(notice);
  let sends=0;const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:{send:async()=>{sends++;return{outcome:'ACKNOWLEDGED',provider_message_id:'T09_SYNTHETIC_FIRST_NOTICE_ACK',error_code:null,retryable:false};}}});
  const sent=await worker.deliver({deliveryId:text(notice.delivery_id)});assert.ok(sent&&'status'in sent);assert.equal(sent.status,'SENT');assert.equal(sends,1);
  const deliveries=await get(admin,path+'/deliveries'),history=rows((await get(admin,path+'/events?limit=200')).items),first=body(version(current.version)),second=body(version(current.version));
  const responses=await Promise.all([admin.post(path+'/return-to-dispatch',first),dispatcher.post(path+'/return-to-dispatch',second)]);assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  const winner=responses[0]?.status===200?{http:admin,body:first,result:responses[0]}:{http:dispatcher,body:second,result:responses[1]};assert.ok(winner.result);
  const stopped=await get(admin,path);assert.equal(stopped.version,version(current.version)+1);assert.equal(stopped.status,'QUEUED');assert.equal(stopped.assignee_id,null);assert.deepEqual(stopped.handling_cycle,cycle);assert.equal(stopped.resolver_team_id,current.resolver_team_id);assert.deepEqual((await get(admin,path+'/responsibility')).conversations,communication);
  const stopHistory=rows((await get(admin,path+'/events?limit=200')).items);assert.deepEqual(stopHistory.slice(0,-1),history);assert.equal(stopHistory.filter(row=>row.event_type==='ticket.returned_to_dispatch').length,1);assert.deepEqual(await get(admin,path+'/deliveries'),deliveries);
  const replay=await winner.http.post(path+'/return-to-dispatch',winner.body);assert.equal(replay.status,200);assert.equal(replay.value.replayed,true);assert.equal(replay.value.ticket_event_id,winner.result.value.ticket_event_id);assert.equal(replay.value.ticket_version,winner.result.value.ticket_version);
  // Existing actual legacy accept shares an established round; no pending T10 API or SQL reconstructed history.
  const reaccepted=await nextHandler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:version(stopped.version),reason_code:'T09_REAL_SAME_ROUND_REACCEPT'});assert.equal(reaccepted.status,200,JSON.stringify(reaccepted.value));
  const after=await get(admin,path);assert.equal(after.status,'ACCEPTED');assert.equal(after.assignee_id,f.otherHandler);assert.equal(after.version,version(stopped.version)+1);assert.deepEqual(after.handling_cycle,cycle);assert.deepEqual((await get(admin,path+'/responsibility')).conversations,communication);assert.deepEqual(await get(admin,path+'/deliveries'),deliveries,'a same-round reaccept cannot promise a second external notification');
  assert.equal(await worker.deliver({deliveryId:text(notice.delivery_id)}),null);assert.equal(sends,1);
  const afterHistory=rows((await get(admin,path+'/events?limit=200')).items);assert.deepEqual(afterHistory.slice(0,-1),stopHistory);assert.equal(afterHistory.at(-1)?.event_type,'ticket.accepted');
  const historical=await winner.http.post(path+'/return-to-dispatch',winner.body);assert.equal(historical.status,200);assert.equal(historical.value.replayed,true);assert.equal(historical.value.ticket_event_id,winner.result.value.ticket_event_id);assert.equal(historical.value.ticket_version,version(current.version)+1,'original replay cannot bind to the newer live version');
  assert.equal((await winner.http.post(path+'/return-to-dispatch',{...winner.body,unfinished_work:'不同合成意图不可冒充原命令。'})).status,409);assert.deepEqual(await get(admin,path),after);assert.deepEqual(rows((await get(admin,path+'/events?limit=200')).items),afterHistory);assert.deepEqual(await get(admin,path+'/deliveries'),deliveries);
 },{ticketReturnToDispatchEnabled:true});
});

test('two actual simultaneous requests with the identical return UUID preserve one event, one version and original Delivery promises',async()=>{
 await withT09Fixture(async f=>{
  const {admin,handler,path,current}=await started(f),history=rows((await get(admin,path+'/events?limit=200')).items),deliveries=await get(admin,path+'/deliveries'),original=body(version(current.version));
  const responses=await Promise.all([handler.post(path+'/return-to-dispatch',original),handler.post(path+'/return-to-dispatch',original)]);assert.deepEqual(responses.map(response=>response.status),[200,200]);assert.deepEqual(responses.map(response=>response.value.replayed).sort(),[false,true]);assert.equal(responses[0]?.value.ticket_event_id,responses[1]?.value.ticket_event_id);
  const after=await get(admin,path),events=rows((await get(admin,path+'/events?limit=200')).items);assert.equal(after.version,version(current.version)+1);assert.equal(after.assignee_id,null);assert.deepEqual(events.slice(0,-1),history);assert.equal(events.filter(row=>row.event_type==='ticket.returned_to_dispatch').length,1);assert.deepEqual(await get(admin,path+'/deliveries'),deliveries);
 },{ticketReturnToDispatchEnabled:true});
});
