import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createP2012LiveCluster } from '../src/p2-012-live-cluster.mjs';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';

test('P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools',{timeout:120000},async t=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'p2012roles',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});const f=await fixtureP2012(pool,{reporters:2});await f.newCandidate();
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));
    const config={databaseUrl,identityHashKey:'synthetic-incident-identity-hmac-key',principalIds:[f.admin.id,f.dispatcher.id],listenPort,testAuthTtlMs:900000,
      reporterOrigin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],reporterHmacSecret:'synthetic-only-reporter-secret-at-least-32',botId:'bot-test',
      inboundScope:{bot_id:'bot-test',person_hashes:['synthetic-reporter-0','synthetic-reporter-1'].map(textHashP2016),group_hashes:[textHashP2016('synthetic-incident-group')]},allowedTargetHashes:[],secret:'synthetic-not-used',wsUrl:'wss://invalid.example.test'};
    const cluster=createP2012LiveCluster(config,{gatewayEnabled:false,senderEnabled:false});
    try{const started=await cluster.start();assert.equal((await fetch(started.origin+'/workbench/incidents')).status,200);
      const metrics=await cluster.metrics();t.diagnostic(JSON.stringify({network_enabled:false,metrics}));
    }finally{assert.equal((await cluster.stop()).process_count,0);}
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0].n,0);
  }});await assertNoP2012Residual({databaseUrl});
});
