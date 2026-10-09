import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
const cases=['target-membership','target-role','operator-role','operator-visible-membership'] as const;
for(const kind of cases)test('real public assignment linearizes '+kind+' revocation at its actual PG write boundary',async()=>{
 await withWeb01Fixture(async(context:Fixture)=>{
  const first=context.tickets[0],target=context.principals[2],actor=context.principals[1],cookie=context.cookies[2];assert.ok(first&&target&&actor&&cookie);const path='/api/tickets/'+first.ticket.id;
  const get=async(url:string)=>{const response=await fetch(context.origin+url,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};const bootstrap=(await get('/api/lifecycle/bootstrap')).value;assert.equal((await get(path)).status,200);assert.equal((await get(path+'/assignment-targets?resolver_team_id=PILOT_IT')).status,200);
  const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
  const snapshot=async()=>({ticket:(await context.pool.query('SELECT version,assignee_id::text,resolver_team_id,status,current_handling_cycle_id::text,source_intake_id::text FROM pilot_ticket.ticket WHERE id=$1::uuid',[first.ticket.id])).rows,events:(await context.pool.query('SELECT event_id::text FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY event_id',[first.ticket.id])).rows,cycles:(await context.pool.query('SELECT id::text FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[first.ticket.id])).rows});const before=await snapshot();
  const gate=await context.pool.connect();let revoker:Awaited<ReturnType<PostgresPool['connect']>>|null=null,pending:Promise<{status:number;value:Record<string,unknown>}>|null=null,revoke:Promise<void>|null=null,revoked=false,installed=false;
  try{
   const gatePid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(gatePid);await gate.query('SELECT pg_advisory_lock(9050661)');
   await context.pool.query("CREATE FUNCTION platform.t06_authority_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9050661); RETURN NEW; END $$");await context.pool.query(`CREATE TRIGGER t06_authority_barrier BEFORE UPDATE ON pilot_ticket.ticket FOR EACH ROW WHEN (NEW.id='${first.ticket.id}'::uuid AND NEW.assignee_id='${target.id}'::uuid) EXECUTE FUNCTION platform.t06_authority_barrier()`);installed=true;
   pending=(async()=>{const response=await fetch(context.origin+path+'/assign',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':body.client_command_id,'if-match':'"2"'},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};})();
   let commandPid:number|null=null;const boundaryUntil=Date.now()+5000;
   while(Date.now()<boundaryUntil){const trace=await context.pool.query<{pid:number}>("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE 'UPDATE pilot_ticket.ticket SET assignee_id%'",[gatePid]);if(trace.rows.length===1){commandPid=trace.rows[0]?.pid??null;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.ok(commandPid!==null,'the public request must actually reach the PG responsibility write barrier');
   revoker=await context.pool.connect();const roleConnection=revoker,revokerPid=(await roleConnection.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(revokerPid);await roleConnection.query('BEGIN');
   const principal=kind.startsWith('target')?target.id:actor.id,table=kind.endsWith('role')?'pilot_ticket.pilot_principal_role':'pilot_ticket.pilot_team_member';
   revoke=roleConnection.query('DELETE FROM '+table+' WHERE principal_id=$1::uuid',[principal]).then(async()=>{await roleConnection.query('COMMIT');revoked=true;});
   let heldUntilCommit=false;const revokeUntil=Date.now()+5000;
   while(Date.now()<revokeUntil&&!revoked){const trace=await context.pool.query<{blocking:number[]}>('SELECT pg_blocking_pids(pid) AS blocking FROM pg_stat_activity WHERE pid=$1::int AND wait_event_type=\'Lock\'',[revokerPid]);if(trace.rows[0]?.blocking.includes(commandPid)){heldUntilCommit=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
   assert.ok(revoked||heldUntilCommit,'revocation must either commit first or be demonstrably fenced by the command transaction');const revokedBefore=revoked;
   await gate.query('SELECT pg_advisory_unlock(9050661)');const result=await pending;await revoke;
   console.log('T06_AUTHORITY_RACE '+JSON.stringify({kind,pg_write_barrier:true,revoked_before_write:revokedBefore,authority_held_until_commit:heldUntilCommit,status:result.status}));
   if(revokedBefore){assert.ok([401,403,404].includes(result.status),'revocation that committed before the write must not leave a cached assignment permission');assert.deepEqual(await snapshot(),before);}else{assert.equal(result.status,200,JSON.stringify(result.value));const current=object((await snapshot()).ticket[0]);assert.equal(current.assignee_id,target.id);assert.equal(current.version,3);assert.equal(current.status,'QUEUED');}
  }finally{await gate.query('SELECT pg_advisory_unlock(9050661)');gate.release();await Promise.allSettled([...(pending?[pending]:[]),...(revoke?[revoke]:[])]);if(revoker){await revoker.query('ROLLBACK');revoker.release();}if(installed)await context.pool.query('DROP TRIGGER t06_authority_barrier ON pilot_ticket.ticket');await context.pool.query('DROP FUNCTION IF EXISTS platform.t06_authority_barrier()');}
 },{ticketAssignmentEnabled:true});
});
