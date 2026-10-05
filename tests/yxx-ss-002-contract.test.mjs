import {sourceFile} from './helpers/migration-roots.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routes=[
  ['GET','/api/yixiaoxiu/service-catalog','yxxSelfServiceCatalog'],
  ['GET','/api/yixiaoxiu/bootstrap','yxxSelfServiceBootstrap'],
  ['POST','/api/yixiaoxiu/requests','yxxCreateRequest'],
  ['GET','/api/yixiaoxiu/my-reports','yxxListMyReports'],
  ['GET','/api/yixiaoxiu/requests/{request_ref}','yxxGetRequest'],
  ['GET','/api/yixiaoxiu/requests/{request_ref}/timeline','yxxGetRequestTimeline'],
  ['POST','/api/yixiaoxiu/requests/{request_ref}/supplements','yxxSupplementRequest'],
  ['GET','/api/yixiaoxiu/commands/{client_command_id}','yxxGetMyCommand'],
];

test('SS-002 closed schemas reject identity and operational authority fields',async()=>{
  const input=JSON.parse(await readFile('contracts/yxx_self_service_request.schema.json','utf8'));
  const supplement=JSON.parse(await readFile('contracts/yxx_self_service_supplement.schema.json','utf8'));
  const detail=JSON.parse(await readFile('contracts/yxx_self_service_request_detail.schema.json','utf8'));
  const timeline=JSON.parse(await readFile('contracts/yxx_self_service_timeline.schema.json','utf8'));
  const profile=JSON.parse(await readFile('contracts/yxx_self_service_profile.schema.json','utf8'));
  assert.equal(input.additionalProperties,false);assert.equal(supplement.additionalProperties,false);
  assert.equal(detail.additionalProperties,false);assert.equal(timeline.additionalProperties,false);
  assert.equal(detail.properties.ticket.anyOf[0].$ref,'./yxx_self_service_ticket_summary.schema.json');
  assert.equal(timeline.properties.items.items.additionalProperties,false);
  assert.equal(profile.additionalProperties,false);assert.deepEqual(profile.properties.profile.enum,['OAUTH_ONLY','MEMBER_TICKET_READONLY','MEMBER_SELF_SERVICE','FULL_SERVICE_LOOP']);
  assert.equal(profile.properties['x-readonly-write-denied'].const,true);
  assert.ok(profile.required.includes('x-readonly-write-denied'));
  assert.equal(profile.properties.YIXIAOXIU_SELF_SERVICE_ENABLED.default,false);assert.equal(profile.properties.YIXIAOXIU_MY_REPORTS_ENABLED.default,false);
  const selfBranch=JSON.stringify(profile.allOf.find(v=>JSON.stringify(v).includes('MEMBER_SELF_SERVICE')));
  assert.match(selfBranch,/APP_BOUNDED_PUMP/u);
  const writeBranch=profile.allOf.find(v=>v.if.properties.web_write?.const===true);
  assert.equal(writeBranch.then.properties.YIXIAOXIU_SELF_SERVICE_ENABLED.const,true);
  assert.equal(writeBranch.then.properties.YIXIAOXIU_MY_REPORTS_ENABLED.const,true);
  const oauthOnlyBranch=JSON.stringify(profile.allOf.find(v=>JSON.stringify(v).includes('OAUTH_ONLY')));
  assert.match(oauthOnlyBranch,/write_flag.*const.*false/u);assert.match(oauthOnlyBranch,/YIXIAOXIU_SELF_SERVICE_ENABLED.*const.*false/u);assert.match(oauthOnlyBranch,/YIXIAOXIU_MY_REPORTS_ENABLED.*const.*false/u);
  assert.ok(JSON.parse(await readFile('contracts/yxx_self_service_report_page.schema.json','utf8')).properties.items.items.required.includes('ticket'));
  assert.equal(JSON.parse(await readFile('contracts/yxx_self_service_report_page.schema.json','utf8')).properties.items.items.properties.ref.pattern,'^[A-Za-z0-9_-]{32}$');
  const report=JSON.parse(await readFile('contracts/yxx_self_service_report_page.schema.json','utf8')).properties.items.items;
  assert.deepEqual(report.properties.safe_summary.type,['string','null']);
  assert.equal(report.properties.safe_summary.maxLength,120);
  assert.equal(report.properties.safe_location.maxLength,80);
  assert.equal(report.allOf[0].if.properties.kind.const,'BOT_TICKET');
  assert.equal(report.allOf[0].then.properties.safe_summary.type,'null');
  assert.equal(report.allOf[0].then.properties.safe_location.type,'null');
  assert.ok(timeline.properties.items.items.required.includes('ticket'));
  for(const key of ['reporter','role','provider','target','ticket_id','status','priority','actor','created_at','accepted_at'])assert.equal(Object.hasOwn(input.properties,key),false,key);
  assert.deepEqual(input.properties.impact_scope.enum,['UNKNOWN','SELF','SINGLE_WORKSTATION','MULTIPLE_USERS','DEPARTMENT']);
  assert.equal(input.properties.description.maxLength,4000);assert.equal(supplement.properties.text.maxLength,2000);
  assert.equal(input.properties.service_code.maxLength,64);
  const servicePattern=new RegExp(input.properties.service_code.pattern,'u');
  assert.equal(servicePattern.test('CLINICAL.OUTPATIENT_WORKSTATION'),true);
  assert.equal(servicePattern.test('PRINTING'),true);
  assert.equal(servicePattern.test('CLINICAL..BAD'),false);
  const catalog=JSON.parse(await readFile('contracts/yxx_self_service_service_catalog.schema.json','utf8'));
  assert.equal(catalog.additionalProperties,false);
  assert.equal(catalog.properties.services.maxItems,200);
  assert.equal(catalog.properties.services.items.additionalProperties,false);
  assert.deepEqual(Object.keys(catalog.properties.services.items.properties).sort(),['category','category_name_zh','name_zh','service_code']);
  assert.equal(catalog.properties.services.items.properties.name_zh.maxLength,80);
});

test('SS-002 both OpenAPI documents expose the same eight YXX operation references',async()=>{
  const [root,conversation,contract]=await Promise.all([
    readFile('contracts/openapi.yaml','utf8'),readFile('contracts/conversation_center.openapi.yaml','utf8'),readFile('contracts/yxx_self_service.openapi.yaml','utf8')
  ]);
  for(const [method,path,operation] of routes){
    assert.match(contract,new RegExp('operationId: '+operation+'\\b','u'));
    assert.match(root,new RegExp(path.replaceAll(/[{}]/gu,'\\$&'),'u'));
    assert.match(conversation,new RegExp(path.replaceAll(/[{}]/gu,'\\$&'),'u'));
    assert.match(contract,new RegExp('\\n    '+method.toLowerCase()+':','u'));
  }
  assert.match(contract,/WeComMember:/u);assert.match(contract,/['"]202['"]:/u);assert.match(contract,/['"]409['"]:/u);assert.match(contract,/['"]304['"]:/u);
  assert.match(contract,/additionalProperties: false/u);assert.match(contract,/yxx_self_service_timeline\.schema\.json/u);
  assert.match(contract,/x-idempotency-body-header-equality/u);assert.match(contract,/x-mutually-exclusive-with/u);
  assert.match(contract,/name: auth_return/u);assert.match(contract,/['"]303['"]:/u);
  assert.match(contract,/name: cursor, schema: \{type: string, minLength: 10, maxLength: 2048\}/u);
  assert.match(conversation,/\/api\/yixiaoxiu\/bootstrap:\s+\$ref:/u);
  const homepage=contract.slice(contract.indexOf('/wecom/yixiaoxiu/:'));assert.match(homepage,/security: \[\{\}, \{WeComMember: \[\]\}\]/u);
  const bootstrap=contract.slice(contract.indexOf('/api/yixiaoxiu/bootstrap'));assert.match(bootstrap,/security: \[\{WeComMember: \[\]\}\]/u);
});

test('SS-002 catalog plan keeps migration 033 conditional and Web APP_ONLY',async()=>{
  const plan=JSON.parse(await readFile(sourceFile('docs/runbooks/yixiaoxiu-self-service-catalog-plan.json'),'utf8'));
  assert.equal(plan.migration,'033_yxx_self_service_intake.sql');
  assert.deepEqual(plan.new_tables,['intake.web_request_binding','intake.web_submission','intake.web_command_receipt']);
  assert.ok(plan.shared_tables['intake.service_intake'].alter.includes('primary_web_submission_id UUID'));
  assert.equal(plan.shared_tables['intake.service_intake'].alter.some(v=>v.startsWith('web_submission_id')),false);
  assert.ok(plan.negative_constraints.includes('WEB mixed with Bot fields'));
  assert.ok(plan.forbidden.includes('external message/outbox/delivery'));assert.ok(plan.preserved.includes('migrations 001-032'));
});
