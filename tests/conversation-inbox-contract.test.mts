import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {conversationInboxCriteria} from '../app/server/src/workbench-conversation-inbox.mjs';
import {conversationReference} from '../app/server/src/conversation-topic-scope.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
test('inbox criteria are closed, bounded and preserve explicit origin filters',()=>{
  const url=(q:string)=>new URL('/api/workbench/conversation-inbox'+q,'http://127.0.0.1');
  assert.deepEqual(conversationInboxCriteria(url('')),{state:'open',source:'all',q:'',group:null,limit:30});
  for(const q of ['?target_id=x','?state=open&state=mine','?limit=101','?limit=0','?q='+('字'.repeat(129)),'?source=H5','?source_group_ref=raw-id','?q=%00'])assert.throws(()=>conversationInboxCriteria(url(q)));
});
test('contact and topic references separate purposes, bot accounts and real participants',()=>{
  const key='synthetic-only-identity-key',identity={provider:'WECOM_AIBOT',channel_account_id:'private-bot',participant_key:'private-person'};
  const contact=conversationReference(key,'contact',identity);assert.match(contact,/^cci_v1_[a-f0-9]{64}$/u);assert.equal(contact.includes('private'),false);
  assert.equal(contact,conversationReference(key,'contact',identity));assert.notEqual(contact,conversationReference(key,'contact',{...identity,participant_key:'another-person'}));assert.notEqual(contact,conversationReference(key,'contact',{...identity,channel_account_id:'another-bot'}));assert.notEqual(contact,conversationReference(key,'topic',identity,'journey:one'));
});

test('waiting projection accepts only explicit booleans and does not change existing cursor criteria',()=>{
  const url=(q:string)=>new URL('/api/workbench/conversation-inbox'+q,'http://127.0.0.1');
  for(const value of ['true','false'])assert.deepEqual(conversationInboxCriteria(url('?include_waiting_since='+value)),conversationInboxCriteria(url('')));
  for(const value of ['','1','TRUE','null','true&include_waiting_since=false'])assert.throws(()=>conversationInboxCriteria(url('?include_waiting_since='+value)));
});
test('the forward inbox schema rejects identity disclosure and retains explicit internal preview semantics',async()=>{
  const identity={provider:'WECOM_AIBOT',channel_account_id:'b',participant_key:'p'},contact={contact_ref:conversationReference('synthetic-key-for-test','contact',identity),participant_label:'合成报修人',department_label:null,anchor_session_id:randomUUID(),matching_topic_count:1,latest_activity_at:'2026-10-17 09:00:00',last_item_preview:null,unread_count:0,source_badges:[{kind:'group',label:'群名称未登记',ref:'a'.repeat(64)}],additional_source_count:0,assignment_summary:{kind:'UNASSIGNED',label:'待接待'},has_delivery_exception:false};
  await assertP2016Schema('workbench_conversation_inbox_page',{items:[contact],next_cursor:null});
  for(const waiting_since of [null,'2026-11-05 08:00:00'])await assertP2016Schema('workbench_conversation_inbox_page',{items:[{...contact,waiting_since}],next_cursor:null});
  for(const waiting_since of [0,'2026-02-30 08:00:00','2026-11-05T08:00:00+08:00'])await assert.rejects(assertP2016Schema('workbench_conversation_inbox_page',{items:[{...contact,waiting_since}],next_cursor:null}));
  for(const extra of [{participant_key:'canary'},{userid:'canary'},{target_id:'canary'}])await assert.rejects(assertP2016Schema('workbench_conversation_inbox_page',{items:[{...contact,...extra}],next_cursor:null}));
});

test('summary is a closed numeric read projection with a strict local calculation time',async()=>{
  const summary={unassigned_contact_count:0,my_unread_count:0,as_of:'2026-11-05 09:00:00'};
  await assertP2016Schema('workbench_conversation_inbox_summary',summary);
  for(const extra of [{unassigned_contact_count:-1},{my_unread_count:0.5},{my_unread_count:null},{as_of:'2026-02-30 09:00:00'},{as_of:'2026-11-05T09:00:00+08:00'},{principal_id:randomUUID()}])await assert.rejects(assertP2016Schema('workbench_conversation_inbox_summary',{...summary,...extra}));
});
