import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withWeb01Fixture,seedWeb01NoConversationIntake} from './helpers/web01-workbench-fixture.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../app/server/src/platform/time-contract.mjs';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../app/server/src/p2-001-conversation-contracts.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../app/server/src/p2-006-workbench-authorization.mjs';
interface Fixture {pool:PostgresPool;runtime:{server:Server};origin:string;cookies:string[];principals:{id:string}[]}
async function session(pool:PostgresPool){
  const label=randomUUID(),identity=buildConversationThreadIdentity({provider:'WECOM_AIBOT',botId:'t38-synthetic',chatType:'group',chatId:label,senderUserId:'t38-synthetic-reporter'});
  const thread=(await pool.query<{id:string}>(`INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at)
    VALUES($1,$2,$3,$4,$5,platform.local_now()) RETURNING id::text`,[identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key])).rows[0];assert.ok(thread);
  const scope=buildConversationSessionScope({threadKey:identity.thread_key,participantKey:identity.participant_key,creationIdempotencyKey:'T38:'+label});
  await pool.query(`INSERT INTO conversation.session(thread_id,participant_key,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at)
    VALUES($1::uuid,$2,$3,$4,'OPEN','HUMAN',platform.local_now())`,[thread.id,scope.participant_key,scope.session_scope_key,scope.creation_idempotency_key]);
}
test('legitimate total scope beyond 256 is an SSE availability fallback while ordinary authorized GET remains available',async()=>{
  await withWeb01Fixture(async({pool,origin,cookies,principals}:Fixture)=>{
    const authorization=createPilotWorkbenchAuthorizationAdapter({pool}),principal=await authorization.resolvePrincipal({principal_id:principals[0]?.id});assert.ok(principal);
    let scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256});assert.ok(scope);
    while(scope.allowed_session_ids.length<128){await session(pool);scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256});assert.ok(scope);}
    assert.equal(scope.allowed_session_ids.length+scope.allowed_thread_ids.length,256);
    const request=()=>fetch(origin+'/api/realtime/events?scope=workbench',{headers:{cookie:cookies[0]??''}});
    const atBoundary=await request();assert.equal(atBoundary.status,200);await atBoundary.body?.cancel();
    await session(pool);
    const oversize=await request();assert.equal(oversize.status,503,'129 distinct Session/Thread pairs must be availability, not a false permission rejection');
    const body:unknown=await oversize.json();assert.ok(body&&typeof body==='object'&&'fallback' in body);
    assert.deepEqual((body as {fallback:{reason:string;strategy:string;poll_after_ms:number}}).fallback.reason,'TEMPORARY_UNAVAILABLE');
    const board=await fetch(origin+'/api/workbench/board?column=pending',{headers:{cookie:cookies[0]??''}});assert.equal(board.status,200);
    const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]??''}});assert.equal(bootstrap.status,200);
    const capability=await bootstrap.json() as {realtime_sse_enabled:boolean;realtime_sse_available:boolean};assert.equal(capability.realtime_sse_enabled,true);assert.equal(capability.realtime_sse_available,false);
    const outsider=await fetch(origin+'/api/realtime/events?scope=workbench',{headers:{cookie:cookies[1]??''}});assert.equal(outsider.status,200);await outsider.body?.cancel();
  },{ticketSelfHandlingEnabled:true,workbenchRealtimeEnabled:true});
});
test('narrow authorized sessionless SYSTEM Tickets count in the same 256 budget without silent clipping',async()=>{
  await withWeb01Fixture(async({pool,origin,cookies,principals}:Fixture)=>{
    const authorization=createPilotWorkbenchAuthorizationAdapter({pool}),principal=await authorization.resolvePrincipal({principal_id:principals[1]?.id});assert.ok(principal);
    const core=createPilotTicketCore({pool});
    const add=async()=>{const intake=await seedWeb01NoConversationIntake({pool,text:'T38 synthetic sessionless scope'});await core.createForIntake({intakeId:intake.intakeId,occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'T38-budget'});};
    let scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256});assert.ok(scope);
    assert.equal(scope.allowed_session_ids.length+scope.allowed_thread_ids.length,0);
    while((scope.allowed_system_ticket_ids?.length??0)<256){await add();scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256});assert.ok(scope);}
    assert.equal(scope.allowed_system_ticket_ids?.length,256);
    const read=()=>fetch(origin+'/api/realtime/events?scope=workbench',{headers:{cookie:cookies[2]??''}});
    const exact=await read();assert.equal(exact.status,200);await exact.body?.cancel();
    await add();const oversize=await read();
    // Close an unexpectedly successful stream before asserting so the RED also proves cleanup.
    if(oversize.status===200)await oversize.body?.cancel();
    assert.equal(oversize.status,503,'the 257th legitimate Web Ticket must not silently lose stream hints');
    const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[2]??''}});assert.equal(bootstrap.status,200);
    assert.equal((await bootstrap.json() as {realtime_sse_available:boolean}).realtime_sse_available,false);
  },{ticketSelfHandlingEnabled:true,workbenchRealtimeEnabled:true});
});
