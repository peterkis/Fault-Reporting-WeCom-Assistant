import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getTicketActionTransitions} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {normalizeCompletionCommand} from '../app/server/src/workbench-ticket-completion.mjs';
import {randomUUID} from 'node:crypto';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

test('staff completion is an explicit Core Action that closes active work without Reporter confirmation',()=>{
  assert.equal(getTicketActionTransitions().some(value=>value.action==='complete'),false);
  assert.deepEqual(getTicketActionTransitions({staffCompletionEnabled:true}).find(value=>value.action==='complete'),{
    action:'complete',from:['IN_PROGRESS'],to:'CLOSED',event_type:'ticket.closed',
  });
  assert.deepEqual(getTicketActionTransitions().find(value=>value.action==='confirm')?.from,['RESOLVED']);
});

test('completion schemas close safe receipts and admit only explicitly confirmed public commands and cycle references',async()=>{
  const ticket=randomUUID(),cycle=randomUUID(),event=randomUUID(),base={client_command_id:randomUUID(),ticket_id:ticket};
  await assertP2016Schema('p2_016_ticket_detail',{id:ticket,ticket_no:'TEST',request_type:'INCIDENT',status:'IN_PROGRESS',priority:'NORMAL',resolver_team_id:'PILOT_IT',assignee_id:randomUUID(),version:4,created_at:'2026-10-08 10:00:00',updated_at:'2026-10-08 10:00:00',intake_id:randomUUID(),external_status:'PROCESSING',allowed_actions:['complete'],handling_cycle:{id:cycle,cycle_no:1,first_responsibility_event_id:event,staff_completion_event_id:null}});
  const command={client_command_id:base.client_command_id,expected_version:4,reason_code:'STAFF_COMPLETED',handling_cycle_id:cycle,internal_process:'private work',external_summary:'safe summary',external_summary_confirmed:true};
  await assertP2016Schema('p2_016_completion_command',command);
  for(const patch of [{external_summary_confirmed:false},{actor:'REPORTER'},{client_command_id:'not-a-uuid'},{external_summary:'x'.repeat(501)},{internal_process:' '}])await assert.rejects(assertP2016Schema('p2_016_completion_command',{...command,...patch}));
  const committed={...base,state:'COMMITTED',result:{ok:true,ticket_id:ticket,ticket_version:5,ticket_event_id:event,control_event_id:null,replayed:true,completion:{cycle_id:cycle,cycle_no:1,event_id:event,basis:'STAFF_COMPLETED'}}},failed={...base,state:'FAILED',error:{code:'P2_016_ACTION_FAILED',retryable:false}};
  for(const replayed of [false,true])await assertP2016Schema('p2_016_completion_result',{...committed.result,replayed});
  for(const patch of [{internal_process:'private'},{completion:{...committed.result.completion,operator_id:randomUUID()}},{control_event_id:randomUUID()},{ticket_version:'5'},{completion:{...committed.result.completion,basis:'REQUESTER_CONFIRMED'}}])await assert.rejects(assertP2016Schema('p2_016_completion_result',{...committed.result,...patch}));
  for(const value of [{...base,state:'UNKNOWN'},committed,failed])await assertP2016Schema('p2_016_completion_receipt',value);
  for(const value of [{...base,state:'UNKNOWN',result:committed.result},{...committed,internal_process:'private'},{...committed,error:failed.error},{...committed,result:{...committed.result,completion:{...committed.result.completion,operator_id:randomUUID()}}},{...failed,error:{...failed.error,retryable:true}}])await assert.rejects(assertP2016Schema('p2_016_completion_receipt',value));
});

test('completion contract requires independent confirmed bounded summaries and rejects identity injection without invoking hooks',()=>{
  const body={action:'complete',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:1,reason_code:'STAFF_COMPLETED',handling_cycle_id:randomUUID(),internal_process:'private work',external_summary:'safe result',external_summary_confirmed:true};
  assert.deepEqual(normalizeCompletionCommand(body),body);
  for(const patch of [{actor:'REPORTER'},{ticket_id:'x'},{handling_cycle_id:1},{expected_version:'1'},{expected_version:2147483648},{internal_process:' '},{internal_process:'x'.repeat(2001)},{external_summary:''},{external_summary:'x'.repeat(501)},{external_summary_confirmed:false},{reason_code:'REQUESTER_CONFIRMED'},{source_intake_id:randomUUID()},{recipient:'another'},{note:'legacy'}])assert.throws(()=>normalizeCompletionCommand({...body,...patch}),{code:'P2_016_INPUT_INVALID'});
  let calls=0;const active=Object.defineProperty({...body},'external_summary',{enumerable:true,get(){calls++;return 'side effect';}});assert.throws(()=>normalizeCompletionCommand(active),{code:'P2_016_INPUT_INVALID'});assert.equal(calls,0);
});
