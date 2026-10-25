import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {parseYxxFeedbackInput} from '../app/server/src/yxx-self-service-feedback.mjs';
import {randomUUID} from 'node:crypto';

test('feedback runtime input rejects identity, incidental thanks and accessor execution before any hook',()=>{
 const input={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:'A'.repeat(32),expected_ticket_version:5};
 assert.deepEqual(parseYxxFeedbackInput(input),input);
 for(const patch of [{feedback:'THANKS'},{actor:'REPORTER'},{ticket_id:randomUUID()},{expected_ticket_version:'5'},{expected_ticket_version:2147483648},{completed_round_ref:randomUUID()},{client_command_id:'invalid'}])assert.throws(()=>parseYxxFeedbackInput({...input,...patch}),{code:'YXX_INPUT_INVALID'});
 let calls=0;const accessor=Object.defineProperty({...input},'feedback',{enumerable:true,get(){calls++;return 'STILL_UNRESOLVED';}});
 assert.throws(()=>parseYxxFeedbackInput(accessor));assert.equal(calls,0);
});

test('actual own-detail feedback extension is part of its existing closed public HTTP schema',async()=>{
 await withT20FeedbackFixture(async f=>{
  const detail=t20Object((await f.member.request(f.path)).json());
  const schema=t20Object(JSON.parse(await readFile(new URL('../contracts/yxx_self_service_request_detail.schema.json',import.meta.url),'utf8')));
  assert.equal(schema.additionalProperties,false);const properties=t20Object(schema.properties);
  for(const key of Object.keys(detail))assert.equal(Object.hasOwn(properties,key),true,'actual HTTP field must be declared by the existing closed detail contract: '+key);
  assert.equal(t20Object(properties.feedback_context).$ref,'./yxx_self_service_feedback_context.schema.json');
  const command=await f.send();assert.equal(command.status,200,command.text);
  const result=t20Object(command.json()),resultSchema=t20Object(JSON.parse(await readFile(new URL('../contracts/yxx_self_service_feedback_result.schema.json',import.meta.url),'utf8')));
  assert.equal(resultSchema.additionalProperties,false);const resultProperties=t20Object(resultSchema.properties);
  for(const key of Object.keys(result))assert.equal(Object.hasOwn(resultProperties,key),true,key);
  assert.equal(JSON.stringify(result).includes('INTERNAL_T11_CANARY'),false);
  const receipt=await f.member.request(f.path+'/feedback/commands/'+f.command.client_command_id);assert.equal(receipt.status,200,receipt.text);
  assert.equal(t20Object(receipt.json()).state,'COMMITTED');
 });
});
