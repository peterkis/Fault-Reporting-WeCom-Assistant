import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createP2012IncidentCommandService} from '../src/p2-012-incident-command-service.mjs';
import {createP2012IncidentQuery} from '../src/p2-012-incident-query.mjs';
import {createP2012NotificationPolicy} from '../src/p2-012-notification-policy.mjs';
import {withP2012Database,applyThrough031,apply032Raw,fixtureP2012} from './helpers/p2-012-postgres-harness.mjs';

test('P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012subrev',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:4}),authContext={principal_id:f.admin.id};
    const query=createP2012IncidentQuery({pool,enabled:true}),commands=createP2012IncidentCommandService({pool,enabled:true,
      notifications:createP2012NotificationPolicy({enabled:true,privateEnabled:true})});
    const perform=command=>commands.perform({authContext,command:{client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',...command}});
    const candidate=await f.newCandidate();
    await perform({action:'START_REVIEW',candidate_review_id:candidate.id,expected_row_version:'1'});
    const confirmation=await perform({action:'CONFIRM_INCIDENT',candidate_review_id:candidate.id,expected_candidate_version:'2',confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.slice(0,2).map(r=>r.decisionId)});
    assert.equal(confirmation.ok,true);const id=confirmation.result_ref_id;
    const run=async(action,extra={})=>perform({action,incident_id:id,expected_row_version:(await query.detail({authContext,id})).row_version,...extra});
    const direct=(await pool.query("SELECT * FROM incident.reporter_subscription WHERE incident_id=$1 AND status='ACTIVE'",[id])).rows[0];
    await pool.query(`WITH clock AS(SELECT platform.physical_epoch_ms()-1000 AS expiry)
      UPDATE intake.contact_journey SET reported_at=LEAST(reported_at,platform.local_from_epoch_ms(clock.expiry)-interval '1 day'),retention_until_epoch_ms=clock.expiry,retention_until=platform.local_from_epoch_ms(clock.expiry)
      FROM clock WHERE id=(SELECT journey_id FROM intake.channel_leg WHERE id=$1)`,[direct.direct_channel_leg_id]);
    const messages=async()=>(await pool.query('SELECT count(*)::int AS n FROM communication.message')).rows[0].n;
    const before=await messages();assert.equal(before,1);
    assert.equal((await run('START_INVESTIGATING')).ok,true);assert.equal(await messages(),before,'expiry after activation cannot enqueue another private notification');
    await run('PAUSE_SUBSCRIPTION',{subscription_id:direct.id,expected_subscription_version:String(direct.row_version)});
    const rejected=await run('RESUME_SUBSCRIPTION',{subscription_id:direct.id,expected_subscription_version:'2',direct_channel_leg_id:direct.direct_channel_leg_id});
    assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'P2_012_DIRECT_DESTINATION_REQUIRED');
    assert.equal((await pool.query('SELECT status FROM incident.reporter_subscription WHERE id=$1',[direct.id])).rows[0].status,'PAUSED');
    assert.equal((await query.children({authContext,id,part:'subscriptions/'+direct.id+'/direct-destinations'})).items.length,0);
    const report=(await pool.query('SELECT id,row_version FROM incident.incident_report WHERE incident_id=$1 AND source_decision_id=$2',[id,f.reports[0].decisionId])).rows[0];
    assert.equal((await run('UNLINK_REPORT',{incident_report_id:report.id,expected_report_version:String(report.row_version)})).ok,true);
    const linked=await run('LINK_REPORT',{source_decision_id:f.reports[0].decisionId});assert.equal(linked.ok,true);
    const events=(await pool.query(`SELECT e.event_type,e.safe_payload FROM incident.incident_event e JOIN incident.command_receipt c ON c.id=e.source_command_id
      WHERE e.incident_id=$1 AND c.result_event_id=$2 AND e.safe_payload ? 'subscription_id'`,[id,linked.result_event_id])).rows;
    assert.equal(events.length,1);assert.equal(events[0].safe_payload.status,'PENDING_DESTINATION');
    assert.equal(events[0].event_type,'incident.subscription.created');
    const directReport=(await pool.query('SELECT id,row_version FROM incident.incident_report WHERE incident_id=$1 AND source_decision_id=$2',[id,f.reports[1].decisionId])).rows[0];
    assert.equal((await run('UNLINK_REPORT',{incident_report_id:directReport.id,expected_report_version:String(directReport.row_version)})).ok,true);
    assert.equal((await run('LINK_REPORT',{source_decision_id:f.reports[1].decisionId})).ok,true);
    assert.equal((await pool.query('SELECT status FROM incident.reporter_subscription WHERE id=$1',[direct.id])).rows[0].status,'PENDING_DESTINATION');
  }});
});
