// FORWARD_SOURCE_DRAFT / NOT_REGISTERED / NOT_COMPILED / NOT_RUN.
// Future tests/t21-bot-current-scope-denials.integration.test.mts; two cases,
// 240s each file / stock concurrency1 / flags[]. No historical publicRef App pin.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT21DraftFixture,t21Object,t21FeedbackCommand,t21Send,t21Config,t21Mapping,t21OAuthOptions} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser,login,post,input,origin,secret,oauthOptions} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';

test('current approved App ownership rejects another member, wrong Bot, Web ref, legacy cookie, OAuth/config mismatch and an old mapping under a new config',async()=>{
 await withT21DraftFixture(async f=>{
  let app=await f.replaceMember(),member=browser(app.server);await login(member);
  const own=await member.request(f.path);assert.equal(own.status,200,own.text);
  assert.equal(t21Object(own.json()).ticket_no,f.completed.ticket_no);
  // Existing source-bound ref remains eligible; no historical pin field is demanded.
  const {command,csrf}=await t21FeedbackCommand(member,f.path);
  const other=browser(app.server);await login(other,'b');
  const otherBootstrap=await other.request('/api/reporter/feedback/bootstrap');assert.equal(otherBootstrap.status,200);
  const deniedOther=await t21Send(other,f.path,command,String(t21Object(otherBootstrap.json()).csrf_token));
  assert.equal(deniedOther.status,404,deniedOther.text);
  assert.doesNotMatch(deniedOther.text,/ticket_no|user-test|bot-test|INTERNAL_T11_CANARY/u);
  const legacyOnly=browser(app.server);legacyOnly.cookies.set('p2016_reporter',f.legacySession);
  assert.equal((await legacyOnly.request(f.path)).status,401);
  assert.equal((await t21Send(legacyOnly,f.path,command,csrf)).status,401);
  const webBootstrap=await member.request('/api/yixiaoxiu/bootstrap');assert.equal(webBootstrap.status,200);
  const web=await member.request('/api/yixiaoxiu/requests',post(input('合成处方提交失败'),t21Object(webBootstrap.json()).csrf_token));
  assert.equal(web.status,202,web.text);const requestRef=String(t21Object(t21Object(web.json()).receipt).request_ref);
  assert.equal((await t21Send(member,'/api/reporter/tickets/'+requestRef,command,csrf)).status,404);
  app=await f.replaceMember({botId:'synthetic-wrong-bot'});member=browser(app.server);await login(member);
  assert.equal((await member.request(f.path)).status,404);
  const wrongBotBootstrap=await member.request('/api/reporter/feedback/bootstrap');assert.equal(wrongBotBootstrap.status,200);
  assert.equal((await t21Send(member,f.path,command,String(t21Object(wrongBotBootstrap.json()).csrf_token))).status,404);
  await f.closeMember();
  const secondConfig={...t21Config,agentId:'1000003',proofRef:'tests/t21-synthetic-mapping-1000003'};
  const mismatchedOAuth=createWeComWebOAuth(oauthOptions),freshMapping=await t21Mapping(secondConfig);
  try{
   assert.throws(()=>createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,publicOrigin:origin,
    reporterHmacSecret:secret,reporterMemberEntry:secondConfig,identityMapping:freshMapping,oauth:mismatchedOAuth}),
    {code:'YXX_ENTRY_CONFIG_INVALID'});
  }finally{mismatchedOAuth.close();}
  const matchingOAuth=createWeComWebOAuth(t21OAuthOptions(secondConfig)),oldMapping=await t21Mapping();
  try{
   assert.throws(()=>createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,publicOrigin:origin,
    reporterHmacSecret:secret,reporterMemberEntry:secondConfig,identityMapping:oldMapping,oauth:matchingOAuth}),
    {code:'YXX_ENTRY_IDENTITY_NAMESPACE_UNVERIFIED'});
  }finally{matchingOAuth.close();}
  // These are startup authority failures, never a claim about message history.
  await f.verifyStaff(async staff=>{const ticket=await staff.detail(f.ticketId);assert.equal(ticket.status,'CLOSED');
   assert.equal(ticket.version,f.completed.version);assert.equal(ticket.handling_cycle?.cycle_no,f.completed.handling_cycle?.cycle_no);});
 });
});

test('a Bot command round and receipt stay in its command-time App and purpose while the original Bot ref remains source-bound',async()=>{
 await withT21DraftFixture(async f=>{
  let app=await f.replaceMember({webFeedback:true}),member=browser(app.server);await login(member);
  const a=await t21FeedbackCommand(member,f.path);
  const webBootstrap=await member.request('/api/yixiaoxiu/bootstrap');assert.equal(webBootstrap.status,200);
  const webInput=input('合成网页报修用于用途隔离'),web=await member.request('/api/yixiaoxiu/requests',post(webInput,t21Object(webBootstrap.json()).csrf_token));
  assert.equal(web.status,202,web.text);const webRequestRef=String(t21Object(t21Object(web.json()).receipt).request_ref);
  // This separate App has its own synthetic approved config/proof and conversion.
  // It is not allowed to reuse App A's round token or command receipt. This case
  // intentionally makes no historical-exclusivity assertion about a NEW B command.
  app=await f.replaceMember({agentId:'1000003'});member=browser(app.server);await login(member);
  const bBootstrap=await member.request('/api/reporter/feedback/bootstrap');assert.equal(bBootstrap.status,200);
  const bCsrf=String(t21Object(bBootstrap.json()).csrf_token);
  const contaminated=await t21Send(member,f.path,a.command,bCsrf);assert.equal(contaminated.status,409,contaminated.text);
  const untouched=await member.request(f.path);assert.equal(untouched.status,200);
  assert.equal(t21Object(untouched.json()).version,f.completed.version);
  app=await f.replaceMember({webFeedback:true});member=browser(app.server);await login(member);
  const sameApp=await t21FeedbackCommand(member,f.path);
  assert.equal(sameApp.command.completed_round_ref,a.command.completed_round_ref);
  const accepted=await t21Send(member,f.path,a.command,sameApp.csrf);assert.equal(accepted.status,200,accepted.text);
  const ackPath=f.path+'/feedback/commands/'+a.command.client_command_id;
  const originalAck=await member.request(ackPath);assert.equal(originalAck.status,200,originalAck.text);
  const committed=t21Object(originalAck.json());assert.equal(committed.state,'COMMITTED');
  const webPurpose=await member.request('/api/yixiaoxiu/requests/'+webRequestRef+'/feedback/commands/'+a.command.client_command_id);
  assert.equal(webPurpose.status,200,webPurpose.text);
  assert.deepEqual(webPurpose.json(),{client_command_id:a.command.client_command_id,request_ref:webRequestRef,state:'UNKNOWN'});
  const botPurpose=await member.request(f.path+'/feedback/commands/'+webInput.client_command_id);
  assert.equal(botPurpose.status,200,botPurpose.text);
  assert.deepEqual(botPurpose.json(),{client_command_id:webInput.client_command_id,public_ref:f.publicRef,state:'UNKNOWN'});
  app=await f.replaceMember({agentId:'1000003',write:false});member=browser(app.server);await login(member);
  assert.equal((await member.request(f.path)).status,200);
  const crossApp=await member.request(ackPath);assert.equal(crossApp.status,200,crossApp.text);
  assert.deepEqual(crossApp.json(),{client_command_id:a.command.client_command_id,public_ref:f.publicRef,state:'UNKNOWN'});
  assert.doesNotMatch(crossApp.text,/reopened_round_no|ticket_no|INTERNAL_T11_CANARY|command_hash|actor_principal_id/u);
  app=await f.replaceMember({write:false});member=browser(app.server);await login(member);
  const restored=await member.request(ackPath);assert.equal(restored.status,200,restored.text);assert.deepEqual(restored.json(),committed);
  await f.verifyStaff(async staff=>{const ticket=await staff.detail(f.ticketId);assert.equal(ticket.status,'REOPENED');
   assert.equal(ticket.version,f.completed.version+1);assert.equal(ticket.assignee_id,null);
   assert.equal(ticket.handling_cycle?.cycle_no,(f.completed.handling_cycle?.cycle_no??0)+1);});
 });
});
