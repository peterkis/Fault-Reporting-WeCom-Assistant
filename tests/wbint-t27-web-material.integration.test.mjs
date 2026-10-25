import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {migrateCurrentBaselineWithYxx} from '../app/server/scripts/migrate-current-baseline.mjs';
import {createYxxSelfServiceStore} from '../app/server/src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../app/server/src/yxx-self-service-orchestrator.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {generateIncidentCandidate} from '../app/server/src/p2-007-incident-candidate.mjs';
import {createP2012CandidateSourceAdapter,createP2012CandidateReviewStore} from '../app/server/src/p2-012-candidate-source-adapter.mjs';
import {createP2012IncidentQuery} from '../app/server/src/p2-012-incident-query.mjs';
import {createP2012IncidentCommandService} from '../app/server/src/p2-012-incident-command-service.mjs';
import {withP2012Database,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';

test('T27 real Web submit and supplement preserve original evidence while projecting only latest retained material',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'t27webbasis',run:async({pool,databaseUrl})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});
    const admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-t27-web-admin',displayName:'合成公共故障管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const scope={scopeHash:'a'.repeat(64),sourceCorpScope:'synthetic-t27-corp',sourceAppScope:'synthetic-t27-app',proofRef:'tests/t27-web-material'};
    const store=createYxxSelfServiceStore({pool,scopeSecret:'synthetic-t27-web-material-secret'}),orchestrator=createYxxSelfServiceOrchestrator({pool,profile:'MEMBER_SELF_SERVICE',featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}});
    const accepted=await store.accept({scope,kind:'SUBMIT',input:{schema_version:1,client_command_id:randomUUID(),description:'HIS系统无法登录',location:{unknown:true,text:null},service_code:'HIS',impact_scope:'MULTIPLE_USERS',reported_department_text:null,extension:null}});
    const original=await orchestrator.processOne({requestRef:accepted.receipt.request_ref});assert.equal(original.processed,true);
    const source=await createP2012CandidateSourceAdapter({pool,enabled:true}).record({sourceDecisionId:original.decision_id,reportDecisionIds:[original.decision_id],candidate:generateIncidentCandidate({authoritative_monitoring:true,service_family:'HIS',symptom_family:'LOGIN_FAILURE',reports:[]})});
    const candidate=await createP2012CandidateReviewStore({pool,enabled:true}).importDecision({decisionId:source.id});
    const query=createP2012IncidentQuery({pool,enabled:true}),commands=createP2012IncidentCommandService({pool,enabled:true}),authContext={principal_id:admin.id};
    const before=await query.detail({authContext,id:candidate.id,kind:'candidate'});assert.ok(before.materials.every(m=>m.status==='CURRENT'&&m.current_source_hash===m.original_source_hash));
    assert.equal((await commands.perform({authContext,command:{action:'START_REVIEW',candidate_review_id:candidate.id,client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'}})).ok,true);
    await store.accept({scope,kind:'SUPPLEMENT',requestRef:accepted.receipt.request_ref,input:{schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'同一报修追加：多台设备仍无法登录'}});
    const latest=await orchestrator.processOne({requestRef:accepted.receipt.request_ref});assert.equal(latest.processed,true);
    const latestDecision=(await pool.query('SELECT source_hash FROM intake.deterministic_decision WHERE id=$1::uuid',[latest.decision_id])).rows[0];
    const current=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.equal(current.row_version,'2');assert.equal(current.source_result_hash,before.source_result_hash);assert.notEqual(current.material_basis,before.material_basis);
    for(const material of current.materials){
      assert.equal(material.status,'CHANGED');assert.equal(material.original_revision,'1');assert.equal(material.current_revision,'2');
      assert.equal(material.original_source_hash,before.materials.find(m=>m.source_decision_id===material.source_decision_id).original_source_hash);
      assert.equal(material.current_source_hash,latestDecision.source_hash,'latest retained source hash must come from the same real Web submissions as the producer');
      assert.notEqual(material.current_source_hash,material.original_source_hash);
    }
    assert.deepEqual(current.allowed_actions,['REJECT_CANDIDATE']);
    const confirm={action:'CONFIRM_INCIDENT',candidate_review_id:candidate.id,client_command_id:randomUUID(),expected_candidate_version:'2',reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:admin.id,selected_report_refs:[original.decision_id]};
    assert.equal((await commands.perform({authContext,command:confirm})).error.code,'P2_012_SOURCE_CONFLICT');
    await pool.query('UPDATE intake.web_submission SET retention_until=platform.local_from_epoch_ms(received_epoch_ms+1),retention_until_epoch_ms=received_epoch_ms+1 WHERE intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)',[accepted.receipt.request_ref]);
    const expired=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.ok(expired.materials.every(m=>m.status==='EXPIRED'&&m.current_source_hash===null));
    assert.equal(expired.source_result_hash,before.source_result_hash);assert.equal(expired.row_version,'2');
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident')).rows[0].count,0);
    assert.equal((await pool.query('SELECT source_hash FROM intake.deterministic_decision WHERE id=$1::uuid',[original.decision_id])).rows[0].source_hash,before.materials.find(m=>m.source_decision_id===original.decision_id).original_source_hash);
  }});await assertNoP2012Residual({databaseUrl});
});
