// D-only integration Source proposal. NOT_APPLIED / NOT_TYPECHECKED / NOT_RUN.
// Intended path after review: tests/t36-bound-reply.integration.test.mts.
// Every ProposedReplyFixture method is a PROPOSED_NOT_MOUNTED fixture seam.
// The HTTP path exists in fixed f941; follow_up_target support and T36 page do not.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import type {CommunicationSenderRequest} from '../../contracts/communication_contracts.js';
import type {CommunicationSenderResult} from '../../app/server/src/p2-004-communication-sender-port.mjs';
import {createCommunicationDeliveryWorker} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';

interface Target {source_ref:string;revision:string}
interface PlannedReplyBody {
  client_command_id:string;expected_row_version:number;text:string;
  follow_up_target:Target & {ticket_id:string};
}
interface Receipt {
  message_id:string;outbox_id:string;delivery_ids:string[];
  command_status:'COMMITTED'|'REPLAYED';replayed:boolean;
}
interface Facts {
  message_id:string;session_id:string;sender_principal_id:string;sender_kind:string;
  purpose:string;visibility:string;client_command_id:string;content:unknown;
  outbox_id:string;delivery_id:string;target_type:string;target_id:string;
  status:string;side_effect_state:string;sent_epoch_ms:string|null;attempt_count:number;
  attempt_outcome:string|null;attempt_side_effect_state:string|null;
}
export interface ProposedReplyFixture {
  // Owner must create this Session via real assembly.handleFrame + projection,
  // obtain material targets from authorized detail, and keep the App Worker disabled.
  // No direct Session/Message/Delivery state seed or fabricated HTTP response.
  setup_mode:'REAL_BOT_INGRESS_SINGLE_APP_MANUAL_ORIGINAL_WORKER';
  pool:PostgresPool;sessionId:string;ticketId:string;actorId:string;reporterId:string;
  r2:Target;rowVersion:number;internalCanary:string;
  // Existing messages POST, native Cookie/CSRF/Origin/UUID/If-Match, consuming body.
  postReply(body:PlannedReplyBody):Promise<Response>;
  // New T36 GET: real native HTTP only; no in-memory page implementation.
  page():Promise<unknown>;
  // Same reporter/topic through original ingress; return fresh authorized target.
  appendR3():Promise<Target>;
  // Ticket version/status/owner/events, handling cycle and personal read positions.
  independentFacts():Promise<unknown>;
}

const object=(value:unknown):Record<string,unknown>=>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
};
const receipt=(value:unknown):Receipt=>{
  const v=object(value);assert.ok(typeof v.message_id==='string');
  assert.ok(typeof v.outbox_id==='string');assert.ok(Array.isArray(v.delivery_ids));
  assert.ok(v.delivery_ids.length>0,'an empty necessary set is never reliable reply evidence');
  assert.ok(v.delivery_ids.every(id=>typeof id==='string'));
  assert.ok(v.command_status==='COMMITTED'||v.command_status==='REPLAYED');
  assert.ok(typeof v.replayed==='boolean');
  return {message_id:v.message_id,outbox_id:v.outbox_id,delivery_ids:v.delivery_ids as string[],
    command_status:v.command_status,replayed:v.replayed};
};
const material=(page:unknown,target:Target):Record<string,unknown>=>{
  const v=object(page);assert.ok(Array.isArray(v.items));
  const matches=v.items.map(object).filter(item=>
    item.source_ref===target.source_ref&&item.revision===target.revision);
  assert.equal(matches.length,1,'exact material target occurs once');
  return matches[0] as Record<string,unknown>;
};
const pending=(page:unknown,target:Target)=>{
  const item=material(page,target);assert.equal(item.follow_up_state,'PENDING');
  assert.equal(item.resolution,null);
};
async function facts(pool:PostgresPool,r:Receipt):Promise<Facts[]> {
  const result=await pool.query<Facts>(`
    SELECT m.id::text AS message_id,m.session_id::text,m.sender_principal_id::text,
      m.sender_kind,m.purpose,m.visibility,m.client_command_id::text,m.content,
      o.id::text AS outbox_id,d.id::text AS delivery_id,d.target_type,d.target_id,
      d.status,d.side_effect_state,d.sent_epoch_ms::text,d.attempt_count,
      a.outcome AS attempt_outcome,a.side_effect_state AS attempt_side_effect_state
    FROM communication.message m
    JOIN communication.outbox o ON o.message_id=m.id
    JOIN communication.delivery d ON d.outbox_id=o.id
    LEFT JOIN communication.delivery_attempt a
      ON a.delivery_id=d.id AND a.attempt_no=d.attempt_count
    WHERE m.id=$1::uuid AND o.id=$2::uuid ORDER BY d.id
  `,[r.message_id,r.outbox_id]);
  assert.ok(result.rows.length>0);
  assert.deepEqual(result.rows.map(row=>row.delivery_id).sort(),[...r.delivery_ids].sort());
  return result.rows;
}
function replyIdentity(rows:Facts[],f:ProposedReplyFixture,body:PlannedReplyBody) {
  for(const row of rows) {
    assert.equal(row.session_id,f.sessionId);assert.equal(row.sender_principal_id,f.actorId);
    assert.equal(row.sender_kind,'AGENT');assert.equal(row.purpose,'HUMAN_REPLY');
    assert.equal(row.visibility,'EXTERNAL');assert.equal(row.client_command_id,body.client_command_id);
    assert.equal(object(row.content).text,body.text);
    assert.equal(JSON.stringify(row.content).includes(f.internalCanary),false);
    assert.equal(row.target_type,'PERSON');assert.equal(row.target_id,f.reporterId);
  }
}
function reliable(rows:Facts[]) {
  assert.ok(rows.length>0);
  for(const row of rows) {
    assert.equal(row.status,'SENT');assert.equal(row.side_effect_state,'ACKNOWLEDGED');
    assert.match(row.sent_epoch_ms??'',/^[1-9][0-9]*$/u);assert.ok(row.attempt_count>0);
    assert.equal(row.attempt_outcome,'SENT');assert.equal(row.attempt_side_effect_state,'ACKNOWLEDGED');
  }
}
function bodyFor(f:ProposedReplyFixture):PlannedReplyBody {
  return {client_command_id:randomUUID(),expected_row_version:f.rowVersion,
    text:'已收到本次补充，请按已确认的步骤重试。',
    follow_up_target:{ticket_id:f.ticketId,...f.r2}};
}

// This is a proposed scenario runner, not a registered/executed test.
// Run in a fresh owned fixture. Fixture remains responsible for App/pool/DB cleanup.
export async function proposedBoundReplySuccess(f:ProposedReplyFixture) {
  assert.equal(f.setup_mode,'REAL_BOT_INGRESS_SINGLE_APP_MANUAL_ORIGINAL_WORKER');
  pending(await f.page(),f.r2);const before=await f.independentFacts(),body=bodyFor(f);
  const response=await f.postReply(body);assert.equal(response.status,202);
  const accepted=receipt(await response.json());assert.equal(accepted.replayed,false);
  assert.equal(accepted.delivery_ids.length,1,'production reporter-private HUMAN_REPLY is one PERSON route');
  const initial=await facts(f.pool,accepted);replyIdentity(initial,f,body);
  assert.ok(initial.every(row=>row.status==='PENDING'));pending(await f.page(),f.r2);
  assert.deepEqual(await f.independentFacts(),before);

  let markEntered:()=>void=()=>{throw Error('T36_GATE_NOT_INITIALIZED');};
  let acknowledge:(value:CommunicationSenderResult)=>void=()=>{throw Error('T36_GATE_NOT_INITIALIZED');};
  const entered=new Promise<void>(resolve=>{markEntered=resolve;});
  const result=new Promise<CommunicationSenderResult>(resolve=>{acknowledge=resolve;});
  const calls:CommunicationSenderRequest[]=[];
  const sender={send:async(request:CommunicationSenderRequest):Promise<CommunicationSenderResult>=>{
    calls.push(request);markEntered();return result;
  }};
  // One original Worker, manual deliver only. The App fixture must not inject senderAdapter.
  const worker=createCommunicationDeliveryWorker({pool:f.pool,sender,enabled:true,batchSize:1});
  const deliveryId=accepted.delivery_ids[0];assert.ok(deliveryId);
  const delivery=worker.deliver({deliveryId});
  let r3:Target|null=null;
  try {
    await Promise.race([entered,delivery.then(()=>{throw Error('T36_TRANSPORT_NOT_ENTERED');})]);
    assert.ok((await facts(f.pool,accepted)).every(row=>row.status==='SENDING'));
    pending(await f.page(),f.r2);
    r3=await f.appendR3();assert.notDeepEqual(r3,f.r2);
    pending(await f.page(),r3);pending(await f.page(),f.r2);
  } finally {
    // Release owned transport even on an assertion failure; Worker clears its own timer.
    acknowledge({outcome:'ACKNOWLEDGED',provider_message_id:'t36-isolated-ack',error_code:null,retryable:false});
    await delivery;
  }
  assert.ok(r3);reliable(await facts(f.pool,accepted));assert.equal(calls.length,1);
  assert.equal(JSON.stringify(calls[0]?.message.content).includes(f.internalCanary),false);
  const after=await f.page(),old=material(after,f.r2);
  assert.equal(old.follow_up_state,'FOLLOWED_UP');
  assert.equal(object(old.resolution).basis,'VERIFIED_REPLY');
  pending(after,r3);
  // appendR3 changes material facts, so compare against a post-ingress baseline in
  // the owner wrapper. The reply itself must not change Ticket/read/ownership facts.
  const replay=await f.postReply(body);assert.equal(replay.status,202);
  const replayReceipt=receipt(await replay.json());
  assert.equal(replayReceipt.replayed,true);assert.equal(replayReceipt.message_id,accepted.message_id);
  assert.deepEqual(replayReceipt.delivery_ids,accepted.delivery_ids);assert.equal(calls.length,1);
  const moved=await f.postReply({...body,follow_up_target:{ticket_id:f.ticketId,...r3}});
  assert.equal(moved.status,409);await moved.arrayBuffer();
  const edited=await f.postReply({...body,text:body.text+'（改写）'});
  assert.equal(edited.status,409);await edited.arrayBuffer();
  pending(await f.page(),r3);assert.equal(calls.length,1);
}

// Fresh fixture per outcome. Never directly UPDATE a Delivery to SENT/UNKNOWN/FAILED.
export async function proposedBoundReplyNotCompleted(
  f:ProposedReplyFixture,outcome:'FAILED'|'UNKNOWN'
) {
  pending(await f.page(),f.r2);const before=await f.independentFacts(),body=bodyFor(f);
  const response=await f.postReply(body);assert.equal(response.status,202);
  const accepted=receipt(await response.json());const calls:CommunicationSenderRequest[]=[];
  const sender={send:async(request:CommunicationSenderRequest):Promise<CommunicationSenderResult>=>{
    calls.push(request);
    return outcome==='FAILED'
      ? {outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'T36_ISOLATED_REJECTED',retryable:false}
      : {outcome:'UNKNOWN',provider_message_id:null,error_code:'T36_ISOLATED_UNKNOWN',retryable:false};
  }};
  const worker=createCommunicationDeliveryWorker({pool:f.pool,sender,enabled:true,batchSize:1});
  const deliveryId=accepted.delivery_ids[0];assert.ok(deliveryId);
  await worker.deliver({deliveryId});
  const rows=await facts(f.pool,accepted);replyIdentity(rows,f,body);
  assert.ok(rows.every(row=>row.status===(outcome==='FAILED'?'DEAD_LETTER':'RECONCILIATION_REQUIRED')));
  assert.ok(rows.every(row=>row.sent_epoch_ms===null));
  pending(await f.page(),f.r2);assert.deepEqual(await f.independentFacts(),before);
  assert.equal(calls.length,1);
  if(outcome==='UNKNOWN') {
    assert.equal(await worker.deliver({deliveryId}),null,'UNKNOWN cannot be blindly resent');
    assert.equal(calls.length,1);
  }
}
