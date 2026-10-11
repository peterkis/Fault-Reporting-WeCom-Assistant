import {t21Login as login} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
// Registered current-scope risk tracer; original external draft retained.
// Future tests/t21-bot-round-idempotency.integration.test.mts; one case, 240s.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT21DraftFixture,t21Object,t21FeedbackCommand,t21Send} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser} from './helpers/yxx-ss-009-http-fixture.mjs';

test('two Bot member tabs with different UUIDs create one new cycle; an old completed-round ref cannot reopen a later completion',async()=>{
 await withT21DraftFixture(async f=>{
  let app=await f.replaceMember(),first=browser(app.server);await login(first);
  const second=browser(app.server);await login(second);
  const one=await t21FeedbackCommand(first,f.path),two=await t21FeedbackCommand(second,f.path);
  assert.equal(one.command.expected_ticket_version,two.command.expected_ticket_version);
  // Opaque credentials can differ across a physical minute; both must authorize
  // this same completed round, as the concurrent real commands prove below.
  assert.notEqual(one.command.client_command_id,two.command.client_command_id);
  const responses=await Promise.all([t21Send(first,f.path,one.command,one.csrf),t21Send(second,f.path,two.command,two.csrf)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409],responses.map(r=>r.text).join('\n'));
  const winner=responses[0]?.status===200?one:two,winningResponse=responses.find(r=>r.status===200);assert.ok(winningResponse);
  const result=t21Object(winningResponse.json());assert.equal(result.reopened_round_no,(f.completed.handling_cycle?.cycle_no??0)+1);
  const replay=await t21Send(first,f.path,winner.command,one.csrf);assert.equal(replay.status,200,replay.text);
  assert.deepEqual(replay.json(),{...result,replayed:true});
  assert.equal((await t21Send(first,f.path,{...winner.command,expected_ticket_version:winner.command.expected_ticket_version+1},one.csrf)).status,409);
  let nextVersion=0;
  await f.verifyStaff(async staff=>{
   const awaiting=await staff.detail(f.ticketId);assert.equal(awaiting.status,'REOPENED');assert.equal(awaiting.assignee_id,null);
   assert.equal(awaiting.handling_cycle?.cycle_no,(f.completed.handling_cycle?.cycle_no??0)+1);
   assert.equal(awaiting.handling_cycle?.first_responsibility_event_id,null);
   const started=await staff.start(f.ticketId);assert.equal(started.status,'IN_PROGRESS');
   assert.equal((await staff.post(f.ticketId,'complete',staff.command(started))).status,200);
   const closed=await staff.detail(f.ticketId);assert.equal(closed.status,'CLOSED');nextVersion=closed.version;
   assert.equal(closed.handling_cycle?.cycle_no,(f.completed.handling_cycle?.cycle_no??0)+1);
  });
  app=await f.replaceMember();first=browser(app.server);await login(first);
  const fresh=await t21FeedbackCommand(first,f.path);
  assert.notEqual(fresh.command.completed_round_ref,winner.command.completed_round_ref);
  assert.equal(fresh.command.expected_ticket_version,nextVersion);
  const stale={...winner.command,client_command_id:randomUUID(),expected_ticket_version:nextVersion};
  const denied=await t21Send(first,f.path,stale,fresh.csrf);assert.equal(denied.status,409,denied.text);
  const current=await first.request(f.path);assert.equal(current.status,200);assert.equal(t21Object(current.json()).version,nextVersion);
  const oldReceipt=await first.request(f.path+'/feedback/commands/'+winner.command.client_command_id);assert.equal(oldReceipt.status,200);
  assert.equal(t21Object(oldReceipt.json()).state,'COMMITTED');assert.deepEqual(t21Object(oldReceipt.json()).result,{...result,replayed:true});
  const next=await t21Send(first,f.path,fresh.command,fresh.csrf);assert.equal(next.status,200,next.text);
  assert.equal(t21Object(next.json()).reopened_round_no,(f.completed.handling_cycle?.cycle_no??0)+2);
  await f.verifyStaff(async staff=>{const final=await staff.detail(f.ticketId);assert.equal(final.ticket_no,f.completed.ticket_no);
   assert.equal(final.status,'REOPENED');assert.equal(final.assignee_id,null);
   assert.equal(final.handling_cycle?.cycle_no,(f.completed.handling_cycle?.cycle_no??0)+2);
   assert.equal(final.handling_cycle?.first_responsibility_event_id,null);});
 });
});
