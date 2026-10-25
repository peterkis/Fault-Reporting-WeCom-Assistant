import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {t33WholeHttp,t33Record,t33Text} from './helpers/t33-whole-fixture.mjs';

test('T33 pending retry is an audited noop; proven dead letter retries once; Dispatcher cannot reconcile and CANCEL preserves UNKNOWN',{timeout:120000},async()=>{
 await t33WholeHttp(async({incidentId,dispatcherId,grants,get,post,pool,getLifecycleRows,setSenderOutcome,deliver,senderCalls})=>{
  const parent='/api/incidents/'+incidentId,detail=await get(parent),version=t33Text(detail.body.incident?t33Record(detail.body.incident).row_version:detail.body.row_version);
  const first=(await getLifecycleRows()).find(row=>row.audience_type==='GROUP');assert.ok(first);const deliveryId=t33Text(first.delivery_id),path=parent+'/notifications/'+deliveryId;
  const pending={client_command_id:randomUUID(),expected_row_version:version,expected_status:'PENDING',expected_side_effect_state:'NOT_ATTEMPTED',expected_delivery_attempt_count:0,reason_code:'OPERATOR_RETRY'};
  const noop=await post(path+'/retry',pending);assert.equal(noop.status,200,JSON.stringify(noop.body));assert.equal(noop.body.attempt_count,0);assert.equal(senderCalls(),0);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM communication.delivery_attempt WHERE delivery_id=$1::uuid',[deliveryId])).rows[0]?.count,0);
  setSenderOutcome('REJECTED_NOT_APPLIED');await deliver(deliveryId);let actual=(await getLifecycleRows()).find(row=>row.delivery_id===deliveryId);assert.equal(actual?.status,'DEAD_LETTER');assert.equal(actual.side_effect_state,'NOT_ATTEMPTED');assert.equal(actual.attempt_count,1);
  const retry={...pending,client_command_id:randomUUID(),expected_status:'DEAD_LETTER',expected_delivery_attempt_count:1},scheduled=await post(path+'/retry',retry);assert.equal(scheduled.status,200,JSON.stringify(scheduled.body));assert.equal(scheduled.body.status,'PENDING');assert.equal(scheduled.body.attempt_count,2);assert.equal(senderCalls(),1);
  assert.deepEqual((await post(path+'/retry',retry)).body,{...scheduled.body,replayed:true});
  setSenderOutcome('UNKNOWN');await deliver(deliveryId);actual=(await getLifecycleRows()).find(row=>row.delivery_id===deliveryId);assert.equal(actual?.status,'RECONCILIATION_REQUIRED');assert.equal(actual.side_effect_state,'UNKNOWN');assert.equal(actual.attempt_count,3);assert.equal(senderCalls(),2);
  grants.add(dispatcherId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE');assert.equal((await get(parent,1)).status,200);
  const reconcile={client_command_id:randomUUID(),expected_row_version:version,expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',expected_delivery_attempt_count:3,reason_code:'OPERATOR_CANCELLED',resolution:'CANCEL'};
  assert.equal((await post(path+'/reconcile',reconcile,1)).status,403);assert.equal((await get(path+'/control',1)).body.reconcile,false);
  assert.equal((await post(path+'/retry',{...pending,client_command_id:randomUUID(),expected_delivery_attempt_count:3})).status,409);
  const cancelled=await post(path+'/reconcile',reconcile);assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));assert.equal(cancelled.body.status,'CANCELLED');assert.equal(cancelled.body.side_effect_state,'UNKNOWN');assert.equal(cancelled.body.attempt_count,4);assert.equal(senderCalls(),2);
  assert.deepEqual((await post(path+'/reconcile',reconcile)).body,{...cancelled.body,replayed:true});
  const sibling=(await getLifecycleRows()).find(row=>row.delivery_id!==deliveryId);assert.ok(sibling);assert.equal(sibling.status,'PENDING');assert.equal(sibling.attempt_count,0);
 },{externalSend:true});
});

test('T33 competing explicit UNKNOWN conclusions have one winner and one conflict without another Sender call',{timeout:120000},async()=>{
 await t33WholeHttp(async({incidentId,get,post,getLifecycleRows,deliver,senderCalls,pool})=>{
  const first=(await getLifecycleRows()).find(row=>row.audience_type==='GROUP');assert.ok(first);const id=t33Text(first.delivery_id);await deliver(id);
  const detail=await get('/api/incidents/'+incidentId),version=t33Text(detail.body.incident?t33Record(detail.body.incident).row_version:detail.body.row_version);
  const body={expected_row_version:version,expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',expected_delivery_attempt_count:1,reason_code:'OPERATOR_VERIFIED_DELIVERY'};
  const replies=await Promise.all(['CONFIRMED_SENT','CANCEL'].map(resolution=>post('/api/incidents/'+incidentId+'/notifications/'+id+'/reconcile',{...body,client_command_id:randomUUID(),resolution})));
  assert.deepEqual(replies.map(value=>value.status).sort(),[200,409]);assert.equal(senderCalls(),1);
  const actual=(await getLifecycleRows()).find(row=>row.delivery_id===id);assert.ok(actual);assert.equal(actual.attempt_count,2);assert.ok(actual.status==='SENT'&&actual.side_effect_state==='ACKNOWLEDGED'||actual.status==='CANCELLED'&&actual.side_effect_state==='UNKNOWN');
  const receipts=(await pool.query<{state:string}>("SELECT state FROM incident.command_receipt WHERE incident_id=$1::uuid AND delivery_id=$2::uuid ORDER BY state",[incidentId,id])).rows;assert.deepEqual(receipts.map(row=>row.state),['COMMITTED','FAILED']);
 });
});

test('T33 current independent permission is rechecked after real receipt-row waits for GET and replay',{timeout:120000},async t=>{
 await t33WholeHttp(async({incidentId,adminId,grants,pool,get,post,getLifecycleRows,deliver,senderCalls})=>{
  const first=(await getLifecycleRows()).find(row=>row.audience_type==='GROUP');assert.ok(first);const id=t33Text(first.delivery_id);await deliver(id);
  const parent='/api/incidents/'+incidentId,detail=await get(parent),version=t33Text(detail.body.incident?t33Record(detail.body.incident).row_version:detail.body.row_version),body={client_command_id:randomUUID(),expected_row_version:version,expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',expected_delivery_attempt_count:1,reason_code:'OPERATOR_VERIFIED_DELIVERY',resolution:'CONFIRMED_SENT'},ack=await post(parent+'/notifications/'+id+'/reconcile',body);assert.equal(ack.status,200,JSON.stringify(ack.body));
  const database=(await pool.query<{name:string}>('SELECT current_database() AS name')).rows[0];assert.ok(database);assert.ok(process.env.PILOT_DATABASE_URL);const url=new URL(process.env.PILOT_DATABASE_URL);url.pathname='/'+database.name;
  const blocker=createPostgresPool({connectionString:url.toString(),max:1,application_name:'t33_owned_receipt_blocker'}),grant=adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE';
  try{for(const method of ['GET','POST']){
   const tx=await blocker.connect();let waiting:Promise<{status:number;body:Record<string,unknown>}>|null=null;
   try{
    await tx.query('BEGIN');const locked=await tx.query('SELECT id FROM incident.command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE',['P2_012:'+adminId,body.client_command_id]);assert.equal(locked.rows.length,1);
    waiting=method==='GET'?get(parent+'/notification-commands/'+body.client_command_id):post(parent+'/notifications/'+id+'/reconcile',body);
    let observed=false;for(let i=0;i<80&&!observed;i++){observed=(await pool.query<{present:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%incident.command_receipt%' AND pid<>pg_backend_pid()) AS present")).rows[0]?.present===true;if(!observed)await new Promise(resolve=>setTimeout(resolve,25));}
    assert.equal(observed,true,'the real HTTP request must wait on the original receipt row before revocation');grants.delete(grant);await tx.query('COMMIT');const result=await waiting;waiting=null;
    assert.equal(result.status,403,JSON.stringify(result.body));assert.equal(senderCalls(),1);t.diagnostic(JSON.stringify({method,actual_receipt_lock_wait:observed,after_permission_withdrawal_status:result.status,sender_calls:senderCalls()}));
   }finally{await tx.query('ROLLBACK').catch(()=>{});tx.release();if(waiting)await waiting.catch(()=>{});grants.add(grant);}
  }}finally{await blocker.end();}
  assert.equal((await get(parent+'/notification-commands/'+body.client_command_id)).body.state,'COMMITTED');assert.deepEqual((await post(parent+'/notifications/'+id+'/reconcile',body)).body,{...ack.body,replayed:true});assert.equal(senderCalls(),1);
 });
});

test('T33 explicit flag closure stops new POST while current authorized original UUID remains read only',{timeout:120000},async()=>{
 await t33WholeHttp(async({incidentId,adminId,grants,get,post,getLifecycleRows,deliver,senderCalls,restartControl,pool})=>{
  const first=(await getLifecycleRows()).find(row=>row.audience_type==='GROUP');assert.ok(first);const id=t33Text(first.delivery_id);await deliver(id);const parent='/api/incidents/'+incidentId,detail=await get(parent),version=t33Text(detail.body.incident?t33Record(detail.body.incident).row_version:detail.body.row_version),body={client_command_id:randomUUID(),expected_row_version:version,expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',expected_delivery_attempt_count:1,reason_code:'OPERATOR_VERIFIED_DELIVERY',resolution:'CONFIRMED_SENT'},ack=await post(parent+'/notifications/'+id+'/reconcile',body);assert.equal(ack.status,200);
  await restartControl(false);const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.body.incident_delivery_control_enabled,false);
  const cap=await get(parent+'/notifications/'+id+'/control');assert.equal(cap.status,200);assert.equal(cap.body.disabled,true);assert.equal(cap.body.reconcile,false);assert.equal(cap.body.retry,false);assert.equal(cap.body.receipt_read,true);
  assert.equal((await post(parent+'/notifications/'+id+'/reconcile',body)).status,503);
  const receipt=await get(parent+'/notification-commands/'+body.client_command_id);assert.equal(receipt.status,200);assert.deepEqual(receipt.body.result,ack.body);assert.equal(receipt.body.state,'COMMITTED');assert.equal(senderCalls(),1);
  grants.delete(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE');assert.equal((await get(parent+'/notification-commands/'+body.client_command_id)).status,403);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM incident.command_receipt WHERE incident_id=$1::uuid AND delivery_id=$2::uuid',[incidentId,id])).rows[0]?.count,1);
 });
});
