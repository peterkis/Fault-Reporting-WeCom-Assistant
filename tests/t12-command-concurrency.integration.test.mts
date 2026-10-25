import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';

for(const kind of ['same UUID','different UUIDs','different actors sharing a UUID'] as const){
 test('real concurrent '+kind+' yield one composite staff end, original cycle and immutable replay capture',async()=>{
  await withT12Fixture(async f=>{
   const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_RACE_START'})).status,200);
   if(kind==='different actors sharing a UUID')assert.equal((await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT','T07_NETWORK']})).id,s.owner.id);
   const before=(await s.b.get(s.path)).value,cycle=object(before.handling_cycle),prior=rows((await s.a.get(s.path+'/events')).value.items),communication=(await s.a.get(s.path+'/responsibility')).value.conversations;
   assert.deepEqual((await s.b.get(s.path+'/takeover-completion-targets?resolver_team_id=T07_NETWORK')).value.allowed_actions,['takeover-and-complete']);
   const body={client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_RACE_PRIVATE_CANARY',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true};
   const bodies=kind==='same UUID'?[body,body,body,body]:kind==='different UUIDs'?[body,{...body,client_command_id:randomUUID()}]:[body,body];
   const clients=kind==='different actors sharing a UUID'?[s.a,s.b]:bodies.map(()=>s.b);
   if(kind==='different actors sharing a UUID')assert.deepEqual((await s.a.get(s.path+'/takeover-completion-targets?resolver_team_id=T07_NETWORK')).value.allowed_actions,['takeover-and-complete']);
   const responses=await Promise.all(bodies.map((command,index)=>{const client=clients[index];assert.ok(client);return client.post(s.path+'/takeover-and-complete',command);}));
   if(kind==='same UUID'){assert.ok(responses.every(reply=>reply.status===200));assert.equal(responses.filter(reply=>reply.value.replayed===false).length,1);assert.equal(new Set(responses.map(reply=>reply.value.ticket_event_id)).size,1);}
   else assert.deepEqual(responses.map(reply=>reply.status).sort(),[200,409]);
   const winner=responses.findIndex(reply=>reply.status===200&&reply.value.replayed===false);assert.ok(winner>=0);const client=clients[winner],capture=bodies[winner],result=responses[winner];assert.ok(client&&capture&&result);
   const actorId=kind==='different actors sharing a UUID'&&winner===0?s.owner.id:s.actor.id;
   const after=(await client.get(s.path)).value,ended=object(after.handling_cycle);assert.equal(after.status,'CLOSED');assert.equal(after.version,body.expected_version+2);assert.equal(after.assignee_id,actorId);assert.equal(after.resolver_team_id,'T07_NETWORK');assert.equal(ended.id,cycle.id);assert.equal(ended.first_responsibility_event_id,cycle.first_responsibility_event_id);
   const events=(await s.a.get(s.path+'/events')).value,all=rows(events.items);assert.deepEqual(all.slice(0,prior.length),prior);assert.deepEqual(all.slice(prior.length).map(row=>row.event_type),['ticket.assignment_transferred','ticket.closed']);assert.equal(ended.staff_completion_event_id,result.value.ticket_event_id);
   assert.deepEqual((await s.a.get(s.path+'/responsibility')).value.conversations,communication);
   assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid AND cycle_id=$2::uuid',[s.first.ticket.id,cycle.id])).rowCount,1);
   assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[s.first.ticket.id])).rowCount,1);
   assert.equal((await f.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=ANY($1::uuid[])',[bodies.map(command=>command.client_command_id)])).rowCount,0);
   const receipts=(await f.pool.query<{state:string;command_type:string}>('SELECT state,command_type FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND client_command_id=ANY($2::uuid[]) ORDER BY state',[s.first.ticket.id,bodies.map(command=>command.client_command_id)])).rows;
   assert.equal(receipts.length,kind==='same UUID'?1:2);assert.equal(receipts.filter(row=>row.state==='COMMITTED').length,1);assert.ok(receipts.every(row=>row.command_type==='WORKBENCH_TICKET_TAKEOVER_COMPLETION'));
   assert.deepEqual((await f.pool.query('SELECT operator_type,operator_id,internal_note,external_note FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_id=$2::uuid',[s.first.ticket.id,result.value.ticket_event_id])).rows,[{operator_type:'PILOT_USER',operator_id:actorId,internal_note:body.internal_process,external_note:body.external_summary}]);
   const replay=await client.post(s.path+'/takeover-and-complete',capture);assert.equal(replay.status,200);assert.deepEqual(replay.value,{...result.value,replayed:true});
   for(const patch of [{internal_process:'another private process'},{external_summary:'另一份摘要'},{expected_version:body.expected_version+1},{handling_cycle_id:randomUUID()}])assert.equal((await client.post(s.path+'/takeover-and-complete',{...capture,...patch})).status,409);
   assert.equal((await client.post(s.path+'/takeover-and-complete',{...capture,client_command_id:randomUUID(),expected_version:version(after.version)})).status,409,'a terminal cycle cannot produce another staff end');
   assert.deepEqual((await s.a.get(s.path+'/events')).value,events);assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[s.first.ticket.id])).rowCount,1);
   console.log('T12_REAL_COMMAND_RACE '+JSON.stringify({kind,statuses:responses.map(reply=>reply.status),actual_committed_receipts:1,staff_ends:1,original_cycle:true,immutable_replay:true}));
  });
 });
}
