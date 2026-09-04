import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
function start(role,databaseUrl,input){
  const child=fork(new URL('./helpers/p2-016-'+role+'-child.mjs',import.meta.url),[],{env:{...process.env,PILOT_DATABASE_URL:databaseUrl},execArgv:[],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const messages=[];child.on('message',message=>messages.push(message));child.send(input);
  return {child,next(kind){return new Promise((resolve,reject)=>{
    const inspect=()=>{const error=messages.find(m=>m.kind==='error');if(error){cleanup();reject(new Error(error.code));return;}
      const index=messages.findIndex(m=>m.kind===kind);if(index>=0){cleanup();resolve(messages.splice(index,1)[0]);}};
    const timer=setTimeout(()=>{cleanup();reject(new Error('P2_016_CHILD_TIMEOUT'));},20000);
    const cleanup=()=>{clearTimeout(timer);child.off('message',inspect);};child.on('message',inspect);inspect();
  });}};
}
async function exit(child){if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('P2_016_CHILD_EXIT_TIMEOUT')),10000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
async function port(){const p=createServer();await new Promise(r=>p.listen(0,'127.0.0.1',r));const n=p.address().port;await new Promise(r=>p.close(r));return n;}
test('P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends',{timeout:120000},async t=>{
  const children=[];
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016restart',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-restart-admin',displayName:'合成重启测试',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const seed=await seedPersistedIntake({pool,text:'合成故障',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
    const ticket=(await createPilotTicketCore({pool}).createForIntake({intakeId:seed.intakeId,occurredAt:seed.receivedAt,traceId:'synthetic-restart'})).ticket;
    const command={client_command_id:randomUUID(),expected_version:1,reason_code:'SYNTHETIC_RESTART'};
    const launch=(role,input)=>{const c=start(role,databaseUrl,input);children.push(c.child);return c;};
    async function post(server,origin){const ready=await server.next('ready');const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:ready.cookie}})).json();
      return fetch(origin+'/api/tickets/'+ticket.id+'/accept',{method:'POST',headers:{cookie:ready.cookie,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"1"'},body:JSON.stringify(command)});}
    try{
      const firstPort=await port(),first=launch('server',{principalId:principal.id,port:firstPort,crashAfterCommit:true});
      const lost=post(first,'http://127.0.0.1:'+firstPort).catch(()=>null);await first.next('committed');await lost;await exit(first.child);
      assert.equal((await pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.id])).rows[0].version,2);
      const secondPort=await port(),second=launch('server',{principalId:principal.id,port:secondPort,crashAfterCommit:false});
      const replay=await post(second,'http://127.0.0.1:'+secondPort);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
      second.child.kill('SIGTERM');await exit(second.child);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid',[ticket.id])).rows[0].n,1);
      const deliveryId=(await pool.query('SELECT delivery_id::text FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid',[ticket.id])).rows[0].delivery_id;
      const hanging=launch('worker',{mode:'hang',deliveryId});await hanging.next('provider-entered');hanging.child.kill('SIGKILL');await exit(hanging.child);
      const recover=launch('worker',{mode:'recover',deliveryId});const recovered=await recover.next('done');assert.equal(recovered.calls,0);assert.equal(recovered.status,'RECONCILIATION_REQUIRED');await exit(recover.child);
      const reconciliation=createCommunicationReconciliationPort({pool,nowEpochMs:()=>String(Date.now()+60000)});
      await reconciliation.reconcileUnknownDelivery({deliveryId,expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_NOT_SENT_REQUEUE',authorized:true,reasonCode:'SYNTHETIC_CONFIRMED_NOT_SENT'});
      const ack=launch('worker',{mode:'ack',deliveryId});const sent=await ack.next('done');assert.equal(sent.calls,1);assert.equal(sent.status,'SENT');await exit(ack.child);
      const again=launch('worker',{mode:'ack',deliveryId});const repeated=await again.next('done');assert.equal(repeated.calls,0);assert.equal(repeated.status,'SENT');await exit(again.child);
      t.diagnostic(JSON.stringify({server_commit_response_lost:true,restart_replayed:true,ticket_event_count:1,unknown_recovery_send_calls:0,authorized_retry_calls:1,ack_restart_send_calls:0}));
    }finally{for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit(child);}}
    assert.ok(children.every(c=>c.exitCode!==null||c.signalCode!==null));
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name IN ('p2_016_test_server_child','p2_016_test_worker_child')")).rows[0].n,0);
  }});
  await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});
