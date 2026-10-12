import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {acceptedSetup,http,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';

test('T12 alone exposes its current cycle and canonical choices without enabling either legacy T07 or T11 commands',async()=>{
 await withT12Fixture(async f=>{
  const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_ONLY_START'})).status,200);
  const started=(await s.b.get(s.path)).value,basis=object(started.handling_cycle);
  await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),
   principalIds:[s.owner.id,f.outsider.id,s.actor.id],externalSendEnabled:false,ticketTakeoverCompletionEnabled:true,workbenchDraftRecoveryEnabled:true});
  try{const result=await runtime.start();assert.ok(result.cookies);const standalone={...f,runtime,cookies:result.cookies.map(c=>c.name+'='+c.value)},b=await http(standalone,2);
   const choices=await b.get(s.path+'/related-conversations');assert.equal(choices.status,200,JSON.stringify(choices.value));assert.ok(rows(choices.value.items).length>0);
   const current=await b.get(s.path);assert.equal(current.status,200);assert.equal(object(current.value.handling_cycle).id,basis.id);
   const bootstrap=(await b.get('/api/lifecycle/bootstrap')).value;assert.equal(bootstrap.ticket_takeover_completion_enabled,true);assert.equal(bootstrap.ticket_takeover_completion_draft_recovery_enabled,true);
   assert.equal(bootstrap.ticket_takeover_enabled,false);assert.equal(bootstrap.ticket_staff_completion_enabled,false);assert.equal(bootstrap.ticket_conversation_self_handling_enabled,false);
   assert.equal((await b.get(s.path+'/takeover-targets')).status,503);
   assert.equal((await b.post(s.path+'/complete',{client_command_id:randomUUID(),expected_version:version(started.version),reason_code:'STAFF_COMPLETED',handling_cycle_id:text(basis.id),internal_process:'独立合成过程',external_summary:'服务恢复。',external_summary_confirmed:true})).status,503);
   const command={client_command_id:randomUUID(),expected_version:version(started.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(basis.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_ONLY_PRIVATE',external_summary:'服务已经恢复。',external_summary_confirmed:true};
   const committed=await b.post(s.path+'/takeover-and-complete',command);assert.equal(committed.status,200,JSON.stringify(committed.value));
   assert.equal((await b.get(s.path)).value.status,'CLOSED');assert.equal((await b.get(s.path+'/takeover-completion/commands/'+command.client_command_id)).value.state,'COMMITTED');
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 });
});

test('omitted and literal false T12 options avoid both new migrations and expose no composite write or ACK',async()=>{
 for(const option of [{},{ticketTakeoverCompletionEnabled:false}])await withWeb01Fixture(async(f:T11Fixture)=>{
  await f.runtime.stop();const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,
   listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??''],externalSendEnabled:false,workbenchDraftRecoveryEnabled:true,...option});
  try{const result=await runtime.start();assert.ok(result.cookies);const a=await http({...f,runtime,cookies:result.cookies.map(c=>c.name+'='+c.value)},0),first=f.tickets[0];assert.ok(first);
   const path='/api/tickets/'+first.ticket.id,before=(await a.get(path)).value;
   const relations=(await f.pool.query("SELECT to_regclass('pilot_ticket.ticket_handling_cycle') AS cycle,to_regclass('pilot_ticket.staff_completion_notification_commitment') AS commitment")).rows[0];assert.deepEqual(relations,{cycle:null,commitment:null});
   assert.equal((await a.get(path+'/takeover-completion-targets')).status,503);assert.equal((await a.get(path+'/takeover-completion/commands/'+randomUUID())).status,503);
   assert.equal((await a.post(path+'/takeover-and-complete',{client_command_id:randomUUID(),expected_version:version(before.version)})).status,503);
   const bootstrap=(await a.get('/api/lifecycle/bootstrap')).value;assert.equal(bootstrap.ticket_takeover_completion_enabled,false);assert.equal(bootstrap.ticket_takeover_completion_draft_recovery_enabled,false);
   assert.deepEqual((await a.get(path)).value,before);assert.equal((await f.pool.query("SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_TICKET_TAKEOVER_COMPLETION'")).rowCount,0);
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 });
});

for(const install039 of [false,true])test('enabled composite fails readiness and public commands before any receipt when '+(install039?'040 is absent':'039 and 040 are absent'),async()=>{
 await withWeb01Fixture(async(f:T11Fixture)=>{
  await f.runtime.stop();const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,
   listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??''],externalSendEnabled:false,ticketTakeoverCompletionEnabled:true,workbenchDraftRecoveryEnabled:true});
  try{const result=await runtime.start();assert.ok(result.cookies);const a=await http({...f,runtime,cookies:result.cookies.map(c=>c.name+'='+c.value)},0),first=f.tickets[0];assert.ok(first);
   const path='/api/tickets/'+first.ticket.id,before=(await f.pool.query('SELECT * FROM pilot_ticket.ticket WHERE id=$1::uuid',[first.ticket.id])).rows;
   const ready=await a.get('/health/ready');assert.equal(ready.status,503);assert.equal(object(ready.value.checks).ticket_takeover_completion_schema,false);
   assert.equal((await a.get(path+'/takeover-completion-targets')).status,503);assert.equal((await a.get(path+'/takeover-completion/commands/'+randomUUID())).status,503);
   const response=await a.post(path+'/takeover-and-complete',{client_command_id:randomUUID(),expected_version:2,reason_code:'STAFF_COMPLETED',resolver_team_id:'PILOT_IT',handling_cycle_id:randomUUID(),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'合成过程',external_summary:'安全结果',external_summary_confirmed:true});
   assert.equal(response.status,503);assert.equal(object(response.value.error).code,'P2_016_STAFF_COMPLETION_UNAVAILABLE');
   assert.deepEqual((await f.pool.query('SELECT * FROM pilot_ticket.ticket WHERE id=$1::uuid',[first.ticket.id])).rows,before);
   assert.equal((await f.pool.query("SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_TICKET_TAKEOVER_COMPLETION'")).rowCount,0);
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 },{ticketSelfHandlingEnabled:install039});
});
