import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {acceptedSetup,acceptedOptions,http,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
test('current actor Ticket UUID and takeover purpose give only a minimal read-only terminal acknowledgement, never the selected private snapshot',async()=>{
 await withWeb01Fixture(async(f:T07Fixture)=>{
  const s=await acceptedSetup(f),outsider=await http(f,1),other=f.tickets[1];assert.ok(other);const command={client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:'T07_NETWORK',communication_choice:'RETAIN_CURRENT',sessions:[]};
  const committed=await s.b.post(s.path+'/takeover',command);assert.equal(committed.status,200);const receiptPath=s.path+'/takeover/commands/'+command.client_command_id;
  const count=async()=> (await f.pool.query('SELECT count(*)::int AS count FROM pilot_ticket.ticket_command_receipt')).rows,stable=await count(),receipt=await s.b.get(receiptPath);assert.equal(receipt.status,200,JSON.stringify(receipt.value));assert.deepEqual(receipt.value,{state:'COMMITTED',ticket_id:s.first.ticket.id,ticket_version:version(s.before.version)+1,ticket_event_id:committed.value.ticket_event_id});await assertP2016Schema('p2_016_takeover_receipt',receipt.value);assert.deepEqual(await count(),stable);
  const bootstrap=await s.b.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.value.ticket_takeover_enabled,true);assert.equal(bootstrap.value.ticket_takeover_draft_recovery_enabled,true);assert.equal(bootstrap.value.internal_notes_enabled,true);
  assert.deepEqual((await s.a.get(receiptPath)).value,{state:'UNKNOWN'});assert.deepEqual((await s.b.get('/api/tickets/'+other.ticket.id+'/takeover/commands/'+command.client_command_id)).value,{state:'UNKNOWN'});assert.deepEqual((await s.b.get(s.path+'/takeover/commands/'+randomUUID())).value,{state:'UNKNOWN'});assert.equal((await outsider.get(receiptPath)).status,404);assert.equal((await s.b.get(receiptPath+'?resolver_team_id=T07_NETWORK')).status,400);
  const altered=await s.b.post(s.path+'/takeover',{...command,reason_code:'T07_DIFFERENT_INTENT'});assert.equal(altered.status,409);const actionConflict=await s.b.post(s.path+'/takeover-and-start',command);assert.equal(actionConflict.status,409);
  const stale={...command,client_command_id:randomUUID()},failed=await s.b.post(s.path+'/takeover',stale);assert.equal(failed.status,409);const failedReceipt=await s.b.get(s.path+'/takeover/commands/'+stale.client_command_id);assert.equal(failedReceipt.status,200);assert.deepEqual(failedReceipt.value,{state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}});await assertP2016Schema('p2_016_takeover_receipt',failedReceipt.value);
  const noteId=randomUUID();assert.equal((await s.b.post(s.path+'/internal-notes',{client_command_id:noteId,expected_version:version(s.before.version)+1,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T07 合成私密用途标记不得进入安全回执',external_visible:false})).status,200);assert.deepEqual((await s.b.get(s.path+'/takeover/commands/'+noteId)).value,{state:'UNKNOWN'},'an original actor different-purpose UUID is isolated');
  await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[s.actor.id]);assert.ok([401,403,404].includes((await s.b.get(receiptPath)).status),'safe receipt never retains revoked current authority');
 },{...acceptedOptions,workbenchDraftRecoveryEnabled:true,workbenchInternalNotesEnabled:true});
});
