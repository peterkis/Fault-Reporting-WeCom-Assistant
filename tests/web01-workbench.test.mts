import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardColumn} from '../src/web01-workbench-query.mjs';
test('WEB01 grouping preserves terminal meaning and rejects unknown states',()=>{
  for(const state of ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'])assert.equal(boardColumn(state),'pending');
  for(const state of ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'])assert.equal(boardColumn(state),'active');
  for(const state of ['CLOSED','RESOLVED','CANCELLED','DUPLICATE_LINKED'])assert.equal(boardColumn(state),'closed');
  assert.throws(()=>boardColumn('fabricated'),{code:'P2_016_INPUT_INVALID'});
});
