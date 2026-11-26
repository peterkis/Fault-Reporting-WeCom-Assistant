import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {isFullCardProjection,observeWorkbenchRequest} from './helpers/card42a-sql-observer.mjs';
import {seedAnnualBoardIntakes,seedAnnualBoardJourneys} from './helpers/capacity-dataset.mjs';
import {createTicketActionService} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {sourceGroupOriginBindingSql} from '../app/server/src/workbench-source-groups.mjs';
import {assertLocalDateTime} from '../app/server/src/platform/time-contract.mjs';
import {transactionP2016,hashP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {orderedHandledPageSql} from '../app/server/src/workbench-card-projections.mjs';
import {buildBoardKeysQuery,readWorkbenchClock} from '../app/server/src/web01-workbench-query.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createYxxSelfServiceOrchestrator} from '../app/server/src/yxx-self-service-orchestrator.mjs';
import {withWeb01Fixture,seedWeb01NoConversationIntake} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {object,rows} from './helpers/t41-search-risk-fixture.mjs';
import type {PostgresPool,PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';
import {appendIntakeClosureEvent,insertClosureRecord,normalizeClosureInput} from '../app/server/src/service-closure-records.mjs';

interface Fixture {pool:PostgresPool;origin:string;backendOrigin?:string;cookies:string[];sessionId?:string;
 tickets:{ticket:{id:string;version:number};intake:{intakeId:string}}[]}
function text(value:unknown):string {assert.ok(typeof value==='string');return value;}
function request(f:Fixture,path:string,init:RequestInit={}){
 const headers=new Headers(init.headers);headers.set('cookie',f.cookies[0]??'');
 return fetch((f.backendOrigin??f.origin)+path,{...init,headers,signal:AbortSignal.timeout(15000)});
}
async function read(f:Fixture,path:string){const response=await request(f,path);assert.equal(response.status,200,await response.clone().text());return object(await response.json());}

test('T41 all/closed/status/number search preserves the default completed and ignored canonical board membership',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  for(const status of ['COMPLETED','DISMISSED']){
   const intake=await seedPersistedIntake({pool:f.pool,text:'T41 retained '+status+'（合成）',status:status==='DISMISSED'?'WAITING_DESCRIPTION':status});
   if(status==='DISMISSED'){
    const closed=(await f.pool.query<{version:number}>("UPDATE intake.service_intake SET status='DISMISSED',version=version+1 WHERE id=$1::uuid RETURNING version",[intake.intakeId])).rows[0];assert.ok(closed);
    const event=await appendIntakeClosureEvent(f.pool,{intakeId:intake.intakeId,version:closed.version,type:'intake.dismissed',oldStatus:'WAITING_DESCRIPTION',newStatus:'DISMISSED',actor:null,traceId:'t41-current-read-ignored（合成）'});
    await insertClosureRecord({transaction:f.pool,subjectType:'INTAKE',subjectId:intake.intakeId,beforeStatus:'WAITING_DESCRIPTION',beforeVersion:closed.version-1,beforeSnapshot:{request_type:'UNKNOWN',reviews:[],journeys:[]},actor:null,source:'SYSTEM',input:normalizeClosureInput({reason_code:'NOT_IT_SCOPE',secondary_reason_code:'ACKNOWLEDGED'}),intakeEventId:event});
   }
   const detail=await read(f,'/api/workbench/items/intake/'+intake.intakeId),item=object(detail.item);
   assert.equal(item.kind,'intake');assert.equal(item.status,status);
   const before=await read(f,'/api/workbench/board?column=handled&range=all');
   const membership=rows(before.items).map(row=>[row.kind,row.id,row.status]);
   assert.ok(rows(before.items).some(row=>row.kind==='intake'&&row.id===intake.intakeId&&row.status===status),'Card 27A defaults include both closed Intake kinds');
   for(const column of ['all','handled']){
    const found=await read(f,'/api/workbench/search?column='+column+'&range=all&statuses='+status+'&q='+encodeURIComponent(text(item.number)));
    assert.deepEqual(rows(found.items).map(row=>[row.kind,row.id,row.status]),[['intake',intake.intakeId,status]]);
    assert.equal(found.next_cursor,null);assert.equal(Object.hasOwn(found,'total'),false);
   }
   const board=await read(f,'/api/workbench/board?column=handled&range=all');
   assert.deepEqual(rows(board.items).map(row=>[row.kind,row.id,row.status]),membership,'search must not change ordinary board membership');
   assert.deepEqual(board.group_counts,before.group_counts,'read-only search must not change complete group counts');
  }
 },{manualProjection:true,workbenchSearchEnabled:true,workbenchManualReviewEnabled:true});
});

test('T41 handled search returns an empty authorized page for disjoint Ticket and Intake statuses',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  for(const status of ['QUEUED','RECEIVED']){
   const page=await read(f,'/api/workbench/search?column=handled&range=all&statuses='+status);
   assert.deepEqual(page.items,[],status);assert.equal(page.next_cursor,null);
  }
 },{namespace:'ticket_card42a',manualProjection:true,workbenchSearchEnabled:true});
});

for(const invalidation of ['logout','physical-expiry'] as const)test('T41 rechecks the real COOKIE session after an authenticated query wait: '+invalidation,async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  assert.ok(f.sessionId);const bootstrap=await read(f,'/api/lifecycle/bootstrap'),gate=await f.pool.connect();let held=false,pending:Promise<Response>|undefined;
  try{
   if(invalidation==='physical-expiry')await f.pool.query(`UPDATE pilot_ticket.workbench_auth_session SET expires_epoch_ms=platform.physical_epoch_ms()+1000,expires_at=platform.local_from_epoch_ms(platform.physical_epoch_ms()+1000) WHERE session_id=$1::uuid`,[f.sessionId]);
   // The optional web-schema preflight can read ticket first. This relation belongs to the candidate query.
   await gate.query('BEGIN');held=true;await gate.query('LOCK TABLE intake.deterministic_decision IN ACCESS EXCLUSIVE MODE');
   const blocker=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(blocker);
   pending=request(f,'/api/workbench/search?limit=2');void pending.catch(()=>undefined);
   let waiting=false;const bound=performance.now()+1000;
   while(performance.now()<bound){
    if((await f.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND query LIKE 'WITH candidate_keys AS (%'`,[blocker])).rowCount){waiting=true;break;}await delay(10);
   }
   assert.equal(waiting,true,'the actual authenticated search must reach its query wait');
   if(invalidation==='logout'){
    const loggedOut=await request(f,'/workbench/logout',{method:'POST',headers:{origin:f.origin,'x-csrf-token':text(bootstrap.csrf_token)}});assert.equal(loggedOut.status,200);
   }else{
    let expired=false;const expiryBound=performance.now()+1300;
    while(performance.now()<expiryBound){
     const value=(await f.pool.query<{expired:boolean}>('SELECT expires_epoch_ms<=platform.physical_epoch_ms() AS expired FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[f.sessionId])).rows[0];
     if(value?.expired){expired=true;break;}await delay(10);
    }assert.equal(expired,true);
   }
   await gate.query('COMMIT');held=false;const response=await pending;
   assert.equal(response.status,401,await response.clone().text());const denied=object(await response.json());
   assert.equal(Object.hasOwn(denied,'items'),false);assert.equal(Object.hasOwn(denied,'next_cursor'),false);
  }finally{if(held)await gate.query('ROLLBACK');await pending?.catch(()=>undefined);gate.release();}
 },{realWorkbenchAuthentication:true,workbenchSearchEnabled:true});
});

test('T41 does not return an earlier safe reporter projection after its Journey expires during the batched page projection',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const first=f.tickets[0];assert.ok(first);
  const journey=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[first.intake.intakeId])).rows[0];assert.ok(journey);
  const deadline=(await f.pool.query<{deadline:string}>(`WITH deadline AS (SELECT (platform.physical_epoch_ms()/1000+5)*1000 AS epoch)
   UPDATE intake.contact_journey SET profile_resolution_status='RESOLVED',profile_snapshot=jsonb_build_object('source','WECOM_DIRECTORY','version','T41_TTL','contact',jsonb_build_object('name','T41即将到期姓名'),'memberships','[]'::jsonb),
    retention_until=platform.local_from_epoch_ms(deadline.epoch),retention_until_epoch_ms=deadline.epoch
   FROM deadline WHERE id=$1::uuid RETURNING retention_until_epoch_ms::text AS deadline`,[journey.id])).rows[0]?.deadline;assert.ok(deadline);
  const before=await read(f,'/api/workbench/items/ticket/'+first.ticket.id);assert.equal(object(before.item).reporter_name,'T41即将到期姓名');
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;}),reached=new Promise<void>(resolve=>{entered=resolve;});
  const original=f.pool.query,execute=original.bind(f.pool);
  f.pool.query=new Proxy(original,{apply(target,thisArg,args:unknown[]){
   const sql=typeof args[0]==='string'?args[0]:'';
   if(sql.includes('SELECT * FROM projected_sources')){entered();return held.then(()=>Reflect.apply(target,thisArg,args));}
   return Reflect.apply(target,thisArg,args);
  }});
  let pending:Promise<Response>|undefined;
  try{
   pending=request(f,'/api/workbench/search?column=all&q='+encodeURIComponent('全新合成开发材料')+'&limit=2');void pending.catch(()=>undefined);
   await Promise.race([reached,delay(5000).then(()=>assert.fail('the signed page did not reach its batch source projection'))]);
   let expired=false;const expiryBound=performance.now()+6000;
   while(performance.now()<expiryBound){
    const value=(await execute<{expired:boolean}>('SELECT platform.physical_epoch_ms()>$1::bigint AS expired',[deadline])).rows[0];
    if(value?.expired){expired=true;break;}await delay(20);
   }assert.equal(expired,true,'the originally retained Journey must actually expire while the batch source projection waits');
   release();const response=await pending;assert.equal(response.status,400,await response.clone().text());
   assert.ok(!(await response.text()).includes('T41即将到期姓名'));
  }finally{release();await pending?.catch(()=>undefined);f.pool.query=original;}
  const after=await read(f,'/api/workbench/items/ticket/'+first.ticket.id);assert.equal(object(after.item).reporter_name,null);
 },{namespace:'ticket_card42a',manualProjection:true,workbenchSearchEnabled:true});
});

test('42A search rejects an assignee rename committed between selection and hydration',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=(await f.pool.query<{id:string;ticket_no:string;assignee_id:string}>(
   'SELECT id,ticket_no,assignee_id FROM pilot_ticket.ticket WHERE assignee_id IS NOT NULL ORDER BY ticket_no LIMIT 1')).rows[0];assert.ok(target);
  const path='/api/workbench/search?range=all&q='+encodeURIComponent(target.ticket_no);
  assert.equal(rows((await read(f,path)).items)[0]?.id,target.id);
  const connect=f.pool.connect;
  let renamed=false;
  f.pool.connect=new Proxy(connect,{apply(acquire,owner,args:unknown[]){
   if(args.length)return Reflect.apply(acquire,owner,args);
   return Reflect.apply(acquire,owner,args).then((client:PostgresPoolClient)=>{
    const original=client.query,release=client.release;
    client.query=new Proxy(original,{apply(execute,_receiver,params:unknown[]){
     const result=Reflect.apply(execute,client,params);
     if(renamed||typeof params[0]!=='string'||!params[0].includes('AS safety_signature FROM matched'))return result;
     return Promise.resolve(result).then(async page=>{
      await f.pool.query("UPDATE pilot_ticket.pilot_principal SET display_name='已改名（合成）' WHERE id=$1",[target.assignee_id]);
      renamed=true;return page;
     });
    }});
    client.release=(...args:Parameters<PostgresPoolClient['release']>)=>{client.query=original;client.release=release;return release.apply(client,args);};
    return client;
   });
  }});
  try{
   const response=await request(f,path);assert.ok(renamed);
   assert.equal(response.status,400,await response.clone().text());const denied=object(await response.json());
   assert.equal(object(denied.error).code,'P2_016_CURSOR_INVALID');assert.ok(!Object.hasOwn(denied,'items'));
  }finally{f.pool.connect=connect;}
  assert.equal(rows((await read(f,path)).items)[0]?.assignee_name,'已改名（合成）');
 },{namespace:'ticket_card42a',manualProjection:true,workbenchSearchEnabled:true});
});

test('42A search rejects a source Journey that expires after selection even when the Ticket card is identical',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const source=await seedPersistedIntake({pool:f.pool,text:'来源时效校验（合成）',requestType:'INCIDENT',status:'RECEIVED'});
  const ticket=(await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:source.intakeId,
    occurredAt:assertLocalDateTime(source.receivedAt),traceId:'42a-origin-expiry'})).ticket;assert.ok(ticket);
  const journey=(await f.pool.query<{id:string}>(`INSERT INTO intake.contact_journey
    (creation_key,origin_intake_id,linked_ticket_id,entry_mode,origin_channel,current_channel,reporter_identity_hash,
     profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,evaluation_due_at,evaluation_due_epoch_ms,
     reported_at,last_activity_at,privacy_class,retention_until,retention_until_epoch_ms)
    SELECT '42a-origin-expiry:'||i.id,i.id,$2::uuid,'GROUP_MENTION_INLINE','WECOM_GROUP','WECOM_GROUP',repeat('0',64),
      'NOT_REQUIRED','{}',repeat('0',64),'TICKET_LINKED',platform.local_from_epoch_ms(0),0,
      i.created_at-interval '1 day',i.updated_at,i.privacy_class,i.retention_until,i.retention_until_epoch_ms
    FROM intake.service_intake i WHERE i.id=$1 RETURNING id`,[source.intakeId,ticket.id])).rows[0];assert.ok(journey);
  await f.pool.query(`WITH expiry AS (SELECT (platform.physical_epoch_ms()/1000-1)*1000 AS ms)
    UPDATE intake.service_intake SET retention_until_epoch_ms=ms,retention_until=platform.local_from_epoch_ms(ms) FROM expiry WHERE id=$1`,[source.intakeId]);
  const binding=async()=>(await f.pool.query<{origins:number;retained:boolean;intake_visible:boolean}>(`
    SELECT binding.count AS origins,binding.retained,i.retention_until_epoch_ms>platform.physical_epoch_ms() AS intake_visible
    FROM (SELECT 'ticket'::text AS kind,$1::uuid AS id,$2::uuid AS intake_id) r
    JOIN intake.service_intake i ON i.id=r.intake_id CROSS JOIN LATERAL (${sourceGroupOriginBindingSql()}) binding`,[ticket.id,source.intakeId])).rows[0];
  assert.deepEqual(await binding(),{origins:1,retained:true,intake_visible:false});
  const path='/api/workbench/search?q='+encodeURIComponent(ticket.ticket_no);
  const before=rows((await read(f,path)).items);assert.equal(before.length,1);assert.equal(before[0]?.id,ticket.id);
  const original=f.pool.query;let expired=false;
  f.pool.query=new Proxy(original,{apply(query,owner,args){
    if(expired||typeof args[0]!=='string'||!args[0].includes('SELECT * FROM projected_sources'))return Reflect.apply(query,owner,args);
    expired=true;
    return f.pool.query(`WITH expiry AS (SELECT (platform.physical_epoch_ms()/1000-1)*1000 AS ms)
      UPDATE intake.contact_journey SET retention_until_epoch_ms=ms,retention_until=platform.local_from_epoch_ms(ms) FROM expiry WHERE id=$1`,[journey.id])
      .then(result=>{assert.equal(result.rowCount,1);return Reflect.apply(query,owner,args);});
  }});
  try{
    const response=await request(f,path);assert.ok(expired);assert.equal(response.status,400,await response.clone().text());
    const denied=object(await response.json());assert.equal(object(denied.error).code,'P2_016_CURSOR_INVALID');
    assert.ok(!Object.hasOwn(denied,'items')&&!Object.hasOwn(denied,'next_cursor'));
  }finally{f.pool.query=original;}
  assert.deepEqual(await binding(),{origins:1,retained:false,intake_visible:false});
  assert.deepEqual(rows((await read(f,path)).items),before);
 },{namespace:'ticket_card42a',manualProjection:true,workbenchSearchEnabled:true});
});

for(const change of ['ticket-status','review-with-follow','review-without-follow','consultation-with-follow'] as const)
test('42A search preserves the main cursor restart after selection: '+change,async()=>{
 const consultation=change==='consultation-with-follow';
 const isReview=change!=='ticket-status',follow=change==='review-with-follow'||consultation;
 await withWeb01Fixture(async(f:Fixture&{principals:{id:string}[]})=>{
  const ticket=f.tickets[0]?.ticket,actor=f.principals[0];assert.ok(ticket&&actor);
  const path=isReview?'/api/workbench/search?column=pending&statuses=PENDING':'/api/workbench/search?column=pending&statuses=QUEUED';
  const before=rows((await read(f,path)).items);
  const selected=isReview?before.find(row=>row.kind==='review'):before.find(row=>row.id===ticket.id);assert.ok(selected);
  const id=text(selected.id),original=f.pool.query;
  let changed=false;
  f.pool.query=new Proxy(original,{apply(query,owner,args){
   const sql=args[0];
   if(changed||typeof sql!=='string'||!sql.includes(follow?'AS review_legs':'SELECT * FROM projected_sources'))return Reflect.apply(query,owner,args);
   changed=true;
   return (async()=>{
    if(consultation){
      const reviewPath='/api/manual-reviews/'+id;
      const bootstrap=await read(f,'/api/lifecycle/bootstrap'),beforeReview=await read(f,reviewPath);
      const command={client_command_id:randomUUID(),expected_row_version:text(beforeReview.row_version),
        resolution_code:'CLASSIFY_BUSINESS_CONSULTATION',resolution_reason_code:'BUSINESS_CONSULTATION_CONFIRMED'};
      const applied=await request(f,reviewPath+'/resolve',{method:'POST',headers:{origin:f.origin,'content-type':'application/json',
        'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"','x-csrf-token':text(bootstrap.csrf_token)},
        body:JSON.stringify(command)});
      assert.equal(applied.status,200,await applied.clone().text());
    }else if(isReview){
      const write=await f.pool.query(`UPDATE intake.contact_journey SET linked_ticket_id=$2,status='TICKET_LINKED'
        WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1)`,[id,ticket.id]);
      assert.equal(write.rowCount,1);
    }else{
      const accepted=await createTicketActionService({pool:f.pool}).perform({ticketId:id,action:'accept',expectedVersion:ticket.version,
        actor:{type:'PILOT_USER',id:actor.id},traceId:'card42a-search-status'});
      assert.ok(accepted.ok);assert.equal(accepted.event.event_type,'ticket.accepted');
    }
    return Reflect.apply(query,owner,args);
   })();
  }});
  try{
   const response=await request(f,path);assert.ok(changed);
   assert.equal(response.status,400,await response.clone().text());
   const body=object(await response.json());assert.equal(object(body.error).code,'P2_016_CURSOR_INVALID');assert.ok(!Object.hasOwn(body,'items'));
  }finally{f.pool.query=original;}
  assert.ok(!rows((await read(f,path)).items).some(row=>row.id===id));
  if(consultation){
    const current=await read(f,'/api/manual-reviews/'+id);
    assert.deepEqual(current.canonical_item,{kind:'intake',id:selected.intake_id});
    const detail=await read(f,'/api/workbench/items/intake/'+text(selected.intake_id));
    assert.equal(object(detail.item).status,'COMPLETED');
    const {value:alias,sql}=await observeWorkbenchRequest(f.pool,()=>read(f,'/api/workbench/items/review/'+id));
    assert.deepEqual(alias.requested_item,{kind:'review',id});
    assert.deepEqual(alias.item,detail.item);
    assert.equal(sql.filter(isFullCardProjection).length,1);
  }
 },{namespace:'ticket_card42a',manualProjection:true,workbenchSearchEnabled:true,workbenchManualReviewEnabled:true,workbenchFollowEnabled:follow});
});

test('42A Web preflight requires a retained canonical card when optional storage is unavailable',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const source=await seedWeb01NoConversationIntake({pool:f.pool,text:'需人工判断（合成）'});
  const worker=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',
   featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},
   ruleEngine:{evaluate(){throw Error('synthetic manual review');}}});
  assert.equal((await worker.processOne({requestRef:source.requestRef})).processed,true);
  const review=(await f.pool.query<{journey_id:string}>(`SELECT r.journey_id FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id
    WHERE i.id=$1 AND r.status='PENDING' AND i.pilot_ticket_id IS NULL`,[source.intakeId])).rows[0];assert.ok(review);
  await f.pool.query("UPDATE intake.service_intake SET status='WAITING_TRIAGE' WHERE id=$1",[source.intakeId]);
  const bot=(await f.pool.query<{ticket_no:string}>('SELECT ticket_no FROM pilot_ticket.ticket ORDER BY ticket_no LIMIT 1')).rows[0];assert.ok(bot);
  const path='/api/workbench/search?q='+encodeURIComponent(bot.ticket_no);
  await f.pool.query('ALTER TABLE intake.web_submission RENAME TO card42a_held_submission');
  try{
   assert.equal((await request(f,path)).status,503,'retained review requires the missing Web relation');
   await f.pool.query(`WITH stamp AS (SELECT (platform.physical_epoch_ms()/1000-1)*1000 AS epoch)
    UPDATE intake.contact_journey SET reported_at=LEAST(reported_at,platform.local_from_epoch_ms(epoch)-interval '1 minute'),
      retention_until=platform.local_from_epoch_ms(epoch),retention_until_epoch_ms=epoch FROM stamp WHERE id=$1`,[review.journey_id]);
   assert.equal(rows((await read(f,path)).items)[0]?.number,bot.ticket_no);
  }finally{await f.pool.query('ALTER TABLE intake.card42a_held_submission RENAME TO web_submission');}
 },{namespace:'ticket_card42a',manualProjection:true,ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,workbenchSearchEnabled:true});
});


test('42A Follow search enforces the 10000-Journey Review boundary and uses native page and anchor order',{timeout:180000},async()=>{
 await withWeb01Fixture(async(f:Fixture&{databaseUrl:string;processReviewIntake:(id:string)=>Promise<unknown>})=>{
  assert.match(new URL(f.databaseUrl).pathname,/^\/ticket_card42a_/u);
  await f.pool.query("CREATE COLLATION card42a_numeric (provider=icu,locale='und-u-kn')");
  const anchors=['00000000-0000-4000-8000-00000000010a','00000000-0000-4000-8000-0000000002aa'];
  const [first,second]=anchors;assert.ok(first&&second);
  const typedPage="SELECT 'ticket'::text AS kind,id,1 AS order_group,timestamp '2026-11-25 00:00:00' AS order_at FROM unnest($1::uuid[]) id";
  const order=(await f.pool.query<{numeric_ids:string[];page:{id:string;order_at:string}[]}>(
   `SELECT (SELECT array_agg(id::text ORDER BY id::text COLLATE card42a_numeric DESC) FROM unnest($1::uuid[]) id) AS numeric_ids,
    ${orderedHandledPageSql(typedPage)} AS page`,[anchors])).rows[0];
  assert.ok(order);assert.deepEqual(order.numeric_ids,anchors);
  assert.deepEqual(order.page.map(row=>row.id),[second,first]);
  assert.ok(order.page.every(row=>row.order_at==='2026-11-25 00:00:00'));

  const bootstrap=await read(f,'/api/lifecycle/bootstrap'),principal=text(bootstrap.principal_id);
  const clock=await readWorkbenchClock(f.pool);
  const keys=buildBoardKeysQuery({column:'handled',relatedOnly:false,includeFollow:false,allRange:true,
   from:clock.nowLocal,until:clock.nowLocal,limit:3,cursor:null});
  assert.ok(keys.handled);
  const types=(await f.pool.query<{id_type:string;time_type:string}>(`WITH handled_completed_intakes AS MATERIALIZED (${keys.handled.completedIntakesSql})
   SELECT pg_typeof(page.id)::text AS id_type,pg_typeof(page.order_at)::text AS time_type FROM (${keys.handled.pageKeysSql}) page LIMIT 1`,
   [true,principal,[],clock.nowEpoch,clock.nowLocal,...keys.values])).rows[0];
  assert.deepEqual(types,{id_type:'uuid',time_type:'timestamp without time zone'});

  // Two real pending Reviews on one page. Grow the admin's readable Journey set independently of the matches.
  const another=await seedPersistedIntake({pool:f.pool,text:'第二份待判断材料（合成）',status:'RECEIVED'});
  await f.processReviewIntake(another.intakeId);
  const size=async()=>(await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0]?.n;
  const start=await size();assert.ok(start!==undefined&&start<10000-682);
  await transactionP2016(f.pool,async tx=>{
   await seedAnnualBoardIntakes(tx,clock.nowEpoch,10000-start);
   // Ticket Core creates only from a RECEIVED Intake. Give this source the corresponding initial event.
   assert.equal((await tx.query("UPDATE intake.service_intake SET status='RECEIVED' WHERE id=$1 AND version=1",[first])).rowCount,1);
   assert.equal((await tx.query(`UPDATE intake.service_intake_event SET payload=jsonb_build_object('status','RECEIVED')
     WHERE intake_id=$1 AND event_type='intake.received' AND aggregate_version=1`,[first])).rowCount,1);
   await seedAnnualBoardJourneys(tx);
  });
  assert.equal(await size(),10000);
  const reviewPath='/api/workbench/search?column=pending&statuses=PENDING';
  const {value:atLimit,sql}=await observeWorkbenchRequest(f.pool,()=>read(f,reviewPath));
  assert.equal(sql.filter(q=>q.includes('readable_journeys OFFSET 10000')).length,1);
  assert.ok(rows(atLimit.items).filter(item=>item.kind==='review').length>=2);
  const last=await seedPersistedIntake({pool:f.pool,text:'最后一份边界材料（合成）',status:'RECEIVED'});
  await f.processReviewIntake(last.intakeId);
  assert.equal(await size(),10001);
  const denied=await request(f,reviewPath);assert.equal(denied.status,503);
  const body=object(await denied.json());assert.equal(object(body.error).code,'P2_016_REVIEW_SCOPE_TOO_LARGE');assert.ok(!Object.hasOwn(body,'items'));

  const created=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:first,occurredAt:assertLocalDateTime(clock.nowLocal),traceId:'card42a-two-anchors'});
  const ticket=created.ticket;assert.ok(ticket);
  const linked=await f.pool.query("UPDATE intake.contact_journey SET linked_ticket_id=$2,status='TICKET_LINKED' WHERE origin_intake_id=ANY($1::uuid[])",[anchors,ticket.id]);
  assert.equal(linked.rowCount,2);
  const ticketPage=await read(f,'/api/workbench/search?column=pending&statuses=QUEUED&q='+encodeURIComponent(ticket.ticket_no));
  const matches=rows(ticketPage.items);assert.deepEqual(matches.map(item=>item.id),[ticket.id]);
  const canonical={kind:'ticket',id:ticket.id},version=text(object(matches[0]?.attention).follow_version);
  assert.equal(version,hashP2016([1,principal,canonical,anchors.map(id=>[id,false,'0'])]));
  const command={client_command_id:randomUUID(),canonical_item:canonical,expected_follow_version:version,following:true};
  const applied=await request(f,'/api/workbench/items/ticket/'+ticket.id+'/follow',{method:'POST',headers:{
   origin:f.origin,'content-type':'application/json','x-csrf-token':text(bootstrap.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"'+version+'"'
  },body:JSON.stringify(command)});
  assert.equal(applied.status,200,await applied.clone().text());assert.equal(object(await applied.json()).following,true);
 },{namespace:'ticket_card42a',manualProjection:true,workbenchSearchEnabled:true,workbenchFollowEnabled:true,workbenchManualReviewEnabled:true});
});
