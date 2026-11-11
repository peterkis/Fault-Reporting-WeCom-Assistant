import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {boardColumn} from '../app/server/src/web01-workbench-query.mjs';
import {sourceGroupNameCommand,sourceGroupSearch,sourceLabel} from '../app/server/src/workbench-source-groups.mjs';
import {createServiceCatalog,loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';
import {projectWorkbenchCatalog,projectWorkbenchService,projectWorkbenchClosure,workbenchCanRestore} from '../app/server/src/workbench-card-projections.mjs';
import type {ServiceEvidence,ClosureEvidence} from '../app/server/src/workbench-card-projections.mjs';

test('Card 27C-A Core and closure storage load in either entry order without eager circular state bindings',()=>{
  for(const module of ['service-closure-records','p1-006-ticket-state-actions']){
    const url=new URL('../app/server/src/'+module+'.mjs',import.meta.url).href;
    assert.equal(execFileSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(url)+');process.stdout.write("imported");'],{encoding:'utf8',windowsHide:true,timeout:10000}),'imported');
  }
});
test('WEB01 grouping preserves terminal meaning and rejects unknown states',()=>{
  for(const state of ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'])assert.equal(boardColumn(state),'pending');
  for(const state of ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'])assert.equal(boardColumn(state),'active');
  for(const state of ['COMPLETED','RESOLVED','DISMISSED'])assert.equal(boardColumn(state),'handled');
  assert.throws(()=>boardColumn('fabricated'),{code:'P2_016_INPUT_INVALID'});
});

test('Card 27A closure maps all six states and both proven sources without inventing reasons or restore paths',()=>{
  const at='2026-11-06 08:09:10';
  // ADR-0058: Ticket COMPLETED and Intake COMPLETED share one status; RESOLVED is completed too; every dismissal is DISMISSED.
  for(const status of ['RESOLVED','COMPLETED','DISMISSED'])for(const source of ['MANUAL','SYSTEM'] as const){
    const evidence:ClosureEvidence={record_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',source,reason_code:status==='DISMISSED'?'OTHER':'STAFF_COMPLETED',reason_note:'既有内部原因（合成）',ended_by_display_name:'操作人（合成）',ended_at:at};
    const closure=projectWorkbenchClosure(status,evidence,true);assert.ok(closure,status+' '+source);
    const completed=['RESOLVED','COMPLETED'].includes(status);
    assert.deepEqual(Object.keys(closure).sort(),['kind','source','reason_code','reason_label','reason_note','secondary_reason','ended_by_display_name','ended_at','duplicate_of','can_restore'].sort());
    assert.equal(closure.kind,completed?'COMPLETED':'DISMISSED');assert.equal(closure.source,source);assert.equal(closure.reason_code,completed?null:'OTHER','only the six persisted closure reasons describe dismissals');
    assert.equal(closure.reason_label,completed?'已完成':'其他');
    assert.equal(closure.reason_note,'既有内部原因（合成）');assert.equal(closure.ended_by_display_name,source==='MANUAL'?'操作人（合成）':null);assert.equal(closure.ended_at,at);
    assert.equal(closure.duplicate_of,null);assert.equal(closure.can_restore,true,'the projection passes through the caller-proven restore / reopen authority');
  }
  for(const status of ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'])assert.equal(projectWorkbenchClosure(status,null),null,status);
  assert.throws(()=>projectWorkbenchClosure('DISMISSED',null),{code:'P2_016_ACTION_FAILED'});
  const manual:ClosureEvidence={record_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',source:'MANUAL',reason_code:'NOT_IT_SCOPE',secondary_reason_code:'OUT_OF_SCOPE_CONFIRMED',reason_note:null,ended_by_display_name:'人工复核人（合成）',ended_at:at};
  assert.equal(projectWorkbenchClosure('DISMISSED',manual)?.reason_label,'非 IT 范围');assert.equal(projectWorkbenchClosure('DISMISSED',manual)?.reason_code,'NOT_IT_SCOPE');assert.deepEqual(projectWorkbenchClosure('DISMISSED',manual)?.secondary_reason,{code:'OUT_OF_SCOPE_CONFIRMED',label:'已核对为范围外诉求'});
  assert.equal(projectWorkbenchClosure('COMPLETED',{...manual,reason_code:'ACKNOWLEDGED'})?.reason_label,'确认收到');
  assert.equal(projectWorkbenchClosure('COMPLETED',{...manual,reason_code:'BUSINESS_CONSULTATION_CONFIRMED'})?.reason_label,'已核对为业务咨询');
  const blank=projectWorkbenchClosure('DISMISSED',{...manual,reason_note:' \n\t',ended_by_display_name:'  '});
  assert.equal(blank?.reason_note,null);assert.equal(blank?.ended_by_display_name,null);assert.equal(blank?.source,'MANUAL');
  assert.equal(projectWorkbenchClosure('DISMISSED',{...manual,reason_note:'  说明（合成）  '})?.reason_note,'  说明（合成）  ','nonblank original text is not trimmed');
  for(const [reason_code,reason_label] of Object.entries({HUMAN_CONFIRMED:'人工核对确认',INFORMATION_INSUFFICIENT:'描述不足，需要补充',SERVICE_REQUEST_CONFIRMED:'已核对为服务请求',INCIDENT_REVIEW_PENDING:'待公共故障审核',STALE_REVIEW_CANCELLED:'明确取消旧复核'})){
    const projected=projectWorkbenchClosure('DISMISSED',{...manual,secondary_reason_code:reason_code});assert.equal(projected?.reason_code,'NOT_IT_SCOPE');assert.equal(projected?.reason_label,'非 IT 范围');assert.deepEqual(projected?.secondary_reason,{code:reason_code,label:reason_label});
  }
  assert.throws(()=>projectWorkbenchClosure('DISMISSED',{...manual,ended_at:'2026-02-30 08:09:10'}),{code:'LOCAL_DATETIME_INVALID'});
});

test('Card 27A restore projection reuses the current Ticket action authority and never grants dismissed or Intake restoration',()=>{
  const principal={principal_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',display_name:'处理人（合成）',roles:['HANDLER'],team_ids:['PILOT_IT'],is_active:true};
  const evidence:ClosureEvidence={source:'MANUAL',reason_code:null,reason_note:null,ended_by_display_name:null,ended_at:null,resolver_team_id:'PILOT_IT',assignee_id:principal.principal_id};
  for(const status of ['RESOLVED','COMPLETED']){
    assert.equal(workbenchCanRestore('ticket',status,evidence,principal),true);
    assert.equal(workbenchCanRestore('ticket',status,{...evidence,assignee_id:null},principal),false);
    assert.equal(workbenchCanRestore('ticket',status,evidence,{...principal,team_ids:[]}),false);
    assert.equal(workbenchCanRestore('ticket',status,evidence,{...principal,is_active:false}),false);
    assert.equal(workbenchCanRestore('ticket',status,evidence,{...principal,roles:['ADMIN'],team_ids:[]}),true);
    assert.equal(workbenchCanRestore('ticket',status,null,principal),false);
  }
  for(const kind of ['ticket','intake'] as const){assert.equal(workbenchCanRestore(kind,'DISMISSED',{...evidence,record_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},principal),true,kind);assert.equal(workbenchCanRestore(kind,'DISMISSED',evidence,{...principal,roles:['ADMIN']}),false,'a missing record is never a restore basis');}
  assert.equal(workbenchCanRestore('intake','DISMISSED',{...evidence,record_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{...principal,roles:[]}),false);
  assert.equal(workbenchCanRestore('ticket','CLOSED',evidence,{...principal,roles:['ADMIN']}),false,'a retired, non-current Ticket status is never a restore basis');
  assert.equal(workbenchCanRestore('ticket','DISMISSED',{...evidence,record_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{...principal,team_ids:[]}),false,'READ through an old assignee is independent of current team write authority');
  assert.equal(workbenchCanRestore('intake','COMPLETED',evidence,{...principal,roles:['ADMIN']}),false);
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
