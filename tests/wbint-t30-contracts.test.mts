import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {normalizeCommand,hash} from '../src/p2-012-domain-contracts.mjs';
test('T30 public command normalization preserves Unicode plain text and original intent while rejecting privilege fields',()=>{
  const body={action:'ADD_INTERNAL_NOTE',incident_id:randomUUID(),client_command_id:randomUUID(),expected_row_version:'9223372036854775807',reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:'😀'.repeat(2000)};
  assert.deepEqual(normalizeCommand(body),body);assert.equal(hash(body),hash(Object.fromEntries(Object.entries(body).reverse())));assert.notEqual(hash(body),hash({...body,text:'另一原意图'}));
  for(const changes of [{text:'😀'.repeat(2001)},{text:'x\ud800'},{text:' \t\n'},{text:'x\u007f'},{audience:'REPORTER_DIRECT'},{actor_kind:'HUMAN'},{reason_code:'OPERATOR_REVIEWED'},{expected_row_version:'9223372036854775808'}])assert.throws(()=>normalizeCommand({...body,...changes}),{code:'P2_012_INPUT_INVALID'});
  assert.throws(()=>normalizeCommand({...body,action:'RESOLVE_INCIDENT'}),{code:'P2_012_INPUT_INVALID'});
});
