// STAGED_RUNTIME / first actual authority, resource or schema boundary execution pending.
// Real isolated fixture, native HTTP and catalog drift only. No persisted flags or valid business rows are changed by fault SQL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createP2016Runtime,type P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';
import {FOLLOW_UP_MIGRATION_ID,followUpSchemaReady} from '../scripts/workbench-follow-up-schedules-migrate.mjs';
import {FOLLOW_UP_DUE_MIGRATION_ID,followUpDueSchemaReady} from '../scripts/workbench-follow-up-due-migrate.mjs';
import {withT37Fixture,object,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
const command=(ticketVersion:number,scheduleVersion='0')=>({client_command_id:randomUUID(),expected_version:ticketVersion,expected_schedule_version:scheduleVersion,
  reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2030-01-02 09:30:00'});
async function facts(http:T37Http,path:string){return {ticket:await current(http,path),events:await current(http,path+'/events?limit=200'),
  responsibility:await current(http,path+'/responsibility'),deliveries:await current(http,path+'/deliveries')};}
async function schemaAbsence(fixture:T37Fixture){
  const result=await fixture.pool.query(`SELECT to_regclass('pilot_ticket.follow_up_schedule')::text AS current_table,
    to_regclass('pilot_ticket.follow_up_schedule_revision')::text AS revision_table,to_regclass('pilot_ticket.follow_up_due_signal')::text AS marker_table`);
  assert.deepEqual(result.rows,[{current_table:null,revision_table:null,marker_table:null}]);
  assert.equal((await fixture.pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[[FOLLOW_UP_MIGRATION_ID,FOLLOW_UP_DUE_MIGRATION_ID]])).rowCount,0);
}
async function originalLedger(fixture:T37Fixture){return (await fixture.pool.query(`SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text
  FROM platform.schema_migration WHERE migration_id=ANY($1::text[]) ORDER BY migration_id`,[[FOLLOW_UP_MIGRATION_ID,FOLLOW_UP_DUE_MIGRATION_ID]])).rows;}
async function arrange(http:T37Http,path:string){const ticket=await current(http,path),response=await http.post(path+'/follow-up-schedule',command(version(ticket.version)));assert.equal(response.status,200,JSON.stringify(response.value));}
async function privateScheduleFacts(fixture:T37Fixture,ticketId:string){return {
  current:(await fixture.pool.query('SELECT * FROM pilot_ticket.follow_up_schedule WHERE ticket_id=$1::uuid',[ticketId])).rows,
  revision:(await fixture.pool.query('SELECT * FROM pilot_ticket.follow_up_schedule_revision WHERE ticket_id=$1::uuid ORDER BY schedule_version',[ticketId])).rows,
  marker:(await fixture.pool.query('SELECT * FROM pilot_ticket.follow_up_due_signal WHERE ticket_id=$1::uuid ORDER BY schedule_version',[ticketId])).rows,
};}
async function restartedHttp(runtime:P2016EnabledRuntime,origin:string):Promise<T37Http>{
  const entry=runtime.authenticate.browserCookies?.()[0];assert.ok(entry);const cookie=entry.name+'='+entry.value;
  const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
  const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{
    const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,
      'idempotency-key':text(body.client_command_id),'if-match':'"'+version(body.expected_version)+'"'},body:JSON.stringify(body)});
    return {status:response.status,value:object(await response.json())};
  };return {get,post};
}
async function originalConstraint(fixture:T37Fixture,table:string,name:string){
  const result=await fixture.pool.query<{definition:string}>('SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass($1) AND conname=$2',[table,name]);
  assert.equal(result.rowCount,1);return text(result.rows[0]?.definition);
}

test('default off with no 049 or 053 keeps independent UNKNOWN receipts, and explicit enable without schema fails closed',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,before=await facts(dispatcher,path);
    const bootstrap=await current(dispatcher,'/api/lifecycle/bootstrap');assert.equal(bootstrap.follow_up_schedules_enabled,false);assert.equal(bootstrap.follow_up_schedule_receipt_enabled,true);
    await schemaAbsence(fixture);const body=command(version(before.ticket.version)),ackPath=path+'/follow-up-schedule/commands/'+body.client_command_id;
    assert.deepEqual(await current(dispatcher,ackPath),{client_command_id:body.client_command_id,ticket_id:ticketId,state:'UNKNOWN'});
    const disabledView=await dispatcher.get(path+'/follow-up-schedule');assert.equal(disabledView.status,503);assert.equal(object(disabledView.value.error).code,'P2_016_DISABLED');
    const disabledWrite=await dispatcher.post(path+'/follow-up-schedule',body);assert.equal(disabledWrite.status,503);assert.equal(object(disabledWrite.value.error).code,'P2_016_DISABLED');
    // The actual absent tables make accidental SELECT/INSERT against either new store fail; no fake query Port.
    assert.deepEqual(await fixture.runtime.runFollowUpDueBatch(),{scanned:0,emitted:0,skipped:0});
    assert.deepEqual(await current(dispatcher,ackPath),{client_command_id:body.client_command_id,ticket_id:ticketId,state:'UNKNOWN'});
    assert.deepEqual(await facts(dispatcher,path),before);await schemaAbsence(fixture);
    assert.equal((await fixture.pool.query("SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND command_type='WORKBENCH_FOLLOW_UP_SCHEDULE'",[ticketId])).rowCount,0);
    await fixture.runtime.stop();assert.equal(fixture.runtime.server.listening,false);
    const port=Number(new URL(fixture.origin).port),runtime=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:port,
      principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,workbenchFollowUpSchedulesEnabled:true});
    try{
      // Same isolated DB and actual native router. No worker timer or new migration is started here.
      await listenConversationWorkbenchServer(runtime.server,{port});const enabled=await restartedHttp(runtime,fixture.origin);
      const enabledBootstrap=await current(enabled,'/api/lifecycle/bootstrap');assert.equal(enabledBootstrap.follow_up_schedules_enabled,true);assert.equal(enabledBootstrap.follow_up_schedule_receipt_enabled,true);
      const readiness=await enabled.get('/health/ready');assert.equal(readiness.status,503);assert.equal(readiness.value.base_service_ready,false);
      assert.equal(object(readiness.value.checks).workbench_follow_up_schedules_schema,false);
      const missingView=await enabled.get(path+'/follow-up-schedule');assert.equal(missingView.status,503);assert.equal(object(missingView.value.error).code,'P2_016_FOLLOW_UP_UNAVAILABLE');
      const missingWrite=await enabled.post(path+'/follow-up-schedule',body);assert.equal(missingWrite.status,503);assert.equal(object(missingWrite.value.error).code,'P2_016_FOLLOW_UP_UNAVAILABLE');
      await assert.rejects(()=>runtime.runFollowUpDueBatch(),{code:'P2_016_FOLLOW_UP_UNAVAILABLE'});
      assert.deepEqual(await current(enabled,ackPath),{client_command_id:body.client_command_id,ticket_id:ticketId,state:'UNKNOWN'});
      assert.deepEqual(await facts(enabled,path),before);await schemaAbsence(fixture);
      assert.equal((await fixture.pool.query("SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND command_type='WORKBENCH_FOLLOW_UP_SCHEDULE'",[ticketId])).rowCount,0);
    }finally{
      await runtime.stop();assert.equal(runtime.server.listening,false);
      assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);
      assert.equal((await runtime.observability.metrics()).sse_clients,0);
    }
  }); // Intentionally omit the option: the original fixture installs neither 049 nor 053.
});

test('049 time-pair constraint drift fails readiness without changing the immutable SQL, ledger or real schedule facts',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const sqlFile=new URL('../database/migrations/049_workbench_follow_up_schedules.sql',import.meta.url),sqlBefore=await readFile(sqlFile);
    const dispatcher=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;await arrange(dispatcher,path);
    const before=await facts(dispatcher,path),scheduleBefore=await current(dispatcher,path+'/follow-up-schedule'),privateBefore=await privateScheduleFacts(fixture,ticketId),ledgerBefore=await originalLedger(fixture);
    assert.equal(ledgerBefore.length,2);assert.equal(await followUpSchemaReady(fixture.pool),true);assert.equal(await followUpDueSchemaReady(fixture.pool),true);
    for(const [table,name] of [['pilot_ticket.follow_up_schedule','follow_up_current_time_pair'],['pilot_ticket.follow_up_schedule_revision','follow_up_revision_time_pair']] as const){
      const definition=await originalConstraint(fixture,table,name);assert.ok(definition.startsWith('CHECK '));let dropped=false;
      try{
        // Exact owned schema fault only. No valid/invalid schedule row is inserted or updated.
        await fixture.pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);dropped=true;
        assert.equal(await followUpSchemaReady(fixture.pool),false,'T37_049_TIME_PAIR_DRIFT_MUST_BLOCK_READINESS: '+name);
        assert.equal(await followUpDueSchemaReady(fixture.pool),false,'053 must retain its 049 prerequisite');
        const unavailable=await dispatcher.get(path+'/follow-up-schedule');assert.equal(unavailable.status,503);assert.equal(object(unavailable.value.error).code,'P2_016_FOLLOW_UP_UNAVAILABLE');
        assert.deepEqual(await privateScheduleFacts(fixture,ticketId),privateBefore);
      }finally{
        if(dropped)await fixture.pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
        assert.equal(await originalConstraint(fixture,table,name),definition);
        assert.equal(await followUpSchemaReady(fixture.pool),true);assert.equal(await followUpDueSchemaReady(fixture.pool),true);
        assert.deepEqual(await readFile(sqlFile),sqlBefore);assert.deepEqual(await originalLedger(fixture),ledgerBefore);
        assert.deepEqual(await privateScheduleFacts(fixture,ticketId),privateBefore);
      }
    }
    assert.deepEqual(await facts(dispatcher,path),before);assert.deepEqual(await current(dispatcher,path+'/follow-up-schedule'),scheduleBefore);
  },{workbenchFollowUpSchedulesEnabled:true});
});

test('053 positive-version constraint drift fails due readiness and restores only its original catalog definition',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const sqlFile=new URL('../database/migrations/053_workbench_follow_up_due_signals.sql',import.meta.url),sqlBefore=await readFile(sqlFile);
    const dispatcher=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;await arrange(dispatcher,path);
    const before=await facts(dispatcher,path),privateBefore=await privateScheduleFacts(fixture,ticketId),ledgerBefore=await originalLedger(fixture);
    const table='pilot_ticket.follow_up_due_signal',name='follow_up_due_signal_positive_version',definition=await originalConstraint(fixture,table,name);let dropped=false;
    assert.equal(await followUpDueSchemaReady(fixture.pool),true);
    try{
      await fixture.pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);dropped=true;
      assert.equal(await followUpSchemaReady(fixture.pool),true,'049 remains intact during the isolated 053 fault');
      assert.equal(await followUpDueSchemaReady(fixture.pool),false,'T37_053_MARKER_CONSTRAINT_DRIFT_MUST_BLOCK_READINESS');
      await assert.rejects(()=>fixture.runtime.runFollowUpDueBatch(),{code:'P2_016_FOLLOW_UP_UNAVAILABLE'});
      assert.deepEqual(await privateScheduleFacts(fixture,ticketId),privateBefore);
    }finally{
      if(dropped)await fixture.pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
      assert.equal(await originalConstraint(fixture,table,name),definition);assert.equal(await followUpDueSchemaReady(fixture.pool),true);
      assert.deepEqual(await readFile(sqlFile),sqlBefore);assert.deepEqual(await originalLedger(fixture),ledgerBefore);
      assert.deepEqual(await privateScheduleFacts(fixture,ticketId),privateBefore);
    }
    assert.deepEqual(await facts(dispatcher,path),before);
  },{workbenchFollowUpSchedulesEnabled:true});
});
