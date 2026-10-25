import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';

test('one composite UUID closes the original cycle and takes only explicitly selected authorized communication, with current Session scope required even for replay',async()=>{
 await withT12Fixture(async f=>{
  const s=await acceptedSetup(f);
  assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_SELECTED_START'})).status,200);
  const before=(await s.b.get(s.path)).value,cycle=object(before.handling_cycle);
  const assigned=rows((await s.b.get(s.path+'/related-conversations')).value.items)[0];assert.ok(assigned);assert.equal(assigned.take_allowed,false);
  const snapshot=async()=>({ticket:(await s.b.get(s.path)).value,events:(await s.a.get(s.path+'/events')).value,
    responsibility:(await s.a.get(s.path+'/responsibility')).value,deliveries:(await s.a.get(s.path+'/deliveries')).value,
    commitments:(await f.pool.query('SELECT * FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid ORDER BY cycle_id',[s.first.ticket.id])).rows});
  const initial=await snapshot();
  const command=(sessions:unknown[])=>({client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'STAFF_COMPLETED',
    resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'TAKE_SELECTED',sessions,
    internal_process:'T12_SELECTED_INTERNAL_CANARY',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true});
  const choice={session_id:text(assigned.session_id),expected_row_version:Number(text(assigned.session_row_version))};
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',command([choice]))).status,403);
  const other=f.tickets[1];assert.ok(other);const foreign=rows((await s.a.get('/api/tickets/'+other.ticket.id+'/responsibility')).value.conversations)[0];assert.ok(foreign);
  assert.equal((await s.b.get('/api/conversations/'+text(foreign.session_id))).status,200);
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',command([{session_id:foreign.session_id,expected_row_version:Number(text(foreign.session_row_version))}]))).status,404);
  assert.deepEqual(await snapshot(),initial,'Ticket scope cannot grant Control or attach a foreign Session');
  const source='/api/conversations/'+choice.session_id;
  assert.equal((await s.a.post(source+'/release',{client_command_id:randomUUID(),expected_row_version:choice.expected_row_version,reason_code:'T12_SELECTED_RELEASE'})).status,200);
  const available=rows((await s.b.get(s.path+'/related-conversations')).value.items)[0];assert.ok(available);assert.equal(available.take_allowed,true);
  const selected={session_id:text(available.session_id),expected_row_version:Number(text(available.session_row_version))};
  const released=await snapshot();
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',command([selected,{...selected,session_id:selected.session_id.toUpperCase()}]))).status,400);
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',command([{...selected,expected_row_version:1}]))).status,409);
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',{...command([selected]),force:true})).status,400);
  assert.deepEqual(await snapshot(),released,'all rejected captures preserve both responsibilities and completion facts');
  const body=command([selected]),result=await s.b.post(s.path+'/takeover-and-complete',body);assert.equal(result.status,200,JSON.stringify(result.value));
  assert.equal(result.value.communication_choice,'TAKE_SELECTED');const changed=rows(result.value.conversations);assert.equal(changed.length,1);
  assert.equal(changed[0]?.session_id,selected.session_id);assert.equal(changed[0]?.session_row_version,selected.expected_row_version+1);assert.equal(changed[0]?.changed,true);
  const committed=await snapshot();assert.equal(committed.ticket.status,'CLOSED');assert.equal(committed.ticket.version,body.expected_version+2);
  assert.equal(committed.ticket.assignee_id,s.actor.id);assert.equal(committed.ticket.resolver_team_id,'T07_NETWORK');assert.equal(object(committed.ticket.handling_cycle).id,cycle.id);
  assert.equal(committed.commitments.length,1);assert.equal(rows(committed.responsibility.conversations)[0]?.conversation_principal_id,s.actor.id);
  const receipt=await f.pool.query<{command_type:string;state:string}>('SELECT command_type,state FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[body.client_command_id]);
  assert.deepEqual(receipt.rows,[{command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION',state:'COMMITTED'}],'there is one outer Ticket receipt, never nested T07/T11 ledgers');
  assert.equal(JSON.stringify(result.value).includes('T12_SELECTED_INTERNAL_CANARY'),false);
  const replay=await s.b.post(s.path+'/takeover-and-complete',body);assert.equal(replay.status,200);assert.deepEqual(replay.value,{...result.value,replayed:true});
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',{...body,external_summary:'另一份摘要'})).status,409);
  assert.deepEqual(await snapshot(),committed,'replay and body conflict neither duplicate completion nor overwrite history');
  const next=f.principals[2];assert.ok(next);
  assert.equal((await s.a.post(source+'/transfer',{client_command_id:randomUUID(),expected_row_version:selected.expected_row_version+1,reason_code:'T12_SELECTED_SCOPE_LOSS',target_principal_id:next.id})).status,200);
  await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:[]});
  assert.equal((await s.b.get(s.path)).status,200);assert.equal((await s.b.get(source)).status,404);
  assert.equal((await s.b.post(s.path+'/takeover-and-complete',body)).status,404,'current Ticket READ cannot substitute for selected Session READ on committed replay');
 });
});
