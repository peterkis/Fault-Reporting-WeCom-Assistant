// SOURCE_REGISTERED_NOT_RUN. Mechanical copy of preserved external first; original body, roles, flags[] and 240000ms budget retained.
// Requires the companion default-false formal043 fixture patch; no SQL creates a Ticket cycle or business event here.
// ProductionWorker below is the public roundNotifications Port assembled by createP2016Runtime, not an HTTP consumer or process restart.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=2147483647);return value;}
function cycle(value:unknown){const row=object(value);assert.deepEqual(Object.keys(row).sort(),['cycle_no','first_responsibility_event_id','id','staff_completion_event_id']);return row;}
type Ids={messages:string[];outboxes:string[];deliveries:string[];bindings:string[];rounds:string[];attempts:string[];refs:string[];grants:string[]};
async function physical(pool:PostgresPool):Promise<Ids>{const row=(await pool.query<Ids>(`SELECT
 ARRAY(SELECT id::text FROM communication.message ORDER BY id::text) AS messages,
 ARRAY(SELECT id::text FROM communication.outbox ORDER BY id::text) AS outboxes,
 ARRAY(SELECT id::text FROM communication.delivery ORDER BY id::text) AS deliveries,
 ARRAY(SELECT id::text FROM communication.ticket_notification_binding ORDER BY id::text) AS bindings,
 ARRAY(SELECT cycle_id::text||':'||node||':'||recipient_binding_hash||':'||destination_type FROM communication.ticket_round_notification_binding ORDER BY 1) AS rounds,
 ARRAY(SELECT id::text FROM communication.delivery_attempt ORDER BY id::text) AS attempts,
 ARRAY(SELECT id::text FROM pilot_ticket.reporter_public_ref ORDER BY id::text) AS refs,
 ARRAY(SELECT grant_id::text FROM pilot_ticket.reporter_access_grant ORDER BY grant_id::text) AS grants`)).rows[0];assert.ok(row);return row;}
function delta(before:Ids,after:Ids,count:number,roundCount=count,grantBaseline=before.grants){
 for(const key of ['messages','outboxes','deliveries','bindings'] as const){assert.equal(after[key].length,before[key].length+count,key+' physical delta');assert.ok(before[key].every(id=>after[key].includes(id)),key+' preserves every old/unbound identity');}
 assert.equal(after.rounds.length,before.rounds.length+roundCount);assert.ok(before.rounds.every(id=>after.rounds.includes(id)));
 assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.grants,grantBaseline);
}
type GrantFact={grant_id:string;ticket_event_id:string;notification_type:string;reporter_binding_hash:string;purpose:string;state:string;binding_matches:boolean;row_digest:string};
async function grantFacts(pool:PostgresPool,id:string){return (await pool.query<GrantFact>(`SELECT g.grant_id::text,b.ticket_event_id::text,b.notification_type,g.reporter_binding_hash,g.purpose,g.state,
 (g.ticket_id=b.ticket_id AND g.message_id=b.message_id AND g.delivery_id=b.delivery_id AND g.reporter_binding_hash=b.recipient_binding_hash
  AND r.ticket_id=g.ticket_id AND r.reporter_binding_hash=g.reporter_binding_hash AND b.destination_type='PERSON') AS binding_matches,
 md5(to_jsonb(g)::text) AS row_digest FROM pilot_ticket.reporter_access_grant g
 JOIN pilot_ticket.reporter_public_ref r ON r.id=g.public_ref_id JOIN communication.ticket_notification_binding b ON b.delivery_id=g.delivery_id
 WHERE g.ticket_id=$1::uuid ORDER BY g.grant_id`,[id])).rows;}
// row_digest freezes every persisted Grant field without exposing nonce/token bytes; it is a consistency snapshot, not authorization.
async function nodeFacts(pool:PostgresPool,id:string){return (await pool.query(`SELECT r.cycle_id::text,c.cycle_no,r.node,b.id::text AS binding_id,
 b.ticket_event_id::text,m.id::text AS message_id,o.id::text AS outbox_id,d.id::text AS delivery_id,b.notification_type,
 (b.ticket_event_id=CASE WHEN r.node='FIRST_RESPONSIBILITY' THEN c.first_responsibility_event_id ELSE c.staff_completion_event_id END) AS original_basis,
 (b.recipient_binding_hash=r.recipient_binding_hash AND b.destination_type=r.destination_type AND b.ticket_id=r.ticket_id) AS binding_matches,
 (o.message_id=m.id AND d.outbox_id=o.id) AS real_chain,
 (d.provider=i.source_provider AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid AND d.target_type='PERSON') AS original_destination,
 b.recipient_binding_hash,m.content,e.new_status AS basis_status,e.aggregate_version AS basis_version,d.status,d.attempt_count,d.side_effect_state,d.sent_at,
 to_jsonb(b) AS full_binding031,to_jsonb(r) AS full_binding041
 FROM communication.ticket_round_notification_binding r JOIN pilot_ticket.ticket_handling_cycle c ON c.ticket_id=r.ticket_id AND c.id=r.cycle_id
 JOIN intake.service_intake i ON i.id=c.source_intake_id JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id
 JOIN pilot_ticket.ticket_event e ON e.ticket_id=c.ticket_id AND e.event_id=b.ticket_event_id
 JOIN communication.message m ON m.id=b.message_id JOIN communication.outbox o ON o.id=b.outbox_id JOIN communication.delivery d ON d.id=b.delivery_id
 WHERE r.ticket_id=$1::uuid ORDER BY c.cycle_no,r.node`,[id])).rows;}

test('a real staff reopen and same-C2 T05 acceptance gain one source-bound FIRST through a late production Worker without replacing C1 or creating a legacy shadow',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const id=context.ticketId,path='/api/tickets/'+id,admin=context.principals[0],handler=context.principals[1];assert.ok(admin&&handler);
  const adminCookie=context.cookies[0],handlerCookie=context.cookies[2];assert.ok(adminCookie&&handlerCookie);
  const get=async(route:string,cookie=adminCookie)=>{const response=await fetch(context.origin+route,{headers:{cookie}});assert.equal(response.status,200,'public GET '+route);return object(await response.json());};
  const adminBootstrap=await get('/api/lifecycle/bootstrap'),handlerBootstrap=await get('/api/lifecycle/bootstrap',handlerCookie);
  assert.equal(adminBootstrap.principal_id,admin.id);assert.ok(Array.isArray(adminBootstrap.roles)&&adminBootstrap.roles.includes('ADMIN'));
  assert.equal(handlerBootstrap.principal_id,handler.id);assert.ok(Array.isArray(handlerBootstrap.roles)&&handlerBootstrap.roles.includes('HANDLER'));assert.notEqual(admin.id,handler.id);
  assert.equal(adminBootstrap.ticket_reopen_rounds_enabled,true);assert.equal(adminBootstrap.ticket_round_notifications_enabled,true);assert.equal(handlerBootstrap.ticket_conversation_self_handling_enabled,true);
  const post=async(route:string,body:Record<string,unknown>,cookie:string,csrf:unknown)=>{
   const response=await fetch(context.origin+route,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json',
    'x-csrf-token':text(csrf),'idempotency-key':text(body.client_command_id),'if-match':'"'+version(body.expected_version)+'"'},body:JSON.stringify(body)});
   assert.equal(response.status,200,'public POST '+route);return object(await response.json());
  };
  const schema=(await context.pool.query("SELECT migration_id FROM platform.schema_migration WHERE migration_id IN ('033_yxx_self_service_intake','039_ticket_self_handling_cycles','040_ticket_staff_completion','041_ticket_round_notifications','043_ticket_reopen_rounds')")).rows;
  assert.equal(schema.length,5,'formal initialized prerequisites; no fake migration ledger');
  const readSource=async()=>{
   const row=(await context.pool.query(`SELECT t.source_intake_id::text,i.source_channel,i.source_provider,i.source_chat_type,i.source_chat_id,i.source_bot_id,i.reporter_wecom_userid,
    (m.provider=i.source_provider AND m.bot_id=i.source_bot_id AND m.sender_user_id=i.reporter_wecom_userid AND m.chat_type=i.source_chat_type AND m.chat_id IS NULL) AS inbox_matches,
    (m.normalized_message->>'msgtype'='text') AS normalized_text,
    (LEAST(i.retention_until_epoch_ms,m.retention_until_epoch_ms)>platform.physical_epoch_ms()) AS retained
    FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE t.id=$1::uuid`,[id])).rows[0];assert.ok(row);return row;
  };
  const source=await readSource();assert.equal(source.source_channel,'WECOM_DIRECT');assert.equal(source.source_provider,'WECOM_AIBOT');assert.equal(source.source_chat_type,'single');assert.equal(source.source_chat_id,null);
  assert.equal(source.inbox_matches,true);assert.equal(source.normalized_text,true);assert.equal(source.retained,true);
  const recipientHash=createHash('sha256').update(JSON.stringify([source.source_provider,source.source_bot_id,source.reporter_wecom_userid])).digest('hex');
  // This reuses the existing synthetic normalized Inbox/Intake input. Ticket and all cycles/events below are real Core/HTTP results, not SQL-seeded states.
  await context.runtime.coordinator.runOnce();
  const related=rows((await get(path+'/responsibility',handlerCookie)).conversations);assert.equal(related.length,1,'actual original Bot Session remains present');
  const queued=await get(path,handlerCookie);assert.equal(queued.status,'QUEUED');assert.equal(queued.assignee_id,null);assert.ok(Array.isArray(queued.allowed_actions)&&queued.allowed_actions.includes('take-and-start-with-conversations'));
  const beforeC1=await physical(context.pool);assert.deepEqual(beforeC1.grants,[]);
  await post(path+'/take-and-start-with-conversations',{client_command_id:randomUUID(),expected_version:queued.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:queued.resolver_team_id,communication_choice:'RETAIN_CURRENT',sessions:[]},handlerCookie,handlerBootstrap.csrf_token);
  const active=await get(path,handlerCookie),c1=cycle(active.handling_cycle);assert.equal(active.status,'IN_PROGRESS');assert.equal(active.assignee_id,handler.id);assert.equal(c1.cycle_no,1);assert.equal(typeof c1.first_responsibility_event_id,'string');
  const completion=await post(path+'/complete',{client_command_id:randomUUID(),expected_version:active.version,reason_code:'STAFF_COMPLETED',handling_cycle_id:c1.id,
   internal_process:'INTERNAL_T24_LC1_COMPLETION_CANARY: synthetic internal work',external_summary:'合成故障已处理，请核对。',external_summary_confirmed:true},handlerCookie,handlerBootstrap.csrf_token);
  const closed=await get(path),closedC1=cycle(closed.handling_cycle);assert.equal(closed.status,'CLOSED');assert.equal(closedC1.id,c1.id);assert.equal(closedC1.staff_completion_event_id,completion.ticket_event_id);
  const productionWorker=context.runtime.roundNotifications; // The actual production factory/Port from runtime assembly; no internal project() or consume HTTP route.
  // Defer the round Worker until C2 is committed. Legacy exact-basis 031 may already exist; 041 is still absent for this Ticket.
  const c1Deliveries=rows((await get(path+'/deliveries')).items);assert.deepEqual(await nodeFacts(context.pool,id),[]);
  const existing031=(await context.pool.query(`SELECT b.id::text,to_jsonb(b) AS binding,to_jsonb(m) AS message,to_jsonb(o) AS outbox,to_jsonb(d) AS delivery
   FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id
   JOIN communication.outbox o ON o.id=b.outbox_id JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=$1::uuid ORDER BY b.id`,[id])).rows;
  const frozenC1=(await context.pool.query('SELECT to_jsonb(c) AS fact FROM pilot_ticket.ticket_handling_cycle c WHERE id=$1::uuid',[c1.id])).rows;
  // T05 accept invokes the existing Card projector before first-cycle metadata is attached; its committed legacy031 notice owns this Grant.
  const c1Physical=await physical(context.pool),c1Grants=await grantFacts(context.pool,id);assert.equal(c1Grants.length,1);
  assert.deepEqual(c1Physical.grants,c1Grants.map(grant=>grant.grant_id));assert.equal(c1Grants[0]?.ticket_event_id,c1.first_responsibility_event_id);
  console.log('T24_LC1_STAGE '+JSON.stringify({stage:'C1_REAL_COMPLETION_COMMITTED_ROUND_WORKER_NOT_YET_RUN',physical_ids:c1Physical}));

  // Independent STAFF uses its own ADMIN permission. It does not acquire member feedback scope or fabricate a new source.
  const beforeReopen=await physical(context.pool);
  const reopened=await post(path+'/reopen',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'T24_LC1_STAFF_REOPEN',note:'INTERNAL_T24_LC1_REOPEN_CANARY: same unresolved synthetic fault',external_visible:false},adminCookie,adminBootstrap.csrf_token);
  const pending=await get(path,handlerCookie),c2=cycle(pending.handling_cycle);assert.equal(pending.id,id);assert.equal(pending.ticket_no,closed.ticket_no);assert.equal(pending.status,'REOPENED');assert.equal(pending.assignee_id,null);
  assert.equal(pending.resolver_team_id,closed.resolver_team_id);assert.equal(pending.intake_id,source.source_intake_id);assert.equal(pending.version,reopened.ticket_version);assert.equal(c2.cycle_no,2);assert.notEqual(c2.id,c1.id);assert.equal(c2.first_responsibility_event_id,null);assert.equal(c2.staff_completion_event_id,null);
  assert.ok(Array.isArray(pending.allowed_actions)&&pending.allowed_actions.includes('accept-for-later-with-conversations'));assert.equal(pending.allowed_actions.includes('assign'),false);
  const shared=(await context.pool.query(`SELECT completed_cycle_id::text,completion_event_id::text,new_cycle_id::text,reopen_event_id::text,source_intake_id::text,origin
   FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid AND new_cycle_id=$2::uuid`,[id,c2.id])).rows;
  assert.deepEqual(shared,[{completed_cycle_id:c1.id,completion_event_id:completion.ticket_event_id,new_cycle_id:c2.id,reopen_event_id:reopened.ticket_event_id,source_intake_id:source.source_intake_id,origin:'STAFF'}]);
  assert.deepEqual(await nodeFacts(context.pool,id),[]);assert.deepEqual((await context.pool.query('SELECT to_jsonb(c) AS fact FROM pilot_ticket.ticket_handling_cycle c WHERE id=$1::uuid',[c1.id])).rows,frozenC1);
  const beforeC2=await physical(context.pool); // Includes any legitimate reopen notice and every legacy/unbound intent, rather than hiding them in a 041-only count.
  const reopenNotices=(await context.pool.query(`SELECT b.id::text,m.id::text AS message_id,o.id::text AS outbox_id,d.id::text AS delivery_id,
   (d.provider=i.source_provider AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid AND d.target_type='PERSON') AS original_destination
   FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id
   JOIN communication.outbox o ON o.id=b.outbox_id JOIN communication.delivery d ON d.id=b.delivery_id
   JOIN intake.service_intake i ON i.id=$3::uuid WHERE b.ticket_id=$1::uuid AND b.ticket_event_id=$2::uuid AND b.notification_type='TICKET_REOPENED'`,[id,reopened.ticket_event_id,source.source_intake_id])).rows;
  assert.ok(reopenNotices.length<=1,'only the exact independently classified reopen notice can be outside the three round nodes');
  for(const notice of reopenNotices)assert.equal(notice.original_destination,true);
  delta(beforeReopen,beforeC2,reopenNotices.length,0);
  const acceptCommand={client_command_id:randomUUID(),expected_version:pending.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:pending.resolver_team_id,communication_choice:'RETAIN_CURRENT',sessions:[]};
  const accepted=await post(path+'/accept-for-later-with-conversations',acceptCommand,handlerCookie,handlerBootstrap.csrf_token);
  const ready=await get(path),readyC2=cycle(ready.handling_cycle),ackCycle=object(accepted.handling_cycle);assert.deepEqual(Object.keys(ackCycle).sort(),['cycle_no','first_responsibility_event_id','id']);
  for(const key of ['id','cycle_no','first_responsibility_event_id'] as const)assert.equal(ackCycle[key],readyC2[key]);
  assert.equal(ready.status,'ACCEPTED');assert.equal(ready.assignee_id,handler.id);assert.equal(ready.version,accepted.ticket_version);assert.equal(readyC2.id,c2.id);assert.equal(readyC2.cycle_no,2);assert.equal(readyC2.staff_completion_event_id,null);assert.equal(readyC2.first_responsibility_event_id,accepted.ticket_event_id);
  assert.notEqual(readyC2.first_responsibility_event_id,c1.first_responsibility_event_id);
  const basis=(await context.pool.query(`SELECT c.first_responsibility_event_id::text,c.first_responsibility_principal_id::text,c.first_responsibility_team_id,c.source_intake_id::text,e.event_type,e.new_status,
   (ce.cycle_id=c.id AND ce.ticket_id=c.ticket_id) AS cycle_event_matches FROM pilot_ticket.ticket_handling_cycle c
   JOIN pilot_ticket.ticket_event e ON e.ticket_id=c.ticket_id AND e.event_id=c.first_responsibility_event_id JOIN pilot_ticket.ticket_handling_cycle_event ce ON ce.ticket_event_id=e.event_id WHERE c.id=$1::uuid`,[c2.id])).rows;
  assert.deepEqual(basis,[{first_responsibility_event_id:accepted.ticket_event_id,first_responsibility_principal_id:handler.id,first_responsibility_team_id:ready.resolver_team_id,source_intake_id:source.source_intake_id,event_type:'ticket.accepted',new_status:'ACCEPTED',cycle_event_matches:true}]);
  const beforeLateWorker=await physical(context.pool),committedGrants=await grantFacts(context.pool,id);assert.equal(committedGrants.length,2);
  assert.deepEqual(beforeLateWorker.grants,committedGrants.map(grant=>grant.grant_id));
  for(const prior of c1Grants)assert.deepEqual(committedGrants.find(grant=>grant.grant_id===prior.grant_id),prior,'C2 accept preserves the exact committed C1 Grant');
  assert.equal(committedGrants.filter(grant=>grant.ticket_event_id===accepted.ticket_event_id).length,1);
  for(const grant of committedGrants){assert.equal(grant.notification_type,'TICKET_ACCEPTED');assert.equal(grant.reporter_binding_hash,recipientHash);assert.equal(grant.binding_matches,true);assert.equal(grant.purpose,'REPORTER_TIMELINE');assert.equal(grant.state,'ISSUED');}
  console.log('T24_LC1_STAGE '+JSON.stringify({stage:'C2_REAL_T05_FIRST_COMMITTED_BEFORE_LATE_WORKER',physical_ids:beforeLateWorker}));
  // Exact-basis 031 adoption is legitimate. Measure producer plus Worker as one interval; do not require a second physical append if the producer already committed the same notice.
  await productionWorker.runOnce();
  // Producer+Worker still has the original complete physical node delta; only the Grant baseline is frozen after both genuine T05 producers.
  const afterC2=await physical(context.pool);delta(beforeC1,afterC2,3+reopenNotices.length,3,beforeLateWorker.grants);
  assert.deepEqual(await grantFacts(context.pool,id),committedGrants,'late Worker cannot add, replace or mutate either producer Grant');
  const allFacts=await nodeFacts(context.pool,id),newFacts=allFacts.filter(fact=>fact.cycle_id===c2.id),c1Facts=allFacts.filter(fact=>fact.cycle_id===c1.id);
  assert.equal(allFacts.length,3);assert.equal(c1Facts.length,2);assert.equal(newFacts.length,1,'late Worker must bind the actual C2 FIRST exactly once');
  for(const fact of allFacts){
   assert.equal(fact.original_basis,true);assert.equal(fact.binding_matches,true);assert.equal(fact.real_chain,true);assert.equal(fact.original_destination,true);assert.equal(fact.recipient_binding_hash,recipientHash);
   const safe=object(fact.content);assert.equal(safe.status,fact.basis_status);assert.equal(safe.version,fact.basis_version);assert.equal(safe.source,'DIRECT');
   assert.equal(fact.status,'PENDING');assert.equal(fact.attempt_count,0);assert.equal(fact.side_effect_state,'NOT_ATTEMPTED');assert.equal(fact.sent_at,null);
  }
  assert.deepEqual(c1Facts.map(fact=>fact.node).sort(),['FIRST_RESPONSIBILITY','STAFF_COMPLETED']);
  const recovered031=(await context.pool.query(`SELECT b.id::text,to_jsonb(b) AS binding,to_jsonb(m) AS message,to_jsonb(o) AS outbox,to_jsonb(d) AS delivery
   FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id
   JOIN communication.outbox o ON o.id=b.outbox_id JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=$1::uuid ORDER BY b.id`,[id])).rows;
  for(const prior of existing031)assert.ok(recovered031.some(fact=>JSON.stringify(fact)===JSON.stringify(prior)),'adoption preserves each already committed exact 031 physical chain');
  const first=newFacts[0];assert.ok(first);assert.equal(first.node,'FIRST_RESPONSIBILITY');assert.equal(first.ticket_event_id,accepted.ticket_event_id);assert.equal(first.notification_type,'TICKET_ACCEPTED');
  for(const key of ['original_basis','binding_matches','real_chain','original_destination'] as const)assert.equal(first[key],true);
  assert.equal(first.recipient_binding_hash,recipientHash);assert.equal(first.basis_status,'ACCEPTED');assert.equal(first.status,'PENDING');assert.equal(first.attempt_count,0);assert.equal(first.side_effect_state,'NOT_ATTEMPTED');assert.equal(first.sent_at,null);
  const card=object(first.content);assert.equal(card.status,'ACCEPTED');assert.equal(card.source,'DIRECT');assert.equal(card.version,first.basis_version);
  for(const canary of ['INTERNAL_T24_LC1_COMPLETION_CANARY','INTERNAL_T24_LC1_REOPEN_CANARY'])assert.equal(JSON.stringify(allFacts.map(fact=>fact.content)).includes(canary),false);
  const delivered=rows((await get(path+'/deliveries')).items),roundRows=delivered.filter(row=>row.node==='FIRST_RESPONSIBILITY'||row.node==='STAFF_COMPLETED');assert.equal(roundRows.length,3);
  assert.ok(roundRows.some(row=>row.delivery_id===first.delivery_id&&row.node==='FIRST_RESPONSIBILITY'&&row.cycle_no===2));
  for(const old of c1Deliveries){const current=delivered.find(row=>row.delivery_id===old.delivery_id);assert.ok(current);for(const key of ['delivery_id','notification_type','destination_type','status','attempt_count','side_effect_state','sent_at','created_at'] as const)assert.equal(current[key],old[key]);}
  for(const privateValue of [text(source.source_bot_id),text(source.reporter_wecom_userid),'INTERNAL_T24_LC1'])assert.equal(JSON.stringify(delivered).includes(privateValue),false);
  await productionWorker.runOnce();const replay=await post(path+'/accept-for-later-with-conversations',acceptCommand,handlerCookie,handlerBootstrap.csrf_token);assert.equal(replay.replayed,true);await productionWorker.runOnce();
  assert.deepEqual(await physical(context.pool),afterC2);assert.deepEqual(await grantFacts(context.pool,id),committedGrants);assert.deepEqual(await nodeFacts(context.pool,id),allFacts);assert.deepEqual(rows((await get(path+'/deliveries')).items),delivered);
  assert.deepEqual(await get(path),ready);assert.deepEqual(await readSource(),source);assert.deepEqual((await context.pool.query('SELECT to_jsonb(c) AS fact FROM pilot_ticket.ticket_handling_cycle c WHERE id=$1::uuid',[c1.id])).rows,frozenC1);
  console.log('T24_LC1_STAGE '+JSON.stringify({stage:'LATE_WORKER_AND_REPLAY_PHYSICAL_IDENTITIES_STABLE',physical_ids:afterC2,production_worker_port:'runtime.roundNotifications.runOnce',process_restart:false,real_sender:false}));
 },{ticketConversationSelfHandlingEnabled:true,ticketReopenRoundsEnabled:true,manualRoundConsumption:true});
});
