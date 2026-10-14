import {migrateIncidentInternalNotes} from '../../scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../scripts/incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from '../../scripts/incident-owner-transfer-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../../scripts/conversation-delivery-commands-migrate.mjs';
import {migrateIncidentDeliveryControl} from '../../scripts/incident-delivery-control-migrate.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {IncidentDeliveryControlPermissionPort} from '../../contracts/workbench_incident_delivery_control_contracts.js';
import {createP2012Runtime} from '../../src/p2-012-workbench-assembly.mjs';
import {createCommunicationDeliveryWorker} from '../../src/p2-004-communication-delivery-worker.mjs';
import {createIncidentPublicProgressAdmission} from '../../src/p2-012-public-progress-admission.mjs';
import {createCommunicationSenderPort} from '../../src/p2-004-communication-sender-port.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './p2-012-postgres-harness.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';

export function t33Record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function t33Text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
interface Response {status:number;body:Record<string,unknown>}
export interface T33WholeOptions {externalSend?:boolean;draftRecovery?:boolean;publicProgress?:boolean}
interface Context {
  restartControl:(enabled:boolean)=>Promise<void>;origin:string;cookies:{name:string;value:string}[];pool:PostgresPool;grants:Set<string>;runtime:ReturnType<typeof createP2012Runtime>;dispatcherId:string;handlerId:string;outsiderId:string;secondIncident:()=>Promise<string>;getLifecycleRows:()=>Promise<Record<string,unknown>[]>;setSenderOutcome:(value:'UNKNOWN'|'REJECTED_NOT_APPLIED'|'ACKNOWLEDGED')=>void;
  incidentId:string;adminId:string;senderCalls:()=>number;
  get:(path:string,actor?:number)=>Promise<Response>;
  post:(path:string,body:Record<string,unknown>,actor?:number)=>Promise<Response>;
  deliver:(deliveryId:string)=>Promise<unknown>;
}

/** Future real isolated PG/Cookie HTTP fixture. No T31 publication/profile prerequisites. */
export async function t33WholeHttp(run:(context:Context)=>Promise<void>,options:T33WholeOptions={}):Promise<void>{
  let outerError:unknown;
  try{await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t33whole',max:2,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    // Explicit T33 test-only prerequisite; old 6679B fixture remains frozen in evidence.
    await migrateIncidentInternalNotes({databaseUrl,mode:'apply'});
    await migrateIncidentPublicProgress({databaseUrl,mode:'apply'});
    await migrateIncidentOwnerTransfer({databaseUrl,mode:'apply'});
    await migrateIncidentDeliveryControl({databaseUrl,mode:'apply'});await migrateConversationDeliveryCommands({databaseUrl,mode:'apply'});
    const f=await fixtureP2012(pool,{reporters:4});
    const adminId=t33Text(t33Record(f.admin).id),dispatcherId=t33Text(t33Record(f.dispatcher).id),handlerId=t33Text(t33Record(f.handler).id),outsiderId=t33Text(t33Record(f.outsider).id);
    const grants=new Set<string>();
    const permissions:IncidentDeliveryControlPermissionPort={hasPermission:async({principal_id,incident_id,permission})=>grants.has(principal_id+'|'+incident_id+'|'+permission)};
    const probe=createServer();let port=0,probeError:unknown;
    try{await new Promise<void>((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const address=probe.address();assert.ok(address&&typeof address==='object');port=address.port;}catch(error){probeError=error;}
    await closeBrowserTestResources([()=>new Promise<void>((resolve,reject)=>{if(!probe.listening){resolve();return;}probe.close(error=>error?reject(error):resolve());})],probeError);
    const origin='http://127.0.0.1:'+port;let sends=0,outcome:'UNKNOWN'|'REJECTED_NOT_APPLIED'|'ACKNOWLEDGED'='UNKNOWN';
    const sender=createCommunicationSenderPort(async()=>{sends++;return {outcome,provider_message_id:null,error_code:outcome==='ACKNOWLEDGED'?null:'SYNTHETIC_T33_'+outcome,retryable:false};});
    // One manually invoked original Worker; no server-side automatic send interval.
    const worker=createCommunicationDeliveryWorker({pool,sender,enabled:true,batchSize:1,attemptAdmission:createIncidentPublicProgressAdmission({enabled:options.publicProgress===true})});
    const makeRuntime=(control:boolean)=>createP2012Runtime({pool,principalIds:[adminId,dispatcherId,handlerId,outsiderId],listenPort:port,publicOrigin:origin,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true},
      incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:false,incidentPublicProgressEnabled:options.publicProgress===true,incidentOwnerTransferEnabled:false,
      incidentDeliveryControlEnabled:control,incidentDeliveryControlPermissions:permissions,incidentTestLabel:true,incidentBackgroundMaintenance:false,externalSendEnabled:options.externalSend===true,workbenchDraftRecoveryEnabled:options.draftRecovery===true,notificationExceptionsEnabled:true,workbenchRealtimeEnabled:true});let runtime=makeRuntime(true);
    let primary:unknown;
    try{
      const start=t33Record(await runtime.start());assert.ok(Array.isArray(start.cookies));const cookies=start.cookies.map(t33Record),csrf:string[]=[];
      const get=async(path:string,actor=0):Promise<Response>=>{const cookie=cookies[actor];assert.ok(cookie);const response=await fetch(origin+path,{headers:{cookie:t33Text(cookie.name)+'='+t33Text(cookie.value),connection:'close'}});return {status:response.status,body:t33Record(await response.json())};};
      for(let i=0;i<cookies.length;i++){const bootstrap=await get('/api/lifecycle/bootstrap',i);assert.equal(bootstrap.status,200);csrf.push(t33Text(bootstrap.body.csrf_token));}
      const post=async(path:string,body:Record<string,unknown>,actor=0):Promise<Response>=>{const cookie=cookies[actor];assert.ok(cookie);const version=body.expected_candidate_version??body.expected_row_version;const response=await fetch(origin+path,{method:'POST',headers:{cookie:t33Text(cookie.name)+'='+t33Text(cookie.value),connection:'close',origin,'content-type':'application/json','x-csrf-token':csrf[actor]??'','idempotency-key':t33Text(body.client_command_id),'if-match':'"'+String(version)+'"'},body:JSON.stringify(body)});return {status:response.status,body:t33Record(await response.json())};};
      const candidate=t33Text(t33Record(await f.newCandidate()).id),candidatePath='/api/incident-candidates/'+candidate;
      assert.equal((await post(candidatePath+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'})).status,200);
      const current=await get(candidatePath);assert.equal(current.status,200);
      const confirmed=await post(candidatePath+'/confirm',{client_command_id:randomUUID(),expected_candidate_version:t33Text(current.body.row_version),expected_material_basis:t33Text(current.body.material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:handlerId,owner_team_id:null,selected_report_refs:f.reports.map((report:unknown)=>t33Text(t33Record(report).decisionId)),primary_ticket_id:null});
      assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));const incidentId=t33Text(confirmed.body.result_ref_id);
      // Explicit independent server-side test grants; neither role nor body is a grant.
      grants.add(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RETRY');grants.add(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE');
            const getLifecycleRows=async()=>{const response=await get('/api/incidents/'+incidentId+'/notifications?limit=10');assert.equal(response.status,200);assert.ok(Array.isArray(response.body.items));return response.body.items.map(t33Record);};
      const secondIncident=async()=>{
        const other=await fixtureP2012(pool,{reporters:2}),review=t33Text(t33Record(await other.newCandidate()).id),path='/api/incident-candidates/'+review;
        assert.equal((await post(path+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'})).status,200);
        const detail=await get(path);assert.equal(detail.status,200);
        const confirmed=await post(path+'/confirm',{client_command_id:randomUUID(),expected_candidate_version:t33Text(detail.body.row_version),expected_material_basis:t33Text(detail.body.material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:handlerId,owner_team_id:null,selected_report_refs:other.reports.map((r:unknown)=>t33Text(t33Record(r).decisionId)),primary_ticket_id:null});
        assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));const id=t33Text(confirmed.body.result_ref_id);
        grants.add(adminId+'|'+id+'|INCIDENT_DELIVERY_RETRY');grants.add(adminId+'|'+id+'|INCIDENT_DELIVERY_RECONCILE');return id;
      };
      const restartControl=async(enabled:boolean)=>{await runtime.stop();assert.equal(runtime.server.listening,false);runtime=makeRuntime(enabled);const started=t33Record(await runtime.start());assert.ok(Array.isArray(started.cookies));cookies.splice(0,cookies.length,...started.cookies.map(t33Record));csrf.length=0;for(let i=0;i<cookies.length;i++){const bootstrap=await get('/api/lifecycle/bootstrap',i);assert.equal(bootstrap.status,200);csrf.push(t33Text(bootstrap.body.csrf_token));}};
      await run({restartControl,origin,cookies:cookies.map(cookie=>({name:t33Text(cookie.name),value:t33Text(cookie.value)})),pool,grants,runtime,incidentId,adminId,dispatcherId,handlerId,outsiderId,secondIncident,getLifecycleRows,setSenderOutcome:value=>{outcome=value;},senderCalls:()=>sends,get,post,deliver:deliveryId=>worker.deliver({deliveryId})});
    }catch(error){primary=error;}
    await closeBrowserTestResources([()=>runtime.stop(),()=>{assert.equal(runtime.server.listening,false);}],primary);
  }});}catch(error){outerError=error;}
  await closeBrowserTestResources([()=>assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL})],outerError);
}
