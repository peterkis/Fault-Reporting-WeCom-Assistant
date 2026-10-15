import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
test('T36 entry OFF forbids a new bound write but an existing Message receipt retains current exact READ checks',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 const id=randomUUID(),command={client_command_id:id,expected_row_version:f.rowVersion,text:'T36原消息OFF后只读核对',follow_up_target:{ticket_id:f.ticketId,...f.r2}};
 const accepted=await f.postReply(command);assert.equal(accepted.status,202);const original=await accepted.json() as {message_id:string};await f.disableEntry();
 assert.equal((await f.get('/api/tickets/'+f.ticketId)).status,200);assert.equal((await f.get('/api/workbench/conversations/'+f.sessionId)).status,200);assert.equal((await f.get('/api/tickets/'+f.ticketId+'/supplement-follow-up')).status,404);
 const receipt=await f.get('/api/workbench/conversations/'+f.sessionId+'/messages/commands/'+id);console.log('T36_ENTRY_OFF_OLD_RECEIPT '+receipt.status);assert.equal(receipt.status,200);const body=await receipt.json() as {state:string;result:{message_id:string}};assert.equal(body.state,'COMMITTED');assert.equal(body.result.message_id,original.message_id);
 const current=await f.read<{session:{row_version:number}}>('/api/workbench/conversations/'+f.sessionId),blocked=await f.postReply({...command,client_command_id:randomUUID(),expected_row_version:current.session.row_version});assert.equal(blocked.status,404);await blocked.arrayBuffer();
 const facts=await f.pool.query<{n:string}>('SELECT count(*)::text AS n FROM pilot_ticket.workbench_supplement_reply_binding WHERE ticket_id=$1::uuid',[f.ticketId]);assert.equal(facts.rows[0]?.n,'1');
 await f.expire(f.r2);assert.equal((await f.get('/api/workbench/conversations/'+f.sessionId+'/messages/commands/'+id)).status,404);
}));
