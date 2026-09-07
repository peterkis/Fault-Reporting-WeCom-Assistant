import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { fixtureP2012,applyThrough031 } from './helpers/p2-012-postgres-harness.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { nowShanghaiLocal,shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
function start(role,databaseUrl,input){
  const child=fork(new URL('./helpers/p2-012-'+role+'-child.mjs',import.meta.url),[],{env:{...process.env,PILOT_DATABASE_URL:databaseUrl},execArgv:[],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const messages=[];child.on('message',message=>messages.push(message));child.send(input);
  return {child,next(kind){return new Promise((resolve,reject)=>{
    const inspect=()=>{const error=messages.find(m=>m.kind==='error');if(error){cleanup();reject(new Error(error.code));return;}
      const index=messages.findIndex(m=>m.kind===kind);if(index>=0){cleanup();resolve(messages.splice(index,1)[0]);}};
    const timer=setTimeout(()=>{cleanup();reject(new Error('P2_012_CHILD_TIMEOUT'));},20000);
    const cleanup=()=>{clearTimeout(timer);child.off('message',inspect);};child.on('message',inspect);inspect();
  });}};
}
async function exit(child){if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('P2_012_CHILD_EXIT_TIMEOUT')),10000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
async function port(){const p=createServer();await new Promise(r=>p.listen(0,'127.0.0.1',r));const n=p.address().port;await new Promise(r=>p.close(r));return n;}
test('P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends',{timeout:120000},async t=>{
  const children=[];
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012restart',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:2}),principal=f.admin,candidate=await f.newCandidate();
    await createP2012IncidentCommandService({pool,enabled:true}).perform({authContext:{principal_id:principal.id},command:{action:'START_REVIEW',candidate_review_id:candidate.id,expected_row_version:'1',client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED'}});
    const command={client_command_id:randomUUID(),expected_candidate_version:'2',reason_code:'OPERATOR_REVIEWED',confirmed_scope:'LOCAL',owner_principal_id:principal.id,selected_report_refs:f.reports.map(r=>r.decisionId)};
    const launch=(role,input)=>{const c=start(role,databaseUrl,input);children.push(c.child);return c;};
    async function post(server,origin){const ready=await server.next('ready');const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:ready.cookie}})).json();
      return fetch(origin+'/api/incident-candidates/'+candidate.id+'/confirm',{method:'POST',headers:{cookie:ready.cookie,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"2"'},body:JSON.stringify(command)});}
    try{
      const firstPort=await port(),first=launch('server',{principalId:principal.id,port:firstPort,crashAfterCommit:true});
      const lost=post(first,'http://127.0.0.1:'+firstPort).catch(()=>null);await first.next('committed');await lost;await exit(first.child);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM incident.incident')).rows[0].n,1);
      const secondPort=await port(),second=launch('server',{principalId:principal.id,port:secondPort,crashAfterCommit:false});
      const replay=await post(second,'http://127.0.0.1:'+secondPort);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
      second.child.kill('SIGTERM');await exit(second.child);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.incident_event WHERE event_type='incident.confirmed'")).rows[0].n,1);
      const deliveryId=(await pool.query('SELECT d.id AS delivery_id FROM communication.incident_notification_binding b JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id ORDER BY d.id LIMIT 1')).rows[0].delivery_id;
      const hanging=launch('worker',{mode:'hang',deliveryId});await hanging.next('provider-entered');hanging.child.kill('SIGKILL');await exit(hanging.child);
      const recover=launch('worker',{mode:'recover',deliveryId});const recovered=await recover.next('done');assert.equal(recovered.calls,0);assert.equal(recovered.status,'RECONCILIATION_REQUIRED');await exit(recover.child);
      const reconciliation=createCommunicationReconciliationPort({pool,nowEpochMs:()=>String(BigInt(shanghaiLocalToEpochMs(nowShanghaiLocal()))+60000n)});
      await reconciliation.reconcileUnknownDelivery({deliveryId,expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_NOT_SENT_REQUEUE',authorized:true,reasonCode:'SYNTHETIC_CONFIRMED_NOT_SENT'});
      const ack=launch('worker',{mode:'ack',deliveryId});const sent=await ack.next('done');assert.equal(sent.calls,1);assert.equal(sent.status,'SENT');await exit(ack.child);
      const again=launch('worker',{mode:'ack',deliveryId});const repeated=await again.next('done');assert.equal(repeated.calls,0);assert.equal(repeated.status,'SENT');await exit(again.child);
      t.diagnostic(JSON.stringify({server_commit_response_lost:true,restart_replayed:true,incident_confirmed_event_count:1,unknown_recovery_send_calls:0,authorized_retry_calls:1,ack_restart_send_calls:0}));
    }finally{for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit(child);}}
    assert.ok(children.every(c=>c.exitCode!==null||c.signalCode!==null));
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name IN ('p2_012_test_server_child','p2_012_test_worker_child')")).rows[0].n,0);
  }});
  await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});
