import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {normalizeP2016TicketCommand} from '../app/server/src/p2-016-ticket-command-facade.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';

test('four waiting command routes retain closed human internal reason, exact scalar bounds and immutable caller input copies',async()=>{
  const wire={client_command_id:randomUUID(),expected_version:2147483647,reason_code:'HUMAN_INTERNAL_REASON',note:'😀'.repeat(1000),external_visible:false};await assertP2016Schema('p2_016_waiting_action_command',wire);
  for(const action of ['request-information','wait-vendor','resume','cancel']){const input={...wire,action,ticket_id:randomUUID()},normalized=normalizeP2016TicketCommand(input);input.note='caller changed';assert.equal(normalized.note,wire.note);assert.equal(normalized.expected_version,2147483647);
    for(const change of [{expected_version:2147483648},{expected_version:'3'},{client_command_id:'bad'},{reason_code:'lower'},{note:'😀'.repeat(1001)},{target_principal_id:randomUUID()},{status:'CANCELLED'}])assert.throws(()=>normalizeP2016TicketCommand({...normalized,...change}),{code:'P2_016_INPUT_INVALID'});
  }
  for(const change of [{external_visible:true},{note:' '},{note:''},{handling_cycle_id:randomUUID()},{actor_principal_id:randomUUID()}])await assert.rejects(assertP2016Schema('p2_016_waiting_action_command',{...wire,...change}));
  assert.throws(()=>Reflect.apply(createP2016Runtime,undefined,[{ticketWaitingActionsEnabled:'true'}]),{code:'P2_016_FLAG_INVALID'});
});
test('waiting capability defaults and minimal safe receipt union never admit raw reasons or private snapshots',async()=>{
  const capability:unknown=JSON.parse(await readFile(new URL('../contracts/p2_016_waiting_capability.schema.json',import.meta.url),'utf8'));assert.ok(capability&&typeof capability==='object'&&!Array.isArray(capability));const value=capability as {properties:Record<string,{default:unknown}>};for(const property of Object.values(value.properties))assert.equal(property.default,false);
  await assertP2016Schema('p2_016_waiting_capability',{ticket_waiting_actions_enabled:false,ticket_waiting_action_draft_recovery_enabled:false});
  await assert.rejects(assertP2016Schema('p2_016_waiting_capability',{ticket_waiting_actions_enabled:false,ticket_waiting_action_draft_recovery_enabled:true}));
  for(const receipt of [{state:'UNKNOWN'},{state:'COMMITTED',ticket_id:randomUUID(),ticket_version:2,ticket_event_id:randomUUID()},{state:'FAILED',error:{code:'P2_016_FORBIDDEN',retryable:false}}]){await assertP2016Schema('p2_016_waiting_action_receipt',receipt);await assert.rejects(assertP2016Schema('p2_016_waiting_action_receipt',{...receipt,note:'INTERNAL_PRIVATE'}));}
  await assert.rejects(assertP2016Schema('p2_016_waiting_action_receipt',{state:'FAILED',error:{code:'P2_016_FORBIDDEN',retryable:true}}));
});
