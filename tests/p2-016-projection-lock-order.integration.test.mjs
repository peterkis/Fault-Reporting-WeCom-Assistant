import test from 'node:test';
import assert from 'node:assert/strict';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {createP2016RealtimeProjector} from '../src/p2-016-realtime-projector.mjs';
import {createP2G1InboundProjectionCoordinator} from '../src/p2-g1-inbound-projection-coordinator.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {P2016_TEST_FLAGS} from '../src/p2-016-live-configuration.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {migrateP2016} from '../scripts/p2-016-migrate.mjs';

test('PR8 actual App projection and rule-first Worker use one lock order without losing the earlier source', {timeout:30000},async t=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'pr8lock',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-pr8-lock',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    await seedPersistedIntake({pool,text:'电脑开不了机'});
    // Establish the real Session reference, while leaving source projection pending.
    await createP2G1InboundProjectionCoordinator({pool,enabled:true,projector:{projectBatch:async()=>({inserted_count:0,replayed_count:0})}}).runOnce();
    const workerLocked=Promise.withResolvers(),appRequestedStream=Promise.withResolvers(),releaseWorker=Promise.withResolvers();
    const sqlErrors=[];let held=false,appAttempted=false;
    function observedPool(role){
      const query=object=>async(...args)=>{
          const stream=String(args[0]).includes("hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0)");
          if(role==='APP'&&stream&&!appAttempted){appAttempted=true;appRequestedStream.resolve();}
          try{
            const value=await object.query(...args);
            if(role==='WORKER'&&stream&&!held){held=true;workerLocked.resolve();await releaseWorker.promise;}
            return value;
          }catch(error){sqlErrors.push({role,code:error.code??'UNKNOWN'});throw error;}
      };
      return {options:pool.options,query:query(pool),connect:async()=>{
        const client=await pool.connect();return {query:query(client),release:client.release.bind(client)};
      }};
    }
    const app=createP2016Runtime({pool:observedPool('APP'),flags:P2016_TEST_FLAGS,principalId:principal.id,
      publicOrigin:'http://127.0.0.1',reporterOrigin:'https://reporter.invalid',allowedHosts:['reporter.invalid'],
      reporterHmacSecret:'synthetic-pr8-reporter-hmac-secret-at-least-32'});
    const workerPool=observedPool('WORKER');
    const worker=createP2016OrchestrationWorker({pool:workerPool,identityHmacKey:'synthetic-pr8-identity-hmac',
      notifications:app.notifications,realtime:createP2016RealtimeProjector({pool:workerPool,enabled:true})});
    let work,projection;
    const timer=setTimeout(()=>{workerLocked.reject(Error('WORKER_BARRIER_TIMEOUT'));appRequestedStream.reject(Error('APP_BARRIER_TIMEOUT'));releaseWorker.resolve();},15000);
    try{
      work=worker.processDueBatch({feature_flags:{rule_first_orchestration_enabled:true,manual_review_queue_enabled:true},batch_size:20});
      await workerLocked.promise;
      projection=app.coordinator.runOnce();await appRequestedStream.promise;releaseWorker.resolve();
      const results=await Promise.allSettled([work,projection]);
      t.diagnostic(JSON.stringify({forced_worker_stream_then_app_stream:true,sql_errors:sqlErrors,results:results.map(r=>r.status)}));
      assert.deepEqual(sqlErrors,[],'the actual cross-process transaction pattern must not deadlock');
      assert.ok(results.every(r=>r.status==='fulfilled'));assert.equal(results[0].value.processed,1);assert.equal(results[1].value.failures,0);
      assert.equal((await app.coordinator.runOnce()).failures,0);assert.equal((await app.coordinator.backlog()).total,0);
      const items=(await pool.query('SELECT item_type FROM conversation.item ORDER BY sequence_no')).rows;
      assert.equal(items[0].item_type,'USER_MESSAGE');assert.ok(items.some(row=>row.item_type==='TICKET_EVENT'));
      const before=(await pool.query('SELECT count(*)::integer AS n FROM conversation.item')).rows[0].n;
      await worker.processDueBatch({feature_flags:{rule_first_orchestration_enabled:true,manual_review_queue_enabled:true},batch_size:20});
      assert.equal((await app.coordinator.runOnce()).failures,0);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM conversation.item')).rows[0].n,before);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    }finally{clearTimeout(timer);releaseWorker.resolve();await Promise.allSettled([work,projection].filter(Boolean));await app.stop();}
  }});
});
