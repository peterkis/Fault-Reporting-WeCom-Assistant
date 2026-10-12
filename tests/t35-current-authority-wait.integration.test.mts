// Registered current-authority wait tracer; external unrun preparation stays preserved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

test('T35 a public replay waiting on its real receipt rechecks current authority before returning committed data',{timeout:120_000},()=>withT35Fixture(async f=>{
  const selected=f.tickets[1],retained=f.tickets[8];assert.ok(selected);assert.ok(retained);
  const path='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position';
  const material=(await f.pool.query<{id:string}>('SELECT channel_message_id::text AS id FROM intake.service_intake_message WHERE intake_id=$1::uuid AND sequence_no=1',[selected.intake.intakeId])).rows[0];assert.ok(material);
  const command={client_command_id:randomUUID(),source_ref:'channel:'+material.id,revision:'1'};
  assert.equal((await f.post(path,command)).status,200);
  const holder=await f.pool.connect();let held=false,pending:Promise<Response>|undefined;
  try{
    await holder.query('BEGIN');held=true;
    const row=await holder.query("SELECT id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid AND actor_principal_id=$2::uuid AND command_type='WORKBENCH_PERSONAL_READ' FOR UPDATE",[command.client_command_id,f.principals[0]?.id]);assert.equal(row.rowCount,1);
    const pid=(await holder.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
    pending=f.post(path,command);let blocked=false;const until=performance.now()+3000;
    do{
      const waiting=await f.pool.query<{query:string}>("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE '%pilot_ticket.ticket_command_receipt%'",[pid]);
      if(waiting.rowCount===1){blocked=true;assert.match(waiting.rows[0]?.query??'',/FOR UPDATE/u);break;}await delay(10);
    }while(performance.now()<until);
    assert.equal(blocked,true,'observe the actual public request at its receipt lock, after initial authorization');
    await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'T35 current object scope lost',roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await f.get(path)).status,404);assert.equal((await f.get(path+'/commands/'+command.client_command_id)).status,404);
    assert.equal((await f.get('/api/workbench/items/ticket/'+retained.ticket.id+'/read-position')).status,200);
    await holder.query('COMMIT');held=false;const result=await pending;
    console.log('T35_CURRENT_AUTHORITY_WAIT '+JSON.stringify({post_status:result.status,body:await result.clone().json(),revoke_committed_before_receipt_release:true}));
    assert.equal(result.status,404);assert.doesNotMatch(await result.text(),/source_key|channel:|SELECT|postgres/u);
    assert.equal((await (await f.get(path,1)).json() as {sources:{last_read_position:string}[]}).sources[0]?.last_read_position,'0');
  }finally{if(held)await holder.query('ROLLBACK');await pending?.catch(()=>undefined);holder.release();}
}));
