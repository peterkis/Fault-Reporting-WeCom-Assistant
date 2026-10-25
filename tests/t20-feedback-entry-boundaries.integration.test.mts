import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {withT11Fixture} from './helpers/t11-completion-fixture.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {browser,login,origin,secret,config,oauthOptions,mapping,input,post} from './helpers/yxx-ss-009-http-fixture.mjs';

test('enabled M feedback declares its independent protected raw recovery capability as default false',async()=>{
 await withT20FeedbackFixture(async f=>{
  const bootstrap=await f.member.request('/api/yixiaoxiu/bootstrap');assert.equal(bootstrap.status,200);
  assert.equal(t20Object(bootstrap.json()).feedback_draft_recovery_enabled,false,'feedback raw recovery has an explicit independent default-false capability');
 });
});

test('an accepted original Web request that has not created a Ticket cannot reopen a round',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
  const app=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:context.pool,publicOrigin:origin,reporterMemberEntry:config,reporterHmacSecret:secret,identityMapping:await mapping(),oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:flags,reporterFeedbackEnabled:true}});
  try{
   await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await login(member);const bootstrap=t20Object((await member.request('/api/yixiaoxiu/bootstrap')).json());
   const accepted=await member.request('/api/yixiaoxiu/requests',post(input('处方提交不了'),bootstrap.csrf_token));assert.equal(accepted.status,202);
   const requestRef=String(t20Object(t20Object(accepted.json()).receipt).request_ref),path='/api/yixiaoxiu/requests/'+requestRef;
   const detail=await member.request(path);assert.equal(detail.status,200);const body=t20Object(detail.json());assert.equal(body.ticket,null);
   assert.deepEqual(body.feedback_context,{schema_version:1,can_feedback:false,completed_round_ref:null,completed_round_no:null,ticket_version:null,rejection:'TICKET_NOT_CREATED'});
   const command={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:'A'.repeat(32),expected_ticket_version:1};
   const response=await member.request(path+'/feedback',{...post(command,bootstrap.csrf_token),headers:{...post(command,bootstrap.csrf_token).headers,'if-match':'"1"'}});assert.equal(response.status,409);
   assert.equal(t20Object(t20Object(response.json()).error).code,'YXX_ROUND_NOT_COMPLETED');
   const facts=await context.pool.query<{n:number}>("SELECT count(*)::int AS n FROM intake.web_command_receipt WHERE command_kind='FEEDBACK'");assert.equal(facts.rows[0]?.n,0);
   const current=await member.request(path);assert.equal(current.status,200);assert.equal(t20Object(current.json()).ticket,null);
  }finally{await app.stop();assert.equal(app.server.listening,false);}
 });
});
