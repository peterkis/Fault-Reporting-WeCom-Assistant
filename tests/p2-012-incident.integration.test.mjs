import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { createP2012IncidentQuery } from '../src/p2-012-incident-query.mjs';
import { createP2012NotificationPolicy } from '../src/p2-012-notification-policy.mjs';
import { withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
const command=(action,id,version='1',extra={})=>({action,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',
  ...(['START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT'].includes(action)?{candidate_review_id:id}:{incident_id:id}),
  ...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});

test('P2-012 real database human confirmation, idempotency, recovery isolation and notification facts',async()=>{
  assert.ok(databaseUrl,'database required');
  await withP2012Database({databaseUrl,purpose:'p2012core',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool),query=createP2012IncidentQuery({pool,enabled:true}),authContext={principal_id:f.admin.id};
    const notifications=createP2012NotificationPolicy({enabled:true,publicEnabled:true,privateEnabled:true});
    const service=createP2012IncidentCommandService({pool,enabled:true,query,notifications});
    const run=c=>service.perform({authContext,command:c});
    const c=await f.newCandidate();assert.equal((await f.newCandidate()).created,false);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM incident.incident')).rows[0].n,0);
    await assert.rejects(createP2012IncidentCommandService({pool}).perform({authContext,command:command('START_REVIEW',c.id)}),{code:'P2_012_DISABLED'});
    await assert.rejects(service.perform({authContext:{principal_id:f.handler.id},command:command('START_REVIEW',c.id)}),{code:'P2_012_FORBIDDEN'});
    assert.equal((await run(command('START_REVIEW',c.id))).ok,true);
    const confirm=command('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.map(r=>r.decisionId)});
    const results=await Promise.all(Array.from({length:12},()=>run(confirm)));
    assert.ok(results.every(r=>r.ok),JSON.stringify(results));assert.equal(results.filter(r=>!r.replayed).length,1);
    const id=results[0].result_ref_id;
    await assert.rejects(run({...confirm,confirmed_scope:'BUILDING'}),{code:'P2_012_COMMAND_CONFLICT'});
    const rows=async sql=>(await pool.query(sql)).rows;
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.incident'))[0].n,1);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.incident_report'))[0].n,10);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.reporter_subscription'))[0].n,10);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM communication.incident_notification_binding'))[0].n,6);
    assert.equal((await run(confirm)).replayed,true);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM communication.message'))[0].n,6);
    assert.equal((await query.list({authContext,kind:'candidate'})).items[0].status,'CONFIRMED');
    await assert.rejects(query.detail({authContext:{principal_id:f.outsider.id},id}),{code:'P2_012_NOT_FOUND'});
    assert.equal((await run(command('CLOSE_INCIDENT',id))).ok,false);
    assert.equal((await run(command('START_INVESTIGATING',id))).ok,true);
    let incident=await query.detail({authContext,id});assert.equal(incident.status,'INVESTIGATING');
    const reports=(await query.children({authContext,id,part:'reports'})).items;
    assert.equal((await run(command('MARK_REPORTER_RECOVERED',id,incident.row_version,{incident_report_id:reports[0].id,expected_report_version:reports[0].row_version}))).ok,true);
    incident=await query.detail({authContext,id});assert.equal(incident.status,'INVESTIGATING');
    const impact=await rows("SELECT impact_state,count(*)::integer AS n FROM incident.incident_report GROUP BY impact_state ORDER BY impact_state");
    assert.deepEqual(impact,[{impact_state:'IMPACTED',n:9},{impact_state:'RECOVERED',n:1}]);
    assert.equal((await rows("SELECT count(*)::integer AS n FROM pilot_ticket.ticket WHERE status='QUEUED'"))[0].n,10);
    assert.equal((await run(command('SET_PRIMARY_TICKET',id,incident.row_version,{primary_ticket_id:reports[1].ticket_id}))).ok,true);
    incident=await query.detail({authContext,id});
    assert.equal((await run(command('UNLINK_REPORT',id,incident.row_version,{incident_report_id:reports[1].id,expected_report_version:reports[1].row_version}))).error.code,'P2_012_PRIMARY_STILL_LINKED');
    assert.equal((await run(command('SET_PRIMARY_TICKET',id,incident.row_version,{primary_ticket_id:null}))).ok,true);
    incident=await query.detail({authContext,id});
    assert.equal((await run(command('UNLINK_REPORT',id,incident.row_version,{incident_report_id:reports[1].id,expected_report_version:reports[1].row_version}))).ok,true);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM pilot_ticket.ticket'))[0].n,10);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM intake.service_intake'))[0].n,10);
    for(const action of ['RESOLVE_INCIDENT','CLOSE_INCIDENT']){incident=await query.detail({authContext,id});assert.equal((await run(command(action,id,incident.row_version))).ok,true);}
    incident=await query.detail({authContext,id});assert.equal(incident.status,'CLOSED');
    assert.equal((await run(command('START_INVESTIGATING',id,incident.row_version))).ok,false);
    assert.equal((await rows("SELECT count(*)::integer AS n FROM pilot_ticket.ticket WHERE status='QUEUED'"))[0].n,10);
    const other=await f.newCandidate(1);assert.notEqual(other.id,c.id);
    assert.equal((await run(command('REJECT_CANDIDATE',other.id))).ok,true);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.incident'))[0].n,1);
  }});
  await assertNoP2012Residual({databaseUrl});
});
