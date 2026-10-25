import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer,IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {H5PerformanceSqlLedger,H5PerformanceMemberVerificationLedger,recordH5PerformanceProviderDelay,type H5PerformanceTrace,type PerformanceBatchContext,type PerformanceBatchTiming} from './helpers/yxx-h5-performance-observability.mjs';
import {createH5PerformanceHttpClient} from './yxx-h5-performance-harness.mjs';
import {createApplicationMemberVerifier,type ApplicationMemberVerificationEvent} from '../app/server/src/wecom-application-member.mjs';

function fixture(){
  let now=0,context:PerformanceBatchContext|undefined;
  const ledger=new H5PerformanceSqlLedger(()=>now),requests=[new IncomingMessage(new Socket()),new IncomingMessage(new Socket())];
  const ids=new WeakMap<IncomingMessage,string>(),timings=new WeakMap<IncomingMessage,PerformanceBatchTiming>();
  const traces=requests.map((request,index)=>{ids.set(request,'opaque-'+index);timings.set(request,{received_at_ms:0});const trace=ledger.createTrace('request-'+index,'/api/yixiaoxiu/h5/entry','home');ledger.bindRequest(request,trace);return trace;});
  ledger.setBatchReaders(()=>context,request=>timings.get(request),request=>ids.get(request));
  return {ledger,requests,traces,timings,setNow(value:number){now=value;},setContext(value:PerformanceBatchContext|undefined){context=value;},close(){for(const request of requests)request.socket.destroy();}};
}

test('shared physical SQL is counted once and linked to both requests, never charged to the first HTTP context',()=>{
  const f=fixture();try{
    const first=f.traces[0],second=f.traces[1],request0=f.requests[0],request1=f.requests[1];assert.ok(first&&second&&request0&&request1);
    f.setNow(10);const initial0=f.ledger.beginStatement({sha256:'proof',business_select:true,mode:'CONNECTED_CLIENT'},first);f.setNow(12);f.ledger.finishStatement(initial0);
    f.setNow(14);const initial1=f.ledger.beginStatement({sha256:'proof',business_select:true,mode:'CONNECTED_CLIENT'},second);f.setNow(16);f.ledger.finishStatement(initial1);
    f.setContext({batch_id:'batch-1',phase:'shared',participants:['opaque-0','opaque-1'],participant_timings:[{participant_id:'opaque-0',queued_at_ms:17,sealed_at_ms:30},{participant_id:'opaque-1',queued_at_ms:19,sealed_at_ms:30}]});
    f.setNow(30);const checkout=f.ledger.beginCheckout(first);f.setNow(35);f.ledger.finishCheckout(checkout);
    f.setNow(40);const shared=f.ledger.beginStatement({sha256:'shared',business_select:true,mode:'CONNECTED_CLIENT'},first);f.setNow(60);f.ledger.finishStatement(shared);f.setContext(undefined);
    f.setNow(70);const final0=f.ledger.beginStatement({sha256:'proof',business_select:true,mode:'CONNECTED_CLIENT'},first);f.setNow(72);f.ledger.finishStatement(final0);
    f.setNow(73);const final1=f.ledger.beginStatement({sha256:'proof',business_select:true,mode:'CONNECTED_CLIENT'},second);f.setNow(75);f.ledger.finishStatement(final1);
    f.timings.set(request0,{received_at_ms:0,queued_at_ms:17,sealed_at_ms:30,sql_started_at_ms:40,sql_finished_at_ms:60,terminal_started_at_ms:65,terminal_finished_at_ms:76,closed_at_ms:78,outcome:'committed'});
    f.timings.set(request1,{received_at_ms:0,queued_at_ms:19,sealed_at_ms:30,sql_started_at_ms:40,sql_finished_at_ms:60,terminal_started_at_ms:65,terminal_finished_at_ms:77,closed_at_ms:79,outcome:'committed'});
    f.setNow(80);f.ledger.finishTrace(request0,first,200);f.ledger.finishTrace(request1,second,200);
    const physical=f.ledger.snapshot();assert.equal(physical.statements.length,5);assert.equal(physical.statements.filter(statement=>statement.kind==='BATCH').length,1);assert.deepEqual(physical.integrity_errors,[]);
    assert.deepEqual(shared.request_keys,[first.trace_key,second.trace_key]);assert.deepEqual(shared.participant_ids,['opaque-0','opaque-1']);assert.equal(checkout.wait_ms,5);
    for(const trace of [first,second]){
      assert.equal(trace.business_selects,2);assert.equal(trace.sql_ms,4);assert.equal(trace.sql_shared_dependency_ms,20);assert.equal(trace.pool_wait_ms,0);assert.equal(trace.pool_wait_shared_dependency_ms,5);assert.equal(trace.pool_connections,0);
      const read=f.ledger.inspectRead(trace,'BATCHED_HOME_OR_DEPARTMENT');assert.equal(read.read_participations,3);assert.deepEqual(read.phases,{initial:1,shared:1,final:1,other:0});assert.deepEqual(read.integrity_errors,[]);
    }
    assert.equal(f.ledger.inspectRead(first,'BATCHED_HOME_OR_DEPARTMENT').batch_queue_ms,13);assert.equal(f.ledger.inspectRead(second,'BATCHED_HOME_OR_DEPARTMENT').batch_queue_ms,11);
    assert.equal(physical.statements.reduce((sum,statement)=>sum+statement.request_keys.length,0),6);
    const encoded=JSON.stringify(physical);assert.equal(encoded.includes('headers'),false);assert.equal(encoded.includes('IncomingMessage'),false);
  }finally{f.close();}
});

test('an unmapped, duplicate or mutated sealed participant remains an integrity failure',()=>{
  const f=fixture();try{
    const first=f.traces[0];assert.ok(first);const initial=f.ledger.beginStatement({sha256:'proof',business_select:true,mode:'CONNECTED_CLIENT'},first);f.ledger.finishStatement(initial);
    f.setContext({batch_id:'invalid-mapping',phase:'shared',participants:['opaque-0','missing','opaque-0'],participant_timings:[{participant_id:'opaque-0',queued_at_ms:0,sealed_at_ms:0}]});
    const invalid=f.ledger.beginStatement({sha256:'shared',business_select:true,mode:'CONNECTED_CLIENT'},first);f.ledger.finishStatement(invalid);
    f.setContext({batch_id:'invalid-mapping',phase:'shared',participants:[],participant_timings:[]});const changed=f.ledger.beginCheckout(first);f.ledger.finishCheckout(changed);
    const errors=f.ledger.snapshot().integrity_errors;assert.ok(errors.includes('UNMAPPED_BATCH_PARTICIPANT'));assert.ok(errors.includes('DUPLICATE_BATCH_PARTICIPANT'));assert.ok(errors.includes('MISSING_BATCH_PARTICIPANT_TIMING'));assert.ok(errors.includes('SEALED_BATCH_PARTICIPANTS_CHANGED'));assert.equal(first.business_selects,1);
  }finally{f.close();}
});

test('received-only lifecycle timing does not fabricate batch queue, outcome or dependencies',()=>{
  const f=fixture();try{const request=f.requests[0],trace=f.traces[0];assert.ok(request&&trace);f.setNow(20);f.ledger.finishTrace(request,trace,403);const read=f.ledger.inspectRead(trace,'UNCONSTRAINED');assert.deepEqual(trace.batch_timing,{received_at_ms:0});assert.equal(read.batch_queue_ms,null);assert.equal(trace.batch_timing?.outcome,undefined);assert.equal(read.read_participations,0);}finally{f.close();}
});

test('failed SQL and failed checkout remain visible and retain their actual safe error codes',()=>{
  const f=fixture();try{const trace=f.traces[0];assert.ok(trace);const checkout=f.ledger.beginCheckout(trace);f.setNow(7);f.ledger.finishCheckout(checkout,Object.assign(new Error('unavailable'),{code:'53300'}));const statement=f.ledger.beginStatement({sha256:'timed-out',business_select:true,mode:'CONNECTED_CLIENT'},trace);f.setNow(11);f.ledger.finishStatement(statement,Object.assign(new Error('timeout'),{code:'57014'}));const snapshot=f.ledger.snapshot();assert.equal(snapshot.statements[0]?.outcome,'FAILED');assert.equal(snapshot.statements[0]?.error_code,'57014');assert.equal(snapshot.pool_checkouts[0]?.outcome,'FAILED');assert.equal(snapshot.pool_checkouts[0]?.error_code,'53300');assert.equal(trace.pool_wait_ms,7);assert.equal(trace.sql_ms,4);assert.equal(trace.sql_errors[0]?.code,'57014');assert.deepEqual(snapshot.integrity_errors,[]);}finally{f.close();}
});

test('fixed 100 ms Provider delay records successful duration in its finally path',async()=>{
  const trace=new H5PerformanceSqlLedger().createTrace('provider','/provider');await recordH5PerformanceProviderDelay(trace);assert.equal(trace.provider_calls,1);assert.deepEqual(trace.provider_outcomes,{completed:1,aborted:0,error:0});assert.ok(trace.provider_ms>=90);
});

test('aborted Provider delay rejects and still records elapsed duration and abort outcome',async()=>{
  const trace=new H5PerformanceSqlLedger().createTrace('provider-abort','/provider'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10);
  try{await assert.rejects(recordH5PerformanceProviderDelay(trace,controller.signal),{name:'AbortError'});assert.equal(trace.provider_calls,1);assert.deepEqual(trace.provider_outcomes,{completed:0,aborted:1,error:0});assert.ok(trace.provider_ms>0);}finally{clearTimeout(timer);}
});

test('actual HTTP malformed JSON and non-object JSON reject the client promise without uncaught callbacks',{timeout:5000},async()=>{
  const bodies=['{broken','null','[]','true','42','"text"','{"csrf_token":"test-csrf","recovery_scope":"test-scope"}'];let index=0;
  const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'application/json'});response.end(bodies[index++]);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port,client=createH5PerformanceHttpClient(origin,()=>origin);
  try{for(let attempt=0;attempt<6;attempt++)await assert.rejects(client.send('/malformed'),{message:'H5_PERFORMANCE_HTTP_JSON_INVALID'});const response=await client.send('/object');assert.equal(response.status,200);assert.equal(client.recoveryScope,'test-scope');assert.equal(index,7);}
  finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('verification events bind only at QUEUED and separately preserve queue, actual active and shared counters',()=>{
  const sql=new H5PerformanceSqlLedger(),first=sql.createTrace('first','/api/yixiaoxiu/h5/entry'),other=sql.createTrace('other','/api/yixiaoxiu/h5/entry'),ledger=new H5PerformanceMemberVerificationLedger(),id=randomUUID();
  ledger.observe({operation_id:id,purpose:'H5_ENTRY',phase:'QUEUED',at_ms:10,queued_at_ms:10,active:0,base_active:0,pending:1},first);
  ledger.observe({operation_id:id,purpose:'H5_ENTRY',phase:'STARTED',at_ms:25,queued_at_ms:10,started_at_ms:25,active:1,base_active:0,pending:1},other);
  const event:ApplicationMemberVerificationEvent={operation_id:id,purpose:'H5_ENTRY',phase:'SETTLED',at_ms:140,queued_at_ms:10,started_at_ms:25,active:0,base_active:0,pending:0,outcome:'FULFILLED'};
  const withUnrequestedField={...event,unrequested_sensitive_field:'must-not-enter-evidence'};ledger.observe(withUnrequestedField,other);
  assert.equal(first.member_verifications.length,1);assert.equal(other.member_verifications.length,0);assert.equal(first.member_verifications[0]?.request_key,first.trace_key);
  const reading=ledger.inspectTrace(first,'H5_ENTRY');assert.equal(reading.operation_count,1);assert.equal(reading.queue_ms,15);assert.equal(reading.active_ms,115);assert.equal(reading.total_ms,130);assert.deepEqual(reading.integrity_errors,[]);
  const snapshot=ledger.snapshot();assert.deepEqual(snapshot.observed_max,{active:1,base_active:0,h5_entry_active:1,pending:1});assert.deepEqual(snapshot.final,{active:0,base_active:0,pending:0});assert.deepEqual(snapshot.integrity_errors,[]);assert.equal(JSON.stringify(snapshot).includes('unrequested_sensitive_field'),false);assert.equal(JSON.stringify(snapshot).includes('must-not-enter-evidence'),false);
});

test('queued cancellation has no fabricated STARTED timestamp and unfinished underlying work remains visible',()=>{
  const trace=new H5PerformanceSqlLedger().createTrace('cancelled','/api/yixiaoxiu/h5/entry'),ledger=new H5PerformanceMemberVerificationLedger(),id=randomUUID();
  ledger.observe({operation_id:id,purpose:'H5_ENTRY',phase:'QUEUED',at_ms:5,queued_at_ms:5,active:0,base_active:0,pending:1},trace);
  assert.ok(ledger.snapshot().integrity_errors.includes('UNSETTLED_VERIFICATION_OPERATION'));
  ledger.observe({operation_id:id,purpose:'H5_ENTRY',phase:'SETTLED',at_ms:20,queued_at_ms:5,started_at_ms:null,active:0,base_active:0,pending:0,outcome:'REJECTED'},undefined);
  const reading=ledger.inspectTrace(trace,'UNCONSTRAINED');assert.equal(reading.queue_ms,null);assert.equal(reading.active_ms,null);assert.equal(reading.total_ms,15);assert.deepEqual(ledger.snapshot().integrity_errors,[]);assert.ok(ledger.inspectTrace(trace,'H5_ENTRY').integrity_errors.includes('COMPLETED_H5_ENTRY_VERIFICATION_REQUIRED'));
});

test('verification observer rejects double-purpose capacity and unbound events instead of hiding them',()=>{
  const ledger=new H5PerformanceMemberVerificationLedger(),id=randomUUID();
  ledger.observe({operation_id:id,purpose:'BASE',phase:'QUEUED',at_ms:0,queued_at_ms:0,active:3,base_active:2,pending:33},undefined);
  const errors=ledger.snapshot().integrity_errors;assert.ok(errors.includes('VERIFICATION_SHARED_CAP_EXCEEDED'));assert.ok(errors.includes('UNBOUND_VERIFICATION_QUEUED'));assert.ok(errors.includes('VERIFICATION_EVENT_COUNTER_MISMATCH'));
  const old=new H5PerformanceMemberVerificationLedger(false),trace=new H5PerformanceSqlLedger().createTrace('old-baseline','/legacy');assert.equal(old.inspectTrace(trace,'UNCONSTRAINED').status,'NOT_RUN');assert.deepEqual(old.snapshot().integrity_errors,[]);
});

test('four actual shared-purpose verifications keep each fetch and event with its own HTTP context',{timeout:10000},async()=>{
  const contexts=new AsyncLocalStorage<H5PerformanceTrace>(),ledger=new H5PerformanceMemberVerificationLedger(),sql=new H5PerformanceSqlLedger(),traces=Array.from({length:4},(_,index)=>sql.createTrace('slot-'+index,'/api/yixiaoxiu/h5/entry'));
  const gates:{release():void}[]=[],fetches:{userid:string|null;trace_id:string|null}[]=[];let active=0,maximum=0;
  const fetchImpl:typeof fetch=async input=>{const url=new URL(input instanceof Request?input.url:String(input));fetches.push({userid:url.searchParams.get('userid'),trace_id:contexts.getStore()?.id??null});active++;maximum=Math.max(maximum,active);try{await new Promise<void>(resolve=>gates.push({release:resolve}));return new Response(JSON.stringify({errcode:0,userid:url.searchParams.get('userid'),status:1,enable:1}),{headers:{'content-type':'application/json'}});}finally{active--;}};
  const verifier=createApplicationMemberVerifier({accessTokenProvider:async()=>'SYNTHETIC_OBSERVABILITY_TOKEN',fetchImpl,h5EntryReadEnabled:true,observe:event=>ledger.observe(event,contexts.getStore())});
  const work=traces.map((trace,index)=>contexts.run(trace,()=>verifier.h5EntryRead('test-member-'+index)));
  const until=async(count:number)=>{const deadline=performance.now()+1000;while(gates.length<count){assert.ok(performance.now()<deadline,'the bounded scheduler must start the next real lookup');await nextTurn();}};
  try{
    await until(2);assert.equal(active,2);gates[0]?.release();await until(3);gates[1]?.release();await until(4);gates[2]?.release();gates[3]?.release();const values=await Promise.all(work);assert.ok(values.every(Boolean));assert.equal(maximum,2);
    assert.deepEqual(fetches,[0,1,2,3].map(index=>({userid:'test-member-'+index,trace_id:'slot-'+index})));
    for(const trace of traces){const reading=ledger.inspectTrace(trace,'H5_ENTRY');assert.equal(reading.operation_count,1);assert.deepEqual(reading.integrity_errors,[]);}
    const snapshot=ledger.snapshot();assert.equal(snapshot.operations.length,4);assert.equal(snapshot.observed_max.active,2);assert.equal(snapshot.observed_max.h5_entry_active,2);assert.equal(snapshot.observed_max.base_active,0);assert.equal(snapshot.observed_max.pending,4);assert.deepEqual(snapshot.integrity_errors,[]);
  }finally{for(const gate of gates)gate.release();await Promise.allSettled(work);}
});
