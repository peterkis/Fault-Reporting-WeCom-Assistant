// SOURCE_REGISTERED_NOT_RUN. Mechanical copy of preserved external draft; original assertions and 240s budget retained.
// Uses existing public HTTP/round/Communication Ports, synthetic Sender only; no business SQL writes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createTicketRoundNotifications} from '../app/server/src/workbench-ticket-round-notifications.mjs';
import {appendCommunication} from '../app/server/src/p2-004-communication-core.mjs';
import {createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createCommunicationDeliveryWorker,createCommunicationDeliveryOperatorPort,createCommunicationReconciliationPort} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
type Ids={messages:string[];outboxes:string[];deliveries:string[];bindings:string[];rounds:string[];public_refs:string[];grants:string[]};
async function physical(pool:PostgresPool):Promise<Ids>{const row=(await pool.query<Ids>(`SELECT
 ARRAY(SELECT id::text FROM communication.message ORDER BY id::text) AS messages,
 ARRAY(SELECT id::text FROM communication.outbox ORDER BY id::text) AS outboxes,
 ARRAY(SELECT id::text FROM communication.delivery ORDER BY id::text) AS deliveries,
 ARRAY(SELECT id::text FROM communication.ticket_notification_binding ORDER BY id::text) AS bindings,
 ARRAY(SELECT cycle_id::text||':'||node||':'||recipient_binding_hash||':'||destination_type FROM communication.ticket_round_notification_binding ORDER BY 1) AS rounds,
 ARRAY(SELECT id::text FROM pilot_ticket.reporter_public_ref ORDER BY id::text) AS public_refs,
 ARRAY(SELECT grant_id::text FROM pilot_ticket.reporter_access_grant ORDER BY grant_id::text) AS grants`)).rows[0];assert.ok(row);return row;}
async function bindings(pool:PostgresPool){return (await pool.query(`SELECT to_jsonb(b) AS binding031,to_jsonb(r) AS binding041
 FROM communication.ticket_notification_binding b LEFT JOIN communication.ticket_round_notification_binding r ON r.notification_binding_id=b.id
 ORDER BY b.id`)).rows;}
type Http=Awaited<ReturnType<typeof t11Http>>;
async function deliveryFacts(http:Http,id:string){const response=await http.get('/api/tickets/'+id+'/deliveries');assert.equal(response.status,200);return rows(object(await response.json()).items);}

test('synthetic definitely-not-applied Sender failure leaves one actual terminal staff Delivery without retrying or undoing Ticket completion',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const http=await t11Http(context),id=context.ticketId;await http.start(id);await context.runtime.roundNotifications.runOnce();
  const current=await http.detail(id);assert.equal((await http.post(id,'complete',http.command(current))).status,200);await context.runtime.roundNotifications.runOnce();
  const closed=await http.detail(id);assert.equal(closed.status,'CLOSED');const before=await deliveryFacts(http,id);assert.equal(before.length,2);
  const staff=before.find(row=>row.node==='STAFF_COMPLETED');assert.ok(staff);assert.equal(typeof staff.delivery_id,'string');
  const beforeIds=await physical(context.pool),beforeBindings=await bindings(context.pool);let calls=0;
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{send:async request=>{
   calls++;assert.equal(request.delivery_id,staff.delivery_id);assert.equal(request.target_type,'PERSON');
   return {outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'T24_SYNTHETIC_NOT_APPLIED',retryable:false};
  }}});
  const result=await worker.deliver({deliveryId:String(staff.delivery_id)});assert.ok(result&&'status' in result);assert.equal(result.status,'DEAD_LETTER');assert.equal(calls,1);
  const after=await deliveryFacts(http,id),failed=after.find(row=>row.delivery_id===staff.delivery_id);assert.ok(failed);
  assert.equal(failed.status,'DEAD_LETTER');assert.equal(failed.attempt_count,1);assert.equal(failed.side_effect_state,'NOT_ATTEMPTED');assert.equal(failed.sent_at,null);
  assert.deepEqual(after.find(row=>row.node==='FIRST_RESPONSIBILITY'),before.find(row=>row.node==='FIRST_RESPONSIBILITY'));
  const attempts=(await context.pool.query('SELECT attempt_no,outcome,side_effect_state FROM communication.delivery_attempt WHERE delivery_id=$1::uuid ORDER BY attempt_no',[staff.delivery_id])).rows;
  assert.deepEqual(attempts,[{attempt_no:1,outcome:'DEAD_LETTER',side_effect_state:'NOT_ATTEMPTED'}]);
  await context.runtime.roundNotifications.runOnce();assert.equal(await worker.deliver({deliveryId:String(staff.delivery_id)}),null);assert.equal(calls,1);
  assert.deepEqual(await physical(context.pool),beforeIds);assert.deepEqual(await bindings(context.pool),beforeBindings);assert.deepEqual(await http.detail(id),closed);
 },{manualRoundConsumption:true});
});
