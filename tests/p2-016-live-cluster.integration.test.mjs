import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016LiveCluster } from '../src/p2-016-live-cluster.mjs';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { assertP2016DatabaseScope } from '../scripts/p2-016-live-check.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';

test('P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls', {timeout:90000},async t=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016live',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const principals=[];for(const n of ['a','b'])principals.push(await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-live-'+n,displayName:'合成坐席'+n,roles:['ADMIN'],resolverTeamIds:['PILOT_IT']}));
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
    const c={databaseUrl,identityHashKey:'synthetic-live-identity-hmac',principalIds:principals.map(p=>p.id),listenPort:port,
      reporterOrigin:'https://reporter.invalid',reporterHmacSecret:'synthetic-live-reporter-secret-0001',allowedHosts:['reporter.invalid'],
      allowedTargetHashes:[textHashP2016('synthetic-user'),textHashP2016('synthetic-group')],botId:'synthetic-bot',
      inboundScope:{person_hashes:[textHashP2016('synthetic-user')],group_hashes:[textHashP2016('synthetic-group')]}};
    await assertP2016DatabaseScope(pool,c);
    await seedPersistedIntake({pool,text:'电脑开不了机'});
    await assert.rejects(()=>assertP2016DatabaseScope(pool,c),/P2_016_DEDICATED_APPROVED_DATABASE_REQUIRED/u);
    // Synthetic test intentionally uses a private DB and disabled network; live preflight would reject the foreign fixture above.
    const cluster=createP2016LiveCluster(c);
    try{
      const started=await cluster.start();assert.equal(started.process_count,3);assert.equal(started.cookies.length,2);
      assert.equal(started.readiness.base_service_ready,true);assert.equal(started.readiness.ai_enhancement_ready,false);
      const deadline=Date.now()+12000;let count=0;
      while(Date.now()<deadline){count=(await pool.query('SELECT count(*)::integer n FROM pilot_ticket.ticket')).rows[0].n;if(count===1)break;await new Promise(r=>setTimeout(r,100));}
      assert.equal(count,1,'separate rule-first worker creates the Ticket');
      const metrics=await cluster.metrics();assert.equal(metrics.app_pool_max+metrics.worker_pool_max+metrics.gateway_pool_max,7);
      assert.equal(metrics.gateway_authenticated,0);assert.ok(metrics.worker_active_timers>=1);
      const cookie=started.cookies[0].name+'='+started.cookies[0].value;
      assert.equal((await fetch(started.origin+'/api/tickets',{headers:{cookie}})).status,200);
      assert.equal((await fetch(started.origin+'/workbench/lifecycle')).status,200);
      assert.equal((await pool.query("SELECT count(*)::integer n FROM communication.delivery WHERE status='SENT'")).rows[0].n,0);
      t.diagnostic(JSON.stringify({process_count:3,pool_max:7,live_provider_calls:0,rule_first_worker:true}));
    }finally{assert.equal((await cluster.stop()).process_count,0);}
    assert.equal((await pool.query("SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0].n,0);
  }});
});
