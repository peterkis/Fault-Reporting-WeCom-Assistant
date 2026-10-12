import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT09IndependentFixture} from './helpers/t09-independent-fixture.mjs';
import type {T09IndependentFixture} from './helpers/t09-independent-fixture.mjs';
import {object,rows,text,version} from './helpers/t09-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {migrateTicketReturnToDispatch} from '../scripts/ticket-return-to-dispatch-migrate.mjs';
import {assertLocalDateTime} from '../src/platform/time-contract.mjs';

async function started(f:T09IndependentFixture){const handler=await f.http(2),admin=await f.http(0),ticketId=await f.createTicket(),path='/api/tickets/'+ticketId;
 await f.runtime.coordinator.runOnce();
 for(const action of ['accept','start','wait-vendor']){const before=await handler.get(path);assert.equal(before.status,200);const result=await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'T09_INDEPENDENT_'+action.replaceAll('-','_').toUpperCase()});assert.equal(result.status,200,JSON.stringify(result.value));}
 const before=await admin.get(path);assert.equal(before.status,200);assert.equal(before.value.status,'WAITING_VENDOR');assert.equal(before.value.assignee_id,f.handler);return{handler,admin,ticketId,path,before:before.value};}
const followUp=(v:number,scheduleVersion:string,action:'SET'|'CANCEL')=>({client_command_id:randomUUID(),expected_version:v,expected_schedule_version:scheduleVersion,reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,...(action==='SET'?{due_at:assertLocalDateTime('2030-01-02 09:30:00')}: {})});

test('a real started Ticket advertises the independent return action inside the closed published detail contract',async()=>{
 await withT09IndependentFixture(async f=>{const s=await started(f);assert.ok(Array.isArray(s.before.allowed_actions)&&s.before.allowed_actions.includes('return-to-dispatch'));await assertP2016Schema('p2_016_ticket_detail',s.before);});
});

test('T09 alone reads canonical related Sessions and submits one explicitly selected transfer without any T05/T06/T07/T08 capability',async()=>{
 await withT09IndependentFixture(async f=>{
  const s=await started(f),bootstrap=await s.admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.value.ticket_return_to_dispatch_enabled,true);
  for(const key of ['ticket_self_handling_enabled','ticket_conversation_self_handling_enabled','ticket_assignment_enabled','ticket_takeover_enabled','ticket_unassign_enabled'])assert.equal(bootstrap.value[key],false,key);
  const related=await s.admin.get(s.path+'/related-conversations');assert.equal(related.status,200,JSON.stringify(related.value));const first=rows(related.value.items)[0];assert.ok(first);const sessionId=text(first.session_id);
  const taken=await s.admin.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(text(first.session_row_version))),reason_code:'T09_INDEPENDENT_COMMUNICATOR'});assert.equal(taken.status,200,JSON.stringify(taken.value));
  const current=await s.admin.get(s.path+'/related-conversations');assert.equal(current.status,200);const selected=rows(current.value.items).find(row=>row.session_id===sessionId);assert.ok(selected&&selected.take_allowed===true);
  const target=await f.http(3),targetBootstrap=await target.get('/api/lifecycle/bootstrap');assert.equal(targetBootstrap.status,200);const targetId=text(targetBootstrap.value.principal_id);
  const eligible=await s.admin.get('/api/conversations/'+sessionId+'/eligible-principals');assert.equal(eligible.status,200);assert.ok(rows(eligible.value.items).some(row=>row.principal_id===targetId&&Array.isArray(row.actions)&&row.actions.includes('TRANSFER_TARGET')));
  const events=await s.admin.get(s.path+'/events?limit=200'),deliveries=await s.admin.get(s.path+'/deliveries');assert.equal(events.status,200);assert.equal(deliveries.status,200);
  const body={client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'独立停止处理。',unfinished_work:'合成设备仍未修复，显式交接沟通。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:targetId,sessions:[{session_id:sessionId,expected_row_version:version(Number(text(selected.session_row_version)))}]};
  const returned=await s.admin.post(s.path+'/return-to-dispatch',body);assert.equal(returned.status,200,JSON.stringify(returned.value));assert.equal(rows(returned.value.conversations).length,1);
  const after=await s.admin.get(s.path);assert.equal(after.status,200);assert.equal(after.value.status,'QUEUED');assert.equal(after.value.assignee_id,null);assert.equal(after.value.version,body.expected_version+1);assert.equal(after.value.resolver_team_id,s.before.resolver_team_id);assert.equal(after.value.intake_id,s.before.intake_id);assert.deepEqual(after.value.handling_cycle,s.before.handling_cycle);
  const responsibility=await s.admin.get(s.path+'/responsibility');assert.equal(responsibility.status,200);assert.equal(rows(responsibility.value.conversations).find(row=>row.session_id===sessionId)?.conversation_principal_id,targetId);assert.deepEqual((await s.admin.get(s.path+'/deliveries')).value,deliveries.value);
  const history=rows((await s.admin.get(s.path+'/events?limit=200')).value.items);assert.deepEqual(history.slice(0,-1),rows(events.value.items));assert.equal(history.at(-1)?.event_type,'ticket.returned_to_dispatch');
 });
});

for(const existing of [true,false])test(existing?'return migration after 049 preserves an existing real follow-up event and later cancellation':'return migration after 049 with empty follow-up history preserves future real schedule writes',async()=>{
 await withT09IndependentFixture(async f=>{
  const dispatcher=await f.http(1),ticketId=await f.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await f.pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='049_workbench_follow_up_schedules'")).rowCount,1);
  assert.equal((await f.pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='048_ticket_return_to_dispatch'")).rowCount,0);
  let current=(await dispatcher.get(path)).value,scheduleVersion='0';
  if(existing){const scheduled=await dispatcher.post(path+'/follow-up-schedule',followUp(version(current.version),'0','SET'));assert.equal(scheduled.status,200,JSON.stringify(scheduled.value));current=(await dispatcher.get(path)).value;scheduleVersion='1';}
  const before=(await dispatcher.get(path+'/events?limit=200')).value,stamp=(await f.pool.query("SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text FROM platform.schema_migration WHERE migration_id='049_workbench_follow_up_schedules'")).rows;
  console.log('T09_REVERSE_MIGRATION_PRECONDITION '+JSON.stringify({applied_049:true,existing_real_follow_up:existing,event_count:rows(before.items).length}));
  const migration=await migrateTicketReturnToDispatch({databaseUrl:f.databaseUrl,mode:'apply'});assert.equal(migration.status,'APPLIED');
  assert.deepEqual((await dispatcher.get(path)).value,current);assert.deepEqual((await dispatcher.get(path+'/events?limit=200')).value,before);assert.deepEqual((await f.pool.query("SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text FROM platform.schema_migration WHERE migration_id='049_workbench_follow_up_schedules'")).rows,stamp);
  const next=await dispatcher.post(path+'/follow-up-schedule',followUp(version(current.version),scheduleVersion,existing?'CANCEL':'SET'));assert.equal(next.status,200,JSON.stringify(next.value));
  const after=(await dispatcher.get(path)).value;assert.equal(after.status,current.status);assert.equal(after.assignee_id,current.assignee_id);assert.equal(after.resolver_team_id,current.resolver_team_id);assert.equal(after.version,version(current.version)+1);
  const events=rows((await dispatcher.get(path+'/events?limit=200')).value.items);assert.deepEqual(events.slice(0,-1),rows(before.items));assert.equal(events.at(-1)?.event_type,existing?'ticket.follow_up_cancelled':'ticket.follow_up_scheduled');
 },{returnEnabled:false,applyReturn:false,followUpEnabled:true});
});

test('T09 and existing follow-up compose on 049-first data, retaining both current facts through a real return',async()=>{
 await withT09IndependentFixture(async f=>{
  const s=await started(f),scheduled=await s.admin.post(s.path+'/follow-up-schedule',followUp(version(s.before.version),'0','SET'));assert.equal(scheduled.status,200,JSON.stringify(scheduled.value));
  const before=(await s.admin.get(s.path)).value,events=(await s.admin.get(s.path+'/events?limit=200')).value,deliveries=(await s.admin.get(s.path+'/deliveries')).value;
  const returned=await s.admin.post(s.path+'/return-to-dispatch',{client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'保留实际跟进事实并独立停止。',unfinished_work:'合成维修未完成。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});assert.equal(returned.status,200,JSON.stringify(returned.value));
  const after=(await s.admin.get(s.path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.deepEqual(after.handling_cycle,before.handling_cycle);assert.deepEqual((await s.admin.get(s.path+'/deliveries')).value,deliveries);
  const history=rows((await s.admin.get(s.path+'/events?limit=200')).value.items);assert.deepEqual(history.slice(0,-1),rows(events.items));assert.equal(history.at(-1)?.event_type,'ticket.returned_to_dispatch');assert.equal(history.filter(row=>row.event_type==='ticket.follow_up_scheduled').length,1);
 },{followUpEnabled:true});
});
