import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {createP2012Runtime} from '../../app/server/src/p2-012-workbench-assembly.mjs';
import {migrateP2012} from '../../app/server/scripts/p2-012-migrate.mjs';
import {migrateIncidentInternalNotes} from '../../app/server/scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../app/server/scripts/incident-public-progress-migrate.mjs';
import {fixtureP2012} from './p2-012-postgres-harness.mjs';
import {listenConversationWorkbenchServer} from '../../app/server/src/p2-006-workbench-http.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {createCommunicationDeliveryWorker} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createCommunicationSenderPort} from '../../app/server/src/p2-004-communication-sender-port.mjs';

export function t32Record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function t32Text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
type IncidentFixture=Awaited<ReturnType<typeof fixtureP2012>>;
export interface T32Fixture extends T11Fixture {
  incident:IncidentFixture;
  get:(path:string,actor?:number)=>Promise<{status:number;body:Record<string,unknown>}>;
  post:(path:string,body:Record<string,unknown>,actor?:number)=>Promise<{status:number;body:Record<string,unknown>}>;
  confirm:(scope?:string)=>Promise<string>;
}
/** Real existing Session commands and Delivery outcomes; only the external Sender is synthetic. */
export async function seedT32SessionExceptions(f:T32Fixture,count=2){
  const row=(await f.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[f.tickets[0]?.intake.intakeId])).rows[0];assert.ok(row);
  const path='/api/conversations/'+row.id,current=(await f.get(path)).body;
  assert.equal((await f.post(path+'/takeover',{client_command_id:randomUUID(),expected_row_version:t32Record(current.session).row_version})).status,200);
  let calls=0;const ids:string[]=[];
  const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:createCommunicationSenderPort(()=>{calls++;return {outcome:calls%2?'REJECTED_NOT_APPLIED':'UNKNOWN',provider_message_id:null,error_code:'T32_RAW_PROVIDER_CANARY',retryable:false};})});
  for(let index=0;index<count;index++){
    const detail=(await f.get(path)).body,response=await f.post(path+'/messages',{client_command_id:randomUUID(),expected_row_version:t32Record(detail.session).row_version,message_type:'text',text:'T32_PRIVATE_SESSION_CANARY'});
    assert.equal(response.status,202,JSON.stringify(response.body));assert.ok(Array.isArray(response.body.delivery_ids));const id=t32Text(response.body.delivery_ids[0]);ids.push(id);assert.ok(await worker.deliver({deliveryId:id}));
  }
  assert.equal(calls,count);return {sessionId:row.id,deliveryIds:ids,senderCalls:()=>calls};
}
export async function withT32Fixture(run:(f:T32Fixture)=>Promise<void>,options:{enabled?:boolean;publication?:boolean;ddl?:boolean;externalSend?:boolean}={}) {
  await withWeb01Fixture(async(original:T11Fixture)=>{
    await original.runtime.coordinator.runOnce();await original.runtime.stop();
    await migrateP2012({databaseUrl:original.databaseUrl});
    if(options.ddl!==false){await migrateIncidentInternalNotes({databaseUrl:original.databaseUrl,mode:'apply'});await migrateIncidentPublicProgress({databaseUrl:original.databaseUrl,mode:'apply'});}
    const incident=await fixtureP2012(original.pool,{reporters:4});
    const runtime=createP2012Runtime({pool:original.pool,publicOrigin:original.origin,listenPort:Number(new URL(original.origin).port),
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},principalIds:[original.principals[0]?.id??'',original.principals[1]?.id??'',original.outsider.id,t32Text(t32Record(incident.dispatcher).id)],
      notificationExceptionsEnabled:options.enabled??true,workbenchConversationsEnabled:true,externalSendEnabled:options.externalSend??true,
      incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true},incidentTestLabel:true,incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:options.ddl!==false,incidentPublicProgressEnabled:options.publication??options.ddl!==false});
    let primaryError:unknown;
    try {
      await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(original.origin).port)});
      const browserCookies=runtime.authenticate.browserCookies?.();assert.ok(browserCookies);
      const context={...original,runtime,browserCookies,cookies:browserCookies.map(c=>c.name+'='+c.value)};
      const get=async(path:string,actor=0)=>{const cookie=context.cookies[actor];assert.ok(cookie);const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,body:t32Record(await response.json())};};
      const csrf:string[]=[];for(let index=0;index<context.cookies.length;index++)csrf.push(t32Text((await get('/api/lifecycle/bootstrap',index)).body.csrf_token));
      const post=async(path:string,body:Record<string,unknown>,actor=0)=>{const cookie=context.cookies[actor];assert.ok(cookie);const response=await fetch(context.origin+path,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':csrf[actor]??'','idempotency-key':String(body.client_command_id),'if-match':'"'+String(body.expected_version??body.expected_row_version??body.expected_candidate_version)+'"'},body:JSON.stringify(body)});return {status:response.status,body:t32Record(await response.json())};};
      const confirm=async(scope='LOCAL')=>{const candidateId=t32Text(t32Record(await incident.newCandidate()).id),path='/api/incident-candidates/'+candidateId;
        assert.equal((await post(path+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'},0)).status,200);
        const current=(await get(path,0)).body,response=await post(path+'/confirm',{client_command_id:randomUUID(),expected_candidate_version:t32Text(current.row_version),expected_material_basis:t32Text(current.material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:scope,owner_principal_id:t32Text(t32Record(incident.handler).id),owner_team_id:null,selected_report_refs:incident.reports.map(r=>r.decisionId),primary_ticket_id:null},0);
        assert.equal(response.status,200,JSON.stringify(response.body));return t32Text(response.body.result_ref_id);};
      await run({...context,incident,get,post,confirm});
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([()=>runtime.stop(),()=>assert.equal(runtime.server.listening,false)],primaryError);
  },{manualProjection:true});
}
