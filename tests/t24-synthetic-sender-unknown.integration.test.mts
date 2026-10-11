// SOURCE_REGISTERED_NOT_RUN. Mechanical copy of preserved external draft; original assertions and 240s budget retained.
// Uses existing public HTTP/round/Communication Ports, synthetic Sender only; no business SQL writes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {appendCommunication} from '../src/p2-004-communication-core.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createCommunicationDeliveryWorker,createCommunicationDeliveryOperatorPort,createCommunicationReconciliationPort} from '../src/p2-004-communication-delivery-worker.mjs';
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

test('synthetic UNKNOWN freezes automatic re-send of the same staff intent and requires an explicit authorized reconciliation Port',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const http=await t11Http(context),id=context.ticketId;await http.start(id);await context.runtime.roundNotifications.runOnce();
  const current=await http.detail(id);assert.equal((await http.post(id,'complete',http.command(current))).status,200);await context.runtime.roundNotifications.runOnce();
  const closed=await http.detail(id);assert.equal(closed.status,'CLOSED');const before=await deliveryFacts(http,id);assert.equal(before.length,2);
  const staff=before.find(row=>row.node==='STAFF_COMPLETED');assert.ok(staff);assert.equal(typeof staff.delivery_id,'string');
  const beforeIds=await physical(context.pool),beforeBindings=await bindings(context.pool);let calls=0;
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{send:async request=>{
   calls++;assert.equal(request.delivery_id,staff.delivery_id);assert.equal(request.target_type,'PERSON');
   return {outcome:'UNKNOWN',provider_message_id:null,error_code:'T24_SYNTHETIC_UNKNOWN',retryable:false};
  }}});
  const result=await worker.deliver({deliveryId:String(staff.delivery_id)});assert.ok(result&&'status' in result);assert.equal(result.status,'RECONCILIATION_REQUIRED');assert.equal(calls,1);
  const unresolved=await deliveryFacts(http,id),unknown=unresolved.find(row=>row.delivery_id===staff.delivery_id);assert.ok(unknown);
  assert.equal(unknown.status,'RECONCILIATION_REQUIRED');assert.equal(unknown.attempt_count,1);assert.equal(unknown.side_effect_state,'UNKNOWN');assert.equal(unknown.sent_at,null);
  const attempts=(await context.pool.query('SELECT attempt_no,outcome,side_effect_state FROM communication.delivery_attempt WHERE delivery_id=$1::uuid ORDER BY attempt_no',[staff.delivery_id])).rows;
  assert.deepEqual(attempts,[{attempt_no:1,outcome:'RECONCILIATION_REQUIRED',side_effect_state:'UNKNOWN'}]);
  await context.runtime.roundNotifications.runOnce();assert.equal(await worker.deliver({deliveryId:String(staff.delivery_id)}),null);assert.equal(calls,1);
  const operator=createCommunicationDeliveryOperatorPort({pool:context.pool}),retry=await operator.scheduleRetry({deliveryId:String(staff.delivery_id),authorized:true});
  assert.ok(retry&&'error' in retry);assert.equal(retry.error.code,'COMMUNICATION_DELIVERY_RECONCILIATION_REQUIRED');
  const reconcile=createCommunicationReconciliationPort({pool:context.pool});
  const denied=await reconcile.reconcileUnknownDelivery({deliveryId:String(staff.delivery_id),expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'T24_SYNTHETIC_RECEIPT',authorized:false});
  assert.ok(denied&&'error' in denied);assert.equal(denied.error.code,'COMMUNICATION_RECONCILIATION_NOT_AUTHORIZED');
  assert.deepEqual(await deliveryFacts(http,id),unresolved);assert.deepEqual(await http.detail(id),closed);
  // Port-only synthetic caller authority; this is not an HTTP authorization or real provider-receipt proof.
  const confirmed=await reconcile.reconcileUnknownDelivery({deliveryId:String(staff.delivery_id),expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'T24_SYNTHETIC_RECEIPT',authorized:true});
  assert.ok(confirmed&&'status' in confirmed);assert.equal(confirmed.status,'SENT');assert.equal(calls,1);
  const after=await deliveryFacts(http,id),sent=after.find(row=>row.delivery_id===staff.delivery_id);assert.ok(sent);
  assert.equal(sent.status,'SENT');assert.equal(sent.side_effect_state,'ACKNOWLEDGED');assert.equal(sent.attempt_count,2);assert.notEqual(sent.sent_at,null);
  assert.deepEqual(after.find(row=>row.node==='FIRST_RESPONSIBILITY'),before.find(row=>row.node==='FIRST_RESPONSIBILITY'));
  assert.equal(await worker.deliver({deliveryId:String(staff.delivery_id)}),null);assert.equal(calls,1);
  assert.deepEqual(await physical(context.pool),beforeIds);assert.deepEqual(await bindings(context.pool),beforeBindings);assert.deepEqual(await http.detail(id),closed);
 },{manualRoundConsumption:true});
});
