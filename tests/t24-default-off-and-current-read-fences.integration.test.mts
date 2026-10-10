// SOURCE_REGISTERED_NOT_RUN. Mechanical copy of preserved combined external first; original body, roles, flags[] and 240000ms budget retained.
// Priority minimal whole7 negative tracer: one240000ms/flags[]stock1, existing fixture/PublicWorker/PublicAccess/realHTTP only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';

type Ids={messages:string[];outboxes:string[];deliveries:string[];bindings:string[];rounds:string[];attempts:string[];refs:string[];grants:string[]};
async function physical(pool:PostgresPool){return (await pool.query<Ids>(`SELECT
 ARRAY(SELECT id::text FROM communication.message ORDER BY id::text) AS messages,
 ARRAY(SELECT id::text FROM communication.outbox ORDER BY id::text) AS outboxes,
 ARRAY(SELECT id::text FROM communication.delivery ORDER BY id::text) AS deliveries,
 ARRAY(SELECT id::text FROM communication.ticket_notification_binding ORDER BY id::text) AS bindings,
 ARRAY(SELECT cycle_id::text||':'||node||':'||recipient_binding_hash||':'||destination_type FROM communication.ticket_round_notification_binding ORDER BY 1) AS rounds,
 ARRAY(SELECT id::text FROM communication.delivery_attempt ORDER BY id::text) AS attempts,
 ARRAY(SELECT id::text FROM pilot_ticket.reporter_public_ref ORDER BY id::text) AS refs,
 ARRAY(SELECT grant_id::text FROM pilot_ticket.reporter_access_grant ORDER BY grant_id::text) AS grants`)).rows[0];}
const canary='INTERNAL_T24_DEFAULT_READ_CANARY';
type Reply={items:Record<string,unknown>[]};
function safe(reply:Reply){
 assert.deepEqual(Object.keys(reply),['items']);
 const allowed=['node','cycle_no','notification_type','destination_type','delivery_id','status','side_effect_state','attempt_count','sent_at','created_at'].sort();
 for(const item of reply.items)assert.deepEqual(Object.keys(item).sort(),allowed);
 for(const marker of [canary,'user-test','bot-test'])assert.equal(JSON.stringify(reply).includes(marker),false);
}

test('default-off public Worker preserves a committed FIRST until explicit enablement and current role READ cannot reveal either safe notice after authority loss',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const id=context.ticketId,producer=await t11Http(context),reader=await t11Http(context,2),outsider=await t11Http(context,1);
  const started=await producer.start(id);assert.equal(started.status,'IN_PROGRESS');assert.ok(started.handling_cycle?.first_responsibility_event_id);
  const before=await physical(context.pool);assert.ok(before);
  // The host is explicitly enabled for positive control, but this public factory intentionally omits enabled to test its default.
  const closed=createTicketRoundNotifications({pool:context.pool,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});
  assert.deepEqual(await closed.runOnce(),{scanned:0,created:0});assert.deepEqual(await physical(context.pool),before);assert.deepEqual(await producer.detail(id),started);
  const positive=await context.runtime.roundNotifications.runOnce();assert.equal(positive.created,1);
  const afterFirst=await physical(context.pool);assert.ok(afterFirst);
  for(const key of ['messages','outboxes','deliveries','bindings','rounds'] as const)assert.equal(afterFirst[key].length,before[key].length+1);
  assert.deepEqual(afterFirst.attempts,before.attempts);assert.deepEqual(afterFirst.grants,before.grants);
  assert.equal((await producer.post(id,'complete',{...producer.command(started),internal_process:canary+'：仅合成内部处置'})).status,200);
  assert.equal((await context.runtime.roundNotifications.runOnce()).created,1);const completed=await producer.detail(id);assert.equal(completed.status,'CLOSED');
  const readerId=context.principals[1]?.id;assert.ok(readerId);assert.notEqual(completed.assignee_id,readerId,'reader is not the owner, so owner access cannot hide removed role/group authority');
  const principal=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[readerId])).rows[0];assert.ok(principal);
  const path='/api/tickets/'+id+'/deliveries',read=async()=>{const response=await reader.get(path);assert.equal(response.status,200);const reply=await response.json() as Reply;safe(reply);return reply;};
  const actual=await read();assert.deepEqual(actual.items.map(item=>item.node).sort(),['FIRST_RESPONSIBILITY','STAFF_COMPLETED']);
  assert.equal((await outsider.get(path)).status,404);assert.equal((await fetch(context.origin+path)).status,401);
  const baseline=await physical(context.pool);assert.ok(baseline);const access=createPilotAccessService({pool:context.pool});
  // ADMIN/DISPATCHER are legitimately broad readers. Their negative phase removes that role through the existing PublicAccess Port.
  for(const role of ['ADMIN','DISPATCHER','HANDLER'] as const){
   const allowed=await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:[role],resolverTeamIds:role==='HANDLER'?['PILOT_IT']:[]});assert.equal(allowed.id,readerId);
   assert.deepEqual(await read(),actual);
   const restricted=await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:[]});assert.equal(restricted.id,readerId);
   const denied=await reader.get(path);assert.equal(denied.status,404);const error=await denied.json();assert.equal(Object.hasOwn(error,'items'),false);
   for(const marker of [canary,'user-test','bot-test'])assert.equal(JSON.stringify(error).includes(marker),false);
   assert.deepEqual(await physical(context.pool),baseline);assert.deepEqual(await producer.detail(id),completed);
  }
  await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  assert.deepEqual(await read(),actual);assert.deepEqual(await closed.runOnce(),{scanned:0,created:0});
  assert.deepEqual(await physical(context.pool),baseline);assert.deepEqual(await producer.detail(id),completed);
 },{manualRoundConsumption:true});
});
