import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';

test('a real waiting command rechecks current handler membership after waiting for the authoritative Ticket lock',async()=>{
  await withT10Fixture(async context=>{
    const admin=await t11Http(context),handler=await t11Http(context,2),target=context.tickets[0];assert.ok(target);
    const current=await handler.start(target.ticket.id),path='/api/tickets/'+target.ticket.id;
    const snapshot=async()=>({ticket:await admin.detail(target.ticket.id),events:await (await admin.get(path+'/events')).json() as unknown,responsibility:await (await admin.get(path+'/responsibility')).json() as unknown,deliveries:await (await admin.get(path+'/deliveries')).json() as unknown});
    const before=await snapshot(),gate=await context.pool.connect();let held=false,pending:Promise<Response>|undefined;
    try{
      await gate.query('BEGIN');held=true;
      assert.equal((await gate.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR NO KEY UPDATE',[target.ticket.id])).rowCount,1);
      const pid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
      pending=handler.post(target.ticket.id,'request-information',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'WAITING_REPORTER',note:'INTERNAL_T10_REVOKED_CANARY：锁等待期间失去组权限。',external_visible:false});
      let blocked=false;const until=performance.now()+5000;
      do{
        const waiting=await context.pool.query<{query:string}>("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT%pilot_ticket.ticket t%FOR UPDATE OF t'",[pid]);
        if(waiting.rowCount===1){blocked=true;break;}await delay(10);
      }while(performance.now()<until);
      assert.equal(blocked,true,'observe this actual command after initial authorization at its Ticket lock');
      const actor=context.principals[1];assert.ok(actor);
      const identity=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[actor.id])).rows[0];assert.ok(identity);
      const changed=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:[]});assert.equal(changed.id,actor.id);
      assert.equal((await handler.get(path)).status,200,'ownership still allows current READ, without granting waiting WRITE');
      await gate.query('COMMIT');held=false;
      const response=await pending;console.log('T10_CURRENT_AUTHORITY_WAIT '+JSON.stringify({status:response.status,body:await response.clone().json(),membership_removed_before_ticket_release:true}));
      assert.equal(response.status,403);assert.deepEqual(await snapshot(),before);
      assert.ok(!(await response.text()).includes('INTERNAL_T10_REVOKED_CANARY'));
    }finally{if(held)await gate.query('ROLLBACK');await pending?.catch(()=>undefined);gate.release();}
  });
});
