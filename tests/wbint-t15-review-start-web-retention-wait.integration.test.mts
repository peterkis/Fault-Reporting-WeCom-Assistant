import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import {formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';

interface Fixture {pool:PostgresPool;runtime:P2016EnabledRuntime;origin:string;cookies:string[];principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string;requestRef?:string}}[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
async function project(runtime:P2016EnabledRuntime){const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;for(let n=0;n<bound;n++){const inbound=await runtime.coordinator.runOnce(),material=await runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(!inbound.processed&&!material.processed&&(await runtime.coordinator.backlog()).total===0)return;}assert.fail('bounded material projection did not settle');}

test('T15 rechecks physical WEB retention after the actual existing Ticket row wait without changing independent Ticket READ',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const known=fixture.tickets[0],actor=fixture.principals[0],cookie=fixture.cookies[0];assert.ok(known&&actor&&cookie&&known.intake.requestRef);
    const producer=createYxxSelfServiceOrchestrator({pool:fixture.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},ruleEngine:{catalog_version:'T15_WEB_RETENTION',rule_set_version:'T15_WEB_RETENTION',evaluate(){throw new Error('synthetic deterministic fallback creates the actual WEB pending Review');}}});
    const produced=object(await producer.processOne({requestRef:known.intake.requestRef}));assert.equal(produced.processed,true);assert.equal(produced.result_code,'MANUAL_REVIEW_REQUIRED');
    await project(fixture.runtime);
    const get=async(path:string)=>{const response=await fetch(fixture.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
    const review=(await fixture.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status=\'PENDING\' ORDER BY created_at DESC,id DESC LIMIT 1',[known.intake.intakeId])).rows[0];assert.ok(review);
    const reviewPath='/api/manual-reviews/'+review.id,ticketPath='/api/tickets/'+known.ticket.id;
    const material=await get(reviewPath);assert.equal(material.status,200);const basis=object(material.value.material_basis);assert.equal(basis.source_kind,'WEB');assert.equal(basis.stale,false);
    const ticket=await get(ticketPath);assert.equal(ticket.status,200);assert.equal(ticket.value.status,'QUEUED');
    const context=await get(reviewPath+'/resolve-and-start-context');assert.equal(context.status,200);assert.equal(context.value.allowed,true);
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.value.principal_id,actor.id);
    const command={client_command_id:randomUUID(),expected_row_version:material.value.row_version,expected_material_basis:basis.current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'HUMAN_CONFIRMED',expected_ticket:context.value.expected_ticket,resolver_team_id:context.value.resolver_team_id,communication_choice:'RETAIN_CURRENT',sessions:[]};
    const ticketFacts=(value:Record<string,unknown>)=>({id:value.id,status:value.status,version:value.version,assignee_id:value.assignee_id,resolver_team_id:value.resolver_team_id});
    const snapshot=async()=>({ticket:ticketFacts((await get(ticketPath)).value),events:(await get(ticketPath+'/events')).value,responsibility:(await get(ticketPath+'/responsibility')).value,review:(await fixture.pool.query('SELECT status,row_version::text,resolution_command_id::text,resolution_command_hash FROM intake.manual_review_item WHERE id=$1::uuid',[review.id])).rows});
    const before=await snapshot(),physical=(await fixture.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;assert.ok(physical);
    const deadline=String((BigInt(physical)/1000n+6n)*1000n);
    assert.equal((await fixture.pool.query('UPDATE intake.web_request_binding SET retention_until=$2::timestamp without time zone,retention_until_epoch_ms=$3::bigint WHERE intake_id=$1::uuid',[known.intake.intakeId,formatEpochMsToShanghaiLocal(deadline),deadline])).rowCount,1);
    const retained=(await fixture.pool.query<{intake:boolean;journey:boolean;submissions:boolean}>(`SELECT i.retention_until_epoch_ms>$2::bigint AS intake,j.retention_until_epoch_ms>$2::bigint AS journey,NOT EXISTS(SELECT 1 FROM intake.web_submission s WHERE s.intake_id=i.id AND s.retention_until<=platform.local_from_epoch_ms($2::bigint)) AS submissions FROM intake.service_intake i JOIN intake.contact_journey j ON j.origin_intake_id=i.id WHERE i.id=$1::uuid`,[known.intake.intakeId,String(BigInt(deadline)+60000n)])).rows[0];assert.deepEqual(retained,{intake:true,journey:true,submissions:true});
    const gate=await fixture.pool.connect();let held=false,pending:Promise<Response>|undefined;
    try{
      await gate.query('BEGIN');held=true;assert.equal((await gate.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR NO KEY UPDATE',[known.ticket.id])).rowCount,1);
      const blocker=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(blocker);
      pending=fetch(fixture.origin+reviewPath+'/resolve-and-start',{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"','x-csrf-token':text(bootstrap.value.csrf_token)},body:JSON.stringify(command)});void pending.catch(()=>undefined);
      let blocked=false;const until=performance.now()+5000;
      do{const waiting=await fixture.pool.query(`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT%pilot_ticket.ticket t%FOR UPDATE OF t'`,[blocker]);if(waiting.rowCount===1){blocked=true;break;}await delay(10);}while(performance.now()<until);
      assert.equal(blocked,true,'the actual command must wait at T15 Ticket lock, not an earlier FK or synthetic timer');
      let expired=false;const expiryLimit=performance.now()+10000;
      do{const now=(await fixture.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;assert.ok(now);if(BigInt(now)>BigInt(deadline)+1000n){expired=true;break;}await delay(20);}while(performance.now()<expiryLimit);
      assert.equal(expired,true);const deniedReview=await get(reviewPath),readableTicket=await get(ticketPath);assert.equal(deniedReview.status,404);assert.equal(readableTicket.status,200);assert.deepEqual(ticketFacts(readableTicket.value),before.ticket);
      await gate.query('COMMIT');held=false;const result=await pending,body=await result.clone().json();
      console.log('T15_PHYSICAL_WEB_RETENTION_WAIT '+JSON.stringify({source_kind:'WEB',only_binding_deadline:deadline,actual_ticket_row_wait:true,outside_review_status:deniedReview.status,outside_ticket_status:readableTicket.status,status:result.status,body,command_id:command.client_command_id}));
      assert.equal(result.status,404,'transaction start time must not preserve WEB material authorization after its physical retention has expired');
      assert.deepEqual(await snapshot(),before);
      assert.equal((await fixture.pool.query<{n:number}>(`SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type='MANUAL_REVIEW_START' AND state='COMMITTED'`,['P2_016:'+actor.id,command.client_command_id])).rows[0]?.n,0);
    }finally{if(held)await gate.query('ROLLBACK');await pending?.catch(()=>undefined);gate.release();}
  },{workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:true});
});
