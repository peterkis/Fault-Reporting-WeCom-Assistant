import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routes=[
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
  assert.equal(input.additionalProperties,false);assert.equal(supplement.additionalProperties,false);
  for(const key of ['reporter','role','provider','target','ticket_id','status','priority','actor','created_at','accepted_at'])assert.equal(Object.hasOwn(input.properties,key),false,key);
  assert.deepEqual(input.properties.impact_scope.enum,['UNKNOWN','SELF','SINGLE_WORKSTATION','MULTIPLE_USERS','DEPARTMENT']);
  assert.equal(input.properties.description.maxLength,4000);assert.equal(supplement.properties.text.maxLength,2000);
});

test('SS-002 both OpenAPI documents expose the same seven YXX operation references',async()=>{
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
});

test('SS-002 catalog plan keeps migration 033 conditional and Web APP_ONLY',async()=>{
  const plan=JSON.parse(await readFile('docs/runbooks/yixiaoxiu-self-service-catalog-plan.json','utf8'));
  assert.equal(plan.migration,'033_yxx_self_service_intake.sql');
  assert.deepEqual(plan.new_tables,['intake.web_request_binding','intake.web_submission','intake.web_command_receipt']);
  assert.ok(plan.forbidden.includes('external message/outbox/delivery'));assert.ok(plan.preserved.includes('migrations 001-032'));
});
