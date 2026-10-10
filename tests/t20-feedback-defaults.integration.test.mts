import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {browser,login,oauthOptions,mapping,post} from './helpers/yxx-ss-009-http-fixture.mjs';

test('M feedback capability defaults false and does not extend the old own-detail or command ledger',async()=>{
 await withT20FeedbackFixture(async f=>{
  await f.app.stop();const app=createYxxProfile({...f.options,profile:'MEMBER_SELF_SERVICE',identityMapping:await mapping(),oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:f.options.featureFlags}});
  try{await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await login(member);const bootstrap=t20Object((await member.request('/api/yixiaoxiu/bootstrap')).json());
   const detail=await member.request(f.path);assert.equal(detail.status,200);assert.equal(Object.hasOwn(t20Object(detail.json()),'feedback_context'),false);
   assert.equal((await member.request(f.path+'/feedback',{...post(f.command,bootstrap.csrf_token),headers:{...post(f.command,bootstrap.csrf_token).headers,'if-match':'"'+f.completed.version+'"'}})).status,503);
   assert.equal((await f.context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM intake.web_command_receipt WHERE command_kind=\'FEEDBACK\'')).rows[0]?.n,0);
  }finally{await app.stop();assert.equal(app.server.listening,false);}
 });
});

test('readonly and OAuth-only profiles retain no feedback route; zero-write member profile denies feedback',async()=>{
 await withT20FeedbackFixture(async f=>{
  await f.app.stop();
  for(const profile of ['MEMBER_TICKET_READONLY','OAUTH_ONLY'] as const){
   const options={...f.options,identityMapping:await mapping(),oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:f.options.featureFlags,reporterFeedbackEnabled:true}};
   const app=profile==='MEMBER_TICKET_READONLY'?createYxxProfile({...options,profile:'MEMBER_TICKET_READONLY'}):createYxxProfile({...options,profile:'OAUTH_ONLY'});
   try{await app.start();const member=browser(app.server);await login(member);const denied=await member.request(f.path+'/feedback',post(f.command,'not-a-write-grant'));assert.equal(denied.status,403);assert.equal(t20Object(t20Object(denied.json()).error).code,'YXX_MEMBER_WRITE_DISABLED');}
   finally{await app.stop();assert.equal(app.server.listening,false);}
  }
  const app=createYxxProfile({...f.options,profile:'MEMBER_SELF_SERVICE',identityMapping:await mapping(),oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:false,YIXIAOXIU_MY_REPORTS_ENABLED:true},reporterFeedbackEnabled:true}});
  try{await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await login(member);const bootstrap=t20Object((await member.request('/api/yixiaoxiu/bootstrap')).json());
   assert.equal(bootstrap.can_submit,false);const detail=await member.request(f.path);assert.equal(detail.status,200);assert.equal(t20Object(t20Object(detail.json()).feedback_context).can_feedback,false);
   assert.equal((await member.request(f.path+'/feedback',{...post(f.command,bootstrap.csrf_token),headers:{...post(f.command,bootstrap.csrf_token).headers,'if-match':'"'+f.completed.version+'"'}})).status,403);
   assert.equal((await member.request(f.path+'/feedback/commands/'+f.command.client_command_id)).status,200);
  }finally{await app.stop();assert.equal(app.server.listening,false);}
 });
});

test('043 readiness is conditional on enabled W rounds while original W defaults keep their current readiness',async()=>{
 await withT20FeedbackFixture(async f=>{
  await f.app.stop();await f.context.pool.query("UPDATE platform.schema_migration SET migration_id='043_t20_missing' WHERE migration_id='043_ticket_reopen_rounds'");
  try{
   for(const enabled of [false,true]){
    const runtime=createP2016Runtime({pool:f.context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.context.origin,principalIds:[f.context.principals[0]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,...(enabled?{ticketReopenRoundsEnabled:true}:{})});
    if('disabled' in runtime)throw Error('T20_DEFAULT_READY_DISABLED');
    try{await runtime.start();const projected=await runtime.coordinator.runOnce();if(projected.disabled)throw Error('T20_PROJECTION_DISABLED');assert.equal(projected.failures,0,JSON.stringify(projected));const ready=await browser(runtime.server).request('/health/ready');assert.equal(ready.status,enabled?503:200,ready.text);if(enabled)assert.equal(t20Object(t20Object(ready.json()).checks).ticket_reopen_rounds_schema,false);}
    finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
   }
  }finally{await f.context.pool.query("UPDATE platform.schema_migration SET migration_id='043_ticket_reopen_rounds' WHERE migration_id='043_t20_missing'");}
 });
});
