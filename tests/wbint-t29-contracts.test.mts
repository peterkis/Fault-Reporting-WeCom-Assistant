import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {normalizeCommand,hash} from '../src/p2-012-domain-contracts.mjs';
test('T29 owner intent keeps explicit null, maximum BIGINT version and original stable hashing',()=>{
  const body={action:'TRANSFER_OWNER',incident_id:randomUUID(),client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:'9223372036854775807',owner_principal_id:randomUUID(),owner_team_id:null};
  assert.deepEqual(normalizeCommand(body),body);assert.equal(hash(body),hash(Object.fromEntries(Object.entries(body).reverse())));assert.notEqual(hash(body),hash({...body,owner_team_id:'PILOT_IT'}));
  for(const change of [{expected_row_version:'9223372036854775808'},{expected_row_version:'01'},{owner_team_id:'NONE'},{owner_team_id:'lower-case'},{owner_principal_id:'not-a-principal'},{reason_code:'WORKBENCH_INTERNAL_DISPOSITION'},{actor_principal_id:randomUUID()},{incident_status:'CLOSED'},{owner_team_id:undefined}])assert.throws(()=>normalizeCommand({...body,...change}),{code:'P2_012_INPUT_INVALID'});
  const {owner_team_id,...missing}=body;assert.equal(owner_team_id,null);assert.throws(()=>normalizeCommand(missing),{code:'P2_012_INPUT_INVALID'});
});
