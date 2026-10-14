import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {createP2012Runtime} from '../../src/p2-012-workbench-assembly.mjs';
import {migrateIncidentInternalNotes} from '../../scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../scripts/incident-public-progress-migrate.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './p2-012-postgres-harness.mjs';
import {record,text} from './wbint-t27-browser-fixture.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
export {record,text};
export async function t31Http(options:{purpose:string;notes?:boolean;ddl?:boolean;recovery?:boolean;notifications?:boolean;publication?:boolean;reporters?:number},run:(context:{pool:PostgresPool;databaseUrl:string;f:Awaited<ReturnType<typeof fixtureP2012>>;origin:string;runtime:ReturnType<typeof createP2012Runtime>;cookies:Record<string,unknown>[];get:(path:string,actor?:number)=>Promise<{status:number;body:Record<string,unknown>}>;post:(path:string,body:Record<string,unknown>,actor?:number,headers?:Record<string,string>)=>Promise<{status:number;body:Record<string,unknown>}>;confirm:(scope?:string)=>Promise<string>})=>Promise<void>){
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:options.purpose,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    if(options.ddl!==false){await migrateIncidentInternalNotes({databaseUrl,mode:'apply'});await migrateIncidentPublicProgress({databaseUrl,mode:'apply'});}
    const f=await fixtureP2012(pool,{reporters:options.reporters??4}),probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id),text(record(f.dispatcher).id),text(record(f.handler).id),text(record(f.outsider).id)],publicOrigin:origin,listenPort:port,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:options.notifications??false,INCIDENT_PRIVATE_NOTICE_ENABLED:options.notifications??false},incidentTestLabel:true,incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:options.notes??true,incidentPublicProgressEnabled:options.publication??true,workbenchDraftRecoveryEnabled:options.recovery??false,externalSendEnabled:false});
    let primaryError:unknown;
    try{
      const started=record(await runtime.start());assert.ok(Array.isArray(started.cookies));const cookies=started.cookies.map(record),csrf:string[]=[];
      const get=async(path:string,actor=0)=>{const cookie=cookies[actor];assert.ok(cookie);const response=await fetch(origin+path,{headers:{cookie:text(cookie.name)+'='+text(cookie.value)}});return {status:response.status,body:record(await response.json())};};
      for(let actor=0;actor<cookies.length;actor++){const response=await get('/api/lifecycle/bootstrap',actor);assert.equal(response.status,200);csrf.push(text(response.body.csrf_token));}
      const post=async(path:string,body:Record<string,unknown>,actor=0,headers:Record<string,string>={})=>{const cookie=cookies[actor];assert.ok(cookie);const response=await fetch(origin+path,{method:'POST',headers:{cookie:text(cookie.name)+'='+text(cookie.value),origin,'content-type':'application/json','x-csrf-token':csrf[actor]??'','idempotency-key':String(body.client_command_id),'if-match':'"'+String(body.expected_candidate_version??body.expected_row_version)+'"',...headers},body:JSON.stringify(body)});return {status:response.status,body:record(await response.json())};};
      const confirm=async(scope='LOCAL')=>{const candidateId=text(record(await f.newCandidate()).id),path='/api/incident-candidates/'+candidateId;assert.equal((await post(path+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'})).status,200);const current=(await get(path)).body;const response=await post(path+'/confirm',{client_command_id:randomUUID(),expected_candidate_version:text(current.row_version),expected_material_basis:text(current.material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:scope,owner_principal_id:text(record(f.handler).id),owner_team_id:null,selected_report_refs:f.reports.map(report=>text(record(report).decisionId)),primary_ticket_id:null});assert.equal(response.status,200,JSON.stringify(response.body));return text(response.body.result_ref_id);};
      await run({pool,databaseUrl,f,origin,runtime,cookies,get,post,confirm});
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([()=>runtime.stop(),()=>{assert.equal(runtime.server.listening,false);}],primaryError);
  }});await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
}
