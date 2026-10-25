import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../app/server/src/p2-006-workbench-http.mjs';
import {createPilotAccessService} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {PilotRole} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../../app/server/src/platform/time-contract.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../app/server/scripts/p2-016-migrate.mjs';
import {migrateTicketSelfHandling} from '../../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketUnassign} from '../../app/server/scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../../app/server/scripts/ticket-return-to-dispatch-migrate.mjs';

export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
export function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isInteger(value)&&value>0&&value<=2147483647);return value;}
export interface T09Http {get(path:string):Promise<{status:number;value:Record<string,unknown>}>;post(path:string,body:Record<string,unknown>):Promise<{status:number;value:Record<string,unknown>}>}
export interface T09Fixture {pool:PostgresPool;origin:string;runtime:P2016EnabledRuntime;admin:string;dispatcher:string;handler:string;otherHandler:string;http(index:number):Promise<T09Http>;createTicket():Promise<string>}

/** Only a disabled planned option is added; no test-owned HTTP handler supplies success. */
export async function withT09Fixture(run:(fixture:T09Fixture)=>Promise<void>,{ticketReturnToDispatchEnabled=false,workbenchDraftRecoveryEnabled=false}:{ticketReturnToDispatchEnabled?:boolean;workbenchDraftRecoveryEnabled?:boolean}={}){
 const databaseUrl=process.env.PILOT_DATABASE_URL;assert.equal(typeof databaseUrl,'string');
 await withP2016IsolatedDatabase({databaseUrl,purpose:'t09',run:async(context:{pool:PostgresPool;databaseUrl:string})=>{
  await applyThrough030(context);const migrationOptions={databaseUrl:context.databaseUrl,mode:'apply'};await migrateP2016(migrationOptions);
  await migrateTicketSelfHandling({databaseUrl:context.databaseUrl,mode:'apply'});await migrateTicketUnassign({databaseUrl:context.databaseUrl,mode:'apply'});
  if(ticketReturnToDispatchEnabled)await migrateTicketReturnToDispatch({databaseUrl:context.databaseUrl,mode:'apply'});
  const access=createPilotAccessService({pool:context.pool}),roles:PilotRole[][]=[['ADMIN'],['DISPATCHER'],['HANDLER'],['HANDLER']];
  const members=await Promise.all(roles.map((role,index)=>access.upsertPrincipal({wecomUserId:'t09-synthetic-'+index+'-'+randomUUID(),displayName:'T09 合成内部人员 '+index,roles:role,resolverTeamIds:['PILOT_IT']})));
  const [admin,dispatcher,handler,otherHandler]=members;assert.ok(admin&&dispatcher&&handler&&otherHandler);
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address!=='string');await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  const port=address.port,origin='http://127.0.0.1:'+port;
  const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:port,principalIds:members.map(member=>member.id),externalSendEnabled:false,ticketAssignmentEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketUnassignEnabled:true,...{ticketReturnToDispatchEnabled,workbenchDraftRecoveryEnabled}});assert.ok('server' in runtime);
  try{
   assert.equal(runtime.orchestrationWorker,null);assert.equal(runtime.incidentExtension,null);
   await listenConversationWorkbenchServer(runtime.server,{port});const cookies=runtime.authenticate.browserCookies?.();assert.equal(cookies?.length,4);assert.ok(cookies);
   const http=async(index:number):Promise<T09Http>=>{const cookieEntry=cookies[index];assert.ok(cookieEntry);const cookie=cookieEntry.name+'='+cookieEntry.value;
    const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return{status:response.status,value:object(await response.json())};};
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
    const post=async(path:string,body:Record<string,unknown>)=>{const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+String(body.expected_row_version??body.expected_version)+'"'},body:JSON.stringify(body)});return{status:response.status,value:object(await response.json())};};
    return{get,post};};
   const createTicket=async()=>{const intake=object(await seedPersistedIntake({pool:context.pool,text:'T09 全新隔离合成打印故障 '+randomUUID(),requestType:'INCIDENT',status:'RECEIVED'}));const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:text(intake.intakeId),occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'t09-public-core-fixture'});assert.ok(created.ticket);return created.ticket.id;};
   await run({pool:context.pool,origin,runtime,admin:admin.id,dispatcher:dispatcher.id,handler:handler.id,otherHandler:otherHandler.id,http,createTicket});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);assert.equal((await runtime.observability.metrics()).sse_clients,0);}
 }});
}
