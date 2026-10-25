import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {followCommand,followItem} from '../app/server/src/workbench-follow.mjs';
import {decodeFollowAttention,decodeFollowCommand,decodeFollowReceipt,decodeFollowResult,matchesFollowResult} from '../app/pc-admin/src/contracts/workbench-follow-browser-contracts.mjs';

test('T34 explicit personal intent rejects injected ownership, caller and source fields without changing the original UUID or basis',()=>{
 const body={client_command_id:randomUUID(),canonical_item:{kind:'ticket',id:randomUUID()},expected_follow_version:'a'.repeat(64),following:true};
 assert.deepEqual(followCommand(body),body);assert.deepEqual(followCommand({...body,following:false}),{...body,following:false});
 for(const change of [{actor_principal_id:randomUUID()},{assignee_id:randomUUID()},{source_intake_id:randomUUID()},{following:1},{following:'true'},{expected_follow_version:'a'.repeat(63)},{expected_follow_version:'A'.repeat(64)},{client_command_id:'not-a-uuid'},{canonical_item:{kind:'conversation',id:randomUUID()}},{canonical_item:{kind:'ticket',id:randomUUID(),owner:randomUUID()}}])
  assert.throws(()=>followCommand({...body,...change}),{code:'P2_016_INPUT_INVALID'});
 for(const kind of ['ticket','review','intake'])assert.deepEqual(followItem({kind,id:body.canonical_item.id}),{kind,id:body.canonical_item.id});
 assert.equal(body.client_command_id,followCommand(body).client_command_id);assert.equal(body.expected_follow_version,followCommand(body).expected_follow_version);
});

test('T34 the closed browser projection rejects private fields and inconsistent personal reasons',()=>{
 const attention={following:true,follow_version:'a'.repeat(64),related_reasons:['HANDLING','COMMUNICATION','FOLLOW']};
 assert.deepEqual(decodeFollowAttention(attention),attention);
 for(const change of [{principal_id:randomUUID()},{related_reasons:['FOLLOW','FOLLOW']},{related_reasons:['OWNER']},{following:false},{follow_version:'not-a-basis'}])assert.throws(()=>decodeFollowAttention({...attention,...change}),/FOLLOW_CONTRACT_INVALID/u);
});

test('T34 original acknowledgements bind their UUID, requested parent and original intent without trusting a current projection',()=>{
 const requested={kind:'review' as const,id:randomUUID()},canonical={kind:'ticket' as const,id:randomUUID()},command=decodeFollowCommand({client_command_id:randomUUID(),canonical_item:canonical,expected_follow_version:'b'.repeat(64),following:false});
 const original=decodeFollowResult({ok:true,client_command_id:command.client_command_id,requested_item:requested,canonical_item:canonical,following:false,follow_version:'c'.repeat(64),replayed:true});
 assert.equal(matchesFollowResult(command,original,requested),true);
 assert.equal(matchesFollowResult(command,{...original,following:true},requested),false);
 assert.equal(matchesFollowResult(command,{...original,client_command_id:randomUUID()},requested),false);
 const committed={client_command_id:command.client_command_id,requested_item:requested,state:'COMMITTED',result:original};
 assert.deepEqual(decodeFollowReceipt(committed,requested,command.client_command_id),committed);
 const unknown={client_command_id:command.client_command_id,requested_item:requested,state:'UNKNOWN'};
 assert.deepEqual(decodeFollowReceipt(unknown,requested,command.client_command_id),unknown);
 for(const changed of [{...committed,result:{...original,replayed:false}},{...unknown,private_result:original},{...unknown,requested_item:{kind:'ticket',id:randomUUID()}},{...unknown,client_command_id:randomUUID()}])assert.throws(()=>decodeFollowReceipt(changed,requested,command.client_command_id),/FOLLOW_CONTRACT_INVALID/u);
 const failed={client_command_id:command.client_command_id,requested_item:requested,state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}};
 assert.deepEqual(decodeFollowReceipt(failed,requested,command.client_command_id),failed);
 for(const code of ['1_INVALID','BAD-code',''])assert.throws(()=>decodeFollowReceipt({...failed,error:{code,retryable:false}},requested,command.client_command_id),/FOLLOW_CONTRACT_INVALID/u);
});
