import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';
import {withT08Fixture,rows} from './helpers/t08-fixture.mjs';
const release=(version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_UNASSIGN',reason:'当前尚未开始，交回调度安排。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});

test('public unassign rejects unowned, started, waiting, resumed and terminal Tickets without replacing stop-and-return',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2);
  const refuse=async(path:string,status:string)=>{const before=(await admin.get(path)).value;assert.equal(before.status,status);assert.ok(Array.isArray(before.allowed_actions)&&!before.allowed_actions.includes('unassign'));const events=(await admin.get(path+'/events')).value,deliveries=(await admin.get(path+'/deliveries')).value,responsibility=(await admin.get(path+'/responsibility')).value;const result=await admin.post(path+'/unassign',release(Number(before.version)));assert.equal(result.status,409,JSON.stringify(result.value));assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/events')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);assert.deepEqual((await admin.get(path+'/responsibility')).value,responsibility);};
  const unowned='/api/tickets/'+await fixture.createTicket();await refuse(unowned,'QUEUED');
  const path='/api/tickets/'+await fixture.createTicket();
  const action=async(name:string,version:number,who=handler)=>{const response=await who.post(path+'/'+name,{client_command_id:randomUUID(),expected_version:version,reason_code:'T08_REAL_'+name.replaceAll('-','_').toUpperCase()});assert.equal(response.status,200,JSON.stringify(response.value));};
  await action('accept',1);await action('start',2);await refuse(path,'IN_PROGRESS');
  await action('request-information',3);await refuse(path,'WAITING_REQUESTER');await action('resume',4);await refuse(path,'IN_PROGRESS');
  await action('wait-vendor',5);await refuse(path,'WAITING_VENDOR');await action('resume',6);await refuse(path,'IN_PROGRESS');
  await action('resolve',7);await refuse(path,'RESOLVED');await action('confirm',8,admin);await refuse(path,'CLOSED');await action('reopen',9);await refuse(path,'REOPENED');
  const cancelled='/api/tickets/'+await fixture.createTicket();assert.equal((await admin.post(cancelled+'/cancel',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_REAL_CANCEL'})).status,200);await refuse(cancelled,'CANCELLED');
 });
});

test('closed input, independent role, stale version and competing public withdrawals preserve one append-only outcome',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),dispatcher=await fixture.http(1),handler=await fixture.http(2),path='/api/tickets/'+await fixture.createTicket();assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_REAL_ACCEPT'})).status,200);
  const before=(await admin.get(path)).value,events=(await admin.get(path+'/events')).value,deliveries=(await admin.get(path+'/deliveries')).value;
  for(const changed of [{reason:''},{reason:'   '},{reason:'x'.repeat(2001)},{unexpected:true},{communication_choice:'TRANSFER_SELECTED'},{communication_target_principal_id:fixture.otherHandler},{expected_version:2147483648},{sessions:[{session_id:randomUUID(),expected_row_version:1}]}])assert.equal((await admin.post(path+'/unassign',{...release(2),...changed})).status,400,JSON.stringify(changed));
  assert.equal((await handler.post(path+'/unassign',release(2))).status,403);
  const stale=release(1);assert.equal((await admin.post(path+'/unassign',stale)).status,409);assert.equal((await admin.post(path+'/unassign',stale)).value.replayed,true);
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/events')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
  const first=release(2),second=release(2),results=await Promise.all([admin.post(path+'/unassign',first),dispatcher.post(path+'/unassign',second)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);const winner=results[0]?.status===200?{http:admin,body:first,result:results[0]}:{http:dispatcher,body:second,result:results[1]};assert.ok(winner.result);
  const after=(await admin.get(path)).value,history=rows((await admin.get(path+'/events')).value.items);assert.equal(after.version,3);assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(history.filter(event=>event.event_type==='ticket.unassigned').length,1);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
  const replay=await winner.http.post(path+'/unassign',winner.body);assert.equal(replay.status,200);assert.equal(replay.value.replayed,true);assert.equal(replay.value.ticket_event_id,winner.result.value.ticket_event_id);assert.equal((await winner.http.post(path+'/unassign',{...winner.body,reason:'不同命令正文'})).status,409);assert.deepEqual((await admin.get(path+'/events')).value.items,history);
  const other='/api/tickets/'+await fixture.createTicket();assert.equal((await handler.post(other+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_REAL_ACCEPT'})).status,200);const same=release(2),duplicates=await Promise.all([admin.post(other+'/unassign',same),admin.post(other+'/unassign',same)]);assert.deepEqual(duplicates.map(result=>result.status),[200,200]);assert.deepEqual(duplicates.map(result=>result.value.replayed).sort(),[false,true]);assert.equal(duplicates[0]?.value.ticket_event_id,duplicates[1]?.value.ticket_event_id);assert.equal(rows((await admin.get(other+'/events')).value.items).filter(event=>event.event_type==='ticket.unassigned').length,1);
 });
});

test('public withdrawal holds actual current ADMIN authority through its PG write and refuses cached replay after revocation',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),path='/api/tickets/'+await fixture.createTicket();assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_REAL_ACCEPT'})).status,200);const body=release(2);
  const gate=await fixture.pool.connect();let revoker:PostgresPoolClient|null=null,pending:ReturnType<typeof admin.post>|null=null,revoke:Promise<void>|null=null,installed=false,revoked=false;
  try{
   const gatePid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(gatePid);await gate.query('SELECT pg_advisory_lock(9050861)');
   await fixture.pool.query("CREATE FUNCTION platform.t08_authority_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9050861); RETURN NEW; END $$");await fixture.pool.query(`CREATE TRIGGER t08_authority_barrier BEFORE UPDATE ON pilot_ticket.ticket FOR EACH ROW WHEN (NEW.assignee_id IS NULL AND OLD.assignee_id IS NOT NULL) EXECUTE FUNCTION platform.t08_authority_barrier()`);installed=true;
   pending=admin.post(path+'/unassign',body);let commandPid:number|null=null;const until=Date.now()+5000;
   while(Date.now()<until){const trace=await fixture.pool.query<{pid:number}>("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE 'UPDATE pilot_ticket.ticket SET assignee_id=NULL%'",[gatePid]);if(trace.rows.length===1){commandPid=trace.rows[0]?.pid??null;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.ok(commandPid!==null,'the real HTTP command must reach the responsibility write');
   revoker=await fixture.pool.connect();const roleConnection=revoker,revokerPid=(await roleConnection.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(revokerPid);await roleConnection.query('BEGIN');revoke=roleConnection.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[fixture.admin]).then(async()=>{await roleConnection.query('COMMIT');revoked=true;});
   let held=false;const revokeUntil=Date.now()+5000;while(Date.now()<revokeUntil&&!revoked){const trace=await fixture.pool.query<{blocking:number[]}>('SELECT pg_blocking_pids(pid) AS blocking FROM pg_stat_activity WHERE pid=$1::int AND wait_event_type=\'Lock\'',[revokerPid]);if(trace.rows[0]?.blocking.includes(commandPid)){held=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(revoked,false);assert.equal(held,true,'current role rows must remain held until the business transaction commits');
   await gate.query('SELECT pg_advisory_unlock(9050861)');const result=await pending;assert.equal(result.status,200,JSON.stringify(result.value));await revoke;
   const hidden=await admin.get(path);console.log('T08_AUTHORITY_CURRENT_AUTH '+JSON.stringify({current_read_status:hidden.status}));assert.equal(hidden.status,401,'the existing Cookie authenticator refuses a principal with no internal role');const replay=await admin.post(path+'/unassign',body);assert.equal(replay.status,401,'current authentication must be checked before receipt replay');const current=(await handler.get(path)).value;assert.equal(current.version,3);assert.equal(current.assignee_id,null);assert.equal(rows((await handler.get(path+'/events')).value.items).filter(event=>event.event_type==='ticket.unassigned').length,1);console.log('T08_AUTHORITY_WRITE_FENCE '+JSON.stringify({current_authority_held:true,real_http_commit:true,current_replay_refused:true}));
  }finally{await gate.query('SELECT pg_advisory_unlock(9050861)');gate.release();await Promise.allSettled([...(pending?[pending]:[]),...(revoke?[revoke]:[])]);if(revoker){await revoker.query('ROLLBACK');revoker.release();}if(installed)await fixture.pool.query('DROP TRIGGER t08_authority_barrier ON pilot_ticket.ticket');await fixture.pool.query('DROP FUNCTION IF EXISTS platform.t08_authority_barrier()');}
 });
});
