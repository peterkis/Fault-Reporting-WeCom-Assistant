import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {lockP2016Realtime} from '../app/server/src/p2-016-realtime-appender.mjs';

interface Fixture {origin:string;cookies:string[];pool:PostgresPool;processReviewIntake:(id:string)=>Promise<unknown>;tickets:{ticket:{id:string}}[];principals:{id:string}[]}
function http(fixture:Fixture){
  const get=(path:string,index=0)=>fetch(fixture.origin+path,{headers:{cookie:fixture.cookies[index]}});
  const read=async(path:string,index=0):Promise<Record<string,unknown>>=>{const response=await get(path,index);assert.equal(response.status,200,await response.clone().text());return await response.json() as Record<string,unknown>;};
  const post=(id:string,body:Record<string,unknown>,csrf:unknown,index=0,headers:Record<string,string>={})=>fetch(fixture.origin+'/api/manual-reviews/'+id+'/resolve',{method:'POST',headers:{cookie:fixture.cookies[index],origin:fixture.origin,'content-type':'application/json',
    'idempotency-key':String(body.client_command_id),'if-match':'"'+String(body.expected_row_version)+'"','x-csrf-token':String(csrf),...headers},body:JSON.stringify(body)});
  return {get,read,post};
}
async function facts(pool:PostgresPool){return (await pool.query<{tickets:number;human:number;events:number;communication:number;notifications:number}>(`SELECT
  (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
  (SELECT count(*)::integer FROM intake.deterministic_decision WHERE status='HUMAN_OVERRIDDEN') AS human,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS events,
  (SELECT count(*)::integer FROM communication.outbox) AS communication,
  (SELECT count(*)::integer FROM notification.outbox) AS notifications`)).rows[0];}

async function streamWaiters(pool:PostgresPool,count:number){
  const until=Date.now()+5000;
  while(Date.now()<until){
    const rows=(await pool.query<{pid:number;review_fk:boolean}>(`SELECT w.pid,
      EXISTS(SELECT 1 FROM pg_locks r WHERE r.pid=w.pid AND r.relation='intake.manual_review_item'::regclass
        AND r.mode='RowShareLock' AND r.granted) AS review_fk
      FROM pg_locks w WHERE w.locktype='advisory' AND NOT w.granted
        AND w.database=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows;
    if(rows.length>=count)return rows;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('commands did not reach the observed stream lock wait');
}

test('T14 stream wait precedes Review receipt foreign-key locks and preserves one winner',{timeout:30000},async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read,post}=http(fixture);
    await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'第二合成复核员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const source=await seedPersistedIntake({pool:fixture.pool,chatType:'single',text:'流锁与回执外键锁顺序的合成材料。'});await fixture.processReviewIntake(source.intakeId);
    const review=(await fixture.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[source.intakeId])).rows[0];assert.ok(review);
    const original=await read('/api/manual-reviews/'+review.id),first=await read('/api/lifecycle/bootstrap'),second=await read('/api/lifecycle/bootstrap',2),before=await facts(fixture.pool);assert.ok(before);
    const command={client_command_id:randomUUID(),expected_row_version:original.row_version,expected_material_basis:(original.material_basis as {current_hash:string}).current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'EXPLICIT_HUMAN_CHOICE'};
    const mutex=await fixture.pool.connect();await mutex.query('BEGIN');await lockP2016Realtime(mutex);
    const pending=Promise.all([post(review.id,command,first.csrf_token),post(review.id,{...command,client_command_id:randomUUID()},second.csrf_token,2)]);
    let lockError:unknown;
    try{const waiting=await streamWaiters(fixture.pool,2);assert.equal(waiting.filter(row=>row.review_fk).length,0,'waiting commands cannot pin Review through a receipt FK before the stream mutex');}
    catch(error){lockError=error;}finally{await mutex.query('ROLLBACK');mutex.release();}
    const responses=await pending;if(lockError)throw lockError;
    assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
    const after=await facts(fixture.pool);assert.ok(after);assert.equal(after.human-before.human,1);assert.equal(after.tickets-before.tickets,1);assert.equal(after.events-before.events,1);
    assert.equal(after.communication,before.communication);assert.equal(after.notifications,before.notifications);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,manualProjection:true});
});

test('T14 stream wait rechecks current authority before creating a receipt',{timeout:30000},async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read,post}=http(fixture),principal=fixture.principals[0];assert.ok(principal);
    const source=await seedPersistedIntake({pool:fixture.pool,chatType:'single',text:'等待流锁后撤销身份的合成材料。'});await fixture.processReviewIntake(source.intakeId);
    const review=(await fixture.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[source.intakeId])).rows[0];assert.ok(review);
    const original=await read('/api/manual-reviews/'+review.id),bootstrap=await read('/api/lifecycle/bootstrap'),before=await facts(fixture.pool);
    const command={client_command_id:randomUUID(),expected_row_version:original.row_version,expected_material_basis:(original.material_basis as {current_hash:string}).current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'EXPLICIT_HUMAN_CHOICE'};
    const mutex=await fixture.pool.connect();await mutex.query('BEGIN');await lockP2016Realtime(mutex);
    const pending=post(review.id,command,bootstrap.csrf_token);let waitError:unknown;
    try{await streamWaiters(fixture.pool,1);await fixture.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principal.id]);}
    catch(error){waitError=error;}finally{await mutex.query('ROLLBACK');mutex.release();}
    const response=await pending;if(waitError)throw waitError;
    assert.ok([401,403].includes(response.status),'authority revoked during the stream wait must reject the original command');
    assert.deepEqual(await facts(fixture.pool),before);
    assert.equal((await fixture.pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rows[0]?.count,0);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,manualProjection:true});
});

test('T14 competing authorized reviewers commit one conclusion and reject mismatched HTTP intent before writes',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read,post}=http(fixture);
    await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'第二合成复核员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const source=await seedPersistedIntake({pool:fixture.pool,chatType:'single',text:'两个内部复核员并发确认的全新合成材料。'});await fixture.processReviewIntake(source.intakeId);
    const review=(await fixture.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[source.intakeId])).rows[0];assert.ok(review);
    const original=await read('/api/manual-reviews/'+review.id),first=await read('/api/lifecycle/bootstrap'),second=await read('/api/lifecycle/bootstrap',2),before=await facts(fixture.pool);assert.ok(before);
    const command={client_command_id:randomUUID(),expected_row_version:original.row_version,expected_material_basis:(original.material_basis as {current_hash:string}).current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'EXPLICIT_HUMAN_CHOICE'};
    const invalidHeaders:{headers:Record<string,string>;status:number}[]=[{headers:{'idempotency-key':randomUUID()},status:400},{headers:{'if-match':'"999"'},status:409},{headers:{'x-csrf-token':'invalid'},status:403},{headers:{origin:'https://attacker.invalid'},status:403}];
    for(const {headers,status} of invalidHeaders)
      assert.equal((await post(review.id,command,first.csrf_token,0,headers)).status,status);
    assert.deepEqual(await facts(fixture.pool),before);
    const other={...command,client_command_id:randomUUID()};
    const responses=await Promise.all([post(review.id,command,first.csrf_token),post(review.id,other,second.csrf_token,2)]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
    const after=await facts(fixture.pool);assert.ok(after);assert.equal(after.human-before.human,1);assert.equal(after.tickets-before.tickets,1);assert.equal(after.events-before.events,1);
    assert.equal(after.communication,before.communication);assert.equal(after.notifications,before.notifications);
    assert.deepEqual((await read('/api/manual-reviews/'+review.id)).safe_result,original.safe_result);
    const winner=responses[0]?.status===200?{body:command,csrf:first.csrf_token,index:0}:{body:other,csrf:second.csrf_token,index:2};
    assert.equal((await post(review.id,winner.body,winner.csrf,winner.index)).status,200);assert.deepEqual(await facts(fixture.pool),after);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('T14 current identity and retained source scope are rechecked before historical receipt or Review alias',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {get,read,post}=http(fixture),ticket=fixture.tickets[0],principal=fixture.principals[0];assert.ok(ticket);assert.ok(principal);
    const item=await read('/api/workbench/items/ticket/'+ticket.ticket.id),review=(item.review_refs as {id:string}[])[0];assert.ok(review);
    await fixture.pool.query("UPDATE intake.contact_journey SET reported_at=LEAST(reported_at,platform.local_now()-interval '1 day') WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)",[review.id]);
    const original=await read('/api/manual-reviews/'+review.id),bootstrap=await read('/api/lifecycle/bootstrap');
    const command={client_command_id:randomUUID(),expected_row_version:original.row_version,expected_material_basis:(original.material_basis as {current_hash:string}).current_hash,resolution_code:'CLASSIFY_BUSINESS_CONSULTATION',resolution_reason_code:'EXPLICIT_HUMAN_CHOICE'};
    assert.equal((await post(review.id,command,bootstrap.csrf_token)).status,200);
    const receipt='/api/manual-reviews/'+review.id+'/commands/'+command.client_command_id,after=await facts(fixture.pool);
    assert.equal((await get(receipt)).status,200);assert.equal((await get('/api/workbench/items/review/'+review.id)).status,200);
    await fixture.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principal.id]);
    for(const response of [await get('/api/manual-reviews/'+review.id),await get(receipt),await post(review.id,command,bootstrap.csrf_token)])assert.ok([401,403].includes(response.status));
    await fixture.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[principal.id]);
    await fixture.pool.query("WITH expiry AS (SELECT platform.physical_epoch_ms()-1000 AS epoch) UPDATE intake.contact_journey SET retention_until_epoch_ms=expiry.epoch,retention_until=platform.local_from_epoch_ms(expiry.epoch) FROM expiry WHERE id=$1::uuid",[original.journey_id]);
    assert.equal((await get('/api/workbench/items/ticket/'+ticket.ticket.id)).status,200,'the existing Ticket remains independently readable');
    for(const response of [await get('/api/manual-reviews/'+review.id),await get(receipt),await post(review.id,command,bootstrap.csrf_token),await get('/api/workbench/items/review/'+review.id)])assert.equal(response.status,404,'expired Review scope cannot resolve to a readable Ticket or historical result: '+response.url);
    assert.deepEqual(await facts(fixture.pool),after);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('T14 default-disabled workspace retains the original native profile and independently disabled recovery',async()=>{
  const profiles:{workbenchManualReviewEnabled?:boolean}[]=[{},{workbenchManualReviewEnabled:true}];
  for(const options of profiles)await withWeb01Fixture(async(fixture:Fixture)=>{
    const {get,read}=http(fixture),ticket=fixture.tickets[0];assert.ok(ticket);const bootstrap=await read('/api/lifecycle/bootstrap'),item=await read('/api/workbench/items/ticket/'+ticket.ticket.id);
    const review=(await fixture.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE linked_ticket_id=$1::uuid',[ticket.ticket.id])).rows[0];assert.ok(review);
    const detail=await read('/api/manual-reviews/'+review.id),enabled=options.workbenchManualReviewEnabled===true;
    assert.equal(bootstrap.manual_review_enabled,enabled);assert.equal(bootstrap.manual_review_draft_recovery_enabled,false);
    assert.equal(Object.hasOwn(item,'review_refs'),enabled);assert.equal(Object.hasOwn(detail,'material_basis'),enabled);assert.equal(Object.hasOwn(detail,'canonical_item'),enabled);
    const before=await facts(fixture.pool);assert.equal((await get('/api/manual-reviews/'+review.id+'/commands/'+randomUUID())).status,503);assert.deepEqual(await facts(fixture.pool),before);
    await fixture.pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()-interval '1 second' WHERE id=$1::uuid",[detail.service_intake_id]);
    if(enabled)assert.equal((await get('/api/manual-reviews/'+review.id)).status,404);
  },options);
});
