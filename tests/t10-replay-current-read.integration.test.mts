import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

test('same UUID replay waiting on a real receipt lock rechecks current Ticket READ before returning the historical result',async()=>{
  await withT10Fixture(async context=>{
    const admin=await t11Http(context),handler=await t11Http(context,2),target=context.tickets[0],actor=context.principals[0];assert.ok(target&&actor);
    const current=await handler.start(target.ticket.id),path='/api/tickets/'+target.ticket.id;
    const command={client_command_id:randomUUID(),expected_version:current.version,reason_code:'WAITING_REPORTER',note:'INTERNAL_T10_REPLAY_CANARY',external_visible:false};
    assert.equal((await admin.post(target.ticket.id,'request-information',command)).status,200);
    const before=await handler.detail(target.ticket.id),gate=await context.pool.connect();let held=false,pending:Promise<Response>|undefined;
    try{
      await gate.query('BEGIN');held=true;assert.equal((await gate.query('SELECT id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid AND actor_principal_id=$2::uuid FOR UPDATE',[command.client_command_id,actor.id])).rowCount,1);
      const pid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);pending=admin.post(target.ticket.id,'request-information',command);
      let blocked=false;const until=performance.now()+5000;
      do{const waiting=await context.pool.query<{query:string}>("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE '%pilot_ticket.ticket_command_receipt%'",[pid]);if(waiting.rowCount===1){blocked=true;break;}await delay(10);}while(performance.now()<until);
      assert.equal(blocked,true,'observe the actual replay after initial READ authorization');
      const identity=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[actor.id])).rows[0];assert.ok(identity);
      await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:[]});
      assert.equal((await admin.get(path)).status,404);await gate.query('COMMIT');held=false;
      const response=await pending;console.log('T10_REPLAY_CURRENT_READ '+JSON.stringify({status:response.status,body:await response.clone().json(),read_lost_before_receipt_release:true}));assert.equal(response.status,404);
      assert.deepEqual(await handler.detail(target.ticket.id),before);
    }finally{if(held)await gate.query('ROLLBACK');await pending?.catch(()=>undefined);gate.release();}
  });
});
