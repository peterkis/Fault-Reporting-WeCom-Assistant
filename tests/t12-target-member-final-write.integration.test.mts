import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {t12FreshHttp} from './helpers/t12-fresh-http.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {listenConversationWorkbenchServer,closeConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';
import type {PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';

test('actual target membership linearizes with the T12 authoritative transfer through the same transaction staff end, without partial responsibility or promise',async()=>{
 await withT12Fixture(async f=>{
  const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_MEMBER_START'})).status,200);
  let drained=false;for(let n=0;n<3;n++)if((await f.runtime.realtimeProjector.runOnce({limit:100})).processed===0){drained=true;break;}assert.equal(drained,true);
  await f.runtime.stop();await listenConversationWorkbenchServer(f.runtime.server,{port:Number(new URL(f.origin).port)});
  try{
   const a=await t12FreshHttp(f,0),b=await t12FreshHttp(f,2),ticketId=s.first.ticket.id,actorId=s.actor.id,team='T07_NETWORK';
   assert.deepEqual((await b.get(s.path+'/takeover-completion-targets?resolver_team_id='+team)).value.allowed_actions,['takeover-and-complete']);
   const snapshot=async()=>({ticket:(await a.get(s.path)).value,events:(await a.get(s.path+'/events')).value,communication:(await a.get(s.path+'/responsibility')).value.conversations,deliveries:(await a.get(s.path+'/deliveries')).value,cycles:(await f.pool.query('SELECT * FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid ORDER BY cycle_no',[ticketId])).rows,links:(await f.pool.query('SELECT * FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_id=$1::uuid ORDER BY ticket_event_id',[ticketId])).rows,promises:(await f.pool.query('SELECT * FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[ticketId])).rows});
   const before=await snapshot(),cycle=object(before.ticket.handling_cycle);assert.equal(before.ticket.status,'IN_PROGRESS');
   const command={client_command_id:randomUUID(),expected_version:version(before.ticket.version),reason_code:'STAFF_COMPLETED',resolver_team_id:team,handling_cycle_id:text(cycle.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_MEMBER_PRIVATE_CANARY',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true};
   const gate=await f.pool.connect();let revoker:PostgresPoolClient|null=null,pending:Promise<{status:number;value:Record<string,unknown>}>|null=null,revoke:Promise<void>|null=null,installed=false,revoked=false;
   try{
    const gatePid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(gatePid);await gate.query('SELECT pg_advisory_lock(9051267)');
    await f.pool.query('CREATE FUNCTION platform.t12_member_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9051267); RETURN NEW; END $$');
    await f.pool.query(`CREATE TRIGGER t12_member_barrier BEFORE UPDATE ON pilot_ticket.ticket FOR EACH ROW WHEN (NEW.id='${ticketId}'::uuid AND NEW.assignee_id='${actorId}'::uuid) EXECUTE FUNCTION platform.t12_member_barrier()`);installed=true;
    pending=b.post(s.path+'/takeover-and-complete',command);
    let commandPid:number|null=null;const deadline=Date.now()+5000;
    while(Date.now()<deadline){const q=await f.pool.query<{pid:number}>("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))",[gatePid]);if(q.rows.length===1){commandPid=q.rows[0]?.pid??null;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.ok(commandPid!==null,'the actual HTTP command must reach its physical authoritative write barrier');
    revoker=await f.pool.connect();const authority=revoker,revokerPid=(await authority.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(revokerPid);await authority.query('BEGIN');
    revoke=authority.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actorId,team]).then(async()=>{await authority.query('COMMIT');revoked=true;});
    let heldUntilCommit=false;const revokeDeadline=Date.now()+5000;
    while(Date.now()<revokeDeadline&&!revoked){const q=await f.pool.query<{blocking:number[]}>('SELECT pg_blocking_pids(pid) AS blocking FROM pg_stat_activity WHERE pid=$1::int AND wait_event_type=$2',[revokerPid,'Lock']);if(q.rows[0]?.blocking.includes(commandPid)){heldUntilCommit=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.ok(revoked||heldUntilCommit,'current membership must commit first or be demonstrably held through the composite commit');
    const revokedBeforeWrite=revoked;await gate.query('SELECT pg_advisory_unlock(9051267)');const outcome=await pending;await revoke;
    console.log('T12_MEMBER_LINEARIZATION '+JSON.stringify({actual_write_barrier:true,revoked_before_write:revokedBeforeWrite,held_until_commit:heldUntilCommit,status:outcome.status}));
    if(revokedBeforeWrite){assert.equal(outcome.status,403,JSON.stringify(outcome.value));assert.deepEqual(await snapshot(),before);}
    else{assert.equal(outcome.status,200,JSON.stringify(outcome.value));const after=await snapshot();assert.equal(after.ticket.status,'CLOSED');assert.equal(after.ticket.assignee_id,actorId);assert.equal(after.ticket.resolver_team_id,team);assert.equal(after.ticket.version,command.expected_version+2);assert.equal(object(after.ticket.handling_cycle).id,cycle.id);assert.equal(object(after.ticket.handling_cycle).first_responsibility_event_id,cycle.first_responsibility_event_id);assert.equal(after.cycles.length,1);assert.equal(after.promises.length,1);assert.deepEqual(after.communication,before.communication);assert.deepEqual(after.deliveries,before.deliveries);const prior=rows(before.events.items),events=rows(after.events.items);assert.deepEqual(events.slice(0,prior.length),prior);assert.deepEqual(events.slice(prior.length).map(row=>row.event_type),['ticket.assignment_transferred','ticket.closed']);assert.deepEqual((await f.pool.query('SELECT state,command_type FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rows,[{state:'COMMITTED',command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION'}]);}
    assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actorId,team])).rowCount,0);
   }finally{try{await gate.query('SELECT pg_advisory_unlock(9051267)');}finally{gate.release();}await Promise.allSettled([...(pending?[pending]:[]),...(revoke?[revoke]:[])]);if(revoker)try{await revoker.query('ROLLBACK');}finally{revoker.release();}if(installed)await f.pool.query('DROP TRIGGER t12_member_barrier ON pilot_ticket.ticket');await f.pool.query('DROP FUNCTION IF EXISTS platform.t12_member_barrier()');}
  }finally{f.runtime.server.closeAllConnections();await closeConversationWorkbenchServer(f.runtime.server);assert.equal(f.runtime.server.listening,false);const connections=await new Promise<number>((resolve,reject)=>f.runtime.server.getConnections((error,count)=>error?reject(error):resolve(count)));assert.equal(connections,0);}
 });
});
