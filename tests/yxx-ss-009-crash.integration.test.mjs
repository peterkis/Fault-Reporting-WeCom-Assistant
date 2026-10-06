import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {minimalG2Environment} from '../src/p2-g2-validation-config.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {input} from './helpers/yxx-ss-009-http-fixture.mjs';

async function child(databaseUrl,observeResource=()=>{},{startupMode=null,readyTimeout=15000}={}){
  const p=fork('tests/helpers/yxx-ss-009-crash-child.mjs',{windowsHide:true,execArgv:[],env:{...minimalG2Environment(),PILOT_DATABASE_URL:databaseUrl,...(startupMode?{SS009_STARTUP_MODE:startupMode}:{})},stdio:['ignore','ignore','ignore','ipc']});
  observeResource('owned_child',()=>p.exitCode===null&&p.signalCode===null?1:0);
  const receive=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('SS009_CHILD_TIMEOUT'));},readyTimeout);const handler=m=>{cleanup();m.type==='failure'?reject(Error(m.code)):resolve(m);};const fail=()=>{cleanup();reject(Error('SS009_CHILD_EXIT'));};function cleanup(){clearTimeout(timer);p.off('message',handler);p.off('exit',fail);}p.once('message',handler);p.once('exit',fail);});
  try{await receive();}catch(error){if(p.exitCode===null&&p.signalCode===null){const exit=once(p,'exit');p.kill('SIGKILL');await exit;}throw error;}return {p,async send(m){const result=receive();p.send(m);return result;},async kill(){if(p.exitCode!==null||p.signalCode!==null)return;const exited=once(p,'exit');p.kill('SIGKILL');await exited;}};
}

test('SS-009 failed and stalled child startup releases every owned process',{timeout:15000},async()=>{
  for(const startupMode of ['FAIL','HOLD']){const observers=[];await assert.rejects(child('postgres://synthetic:synthetic@127.0.0.1/unused',(name,observe)=>observers.push(observe),{startupMode,readyTimeout:500}));assert.equal(observers.length,1);assert.equal(observers[0](),0);}
});

test('SS-009 real process kills recover all acceptance and processing commit boundaries', {timeout:180000},async t=>{
  const cases=[];let kills=0;
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009kill',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});
    for(const [action,barrier] of [['accept','before-commit'],['accept','after-commit'],['process','before-process'],['process','before-commit'],['process','after-commit']]){
      const body=input('处方提交不了');let c=await child(databaseUrl,observeResource);let ref;
      try{
        if(action==='process')ref=(await c.send({action:'accept',input:body})).result.receipt.request_ref;
        assert.equal((await c.send({action,barrier,input:body,ref})).type,'barrier');await c.kill();kills++;
        const accepted=(await pool.query('SELECT result_request_ref FROM intake.web_command_receipt WHERE client_command_id=$1',[body.client_command_id])).rows;
        assert.equal(accepted.length,action==='accept'&&barrier==='before-commit'?0:1);
        if(accepted.length){ref=accepted[0].result_request_ref;const row=(await pool.query('SELECT processed_revision FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0];assert.equal(row.processed_revision,action==='process'&&barrier==='after-commit'?'1':'0');}
        c=await child(databaseUrl,observeResource);
        const retry=(await c.send({action:'accept',input:body})).result;ref=retry.receipt.request_ref;
        assert.equal(retry.replayed,!(action==='accept'&&barrier==='before-commit'));
        await c.send({action:'recover'});assert.equal((await c.send({action:'process',ref})).result.replayed,true);
        const count=(await pool.query(`SELECT count(*)::int AS n FROM pilot_ticket.ticket WHERE source_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)`,[ref])).rows[0].n;assert.equal(count,1);
        cases.push({action,barrier,receipt_count:1,ticket_count:count,recovered:true});
      }finally{await c.kill();}
    }
  }});
  t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'fault',status:'PASS',candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,real_kills:kills,cases}));
});

test('SS-009 committed supplement survives a real kill without a second Ticket or duplicate event',{timeout:120000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009supp',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});let c=await child(databaseUrl,observeResource);
    try{
      const body=input('处方提交不了'),ref=(await c.send({action:'accept',input:body})).result.receipt.request_ref;await c.send({action:'process',ref});
      const supplement={schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'补充：只有这一台受影响'};
      assert.equal((await c.send({action:'accept',kind:'SUPPLEMENT',input:supplement,ref,barrier:'after-commit'})).type,'barrier');await c.kill();c=await child(databaseUrl,observeResource);
      assert.equal((await c.send({action:'accept',kind:'SUPPLEMENT',input:supplement,ref})).result.replayed,true);
      await c.send({action:'recover'});assert.equal((await c.send({action:'process',ref})).result.replayed,true);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,1);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM intake.service_intake_event WHERE event_type='intake.web_supplement_added'")).rows[0].n,1);
      assert.equal((await pool.query('SELECT input_revision,processed_revision FROM intake.web_request_binding')).rows[0].processed_revision,'2');
    }finally{await c.kill();}
  }});
  t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'fault',status:'PASS',candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,supplement_real_kill:true,supplement_replayed:true,tickets:1,supplement_events:1}));
});

test('SS-009 a terminated owned PostgreSQL backend preserves accepted input across a fresh processor', {timeout:120000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009dbfail',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});let c=await child(databaseUrl,observeResource);
    try{
      const body=input('处方提交不了'),ref=(await c.send({action:'accept',input:body})).result.receipt.request_ref;
      assert.equal((await c.send({action:'process',ref,barrier:'before-commit'})).type,'barrier');
      const backends=(await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='ss009_owned_crash' AND pid<>pg_backend_pid() AND state='idle in transaction'")).rows;assert.equal(backends.length,1);
      assert.equal((await pool.query('SELECT pg_terminate_backend($1) AS terminated',[backends[0].pid])).rows[0].terminated,true);
      await c.kill();c=await child(databaseUrl,observeResource);await c.send({action:'recover'});
      assert.equal((await c.send({action:'process',ref})).result.replayed,true);
      assert.equal((await pool.query('SELECT processed_revision FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0].processed_revision,'1');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    }finally{await c.kill();}
  }});
  t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'fault',status:'PASS',candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,owned_backend_terminated:true,recovery_verified:true,shared_database_service_stopped:false}));
});
