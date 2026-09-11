import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { withP2012Database, applyThrough031, fixtureP2012 } from './helpers/p2-012-postgres-harness.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { launchSystemBrowser,closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

test('G2-I05/I06/I07 synthetic retention fault: HTTP expiry, wrong Reporter and stale RESUME reject; ENDED relink renders PENDING without activation',async t=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'g2subhttp',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    // Mechanism fixture explicitly seeds normal prerequisites; not recognition evidence.
    const f=await fixtureP2012(pool,{reporters:4}),candidate=await f.newCandidate();
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true}});
    let browser,primaryError=null;
    try{
      const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      const get=async p=>{const response=await fetch(origin+p,{headers:{cookie}});assert.equal(response.status,200);return response.json();};
      const bootstrap=await get('/api/lifecycle/bootstrap');
      const post=async(p,body)=>{body={client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',...body};
        const response=await fetch(origin+p,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,
          'if-match':'"'+(body.expected_candidate_version??body.expected_row_version)+'"','idempotency-key':body.client_command_id},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};};
      assert.equal((await post('/api/incident-candidates/'+candidate.id+'/start-review',{expected_row_version:'1'})).status,200);
      const confirmed=await post('/api/incident-candidates/'+candidate.id+'/confirm',{expected_candidate_version:'2',confirmed_scope:'LOCAL',
        owner_principal_id:f.admin.id,selected_report_refs:f.reports.slice(0,2).map(r=>r.decisionId)});
      assert.equal(confirmed.status,200);const id=confirmed.body.result_ref_id,root='/api/incidents/'+id;
      const act=async(suffix,extra={})=>post(root+suffix,{expected_row_version:(await get(root)).row_version,...extra});
      const sub=(await pool.query("SELECT id,direct_channel_leg_id,row_version::text FROM incident.reporter_subscription WHERE status='ACTIVE'")).rows[0];
      assert.ok(sub);assert.equal((await act('/subscriptions/'+sub.id+'/pause',{expected_subscription_version:sub.row_version})).status,200);
      const snapshot=async()=>({subscriptions:(await pool.query('SELECT id,status,row_version::text,direct_channel_leg_id FROM incident.reporter_subscription ORDER BY id')).rows,
        messages:(await pool.query('SELECT count(*)::integer AS n FROM communication.message')).rows[0].n});
      const before=await snapshot();
      for(const [version,leg,error] of [['2',f.reports[3].legId,'P2_012_DIRECT_DESTINATION_REQUIRED'],['1',sub.direct_channel_leg_id,'P2_012_VERSION_CONFLICT']]){
        const rejected=await act('/subscriptions/'+sub.id+'/resume',{expected_subscription_version:version,direct_channel_leg_id:leg});
        assert.equal(rejected.status,409);assert.equal(rejected.body.error.code,error);assert.deepEqual(await snapshot(),before);
      }
      assert.equal((await act('/subscriptions/'+sub.id+'/resume',{expected_subscription_version:'2',direct_channel_leg_id:sub.direct_channel_leg_id})).status,200);
      await pool.query(`WITH clock AS(SELECT platform.physical_epoch_ms()-1000 AS expiry)
        UPDATE intake.contact_journey SET reported_at=LEAST(reported_at,platform.local_from_epoch_ms(clock.expiry)-interval '1 day'),
          retention_until_epoch_ms=clock.expiry,retention_until=platform.local_from_epoch_ms(clock.expiry)
        FROM clock WHERE id IN (SELECT journey_id FROM intake.channel_leg WHERE id=ANY($1::uuid[]))`,[[sub.direct_channel_leg_id,f.reports[3].legId]]);
      assert.equal((await act('/start-investigating')).status,200);
      assert.equal((await snapshot()).messages,before.messages,'actual HTTP status notification suppresses a destination expired after activation');
      assert.equal((await act('/subscriptions/'+sub.id+'/pause',{expected_subscription_version:'3'})).status,200);
      const beforeExpired=await snapshot();
      assert.equal((await get(root+'/subscriptions/'+sub.id+'/direct-destinations')).items.length,0);
      const expired=await act('/subscriptions/'+sub.id+'/resume',{expected_subscription_version:'4',direct_channel_leg_id:sub.direct_channel_leg_id});
      assert.equal(expired.status,409);assert.equal(expired.body.error.code,'P2_012_DIRECT_DESTINATION_REQUIRED');assert.deepEqual(await snapshot(),beforeExpired);
      assert.equal((await act('/reports/link',{source_decision_id:f.reports[3].decisionId})).status,200);
      const firstLink=(await pool.query('SELECT s.status,s.direct_channel_leg_id FROM incident.reporter_subscription s JOIN incident.incident_report r ON r.id=s.representative_report_id WHERE r.source_decision_id=$1',[f.reports[3].decisionId])).rows[0];
      assert.deepEqual(firstLink,{status:'PENDING_DESTINATION',direct_channel_leg_id:null});
      assert.equal((await snapshot()).messages,before.messages,'first association cannot activate an expired destination');
      const report=(await pool.query('SELECT id,row_version::text FROM incident.incident_report WHERE source_decision_id=$1',[f.reports[1].decisionId])).rows[0];
      assert.equal((await act('/reports/'+report.id+'/unlink',{expected_report_version:report.row_version})).status,200);
      assert.equal((await pool.query('SELECT status FROM incident.reporter_subscription WHERE id=$1',[sub.id])).rows[0].status,'ENDED');
      const relink=await act('/reports/link',{source_decision_id:f.reports[1].decisionId});assert.equal(relink.status,200);
      assert.equal((await pool.query('SELECT status FROM incident.reporter_subscription WHERE id=$1',[sub.id])).rows[0].status,'PENDING_DESTINATION');
      assert.equal((await snapshot()).messages,before.messages);
      const event=(await pool.query(`SELECT event_type,safe_payload FROM incident.incident_event WHERE source_command_id=(
        SELECT id FROM incident.command_receipt WHERE result_event_id=$1) AND safe_payload ? 'subscription_id'`,[relink.body.result_event_id])).rows;
      assert.ok(event.some(e=>e.event_type==='incident.subscription.created'&&e.safe_payload.status==='PENDING_DESTINATION'));
      assert.ok(!event.some(e=>e.event_type==='incident.subscription.activated'));
      browser=await launchSystemBrowser({url:origin+'/workbench/incidents#mode=active&selected='+id,width:1440,height:1000,cookies:[started.cookie]});
      await browser.waitFor("document.querySelector('#detail')?.textContent.includes('等待可靠单聊渠道')");
      assert.equal(await browser.evaluate("document.querySelector('#detail').textContent.includes('接收通知')"),false);
      t.diagnostic(JSON.stringify({scenario_ids:['G2-I05','G2-I06','G2-I07'],surface:'SYNTHETIC_RETENTION_REAL_HTTP_DB_BROWSER',
        wrong_reporter_and_stale_resume_rejected:true,expired_destination_excluded:true,relink_pending_without_activation:true,notification_delta:0}));
    }catch(error){primaryError=error;}finally{await closeBrowserTestResources([()=>browser?.close(),()=>runtime.stop()],primaryError);}
  }});
});
