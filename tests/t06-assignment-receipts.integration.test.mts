import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}

test('MVP assignment acknowledgement remains read only with draft storage disabled',async()=>{
 await withWeb01Fixture(async(context:Fixture)=>{
  const ticket=context.tickets[0],target=context.principals[1],cookie=context.cookies[0],other=context.cookies[2];assert.ok(ticket&&target&&cookie&&other);
  const path='/api/tickets/'+ticket.ticket.id,bootResponse=await fetch(context.origin+'/api/lifecycle/bootstrap',{headers:{cookie}}),boot=object(await bootResponse.json());
  assert.equal(boot.ticket_assignment_enabled,true);assert.equal(boot.ticket_assignment_draft_recovery_enabled,false);
  const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
  const committed=await fetch(context.origin+path+'/assign',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':String(boot.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"2"'},body:JSON.stringify(command)});assert.equal(committed.status,200);const result=object(await committed.json());
  const before=await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt');
  for(const [identity,expected]of [[cookie,'COMMITTED'],[other,'UNKNOWN']] as const){const response=await fetch(context.origin+path+'/assignment/commands/'+command.client_command_id,{headers:{cookie:identity}});assert.equal(response.status,200);const receipt=object(await response.json());assert.equal(receipt.state,expected);await assertP2016Schema('p2_016_assignment_receipt',receipt);if(expected==='COMMITTED')assert.deepEqual(receipt,{state:'COMMITTED',ticket_id:ticket.ticket.id,ticket_version:3,ticket_event_id:result.ticket_event_id});}
  assert.deepEqual((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows,before.rows);
 },{ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:false});
});
test('current principal Ticket and assignment purpose give a read-only safe acknowledgement without lending communication authority',async()=>{
 await withWeb01Fixture(async(context:Fixture)=>{
  const first=context.tickets[0],other=context.tickets[1],target=context.principals[1],next=context.principals[2],actor=context.principals[0],cookie=context.cookies[0],worker=context.cookies[2],outsider=context.cookies[1];assert.ok(first&&other&&target&&next&&actor&&cookie&&worker&&outsider);const path='/api/tickets/'+first.ticket.id;
  const get=async(url:string,current=cookie)=>{const response=await fetch(context.origin+url,{headers:{cookie:current}});return {status:response.status,value:object(await response.json())};};
  const bootstrap=(await get('/api/lifecycle/bootstrap')).value;
  const post=async(url:string,command:Record<string,unknown>)=>{const response=await fetch(context.origin+url,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':String(command.client_command_id),'if-match':'"'+command.expected_version+'"'},body:JSON.stringify(command)});return {status:response.status,value:object(await response.json())};};
  const original={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};const committed=await post(path+'/assign',original);assert.equal(committed.status,200);const receiptPath=path+'/assignment/commands/'+original.client_command_id;
  const before=(await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows;const receipt=await get(receiptPath);console.log('T06_ASSIGNMENT_RECEIPT_ENTRY '+JSON.stringify({status:receipt.status,recovery_enabled:bootstrap.ticket_assignment_draft_recovery_enabled}));assert.equal(receipt.status,200,JSON.stringify(receipt.value));assert.equal(bootstrap.ticket_assignment_draft_recovery_enabled,true);
  assert.deepEqual(receipt.value,{state:'COMMITTED',ticket_id:first.ticket.id,ticket_version:3,ticket_event_id:committed.value.ticket_event_id});await assertP2016Schema('p2_016_assignment_receipt',receipt.value);assert.deepEqual((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows,before);
  assert.deepEqual((await get(receiptPath,worker)).value,{state:'UNKNOWN'});assert.deepEqual((await get('/api/tickets/'+other.ticket.id+'/assignment/commands/'+original.client_command_id)).value,{state:'UNKNOWN'});assert.deepEqual((await get(path+'/assignment/commands/'+randomUUID())).value,{state:'UNKNOWN'});assert.equal((await get(receiptPath,outsider)).status,404);assert.equal((await get(receiptPath+'?target_principal_id='+target.id)).status,400);
  const note={client_command_id:randomUUID(),expected_version:3,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T06 receipt purpose privacy canary',external_visible:false};assert.equal((await post(path+'/internal-notes',note)).status,200);assert.deepEqual((await get(path+'/assignment/commands/'+note.client_command_id)).value,{state:'UNKNOWN'});
  const failed={...original,client_command_id:randomUUID(),target_principal_id:next.id};assert.equal((await post(path+'/transfer-assignment',failed)).status,409);const failure=(await get(path+'/assignment/commands/'+failed.client_command_id)).value;assert.deepEqual(failure,{state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}});await assertP2016Schema('p2_016_assignment_receipt',failure);
  await context.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[actor.id]);assert.ok([401,403,404].includes((await get(receiptPath)).status),'a receipt never retains revoked access');
 },{ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true,workbenchInternalNotesEnabled:true});
});
