import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
interface Fixture {origin:string;cookies:string[];principals:{id:string}[];pool:PostgresPool}
function obj(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
test('T19 replay rechecks current selected-group authority after an actual original receipt row-lock wait',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const cookie=f.cookies[0],actor=f.principals[0];assert.ok(cookie&&actor);const response=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}}),csrf=obj(await response.json()).csrf_token;assert.equal(typeof csrf,'string');
    const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'T19 receipt wait：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'内线1919',department:null},resolver_team_id:'PILOT_IT'};
    const post=()=>fetch(f.origin+'/api/workbench/reports/take-and-start',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf as string},body:JSON.stringify(command)});
    const initial=await post();assert.equal(initial.status,202);const result=obj(await initial.json()),ticket=obj(result.ticket),lock=await f.pool.connect();let replay:Promise<Response>|null=null;
    try{
      await lock.query('BEGIN');await lock.query('SELECT id FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE',['P2_016:'+actor.id,command.client_command_id]);replay=post();
      let waiting=false;for(let attempt=0;attempt<100;attempt++){
        const rows=await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE '%ticket_command_receipt%' LIMIT 1");
        if(rows.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,true,'the replay must really wait on its original receipt before authority changes');
      await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actor.id,'PILOT_IT']);await lock.query('COMMIT');const rejected=await replay;replay=null;assert.equal(rejected.status,403);
      const state=(await f.pool.query<{state:string;events:number}>(`SELECT r.state,(SELECT count(*)::integer FROM pilot_ticket.ticket_event WHERE ticket_id=$3::uuid) AS events FROM pilot_ticket.ticket_command_receipt r WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid`,['P2_016:'+actor.id,command.client_command_id,ticket.id])).rows[0];assert.deepEqual(state,{state:'COMMITTED',events:3});
    }finally{await lock.query('ROLLBACK').catch(()=>{});lock.release();if(replay)await replay;}
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,manualProjection:true});
});
