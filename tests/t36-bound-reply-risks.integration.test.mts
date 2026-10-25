import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {proposedBoundReplyNotCompleted} from './helpers/t36-bound-reply-scenes.mjs';
import {createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
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

test('T36 a reply waiting on its original Thread leaves the original Session available and commits once after release',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 const session=(await f.pool.query<{thread_id:string}>('SELECT thread_id::text FROM conversation.session WHERE id=$1::uuid',[f.sessionId])).rows[0];assert.ok(session);
 const command:SupplementFollowUpReplyCommand={client_command_id:randomUUID(),expected_row_version:f.rowVersion,text:'T36原Thread等待锁序核验',follow_up_target:{ticket_id:f.ticketId,...f.r2}};
 const observer=createPostgresPool({connectionString:f.databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'t36_communication_lock_observer'});
 try{
 const blocker=await observer.connect();let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');const blockerPid=(await blocker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(blockerPid);
  assert.equal((await blocker.query('SELECT id FROM conversation.thread WHERE id=$1::uuid FOR UPDATE',[session.thread_id])).rowCount,1);
  pending=f.postReply(command);void pending.catch(()=>{});
  let writer:{pid:number;blocking_pids:number[]}|undefined;const deadline=performance.now()+10000;
  while(performance.now()<deadline){
   await blocker.query('SELECT pg_stat_clear_snapshot()');
   const blocked=await blocker.query<{pid:number;blocking_pids:number[]}>("SELECT pid,pg_blocking_pids(pid) AS blocking_pids FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query ILIKE '%FOR UPDATE OF session, thread%' AND $1=ANY(pg_blocking_pids(pid))",[blockerPid]);
   if(blocked.rows.length){assert.equal(blocked.rows.length,1);writer=blocked.rows[0];break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(writer,'the original real communication command is waiting on this owned Thread');
  let sessionLockError:string|null=null,sessionLockRows:number|null=null;
  try{sessionLockRows=(await blocker.query('SELECT id FROM conversation.session WHERE id=$1::uuid FOR UPDATE NOWAIT',[f.sessionId])).rowCount;}
  catch(error){sessionLockError=error instanceof Error&&'code' in error?String(error.code):error instanceof Error?error.name:'UNKNOWN';}
  console.log('T36_COMMUNICATION_THREAD_WAIT '+JSON.stringify({client_command_id:command.client_command_id,session_id:f.sessionId,thread_id:session.thread_id,blocker_pid:blockerPid,writer_pid:writer.pid,blocking_pids:writer.blocking_pids,wait_observed:true,session_lock_error_code:sessionLockError}));
  assert.equal(sessionLockError,null,'a reply waiting on Thread must leave the original Session available');
  assert.equal(sessionLockRows,1);
  await blocker.query('ROLLBACK');const response=await pending;assert.equal(response.status,202);await response.arrayBuffer();
  const committed=await f.pool.query<{client_command_id:string;session_id:string;ticket_id:string;source_ref:string;revision:string}>(`SELECT m.client_command_id::text,m.session_id::text,b.ticket_id::text,b.source_ref,b.revision::text
    FROM communication.message m LEFT JOIN pilot_ticket.workbench_supplement_reply_binding b ON b.message_id=m.id WHERE m.client_command_id=$1::uuid`,[command.client_command_id]);
  assert.equal(committed.rows.length,1);assert.deepEqual(committed.rows[0],{client_command_id:command.client_command_id,session_id:f.sessionId,ticket_id:f.ticketId,source_ref:f.r2.source_ref,revision:f.r2.revision});
 }finally{
  await blocker.query('ROLLBACK').catch(()=>{});blocker.release();
  if(pending)await pending.then(response=>response.arrayBuffer()).catch(()=>{});
 }
 }finally{await observer.end();}
}));
