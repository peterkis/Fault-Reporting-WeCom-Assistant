import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016RealtimeProjector } from '../src/p2-016-realtime-projector.mjs';
import { createP2016ManualReviewFacade } from '../src/p2-016-manual-review-facade.mjs';
import { createP2016TicketQuery } from '../src/p2-016-ticket-query.mjs';
import { createP2016WeComSender } from '../src/p2-016-wecom-sender.mjs';
import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import { createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016Runtime } from '../src/p2-016-runtime.mjs';
import { transactionP2016,textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { seedCapacityDataset } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
test('P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE',{timeout:300000},async t=>{
  const samples=[process.memoryUsage().heapUsed];const sample=()=>samples.push(process.memoryUsage().heapUsed);
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016cap',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});await seedCapacityDataset({pool,tag:'p2016cap'});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-capacity-admin',displayName:'合成容量测试坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const authContext={principal_id:principal.id},key='synthetic-only-capacity-reporter-key-32bytes';
    const access=createP2016ReporterAccess({pool,enabled:true,hmacSecret:key});
    const notifications=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:access});
    const realtime=createP2016RealtimeProjector({pool,enabled:true}),base=createRuleEngine();
    const worker=createP2016OrchestrationWorker({pool,identityHmacKey:'synthetic-capacity-identity-key',notifications,realtime,
      ruleEngine:{catalog_version:base.catalog_version,rule_set_version:base.rule_set_version,evaluate(input){
        if(/需人工判断|系统不行/u.test(input.text))throw new Error('synthetic review');return base.evaluate(input);
      }}});
    for(let i=0;i<5;i++){assert.equal((await worker.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:100})).processed,100);sample();}
    const reviews=createP2016ManualReviewFacade({pool,enabled:true,notificationProjector:notifications,realtimeProjector:realtime});
    let resolved=0;
    for(let page=0;page<2;page++){
      const list=await reviews.listManualReviews({authContext,limit:100});assert.equal(list.items.length,100);
      for(const review of list.items){const result=await reviews.resolveManualReview({authContext,reviewId:review.id,body:{
        client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'CAPACITY_SYNTHETIC'}});assert.equal(result.ok,true);resolved++;}
      sample();
    }
    assert.equal((await reviews.listManualReviews({authContext})).items.length,0);
    const tickets=(await pool.query('SELECT id::text,version FROM pilot_ticket.ticket ORDER BY ticket_no')).rows;assert.equal(tickets.length,500);
    const actions=createTicketActionService();
    for(let i=0;i<tickets.length;i++){
      const ticket=tickets[i];await transactionP2016(pool,async tx=>{
        for(let n=0;n<9;n++)await actions.performInTransaction({ticketId:ticket.id,expectedVersion:ticket.version+n,action:'add-note',
          actor:{type:'SYSTEM',id:null},note:'合成内部记录',externalVisible:false,traceId:'p2016-capacity-note'},tx);
      });if(i%50===49)sample();
    }
    const eventCount=(await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event')).rows[0].n;assert.equal(eventCount,5000);
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM (SELECT ticket_id,count(*) AS n,max(event_ordinal) AS last FROM pilot_ticket.ticket_event GROUP BY ticket_id) e WHERE n<>10 OR last<>10`)).rows[0].n,0);
    const targets=Array.from({length:500},(_,i)=>['user-cap-'+(i+1),'group-cap-'+(i+1)]).flat().map(textHashP2016);
    let cards=0,receipts=0;
    const sender=createP2016WeComSender({enabled:true,cardEnabled:true,allowedTargetHashes:targets,reporterAccess:access,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],
      gateway:{getAuthenticatedClient:()=>({sendMessage:async(_target,body)=>{if(body.msgtype==='template_card')cards++;else receipts++;return {errcode:0};}})}});
    const delivery=createCommunicationDeliveryWorker({pool,sender,enabled:true,batchSize:20});let delivered=0;
    for(let i=0;i<46;i++){const run=await delivery.runOnce();delivered+=run.processed;if(!run.processed)break;if(i%5===4)sample();}
    assert.equal(cards,500);assert.equal(receipts,400);assert.equal(delivered,900);
    const first100=(await pool.query("SELECT delivery_id::text FROM communication.ticket_notification_binding WHERE destination_type='PERSON' ORDER BY created_at,id LIMIT 100")).rows;
    for(const row of first100){const grant=await access.deliveryGrant({deliveryId:row.delivery_id});const session=await access.exchange(grant.token);assert.equal((await access.authenticate(session.sessionToken)).public_ref,session.public_ref);}
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.reporter_access_session WHERE state='ACTIVE'")).rows[0].n,100);sample();
    const query=createP2016TicketQuery({pool,enabled:true});let cursor=null,seen=0;
    do{const page=await query.list({authContext,state:'queued',cursor,limit:100});assert.ok(page.items.length<=100);seen+=page.items.length;cursor=page.next_cursor;}while(cursor);
    assert.equal(seen,500);assert.equal((await query.events({authContext,ticketId:tickets[0].id,limit:200})).items.length,10);
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+listenPort;
    const runtime=createP2016Runtime({pool,principalId:principal.id,publicOrigin:origin,listenPort,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}}),streams=[];
    try{
      const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      for(let i=0;i<32;i++){const controller=new AbortController();const response=await fetch(origin+'/api/realtime/events',{headers:{cookie},signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader(),stream={controller,reader,bytes:0,endedUnexpectedly:false,error:null};
        // Capacity clients consume replay like EventSource; a non-reader tests the separate slow-client policy.
        stream.draining=(async()=>{try{for(;;){const part=await reader.read();if(part.done){if(!controller.signal.aborted)stream.endedUnexpectedly=true;break;}stream.bytes+=part.value.byteLength;}}catch(e){if(!controller.signal.aborted)stream.error=e.name;}})();streams.push(stream);}
      const rejected=await fetch(origin+'/api/realtime/events',{headers:{cookie}});assert.equal(rejected.status,503);assert.equal((await rejected.json()).fallback.reason,'CAPACITY_REACHED');
      const metrics=await runtime.observability.metrics();assert.equal(metrics.sse_clients,32);assert.ok(metrics.pool_total<=4);sample();
    }finally{for(const s of streams){s.controller.abort();await s.reader.cancel().catch(()=>{});await s.draining;}await runtime.stop();}
    assert.ok(streams.every(s=>!s.endedUnexpectedly&&!s.error),JSON.stringify(streams.map(s=>({ended:s.endedUnexpectedly,error:s.error,bytes:s.bytes}))));
    assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);assert.equal(pool.options.max,4);
    global.gc?.();sample();const peak=Math.max(...samples),last=samples.at(-1),tail=samples.slice(-4),stable=peak-last>0||Math.max(...tail)-Math.min(...tail)<16*1024*1024;
    assert.ok(peak<256*1024*1024);assert.ok(stable);
    t.diagnostic(JSON.stringify({tickets:500,ticket_events:eventCount,review_resolutions:resolved,cards,group_receipts:receipts,reporter_sessions:100,
      pool_max:pool.options.max,sse_max:32,sse_after_stop:0,heap_samples_bytes:samples,heap_peak_bytes:peak,heap_final_bytes:last,heap_fall_or_stable:stable,real_sdk_calls:0,soak_24h:false}));
  }});
  const residual=await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});t.diagnostic(JSON.stringify({cleanup:residual}));
});
