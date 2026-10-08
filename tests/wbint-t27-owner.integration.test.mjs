import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createP2012IncidentQuery} from '../src/p2-012-incident-query.mjs';
import {createP2012IncidentCommandService} from '../src/p2-012-incident-command-service.mjs';
import {withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
const command=(action,id,version='1',extra={})=>({action,candidate_review_id:id,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});
test('T27 confirmation refuses a currently inactive owner group and keeps that original refusal durable',async()=>{
  await withP2012Database({databaseUrl,purpose:'t27owner',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:3}),query=createP2012IncidentQuery({pool,enabled:true}),service=createP2012IncidentCommandService({pool,enabled:true});
    const authContext={principal_id:f.admin.id},candidate=await f.newCandidate();
    assert.equal((await service.perform({authContext,command:command('START_REVIEW',candidate.id)})).ok,true);
    await pool.query("UPDATE pilot_ticket.resolver_team SET is_active=false WHERE team_id='PILOT_IT'");
    const original=command('CONFIRM_INCIDENT',candidate.id,'2',{confirmed_scope:'LOCAL',owner_principal_id:f.handler.id,owner_team_id:'PILOT_IT',selected_report_refs:[f.reports[0].decisionId],primary_ticket_id:null});
    const refused=await service.perform({authContext,command:original});
    assert.equal(refused.ok,false,'membership in an inactive group must not authorize Incident ownership');
    assert.equal(refused.error.code,'P2_012_OWNER_INVALID');
    assert.equal((await query.detail({authContext,id:candidate.id,kind:'candidate'})).row_version,'2');
    assert.equal((await query.list({authContext})).items.length,0);
    await pool.query("UPDATE pilot_ticket.resolver_team SET is_active=true WHERE team_id='PILOT_IT'");
    const replay=await service.perform({authContext,command:original});assert.equal(replay.ok,false);assert.equal(replay.replayed,true);assert.equal(replay.error.code,'P2_012_OWNER_INVALID');
    assert.equal((await query.list({authContext})).items.length,0);
    const result=await service.perform({authContext,command:{...original,client_command_id:randomUUID()}});assert.equal(result.ok,true,JSON.stringify(result));
    const incident=await query.detail({authContext,id:result.result_ref_id});assert.equal(incident.owner_team_id,'PILOT_IT');
  }});await assertNoP2012Residual({databaseUrl});
});
