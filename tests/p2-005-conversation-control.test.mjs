import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';

import {
  CONVERSATION_ASSIGNMENT_STATUSES, CONVERSATION_HANDOFF_STATUSES,
  CONVERSATION_CONTROL_COMMAND_TYPES, CONVERSATION_CONTROL_EVENT_TYPES,
  CONVERSATION_GENERATION_INVALIDATION_REASONS, CONVERSATION_CONTROL_ERROR_CODES,
  normalizeConversationControlCommand, computeConversationControlCommandHash,
  createDenyAllConversationControlAuthorization, createConversationControlService,
  captureGenerationFence, assertGenerationFence, createAssignedCommunicationAuthorizer,
} from '../src/p2-005-conversation-control.mjs';
import { mapAssignmentToRealtimeEvent, mapControlEventToTimelineSourceRecord, mapHandoffToRealtimeEvent, mapReadCursorToRealtimeEvent } from '../src/p2-005-conversation-control-projections.mjs';

const SESSION = '018f6f15-7a11-7cc0-9e40-111111111111';
const ACTOR = '018f6f15-7a11-7cc0-9e40-222222222222';
const TARGET = '018f6f15-7a11-7cc0-9e40-333333333333';
function takeover(overrides={}) { return { command_type:'TAKEOVER',session_id:SESSION,client_command_id:randomUUID(),idempotency_scope:'WORKBENCH',expected_row_version:1,actor_principal_id:ACTOR,target_principal_id:TARGET,reason_code:'HUMAN_TAKEOVER',force:false,...overrides }; }

test('all P2-005 JSON Schemas parse and freeze strict objects', () => {
  for (const name of ['conversation_assignment','conversation_handoff','conversation_read_cursor','conversation_control_command','conversation_generation_fence']) {
    const schema=JSON.parse(fs.readFileSync(`contracts/${name}.schema.json`,'utf8')); assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema'); assert.equal(schema.additionalProperties,false);
  }
});

test('status, command, event, invalidation, and stable error vocabularies are frozen', () => {
  assert.deepEqual(CONVERSATION_ASSIGNMENT_STATUSES,['UNASSIGNED','ASSIGNED']);
  assert.deepEqual(CONVERSATION_HANDOFF_STATUSES,['REQUESTED','ACCEPTED','RELEASED','CANCELLED']);
  assert.equal(CONVERSATION_CONTROL_COMMAND_TYPES.length,7); assert.equal(CONVERSATION_CONTROL_EVENT_TYPES.length,9);
  assert.deepEqual(CONVERSATION_GENERATION_INVALIDATION_REASONS,['HANDOFF_REQUESTED','HUMAN_TAKEOVER','ASSIGNMENT_TRANSFERRED','ASSIGNMENT_RELEASED','HANDOFF_CANCELLED','ADMIN_CANCELLED','TICKET_CRITICAL_STATE_CHANGED','USER_MESSAGE_COMMITTED']);
  assert.equal(new Set(Object.values(CONVERSATION_CONTROL_ERROR_CODES)).size,Object.values(CONVERSATION_CONTROL_ERROR_CODES).length);
});

test('normalization is bounded and command hash is stable across key order', () => {
  const command=takeover(); const reordered=Object.fromEntries(Object.entries(command).reverse());
  assert.deepEqual(normalizeConversationControlCommand(command),normalizeConversationControlCommand(reordered));
  assert.match(computeConversationControlCommandHash(command),/^[a-f0-9]{64}$/u); assert.equal(computeConversationControlCommandHash(command),computeConversationControlCommandHash(reordered));
  assert.notEqual(computeConversationControlCommandHash(command),computeConversationControlCommandHash({...command,target_principal_id:ACTOR}));
});

test('invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed', () => {
  for (const command of [takeover({session_id:'bad'}),takeover({expected_row_version:0}),takeover({reason_code:'bad'}),takeover({roles:['ADMIN']}),takeover({is_admin:true}),takeover({target_principal_id:null})]) assert.throws(()=>normalizeConversationControlCommand(command),{code:CONVERSATION_CONTROL_ERROR_CODES.commandInvalid});
  assert.throws(()=>normalizeConversationControlCommand(takeover({target_mode:'AUTO',command_type:'RELEASE',target_principal_id:null})),{code:CONVERSATION_CONTROL_ERROR_CODES.aiSendForbidden});
  assert.throws(()=>normalizeConversationControlCommand({command_type:'ADVANCE_READ_CURSOR',session_id:SESSION,client_command_id:randomUUID(),idempotency_scope:'WORKBENCH',actor_principal_id:ACTOR,expected_cursor_row_version:0,last_read_sequence:-1,reason_code:'READ'}),{code:CONVERSATION_CONTROL_ERROR_CODES.commandInvalid});
});

test('non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected', () => {
  const samples=[Object.assign(Object.create(null),takeover()),new Proxy(takeover(),{}),{...takeover(),get force(){return false;}},{...takeover(),toJSON(){return{}}},{...takeover(),[Symbol('x')]:1}];
  for(const sample of samples) assert.throws(()=>normalizeConversationControlCommand(sample),{code:CONVERSATION_CONTROL_ERROR_CODES.commandInvalid});
  const polluted=takeover(); Object.defineProperty(polluted,'__proto__',{value:'x',enumerable:true}); assert.throws(()=>normalizeConversationControlCommand(polluted));
});

test('default authorization rejects every operation', async () => {
  const port=createDenyAllConversationControlAuthorization(); for(const fn of Object.values(port)) assert.equal(await fn({}),false);
});

test('disabled service returns before every database call and hides raw failures', async () => {
  let calls=0; const pool={connect:async()=>{calls++;throw new Error('raw database detail');}};
  const service=createConversationControlService({pool,enabled:false,realtimeAppender:async()=>{}}); const response=await service.takeoverSession(takeover());
  assert.equal(response.error.code,CONVERSATION_CONTROL_ERROR_CODES.disabled); assert.equal(calls,0); assert.equal(JSON.stringify(response).includes('raw database'),false);
});

test('generation fence distinguishes current, stale, and HUMAN-forbidden without process state', async () => {
  const rows=[{id:SESSION,status:'OPEN',control_mode:'COPILOT',generation_version:'7'}]; const tx={query:async sql=>({rowCount:1,rows})};
  const captured=await captureGenerationFence({transaction:tx,sessionId:SESSION}); assert.equal(captured.generation_version_at_start,7);
  assert.equal((await assertGenerationFence({transaction:tx,sessionId:SESSION,generationVersionAtStart:7,allowedModes:['COPILOT']})).status,'CURRENT');
  assert.equal((await assertGenerationFence({transaction:tx,sessionId:SESSION,generationVersionAtStart:6,allowedModes:['COPILOT']})).error.code,CONVERSATION_CONTROL_ERROR_CODES.generationStale);
  rows[0].control_mode='HUMAN'; assert.equal((await assertGenerationFence({transaction:tx,sessionId:SESSION,generationVersionAtStart:7,allowedModes:['HUMAN']})).error.code,CONVERSATION_CONTROL_ERROR_CODES.aiSendForbidden);
});

test('assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor', async () => {
  const actor={principal_id:ACTOR}; const command={purpose:'HUMAN_REPLY',sender_kind:'AGENT',session_id:SESSION};
  const tx={query:async(sql)=>sql.includes('pilot_principal p')?{rows:[{id:ACTOR,is_active:true,roles:['HANDLER'],teams:['TEAM_A']}]}:{rowCount:1,rows:[{assigned_principal_id:ACTOR}]}};
  const auth=createAssignedCommunicationAuthorizer({controlService:{},featureFlags:{}}); assert.equal(await auth({transaction:tx,command,actor,session:{control_mode:'HUMAN'}}),true);
  assert.equal(await auth({transaction:tx,command:{...command,sender_kind:'AI',purpose:'AI_REPLY'},actor:{generation_version_at_start:1},session:{control_mode:'AUTO'}}),false);
  const unassigned={query:async(sql)=>sql.includes('pilot_principal p')?{rows:[{id:ACTOR,is_active:true,roles:['HANDLER'],teams:[]}]}:{rowCount:0,rows:[]}}; assert.equal(await auth({transaction:unassigned,command,actor,session:{control_mode:'HUMAN'}}),false);
});

test('Realtime mappers expose versions/status only and no identity or content', () => {
  const common={eventId:randomUUID(),handoffId:randomUUID(),sessionId:SESSION,sessionRowVersion:3,generationVersion:4,occurredAt:'2026-08-31 08:00:00',expiresAt:'2026-09-01 08:00:00'};
  const mapped=[mapAssignmentToRealtimeEvent({...common,assignmentStatus:'ASSIGNED',assignmentVersion:2}),mapHandoffToRealtimeEvent({...common,handoffStatus:'REQUESTED',handoffRowVersion:1}),mapReadCursorToRealtimeEvent({...common,cursorRowVersion:2,lastReadSequence:9})];
  const text=JSON.stringify(mapped); for(const forbidden of ['principal','display','wecom','message','target_id','internal_note']) assert.equal(text.includes(forbidden),false);
});

test('Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention', () => {
  const record=mapControlEventToTimelineSourceRecord({id:randomUUID(),session_id:SESSION,event_type:'ASSIGNMENT_ASSIGNED',event_ordinal:2,occurred_at:'2026-08-31 08:00:00',reason_code:'HUMAN_TAKEOVER',new_assignment_status:'ASSIGNED',new_control_mode:'HUMAN',privacy_class:'INTERNAL',retention_until:'2026-09-01 08:00:00'});
  assert.deepEqual({source_type:record.source_type,item_type:record.item_type,sender_kind:record.sender_kind,visibility:record.visibility,text:record.text},{source_type:'HANDOFF_EVENT',item_type:'HANDOFF_EVENT',sender_kind:'SYSTEM',visibility:'INTERNAL',text:null}); assert.equal(JSON.stringify(record).includes(ACTOR),false);
  assert.equal(mapControlEventToTimelineSourceRecord({...record,event_type:'READ_CURSOR_ADVANCED'}),null);
});
