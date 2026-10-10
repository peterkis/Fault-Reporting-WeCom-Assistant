// EXTERNAL SOURCE_DRAFT_NOT_REGISTERED_NOT_RUN. Future tests/ placement only after PC first/consumer slice and parent grant.
// One original read-closure/security trace; existing host budget 240000ms, real HTTP/PG, no browser or fabricated receipt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT09Fixture,object,rows,text,version} from './helpers/t09-fixture.mjs';
import type {T09Http} from './helpers/t09-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

async function get(http:T09Http,path:string){const response=await http.get(path);assert.equal(response.status,200,path);return response.value;}
async function snapshot(http:T09Http,path:string){return {ticket:await get(http,path),responsibility:await get(http,path+'/responsibility'),events:await get(http,path+'/events?limit=200'),deliveries:await get(http,path+'/deliveries')};}

test('closing only T09 writes and raw recovery retains original safe ACK while current READ, actor, purpose and UUID remain authoritative',async()=>{
 await withT09Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticket=await fixture.createTicket(),path='/api/tickets/'+ticket;
  assert.equal((await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]})).status,200);
  for(const action of ['accept','start']as const){const current=await get(handler,path);assert.equal((await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'T09_ACK_SCOPE_REAL_'+action.toUpperCase()})).status,200);}
  const body={client_command_id:randomUUID(),expected_version:version((await get(handler,path)).version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'合成内部停止原因，安全ACK不得包含。',unfinished_work:'合成内部未完成工作，安全ACK不得包含。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
  const committed=await handler.post(path+'/return-to-dispatch',body);assert.equal(committed.status,200,JSON.stringify(committed.value));
  // Actual different-purpose receipt by the same principal; no receipt SQL insert or guessed method.
  const other='/api/tickets/'+await fixture.createTicket(),purposeUuid=randomUUID();
  const purpose=await handler.post(other+'/accept-for-later-with-conversations',{client_command_id:purposeUuid,expected_version:1,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(purpose.status,200,JSON.stringify(purpose.value));
  const originalState=await get(admin,path);
  // A real sequential runtime restart, not mutation of a captured flag or fake response. Externally supplied pool stays owned by the fixture.
  await fixture.runtime.stop();assert.equal(fixture.runtime.server.listening,false);
  const port=Number(new URL(fixture.origin).port),closed=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:port,principalIds:[fixture.admin,fixture.dispatcher,fixture.handler,fixture.otherHandler],externalSendEnabled:false,closePoolOnStop:false,ticketReturnToDispatchEnabled:false,workbenchDraftRecoveryEnabled:false});assert.ok('server' in closed);
  try{
   await listenConversationWorkbenchServer(closed.server,{port});
   const cookies=closed.authenticate.browserCookies?.();assert.ok(cookies);assert.equal(cookies.length,4);
   const http=async(index:number):Promise<T09Http>=>{const cookie=cookies[index];assert.ok(cookie);const header=cookie.name+'='+cookie.value;
    const read=async(url:string)=>{const response=await fetch(fixture.origin+url,{headers:{cookie:header}});return{status:response.status,value:object(await response.json())};};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
    return{get:read,post:async(url,command)=>{const response=await fetch(fixture.origin+url,{method:'POST',headers:{cookie:header,origin:fixture.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(command.client_command_id),'if-match':'"'+command.expected_version+'"'},body:JSON.stringify(command)});return{status:response.status,value:object(await response.json())};}};
   };
   const reader=await http(2),otherActor=await http(1),observer=await http(0),ack=path+'/return-to-dispatch/commands/'+body.client_command_id;
   const baseline=await snapshot(observer,path);assert.equal(baseline.ticket.version,originalState.version);assert.equal(baseline.ticket.status,'QUEUED');assert.equal(baseline.ticket.assignee_id,null);
   assert.equal((await get(reader,'/api/lifecycle/bootstrap')).draft_recovery_enabled,false);
   assert.equal((await reader.post(path+'/return-to-dispatch',body)).status,503,'literal false stops POST, including an original terminal command');
   assert.deepEqual(await get(reader,ack),{state:'COMMITTED',ticket_id:ticket,ticket_version:body.expected_version+1,ticket_event_id:text(committed.value.ticket_event_id)});
   assert.equal((await otherActor.get(path)).status,200);assert.deepEqual(await get(otherActor,ack),{state:'UNKNOWN'},'a readable Ticket never grants another actor receipt access');
   assert.deepEqual(await get(reader,path+'/return-to-dispatch/commands/'+randomUUID()),{state:'UNKNOWN'});
   assert.deepEqual(await get(reader,other+'/return-to-dispatch/commands/'+purposeUuid),{state:'UNKNOWN'},'a real other-purpose receipt must not satisfy the return purpose');
   assert.deepEqual(await get(reader,other+'/return-to-dispatch/commands/'+body.client_command_id),{state:'UNKNOWN'},'an existing command UUID on another readable resource is not this resource receipt');
   assert.deepEqual(await snapshot(observer,path),baseline,'safe reads and disabled writes preserve Ticket/Event/Delivery/independent communication facts');
   // Only authoritative synthetic directory membership changes through the existing Port. No Ticket/session/receipt/event SQL writes.
   const identity=(await fixture.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[fixture.handler])).rows[0];assert.ok(identity);
   await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:[]});
   assert.equal((await reader.get('/api/lifecycle/bootstrap')).status,200,'identity must remain authenticated, isolating lost Ticket READ');
   assert.equal((await reader.get(path)).status,404,'returned Ticket has no actor ownership and its group is no longer authorized');
   const denied=await reader.get(ack);assert.equal(denied.status,404);assert.equal(Object.hasOwn(denied.value,'state'),false);assert.equal(JSON.stringify(denied.value).includes(text(committed.value.ticket_event_id)),false);
   assert.deepEqual(await snapshot(observer,path),baseline);assert.equal(rows(baseline.events.items).filter(row=>row.event_type==='ticket.returned_to_dispatch').length,1);
  }finally{await closed.stop();assert.equal(closed.server.listening,false);assert.equal((await closed.observability.metrics()).sse_clients,0);assert.equal(await new Promise<number>((resolve,reject)=>closed.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);}
 },{ticketReturnToDispatchEnabled:true,workbenchDraftRecoveryEnabled:false});
});
