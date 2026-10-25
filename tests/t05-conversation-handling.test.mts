import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {normalizeConversationHandlingCommand} from '../app/server/src/workbench-ticket-conversation-handling.mjs';

test('one identified self-handling intent preserves the explicit related communication choice and each version',()=>{
  const input={action:'take-and-start-with-conversations',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:randomUUID(),expected_row_version:3}]};
  assert.deepEqual(normalizeConversationHandlingCommand(input),input);
});

const intent=()=>({action:'take-and-start-with-conversations',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:randomUUID(),expected_row_version:3}]});
test('a closed command rejects actor force arbitrary keys and invalid exact versions',()=>{
  for(const value of [{...intent(),force:true},{...intent(),target_principal_id:randomUUID()},{...intent(),actor_principal_id:randomUUID()},{...intent(),expected_version:'2'}, {...intent(),sessions:[{session_id:randomUUID(),expected_row_version:'9007199254740993'}]},{...intent(),sessions:[{session_id:randomUUID(),expected_row_version:2147483648}]},{...intent(),sessions:[{session_id:randomUUID(),expected_row_version:0}]}])assert.throws(()=>normalizeConversationHandlingCommand(value),/P2_016_INPUT_INVALID/u);
});
test('retain is explicit and selection is bounded unique and case canonical',()=>{
  assert.equal(normalizeConversationHandlingCommand({...intent(),communication_choice:'RETAIN_CURRENT',sessions:[]}).communication_choice,'RETAIN_CURRENT');
  const duplicate=randomUUID();
  for(const value of [{...intent(),communication_choice:'RETAIN_CURRENT'},{...intent(),sessions:[]},{...intent(),sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))},{...intent(),sessions:[{session_id:duplicate,expected_row_version:1},{session_id:duplicate.toUpperCase(),expected_row_version:1}]}])assert.throws(()=>normalizeConversationHandlingCommand(value),/P2_016_INPUT_INVALID/u);
});
test('a caller cannot mutate the immutable identified command or execute accessors',()=>{
  const input=intent(),output=normalizeConversationHandlingCommand(input);input.sessions.length=0;
  assert.equal(output.sessions.length,1);assert.ok(Object.isFrozen(output)&&Object.isFrozen(output.sessions)&&Object.isFrozen(output.sessions[0]));
  let invoked=0;const accessor={...intent()};Object.defineProperty(accessor,'communication_choice',{enumerable:true,get(){invoked++;return 'TAKE_SELECTED';}});
  assert.throws(()=>normalizeConversationHandlingCommand(accessor),/P2_016_INPUT_INVALID/u);assert.equal(invoked,0);
});
