import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
interface Fixture {origin:string;backendOrigin:string;sessionId:string;cookies:string[];pool:PostgresPool;runtime:P2016EnabledRuntime}
function obj(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
for(const mode of ['logout','physical-expiry'] as const)test('T19 a real staff session '+mode+' during a real service lock wait prevents admission and self responsibility',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const cookie=f.cookies[0];assert.ok(cookie);const bootstrap=await fetch(f.backendOrigin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(bootstrap.status,200);const csrf=obj(await bootstrap.json()).csrf_token;assert.equal(typeof csrf,'string');
    if(mode==='physical-expiry')await f.pool.query('UPDATE pilot_ticket.workbench_auth_session SET expires_epoch_ms=platform.physical_epoch_ms()+1000,expires_at=platform.local_from_epoch_ms(platform.physical_epoch_ms()+1000) WHERE session_id=$1::uuid',[f.sessionId]);
    const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'T19 true session wait：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'内线1919',department:null},resolver_team_id:'PILOT_IT'},gate=await f.pool.connect();let pending:Promise<Response>|null=null;
    try{
      await gate.query('BEGIN');await f.runtime.realtimeProjector.lock(gate);
      pending=fetch(f.backendOrigin+'/api/workbench/reports/take-and-start',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf as string},body:JSON.stringify(command)});
      let waiting=false;for(let n=0;n<100;n++){
        const rows=await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' LIMIT 1");if(rows.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }assert.equal(waiting,true,'the authenticated new public command must actually wait before session invalidation');
      if(mode==='logout'){
        const logout=await fetch(f.backendOrigin+'/workbench/logout',{method:'POST',headers:{cookie,origin:f.origin,'x-csrf-token':csrf as string}});assert.equal(logout.status,200);assert.deepEqual(await logout.json(),{logged_out:true});
      }else await new Promise(resolve=>setTimeout(resolve,1100));
      await gate.query('COMMIT');const result=await pending;pending=null;assert.equal(result.status,403,'a captured pre-wait session is not current authentication');
      assert.equal((await f.pool.query(`SELECT i.id FROM intake.service_intake i JOIN pilot_ticket.ticket_command_receipt r ON r.id=i.manual_command_receipt_id WHERE r.client_command_id=$1::uuid`,[command.client_command_id])).rowCount,0,'no admission, unique Ticket or responsibility survives the lost current session');
      assert.equal((await f.pool.query("SELECT id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid AND state='COMMITTED'",[command.client_command_id])).rowCount,0);
    }finally{await gate.query('ROLLBACK').catch(()=>{});gate.release();if(pending)await pending;}
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,realWorkbenchAuthentication:true});
});
test('T19 expiry during the final unchanged session row-lock wait rolls back the admission before its receipt commits',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const cookie=f.cookies[0];assert.ok(cookie);const bootstrap=await fetch(f.backendOrigin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(bootstrap.status,200);const csrf=obj(await bootstrap.json()).csrf_token;assert.equal(typeof csrf,'string');
    const expiry=(await f.pool.query<{expiry:string}>(`UPDATE pilot_ticket.workbench_auth_session SET expires_epoch_ms=platform.physical_epoch_ms()+5000,expires_at=platform.local_from_epoch_ms(platform.physical_epoch_ms()+5000) WHERE session_id=$1::uuid RETURNING expires_epoch_ms::text AS expiry`,[f.sessionId])).rows[0];assert.ok(expiry);
    const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'T19 final session row wait：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'内线1919',department:null},resolver_team_id:'PILOT_IT'},gate=await f.pool.connect(),sessionLock=await f.pool.connect();let pending:Promise<Response>|null=null;
    const waitFor=async(fragment:string)=>{for(let n=0;n<150;n++){const rows=await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE $1 LIMIT 1",['%'+fragment+'%']);if(rows.rowCount)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('the real public command must actually wait at '+fragment);};
    try{
      await gate.query('BEGIN');await f.runtime.realtimeProjector.lock(gate);
      pending=fetch(f.backendOrigin+'/api/workbench/reports/take-and-start',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf as string},body:JSON.stringify(command)});
      await waitFor('pg_advisory_xact_lock');
      await sessionLock.query('BEGIN');await sessionLock.query('SELECT session_id FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid FOR UPDATE',[f.sessionId]);
      await gate.query('COMMIT');await waitFor('FOR SHARE');
      const remaining=(await f.pool.query<{remaining:number}>('SELECT greatest(0,$1::bigint-platform.physical_epoch_ms())::integer AS remaining',[expiry.expiry])).rows[0];assert.ok(remaining);await new Promise(resolve=>setTimeout(resolve,remaining.remaining+50));
      // Release only the lock. An unchanged row must not rely on an updated-row
      // predicate recheck to notice that physical time advanced while waiting.
      await sessionLock.query('COMMIT');const result=await pending;pending=null;assert.equal(result.status,403);
      assert.equal((await f.pool.query(`SELECT i.id FROM intake.service_intake i JOIN pilot_ticket.ticket_command_receipt r ON r.id=i.manual_command_receipt_id WHERE r.client_command_id=$1::uuid`,[command.client_command_id])).rowCount,0,'physical expiry at the final session lock must roll back the business before commit');
      assert.equal((await f.pool.query("SELECT id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid AND state='COMMITTED'",[command.client_command_id])).rowCount,0);
    }finally{await gate.query('ROLLBACK').catch(()=>{});gate.release();await sessionLock.query('ROLLBACK').catch(()=>{});sessionLock.release();if(pending)await pending;}
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,realWorkbenchAuthentication:true});
});
