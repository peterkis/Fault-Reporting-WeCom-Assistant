import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withT21DraftFixture,t21Config,t21Mapping,t21OAuthOptions,t21FeedbackCommand,t21Send,t21Object} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser,login,origin,secret} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
test('Bot feedback defaults closed and readonly/OAuth profiles cannot gain write capability or cross-source recovery',async()=>{
 await withT21DraftFixture(async f=>{
  let app=await f.replaceMember(),member=browser(app.server);await login(member);const prepared=await t21FeedbackCommand(member,f.path);await f.closeMember();
  const options={pool:f.context.pool,publicOrigin:origin,reporterMemberEntry:t21Config,identityMapping:await t21Mapping(),reporterHmacSecret:secret};
  for(const profile of ['MEMBER_SELF_SERVICE','MEMBER_TICKET_READONLY','OAUTH_ONLY'] as const){
   const shared={...options,oauth:createWeComWebOAuth(t21OAuthOptions()),yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}}};
   const runtime=profile==='MEMBER_SELF_SERVICE'?createYxxProfile({...shared,profile}):profile==='MEMBER_TICKET_READONLY'?createYxxProfile({...shared,profile}):createYxxProfile({...shared,profile});
   try{await runtime.start();member=browser(runtime.server);await login(member);const denied=await t21Send(member,f.path,prepared.command,prepared.csrf);assert.equal(denied.status,403,denied.text);
    if(profile!=='OAUTH_ONLY'){const detail=await member.request(f.path);assert.equal(detail.status,200,detail.text);assert.equal(Object.hasOwn(t21Object(detail.json()),'feedback_context'),false);}
    const page=await member.request('/wecom/yixiaoxiu/tickets/'+f.publicRef);assert.equal(page.status,200);if(profile==='MEMBER_TICKET_READONLY')assert.equal(page.text.includes('/reporter/bot-feedback.js'),false);
   }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  }
  await f.verifyStaff(async staff=>{const detail=await staff.detail(f.ticketId);assert.equal(detail.status,'CLOSED');assert.equal(detail.version,f.completed.version);assert.deepEqual(detail.handling_cycle,f.completed.handling_cycle);});
 });
});
test('current Bot schema readiness is conditional and the default runtime keeps its original readiness without 050',async()=>{
 await withT21DraftFixture(async f=>{
  await f.context.pool.query("UPDATE platform.schema_migration SET migration_id='050_t21_missing' WHERE migration_id='050_bot_reporter_feedback'");
  try{for(const enabled of [false,true]){
   const oauth=createWeComWebOAuth({...t21OAuthOptions(),publicOrigin:f.context.origin});
   const runtime=createP2016Runtime({pool:f.context.pool,publicOrigin:f.context.origin,principalIds:[f.context.principals[0]?.id??''],flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},externalSendEnabled:false,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:t21Config,identityMapping:await t21Mapping(),reporterHmacSecret:secret,wecomWebOAuth:oauth,botReporterFeedbackEnabled:enabled,yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}}});
   if('disabled' in runtime)assert.fail('T21_ENABLED_RUNTIME_REQUIRED');
   try{await runtime.start();const result=await runtime.coordinator.runOnce();if(result.disabled)assert.fail('T21_COORDINATOR_REQUIRED');assert.equal(result.failures,0);
    const ready=await browser(runtime.server).request('/health/ready');assert.equal(ready.status,enabled?503:200,ready.text);const checks=t21Object(t21Object(ready.json()).checks);
    if(enabled)assert.equal(checks.bot_reporter_feedback_schema,false);else assert.equal(Object.hasOwn(checks,'bot_reporter_feedback_schema'),false);
   }finally{await runtime.stop();oauth.close();assert.equal(runtime.server.listening,false);}
  }}finally{await f.context.pool.query("UPDATE platform.schema_migration SET migration_id='050_bot_reporter_feedback' WHERE migration_id='050_t21_missing'");}
 });
});
test('Bot closed public HTTP contracts reject incidental text, spoofed identity and malformed version while exposing only safe committed fields',async()=>{
 await withT21DraftFixture(async f=>{
  const app=await f.replaceMember(),member=browser(app.server);await login(member);const {command,csrf}=await t21FeedbackCommand(member,f.path);
  for(const patch of [{feedback:'THANKS'},{actor:'REPORTER'},{ticket_id:f.ticketId},{expected_ticket_version:'5'},{expected_ticket_version:2147483648},{completed_round_ref:'not-an-opaque-round'}]){
   const response=await member.request(f.path+'/feedback',{method:'POST',body:{...command,...patch},headers:{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_ticket_version+'"'}});assert.equal(response.status,400,response.text);
  }
  const detail=t21Object((await member.request(f.path)).json()),bootstrap=t21Object((await member.request('/api/reporter/feedback/bootstrap')).json());
  const result=await t21Send(member,f.path,command,csrf);assert.equal(result.status,200,result.text);
  const receipt=await member.request(f.path+'/feedback/commands/'+command.client_command_id);assert.equal(receipt.status,200,receipt.text);
  for(const [file,value] of [['p2_016_reporter_ticket_view.schema.json',detail],['bot_reporter_feedback_bootstrap.schema.json',bootstrap],['bot_reporter_feedback_result.schema.json',t21Object(result.json())]] as const){
   const schema=t21Object(JSON.parse(await readFile(new URL('../contracts/'+file,import.meta.url),'utf8')));assert.equal(schema.additionalProperties,false);const properties=t21Object(schema.properties);for(const key of Object.keys(value))assert.equal(Object.hasOwn(properties,key),true,key+' must be declared in '+file);
  }
  assert.deepEqual(Object.keys(receipt.json()).sort(),['client_command_id','public_ref','result','state']);assert.equal(t21Object(receipt.json()).state,'COMMITTED');
  assert.doesNotMatch(result.text+receipt.text,/INTERNAL_T11_CANARY|user-test|bot-test|request_ref|source_intake_id|actor_principal_id|command_hash|completed_by/u);
 });
});
