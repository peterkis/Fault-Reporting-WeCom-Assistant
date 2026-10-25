import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {test} from 'node:test';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {P2016UnassignCommand} from '../contracts/workbench_unassign_contracts.js';
import {assertLocalDateTime} from '../app/server/src/platform/time-contract.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {migrateP2016} from '../app/server/scripts/p2-016-migrate.mjs';
import {migrateTicketSelfHandling} from '../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketUnassign} from '../app/server/scripts/ticket-unassign-migrate.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';

function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
async function unusedPort():Promise<number>{
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const address=probe.address();assert.ok(address&&typeof address!=='string');
  await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));return address.port;
}

// SOURCE-only first tracer. The planned option is intentionally supplied to the real runtime;
// its current implementation has no unassign route/option. No test-owned handler supplies a success.
test('an authorized dispatcher withdraws one unstarted Ticket assignment while retaining its group, round, communication and existing deliveries',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;assert.equal(typeof databaseUrl,'string');
  await withP2016IsolatedDatabase({databaseUrl,purpose:'t08',run:async(context:{pool:PostgresPool;databaseUrl:string})=>{
    const migrationOptions={databaseUrl:context.databaseUrl,mode:'apply'};
    await applyThrough030(context);await migrateP2016(migrationOptions);
    await migrateTicketSelfHandling({databaseUrl:context.databaseUrl,mode:'apply'});
    await migrateTicketUnassign({databaseUrl:context.databaseUrl,mode:'apply'});
    const access=createPilotAccessService({pool:context.pool});
    const dispatcher=await access.upsertPrincipal({wecomUserId:'t08-dispatcher-'+randomUUID(),displayName:'T08 合成调度员',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
    const handler=await access.upsertPrincipal({wecomUserId:'t08-handler-'+randomUUID(),displayName:'T08 合成处理人',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    const intake=object(await seedPersistedIntake({pool:context.pool,text:'T08 全新合成报修，打印服务不可用。',requestType:'INCIDENT',status:'RECEIVED'}));
    const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:string(intake.intakeId),occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'t08-public-fixture'});
    assert.ok(created.ticket);const ticketId=created.ticket.id,path='/api/tickets/'+ticketId;
    // Synthetic NEW precondition only in this freshly-created random fixture database.
    // The public Core creates QUEUED; responsibility changes and all assertions remain real HTTP.
    await context.pool.query("UPDATE pilot_ticket.ticket SET status='NEW' WHERE id=$1::uuid AND status='QUEUED' AND version=1 AND assignee_id IS NULL",[ticketId]);
    const port=await unusedPort(),origin='http://127.0.0.1:'+port;
    const runtimeOptions={pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:port,principalIds:[dispatcher.id,handler.id],externalSendEnabled:false,ticketAssignmentEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketUnassignEnabled:true};
    const runtime=createP2016Runtime(runtimeOptions);assert.ok('server' in runtime);
    try{
      assert.equal(runtime.orchestrationWorker,null);assert.equal(runtime.incidentExtension,null);
      await listenConversationWorkbenchServer(runtime.server,{port});
      const cookies=runtime.authenticate.browserCookies?.();assert.ok(cookies&&cookies.length===2);
      const http=async(index:number)=>{
        const entry=cookies[index];assert.ok(entry);const cookie=entry.name+'='+entry.value;
        const get=async(url:string)=>{const response=await fetch(origin+url,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
        const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=string(bootstrap.value.csrf_token);
        const post=async(url:string,body:object,version:number)=>{const command=object(body);const response=await fetch(origin+url,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':string(command.client_command_id),'if-match':'"'+version+'"'},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};};
        return {get,post};
      };
      const dispatch=await http(0),worker=await http(1);
      assert.equal((await dispatch.get(path)).value.status,'NEW');
      const assigned=await dispatch.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:handler.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]},1);assert.equal(assigned.status,200,JSON.stringify(assigned.value));
      await runtime.coordinator.runOnce();
      const related=rows((await worker.get(path+'/responsibility')).value.conversations);assert.equal(related.length,1);const source=related[0];assert.ok(source);
      const sessionId=string(source.session_id),sessionVersion=Number(source.session_row_version);assert.ok(Number.isSafeInteger(sessionVersion)&&sessionVersion>0);
      assert.equal((await worker.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:sessionVersion,reason_code:'T08_KEEP_COMMUNICATOR'},sessionVersion)).status,200);
      assert.equal((await worker.post(path+'/accept-for-later-with-conversations',{client_command_id:randomUUID(),expected_version:3,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]},3)).status,200);
      const before=(await dispatch.get(path)).value,beforeResponsibility=(await dispatch.get(path+'/responsibility')).value;
      const beforeEvents=rows((await dispatch.get(path+'/events?limit=200')).value.items),beforeDeliveries=(await dispatch.get(path+'/deliveries')).value;
      assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,handler.id);assert.equal(before.resolver_team_id,'PILOT_IT');assert.equal(before.version,4);
      assert.equal(beforeEvents.some(event=>event.event_type==='ticket.started'),false);
      const cycle=object(before.handling_cycle);assert.equal(cycle.cycle_no,1);assert.equal(cycle.first_responsibility_event_id,assigned.value.ticket_event_id);
      assert.equal(rows(beforeResponsibility.conversations)[0]?.conversation_principal_id,handler.id);
      const command:P2016UnassignCommand={client_command_id:randomUUID(),expected_version:4,reason_code:'WORKBENCH_UNASSIGN',reason:'原处理人尚未开始，本次交回调度重新安排。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
      const withdrawn=await dispatch.post(path+'/unassign',command,4);assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.value));assert.equal(withdrawn.value.ok,true);assert.equal(withdrawn.value.replayed,false);
      const after=(await dispatch.get(path)).value,afterResponsibility=(await dispatch.get(path+'/responsibility')).value;
      assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,'PILOT_IT');assert.equal(after.version,5);assert.equal(after.intake_id,before.intake_id);assert.deepEqual(after.handling_cycle,before.handling_cycle);
      assert.equal(afterResponsibility.ticket_assignee_id,null);assert.equal(afterResponsibility.resolver_team_id,'PILOT_IT');assert.deepEqual(afterResponsibility.conversations,beforeResponsibility.conversations);
      const afterEvents=rows((await dispatch.get(path+'/events?limit=200')).value.items);assert.equal(afterEvents.length,beforeEvents.length+1);
      assert.deepEqual(afterEvents.slice(0,-1),beforeEvents);const last=afterEvents.at(-1);assert.ok(last);
      assert.equal(last.event_type,'ticket.unassigned');assert.equal(last.old_status,'ACCEPTED');assert.equal(last.new_status,'QUEUED');assert.equal(last.aggregate_version,5);assert.equal(last.has_internal_note,true);assert.equal(last.has_external_note,false);assert.equal(last.event_id,withdrawn.value.ticket_event_id);
      assert.equal(afterEvents.filter(event=>event.event_type==='ticket.unassigned').length,1);assert.deepEqual((await dispatch.get(path+'/deliveries')).value,beforeDeliveries);
      const replay=await dispatch.post(path+'/unassign',command,4);assert.equal(replay.status,200,JSON.stringify(replay.value));assert.equal(replay.value.replayed,true);assert.equal(replay.value.ticket_event_id,withdrawn.value.ticket_event_id);assert.equal(replay.value.ticket_version,5);
      assert.deepEqual((await dispatch.get(path)).value,after);assert.deepEqual((await dispatch.get(path+'/events?limit=200')).value.items,afterEvents);assert.deepEqual((await dispatch.get(path+'/deliveries')).value,beforeDeliveries);
    }finally{
      await runtime.stop();assert.equal(runtime.server.listening,false);
      const connections=await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count)));
      assert.equal(connections,0);assert.equal((await runtime.observability.metrics()).sse_clients,0);
    }
  }});
});
