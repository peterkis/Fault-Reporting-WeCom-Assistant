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

test('fresh consumer and an independent connection recover a committed staff node while preserving the original first intent',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const http=await t11Http(context),id=context.ticketId;await http.start(id);
  await context.runtime.roundNotifications.runOnce();
  const first=await deliveryFacts(http,id);assert.equal(first.length,1);assert.equal(first[0]?.node,'FIRST_RESPONSIBILITY');
  const beforeIds=await physical(context.pool),beforeBindings=await bindings(context.pool),current=await http.detail(id);
  assert.equal((await http.post(id,'complete',http.command(current))).status,200);
  const closed=await http.detail(id);assert.equal(closed.status,'CLOSED');
  assert.deepEqual(await physical(context.pool),beforeIds,'committed staff completion is not itself a physical Delivery append');
  // Recreate public consumer with new RAM cursor and a real independent connection; not an App/process restart claim.
  const freshPool=createPostgresPool({connectionString:context.databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'t24_draft_fresh_consumer'});
  try{
   const fresh=createTicketRoundNotifications({pool:freshPool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});
   await fresh.runOnce();await fresh.runOnce();
  }finally{await freshPool.end();assert.equal(freshPool.totalCount,0);}
  const recovered=await deliveryFacts(http,id);assert.equal(recovered.length,2);
  assert.deepEqual(recovered.find(row=>row.node==='FIRST_RESPONSIBILITY'),first[0]);
  const staff=recovered.find(row=>row.node==='STAFF_COMPLETED');assert.ok(staff);assert.equal(staff.cycle_no,1);assert.equal(staff.status,'PENDING');
  assert.equal(staff.attempt_count,0);assert.equal(staff.side_effect_state,'NOT_ATTEMPTED');assert.equal(staff.sent_at,null);
  const after=await physical(context.pool);
  for(const key of ['messages','outboxes','deliveries','bindings','rounds'] as const){assert.equal(after[key].length,beforeIds[key].length+1);assert.ok(beforeIds[key].every(value=>after[key].includes(value)));}
  assert.deepEqual(after.public_refs,beforeIds.public_refs);assert.deepEqual(after.grants,beforeIds.grants);
  const afterBindings=await bindings(context.pool);assert.ok(beforeBindings.every(row=>afterBindings.some(value=>JSON.stringify(value)===JSON.stringify(row))));
  const linked=(await context.pool.query(`SELECT b.ticket_event_id::text,c.staff_completion_event_id::text,
   (b.ticket_event_id=c.staff_completion_event_id) AS original_staff_basis,(b.recipient_binding_hash=r.recipient_binding_hash) AS recipient_matches,
   (o.message_id=m.id AND d.outbox_id=o.id) AS real_chain,
   (d.provider=i.source_provider AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid AND d.target_type='PERSON') AS original_destination
   FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id
   JOIN pilot_ticket.ticket_handling_cycle c ON c.ticket_id=r.ticket_id AND c.id=r.cycle_id JOIN intake.service_intake i ON i.id=c.source_intake_id
   JOIN communication.message m ON m.id=b.message_id JOIN communication.outbox o ON o.id=b.outbox_id JOIN communication.delivery d ON d.id=b.delivery_id
   WHERE r.ticket_id=$1::uuid AND r.node='STAFF_COMPLETED' AND d.id=$2::uuid`,[id,staff.delivery_id])).rows;
  assert.equal(linked.length,1);assert.equal(linked[0]?.original_staff_basis,true);assert.equal(linked[0]?.recipient_matches,true);assert.equal(linked[0]?.real_chain,true);assert.equal(linked[0]?.original_destination,true);
  await context.runtime.roundNotifications.runOnce();assert.deepEqual(await physical(context.pool),after);
  assert.deepEqual(await http.detail(id),closed,'notification recovery cannot undo committed Ticket completion');
 },{manualRoundConsumption:true});
});
