// STAGED_RUNTIME / first actual authority, resource or schema boundary execution pending.
// Intended location: tests/t37-communicator-resource-bound.integration.test.mts.
// One real-PG case at 3 then 21 canonical Sessions. Only existing fixture pool connections are used.
// First intended product RED: lock:true unnecessarily locks an unselected canonical Session.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createContactJourneyStore} from '../app/server/src/p2-015-contact-journey.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../app/server/src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../app/server/src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../app/server/src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../app/server/src/p2-015-decision-store.mjs';
import {createServiceIntakeDecisionPort} from '../app/server/src/p2-015-service-intake-decision-port.mjs';
import type {PostgresPoolClient,PostgresQueryRow,PostgresTransaction} from '../app/server/src/platform/postgres-pool.mjs';

interface OriginLeg {journey_id:string;reporter_identity_hash:string;provider_context_hash:string;channel_identity_hash:string}
interface SessionRow {id:string;thread_id:string;row_version:string;status:string;service_intake_id:string}
type LockResult='ACQUIRED'|'LOCK_NOT_AVAILABLE';
interface Observation {canonical_count:number;lock:boolean;authorized:boolean;statement_count:number;canonical_result_sizes:number[];selected_session:LockResult;selected_assignment:LockResult;unselected_session:LockResult;unselected_assignment:LockResult}
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function drain(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('T37_RESOURCE_NATIVE_PROJECTION_DID_NOT_SETTLE');
}
async function sessionForIntake(fixture:T37Fixture,intakeId:string):Promise<SessionRow>{
  const result=await fixture.pool.query<SessionRow>('SELECT id::text,thread_id::text,row_version::text,status,service_intake_id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[intakeId]);
  assert.equal(result.rows.length,1);const session=result.rows[0];assert.ok(session);assert.equal(session.status,'OPEN');return session;
}
async function control(dispatcher:T37Http,sessionId:string,targetPrincipal:string,action:'takeover'|'transfer'){
  const path='/api/conversations/'+sessionId,before=await current(dispatcher,path),result=await dispatcher.post(path+'/'+action,{client_command_id:randomUUID(),expected_row_version:version(object(before.session).row_version),target_principal_id:targetPrincipal,reason_code:'T37_RESOURCE_REAL_OWNER'});
  assert.equal(result.status,200,JSON.stringify(result.value));
}
async function originJourney(fixture:T37Fixture,ticket:Record<string,unknown>):Promise<OriginLeg>{
  const core=createPilotTicketCore({pool:fixture.pool}),orchestrator=createRuleFirstOrchestrator({pool:fixture.pool,identityHmacKey:'t37-resource-synthetic-origin-key',decisionStore:createDecisionStore(),
    safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),
    ruleEngine:{catalog_version:'T37_RESOURCE_FIXTURE',rule_set_version:'T37_RESOURCE_FIXTURE',evaluate(){throw Error('synthetic origin requests human review');}}});
  const prepared=object(await orchestrator.processPersistedIntake({service_intake_id:text(ticket.intake_id),feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}}));
  assert.equal(prepared.ok,true);assert.equal(prepared.model_provider_calls,0);assert.equal(prepared.sender_calls,0);await drain(fixture);
  const leg=(await fixture.pool.query<OriginLeg>(`SELECT l.journey_id::text,l.reporter_identity_hash,l.provider_context_hash,l.channel_identity_hash
    FROM intake.channel_leg l JOIN pilot_ticket.ticket t ON t.source_intake_id=l.source_intake_id WHERE t.id=$1::uuid`,[ticket.id])).rows[0];assert.ok(leg);return leg;
}
async function extendCanonical(fixture:T37Fixture,dispatcher:T37Http,origin:OriginLeg,amount:number):Promise<SessionRow[]>{
  const inputs:Record<string,unknown>[]=[];
  for(let index=0;index<amount;index++)inputs.push(object(await seedPersistedIntake({pool:fixture.pool,text:'T37 bounded actual group continuation '+randomUUID(),chatType:'group',requestType:'INCIDENT',status:'RECEIVED'})));
  await drain(fixture);const sessions:SessionRow[]=[];
  for(const input of inputs){
    const session=await sessionForIntake(fixture,text(input.intakeId));
    await createContactJourneyStore().ensureLeg({transaction:fixture.pool,input:{journey_id:origin.journey_id,leg_type:'GROUP_CONTINUATION',source_intake_id:text(input.intakeId),conversation_thread_id:session.thread_id,conversation_session_id:session.id,
      origin_channel_message_id:text(input.messageId),provider_context_hash:origin.provider_context_hash,channel_identity_hash:origin.channel_identity_hash,reporter_identity_hash:origin.reporter_identity_hash,opened_at:text(input.receivedAt)}});
    await control(dispatcher,session.id,fixture.otherHandler,'takeover');sessions.push(session);
  }
  return sessions;
}
async function canonicalIds(dispatcher:T37Http,ticketPath:string):Promise<string[]>{
  const found:string[]=[];let cursor:string|null=null;
  for(let page=0;page<2;page++){
    const result=await current(dispatcher,ticketPath+'/related-conversations?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    found.push(...rows(result.items).map(row=>text(row.session_id)));
    if(result.next_cursor===null)return found.sort();cursor=text(result.next_cursor);
  }
  assert.fail('T37_RESOURCE_CANONICAL_FIXTURE_EXCEEDED_21');
}
function lockUnavailable(error:unknown):boolean{return Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='55P03');}
async function probeRow(client:PostgresPoolClient,kind:'session'|'assignment',sessionId:string):Promise<LockResult>{
  // Every probe uses a savepoint because PostgreSQL aborts the subtransaction on NOWAIT refusal.
  // ROLLBACK TO also releases a successfully obtained probe lock before the next observation.
  await client.query('SAVEPOINT t37_resource_probe');
  try{
    const result=kind==='session'
      ?await client.query('SELECT id::text FROM conversation.session WHERE id=$1::uuid FOR UPDATE NOWAIT',[sessionId])
      :await client.query('SELECT session_id::text FROM conversation.assignment WHERE session_id=$1::uuid FOR UPDATE NOWAIT',[sessionId]);
    assert.equal(result.rowCount,1,'a missing row is not evidence of an unlocked existing resource');return 'ACQUIRED';
  }catch(error){if(lockUnavailable(error))return 'LOCK_NOT_AVAILABLE';throw error;}
  finally{await client.query('ROLLBACK TO SAVEPOINT t37_resource_probe');await client.query('RELEASE SAVEPOINT t37_resource_probe');}
}
async function observe(fixture:T37Fixture,ticketId:string,ids:readonly string[],selected:string,unselected:string,lock:boolean):Promise<Observation>{
  let authorizer:PostgresPoolClient|undefined,contender:PostgresPoolClient|undefined,primary:unknown,observation:Observation|undefined;
  try{
    authorizer=await fixture.pool.connect();contender=await fixture.pool.connect();
    await authorizer.query('BEGIN');await contender.query('BEGIN');
    const connection=authorizer,canonical=new Set(ids),sizes:number[]=[];let calls=0;
    // Transparent delegation. No SQL text matching, fake result, role-row limit or production hook.
    const transaction:PostgresTransaction={async query<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[]){
      const result=await connection.query<R>(sql,values);calls++;
      // Only result sets whose rows identify existing canonical Sessions contribute to the row bound.
      // Principal/role and Ticket result sets have no session_id and are deliberately excluded.
      if(result.rows.length>0&&result.rows.every(row=>typeof row.session_id==='string'&&canonical.has(row.session_id)))sizes.push(result.rows.length);
      return result;
    }};
    const authorized=await fixture.runtime.query.isCurrentCommunicator({authContext:{principal_id:fixture.handler},ticketId,transaction,lock});
    observation={canonical_count:ids.length,lock,authorized,statement_count:calls,canonical_result_sizes:sizes,
      selected_session:await probeRow(contender,'session',selected),selected_assignment:await probeRow(contender,'assignment',selected),
      unselected_session:await probeRow(contender,'session',unselected),unselected_assignment:await probeRow(contender,'assignment',unselected)};
  }catch(error){primary=error;}
  finally{
    const cleanup:unknown[]=[];
    for(const client of [contender,authorizer])if(client){
      try{await client.query('ROLLBACK');}catch(error){cleanup.push(error);}
      finally{try{client.release();}catch(error){cleanup.push(error);}}
    }
    if(cleanup.length)primary=new AggregateError(primary===undefined?cleanup:[primary,...cleanup],'T37_RESOURCE_TRANSACTION_CLEANUP_FAILED');
  }
  if(primary!==undefined)throw primary;assert.ok(observation);return observation;
}

test('communicator authority at 3 and 21 real canonical Sessions locks only its selected current assignment and performs constant bounded reads',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),communicator=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,queued=await current(dispatcher,path);
    const assignment=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.otherHandler,
      resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assignment.status,200,JSON.stringify(assignment.value));await drain(fixture);
    const ticket=await current(dispatcher,path),origin=await originJourney(fixture,ticket),first=await sessionForIntake(fixture,text(ticket.intake_id));
    await control(dispatcher,first.id,fixture.otherHandler,'takeover');const sessions=[first],observations:Observation[]=[];let previouslySelected:string|null=null;
    for(const size of [3,21]){
      sessions.push(...await extendCanonical(fixture,dispatcher,origin,size-sessions.length));
      const ids=sessions.map(session=>session.id).sort(),selected=ids.at(-1),unselected=ids[0];assert.ok(selected&&unselected);assert.notEqual(selected,unselected);
      assert.deepEqual(await canonicalIds(dispatcher,path),ids,'all 3/21 candidates must be actual publicly related Sessions');
      if(previouslySelected!==selected){
        if(previouslySelected)await control(dispatcher,previouslySelected,fixture.otherHandler,'transfer');
        await control(dispatcher,selected,fixture.handler,'transfer');previouslySelected=selected;
      }
      const actual=(await fixture.pool.query<{session_id:string;status:string;assignment_status:string;assigned_principal_id:string}>(`SELECT s.id::text AS session_id,s.status,a.assignment_status,a.assigned_principal_id::text
        FROM conversation.session s JOIN conversation.assignment a ON a.session_id=s.id WHERE s.id=ANY($1::uuid[]) ORDER BY s.id`,[ids])).rows;
      assert.equal(actual.length,size);assert.ok(actual.every(row=>row.status==='OPEN'&&row.assignment_status==='ASSIGNED'));
      assert.deepEqual(actual.filter(row=>row.assigned_principal_id===fixture.handler).map(row=>row.session_id),[selected]);
      assert.equal(actual.at(-1)?.session_id,selected,'the only owned canonical Session must be last in actual UUID order');
      assert.equal((await communicator.get(path)).status,200);assert.equal((await current(dispatcher,path)).assignee_id,fixture.otherHandler);
      const read=await observe(fixture,ticketId,ids,selected,unselected,false),write=await observe(fixture,ticketId,ids,selected,unselected,true);observations.push(read,write);
      console.log('T37_COMMUNICATOR_RESOURCE_OBSERVATION '+JSON.stringify({canonical_count:size,selected_is_uuid_last:true,read,write}));
      assert.equal(read.authorized,true);assert.equal(write.authorized,true);
      assert.equal(write.selected_session,'LOCK_NOT_AVAILABLE','the chosen authority Session must remain locked until the caller transaction ends');
      assert.equal(write.selected_assignment,'LOCK_NOT_AVAILABLE','the chosen assignment must remain locked until the caller transaction ends');
      // Intended first RED on the current all-canonical FOR UPDATE implementation.
      assert.equal(write.unselected_session,'ACQUIRED','T37_COMMUNICATOR_MUST_NOT_LOCK_UNSELECTED_CANONICAL_SESSION');
      assert.equal(write.unselected_assignment,'ACQUIRED','T37_COMMUNICATOR_MUST_NOT_LOCK_UNSELECTED_CANONICAL_ASSIGNMENT');
      for(const kind of ['selected_session','selected_assignment','unselected_session','unselected_assignment'] as const)assert.equal(read[kind],'ACQUIRED','read-only authority must not lock Session/assignment rows');
      for(const observation of [read,write]){
        assert.ok(observation.canonical_result_sizes.length>0,'observe real canonical Session results through the transparent delegate');
        assert.ok(observation.canonical_result_sizes.every(count=>count<=1),'candidate/assignment/access results must each be bounded to at most one canonical Session');
      }
    }
    for(const lock of [false,true]){
      const smaller=observations.find(value=>value.canonical_count===3&&value.lock===lock),larger=observations.find(value=>value.canonical_count===21&&value.lock===lock);assert.ok(smaller&&larger);
      assert.equal(larger.statement_count,smaller.statement_count,'authority query count must not grow with canonical Session count');
    }
    assert.deepEqual(await current(dispatcher,path),ticket,'authority observations and lock probes perform no Ticket business write');
    console.log('T37_COMMUNICATOR_RESOURCE_BOUND '+JSON.stringify({canonical_sizes:[3,21],only_owned_uuid_last:true,real_existing_pool_clients_at_once:2,new_pools:0,transparent_actual_queries:true,observations}));
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true});
});
