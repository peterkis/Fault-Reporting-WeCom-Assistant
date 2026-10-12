import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {normalizeReturnToDispatchCommand} from '../src/workbench-ticket-return-to-dispatch.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';

const base=()=>({action:'return-to-dispatch',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'停止当前已开始的维修。',unfinished_work:'设备仍须维修。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
test('the public return command port freezes original intent, enforces canonical selection and keeps the two independent UTF16 input limits',()=>{
 const selected={...base(),reason:'  内部原因  ',unfinished_work:'  内部未完成工作  ',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:randomUUID(),sessions:[{session_id:randomUUID(),expected_row_version:1}]};
 const normalized=normalizeReturnToDispatchCommand(selected),first=selected.sessions[0];assert.ok(first);
 assert.equal(normalized.reason,'内部原因');assert.equal(normalized.unfinished_work,'内部未完成工作');assert.equal(Object.isFrozen(normalized),true);assert.equal(Object.isFrozen(normalized.sessions),true);assert.equal(Object.isFrozen(normalized.sessions[0]),true);
 first.expected_row_version=2;assert.equal(normalized.sessions[0]?.expected_row_version,1,'caller mutation cannot rewrite the frozen captured version');
 const limit=normalizeReturnToDispatchCommand({...base(),reason:'😀'.repeat(250),unfinished_work:'😀'.repeat(700)});assert.equal(limit.reason.length,500);assert.equal(limit.unfinished_work.length,1400);
 const canonical=normalized.sessions[0];assert.ok(canonical);
 for(const invalid of [{...base(),reason:'😀'.repeat(251)},{...base(),unfinished_work:'😀'.repeat(701)},{...base(),expected_version:2147483648},{...base(),external_visible:true},{...base(),communication_target_principal_id:randomUUID()},{...base(),sessions:[canonical]},{...selected,communication_target_principal_id:null},{...selected,sessions:[]},{...selected,sessions:[canonical,{...canonical,session_id:canonical.session_id.toUpperCase()}]},{...selected,sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))},{...selected,sessions:[{session_id:randomUUID(),expected_row_version:0}]}])assert.throws(()=>normalizeReturnToDispatchCommand(invalid),{code:'P2_016_INPUT_INVALID'});
 assert.equal(normalizeReturnToDispatchCommand({...selected,sessions:Array.from({length:8},()=>({session_id:randomUUID(),expected_row_version:1}))}).sessions.length,8);
 // @ts-expect-error Deliberate invalid external configuration must also fail at the runtime constructor.
 assert.throws(()=>createP2016Runtime({ticketReturnToDispatchEnabled:'true'}),{code:'P2_016_FLAG_INVALID'});
});

test('the frozen published command and capability contracts retain exact wire keys, selection bounds and literal false defaults',async()=>{
 const read=async(name:string):Promise<Record<string,unknown>>=>{const value:unknown=JSON.parse(await readFile(new URL('../contracts/'+name+'.schema.json',import.meta.url),'utf8'));assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;};
 const command=await read('p2_016_return_to_dispatch_command'),capability=await read('p2_016_return_to_dispatch_capability');
 const normalized=normalizeReturnToDispatchCommand(base()),{action:_action,ticket_id:_ticket,...wire}=normalized;
 assert.equal(command.additionalProperties,false);assert.deepEqual(Object.keys(wire).sort(),Array.from(command.required as string[]).sort());assert.deepEqual(Object.keys(wire).sort(),Object.keys(command.properties as Record<string,unknown>).sort());
 const properties=command.properties as Record<string,{maxLength?:number;maxItems?:number}>;assert.equal(properties.reason?.maxLength,500);assert.equal(properties.unfinished_work?.maxLength,1400);assert.equal(properties.sessions?.maxItems,8);
 assert.equal(capability.additionalProperties,false);assert.deepEqual(capability.required,['ticket_return_to_dispatch_enabled','ticket_return_to_dispatch_draft_recovery_enabled']);
 for(const property of Object.values(capability.properties as Record<string,{type:unknown;default:unknown}>)){assert.equal(property.type,'boolean');assert.equal(property.default,false);}
});
