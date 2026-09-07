import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateP2012,p2012ReadinessValid,p2012CompletionEvidenceValid,p2012FrozenInputsMatch,p2012ReviewPathsValid,p2012ReviewHardeningValid,p2012HttpOpenApiHardeningPathsValid,p2012HttpOpenApiHardeningEvidenceValid,p2012SubscriptionReviewPathsValid,p2012SubscriptionReviewEvidenceValid,p2012PausedReviewPathsValid,p2012PausedReviewEvidenceValid,p2012RefreshReviewPathsValid,p2012RefreshReviewEvidenceValid } from '../scripts/validate-p2-012-human-confirmed-incident.mjs';
import { checkP2012Live } from '../scripts/p2-012-live-check.mjs';
import { p2012LiveDuration } from '../scripts/p2-012-live-e2e.mjs';
import { P2012_LIVE_FUSES,readP2012LiveConfiguration } from '../src/p2-012-live-configuration.mjs';

test('P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures',async()=>{
  const path='/api/incidents/{incidentId}/subscriptions/{subscriptionId}/direct-destinations';
  for(const file of ['contracts/openapi.yaml','contracts/conversation_center.openapi.yaml']){
    const text=await readFile(file,'utf8');
    // Installed PyYAML parses the entire document; retain duplicate path keys
    // separately so a duplicate cannot disappear into the parsed mapping.
    const parsed=JSON.parse(execFileSync('python',['-c',
      'import sys,json,yaml; s=sys.stdin.buffer.read().decode("utf-8"); d=yaml.safe_load(s); n=yaml.compose(s); p=next(v for k,v in n.value if k.value=="paths"); print(json.dumps({"document":d,"paths":[k.value for k,v in p.value]}))'],{input:text,encoding:'utf8'}));
    assert.equal(parsed.paths.filter(p=>p===path).length,1);
    const get=parsed.document.paths[path].get;assert.ok(get);assert.equal(get.operationId,'listP2012SubscriptionDirectDestinations');
    assert.deepEqual(get.security,[{InternalSession:[]},{InternalBearer:[]}]);assert.deepEqual(get['x-roles'],['ADMIN']);
    assert.equal(parsed.document.components.securitySchemes.InternalSession.in,'cookie');
    assert.equal(parsed.document.components.securitySchemes.InternalBearer.scheme,'bearer');
    assert.equal(get['x-feature-flag'],'INCIDENT_CORRELATION_ENABLED');
    for(const name of ['incidentId','subscriptionId'])assert.deepEqual(get.parameters.find(p=>p.name===name),{in:'path',name,required:true,schema:{type:'string',format:'uuid'}});
    assert.deepEqual(get.parameters.find(p=>p.name==='limit').schema,{type:'integer',minimum:1,maximum:100,default:30});
    assert.deepEqual(get.parameters.find(p=>p.name==='cursor').schema,{type:'string',maxLength:2048});
    for(const status of [200,400,401,403,404,503])assert.deepEqual(Object.keys(get.responses[status]),['description']);
    assert.match(get.description,/empty 200/);assert.match(get.description,/PENDING_DESTINATION/);
    assert.ok(parsed.document.paths['/api/incidents/{incidentId}/direct-destinations'].get);
    for(const [route,item] of Object.entries(parsed.document.paths))if(/^\/api\/(incidents|incident-candidates)(\/|$)/u.test(route)&&item.post){
      assert.match(item.post.responses[503].description,/temporarily unavailable; business mutation was not committed/);
      for(const status of [400,403,404,409,503])assert.ok(item.post.responses[status]);
      assert.deepEqual(item.post.responses[409],{description:'Version, state or command conflict'});
    }
  }
  const ui=await readFile('web/p2-workbench/incidents.js','utf8'),query=await readFile('src/p2-012-incident-query.mjs','utf8');
  assert.ok(ui.includes("root+'/subscriptions/'+s.id+'/direct-destinations?limit=100'"));
  assert.ok(query.includes('subscriptions\\/([a-f0-9-]{36})\\/direct-destinations'));
});

test('P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate',async()=>{
  const r=await validateP2012({includeReadinessEvidence:false});assert.deepEqual(r.errors,[]);assert.ok(r.checks>=150);
  assert.equal(r.readiness_evidence_checked,false);await assert.rejects(validateP2012({includeReadinessEvidence:'false'}),/P2_012_VALIDATION_MODE_INVALID/u);
  const text=await readFile('tests/fixtures/p2-012/incident-scenarios.v1.jsonl','utf8'),manifest=JSON.parse(await readFile('tests/fixtures/p2-012/incident-scenarios-manifest.v1.json','utf8'));
  assert.equal(createHash('sha256').update(text).digest('hex'),manifest.sha256);assert.equal(text.trim().split('\n').length,13);
  for(const row of text.trim().split('\n').map(JSON.parse)){assert.equal(row.synthetic,true);assert.equal(row.automatic_incident,false);assert.equal(row.human_confirmation_required,true);assert.equal(row.model_calls,0);}
});

test('P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist',async()=>{
  for(let mask=0;mask<31;mask++){
    const env=Object.fromEntries(P2012_LIVE_FUSES.map((key,n)=>[key,mask&(1<<n)?'true':'false']));
    assert.throws(()=>readP2012LiveConfiguration(env),/P2_012_LIVE_APPROVAL_REQUIRED/u);
  }
  assert.throws(()=>readP2012LiveConfiguration(Object.fromEntries(P2012_LIVE_FUSES.map(k=>[k,'true']))),/P2_012_LIVE_CONFIGURATION_INVALID/u);
  const r=await checkP2012Live({});assert.equal(r.ok,false);assert.equal(r.network_started,false);assert.equal(r.listener_started,false);assert.equal(r.provider_calls,0);
  assert.equal(p2012LiveDuration(['--observe-seconds=900']),900000);assert.equal(p2012LiveDuration(['--observe-seconds=3600']),3600000);
  for(const args of [[],['--observe-seconds=899'],['--observe-seconds=3601'],['--observe-seconds=900','--run']])assert.throws(()=>p2012LiveDuration(args));
});

test('P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims',()=>{
  const hash='a'.repeat(64),good={status:'READY_FOR_TARGETED_LIVE_VALIDATION',all_automated_checks_passed:true,runtime_input_sha256:hash,live_validation:'NOT_RUN',second_commit_created:false,
    regression:{exit_code:0,pass:535,tests:535,fail:0,cancelled:0,skipped:0,todo:0},cleanup:{database_count:0,backend_count:0,child_count:0}};
  assert.equal(p2012ReadinessValid(good,hash),true);
  for(const patch of [{status:'DONE'},{all_automated_checks_passed:false},{runtime_input_sha256:'b'.repeat(64)},{live_validation:'PASSED'},{second_commit_created:true}])assert.equal(p2012ReadinessValid({...good,...patch},hash),false);
  for(const key of ['exit_code','fail','cancelled','skipped','todo'])assert.equal(p2012ReadinessValid({...good,regression:{...good.regression,[key]:1}},hash),false);
  assert.equal(p2012ReadinessValid({...good,regression:{...good.regression,pass:534}},hash),false);
  for(const key of ['database_count','backend_count','child_count'])assert.equal(p2012ReadinessValid({...good,cleanup:{...good.cleanup,[key]:1}},hash),false);
});

test('P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions',()=>{
  const liveHash='55b89664e18c761d31b073fc2e279991e8543507b99ef55080d2ed9f6e2e6740',hash='c'.repeat(64);
  const zero={fail:0,cancelled:0,skipped:0,todo:0};
  const completion={status:'DONE',runtime_input_sha256:hash,validated_live_candidate_sha256:liveHash,owner_approval:'APPROVED',
    closeout_regression:{status:'PASS',exit_code:0,tests:561,pass:561,...zero}};
  const live={status:'PASSED',runtime_input_sha256:liveHash,owner_approval:'APPROVED',observation:{observed_ms:900000},
    matrix:{incident_sent:10,incident_pending:0,incident_unknown:0,incident_dead_letter:0},
    non_incident_delivery_audit:{owner_explicitly_accepted:true},client_observations:{wecom_group_visible:'CONFIRMED_BY_PROJECT_OWNER',wecom_reporter_private_visible:'CONFIRMED_BY_PROJECT_OWNER'}};
  const postLive={status:'PASS',runtime_input_sha256:liveHash,exit_code:0,tests:559,pass:559,...zero,cleanup:{cleanup_passed:true}};
  const ownerText=`P2_012_TARGETED_LIVE_VALIDATION=APPROVED ${liveHash}`;
  const valid=input=>p2012CompletionEvidenceValid({completion,live,postLive,ownerText,hash,...input});
  assert.equal(valid({}),true);
  assert.equal(valid({live:{...live,status:'PENDING'}}),false);
  assert.equal(valid({live:{...live,matrix:{...live.matrix,incident_dead_letter:1}}}),false);
  assert.equal(valid({postLive:{...postLive,skipped:1}}),false);
  assert.equal(valid({completion:{...completion,owner_approval:'PENDING'}}),false);
});

test('P2-012 frozen candidate permits only the explicit closeout governance set',()=>{
  const before=[{path:'src/p2-012-incident-query.mjs',sha256:'a'.repeat(64)},{path:'scripts/validate-p2-012-human-confirmed-incident.mjs',sha256:'b'.repeat(64)}];
  assert.equal(p2012FrozenInputsMatch(before,[before[0],{...before[1],sha256:'c'.repeat(64)}]),true);
  assert.equal(p2012FrozenInputsMatch(before,[{...before[0],sha256:'d'.repeat(64)},before[1]]),false);
  assert.equal(p2012FrozenInputsMatch(before.slice(1),before),false);
});

test('P2-012 review hardening preserves exact paths and requires independent current regression evidence',()=>{
  assert.equal(p2012ReviewPathsValid(['src/p2-012-live-reporter-scope.mjs','scripts/p2-012-process-role.mjs']),true);
  for(const path of ['src/p2-012-incident-command-service.mjs','src/p2-015-rule-first-orchestrator.mjs',
    'database/migrations/032_p2_012_human_confirmed_incident.sql','evidence/p2-012-live-e2e.jsonl','plans/current_phase.json','.env.pilot']){
    assert.equal(p2012ReviewPathsValid([path]),false);
  }
  assert.equal(p2012ReviewPathsValid([]),false);
  const hash='f'.repeat(64),good={baseline_commit:'044ce68dce5422b377d27cbbb432e78f94797478',
    commit_subject:'fix(p2): require direct leg and expire due incident candidates',status:'PASS',runtime_input_sha256:hash,live_validation:'NOT_RUN',
    regression:{exit_code:0,tests:561,pass:561,fail:0,cancelled:0,skipped:0,todo:0},
    cleanup:{database_count:0,backend_count:0,child_count:0,listener_count:0,browser_profile_count:0}};
  assert.equal(p2012ReviewHardeningValid(good,hash),true);
  for(const patch of [{status:'VALIDATING'},{baseline_commit:'wrong'},{commit_subject:'wrong'},{runtime_input_sha256:'a'.repeat(64)},{live_validation:'PASSED'}]){
    assert.equal(p2012ReviewHardeningValid({...good,...patch},hash),false);
  }
  for(const key of ['exit_code','fail','cancelled','skipped','todo'])assert.equal(p2012ReviewHardeningValid({...good,regression:{...good.regression,[key]:1}},hash),false);
  assert.equal(p2012ReviewHardeningValid({...good,regression:{...good.regression,tests:560,pass:560}},hash),false);
  for(const key of Object.keys(good.cleanup))assert.equal(p2012ReviewHardeningValid({...good,cleanup:{...good.cleanup,[key]:1}},hash),false);
});

test('P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate',()=>{
  assert.equal(p2012HttpOpenApiHardeningPathsValid(['src/p2-012-domain-contracts.mjs','contracts/openapi.yaml']),true);
  for(const path of ['database/migrations/032_p2_012_human_confirmed_incident.sql','database/schema_draft.sql',
    'src/p2-012-incident-command-service.mjs','src/p2-012-notification-policy.mjs','src/p2-012-incident-query.mjs',
    'src/p2-012-workbench-assembly.mjs','src/p2-012-live-reporter-scope.mjs','src/p2-016-ticket-notification-projector.mjs',
    'src/p2-007-domain-utils.mjs','evidence/p2-012-pr-review-hardening.md','evidence/p2-012-project-owner-approval.md',
    'evidence/p2-012-targeted-live-validation.json','plans/current_phase.json'])assert.equal(p2012HttpOpenApiHardeningPathsValid([path]),false);
  assert.equal(p2012HttpOpenApiHardeningPathsValid([]),false);
  assert.equal(p2012HttpOpenApiHardeningPathsValid(['contracts/openapi.yaml','contracts/openapi.yaml']),false);
  const hash='a'.repeat(64),good={baseline_commit:'14557b9f6191a08434652550127f42360c97bffe',
    commit_subject:'fix(p2): preserve service errors and align destination OpenAPI',status:'PASS',runtime_input_sha256:hash,
    live_validation:'NOT_RUN',review_comment_ids:[3948007171,3948007180],
    regression:{exit_code:0,tests:566,pass:566,fail:0,cancelled:0,skipped:0,todo:0},
    cleanup:{database_count:0,backend_count:0,child_count:0,listener_count:0,browser_process_count:0,browser_profile_count:0}};
  assert.equal(p2012HttpOpenApiHardeningEvidenceValid(good,hash),true);
  for(const patch of [{baseline_commit:'wrong'},{commit_subject:'wrong'},{status:'VALIDATING'},{runtime_input_sha256:'b'.repeat(64)},
    {review_comment_ids:[3948007171]},{live_validation:'PASSED'}])assert.equal(p2012HttpOpenApiHardeningEvidenceValid({...good,...patch},hash),false);
  for(const key of ['exit_code','fail','cancelled','skipped','todo'])assert.equal(p2012HttpOpenApiHardeningEvidenceValid({...good,regression:{...good.regression,[key]:1}},hash),false);
  for(const patch of [{tests:565,pass:565},{pass:565},{tests:567}])assert.equal(p2012HttpOpenApiHardeningEvidenceValid({...good,regression:{...good.regression,...patch}},hash),false);
  for(const key of Object.keys(good.cleanup))assert.equal(p2012HttpOpenApiHardeningEvidenceValid({...good,cleanup:{...good.cleanup,[key]:1}},hash),false);
});


test('P2-012 subscription review preserves its baseline, scope and independent regression',()=>{
  assert.equal(p2012SubscriptionReviewPathsValid(['src/p2-012-incident-command-service.mjs']),true);
  for(const path of ['database/migrations/032_p2_012_human_confirmed_incident.sql','evidence/p2-012-pr-review-http-openapi-hardening.json','src/p2-012-live-reporter-scope.mjs','plans/current_phase.json'])assert.equal(p2012SubscriptionReviewPathsValid([path]),false);
  const hash='b'.repeat(64),good={baseline_commit:'21414a42ecc454a0079ab60801148acab0d7f247',commit_subject:'fix(p2): align subscription retention and client contracts',
    review_comment_ids:[3950900504,3950900513,3950900523,3950900528],status:'PASS',runtime_input_sha256:hash,live_validation:'NOT_RUN',
    regression:{tests:574,pass:574,exit_code:0,fail:0,cancelled:0,skipped:0,todo:0},
    cleanup:{database_count:0,backend_count:0,child_count:0,listener_count:0,browser_profile_count:0,browser_process_count:0}};
  assert.equal(p2012SubscriptionReviewEvidenceValid(good,hash),true);
  for(const patch of [{baseline_commit:'bad'},{status:'PENDING'},{live_validation:'PASSED'},{review_comment_ids:[]}])assert.equal(p2012SubscriptionReviewEvidenceValid({...good,...patch},hash),false);
  for(const key of ['fail','cancelled','skipped','todo','exit_code'])assert.equal(p2012SubscriptionReviewEvidenceValid({...good,regression:{...good.regression,[key]:1}},hash),false);
  for(const key of Object.keys(good.cleanup))assert.equal(p2012SubscriptionReviewEvidenceValid({...good,cleanup:{...good.cleanup,[key]:1}},hash),false);
});


test('P2-012 paused destination review is bounded and preserves previous full regression evidence',()=>{
  assert.equal(p2012PausedReviewPathsValid(['web/p2-workbench/incidents.js']),true);
  for(const path of ['src/p2-012-incident-command-service.mjs','database/migrations/032_p2_012_human_confirmed_incident.sql','evidence/p2-012-pr-review-subscription-contract-hardening.json'])assert.equal(p2012PausedReviewPathsValid([path]),false);
  const hash='c'.repeat(64),good={baseline_commit:'711269b8780e8edfad3011e78df5e2e6e986c9af',commit_subject:'fix(p2): replace paused subscription destinations',review_comment_id:3951285976,
    status:'PASS',runtime_input_sha256:hash,live_validation:'NOT_RUN',regression:{tests:575,pass:575,fail:0,cancelled:0,skipped:0,todo:0,exit_code:0},
    cleanup:{database_count:0,backend_count:0,child_count:0,listener_count:0,browser_process_count:0,browser_profile_count:0}};
  assert.equal(p2012PausedReviewEvidenceValid(good,hash),true);
  assert.equal(p2012PausedReviewEvidenceValid({...good,baseline_commit:'bad'},hash),false);
  for(const key of ['fail','cancelled','skipped','todo','exit_code'])assert.equal(p2012PausedReviewEvidenceValid({...good,regression:{...good.regression,[key]:1}},hash),false);
  for(const key of Object.keys(good.cleanup))assert.equal(p2012PausedReviewEvidenceValid({...good,cleanup:{...good.cleanup,[key]:1}},hash),false);
});

test('P2-012 reporter refresh review is bounded and preserves previous full regression evidence',()=>{
  assert.equal(p2012RefreshReviewPathsValid(['web/p2-reporter/reporter.js']),true);
  for(const path of ['src/p2-012-incident-command-service.mjs','database/migrations/032_p2_012_human_confirmed_incident.sql','evidence/p2-012-pr-review-subscription-contract-hardening.json'])assert.equal(p2012RefreshReviewPathsValid([path]),false);
  const hash='c'.repeat(64),good={baseline_commit:'724085ed09c07fdd3adbd0c998dd46794dca446a',commit_subject:'fix(p2): retry incomplete reporter refreshes',review_comment_id:3951493832,
    status:'PASS',runtime_input_sha256:hash,live_validation:'NOT_RUN',regression:{tests:577,pass:577,fail:0,cancelled:0,skipped:0,todo:0,exit_code:0},
    cleanup:{database_count:0,backend_count:0,child_count:0,listener_count:0,browser_process_count:0,browser_profile_count:0}};
  assert.equal(p2012RefreshReviewEvidenceValid(good,hash),true);
  assert.equal(p2012RefreshReviewEvidenceValid({...good,baseline_commit:'bad'},hash),false);
  for(const key of ['fail','cancelled','skipped','todo','exit_code'])assert.equal(p2012RefreshReviewEvidenceValid({...good,regression:{...good.regression,[key]:1}},hash),false);
  for(const key of Object.keys(good.cleanup))assert.equal(p2012RefreshReviewEvidenceValid({...good,cleanup:{...good.cleanup,[key]:1}},hash),false);
});
