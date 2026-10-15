import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supplementDispositionCommand,supplementTarget} from '../src/workbench-supplement-follow-up.mjs';
import {normalizeCommunicationCommand,computeCommunicationCommandHash} from '../src/p2-004-communication-core.mjs';
const target={ticket_id:'11111111-1111-4111-8111-111111111111',source_ref:'channel:2',revision:'2'};
const message={session_id:'22222222-2222-4222-8222-222222222222',expected_row_version:1,sender_kind:'AGENT' as const,purpose:'HUMAN_REPLY' as const,visibility:'EXTERNAL' as const,client_command_id:'33333333-3333-4333-8333-333333333333',text:'独立人工对外回复',privacy_class:'INTERNAL' as const,retention_until:'2099-01-01 00:00:00'};
test('T36 disposition contract counts Unicode characters and rejects implicit or additional actions',()=>{
 const body={client_command_id:message.client_command_id,action:'RECORD_DISPOSITION',source_ref:target.source_ref,revision:target.revision,disposition_note:'😀'.repeat(2000),mark_followed_up:true};
 assert.equal(supplementDispositionCommand(body).disposition_note,body.disposition_note);
 for(const invalid of [{...body,disposition_note:body.disposition_note+'😀'},{...body,disposition_note:'  '},{...body,mark_followed_up:false},{...body,external_text:'不可隐式外发'},{...body,revision:'9223372036854775808'}])assert.throws(()=>supplementDispositionCommand(invalid));
 assert.throws(()=>supplementTarget({source_ref:'channel:9223372036854775808',revision:'1'}));
});
test('T36 bound target is a frozen original command input and cannot be retroactively attached or removed',()=>{
 const caller={...target},normalized=normalizeCommunicationCommand({...message,follow_up_target:caller}),hash=computeCommunicationCommandHash(normalized);
 caller.source_ref='channel:3';caller.revision='3';assert.deepEqual(normalized.follow_up_target,target);assert.equal(computeCommunicationCommandHash(normalized),hash);
 assert.notEqual(hash,computeCommunicationCommandHash(message));assert.notEqual(hash,computeCommunicationCommandHash({...message,follow_up_target:{...target,revision:'3'}}));
 assert.notEqual(hash,computeCommunicationCommandHash({...message,follow_up_target:{...target,ticket_id:message.session_id}}));
});
test('T36 binding is closed and exclusive to explicit external AGENT HUMAN_REPLY',()=>{
 for(const follow_up_target of [{...target,actor_principal_id:message.client_command_id},{...target,source_ref:'ticket:2'},{...target,revision:'02'}])assert.throws(()=>normalizeCommunicationCommand({...message,follow_up_target}));
 assert.throws(()=>normalizeCommunicationCommand({...message,purpose:'INTERNAL_NOTE',visibility:'INTERNAL',follow_up_target:target}));
 assert.throws(()=>normalizeCommunicationCommand({...message,sender_kind:'SYSTEM',purpose:'SYSTEM_NOTIFICATION',follow_up_target:target}));
});
