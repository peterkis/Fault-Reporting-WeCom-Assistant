import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2012LiveCluster } from '../src/p2-012-live-cluster.mjs';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';

test('P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools',{timeout:120000},async t=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'p2012roles',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});const f=await fixtureP2012(pool,{reporters:2});const candidate=await f.newCandidate();
    await pool.query(`WITH clock AS MATERIALIZED(SELECT platform.physical_epoch_ms()-1000 AS expiry)
      UPDATE incident.candidate_review SET created_at=platform.local_now()-interval '2 days',expires_epoch_ms=clock.expiry,
        expires_at=platform.local_from_epoch_ms(clock.expiry) FROM clock WHERE id=$1::uuid`,[candidate.id]);
    const group=await seedPersistedIntake({pool,text:'【p2-012测试】处方提交不了'});
    await pool.query("UPDATE intake.service_intake SET source_chat_id='synthetic-incident-group',reporter_wecom_userid='synthetic-reporter-0' WHERE id=$1::uuid",[group.intakeId]);
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));
    const config={databaseUrl,identityHashKey:'synthetic-incident-identity-hmac-key',principalIds:[f.admin.id,f.dispatcher.id],listenPort,testAuthTtlMs:900000,
      reporterOrigin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],reporterHmacSecret:'synthetic-only-reporter-secret-at-least-32',botId:'bot-test',
      inboundScope:{bot_id:'bot-test',person_hashes:['synthetic-reporter-0','synthetic-reporter-1'].map(textHashP2016),group_hashes:[textHashP2016('synthetic-incident-group')]},allowedTargetHashes:[],secret:'synthetic-not-used',wsUrl:'wss://invalid.example.test'};
    for(let iteration=0;iteration<2;iteration++){
      const cluster=createP2012LiveCluster(config,{gatewayEnabled:false,senderEnabled:false});
      try{const started=await cluster.start();assert.equal((await fetch(started.origin+'/workbench/incidents')).status,200);
        let ready=false;
        for(let attempt=0;attempt<200;attempt++){
          const result=(await pool.query(`SELECT c.status='EXPIRED' AND EXISTS(SELECT 1 FROM pilot_ticket.ticket WHERE source_intake_id=$2::uuid) AS ready
            FROM incident.candidate_review c WHERE c.id=$1::uuid`,[candidate.id,group.intakeId])).rows[0];
          if(result.ready){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,25));
        }
        assert.equal(ready,true);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.incident_event WHERE event_type='candidate.expired'")).rows[0].n,1);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.command_receipt WHERE state='COMMITTED' AND command_type='EXPIRE_CANDIDATE'")).rows[0].n,1);
        const cookie=started.cookies[0].name+'='+started.cookies[0].value,origin=started.origin;
        const get=path=>fetch(origin+path,{headers:{cookie}});
        const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();
        const detail=await (await get('/api/incident-candidates/'+candidate.id)).json();assert.equal(detail.status,'EXPIRED');assert.equal(detail.row_version,'2');
        const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,
          'idempotency-key':body.client_command_id,'if-match':'"'+(body.expected_row_version??body.expected_version)+'"'},body:JSON.stringify(body)});
        assert.equal((await post('/api/incident-candidates/'+candidate.id+'/expire',{client_command_id:randomUUID(),expected_row_version:'2',reason_code:'MAINTENANCE_EXPIRED'})).status,404);
        if(iteration===0){
          const ticket=(await pool.query('SELECT id FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[group.intakeId])).rows[0];
          const current=await (await get('/api/tickets/'+ticket.id)).json();
          const accepted=await post('/api/tickets/'+ticket.id+'/accept',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'SYNTHETIC_REVIEW'});
          assert.equal(accepted.status,200);
        }
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM communication.delivery WHERE target_type='PERSON'")).rows[0].n,0,'both worker creation and app action suppress PERSON');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM communication.ticket_notification_binding WHERE destination_type='GROUP'")).rows[0].n,1);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.reporter_access_grant')).rows[0].n,0);
        const metrics=await cluster.metrics();assert.equal(metrics.dead_letter,0);t.diagnostic(JSON.stringify({network_enabled:false,restarted:iteration===1,metrics}));
      }finally{assert.equal((await cluster.stop()).process_count,0);}
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0].n,0);
  }});await assertNoP2012Residual({databaseUrl});
});
