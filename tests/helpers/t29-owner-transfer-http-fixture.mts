import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {Server} from 'node:net';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {P2012RuntimeOptions} from '../../src/p2-012-workbench-assembly.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import type {IncidentOwnerTransferHostOptions} from '../../contracts/workbench_incident_owner_transfer_contracts.js';
import {createP2012Runtime} from '../../src/p2-012-workbench-assembly.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {migrateIncidentInternalNotes} from '../../scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../scripts/incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from '../../scripts/incident-owner-transfer-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './p2-012-postgres-harness.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {record,text} from './wbint-t27-browser-fixture.mjs';
export {record,text};

type HttpResult={status:number;body:Record<string,unknown>};
type Fixture=Awaited<ReturnType<typeof fixtureP2012>>;
type FutureHostOptions=P2012RuntimeOptions & IncidentOwnerTransferHostOptions & {flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}};
export interface OwnerTransferHttpContext {
  pool:PostgresPool;f:Fixture;
  get:(path:string,actor?:number)=>Promise<HttpResult>;
  post:(path:string,body:Record<string,unknown>,actor?:number)=>Promise<HttpResult>;
  confirm:()=>Promise<string>;
  posts:ReadonlyArray<{path:string;body:string}>;
}
const closeProbe=(server:Server)=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

/** SOURCE / NOT_RUN. Real loopback HTTP, no browser or mocked command.
 * Existing032->055->058 is the current setup. After genuine future first RED,
 * a real054 migrator belongs in this own fixture's separately preserved successor.
 * The future flag is declared input, currently unimplemented; no missing-module catch.
 */
export async function ownerTransferHttp(run:(context:OwnerTransferHttpContext)=>Promise<void>){
  let outerError:unknown;
  try{
    await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t29ownerhttp',run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
      await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
      await migrateIncidentInternalNotes({databaseUrl,mode:'apply'});
      await migrateIncidentPublicProgress({databaseUrl,mode:'apply'});
      await migrateIncidentOwnerTransfer({databaseUrl,mode:'apply'});
      const f=await fixtureP2012(pool,{reporters:3});
      let probe:Server|undefined,runtime:P2016EnabledRuntime|undefined,primaryError:unknown;
      try{
        const portProbe=createServer();probe=portProbe;
        await new Promise<void>((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',()=>{portProbe.removeListener('error',reject);resolve();});});
        const address=portProbe.address();assert.ok(address&&typeof address==='object');
        const port=address.port;await closeProbe(portProbe);probe=undefined;
        const origin='http://127.0.0.1:'+port;
        const options:FutureHostOptions={
          pool,principalIds:[text(record(f.admin).id),text(record(f.dispatcher).id),text(record(f.handler).id),text(record(f.outsider).id)],
          publicOrigin:origin,listenPort:port,
          flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},
          incidentTestLabel:true,incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,
          incidentInternalNotesEnabled:false,incidentPublicProgressEnabled:false,
          incidentOwnerTransferEnabled:true,externalSendEnabled:false,
        };
        runtime=createP2012Runtime(options);
        const started=record(await runtime.start());assert.ok(Array.isArray(started.cookies));
        const cookies=started.cookies.map(record);assert.equal(cookies.length,4);
        const csrf:string[]=[],posts:{path:string;body:string}[]=[];
        const get=async(path:string,actor=0):Promise<HttpResult>=>{
          const cookie=cookies[actor];assert.ok(cookie);
          const response=await fetch(origin+path,{headers:{cookie:text(cookie.name)+'='+text(cookie.value)}});
          return {status:response.status,body:record(await response.json())};
        };
        for(let actor=0;actor<cookies.length;actor++){const response=await get('/api/lifecycle/bootstrap',actor);assert.equal(response.status,200);csrf.push(text(response.body.csrf_token));}
        const post=async(path:string,body:Record<string,unknown>,actor=0):Promise<HttpResult>=>{
          const cookie=cookies[actor],token=csrf[actor];assert.ok(cookie&&token);
          const serialized=JSON.stringify(body);posts.push({path,body:serialized});
          const response=await fetch(origin+path,{method:'POST',headers:{
            cookie:text(cookie.name)+'='+text(cookie.value),origin,
            'content-type':'application/json','x-csrf-token':token,
            'idempotency-key':String(body.client_command_id),
            'if-match':'"'+String(body.expected_candidate_version??body.expected_row_version)+'"',
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
        await run({pool,f,get,post,confirm,posts});
      }catch(error){primaryError=error;}
      await closeBrowserTestResources([
        async()=>{if(probe?.listening)await closeProbe(probe);probe?.removeAllListeners();assert.equal(probe?.listening??false,false);},
        async()=>{await runtime?.stop();},
        ()=>{assert.equal(runtime?.server.listening??false,false);},
      ],primaryError);
    }});
  }catch(error){outerError=error;}
  await closeBrowserTestResources([()=>assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL})],outerError);
}
