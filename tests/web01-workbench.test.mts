import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardColumn} from '../app/server/src/web01-workbench-query.mjs';
import {sourceGroupNameCommand,sourceGroupSearch,sourceLabel} from '../app/server/src/workbench-source-groups.mjs';
import {createServiceCatalog,loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';
import {projectWorkbenchCatalog,projectWorkbenchService} from '../app/server/src/workbench-card-projections.mjs';
import type {ServiceEvidence} from '../app/server/src/workbench-card-projections.mjs';
test('WEB01 grouping preserves terminal meaning and rejects unknown states',()=>{
  for(const state of ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'])assert.equal(boardColumn(state),'pending');
  for(const state of ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'])assert.equal(boardColumn(state),'active');
  for(const state of ['CLOSED','RESOLVED','CANCELLED','DUPLICATE_LINKED'])assert.equal(boardColumn(state),'closed');
  assert.throws(()=>boardColumn('fabricated'),{code:'P2_016_INPUT_INVALID'});
});

test('Card 11 service evidence preserves source priority without promoting a classification',()=>{
  const catalog=loadServiceCatalog(),code=catalog.listServices()[0]?.service_code;assert.ok(code);
  const principal='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fact={field_path:'service.selected_service_code',normalized_value:code,status:'ACTIVE',assertion:'AFFIRMED',source_kind:'DETERMINISTIC_RULE',source_ref:'intake:synthetic'};
  const rule:ServiceEvidence={explicit_code:null,current:true,decision_status:'RECORDED',resolved_by:null,safe_result:{known_fields:{selected_service_code:code},fact_provenance:[fact],conflicts:[]}};
  assert.equal(projectWorkbenchService([rule],catalog)?.source,'RULE_DETERMINISTIC');
  const explicit={...rule,explicit_code:code};assert.equal(projectWorkbenchService([explicit],catalog)?.source,'REPORTER_EXPLICIT');
  const classified={...explicit,decision_status:'HUMAN_OVERRIDDEN',resolved_by:principal,safe_result:{...rule.safe_result as object,human_override:{principal_id:principal}}};
  assert.equal(projectWorkbenchService([classified],catalog)?.source,'REPORTER_EXPLICIT','confirming fault is not confirming service');
  // Synthetic existing-format human fact; production currently has no service-confirmation writer.
  const human={...classified,safe_result:{known_fields:{selected_service_code:code},conflicts:[],human_override:{principal_id:principal},fact_provenance:[{...fact,source_kind:'HUMAN_OPERATOR_CONFIRMED',source_ref:'principal:'+principal}]}};
  assert.equal(projectWorkbenchService([human],catalog)?.source,'MANUAL_CONFIRMED');
  const prior=catalog.listServices()[1]?.service_code;assert.ok(prior);
  const retired={...fact,normalized_value:prior,status:'SUPERSEDED',source_kind:'REPORTER_EXPLICIT'};
  const replaced={...human,explicit_code:prior,safe_result:{...human.safe_result,fact_provenance:[...human.safe_result.fact_provenance,retired]}};
  assert.equal(projectWorkbenchService([replaced],catalog)?.source,'MANUAL_CONFIRMED','retired initial selection cannot veto explicit service confirmation');
  const rejected={...rule,explicit_code:prior,safe_result:{known_fields:{selected_service_code:null},conflicts:[],fact_provenance:[{...retired,status:'REJECTED'}]}};
  assert.equal(projectWorkbenchService([rejected],catalog),null,'rejected explicit choice cannot resurrect');
  const initial:ServiceEvidence={explicit_code:prior,safe_result:null,current:true,decision_status:null,resolved_by:null,journey_id:'same-journey'};
  const later={...replaced,explicit_code:null,journey_id:'same-journey'};
  assert.equal(projectWorkbenchService([initial,later],catalog)?.source,'MANUAL_CONFIRMED','retirement follows the Journey across Intake rows');
  assert.equal(projectWorkbenchService([initial,{...rejected,explicit_code:null,journey_id:'same-journey'}],catalog),null);
  assert.equal(projectWorkbenchService([initial,{...later,journey_id:'another-journey'}],catalog),null,'another Journey cannot retire this explicit choice');


  assert.equal(projectWorkbenchService([{...human,resolved_by:randomPrincipal()}],catalog),null,'wrong actor cannot confirm a service');
  function randomPrincipal(){return 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';}
});

test('Card 11 refuses conflicting, stale, inherited, disabled and absent service facts',()=>{
  const catalog=loadServiceCatalog(),services=catalog.listServices(),code=services[0]?.service_code,other=services[1]?.service_code;assert.ok(code&&other);
  const fact={field_path:'service.selected_service_code',normalized_value:code,status:'ACTIVE',assertion:'AFFIRMED',source_kind:'DETERMINISTIC_RULE'};
  const result={known_fields:{selected_service_code:code},fact_provenance:[fact],conflicts:[]};
  const row:ServiceEvidence={explicit_code:null,current:true,decision_status:'RECORDED',resolved_by:null,safe_result:result};
  assert.equal(projectWorkbenchService([],catalog),null);assert.equal(projectWorkbenchService([row],null),null);
  assert.equal(projectWorkbenchService([{...row,current:false}],catalog),null);
  assert.equal(projectWorkbenchService([{...row,explicit_code:other}],catalog),null);
  assert.equal(projectWorkbenchService([{...row,safe_result:{...result,conflicts:[{field_path:'service.selected_service_code'}]}}],catalog),null);
  for(const change of [{status:'CONFLICTED'},{status:'SUPERSEDED'},{status:'REJECTED'},{assertion:'UNCERTAIN'},{source_kind:'CONTEXT_INHERITANCE'}]){
    assert.equal(projectWorkbenchService([{...row,safe_result:{...result,fact_provenance:[{...fact,...change}]}}],catalog),null);
  }
  assert.equal(projectWorkbenchService([{...row,safe_result:{...result,fact_provenance:[]}}],catalog),null);
  const raw=structuredClone(catalog.raw);const first=raw.domains[0]?.services[0];assert.ok(first);first.enabled=false;
  assert.equal(projectWorkbenchService([row],createServiceCatalog(raw)),null);
  assert.equal(projectWorkbenchService([{...row,explicit_code:'UNKNOWN.SERVICE',safe_result:null}],catalog),null);
  assert.equal(projectWorkbenchService([{...row,safe_result:{known_fields:{selected_service_code:null},fact_provenance:[],conflicts:[]}}],catalog),null);
});

test('Card 11 directory is a bounded whitelist with enabled services only',()=>{
  const catalog=loadServiceCatalog(),value=projectWorkbenchCatalog(catalog);
  assert.deepEqual(Object.keys(value).sort(),['catalog_version','categories','schema_version']);
  assert.equal(value.categories.length,11);
  for(const group of value.categories){assert.deepEqual(Object.keys(group).sort(),['category','category_name_zh','services']);for(const service of group.services)assert.deepEqual(Object.keys(service).sort(),['name_zh','service_code']);}
  assert.throws(()=>projectWorkbenchCatalog(null),{code:'P2_016_ACTION_FAILED'});
  const raw=structuredClone(catalog.raw);for(const group of raw.domains)for(const service of group.services)service.enabled=false;
  assert.deepEqual(projectWorkbenchCatalog(createServiceCatalog(raw)).categories,[]);
  assert.throws(()=>projectWorkbenchCatalog(createServiceCatalog({...catalog.raw,catalog_version:'x'.repeat(65)})),{code:'P2_016_ACTION_FAILED'});
});
test('source group directory search accepts bounded Unicode and literal punctuation but rejects injected control input',()=>{
  assert.equal(sourceGroupSearch(' 信息科_% '),'信息科_%');
  assert.equal(sourceGroupSearch(null),'');assert.equal(sourceGroupSearch('   '),'');
  assert.equal(sourceGroupSearch('😀'.repeat(128)),'😀'.repeat(128));
  for(const value of ['😀'.repeat(129),'x\n','\t name',42,{}])assert.throws(()=>sourceGroupSearch(value),{code:'P2_016_INPUT_INVALID'});
});
test('source group naming validates bounded text and decimal versions without losing precision',()=>{
  const command={client_command_id:'b5533980-45b3-49d5-9843-5c9ddcda132a',expected_row_version:'9007199254740993',display_name:' 信息科支持群 '};
  assert.equal(sourceGroupNameCommand(command).expected_row_version,'9007199254740993');
  assert.equal(sourceGroupNameCommand(command).display_name,'信息科支持群');
  for(const display_name of ['', ' '.repeat(2),'a'.repeat(129),'不可\n换行'])assert.throws(()=>sourceGroupNameCommand({...command,display_name}),{code:'P2_016_INPUT_INVALID'});
  for(const expected_row_version of ['-1','01',1,'9223372036854775807'])assert.throws(()=>sourceGroupNameCommand({...command,expected_row_version}),{code:'P2_016_INPUT_INVALID'});
  assert.throws(()=>sourceGroupNameCommand({...command,chatid:'client-injected'}),{code:'P2_016_INPUT_INVALID'});
  assert.equal(sourceLabel('WECOM_GROUP'),'群聊报修 · 群名称未登记');
  assert.equal(sourceLabel('WECOM_GROUP','信息科支持群'),'群聊报修 · 信息科支持群');
  assert.equal(sourceLabel('WECOM_DIRECT'),'企业微信私聊');
});
