import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readBoardIntent,planBoardAction} from '../app/pc-admin/src/contracts/workbench-board-action-browser-contracts.mjs';

test('T42 local intent is closed and immutable, never a state, identity or command authority',()=>{
  const input={kind:'ticket',id:'11111111-1111-4111-8111-111111111111',source_column:'pending',target_column:'active'};
  const intent=readBoardIntent(input);assert.ok(intent);assert.equal(Object.isFrozen(intent),true);
  input.id='22222222-2222-4222-8222-222222222222';input.target_column='closed';
  assert.equal(intent.id,'11111111-1111-4111-8111-111111111111');assert.equal(intent.target_column,'active');
  for(const extra of [{actor_principal_id:input.id},{expected_version:1},{client_command_id:input.id},{status:'IN_PROGRESS'},{note:'private input'}])assert.equal(readBoardIntent({...input,...extra}),null);
  for(const value of [null,[],{...input,kind:'incident'},{...input,id:'opaque'},{...input,target_column:'done'}])assert.equal(readBoardIntent(value),null);
  assert.equal(planBoardAction(intent).state,'OPEN_EXISTING_FORM');
  const same=readBoardIntent({...input,source_column:'closed',target_column:'closed'});assert.ok(same);assert.equal(planBoardAction(same).state,'NO_CHANGE');
  const illegal=readBoardIntent({...input,source_column:'pending',target_column:'closed'});assert.ok(illegal);assert.deepEqual(planBoardAction(illegal),{state:'UNAVAILABLE',intent:illegal,reason:'INVALID_TRANSITION'});
  const review=readBoardIntent({...input,kind:'review',source_column:'pending',target_column:'active'});assert.ok(review);assert.deepEqual(planBoardAction(review),{state:'OPEN_EXISTING_FORM',intent:review,action:'REVIEW_RESOLVE_AND_START'});
});
