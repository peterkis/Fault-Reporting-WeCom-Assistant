// SOURCE-only next vertical after the protected first has actually run.
// Intended test-root path: tests/t07-target-member-final-write.integration.test.mts
// NOT_REGISTERED / NOT_COMPILED / NOT_BUILT / NOT_RUN. No observed RED or GREEN.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool,PostgresPoolClient} from '../src/platform/postgres-pool.mjs';
import type {P2016TakeoverCommand} from '../contracts/p2_016_takeover_contracts.js';
type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[];runtime:{coordinator:{runOnce:()=>Promise<unknown>}}};
type Reply={status:number;value:Record<string,unknown>};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function version(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isInteger(value)&&Number(value)>0);return value as number;}
function uuid(value:string):string{assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);return value;}
async function client(f:Fixture,index:number){
 const cookie=f.cookies[index];assert.ok(cookie);
 const get=async(path:string):Promise<Reply>=>{const r=await fetch(f.origin+path,{headers:{cookie}});return {status:r.status,value:object(await r.json())};};
 const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
 const post=async(path:string,body:Readonly<Record<string,unknown>>):Promise<Reply>=>{const r=await fetch(f.origin+path,{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+version(body.expected_version)+'"'},body:JSON.stringify(body)});return {status:r.status,value:object(await r.json())};};
 return {get,post};
}
test('current effective target membership must linearize with a self takeover before its responsibility write',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const first=f.tickets[0],actor=f.principals[1];assert.ok(first&&actor);const ticketId=uuid(first.ticket.id),actorId=uuid(actor.id),team='T07_NETWORK',path='/api/tickets/'+ticketId;
  await f.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[team,'T07 合成网络处理组']);
  const updated=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:['PILOT_IT',team]});assert.equal(updated.id,actorId);
  await f.runtime.coordinator.runOnce();const a=await client(f,0),b=await client(f,2);
  const related=await a.get(path+'/related-conversations');assert.equal(related.status,200);const session=rows(related.value.items)[0];assert.ok(session);
  const initial=await a.get(path);assert.equal(initial.status,200);
  const accepted=await a.post(path+'/accept-for-later-with-conversations',{client_command_id:randomUUID(),expected_version:version(initial.value.version),reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:text(session.session_id),expected_row_version:Number(text(session.session_row_version))}]});assert.equal(accepted.status,200,JSON.stringify(accepted.value));
  assert.equal((await b.get(path)).status,200,'B already has original Ticket read scope without owning the Ticket');
  const targets=await b.get(path+'/takeover-targets?resolver_team_id='+team);assert.equal(targets.status,200);assert.ok(rows(targets.value.resolver_teams).some(item=>item.team_id===team));
  const snapshot=async()=>({ticket:(await a.get(path)).value,events:(await a.get(path+'/events')).value,communication:(await a.get(path+'/responsibility')).value,notices:(await a.get(path+'/deliveries')).value});
  const before=await snapshot();assert.equal(before.ticket.status,'ACCEPTED');
  const command:P2016TakeoverCommand={client_command_id:randomUUID(),expected_version:version(before.ticket.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:team,communication_choice:'RETAIN_CURRENT',sessions:[]};
  const gate=await f.pool.connect();let revoker:PostgresPoolClient|null=null,pending:Promise<Reply>|null=null,revoke:Promise<void>|null=null,installed=false,revoked=false;
  try{
   const gatePid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(gatePid);
   await gate.query('SELECT pg_advisory_lock(9050762)');
   // Fixture-only trigger blocks the actual authoritative write; it never seeds a successful business result.
   await f.pool.query("CREATE FUNCTION platform.t07_member_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9050762); RETURN NEW; END $$");
   await f.pool.query("CREATE TRIGGER t07_member_barrier BEFORE UPDATE ON pilot_ticket.ticket FOR EACH ROW WHEN (NEW.id='"+ticketId+"'::uuid AND NEW.assignee_id='"+actorId+"'::uuid) EXECUTE FUNCTION platform.t07_member_barrier()");installed=true;
   pending=b.post(path+'/takeover',command);
   let commandPid:number|null=null;const until=Date.now()+5000;
   while(Date.now()<until){const q=await f.pool.query<{pid:number}>("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))",[gatePid]);if(q.rows.length===1){commandPid=q.rows[0]?.pid??null;break;}await new Promise(resolve=>setTimeout(resolve,20));}
   assert.ok(commandPid!==null,'the genuine HTTP command must reach the physical write barrier; otherwise classify the unreached stage honestly');
   revoker=await f.pool.connect();const authority=revoker,revokerPid=(await authority.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(revokerPid);await authority.query('BEGIN');
   // Revoke only the new team's membership. B retains old PILOT_IT read scope and its HANDLER role.
   revoke=authority.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actorId,team]).then(async()=>{await authority.query('COMMIT');revoked=true;});
   let heldUntilCommit=false;const revokeUntil=Date.now()+5000;
   while(Date.now()<revokeUntil&&!revoked){const q=await f.pool.query<{blocking:number[]}>("SELECT pg_blocking_pids(pid) AS blocking FROM pg_stat_activity WHERE pid=$1::int AND wait_event_type='Lock'",[revokerPid]);if(q.rows[0]?.blocking.includes(commandPid)){heldUntilCommit=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
   assert.ok(revoked||heldUntilCommit,'authority must commit first or be demonstrably held through the command');
   const revokedBeforeWrite=revoked;await gate.query('SELECT pg_advisory_unlock(9050762)');const outcome=await pending;await revoke;
   console.log('T07_MEMBER_LINEARIZATION '+JSON.stringify({actual_write_barrier:true,revoked_before_write:revokedBeforeWrite,held_until_commit:heldUntilCommit,status:outcome.status,client_command_id:command.client_command_id}));
   if(revokedBeforeWrite){assert.equal(outcome.status,403,JSON.stringify(outcome.value));assert.deepEqual(await snapshot(),before);}
   else{assert.equal(outcome.status,200,JSON.stringify(outcome.value));const after=await snapshot();assert.equal(after.ticket.assignee_id,actorId);assert.equal(after.ticket.resolver_team_id,team);assert.equal(after.ticket.version,version(before.ticket.version)+1);assert.equal(after.ticket.status,'ACCEPTED');assert.deepEqual(after.ticket.handling_cycle,before.ticket.handling_cycle);assert.deepEqual(after.communication.conversations,before.communication.conversations);assert.deepEqual(after.notices,before.notices);const prior=rows(before.events.items),events=rows(after.events.items);assert.deepEqual(events.slice(0,prior.length),prior);assert.equal(events.length,prior.length+1);assert.equal(events.at(-1)?.event_type,'ticket.assignment_transferred');}
  }finally{
   try{await gate.query('SELECT pg_advisory_unlock(9050762)');}finally{gate.release();}
   await Promise.allSettled([...(pending?[pending]:[]),...(revoke?[revoke]:[])]);
   if(revoker)try{await revoker.query('ROLLBACK');}finally{revoker.release();}
   if(installed)await f.pool.query('DROP TRIGGER t07_member_barrier ON pilot_ticket.ticket');
   await f.pool.query('DROP FUNCTION IF EXISTS platform.t07_member_barrier()');
  }
 },{ticketTakeoverEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,chronologicalTicketEvents:true});
});
