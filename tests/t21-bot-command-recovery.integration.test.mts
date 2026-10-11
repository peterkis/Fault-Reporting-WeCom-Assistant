// Registered current-scope risk tracer; original external draft retained.
// Future tests/t21-bot-command-recovery.integration.test.mts; one case, 240s.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT21DraftFixture,t21Object,t21FeedbackCommand,t21Send} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser,login,origin} from './helpers/yxx-ss-009-http-fixture.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';

test('original Bot feedback response loss is reconciled by current independent READ after logout and write/raw OFF; another member or revoked source cannot read it',async()=>{
 await withT21DraftFixture(async f=>{
  let app=await f.replaceMember(),member=browser(app.server);await login(member);
  // Original source-bound Bot/User/ref is valid under the current approved App.
  // No historical App pin or identity rewrite is introduced.
  const {command,csrf}=await t21FeedbackCommand(member,f.path);
  let successfulPostCount=0;
  const loseSuccessfulResponse=(request:import('node:http').IncomingMessage,response:import('node:http').ServerResponse)=>{
   if(request.method!=='POST'||request.url!==f.path+'/feedback')return;
   const end=response.end.bind(response);
   response.end=((...args:Parameters<typeof response.end>)=>{if(response.statusCode===200){successfulPostCount++;request.socket.destroy();return response;}return end(...args);}) as typeof response.end;
  };
  app.server.on('request',loseSuccessfulResponse);
  await assert.rejects(t21Send(member,f.path,command,csrf));
  app.server.off('request',loseSuccessfulResponse);assert.equal(successfulPostCount,1);
  const ackPath=f.path+'/feedback/commands/'+command.client_command_id;
  const originalAck=await member.request(ackPath);assert.equal(originalAck.status,200,originalAck.text);
  const committed=t21Object(originalAck.json());assert.equal(committed.state,'COMMITTED');
  assert.deepEqual(Object.keys(committed).sort(),['client_command_id','public_ref','result','state']);
  assert.equal(committed.client_command_id,command.client_command_id);assert.equal(committed.public_ref,f.publicRef);
  assert.doesNotMatch(originalAck.text,/INTERNAL_T11_CANARY|user-test|bot-test|command_hash|actor_principal_id|request_ref/u);
  const logoutInput={method:'POST',body:{},headers:{origin,'content-type':'application/json'}};const logout=await member.request('/api/reporter/logout',logoutInput);assert.equal(logout.status,200);
  assert.equal((await member.request(ackPath)).status,401);
  await login(member);assert.deepEqual((await member.request(ackPath)).json(),committed);
  // A stable replacement profile + fresh authentication tests lawful current
  // READ with WRITE OFF. No live flag mutation bypasses FLAGS_CHANGED. Raw
  // draft recovery is left at its independent default OFF; this is HTTP proof,
  // not proof of browser IndexedDB or refresh recovery.
  app=await f.replaceMember({write:false});member=browser(app.server);await login(member);
  const readable=await member.request(f.path);assert.equal(readable.status,200);
  const offBootstrap=await member.request('/api/reporter/feedback/bootstrap');assert.equal(offBootstrap.status,200);
  assert.equal(t21Object(offBootstrap.json()).write_enabled,false);
  assert.deepEqual((await member.request(ackPath)).json(),committed);
  const deniedWrite=await t21Send(member,f.path,command,csrf);assert.equal(deniedWrite.status,403,deniedWrite.text);
  const other=browser(app.server);await login(other,'b');assert.equal((await other.request(ackPath)).status,404);
  const principal=f.context.principals[0];assert.ok(principal);
  await transactionP2016(f.context.pool,transaction=>f.access.revokeInTransaction({transaction,ticketId:f.ticketId,actorPrincipalId:principal.id}));
  assert.equal((await member.request(f.path)).status,404);assert.equal((await member.request(ackPath)).status,404);
  await f.verifyStaff(async staff=>{const ticket=await staff.detail(f.ticketId);assert.equal(ticket.status,'REOPENED');
   assert.equal(ticket.version,f.completed.version+1);assert.equal(ticket.assignee_id,null);
   assert.equal(ticket.handling_cycle?.cycle_no,(f.completed.handling_cycle?.cycle_no??0)+1);});
 });
});
