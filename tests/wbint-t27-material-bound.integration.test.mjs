import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createP2012IncidentQuery} from '../app/server/src/p2-012-incident-query.mjs';
import {createP2012IncidentCommandService} from '../app/server/src/p2-012-incident-command-service.mjs';
import {withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';

test('T27 the maximum hundred Report choices retain a separate immutable root material basis',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'t27bound',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:100}),candidate=await f.newCandidate(),authContext={principal_id:f.admin.id};
    const query=createP2012IncidentQuery({pool,enabled:true}),commands=createP2012IncidentCommandService({pool,enabled:true});
    const detail=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.equal(detail.visible_report_source_count,100);assert.equal(detail.report_sources.length,100);assert.equal(detail.report_sources_truncated,false);
    assert.equal(detail.materials.length,101,'the derived root Decision is independent from its hundred Report references');assert.ok(detail.materials.every(m=>m.status==='CURRENT'));
    assert.equal((await commands.perform({authContext,command:{action:'START_REVIEW',candidate_review_id:candidate.id,client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'}})).ok,true);
    const current=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    const result=await commands.perform({authContext,command:{action:'CONFIRM_INCIDENT',candidate_review_id:candidate.id,client_command_id:randomUUID(),expected_candidate_version:'2',expected_material_basis:current.material_basis,reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:f.handler.id,owner_team_id:null,selected_report_refs:[f.reports[0].decisionId],primary_ticket_id:null}});
    assert.equal(result.ok,true);assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident_report')).rows[0].count,1);
  }});await assertNoP2012Residual({databaseUrl});
});
