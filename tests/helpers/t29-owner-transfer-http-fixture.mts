import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {Server} from 'node:net';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import type {P2012RuntimeOptions} from '../../app/server/src/p2-012-workbench-assembly.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import type {IncidentOwnerTransferHostOptions} from '../../contracts/workbench_incident_owner_transfer_contracts.js';
import {createP2012Runtime} from '../../app/server/src/p2-012-workbench-assembly.mjs';
import {migrateP2012} from '../../app/server/scripts/p2-012-migrate.mjs';
import {migrateIncidentInternalNotes} from '../../app/server/scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../app/server/scripts/incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from '../../app/server/scripts/incident-owner-transfer-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './p2-012-postgres-harness.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {record,text} from './wbint-t27-browser-fixture.mjs';
export {record,text};

type HttpResult={status:number;body:Record<string,unknown>};
type Fixture=Awaited<ReturnType<typeof fixtureP2012>>;
type OwnerTransferRuntimeOptions=P2012RuntimeOptions & IncidentOwnerTransferHostOptions & {flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}};
export interface OwnerTransferHttpContext {
  pool:PostgresPool;f:Fixture;
  origin:string;cookies:ReadonlyArray<Record<string,unknown>>;databaseUrl:string;
  get:(path:string,actor?:number)=>Promise<HttpResult>;
  post:(path:string,body:Record<string,unknown>,actor?:number,headers?:Readonly<Record<string,string>>)=>Promise<HttpResult>;
  confirm:()=>Promise<string>;
  posts:ReadonlyArray<{path:string;body:string}>;
  deferNextTargetRead:(incidentId:string)=>{waitForResponse:()=>Promise<number>;release:()=>void};
  settleProjection:()=>Promise<void>;
}
const closeProbe=(server:Server)=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

/** Real loopback HTTP and isolated synthetic PG, no mocked command.
 * The original032->055->058 setup and genuine first RED are preserved in008.
 * This current successor explicitly applies054 and supplies the default-OFF host flag.
 */
export async function ownerTransferHttp(run:(context:OwnerTransferHttpContext)=>Promise<void>,options:{recovery?:boolean;ownerEnabled?:boolean;ddl?:boolean;ownerDDL?:boolean;notes?:boolean;publication?:boolean}={}){
  let outerError:unknown;
  try{
    await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t29ownerhttp',run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
      await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
      if(options.ddl??true){await migrateIncidentInternalNotes({databaseUrl,mode:'apply'});await migrateIncidentPublicProgress({databaseUrl,mode:'apply'});if(options.ownerDDL??true)await migrateIncidentOwnerTransfer({databaseUrl,mode:'apply'});}
      const f=await fixtureP2012(pool,{reporters:3});
      let probe:Server|undefined,runtime:P2016EnabledRuntime|undefined,primaryError:unknown,releaseTargetRead:(()=>void)|undefined;
      try{
        const portProbe=createServer();probe=portProbe;
        await new Promise<void>((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',()=>{portProbe.removeListener('error',reject);resolve();});});
        const address=portProbe.address();assert.ok(address&&typeof address==='object');
        const port=address.port;await closeProbe(portProbe);probe=undefined;
        const origin='http://127.0.0.1:'+port;
        const hostOptions:OwnerTransferRuntimeOptions={
          pool,principalIds:[text(record(f.admin).id),text(record(f.dispatcher).id),text(record(f.handler).id),text(record(f.outsider).id)],
          publicOrigin:origin,listenPort:port,
          flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},
          incidentTestLabel:true,incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,
          incidentInternalNotesEnabled:options.notes??false,incidentPublicProgressEnabled:options.publication??false,
          incidentOwnerTransferEnabled:options.ownerEnabled??true,workbenchDraftRecoveryEnabled:options.recovery??false,externalSendEnabled:false,
        };
        runtime=createP2012Runtime(hostOptions);
        const started=record(await runtime.start());assert.ok(Array.isArray(started.cookies));
        const cookies=started.cookies.map(record);assert.equal(cookies.length,4);
        const csrf:string[]=[],posts:{path:string;body:string}[]=[];
        const get=async(path:string,actor=0):Promise<HttpResult>=>{
          const cookie=cookies[actor];assert.ok(cookie);
          const response=await fetch(origin+path,{headers:{cookie:text(cookie.name)+'='+text(cookie.value)}});
          return {status:response.status,body:record(await response.json())};
        };
        for(let actor=0;actor<cookies.length;actor++){const response=await get('/api/lifecycle/bootstrap',actor);assert.equal(response.status,200);csrf.push(text(response.body.csrf_token));}
        const post=async(path:string,body:Record<string,unknown>,actor=0,headers:Readonly<Record<string,string>>={}):Promise<HttpResult>=>{
          const cookie=cookies[actor],token=csrf[actor];assert.ok(cookie&&token);
          const serialized=JSON.stringify(body);posts.push({path,body:serialized});
          const response=await fetch(origin+path,{method:'POST',headers:{
            cookie:text(cookie.name)+'='+text(cookie.value),origin,
            'content-type':'application/json','x-csrf-token':token,
            'idempotency-key':String(body.client_command_id),
            'if-match':'"'+String(body.expected_candidate_version??body.expected_row_version)+'"',
            ...headers,
          },body:serialized});
          return {status:response.status,body:record(await response.json())};
        };
        const confirm=async()=>{
          const candidateId=text(record(await f.newCandidate()).id),path='/api/incident-candidates/'+candidateId;
          assert.equal((await post(path+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'})).status,200);
          const current=await get(path);assert.equal(current.status,200);
          const response=await post(path+'/confirm',{client_command_id:randomUUID(),expected_candidate_version:text(current.body.row_version),
            expected_material_basis:text(current.body.material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',
            owner_principal_id:text(record(f.handler).id),owner_team_id:null,
            selected_report_refs:f.reports.map(report=>text(record(report).decisionId)),primary_ticket_id:null});
          assert.equal(response.status,200,JSON.stringify(response.body));return text(response.body.result_ref_id);
        };
        const deferNextTargetRead=(incidentId:string)=>{
          assert.match(incidentId,/^[a-f0-9-]{36}$/u);assert.equal(releaseTargetRead,undefined);
          const server=runtime?.server;assert.ok(server);let end:(()=>void)|undefined;
          let observed:((status:number)=>void)|undefined;
          const responseReady=new Promise<number>(resolve=>{observed=resolve;});
          const listener=(request:IncomingMessage,response:ServerResponse)=>{
            if(request.method!=='GET'||new URL(request.url??'',origin).pathname!=='/api/incidents/'+incidentId+'/owner-transfer-targets')return;
            server.removeListener('request',listener);const send=response.end.bind(response);
            response.end=((...args:Parameters<typeof response.end>)=>{
              end=()=>{if(!response.destroyed)send(...args);};observed?.(response.statusCode);return response;
            }) as typeof response.end;
          };
          server.prependListener('request',listener);
          const release=()=>{server.removeListener('request',listener);end?.();end=undefined;releaseTargetRead=undefined;};
          releaseTargetRead=release;
          return {release,waitForResponse:async()=>{
            let timer:ReturnType<typeof setTimeout>|undefined;
            try{return await Promise.race([responseReady,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('T29_TARGET_RESPONSE_NOT_REACHED')),10_000);})]);}
            finally{clearTimeout(timer);}
          }};
        };
        const settleProjection=async()=>{
          const current=runtime;assert.ok(current);const initial=await current.coordinator.backlog(),bound=Math.ceil(initial.total/current.coordinator.batchSize)+3;
          for(let step=0;step<bound;step++){
            const projected:{disabled:boolean;processed:number;streams:readonly {failures:readonly unknown[]}[]}=await current.coordinator.runOnce();
            assert.equal(projected.disabled,false);assert.ok(projected.streams.every(stream=>stream.failures.length===0));
            if(projected.processed===0&&(await current.coordinator.backlog()).total===0)return;
          }
          assert.fail('T29 finite initial projection did not settle');
        };
        await run({pool,f,get,post,confirm,posts,origin,cookies,databaseUrl,deferNextTargetRead,settleProjection});
      }catch(error){primaryError=error;}
      await closeBrowserTestResources([
        ()=>{releaseTargetRead?.();},
        async()=>{if(probe?.listening)await closeProbe(probe);probe?.removeAllListeners();assert.equal(probe?.listening??false,false);},
        async()=>{await runtime?.stop();},
        ()=>{assert.equal(runtime?.server.listening??false,false);},
      ],primaryError);
    }});
  }catch(error){outerError=error;}
  await closeBrowserTestResources([()=>assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL})],outerError);
}
