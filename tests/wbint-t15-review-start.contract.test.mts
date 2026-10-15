import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {normalizeReviewStartCommand} from '../src/workbench-review-start.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

function command(){return {client_command_id:randomUUID(),expected_row_version:'9007199254740993',expected_material_basis:'a'.repeat(64),
  resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'CLEAR_FAULT_HUMAN_CONFIRMED',expected_ticket:{ticket_id:randomUUID(),expected_version:2},
  resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:randomUUID(),expected_row_version:1}]};}

test('T15 preserves every safe numeric capture allowed by its frozen wire contract',async()=>{
  const captured=command(),large={...captured,expected_ticket:{...captured.expected_ticket,expected_version:Number.MAX_SAFE_INTEGER},
    sessions:[{...captured.sessions[0],expected_row_version:Number.MAX_SAFE_INTEGER}]};
  await assertP2016Schema('workbench_review_resolve_and_start_command',large);
  const normalized=normalizeReviewStartCommand(large);
  assert.equal(normalized.expected_ticket?.expected_version,Number.MAX_SAFE_INTEGER);
  assert.equal(normalized.sessions[0]?.expected_row_version,Number.MAX_SAFE_INTEGER);
});

test('T15 captures exact BIGINT review identity and immutable original responsibility choices',async()=>{
  const input=command();await assertP2016Schema('workbench_review_resolve_and_start_command',input);
  const normalized=normalizeReviewStartCommand(input);assert.equal(normalized.expected_row_version,'9007199254740993');
  input.expected_ticket.expected_version=9;const first=input.sessions[0];assert.ok(first);first.expected_row_version=7;
  assert.equal(normalized.expected_ticket?.expected_version,2);assert.equal(normalized.sessions[0]?.expected_row_version,1);
  assert.ok(Object.isFrozen(normalized)&&Object.isFrozen(normalized.expected_ticket)&&Object.isFrozen(normalized.sessions)&&Object.isFrozen(normalized.sessions[0]));
  const retained={...command(),communication_choice:'RETAIN_CURRENT',sessions:[]};await assertP2016Schema('workbench_review_resolve_and_start_command',retained);
  assert.deepEqual(normalizeReviewStartCommand(retained).sessions,[]);
});

test('T15 closed command denies injected authority and ambiguous or unbounded selections',()=>{
  const input=command(),first=input.sessions[0];assert.ok(first);
  for(const patch of [{actor_principal_id:randomUUID()},{target_principal_id:randomUUID()},{force:true},{status:'IN_PROGRESS'},
    {resolution_code:'REQUEST_DESCRIPTION'},{expected_row_version:1},{expected_row_version:'9223372036854775808'},
    {expected_material_basis:'not-the-read-material'},{expected_ticket:{...input.expected_ticket,extra:true}},
    {communication_choice:'TAKE_SELECTED',sessions:[]},{communication_choice:'RETAIN_CURRENT'},
    {sessions:[first,{...first,session_id:first.session_id.toUpperCase()}]},
    {sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))},
    {sessions:[{session_id:first.session_id,expected_row_version:1.5}]},{sessions:[{session_id:first.session_id,expected_row_version:Number.MAX_SAFE_INTEGER+1}]}]){
    assert.throws(()=>normalizeReviewStartCommand({...input,...patch}),{code:'P2_016_INPUT_INVALID'});
  }
});
