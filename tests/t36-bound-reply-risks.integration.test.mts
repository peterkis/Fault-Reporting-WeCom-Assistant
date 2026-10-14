import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {proposedBoundReplyNotCompleted} from './helpers/t36-bound-reply-scenes.mjs';
import type {SupplementFollowUpReplyCommand} from '../contracts/workbench_supplement_follow_up_contracts.js';
for(const outcome of ['FAILED','UNKNOWN'] as const)test('T36 original bound reply '+outcome+' never clears the captured material',{timeout:240000},()=>withT36BoundReplyFixture(f=>proposedBoundReplyNotCompleted(f,outcome)));
for(const boundary of ['CURRENT_STAFF_ROLE','CURRENT_RETENTION'] as const)test('T36 bound reply rechecks '+boundary+' after the actual Session row wait',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 const command:SupplementFollowUpReplyCommand={client_command_id:randomUUID(),expected_row_version:f.rowVersion,text:'T36等待后当前授权核验',follow_up_target:{ticket_id:f.ticketId,...f.r2}};
 const blocker=await f.pool.connect();let pending:Promise<Response>|undefined;
 const before=(await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM communication.message WHERE session_id=$1::uuid',[f.sessionId])).rows[0]?.n;
 let deadline='0';if(boundary==='CURRENT_RETENTION')deadline=(await f.pool.query<{epoch:string}>('SELECT (platform.physical_epoch_ms()+2500)::text AS epoch')).rows[0]?.epoch??'0';
 if(boundary==='CURRENT_RETENTION')await f.pool.query('UPDATE channel.message_inbox SET retention_until_epoch_ms=$2::bigint,retention_until=platform.local_from_epoch_ms($2::bigint) WHERE id=$1::bigint',[f.r2.source_ref.slice(8),deadline]);
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM conversation.session WHERE id=$1::uuid FOR UPDATE',[f.sessionId]);pending=f.postReply(command);
  let waiting=false;for(let attempt=0;attempt<100;attempt++){waiting=(await f.pool.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query ILIKE '%FOR UPDATE OF session, thread%') AS waiting")).rows[0]?.waiting===true;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(waiting,true,'real command is waiting on this owned Session lock');
  if(boundary==='CURRENT_STAFF_ROLE')await f.setActorRoles(['REPORTER']);
  else{let now='0';for(let attempt=0;attempt<200;attempt++){now=(await f.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch??'0';if(BigInt(now)>BigInt(deadline)+1000n)break;await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(BigInt(now)>BigInt(deadline)+1000n);}
  await blocker.query('COMMIT');const response=await pending;console.log('T36_BOUND_AFTER_SESSION_WAIT '+JSON.stringify({boundary,wait_observed:waiting,status:response.status}));assert.equal(response.status,403);await response.arrayBuffer();
  assert.equal((await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM communication.message WHERE session_id=$1::uuid',[f.sessionId])).rows[0]?.n,before);
  assert.equal((await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM pilot_ticket.workbench_supplement_reply_binding WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,0);
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await pending?.catch(()=>{});}
}));
