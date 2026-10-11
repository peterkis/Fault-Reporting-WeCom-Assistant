// STAGED_RUNTIME / first actual contract or shared card/list execution pending.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeFollowUpCommand,followUpRevision} from '../src/workbench-follow-up-schedules.mjs';
import {hashP2016} from '../src/p2-016-domain-contracts.mjs';
import {shanghaiLocalToEpochMs} from '../src/platform/time-contract.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

const ticketId=randomUUID(),commandId=randomUUID(),eventId=randomUUID();
const body=()=>({client_command_id:commandId,expected_version:4,expected_schedule_version:'7',reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2030-01-02 09:30:00'});
const invalidInput={code:'P2_016_INPUT_INVALID'};

test('T37 normalization preserves explicit Shanghai seconds and the two distinct version domains',()=>{
  // Three public-command boundary examples, not a second calendar-library test suite.
  for(const [local,epoch] of [['2030-01-02 09:30:00','1893547800000'],['2024-02-29 08:00:00','1709164800000'],['1970-01-01 08:00:00','0']] as const){
    const normalized=normalizeFollowUpCommand(ticketId,{...body(),due_at:local});
    assert.equal(normalized.due_at,local);assert.equal(shanghaiLocalToEpochMs(normalized.due_at),epoch);
  }
  const normalized=normalizeFollowUpCommand(ticketId.toUpperCase(),{...body(),client_command_id:commandId.toUpperCase(),expected_version:2147483647,expected_schedule_version:'9223372036854775807'});
  assert.equal(normalized.ticket_id,ticketId);assert.equal(normalized.client_command_id,commandId);assert.equal(normalized.purpose,'WORKBENCH_FOLLOW_UP_SCHEDULE');
  assert.equal(normalized.expected_version,2147483647);assert.equal(normalized.expected_schedule_version,'9223372036854775807');
  for(const value of ['0','1','9223372036854775807'])assert.equal(followUpRevision(value),value);
  assert.equal(followUpRevision('9223372036854775807',false),'9223372036854775807');assert.throws(()=>followUpRevision('0',false),invalidInput);
  const cancel=normalizeFollowUpCommand(ticketId,{...body(),action:'CANCEL',due_at:null});assert.equal(cancel.action,'CANCEL');assert.equal(cancel.due_at,null);
});

test('T37 refuses calendar or epoch ambiguity, version coercion and extra or missing client fields',()=>{
  for(const due of ['2023-02-29 08:00:00','2024-02-30 08:00:00','2024-04-31 08:00:00','2024-02-29T08:00:00+08:00',
    '2024-02-29 08:00:00+08:00','2024-02-29T00:00:00Z','2024-02-29 08:00:00.001','1970-01-01 07:59:59',1709164800000,null])
    assert.throws(()=>normalizeFollowUpCommand(ticketId,{...body(),due_at:due}),invalidInput);
  for(const value of [0,-1,1.5,'4',2147483648,Number.MAX_SAFE_INTEGER])assert.throws(()=>normalizeFollowUpCommand(ticketId,{...body(),expected_version:value}),invalidInput);
  for(const value of [0,1,-1,'-1','01','1.0','1e3','9223372036854775808','99999999999999999999',null]){
    assert.throws(()=>followUpRevision(value),invalidInput);assert.throws(()=>normalizeFollowUpCommand(ticketId,{...body(),expected_schedule_version:value}),invalidInput);
  }
  for(const invalid of [{...body(),action:'CANCEL'},{...body(),action:'ENDED'},{...body(),reason_code:'CLIENT_OTHER_PURPOSE'},
    {...body(),purpose:'CLIENT_PURPOSE'},{...body(),ticket_id:randomUUID()},{...body(),due_epoch_ms:'1893547800000'},{...body(),actor_id:randomUUID()}])
    assert.throws(()=>normalizeFollowUpCommand(ticketId,invalid),invalidInput);
  for(const key of Object.keys(body()))assert.throws(()=>normalizeFollowUpCommand(ticketId,Object.fromEntries(Object.entries(body()).filter(([name])=>name!==key))),invalidInput);
  assert.throws(()=>normalizeFollowUpCommand('not-a-ticket',body()),invalidInput);
});

test('the original UUID command hash binds server scope and all scheduling intent while ignoring key order',()=>{
  const normalized=normalizeFollowUpCommand(ticketId,body()),original=hashP2016(normalized);
  assert.equal(hashP2016(Object.fromEntries(Object.entries(normalized).reverse())),original);
  assert.equal(hashP2016(normalizeFollowUpCommand(ticketId.toUpperCase(),{...body(),client_command_id:commandId.toUpperCase()})),original);
  // Independent hash-envelope mutations prove each binding; normalization above separately rejects client-supplied scope.
  for(const [key,value] of [['ticket_id',randomUUID()],['purpose','WORKBENCH_OTHER_PURPOSE'],['client_command_id',randomUUID()],
    ['expected_version',5],['expected_schedule_version','8'],['action','CANCEL'],['due_at',null],['due_at','2030-01-02 09:30:01']] as const)
    assert.notEqual(hashP2016({...normalized,[key]:value}),original,key+' must change command identity');
  assert.notEqual(hashP2016(normalizeFollowUpCommand(ticketId,{...body(),action:'CANCEL',due_at:null})),original);
});

test('the four published schemas retain their closed public shapes and explicit SET CANCEL and ACK alternatives',async()=>{
  const result={ok:true,ticket_id:ticketId,ticket_version:5,ticket_event_id:eventId,control_event_id:null,schedule_version:'8',replayed:false};
  const active={schedule_version:'8',due_at:'2030-01-02 09:30:00',due_epoch_ms:'1893547800000',is_due:false};
  const history={schedule_version:'8',action:'SET',due_at:active.due_at,occurred_at:'2026-10-11 12:00:00',ticket_event_id:eventId,end_reason:null};
  const view={ticket_id:ticketId,ticket_version:5,schedule_version:'8',active,allowed_actions:['SET','CANCEL'],history:[history],history_has_more:false};
  const unknown={client_command_id:commandId,ticket_id:ticketId,state:'UNKNOWN'};
  const committed={...unknown,state:'COMMITTED',result:{...result,replayed:true}};
  const failed={...unknown,state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}};
  await assertP2016Schema('workbench_follow_up_schedule_command',body());
  await assertP2016Schema('workbench_follow_up_schedule_command',{...body(),action:'CANCEL',due_at:null});
  await assertP2016Schema('workbench_follow_up_schedule_view',view);
  await assertP2016Schema('workbench_follow_up_schedule_view',{...view,schedule_version:'0',active:null,allowed_actions:['SET'],history:[]});
  await assertP2016Schema('workbench_follow_up_schedule_result',result);
  for(const receipt of [unknown,committed,failed])await assertP2016Schema('workbench_follow_up_schedule_receipt',receipt);
  for(const invalid of [{...body(),expected_version:'4'},{...body(),expected_schedule_version:7},{...body(),actor_id:randomUUID()}])
    await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_command',invalid));
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_result',{...result,control_event_id:randomUUID()}));
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_result',{...result,internal_note:'must not leave the internal command'}));
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_view',{...view,history:Array.from({length:21},()=>history)}));
  // Existing helper currently lacks oneOf. Keep the actual helper-layer RED visible; do not flatten or substitute validation.
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_command',{...body(),due_at:null}),'SET requires an explicit local time');
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_command',{...body(),action:'CANCEL'}),'CANCEL requires explicit null');
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_view',{...view,active:{...active,due_epoch_ms:-1}}));
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_receipt',{...unknown,result}));
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_receipt',{...committed,result:{...result,replayed:false}}));
  await assert.rejects(assertP2016Schema('workbench_follow_up_schedule_receipt',{...failed,error:{...failed.error,retryable:true}}));
  // Calendar/BIGINT/pairing x-annotations remain runtime obligations, exercised at T37 normalization above and in real HTTP/PG cases.
});
