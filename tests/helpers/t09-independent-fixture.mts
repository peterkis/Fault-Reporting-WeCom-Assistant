import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import type {PilotRole} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../../src/platform/time-contract.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../scripts/p2-016-migrate.mjs';
import {migrateTicketSelfHandling} from '../../scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketUnassign} from '../../scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../../scripts/ticket-return-to-dispatch-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../../scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../../scripts/workbench-follow-up-due-migrate.mjs';
import {object,text} from './t09-fixture.mjs';
import type {T09Http} from './t09-fixture.mjs';

export interface T09IndependentFixture {pool:PostgresPool;databaseUrl:string;origin:string;runtime:P2016EnabledRuntime;handler:string;http(index:number):Promise<T09Http>;createTicket():Promise<string>}
/** T09 itself grants no T05/T06/T07/T08 consumer. Existing Core actions remain actual HTTP writes. */
export async function withT09IndependentFixture(run:(fixture:T09IndependentFixture)=>Promise<void>,options:{returnEnabled?:boolean;applyReturn?:boolean;followUpEnabled?:boolean}={}){
 const databaseUrl=process.env.PILOT_DATABASE_URL;assert.equal(typeof databaseUrl,'string');
 await withP2016IsolatedDatabase({databaseUrl,purpose:'t09only',run:async(context:{pool:PostgresPool;databaseUrl:string})=>{
  await applyThrough030(context);const legacyOptions={databaseUrl:context.databaseUrl,mode:'apply'};await migrateP2016(legacyOptions);
  await migrateTicketSelfHandling({databaseUrl:context.databaseUrl,mode:'apply'});await migrateTicketUnassign({databaseUrl:context.databaseUrl,mode:'apply'});
  if(options.followUpEnabled){await migrateWorkbenchFollowUpSchedules({databaseUrl:context.databaseUrl,mode:'apply'});await migrateWorkbenchFollowUpDueSignals({databaseUrl:context.databaseUrl,mode:'apply'});}
  if(options.applyReturn!==false)await migrateTicketReturnToDispatch({databaseUrl:context.databaseUrl,mode:'apply'});
  const roles:PilotRole[][]=[['ADMIN'],['DISPATCHER'],['HANDLER'],['HANDLER']],access=createPilotAccessService({pool:context.pool});
  const members=await Promise.all(roles.map((roles,index)=>access.upsertPrincipal({wecomUserId:'t09-independent-'+index+'-'+randomUUID(),displayName:'T09 独立合成内部人员 '+index,roles,resolverTeamIds:['PILOT_IT']})));const handler=members[2];assert.ok(handler);
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address!=='string');await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  const port=address.port,origin='http://127.0.0.1:'+port;
  const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:port,principalIds:members.map(row=>row.id),externalSendEnabled:false,ticketReturnToDispatchEnabled:options.returnEnabled??true,workbenchFollowUpSchedulesEnabled:options.followUpEnabled??false});assert.ok('server' in runtime);
  try{
   assert.equal(runtime.orchestrationWorker,null);assert.equal(runtime.incidentExtension,null);await listenConversationWorkbenchServer(runtime.server,{port});const cookies=runtime.authenticate.browserCookies?.();assert.equal(cookies?.length,4);assert.ok(cookies);
   const http=async(index:number):Promise<T09Http>=>{const entry=cookies[index];assert.ok(entry);const cookie=entry.name+'='+entry.value;const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return{status:response.status,value:object(await response.json())};};const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);return{get,post:async(path,body)=>{const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+String(body.expected_row_version??body.expected_version)+'"'},body:JSON.stringify(body)});return{status:response.status,value:object(await response.json())};}};};
   const createTicket=async()=>{const intake=object(await seedPersistedIntake({pool:context.pool,text:'T09 独立能力合成报修 '+randomUUID(),requestType:'INCIDENT',status:'RECEIVED'}));const result=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:text(intake.intakeId),occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'t09-independent-public-core'});assert.ok(result.ticket);return result.ticket.id;};
   await run({pool:context.pool,databaseUrl:context.databaseUrl,origin,runtime,handler:handler.id,http,createTicket});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);assert.equal((await runtime.observability.metrics()).sse_clients,0);}
 }});
}
