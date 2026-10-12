import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT09IndependentFixture} from './helpers/t09-independent-fixture.mjs';
import {object,version} from './helpers/t09-fixture.mjs';

const body=(v:number)=>({client_command_id:randomUUID(),expected_version:v,reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'默认关闭或缺少真实迁移标记须拒绝。',unfinished_work:'合成维修尚未完成。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});

test('omitting the production T09 option keeps capability and recovery false without 048 and cannot create a return receipt',async()=>{
 await withT09IndependentFixture(async f=>{
  const admin=await f.http(0),handler=await f.http(2),path='/api/tickets/'+await f.createTicket(),bootstrap=await admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.value.ticket_return_to_dispatch_enabled,false);assert.equal(bootstrap.value.ticket_return_to_dispatch_draft_recovery_enabled,false);
  assert.equal((await f.pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('048_ticket_return_to_dispatch','057_ticket_return_follow_up_compatibility')")).rowCount,0);
  for(const action of ['accept','start','wait-vendor']){const before=await handler.get(path);assert.equal(before.status,200);assert.equal((await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'T09_DEFAULT_REAL_'+action.replaceAll('-','_').toUpperCase()})).status,200);}
  const before=(await admin.get(path)).value,events=(await admin.get(path+'/events?limit=200')).value,deliveries=(await admin.get(path+'/deliveries')).value,command=body(version(before.version));assert.equal(before.status,'WAITING_VENDOR');assert.ok(Array.isArray(before.allowed_actions));assert.equal(before.allowed_actions.includes('return-to-dispatch'),false);
  const refused=await admin.post(path+'/return-to-dispatch',command);assert.equal(refused.status,503);assert.equal(object(refused.value.error).code,'P2_016_DISABLED');
  const ack=await admin.get(path+'/return-to-dispatch/commands/'+command.client_command_id);assert.equal(ack.status,200);assert.deepEqual(ack.value,{state:'UNKNOWN'});
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/events?limit=200')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rowCount,0);
 },{omitReturnOption:true,applyReturn:false});
});

for(const followUp of [false,true])test(followUp?'049-first T09 needs its real 057 stamp while safe ACK remains a currently authorized READ':'legacy T09 needs its real 048 stamp while safe ACK remains a currently authorized READ',async()=>{
 await withT09IndependentFixture(async f=>{
  const admin=await f.http(0),ticketId=await f.createTicket(),path='/api/tickets/'+ticketId,migration=followUp?'057_ticket_return_follow_up_compatibility':'048_ticket_return_to_dispatch';
  assert.equal((await f.pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[migration])).rowCount,1);
  const before=await f.pool.query('SELECT id::text,status,assignee_id::text,resolver_team_id,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId]),events=await f.pool.query('SELECT event_id::text,event_type,aggregate_version FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY event_ordinal',[ticketId]);
  // Explicit isolated catalog fault; business rows and the original migration files are never manufactured or rewritten.
  assert.equal((await f.pool.query('DELETE FROM platform.schema_migration WHERE migration_id=$1',[migration])).rowCount,1);
  const command=body(1);for(const response of [await admin.get(path),await admin.post(path+'/return-to-dispatch',command)]){assert.equal(response.status,503);assert.equal(object(response.value.error).code,'P2_016_RETURN_TO_DISPATCH_UNAVAILABLE');}
  const ack=await admin.get(path+'/return-to-dispatch/commands/'+command.client_command_id);assert.equal(ack.status,200);assert.deepEqual(ack.value,{state:'UNKNOWN'});
  assert.deepEqual((await f.pool.query('SELECT id::text,status,assignee_id::text,resolver_team_id,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows,before.rows);assert.deepEqual((await f.pool.query('SELECT event_id::text,event_type,aggregate_version FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY event_ordinal',[ticketId])).rows,events.rows);assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rowCount,0);
 },{followUpEnabled:followUp});
});
