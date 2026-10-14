import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {followSchemaReady,migrateWorkbenchFollow} from '../scripts/workbench-follow-migrate.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {WorkbenchFollowCommand} from '../contracts/workbench_item_follow_contracts.js';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {migrateTicketSelfHandling} from '../scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketReopenRounds} from '../scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../scripts/bot-reporter-feedback-migrate.mjs';
interface Fixture {runtime:P2016EnabledRuntime;pool:PostgresPool;databaseUrl:string;origin:string;cookies:string[];principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string}}[];processReviewIntake:(id:string)=>Promise<unknown>}
function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
function text(v:unknown):string{assert.equal(typeof v,'string');return v as string;}
function rows(v:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(v));return v.map(object);}
function client(f:Fixture,actor=2){
 const get=(path:string)=>fetch(f.origin+path,{headers:{cookie:f.cookies[actor]}});
 const read=async(path:string)=>{const r=await get(path);assert.equal(r.status,200,await r.clone().text());return object(await r.json());};
 const post=(path:string,body:WorkbenchFollowCommand,csrf:unknown,headers:Record<string,string>={})=>fetch(f.origin+path+'/follow',{method:'POST',headers:{cookie:f.cookies[actor],origin:f.origin,'content-type':'application/json','x-csrf-token':text(csrf),'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_follow_version+'"',...headers},body:JSON.stringify(body)});
 return {get,read,post};
}
function command(detail:Record<string,unknown>,following:boolean):WorkbenchFollowCommand{
 const item=object(detail.item),attention=object(item.attention),kind=item.kind;assert.ok(kind==='ticket'||kind==='review'||kind==='intake');
 return {client_command_id:randomUUID(),canonical_item:{kind,id:text(item.id)},expected_follow_version:text(attention.follow_version),following};
}
async function facts(f:Fixture){return (await f.pool.query(`SELECT
 (SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS events,
 (SELECT count(*)::integer FROM conversation.assignment) AS assignments,
 (SELECT count(*)::integer FROM communication.outbox) AS communication,
 (SELECT count(*)::integer FROM notification.outbox) AS notifications`)).rows[0];}

test('T34 default OFF keeps the existing host ready without 044 or follow SQL',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const http=client(f),target=f.tickets[1];assert.ok(target);const path='/api/workbench/items/ticket/'+target.ticket.id;
  const bootstrap=await http.read('/api/lifecycle/bootstrap');assert.equal(bootstrap.workbench_follow_enabled,false);assert.equal(bootstrap.workbench_follow_draft_recovery_enabled,false);
  const detail=await http.read(path);assert.equal(Object.hasOwn(object(detail.item),'attention'),false);
  assert.equal((await http.get('/api/workbench/board?column=pending&scope=related')).status,400);
  assert.equal((await http.get(path+'/follow/commands/'+randomUUID())).status,404);
  assert.equal((await f.pool.query("SELECT to_regclass('pilot_ticket.workbench_item_follow') AS relation")).rows[0]?.relation,null);
  const initial=await f.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/f.runtime.coordinator.batchSize)+3;
  let drained=false;for(let step=0;step<bound;step++){const result=await f.runtime.coordinator.runOnce();assert.ok(result.streams.every(stream=>stream.failures.length===0));const remaining=await f.runtime.coordinator.backlog();if(result.processed===0&&remaining.total===0){drained=true;break;}}
  assert.equal(drained,true,'the existing host requires the actual fixture projection to finish before readiness');
  const ready=await fetch(f.origin+'/health/ready');assert.equal(ready.status,200);
 },{chronologicalTicketEvents:true});
});

test('T34 explicit intent uses exact HTTP fences and concurrent CAS, with caller-only receipts and current READ before replay',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const http=client(f),target=f.tickets[1],principal=f.principals[1];assert.ok(target&&principal);
  const path='/api/workbench/items/ticket/'+target.ticket.id,bootstrap=await http.read('/api/lifecycle/bootstrap'),before=await facts(f),initial=command(await http.read(path),true);
  assert.equal(bootstrap.workbench_follow_enabled,true);assert.equal(bootstrap.workbench_follow_draft_recovery_enabled,false,'Follow is available independently of optional browser recovery');
  for(const [headers,status] of [[{'idempotency-key':randomUUID()},400],[{'if-match':'"'+ '0'.repeat(64)+'"'},409],[{'x-csrf-token':'invalid'},403],[{origin:'https://attacker.invalid'},403]] as const)
   assert.equal((await http.post(path,initial,bootstrap.csrf_token,headers)).status,status);
  assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.workbench_item_follow')).rows[0]?.n,0);
  const competing={...initial,client_command_id:randomUUID()},results=await Promise.all([http.post(path,initial,bootstrap.csrf_token),http.post(path,competing,bootstrap.csrf_token)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results[0]?.status===200?initial:competing;
  const receipt=await http.read(path+'/follow/commands/'+winner.client_command_id);assert.equal(receipt.state,'COMMITTED');
  assert.equal((await http.post(path,winner,bootstrap.csrf_token)).status,200);
  assert.equal((await http.post(path,{...winner,following:false},bootstrap.csrf_token)).status,409);
  assert.equal((await client(f,0).read(path+'/follow/commands/'+winner.client_command_id)).state,'UNKNOWN');
  assert.deepEqual(await facts(f),before);
  await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'合成已转出人员',roles:['HANDLER'],resolverTeamIds:[]});
  for(const response of [await http.get(path),await http.get(path+'/follow/commands/'+winner.client_command_id),await http.post(path,winner,bootstrap.csrf_token)])assert.equal(response.status,404);
  assert.equal(rows((await http.read('/api/workbench/board?column=pending&scope=related')).items).some(item=>item.id===target.ticket.id),false);
  assert.deepEqual(await facts(f),before);
 },{workbenchFollowEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});

test('T34 exact readiness rejects weakened follow CHECK, changed migration checksum, and shared receipt resource CHECK true',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  assert.equal(await followSchemaReady(f.pool),true);assert.equal((await migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'status'})).status,'NOOP_ALREADY_APPLIED');
  const tx=await f.pool.connect();try{
   await tx.query('BEGIN');await tx.query('ALTER TABLE pilot_ticket.workbench_item_follow DROP CONSTRAINT workbench_item_follow_row_version_check');
   await tx.query('ALTER TABLE pilot_ticket.workbench_item_follow ADD CONSTRAINT workbench_item_follow_row_version_check CHECK(true)');
   assert.equal(await followSchemaReady(tx),false);await tx.query('ROLLBACK');
   await tx.query('BEGIN');await tx.query("UPDATE platform.schema_migration SET checksum_sha256=repeat('0',64) WHERE migration_id='044_workbench_item_follow'");
   assert.equal(await followSchemaReady(tx),false);await tx.query('ROLLBACK');
   await tx.query('BEGIN');await tx.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource');
   await tx.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource CHECK(true)');
   assert.equal(await followSchemaReady(tx),false,'the new source-anchored purpose still requires the exact existing receipt resource fence');await tx.query('ROLLBACK');
   for(const change of [
    'ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_identity',
    'ALTER TABLE pilot_ticket.ticket_command_receipt ALTER COLUMN expected_session_version TYPE integer',
    'DROP INDEX pilot_ticket.p2016_command_actor_idx',
   ]){await tx.query('BEGIN');await tx.query(change);assert.equal(await followSchemaReady(tx),false,'receipt identity, column shape and indexes are part of readiness');await tx.query('ROLLBACK');}
  }finally{await tx.query('ROLLBACK').catch(()=>{});tx.release();}
  for(const migrate of [migrateTicketSelfHandling,migrateTicketStaffCompletion,migrateTicketReopenRounds,migrateBotReporterFeedback])await migrate({databaseUrl:f.databaseUrl,mode:'apply'});
  assert.equal(await followSchemaReady(f.pool),true,'the complete existing 050 actor-purpose guard is a legal optional predecessor');
  assert.equal((await migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'status'})).status,'NOOP_ALREADY_APPLIED');
  const botTx=await f.pool.connect();try{
   await botTx.query('BEGIN');await botTx.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT bot_feedback_actor_purpose');
   await botTx.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT bot_feedback_actor_purpose CHECK(true)');
   assert.equal(await followSchemaReady(botTx),false,'optional Reporter support cannot weaken its full actor-purpose fence');
  }finally{await botTx.query('ROLLBACK');botTx.release();}
  // Reapply only this capability in the owned isolated database. The original
  // predecessor tables and SQL remain in place throughout check/apply/NOOP.
  await f.pool.query("DELETE FROM platform.schema_migration WHERE migration_id='044_workbench_item_follow'");
  await f.pool.query('DROP TABLE pilot_ticket.workbench_item_follow');
  assert.equal((await migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');
  assert.equal((await f.pool.query("SELECT to_regclass('pilot_ticket.workbench_item_follow') AS relation")).rows[0]?.relation,null);
  assert.equal((await migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'apply'})).status,'APPLIED');
  assert.equal((await migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
 },{workbenchFollowEnabled:true,manualProjection:true});
});

test('T34 a historical UUID waiting on its actual receipt lock rechecks the current caller READ before replay',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const http=client(f),target=f.tickets[1],principal=f.principals[1];assert.ok(target&&principal);
  const path='/api/workbench/items/ticket/'+target.ticket.id,bootstrap=await http.read('/api/lifecycle/bootstrap'),original=command(await http.read(path),true);
  assert.equal((await http.post(path,original,bootstrap.csrf_token)).status,200);
  const tx=await f.pool.connect();let pending:Promise<Response>|undefined;
  try{
   await tx.query('BEGIN');await tx.query('SELECT id FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE',['P2_016:'+principal.id,original.client_command_id]);
   pending=http.post(path,original,bootstrap.csrf_token);
   let waiting=false;
   for(let i=0;i<100;i++){
    waiting=(await f.pool.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query ILIKE '%ticket_command_receipt%') AS waiting")).rows[0]?.waiting===true;
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,50));
   }
   assert.equal(waiting,true,'the same principal command must reach the real receipt wait before authority is changed');
   await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);
   await tx.query('COMMIT');assert.equal((await pending).status,404,'an old command cannot replay using the grant checked before the wait');
   assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND state=\'COMMITTED\'',['P2_016:'+principal.id,original.client_command_id])).rows[0]?.n,1);
  }finally{await tx.query('ROLLBACK').catch(()=>{});tx.release();await pending?.catch(()=>{});}
 },{workbenchFollowEnabled:true,manualProjection:true});
});

test('T34 Review conversion preserves the original UUID, canonical de-duplication and every current caller anchor cancel fence',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const http=client(f,0),source=await seedPersistedIntake({pool:f.pool,text:'T34 独立合成待复核报修。'});await f.processReviewIntake(source.intakeId);
  const review=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[source.intakeId])).rows[0];assert.ok(review);
  const alias='/api/workbench/items/review/'+review.id,bootstrap=await http.read('/api/lifecycle/bootstrap'),original=command(await http.read(alias),true);
  assert.equal((await http.post(alias,original,bootstrap.csrf_token)).status,200);
  const context=await http.read('/api/manual-reviews/'+review.id),resolution={client_command_id:randomUUID(),expected_row_version:context.row_version,expected_material_basis:object(context.material_basis).current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'EXPLICIT_HUMAN_CHOICE'};
  const resolved=await fetch(f.origin+'/api/manual-reviews/'+review.id+'/resolve',{method:'POST',headers:{cookie:f.cookies[0],origin:f.origin,'content-type':'application/json','x-csrf-token':text(bootstrap.csrf_token),'idempotency-key':resolution.client_command_id,'if-match':'"'+text(resolution.expected_row_version)+'"'},body:JSON.stringify(resolution)});assert.equal(resolved.status,200,await resolved.clone().text());
  const converted=await http.read(alias),ticket=object(converted.item);assert.equal(ticket.kind,'ticket');assert.equal(object(ticket.attention).following,true);
  assert.equal((await http.post(alias,original,bootstrap.csrf_token)).status,200,'the original alias intent replays after authorized canonical conversion');
  const currentPath='/api/workbench/items/ticket/'+text(ticket.id),secondSource=await seedPersistedIntake({pool:f.pool,text:'T34 第二个实际源锚点。'});await f.processReviewIntake(secondSource.intakeId);
  const second=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[secondSource.intakeId])).rows[0];assert.ok(second);
  const secondPath='/api/workbench/items/review/'+second.id,secondCommand=command(await http.read(secondPath),true);assert.equal((await http.post(secondPath,secondCommand,bootstrap.csrf_token)).status,200);
  // Test-owned actual source links, with no duplicate ownership or synthetic Follow projection.
  await f.pool.query('UPDATE intake.manual_review_item SET linked_ticket_id=$2::uuid WHERE id=$1::uuid',[second.id,ticket.id]);
  await f.pool.query('UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)',[second.id,ticket.id]);
  const related=rows((await http.read('/api/workbench/board?column=pending&scope=related')).items);assert.equal(related.filter(item=>item.id===ticket.id).length,1);assert.equal(related.some(item=>item.id===second.id),false);
  const cancel=command(await http.read(currentPath),false);assert.equal((await http.post(currentPath,cancel,bootstrap.csrf_token)).status,200);
  assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.workbench_item_follow WHERE principal_id=$1::uuid AND following AND source_intake_id=ANY($2::uuid[])',[f.principals[0]?.id,[source.intakeId,secondSource.intakeId]])).rows[0]?.n,0);
  await f.pool.query('UPDATE intake.manual_review_item SET linked_ticket_id=NULL WHERE id=$1::uuid',[second.id]);await f.pool.query('UPDATE intake.contact_journey SET linked_ticket_id=NULL WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)',[second.id]);
  assert.equal(object(object((await http.read(secondPath)).item).attention).following,false,'unlinking the old Review must not resurrect an already cancelled caller anchor');
  assert.equal((await http.post(alias,original,bootstrap.csrf_token)).status,200,'historical replay acknowledges the earlier result without re-following');
  assert.equal(object(object((await http.read(currentPath)).item).attention).following,false);
 },{workbenchFollowEnabled:true,workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});

test('T34 a real communication transfer removes only responsibility, while explicit caller follow remains until cancelled',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const http=client(f),admin=client(f,0),target=f.tickets[0],next=f.principals[0];assert.ok(target&&next);
  const backlog=await f.runtime.coordinator.backlog(),bound=Math.ceil(backlog.total/f.runtime.coordinator.batchSize)+3;
  let drained=false;for(let i=0;i<bound;i++){const result=await f.runtime.coordinator.runOnce();assert.ok(result.streams.every(stream=>stream.failures.length===0));if(result.processed===0&&(await f.runtime.coordinator.backlog()).total===0){drained=true;break;}}assert.equal(drained,true);
  const path='/api/workbench/items/ticket/'+target.ticket.id,bootstrap=await http.read('/api/lifecycle/bootstrap');
  assert.equal(rows((await http.read('/api/workbench/board?column=pending&scope=related')).items).length,0,'ordinary reads and visibility never add personal attention');
  const context=rows((await http.read('/api/tickets/'+target.ticket.id+'/related-conversations')).items)[0];assert.ok(context);
  const sessionId=text(context.session_id),control=async(action:string,rowVersion:unknown,extra:Record<string,unknown>={})=>{
   const body={client_command_id:randomUUID(),expected_row_version:Number(rowVersion),reason_code:'T34_EXPLICIT_COMMUNICATION',...extra};
   assert.ok(Number.isSafeInteger(body.expected_row_version)&&body.expected_row_version>=1);
   const response=await fetch(f.origin+'/api/conversations/'+sessionId+'/'+action,{method:'POST',headers:{cookie:f.cookies[2],origin:f.origin,'content-type':'application/json','x-csrf-token':text(bootstrap.csrf_token),'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"'},body:JSON.stringify(body)});
   assert.equal(response.status,200,await response.clone().text());return object(await response.json());
  };
  await control('takeover',context.session_row_version);
  const communicating=await http.read(path);assert.deepEqual(object(object(communicating.item).attention).related_reasons,['COMMUNICATION']);
  const explicit=command(communicating,true);assert.equal((await http.post(path,explicit,bootstrap.csrf_token)).status,200);
  const current=rows((await http.read('/api/tickets/'+target.ticket.id+'/related-conversations')).items)[0];assert.ok(current);
  await control('transfer',current.session_row_version,{target_principal_id:next.id});
  const transferred=await http.read(path);assert.deepEqual(object(object(transferred.item).attention).related_reasons,['FOLLOW']);
  assert.equal(rows((await http.read('/api/workbench/board?column=pending&scope=related')).items).filter(item=>item.id===target.ticket.id).length,1);
  const cancel=command(transferred,false);assert.equal((await http.post(path,cancel,bootstrap.csrf_token)).status,200);
  assert.equal(rows((await http.read('/api/workbench/board?column=pending&scope=related')).items).some(item=>item.id===target.ticket.id),false);
  assert.equal(object(object((await http.read(path)).item).attention).following,false);
  assert.equal((await admin.read('/api/tickets/'+target.ticket.id)).assignee_id,null,'communication and personal attention never give Ticket handling ownership');
 },{ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true,chronologicalTicketEvents:true,manualProjection:true,workbenchFollowEnabled:true});
});

test('T34 readiness and migration NOOP reject the actual active index when invalid or not ready',async t=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  for(const attribute of ['indisvalid','indisready'] as const){
   const changed=await f.pool.query<{indisvalid:boolean;indisready:boolean}>(`UPDATE pg_index SET ${attribute}=false WHERE indexrelid=to_regclass('pilot_ticket.workbench_item_follow_active_idx') AND indrelid=to_regclass('pilot_ticket.workbench_item_follow') RETURNING indisvalid,indisready`);
   assert.equal(changed.rowCount,1);assert.equal(changed.rows[0]?.[attribute],false);
   t.diagnostic('T34_ACTUAL_OWNED_INDEX_STATE '+JSON.stringify({attribute,...changed.rows[0]}));
   try{
    assert.equal(await followSchemaReady(f.pool),false,'the active index definition alone cannot prove a valid, ready index');
    await assert.rejects(migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'status'}),{code:'P2_016_ACTION_FAILED'});
   }finally{await f.pool.query(`UPDATE pg_index SET ${attribute}=true WHERE indexrelid=to_regclass('pilot_ticket.workbench_item_follow_active_idx') AND indrelid=to_regclass('pilot_ticket.workbench_item_follow')`);}
  }
  assert.equal(await followSchemaReady(f.pool),true);
 },{workbenchFollowEnabled:true,manualProjection:true});
});

test('T34 a non-durable Follow relation is refused by readiness and migration status',async t=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  await f.pool.query('ALTER TABLE pilot_ticket.workbench_item_follow SET UNLOGGED');
  try{
   const relation=(await f.pool.query("SELECT relkind,relpersistence,relispartition FROM pg_class WHERE oid=to_regclass('pilot_ticket.workbench_item_follow')")).rows[0];
   assert.equal(relation?.relpersistence,'u');t.diagnostic('T34_ACTUAL_OWNED_RELATION '+JSON.stringify(relation));
   assert.equal(await followSchemaReady(f.pool),false,'a marker and matching columns cannot certify a non-durable personal fact');
   await assert.rejects(migrateWorkbenchFollow({databaseUrl:f.databaseUrl,mode:'status'}),{code:'P2_016_ACTION_FAILED'});
  }finally{await f.pool.query('ALTER TABLE pilot_ticket.workbench_item_follow SET LOGGED');}
 },{workbenchFollowEnabled:true,manualProjection:true});
});

test('T34 an actual write-suppressing trigger cannot produce a successful Follow acknowledgement',async t=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const http=client(f),target=f.tickets[1];assert.ok(target);const path='/api/workbench/items/ticket/'+target.ticket.id;
  const bootstrap=await http.read('/api/lifecycle/bootstrap'),original=command(await http.read(path),true);
  await f.pool.query('CREATE FUNCTION pilot_ticket.t34_suppress_follow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$');
  await f.pool.query('CREATE TRIGGER t34_suppress_follow BEFORE INSERT OR UPDATE ON pilot_ticket.workbench_item_follow FOR EACH ROW EXECUTE FUNCTION pilot_ticket.t34_suppress_follow()');
  try{
   const response=await http.post(path,original,bootstrap.csrf_token),body:unknown=await response.json();
   t.diagnostic('T34_ACTUAL_SUPPRESSED_WRITE_ACK '+JSON.stringify({status:response.status,body}));
   assert.equal(response.status,503,'catalog drift must fail closed before an unfulfilled intent is acknowledged');
   assert.equal(await followSchemaReady(f.pool),false);
   assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.workbench_item_follow')).rows[0]?.n,0);
   assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_ITEM_FOLLOW' AND state='COMMITTED'")).rows[0]?.n,0);
  }finally{await f.pool.query('DROP TRIGGER t34_suppress_follow ON pilot_ticket.workbench_item_follow');await f.pool.query('DROP FUNCTION pilot_ticket.t34_suppress_follow()');}
 },{workbenchFollowEnabled:true,manualProjection:true});
});
