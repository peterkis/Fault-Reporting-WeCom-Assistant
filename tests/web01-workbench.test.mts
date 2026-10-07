import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardColumn} from '../src/web01-workbench-query.mjs';
import {sourceGroupNameCommand,sourceLabel} from '../src/workbench-source-groups.mjs';
test('WEB01 grouping preserves terminal meaning and rejects unknown states',()=>{
  for(const state of ['NEW','QUEUED','ACCEPTED','REOPENED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'])assert.equal(boardColumn(state),'pending');
  for(const state of ['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'])assert.equal(boardColumn(state),'active');
  for(const state of ['CLOSED','RESOLVED','CANCELLED','DUPLICATE_LINKED'])assert.equal(boardColumn(state),'closed');
  assert.throws(()=>boardColumn('fabricated'),{code:'P2_016_INPUT_INVALID'});
});
test('source group naming validates bounded text and decimal versions without losing precision',()=>{
  const command={client_command_id:'b5533980-45b3-49d5-9843-5c9ddcda132a',expected_row_version:'9007199254740993',display_name:' 信息科支持群 '};
  assert.equal(sourceGroupNameCommand(command).expected_row_version,'9007199254740993');
  assert.equal(sourceGroupNameCommand(command).display_name,'信息科支持群');
  for(const display_name of ['', ' '.repeat(2),'a'.repeat(129),'不可\n换行'])assert.throws(()=>sourceGroupNameCommand({...command,display_name}),{code:'P2_016_INPUT_INVALID'});
  for(const expected_row_version of ['-1','01',1,'9223372036854775807'])assert.throws(()=>sourceGroupNameCommand({...command,expected_row_version}),{code:'P2_016_INPUT_INVALID'});
  assert.throws(()=>sourceGroupNameCommand({...command,chatid:'client-injected'}),{code:'P2_016_INPUT_INVALID'});
  assert.equal(sourceLabel('WECOM_GROUP'),'群聊报修 · 群名称未登记');
  assert.equal(sourceLabel('WECOM_GROUP','信息科支持群'),'群聊报修 · 信息科支持群');
  assert.equal(sourceLabel('WECOM_DIRECT'),'Bot 私聊');
});
