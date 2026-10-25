import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {createTicketStaffCompletionService} from '../app/server/src/workbench-ticket-completion.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import type {P2016TakeoverCompletionCommand} from '../contracts/p2_016_takeover_completion_contracts.js';

test('a currently visible non-owner HANDLER takes actual self-team responsibility and staff-closes the original started cycle in one public command while retaining communication and one safe commitment',async()=>{
  await withT12Fixture(async f=>{
    const s=await acceptedSetup(f);
    const started=await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_PUBLIC_START'});
    assert.equal(started.status,200,JSON.stringify(started.value));
    const current=await s.b.get(s.path);assert.equal(current.status,200);assert.equal(current.value.status,'IN_PROGRESS');
    assert.equal(current.value.assignee_id,s.owner.id);assert.notEqual(current.value.assignee_id,s.actor.id);
    const cycle=object(current.value.handling_cycle),beforeEvents=await s.a.get(s.path+'/events');assert.equal(beforeEvents.status,200);
    const beforeResponsibility=await s.a.get(s.path+'/responsibility');assert.equal(beforeResponsibility.status,200);
    const command:P2016TakeoverCompletionCommand={client_command_id:randomUUID(),expected_version:version(current.value.version),
      reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),
      communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'INTERNAL_T12_CANARY：核实合成设备并完成内部处置。',
      external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true};
    const response=await s.b.post(s.path+'/takeover-and-complete',command);assert.equal(response.status,200,JSON.stringify(response.value));
    const after=await s.b.get(s.path);assert.equal(after.status,200);assert.equal(after.value.status,'CLOSED');
    assert.equal(after.value.version,command.expected_version+2);assert.equal(after.value.assignee_id,s.actor.id);assert.equal(after.value.resolver_team_id,'T07_NETWORK');
    assert.equal(after.value.intake_id,s.first.intake.intakeId);assert.equal(current.value.intake_id,s.first.intake.intakeId);const ended=object(after.value.handling_cycle);
    assert.equal(ended.id,cycle.id);assert.equal(ended.cycle_no,cycle.cycle_no);assert.equal(ended.first_responsibility_event_id,cycle.first_responsibility_event_id);
    const events=await s.a.get(s.path+'/events');assert.equal(events.status,200);const old=rows(beforeEvents.value.items),all=rows(events.value.items);
    assert.deepEqual(all.slice(0,old.length),old);assert.deepEqual(all.slice(old.length).map(e=>e.event_type),['ticket.assignment_transferred','ticket.closed']);
    const closed=all.at(-1);assert.ok(closed);assert.equal(ended.staff_completion_event_id,closed.event_id);
    const basis=object(response.value.completion);assert.equal(basis.basis,'STAFF_COMPLETED');assert.equal(basis.event_id,closed.event_id);
    const staff=await s.b.get('/api/workbench/items/ticket/'+s.first.ticket.id);assert.equal(staff.status,200);
    const records=rows(staff.value.records);assert.ok(records.some(r=>r.audience==='INTERNAL'&&r.text===command.internal_process));
    assert.ok(records.some(r=>r.audience==='EXTERNAL'&&r.text===command.external_summary));
    const responsibility=await s.a.get(s.path+'/responsibility');assert.equal(responsibility.status,200);
    assert.ok(rows(beforeResponsibility.value.conversations).length>0);
    assert.deepEqual(responsibility.value.conversations,beforeResponsibility.value.conversations);
    const completionReader=createTicketStaffCompletionService({pool:f.pool,query:createP2016TicketQuery({pool:f.pool,enabled:true}),enabled:true});
    const commitments=await completionReader.readCommittedStaffCompletions({limit:20});
    const matching=commitments.items.filter(c=>c.ticket_id===s.first.ticket.id);assert.equal(matching.length,1);
    assert.equal(matching[0]?.cycle_id,command.handling_cycle_id);assert.equal(matching[0]?.ticket_event_id,closed.event_id);
    assert.equal(matching[0]?.source_intake_id,s.first.intake.intakeId);assert.equal(matching[0]?.external_summary,command.external_summary);
    assert.equal(JSON.stringify(response.value).includes('INTERNAL_T12_CANARY'),false);assert.equal(JSON.stringify(commitments).includes('INTERNAL_T12_CANARY'),false);
    const replay=await s.b.post(s.path+'/takeover-and-complete',command);assert.equal(replay.status,200);assert.equal(replay.value.replayed,true);
    assert.equal(replay.value.ticket_event_id,response.value.ticket_event_id);
    assert.deepEqual((await s.a.get(s.path+'/events')).value,events.value);
    assert.deepEqual(await completionReader.readCommittedStaffCompletions({limit:20}),commitments);
    const notices=await s.a.get(s.path+'/deliveries');assert.equal(notices.status,200);
    assert.equal(rows(notices.value.items).filter(d=>d.notification_type==='TICKET_ACCEPTED').length,1);
  });
});
