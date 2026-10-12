// Only real public HTTP/Core/ContactJourneyPort setup; no test-owned success or fabricated Ticket/Session facts.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {object,rows,text,version} from './t09-fixture.mjs';
import type {T09Fixture,T09Http} from './t09-fixture.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {createContactJourneyStore} from '../../src/p2-015-contact-journey.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../../src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../../src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../../src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../../src/p2-015-decision-store.mjs';
import {createServiceIntakeDecisionPort} from '../../src/p2-015-service-intake-decision-port.mjs';
type Selected={session_id:string;expected_row_version:number};
async function get(http:T09Http,path:string){const result=await http.get(path);assert.equal(result.status,200,path+' '+JSON.stringify(result.value));return result.value;}
async function post(http:T09Http,path:string,body:Record<string,unknown>){const result=await http.post(path,body);assert.equal(result.status,200,path+' '+JSON.stringify(result.value));return result.value;}
async function drain(fixture:T09Fixture){const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
 for(let n=0;n<bound;n++){const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;}assert.fail('T09 finite projection did not settle');}
export async function readT09SelectedFacts(admin:T09Http,path:string,selected:readonly Selected[]){const sessions=[];for(const row of selected){const view=await get(admin,'/api/conversations/'+row.session_id);sessions.push({session:view.session,assignment:view.assignment,handoff:view.handoff});}
 return {ticket:await get(admin,path),responsibility:await get(admin,path+'/responsibility'),events:await get(admin,path+'/events?limit=200'),deliveries:await get(admin,path+'/deliveries'),sessions};}
export async function prepareT09Selected(fixture:T09Fixture){
 const admin=await fixture.http(0),handler=await fixture.http(2),target=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
 const assigned=await post(admin,path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});await drain(fixture);
 const initial=await get(admin,path),core=createPilotTicketCore({pool:fixture.pool});
 // Same existing origin Port arrangement as T08's real multi-Session fixture. No direct SQL relation/state writes.
 const orchestrator=createRuleFirstOrchestrator({pool:fixture.pool,identityHmacKey:'t09-ui-only-synthetic-origin-key',decisionStore:createDecisionStore(),safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),ruleEngine:{catalog_version:'T09_UI_FIXTURE',rule_set_version:'T09_UI_FIXTURE',evaluate(){throw Error('synthetic origin requests human review');}}});
 const origin=object(await orchestrator.processPersistedIntake({service_intake_id:text(initial.intake_id),feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}}));assert.equal(origin.ok,true);assert.equal(origin.model_provider_calls,0);assert.equal(origin.sender_calls,0);await drain(fixture);
 const originalRows=rows((await get(admin,path+'/responsibility')).conversations);assert.equal(originalRows.length,1);const source=originalRows[0];assert.ok(source);
 await post(handler,'/api/conversations/'+text(source.session_id)+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(text(source.session_row_version))),reason_code:'T09_UI_ORIGINAL_COMMUNICATOR'});
 // Project this earlier real Control before subsequent Ticket facts move the same timeline tail.
 await drain(fixture);
 for(const[actionName,reasonCode]of[['accept','T09_UI_ACCEPT'],['start','T09_UI_START'],['wait-vendor','T09_UI_WAIT']]as const)await post(handler,path+'/'+actionName,{client_command_id:randomUUID(),expected_version:version((await get(handler,path)).version),reason_code:reasonCode});
 const leg=(await fixture.pool.query<{journey_id:string;reporter_identity_hash:string;provider_context_hash:string;channel_identity_hash:string}>(`SELECT l.journey_id::text,l.reporter_identity_hash,l.provider_context_hash,l.channel_identity_hash FROM intake.channel_leg l JOIN pilot_ticket.ticket t ON t.source_intake_id=l.source_intake_id WHERE t.id=$1::uuid`,[ticketId])).rows[0];assert.ok(leg);
 const selected:Selected[]=[];
 for(let n=0;n<2;n++){const intake=object(await seedPersistedIntake({pool:fixture.pool,text:'T09 UI synthetic continuation '+n+' '+randomUUID(),requestType:'INCIDENT',status:'RECEIVED'}));await drain(fixture);
  const session=(await fixture.pool.query<{id:string;thread_id:string;row_version:string}>('SELECT id::text,thread_id::text,row_version::text FROM conversation.session WHERE service_intake_id=$1::uuid',[intake.intakeId])).rows[0];assert.ok(session);
  await createContactJourneyStore().ensureLeg({transaction:fixture.pool,input:{journey_id:leg.journey_id,leg_type:'GROUP_CONTINUATION',source_intake_id:text(intake.intakeId),conversation_thread_id:session.thread_id,conversation_session_id:session.id,origin_channel_message_id:text(intake.messageId),provider_context_hash:leg.provider_context_hash,channel_identity_hash:leg.channel_identity_hash,reporter_identity_hash:leg.reporter_identity_hash,opened_at:text(intake.receivedAt)}});
  // ADMIN can lawfully see and take unassigned continuation Sessions. Ordinary HANDLER access is not assumed.
  await post(admin,'/api/conversations/'+session.id+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(session.row_version)),reason_code:'T09_UI_EXPLICIT_CURRENT_COMMUNICATOR'});
  const current=await get(admin,'/api/conversations/'+session.id);assert.equal(object(current.assignment).assigned_to_me,true);selected.push({session_id:session.id,expected_row_version:version(object(current.session).row_version)});
 }
 selected.sort((a,b)=>a.session_id.localeCompare(b.session_id));const related=rows((await get(admin,path+'/related-conversations')).items);assert.equal(related.length,3);
 const targetBootstrap=await get(target,'/api/lifecycle/bootstrap');assert.equal(targetBootstrap.principal_id,fixture.dispatcher);assert.ok(Array.isArray(targetBootstrap.roles)&&targetBootstrap.roles.includes('DISPATCHER'));
 for(const row of selected){const current=related.find(item=>item.session_id===row.session_id);assert.ok(current);assert.equal(current.take_allowed,true);assert.equal(Number(current.session_row_version),row.expected_row_version);const eligible=rows((await get(admin,'/api/conversations/'+row.session_id+'/eligible-principals')).items).find(item=>item.principal_id===fixture.dispatcher);assert.ok(eligible&&Array.isArray(eligible.actions)&&eligible.actions.includes('TRANSFER_TARGET'));assert.equal(object((await get(target,'/api/conversations/'+row.session_id)).session).session_id,row.session_id);}
 const before=await readT09SelectedFacts(admin,path,selected);assert.equal(before.ticket.status,'WAITING_VENDOR');assert.equal(before.ticket.assignee_id,fixture.handler);assert.equal(before.ticket.resolver_team_id,'PILOT_IT');assert.equal(object(before.ticket.handling_cycle).cycle_no,1);assert.equal(object(before.ticket.handling_cycle).first_responsibility_event_id,assigned.ticket_event_id);assert.equal(rows(before.deliveries.items).filter(row=>row.notification_type==='TICKET_ACCEPTED').length,1);
 const primary=rows(before.responsibility.conversations).find(row=>row.session_id===source.session_id);assert.ok(primary);assert.equal(primary.conversation_principal_id,fixture.handler);
 return {admin,path,ticketId,selected,related,before,primary,target:fixture.dispatcher,ownerName:text(before.responsibility.ticket_assignee_name)};
}

