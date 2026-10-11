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

test('an actual append interrupted before round binding rolls back all physical intent and a fresh consumer recovers without undoing the Ticket',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const http=await t11Http(context),id=context.ticketId,before=await physical(context.pool);await http.start(id);
  const committed=await http.detail(id);assert.equal(committed.status,'IN_PROGRESS');assert.ok(committed.handling_cycle?.first_responsibility_event_id);
  assert.deepEqual(await physical(context.pool),before,'explicit-consumption fixture must not race the injected append');
  let actualAppends=0;
  const interruptedAppend:typeof appendCommunication=async input=>{
   const result=await appendCommunication(input);assert.ok(result&&'message_id' in result&&result.outbox_id&&result.delivery_ids.length===1);
   actualAppends++;throw Error('T24_SYNTHETIC_INTERRUPTED_AFTER_REAL_APPEND');
  };
  const interrupted=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess,communicationAppend:interruptedAppend});
  await assert.rejects(interrupted.runOnce(),/T24_SYNTHETIC_INTERRUPTED_AFTER_REAL_APPEND/u);assert.equal(actualAppends,1,'fault must be after real Message/Outbox/Delivery SQL in caller transaction');
  assert.deepEqual(await physical(context.pool),before,'no partial public_ref/Message/Outbox/Delivery/031/041/grant may survive rollback');
  assert.deepEqual(await deliveryFacts(http,id),[]);assert.deepEqual(await http.detail(id),committed);
  const freshPool=createPostgresPool({connectionString:context.databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'t24_draft_partial_recovery'});
  try{const recovered=createTicketRoundNotifications({pool:freshPool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});await recovered.runOnce();await recovered.runOnce();}
  finally{await freshPool.end();assert.equal(freshPool.totalCount,0);}
  const recovered=await deliveryFacts(http,id);assert.equal(recovered.length,1);assert.equal(recovered[0]?.node,'FIRST_RESPONSIBILITY');
  assert.equal(recovered[0]?.status,'PENDING');assert.equal(recovered[0]?.attempt_count,0);assert.equal(recovered[0]?.side_effect_state,'NOT_ATTEMPTED');
  const after=await physical(context.pool);for(const key of ['messages','outboxes','deliveries','bindings','rounds'] as const)assert.equal(after[key].length,before[key].length+1);
  const basis=(await context.pool.query(`SELECT (b.ticket_event_id=c.first_responsibility_event_id) AS first_basis,
   (b.recipient_binding_hash=r.recipient_binding_hash) AS recipient_matches,(o.message_id=m.id AND d.outbox_id=o.id) AS real_chain,
   (d.provider=i.source_provider AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid AND d.target_type='PERSON') AS original_destination
   FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id
   JOIN pilot_ticket.ticket_handling_cycle c ON c.ticket_id=r.ticket_id AND c.id=r.cycle_id JOIN intake.service_intake i ON i.id=c.source_intake_id
   JOIN communication.message m ON m.id=b.message_id JOIN communication.outbox o ON o.id=b.outbox_id JOIN communication.delivery d ON d.id=b.delivery_id
   WHERE r.ticket_id=$1::uuid AND r.node='FIRST_RESPONSIBILITY' AND d.id=$2::uuid`,[id,recovered[0]?.delivery_id])).rows;
  assert.equal(basis.length,1);assert.equal(basis[0]?.first_basis,true);assert.equal(basis[0]?.recipient_matches,true);assert.equal(basis[0]?.real_chain,true);assert.equal(basis[0]?.original_destination,true);
  const stableBindings=await bindings(context.pool);await context.runtime.roundNotifications.runOnce();
  assert.deepEqual(await physical(context.pool),after);assert.deepEqual(await bindings(context.pool),stableBindings);assert.deepEqual(await http.detail(id),committed);
 },{manualRoundConsumption:true});
});
