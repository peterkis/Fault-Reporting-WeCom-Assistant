import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {P2016RuntimeOptions,P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../../src/platform/time-contract.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../scripts/p2-016-migrate.mjs';
import {migrateTicketSelfHandling} from '../../scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketUnassign} from '../../scripts/ticket-unassign-migrate.mjs';
export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
export function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export interface T08Http {get(path:string):Promise<{status:number;value:Record<string,unknown>}>;post(path:string,body:Record<string,unknown>):Promise<{status:number;value:Record<string,unknown>}>;cookie:string}
export interface T08Fixture {pool:PostgresPool;origin:string;runtime:P2016EnabledRuntime;admin:string;dispatcher:string;handler:string;otherHandler:string;http(index:number):Promise<T08Http>;createTicket():Promise<string>}
type Options=Partial<Pick<P2016RuntimeOptions,'ticketUnassignEnabled'|'ticketAssignmentEnabled'|'ticketConversationSelfHandlingEnabled'|'workbenchDraftRecoveryEnabled'|'workbenchConversationsEnabled'|'workbenchRealtimeEnabled'>> & {migration?:boolean};
export async function withT08Fixture(run:(fixture:T08Fixture)=>Promise<void>,options:Options={}){
 const databaseUrl=process.env.PILOT_DATABASE_URL;assert.equal(typeof databaseUrl,'string');
 await withP2016IsolatedDatabase({databaseUrl,purpose:'t08slice',run:async(context:{pool:PostgresPool;databaseUrl:string})=>{
  await applyThrough030(context);const legacyOptions={databaseUrl:context.databaseUrl,mode:'apply'};await migrateP2016(legacyOptions);
  await migrateTicketSelfHandling({databaseUrl:context.databaseUrl,mode:'apply'});if(options.migration!==false)await migrateTicketUnassign({databaseUrl:context.databaseUrl,mode:'apply'});
  const access=createPilotAccessService({pool:context.pool});
  const members=await Promise.all([['ADMIN'],['DISPATCHER'],['HANDLER'],['HANDLER']].map((roles,index)=>access.upsertPrincipal({wecomUserId:'t08-slice-'+index+'-'+randomUUID(),displayName:'T08 合成内部人员 '+index,roles,resolverTeamIds:['PILOT_IT']})));
  const admin=members[0],dispatcher=members[1],handler=members[2],otherHandler=members[3];assert.ok(admin&&dispatcher&&handler&&otherHandler);
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address!=='string');await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  const port=address.port,origin='http://127.0.0.1:'+port;
  const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:port,principalIds:members.map(member=>member.id),externalSendEnabled:false,ticketUnassignEnabled:options.ticketUnassignEnabled??true,ticketAssignmentEnabled:options.ticketAssignmentEnabled??false,ticketConversationSelfHandlingEnabled:options.ticketConversationSelfHandlingEnabled??false,workbenchDraftRecoveryEnabled:options.workbenchDraftRecoveryEnabled??false,workbenchConversationsEnabled:options.workbenchConversationsEnabled??false,workbenchRealtimeEnabled:options.workbenchRealtimeEnabled??false});assert.ok('server' in runtime);
  try{await listenConversationWorkbenchServer(runtime.server,{port});const cookies=runtime.authenticate.browserCookies?.();assert.equal(cookies?.length,4);assert.ok(cookies);
   const http=async(index:number):Promise<T08Http>=>{const entry=cookies[index];assert.ok(entry);const cookie=entry.name+'='+entry.value;
    const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
    const csrf=(await get('/api/lifecycle/bootstrap')).value.csrf_token;
    const post=async(path:string,body:Record<string,unknown>)=>{const version=body.expected_row_version??body.expected_version;const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':text(csrf),'idempotency-key':text(body.client_command_id),'if-match':'"'+version+'"'},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};};return {get,post,cookie};};
   const createTicket=async()=>{const intake=object(await seedPersistedIntake({pool:context.pool,text:'T08 隔离合成报修 '+randomUUID(),requestType:'INCIDENT',status:'RECEIVED'}));const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:text(intake.intakeId),occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'t08-slice-public-core'});assert.ok(created.ticket);return created.ticket.id;};
   await run({pool:context.pool,origin,runtime,admin:admin.id,dispatcher:dispatcher.id,handler:handler.id,otherHandler:otherHandler.id,http,createTicket});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);assert.equal((await runtime.observability.metrics()).sse_clients,0);}
 }});
}
