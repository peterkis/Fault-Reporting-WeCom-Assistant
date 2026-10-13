import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {ownerTransferHttp,record,text} from './helpers/t29-owner-transfer-http-fixture.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
test('T29 current caller purpose is rechecked after a real parent-row wait before owner facts can commit',{timeout:90000},async()=>{
  await ownerTransferHttp(async({pool,f,confirm,post,get})=>{
    const incident=await confirm(),path='/api/incidents/'+incident,actor=text(record(f.admin).id),target=text(record(f.dispatcher).id),before=(await get(path)).body;
    const blocker=await pool.connect();let open=false,primaryError:unknown,pending:ReturnType<typeof post>|undefined;
    try{
      await blocker.query('BEGIN');open=true;await blocker.query('SELECT id FROM incident.incident WHERE id=$1::uuid FOR UPDATE',[incident]);
      pending=post(path+'/transfer-owner',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED',owner_principal_id:target,owner_team_id:'PILOT_IT'});
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++){
        const observed=await pool.query<{waiting:number}>("SELECT count(*)::integer AS waiting FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM incident.incident WHERE%FOR UPDATE'");
        if((observed.rows[0]?.waiting??0)>0){waiting=true;break;}await delay(50);
      }
      assert.equal(waiting,true,'the real HTTP write must have passed entry authority and reached the parent lock');
      await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[actor]);
      await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[actor]);
      assert.equal((await get('/api/lifecycle/bootstrap')).status,200);assert.equal((await get(path)).status,200,'role loss leaves this exact Incident READ and the Session valid');
      await blocker.query('COMMIT');open=false;const response=await pending;
      console.log('T29_CALLER_WAIT_WINDOW '+JSON.stringify({parent_wait_observed:waiting,role_revocation_committed_before_release:true,session:200,incident_read:200,write_status:response.status,error_code:record(response.body.error??{}).code??null}));
      assert.equal(response.status,403,'a caller losing the transfer purpose while waiting cannot write');
      assert.equal((await get(path)).body.row_version,before.row_version);
      assert.equal((await pool.query("SELECT 1 FROM incident.incident_event WHERE incident_id=$1::uuid AND event_type='incident.owner.transferred'",[incident])).rowCount,0);
      assert.equal((await pool.query('SELECT owner_principal_id::text FROM incident.incident WHERE id=$1::uuid',[incident])).rows[0]?.owner_principal_id,before.owner_principal_id);
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([async()=>{if(open){await blocker.query('ROLLBACK');open=false;}},()=>blocker.release(),async()=>{await pending;}],primaryError);
  });
});
