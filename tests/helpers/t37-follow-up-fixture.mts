import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../../src/platform/time-contract.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../scripts/p2-016-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../../scripts/workbench-follow-up-schedules-migrate.mjs';

export function object(value:unknown):Record<string,unknown>{
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;
}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
export function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export type T37Http = Readonly<{
  get(path:string):Promise<{status:number;value:Record<string,unknown>}>;
  post(path:string,body:Readonly<Record<string,unknown>>):Promise<{status:number;value:Record<string,unknown>}>;
}>;
export type T37Fixture = Readonly<{
  pool:PostgresPool;origin:string;runtime:P2016EnabledRuntime;
  dispatcher:string;handler:string;otherHandler:string;
  http(index:number):Promise<T37Http>;createTicket():Promise<string>;
}>;
/** Omitted option is the actual default-off composition; no fixture manufactures an HTTP success. */
export async function withT37Fixture(run:(fixture:T37Fixture)=>Promise<void>,options:Readonly<{workbenchFollowUpSchedulesEnabled?:boolean}>={}){
  const databaseUrl=process.env.PILOT_DATABASE_URL;assert.equal(typeof databaseUrl,'string');
  await withP2016IsolatedDatabase({databaseUrl,purpose:'t37',run:async(context:{pool:PostgresPool;databaseUrl:string})=>{
    await applyThrough030(context);
    const legacyOptions={databaseUrl:context.databaseUrl,mode:'apply'};await migrateP2016(legacyOptions);
    if(options.workbenchFollowUpSchedulesEnabled===true)await migrateWorkbenchFollowUpSchedules({databaseUrl:context.databaseUrl,mode:'apply'});
    const access=createPilotAccessService({pool:context.pool});
    const dispatcher=await access.upsertPrincipal({wecomUserId:'t37-dispatcher-'+randomUUID(),displayName:'T37 合成调度员',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
    const handler=await access.upsertPrincipal({wecomUserId:'t37-handler-'+randomUUID(),displayName:'T37 合成处理人',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    const otherHandler=await access.upsertPrincipal({wecomUserId:'t37-other-'+randomUUID(),displayName:'T37 合成同事',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const address=probe.address();assert.ok(address&&typeof address!=='string');
    await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const port=address.port,origin='http://127.0.0.1:'+port;
    // Only explicit opt-in installs049. The original source/body exercises the actual native router.
    const followUpOption=options.workbenchFollowUpSchedulesEnabled===undefined?{}:{workbenchFollowUpSchedulesEnabled:options.workbenchFollowUpSchedulesEnabled};
    const runtimeOptions={pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:origin,listenPort:port,
      principalIds:[dispatcher.id,handler.id,otherHandler.id],gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,...followUpOption};
    const runtime=createP2016Runtime(runtimeOptions);
    try{
      assert.equal(runtime.orchestrationWorker,null);assert.equal(runtime.incidentExtension,null);assert.equal(runtime.selfService,null);
      await listenConversationWorkbenchServer(runtime.server,{port});
      const cookies=runtime.authenticate.browserCookies?.();assert.ok(cookies&&cookies.length===3);
      const http=async(index:number):Promise<T37Http>=>{
        const entry=cookies[index];assert.ok(entry);const cookie=entry.name+'='+entry.value;
        const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
        const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
        const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{
          const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,
            'idempotency-key':text(body.client_command_id),'if-match':'"'+String(body.expected_version)+'"'},body:JSON.stringify(body)});
          return {status:response.status,value:object(await response.json())};
        };
        return {get,post};
      };
      const createTicket=async()=>{
        const intake=object(await seedPersistedIntake({pool:context.pool,text:'T37 全新隔离合成报修，设备需要跟进 '+randomUUID(),requestType:'INCIDENT',status:'RECEIVED'}));
        const result=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:text(intake.intakeId),occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'t37-public-core-fixture'});
        assert.ok(result.ticket);return result.ticket.id;
      };
      await run({pool:context.pool,origin,runtime,dispatcher:dispatcher.id,handler:handler.id,otherHandler:otherHandler.id,http,createTicket});
    }finally{
      await runtime.stop();assert.equal(runtime.server.listening,false);
      assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);
      assert.equal((await runtime.observability.metrics()).sse_clients,0);
    }
  }});
}
