// SOURCE-only proposal. Original frozen first runs first; no current RED/GREEN claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT36WebFixture} from './helpers/t36-supplement-fixture.mjs';
import type {SupplementFollowUpCommand,SupplementFollowUpResult} from '../contracts/workbench_supplement_follow_up_contracts.js';
interface Responsibility {ticket_assignee_id:string|null;conversations:unknown[]}

test('T36 current readable non-owner HANDLER can dispose exact material but the same UUID cannot retarget a later revision',{timeout:240000},()=>withT36WebFixture(async f=>{
 const r2=await f.supplement('1','T36非负责人同事处理的精确补充'),responsibility=await f.read<Responsibility>(f.ticketPath+'/responsibility');
 assert.equal(responsibility.ticket_assignee_id,null);assert.deepEqual(responsibility.conversations,[]);
 const before=await f.facts('staff');assert.equal(before.ticket.assignee_id,null);
 assert.equal(before.personalRead.sources.find(source=>source.source_kind==='WEB')?.last_read_position,'0');
 const pending=await f.page();assert.equal(pending.has_pending_supplements,true);
 assert.equal(pending.items.find(item=>item.source_ref===r2.source_ref&&item.revision==='2')?.follow_up_state,'PENDING');
 const command:SupplementFollowUpCommand={client_command_id:randomUUID(),action:'RECORD_DISPOSITION',...r2,
  disposition_note:'T36内部合成处置；不要求工单或会话负责人',mark_followed_up:true};
 const response=await f.post(command);assert.equal(response.status,200,'business-authorized readable HANDLER is allowed without ownership');
 const result=await response.json() as SupplementFollowUpResult;assert.equal(result.ok,true);assert.equal(result.source_ref,r2.source_ref);
 assert.equal(result.revision,'2');assert.equal(result.basis,'RECORDED_DISPOSITION');assert.equal(result.follow_up_state,'FOLLOWED_UP');
 assert.deepEqual(await f.facts('staff'),before,'disposition does not change Ticket, dual responsibility, events or personal read');
 const r3=await f.supplement('2','T36稍后新材料不可被旧UUID换目标清除');assert.notEqual(r2.source_ref,r3.source_ref);
 const current=await f.page(),beforeReject=await f.facts('staff');
 const changedTarget=await f.post({...command,...r3});assert.equal(changedTarget.status,409,'same caller UUID cannot switch captured source_ref/revision');
 assert.deepEqual(await f.page(),current);assert.deepEqual(await f.facts('staff'),beforeReject);
 assert.equal(current.items.find(item=>item.source_ref===r2.source_ref)?.follow_up_state,'FOLLOWED_UP');
 assert.equal(current.items.find(item=>item.source_ref===r3.source_ref)?.follow_up_state,'PENDING');
}));

test('T36 a new disposition waiting on the exact WEB material rejects expiry after its transaction began',{timeout:240000},()=>withT36WebFixture(async f=>{
 const target=await f.supplement('1','T36真实等待后已过保留期限的材料');
 const command:SupplementFollowUpCommand={client_command_id:randomUUID(),action:'RECORD_DISPOSITION',...target,
  disposition_note:'等待后的保留性必须重新核验',mark_followed_up:true};
 const id=target.source_ref.slice(4);
 const deadline=(await f.pool.query<{epoch:string}>("SELECT (platform.physical_epoch_ms()+2500)::text AS epoch")).rows[0]?.epoch;assert.ok(deadline);
 await f.pool.query('UPDATE intake.web_submission SET retention_until_epoch_ms=$2::bigint,retention_until=platform.local_from_epoch_ms($2::bigint) WHERE id=$1::uuid',[id,deadline]);
 const blocker=await f.pool.connect();let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM intake.web_submission WHERE id=$1::uuid FOR UPDATE',[id]);
  pending=f.post(command);let waiting=false;
  for(let attempt=0;attempt<100;attempt++){
   waiting=(await f.pool.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query ILIKE '%web_submission%') AS waiting")).rows[0]?.waiting===true;
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(waiting,true,'the command actually waits on this exact material row');
  let now='0';for(let attempt=0;attempt<200;attempt++){
   now=(await f.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch??'0';
   if(BigInt(now)>BigInt(deadline)+1000n)break;await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.ok(BigInt(now)>BigInt(deadline)+1000n);await blocker.query('COMMIT');
  const response=await pending;const body=await response.text();
  console.log('T36_EXACT_WEB_RETENTION_WAIT '+JSON.stringify({wait_observed:waiting,deadline_epoch_ms:deadline,released_epoch_ms:now,status:response.status}));
  assert.equal(response.status,404,'a transaction-start timestamp cannot authorize already expired material after the wait');
  assert.doesNotMatch(body,new RegExp(target.source_ref,'u'));
  assert.equal((await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM pilot_ticket.workbench_supplement_disposition WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,0);
  assert.equal((await f.get(f.ticketPath)).status,200,'general Ticket READ remains valid');
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await pending?.catch(()=>{});}
}));

test('T36 current READ loss and inactive authentication reject replay/receipt; an active unreadable colleague cannot clear new material',{timeout:240000},()=>withT36WebFixture(async f=>{
 const r2=await f.supplement('1','T36撤权前捕获的补充');
 const command:SupplementFollowUpCommand={client_command_id:randomUUID(),action:'RECORD_DISPOSITION',...r2,
  disposition_note:'T36精确内部处置用于后续当前授权核对',mark_followed_up:true};
 assert.equal((await f.post(command)).status,200);
 const r3=await f.supplement('2','T36撤权后仍待跟进的新补充');
 const before=await f.page('admin'),facts=await f.facts('admin');
 await f.setStaffRead(false);
 assert.equal((await f.get(f.itemPath)).status,404,'real current object READ is lost before replay/ACK');
 for(const response of [await f.post(command),await f.get(f.followPath+'/commands/'+command.client_command_id)]){
  assert.equal(response.status,404);assert.doesNotMatch(await response.text(),new RegExp(r2.source_ref,'u'));
 }
 const outsider=await f.post({client_command_id:randomUUID(),action:'RECORD_DISPOSITION',...r3,
  disposition_note:'无材料READ不得处置',mark_followed_up:true},'outsider');assert.equal(outsider.status,404);
 assert.doesNotMatch(await outsider.text(),new RegExp(r3.source_ref,'u'));
 assert.deepEqual(await f.page('admin'),before);assert.deepEqual(await f.facts('admin'),facts);
 await f.deactivateStaff();
 assert.equal((await f.get('/api/lifecycle/bootstrap')).status,401,'existing synthetic Cookie authentication returns unauthenticated for inactive principal');
 assert.equal((await f.post(command)).status,401);assert.equal((await f.get(f.followPath+'/commands/'+command.client_command_id)).status,401);
 assert.deepEqual(await f.page('admin'),before);assert.deepEqual(await f.facts('admin'),facts);
 assert.equal(before.items.find(item=>item.source_ref===r3.source_ref)?.follow_up_state,'PENDING');
}));
