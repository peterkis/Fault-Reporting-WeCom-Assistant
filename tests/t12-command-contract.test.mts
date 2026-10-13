import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {normalizeTakeoverCompletionCommand} from '../src/workbench-ticket-takeover-completion.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

test('closed composite contracts retain one immutable confirmed capture and reject hidden authority, unbounded fields and ambiguous communication',async()=>{
 const session={session_id:randomUUID(),expected_row_version:1},body={client_command_id:randomUUID(),expected_version:4,reason_code:'STAFF_COMPLETED',resolver_team_id:'PILOT_IT',handling_cycle_id:randomUUID(),communication_choice:'TAKE_SELECTED',sessions:[session],internal_process:'独立内部过程',external_summary:'可公开的结果',external_summary_confirmed:true},input={action:'takeover-and-complete',ticket_id:randomUUID(),...body};
 const normalized=normalizeTakeoverCompletionCommand(input);await assertP2016Schema('p2_016_takeover_completion_command',body);session.expected_row_version=2;
 assert.equal(normalized.sessions[0]?.expected_row_version,1);assert.ok(Object.isFrozen(normalized)&&Object.isFrozen(normalized.sessions)&&Object.isFrozen(normalized.sessions[0]));
 for(const patch of [{actor_principal_id:randomUUID()},{target_principal_id:randomUUID()},{force:true},{status:'CLOSED'},{reason_code:'REQUESTER_CONFIRMED'},
  {expected_version:'4'},{expected_version:0},{expected_version:2147483648},{handling_cycle_id:'cycle'},{resolver_team_id:''},{internal_process:' '},{internal_process:'x'.repeat(2001)},
  {external_summary:' '},{external_summary:'x'.repeat(501)},{external_summary_confirmed:false},{communication_choice:'TAKE_SELECTED',sessions:[]},
  {communication_choice:'RETAIN_CURRENT',sessions:[session]},{sessions:[session,{...session,session_id:session.session_id.toUpperCase()}]},
  {sessions:[{...session,expected_row_version:'2'}]},{sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))}])assert.throws(()=>normalizeTakeoverCompletionCommand({...input,...patch}),{code:'P2_016_INPUT_INVALID'});
 const retained={...body,communication_choice:'RETAIN_CURRENT',sessions:[]};await assertP2016Schema('p2_016_takeover_completion_command',retained);
 const committed={state:'COMMITTED',ticket_id:input.ticket_id,ticket_version:6,ticket_event_id:randomUUID(),completion:{cycle_id:body.handling_cycle_id,cycle_no:1,event_id:randomUUID(),basis:'STAFF_COMPLETED'}};
 for(const valid of [{state:'UNKNOWN'},committed,{state:'FAILED',error:{code:'P2_016_ACTION_FAILED',retryable:false}}])await assertP2016Schema('p2_016_takeover_completion_receipt',valid);
 for(const invalid of [{state:'UNKNOWN',internal_process:body.internal_process},{...committed,sessions:[]},{...committed,completion:{...committed.completion,external_summary:body.external_summary}},{state:'FAILED',error:{code:'P2_016_ACTION_FAILED',retryable:true}}])await assert.rejects(()=>assertP2016Schema('p2_016_takeover_completion_receipt',invalid));
});
