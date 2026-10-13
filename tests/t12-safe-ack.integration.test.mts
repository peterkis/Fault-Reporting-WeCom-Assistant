import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Profile} from './helpers/t12-profile-fixture.mjs';
import {acceptedSetup,http,object,text,version} from './helpers/t07-public-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

test('current READ and the original actor Ticket UUID and composite purpose yield a closed safe ACK after the completion action disappears',async()=>{
 await withT12Profile(async f=>{
  const s=await acceptedSetup(f),outsider=await http(f,1);
  assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_ACK_START'})).status,200);
  const current=(await s.b.get(s.path)).value,cycle=object(current.handling_cycle);
  const command={client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',
   handling_cycle_id:text(cycle.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_ACK_PRIVATE_CANARY',external_summary:'服务已经恢复。',external_summary_confirmed:true};
  const committed=await s.b.post(s.path+'/takeover-and-complete',command);assert.equal(committed.status,200,JSON.stringify(committed.value));
  assert.deepEqual((await s.b.get(s.path+'/takeover-completion-targets?resolver_team_id=T07_NETWORK')).value.allowed_actions,[]);
  const path=s.path+'/takeover-completion/commands/'+command.client_command_id;
  const count=async()=>(await f.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows;
  const baseline=await count(),ack=await s.b.get(path);assert.equal(ack.status,200,JSON.stringify(ack.value));
  assert.deepEqual(ack.value,{state:'COMMITTED',ticket_id:s.first.ticket.id,ticket_version:command.expected_version+2,
   ticket_event_id:committed.value.ticket_event_id,completion:committed.value.completion});
  await assertP2016Schema('p2_016_takeover_completion_receipt',ack.value);assert.deepEqual(await count(),baseline);
  assert.equal(JSON.stringify(ack.value).includes('T12_ACK_PRIVATE_CANARY'),false);assert.equal(JSON.stringify(ack.value).includes(command.external_summary),false);
  assert.deepEqual((await s.a.get(path)).value,{state:'UNKNOWN'});assert.deepEqual((await s.b.get(s.path+'/takeover-completion/commands/'+randomUUID())).value,{state:'UNKNOWN'});
  const other=f.tickets[1];assert.ok(other);assert.deepEqual((await s.b.get('/api/tickets/'+other.ticket.id+'/takeover-completion/commands/'+command.client_command_id)).value,{state:'UNKNOWN'});
  assert.equal((await outsider.get(path)).status,404);assert.equal((await s.b.get(path+'?resolver_team_id=T07_NETWORK')).status,400);
  assert.equal((await s.b.get(s.path+'/takeover-completion/commands/'+'0'.repeat(36))).status,400);
  const stale={...command,client_command_id:randomUUID()};assert.equal((await s.b.post(s.path+'/takeover-and-complete',stale)).status,409);
  const failed=await s.b.get(s.path+'/takeover-completion/commands/'+stale.client_command_id);assert.equal(failed.status,200);
  assert.deepEqual(failed.value,{state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}});await assertP2016Schema('p2_016_takeover_completion_receipt',failed.value);
  const noteId=randomUUID();assert.equal((await s.b.post(s.path+'/internal-notes',{client_command_id:noteId,expected_version:command.expected_version+2,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T12_ACK_OTHER_PRIVATE_PURPOSE',external_visible:false})).status,200);
  assert.deepEqual((await s.b.get(s.path+'/takeover-completion/commands/'+noteId)).value,{state:'UNKNOWN'});
  await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[s.actor.id]);
  assert.equal((await s.b.get(path)).status,200,'no new write or group authority is required to read the original safe receipt');
  await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[s.actor.id]);
  assert.ok([401,403,404].includes((await s.b.get(path)).status),'revoked current authentication is never replaced by historical ownership');
 });
});
