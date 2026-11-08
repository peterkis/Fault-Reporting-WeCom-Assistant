import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {appendCommunication} from '../../app/server/src/p2-004-communication-core.mjs';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';
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
import {attachInboxJourney} from './conversation-inbox-fixture.mjs';
import {MockResolvedDirectory} from '../../app/server/src/p2-015-contact-journey.mjs';
import {snapshotReporterProfile} from '../../app/server/src/p2-015-reporter-profile.mjs';
import {ensureCompletionDismissal} from './completion-dismissal.mjs';

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
/** N3 uses the same retained, identity-bound profile fixture as the inbox. */
export async function seedN3SessionProfile(f:T32Fixture,sessionId:string,name='欧阳慧敏（合成）'){
  const row=(await f.pool.query<{id:string;intake_id:string;thread_id:string;reporter:string;bot:string;source_group:string|null;chat_type:'group'|'single'}>(`SELECT s.id::text,s.service_intake_id::text AS intake_id,s.thread_id::text,s.participant_key AS reporter,
    th.channel_account_id AS bot,i.source_chat_id AS source_group,th.chat_type FROM conversation.session s
    JOIN conversation.thread th ON th.id=s.thread_id JOIN intake.service_intake i ON i.id=s.service_intake_id WHERE s.id=$1::uuid`,[sessionId])).rows[0];assert.ok(row);
  const existing=(await f.pool.query<{id:string}>('SELECT journey_id::text AS id FROM intake.channel_leg WHERE source_intake_id=$1::uuid',[row.intake_id])).rows[0];
  if(existing){
    const resolved=await MockResolvedDirectory({contact:{name},memberships:[{department_ref:'n3-synthetic-department',name:'心血管内科第二病区护士站（合成）'}]}).resolve({});assert.equal(resolved.status,'RESOLVED');
    await f.pool.query("UPDATE intake.contact_journey SET profile_resolution_status='RESOLVED',profile_snapshot=$2::jsonb WHERE id=$1::uuid",[existing.id,JSON.stringify(snapshotReporterProfile(resolved.snapshot))]);return existing.id;
  }
  return attachInboxJourney(f.pool,{id:row.id,intakeId:row.intake_id,threadId:row.thread_id,reporter:row.reporter,bot:row.bot,group:row.source_group,chatType:row.chat_type,ticketId:'',rowVersion:1},{name,department:'心血管内科第二病区护士站（合成）'});
}
/** N2/S11: six real queue rows, with synthetic providers and the existing append/binding path. */
export async function seedCard21Exceptions(f:T32Fixture){
  const session=await seedT32SessionExceptions(f,2),deliveryIds=[...session.deliveryIds];let calls=0;
  for(let index=0;index<4;index++){
    const ticket=f.tickets[index];assert.ok(ticket);
    const title='护士站打印与业务系统连接异常，需要核对网络和终端配置（合成）'+(index+1);
    await f.pool.query('UPDATE pilot_ticket.ticket SET title=$2 WHERE id=$1::uuid',[ticket.ticket.id,title]);
    const event=(await f.pool.query<{id:string}>('SELECT event_id::text AS id FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY created_at,event_id LIMIT 1',[ticket.ticket.id])).rows[0];assert.ok(event);
    const group=index===2,targetType=group?'GROUP':'PERSON',provider=index<2?'WECOM_APP':'WECOM_AIBOT';
    const expiry=(await f.pool.query<{at:string}>("SELECT platform.local_now()+interval '30 days' AS at")).rows[0];assert.ok(expiry);
    const result=await transactionP2016(f.pool,async tx=>{
      const message=await appendCommunication({transaction:tx,actor:null,command:{client_command_id:randomUUID(),session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',message_type:'text',visibility:'EXTERNAL',text:'配置检查进展通知（合成）',privacy_class:'INTERNAL',retention_until:expiry.at},resolvedDestinations:[{provider,channel_account_id:'v212-synthetic-account',target_type:targetType,target_id:'v212-synthetic-target-'+index}]});
      assert.ok(message&&'message_id' in message&&message.outbox_id&&message.delivery_ids[0]);
      await tx.query(`INSERT INTO communication.ticket_notification_binding(ticket_event_id,ticket_id,notification_type,recipient_binding_hash,destination_type,template_version,message_id,outbox_id,delivery_id)
        VALUES($1::uuid,$2::uuid,'TICKET_CREATED',$3,$4,'V212_SYNTHETIC',$5::uuid,$6::uuid,$7::uuid)`,[event.id,ticket.ticket.id,createHash('sha256').update('v212-synthetic-'+index).digest('hex'),targetType,message.message_id,message.outbox_id,message.delivery_ids[0]]);
      return message;
    });
    const id=result.delivery_ids[0];assert.ok(id);deliveryIds.push(id);
    const attempts=index%3+1;let attempt=0;
    const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:createCommunicationSenderPort(()=>{attempt++;calls++;return {outcome:attempt===attempts&&index%2?'UNKNOWN':'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'V212_SYNTHETIC_FAILURE',retryable:attempt<attempts};})});
    for(let n=0;n<attempts;n++){
      if(n)await f.pool.query('WITH stamp AS(SELECT platform.physical_epoch_ms()-1000 AS epoch) UPDATE communication.delivery SET next_attempt_epoch_ms=epoch,next_attempt_at=platform.local_from_epoch_ms(epoch) FROM stamp WHERE id=$1::uuid',[id]);
      assert.ok(await worker.deliver({deliveryId:id}));
    }
  }
  return {deliveryIds,sessionId:session.sessionId,senderCalls:()=>session.senderCalls()+calls};
}
export async function withT32Fixture(run:(f:T32Fixture)=>Promise<void>,options:{enabled?:boolean;publication?:boolean;ddl?:boolean;externalSend?:boolean}={}) {
  await withWeb01Fixture(async(original:T11Fixture)=>{
    await original.runtime.coordinator.runOnce();await original.runtime.stop();
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
  },{manualProjection:true,beforeClosureMigration:async({databaseUrl}:{databaseUrl:string})=>{
    await migrateP2012({databaseUrl});
    if(options.ddl!==false){await migrateIncidentInternalNotes({databaseUrl,mode:'apply'});await migrateIncidentPublicProgress({databaseUrl,mode:'apply'});}await ensureCompletionDismissal(databaseUrl);
  }});
}
