import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {normalizeConversationHandlingCommand} from '../src/workbench-ticket-conversation-handling.mjs';

test('one identified self-handling intent preserves the explicit related communication choice and each version',()=>{
  const input={action:'take-and-start-with-conversations',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:randomUUID(),expected_row_version:3}]};
  assert.deepEqual(normalizeConversationHandlingCommand(input),input);
});
