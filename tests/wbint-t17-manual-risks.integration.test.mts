import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool,PostgresPoolClient,PostgresQuery} from '../src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PilotPrincipal} from '../src/p1-009-pilot-access-workbench.mjs';
import type {ManualReportCommand} from '../contracts/workbench_manual_report_contracts.js';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
interface Fixture {origin:string;backendOrigin:string;pool:PostgresPool;principals:PilotPrincipal[];cookies:string[];sessionId:string}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
function command(description='合成电话报修：打印机无法打印'):ManualReportCommand{return {schema_version:1,client_command_id:randomUUID(),source:'PHONE',description,location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成实际报修人',contact:'人工联系4455',department:null}};}
function get(fixture:Fixture,path:string){return fetch(fixture.backendOrigin+path,{headers:{cookie:string(fixture.cookies[0])}});}
async function csrf(fixture:Fixture){const response=await get(fixture,'/api/lifecycle/bootstrap');assert.equal(response.status,200);return string(object(await response.json()).csrf_token);}
function post(fixture:Fixture,token:string,body:ManualReportCommand|Record<string,unknown>,headers:Record<string,string>={}){return fetch(fixture.backendOrigin+'/api/workbench/reports',{method:'POST',headers:{cookie:string(fixture.cookies[0]),origin:fixture.origin,'content-type':'application/json','idempotency-key':string(body.client_command_id),'x-csrf-token':token,...headers},body:JSON.stringify(body)});}
async function facts(pool:PostgresPool){const row=(await pool.query(`SELECT
  (SELECT count(*)::integer FROM intake.service_intake WHERE source_channel='MANUAL') AS intakes,
  (SELECT count(*)::integer FROM intake.contact_journey WHERE entry_mode='STAFF_MANUAL_REPORT') AS journeys,
  (SELECT count(*)::integer FROM intake.channel_leg WHERE leg_type='MANUAL_REPORT') AS legs,
  (SELECT count(*)::integer FROM intake.deterministic_decision WHERE source_kind='MANUAL') AS decisions,
  (SELECT count(*)::integer FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id WHERE i.source_channel='MANUAL') AS reviews,
  (SELECT count(*)::integer FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_channel='MANUAL') AS tickets,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_event e JOIN pilot_ticket.ticket t ON t.id=e.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_channel='MANUAL') AS ticket_events,
  (SELECT count(*)::integer FROM intake.service_intake_event e JOIN intake.service_intake i ON i.id=e.intake_id WHERE i.source_channel='MANUAL') AS intake_events,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_MANUAL_REPORT') AS receipts`)).rows[0];assert.ok(row);return row;}
async function conservation(pool:PostgresPool){const row=(await pool.query(`SELECT
  (SELECT count(*)::integer FROM channel.message_inbox) AS messages,(SELECT count(*)::integer FROM conversation.session) AS conversations,
  (SELECT count(*)::integer FROM communication.message) AS communications,(SELECT count(*)::integer FROM communication.outbox) AS outbox,
  (SELECT count(*)::integer FROM communication.delivery) AS deliveries,(SELECT count(*)::integer FROM notification.outbox) AS notifications,
  (SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries`)).rows[0];assert.ok(row);return row;}
const enabled={workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true};

for(const replay of [false,true])for(const loss of ['session','creation'] as const)test(`manual admission rechecks ${loss} authority after a receipt lock for ${replay?'the original UUID replay':'a new command'}`,async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),body=command();
    if(replay)assert.equal((await post(fixture,token,body)).status,202);
    const before=await facts(fixture.pool),blocker=await fixture.pool.connect();let pending:Promise<Response>|undefined;
    try{
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE pilot_ticket.ticket_command_receipt IN SHARE MODE');
      pending=post(fixture,token,body);
      let waiting=false;for(let attempt=0;attempt<200;attempt++){
        waiting=(await fixture.pool.query("SELECT 1 FROM pg_locks WHERE relation='pilot_ticket.ticket_command_receipt'::regclass AND NOT granted")).rowCount!==0;
        if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
      }assert.ok(waiting,'the actual receipt INSERT is waiting after the initial authorization');
      if(loss==='session')await fixture.pool.query("UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=platform.physical_epoch_ms(),revoked_at=platform.local_now() WHERE session_id=$1::uuid",[fixture.sessionId]);
      else{const actor=fixture.principals[0];assert.ok(actor);await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});}
      await blocker.query('ROLLBACK');const response=await pending;assert.equal(response.status,403,'authority lost while waiting must reject both admission and replay');
      assert.equal(object(object(await response.json()).error).code,'P2_016_FORBIDDEN');assert.deepEqual(await facts(fixture.pool),before);
    }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
  },enabled);
});

test('manual admission rolls back every business fact when logout finishes during the intake write wait',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),body=command(),before=await facts(fixture.pool),blocker=await fixture.pool.connect();assert.ok(typeof before.receipts==='number');let pending:Promise<Response>|undefined;
    try{
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE intake.service_intake IN SHARE MODE');pending=post(fixture,token,body);
      let waiting=false;for(let attempt=0;attempt<200;attempt++){
        waiting=(await fixture.pool.query("SELECT 1 FROM pg_locks WHERE relation='intake.service_intake'::regclass AND NOT granted")).rowCount!==0;
        if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
      }assert.ok(waiting,'the real intake INSERT is waiting inside the business savepoint');
      await fixture.pool.query("UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=platform.physical_epoch_ms(),revoked_at=platform.local_now() WHERE session_id=$1::uuid",[fixture.sessionId]);
      await blocker.query('ROLLBACK');const response=await pending;assert.equal(response.status,503);assert.equal(object(object(await response.json()).error).code,'P2_016_FORBIDDEN');
      const after=await facts(fixture.pool);assert.deepEqual({...after,receipts:before.receipts},before);assert.equal(after.receipts,before.receipts+1,'only the existing failed ledger receipt remains');
    }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
  },enabled);
});

test('manual admission rechecks creation authority after the final Session share-lock wait',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),body=command(),before=await facts(fixture.pool),intakeLock=await fixture.pool.connect(),sessionLock=await fixture.pool.connect();let pending:Promise<Response>|undefined;
    try{
      await intakeLock.query('BEGIN');await intakeLock.query('LOCK TABLE intake.service_intake IN SHARE MODE');pending=post(fixture,token,body);
      let waiting=false;for(let attempt=0;attempt<200;attempt++){waiting=(await fixture.pool.query("SELECT 1 FROM pg_locks WHERE relation='intake.service_intake'::regclass AND NOT granted")).rowCount!==0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(waiting);
      await sessionLock.query('BEGIN');await sessionLock.query('SELECT session_id FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid FOR UPDATE',[fixture.sessionId]);await intakeLock.query('ROLLBACK');
      waiting=false;for(let attempt=0;attempt<200;attempt++){waiting=(await fixture.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM pilot_ticket.workbench_auth_session%' AND query LIKE '%FOR SHARE%'")).rowCount!==0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(waiting,'the actual final Session FOR SHARE is waiting');
      const actor=fixture.principals[0];assert.ok(actor);await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
      await sessionLock.query('ROLLBACK');const response=await pending;assert.equal(response.status,503);assert.equal(object(object(await response.json()).error).code,'P2_016_FORBIDDEN');
      const after=await facts(fixture.pool);assert.deepEqual({...after,receipts:before.receipts},before);assert.equal((await fixture.pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[fixture.sessionId])).rows[0]?.state,'ACTIVE');
    }finally{await intakeLock.query('ROLLBACK');await sessionLock.query('ROLLBACK');intakeLock.release();sessionLock.release();await pending?.catch(()=>{});}
  },enabled);
});

test('original unverified replay rechecks creation authority across its final Session read wait',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),body=command();assert.equal((await post(fixture,token,body)).status,202);
    const before=await facts(fixture.pool),receiptLock=await fixture.pool.connect(),sessionLock=await fixture.pool.connect();let pending:Promise<Response>|undefined;
    try{
      await receiptLock.query('BEGIN');await receiptLock.query('LOCK TABLE pilot_ticket.ticket_command_receipt IN SHARE MODE');pending=post(fixture,token,body);
      let waiting=false;for(let attempt=0;attempt<200;attempt++){waiting=(await fixture.pool.query("SELECT 1 FROM pg_locks WHERE relation='pilot_ticket.ticket_command_receipt'::regclass AND NOT granted")).rowCount!==0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(waiting);
      await sessionLock.query('BEGIN');await sessionLock.query('LOCK TABLE pilot_ticket.workbench_auth_session IN ACCESS EXCLUSIVE MODE');await receiptLock.query('ROLLBACK');
      waiting=false;for(let attempt=0;attempt<200;attempt++){waiting=(await fixture.pool.query("SELECT 1 FROM pg_locks WHERE relation='pilot_ticket.workbench_auth_session'::regclass AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")).rowCount!==0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(waiting,'the replay is waiting in its last Session read after the creation check');
      const actor=fixture.principals[0];assert.ok(actor);await fixture.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[actor.id]);await fixture.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[actor.id]);await fixture.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[actor.id]);
      await sessionLock.query('ROLLBACK');const response=await pending;assert.equal(response.status,403);assert.equal(object(object(await response.json()).error).code,'P2_016_FORBIDDEN');assert.deepEqual(await facts(fixture.pool),before);
      assert.equal((await fixture.pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[fixture.sessionId])).rows[0]?.state,'ACTIVE');
    }finally{await receiptLock.query('ROLLBACK');await sessionLock.query('ROLLBACK');receiptLock.release();sessionLock.release();await pending?.catch(()=>{});}
  },enabled);
});

test('manual receipt rechecks creation authority across its final Session query result wait',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),body=command();assert.equal((await post(fixture,token,body)).status,202);
    const path='/api/workbench/reports/commands/'+body.client_command_id;assert.equal((await get(fixture,path)).status,200);
    const before=await facts(fixture.pool),originals=new Map<PostgresPoolClient,PostgresQuery>();let resume=()=>{},reached=false,pending:Promise<Response>|undefined;
    const gate=new Promise<void>(resolve=>{resume=resolve;});
    const observe=(client:PostgresPoolClient)=>{
      if(originals.has(client))return;const original=client.query;originals.set(client,original);let receiptRead=false;
      client.query=new Proxy(original,{apply(target,thisArg,args:unknown[]){
        const result:unknown=Reflect.apply(target,thisArg,args),sql=args[0];if(!(result instanceof Promise)||typeof sql!=='string')return result;
        return result.then(async rows=>{
          if(sql.includes('result_snapshot AS result')&&sql.includes("command_type='WORKBENCH_MANUAL_REPORT'"))receiptRead=true;
          else if(receiptRead&&!reached&&sql.includes('FROM pilot_ticket.workbench_auth_session')){reached=true;await gate;}
          return rows;
        });
      }});
    };
    fixture.pool.on('acquire',observe);
    try{
      pending=get(fixture,path);for(let attempt=0;!reached&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(reached,'the actual receipt read completed before its last Session result wait');
      const actor=fixture.principals[0];assert.ok(actor);await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
      resume();const response=await pending;assert.equal(response.status,403);const denied=object(await response.json());assert.equal(object(denied.error).code,'P2_016_FORBIDDEN');assert.equal(denied.result,undefined);assert.deepEqual(await facts(fixture.pool),before);
      assert.equal((await fixture.pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[fixture.sessionId])).rows[0]?.state,'ACTIVE');
    }finally{resume();await pending?.catch(()=>{});fixture.pool.removeListener('acquire',observe);for(const [client,original]of originals)client.query=original;}
  },enabled);
});

test('default-off manual entry rejects its purpose without 033/042 storage and preserves ordinary authorized workbench reads',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),authority=object(await(await get(fixture,'/api/lifecycle/bootstrap')).json());assert.equal(authority.manual_reports_enabled,false);assert.equal(authority.manual_report_draft_recovery_enabled,false);
    assert.equal((await fixture.pool.query("SELECT count(*)::integer AS n FROM platform.schema_migration WHERE migration_id='042_workbench_manual_reports'")).rows[0]?.n,0);
    assert.equal((await fixture.pool.query("SELECT count(*)::integer AS n FROM information_schema.columns WHERE table_schema='intake' AND table_name='service_intake' AND column_name='manual_report_snapshot'")).rows[0]?.n,0);
    for(const response of [await get(fixture,'/api/workbench/reports/capabilities'),await post(fixture,token,command()),await get(fixture,'/api/workbench/reports/commands/'+randomUUID())]){assert.equal(response.status,503);assert.equal(object(object(await response.json()).error).code,'P2_016_DISABLED');}
    assert.equal((await get(fixture,'/api/workbench/board?column=pending&range=recent&limit=50')).status,200);
    assert.equal((await fixture.pool.query("SELECT count(*)::integer AS n FROM intake.service_intake WHERE source_channel='MANUAL'")).rows[0]?.n,0);
    assert.equal((await fixture.pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_MANUAL_REPORT'")).rows[0]?.n,0);
  },{realWorkbenchAuthentication:true});
});

test('current staff creation permission and closed input reject actor, member, receipt and request-forgery shortcuts before a manual admission',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),before=await facts(fixture.pool),actor=fixture.principals[0];assert.ok(actor);
    assert.equal((await post(fixture,token,command(),{cookie:''})).status,401);assert.equal((await post(fixture,token,command(),{'x-csrf-token':'invalid-synthetic'})).status,403);
    assert.equal((await post(fixture,token,command(),{origin:'https://not-the-fixture.invalid'})).status,403);
    const base=command();for(const body of [{...base,actor_principal_id:actor.id},{...base,reporter:{...base.reporter,verification:'VERIFIED'}},{...base,reporter:{...base.reporter,wecom_userid:'invented-receiver'}},
      {...base,description:'   '},{...base,reporter:{...base.reporter,contact:''}},{...base,reporter:{...base.reporter,name:'字'.repeat(101)}},{...base,description:'字'.repeat(4001)},
      {...base,location:{unknown:true,text:'不能同时假称已知位置'}},{...base,location:{unknown:false,text:null}}])assert.equal((await post(fixture,token,body)).status,400);
    assert.equal((await post(fixture,token,base,{'idempotency-key':randomUUID()})).status,400);assert.equal((await post(fixture,token,{...base,description:'x'.repeat(17*1024)})).status,413);
    const access=createPilotAccessService({pool:fixture.pool});await access.upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await get(fixture,'/api/lifecycle/bootstrap')).status,200);assert.equal((await get(fixture,'/api/workbench/reports/capabilities')).status,403);assert.equal((await post(fixture,token,command())).status,403);
    assert.equal((await get(fixture,'/api/workbench/reports/commands/'+randomUUID())).status,403);assert.deepEqual(await facts(fixture.pool),before);
    await access.upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});const admitted=await post(fixture,token,command());assert.equal(admitted.status,202);
    const result=object(await admitted.json()),row=(await fixture.pool.query<{actor:string;assignee:string|null}>('SELECT i.manual_actor_principal_id::text AS actor,t.assignee_id::text AS assignee FROM intake.service_intake i JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id WHERE i.id=$1::uuid',[string(result.intake_id)])).rows[0];assert.deepEqual(row,{actor:actor.id,assignee:null});
  },enabled);
});

test('missing current MANUAL migration proof fails capabilities and admission closed without starting a command receipt',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),before=await facts(fixture.pool);const removed=(await fixture.pool.query<{migration_id:string;checksum_sha256:string;applied_at:string;applied_epoch_ms:string}>("DELETE FROM platform.schema_migration WHERE migration_id='042_workbench_manual_reports' RETURNING migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text")).rows[0];assert.ok(removed);
    try{for(const response of [await get(fixture,'/api/workbench/reports/capabilities'),await post(fixture,token,command()),await get(fixture,'/api/workbench/reports/commands/'+randomUUID())])assert.equal(response.status,503);assert.deepEqual(await facts(fixture.pool),before);}
    finally{await fixture.pool.query('INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) VALUES($1,$2,$3::timestamp without time zone,$4::bigint)',[removed.migration_id,removed.checksum_sha256,removed.applied_at,removed.applied_epoch_ms]);}
    assert.equal((await get(fixture,'/api/workbench/reports/capabilities')).status,200);
  },enabled);
});

test('two real concurrent contenders with one command UUID create one source and Core aggregate, while changed intent conflicts instead of replacing it',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),input=command(),before=await conservation(fixture.pool),responses=await Promise.all([post(fixture,token,input),post(fixture,token,input)]);assert.deepEqual(responses.map(response=>response.status).sort(),[200,202]);
    const results=await Promise.all(responses.map(async response=>object(await response.json())));assert.equal(results[0]?.intake_id,results[1]?.intake_id);assert.deepEqual(results[0]?.ticket,results[1]?.ticket);assert.deepEqual(results.map(result=>result.replayed).sort(),[false,true]);
    const counts=await facts(fixture.pool);for(const key of ['intakes','journeys','legs','decisions','tickets','ticket_events','receipts'])assert.equal(counts[key],1,key);assert.equal(counts.reviews,0);
    assert.equal((await post(fixture,token,{...input,description:input.description+'，不同的新意图'})).status,409);assert.deepEqual(await facts(fixture.pool),counts);
    const read=await get(fixture,'/api/workbench/reports/commands/'+input.client_command_id);assert.equal(read.status,200);const receipt=object(await read.json());assert.equal(receipt.state,'COMMITTED');assert.equal(object(receipt.result).replayed,true);
    const snapshot=(await fixture.pool.query<{description:string}>('SELECT manual_report_snapshot->>\'description\' AS description FROM intake.service_intake WHERE id=$1::uuid',[string(results[0]?.intake_id)])).rows[0];assert.equal(snapshot?.description,input.description);assert.deepEqual(await conservation(fixture.pool),before);
  },enabled);
});

test('a real final Ticket Event database failure rolls back the complete manual source graph and Core facts while retaining only the same ledger FAILED result',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),input=command(),before=await facts(fixture.pool),communication=await conservation(fixture.pool);
    await fixture.pool.query(`CREATE FUNCTION pilot_ticket.t17_fail_manual_created_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF EXISTS(SELECT 1 FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=NEW.ticket_id AND i.source_channel='MANUAL') THEN RAISE EXCEPTION 'T17_SYNTHETIC_CREATED_EVENT_FAILURE';END IF;RETURN NEW;END$$`);
    await fixture.pool.query('CREATE TRIGGER t17_manual_created_event BEFORE INSERT ON pilot_ticket.ticket_event FOR EACH ROW EXECUTE FUNCTION pilot_ticket.t17_fail_manual_created_event()');
    try{
      const rejected=await post(fixture,token,input);assert.equal(rejected.status,503);const failure=object(await rejected.json());assert.equal(failure.ok,false);assert.equal(failure.replayed,false);assert.deepEqual(failure.error,{code:'P2_016_ACTION_FAILED',retryable:false});
      const after=await facts(fixture.pool);assert.deepEqual({...after,receipts:before.receipts},before);assert.equal(after.receipts,1);const read=await get(fixture,'/api/workbench/reports/commands/'+input.client_command_id);assert.equal(read.status,200);assert.deepEqual(await read.json(),{client_command_id:input.client_command_id,state:'FAILED',error:{code:'P2_016_ACTION_FAILED',retryable:false}});
      assert.deepEqual(await conservation(fixture.pool),communication);
    }finally{await fixture.pool.query('DROP TRIGGER t17_manual_created_event ON pilot_ticket.ticket_event');await fixture.pool.query('DROP FUNCTION pilot_ticket.t17_fail_manual_created_event()');}
    const replay=await post(fixture,token,input);assert.equal(replay.status,503);assert.equal(object(await replay.json()).replayed,true);assert.equal((await facts(fixture.pool)).intakes,0);
    const explicitNew=await post(fixture,token,{...input,client_command_id:randomUUID()});assert.equal(explicitNew.status,202);assert.equal((await facts(fixture.pool)).intakes,1);assert.equal((await facts(fixture.pool)).receipts,2);
    assert.deepEqual(await conservation(fixture.pool),communication);
  },enabled);
});

test('every permitted genuine MANUAL Review conclusion preserves original evidence and avoids Communication, a fabricated channel and automatic ownership',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const token=await csrf(fixture),before=await conservation(fixture.pool),codes=['CONFIRM_TICKET_ELIGIBLE','CLASSIFY_SERVICE_REQUEST','REQUEST_DESCRIPTION','CLASSIFY_BUSINESS_CONSULTATION','ACKNOWLEDGE','MARK_OUT_OF_SCOPE','KEEP_INCIDENT_REVIEW_CANDIDATE','CANCEL_REVIEW'];
    let created=0;for(const resolution of codes){
      const input={...command('合成现场情况不明，请人工核对'),source:'ON_SITE' as const},admitted=await post(fixture,token,input);assert.equal(admitted.status,202);const admission=object(await admitted.json());assert.equal(admission.ticket,null);const id=string(object(admission.review).id),original=await get(fixture,'/api/manual-reviews/'+id);assert.equal(original.status,200);const detail=object(await original.json());assert.ok(Array.isArray(detail.allowed_resolutions)&&detail.allowed_resolutions.includes(resolution));
      const body={client_command_id:randomUUID(),expected_row_version:string(detail.row_version),expected_material_basis:string(object(detail.material_basis).current_hash),resolution_code:resolution,resolution_reason_code:'T17_HUMAN_CONFIRMED'};
      const resolved=await fetch(fixture.backendOrigin+'/api/manual-reviews/'+id+'/resolve',{method:'POST',headers:{cookie:string(fixture.cookies[0]),origin:fixture.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"','x-csrf-token':token},body:JSON.stringify(body)});assert.equal(resolved.status,200,await resolved.clone().text());
      const current=object(await(await get(fixture,'/api/manual-reviews/'+id)).json());assert.equal(current.status,resolution==='CANCEL_REVIEW'?'CANCELLED':'RESOLVED');assert.deepEqual(current.safe_result,detail.safe_result);assert.deepEqual(current.manual_report,detail.manual_report);assert.deepEqual(current.allowed_resolutions,[]);
      const intake=(await fixture.pool.query<{ticket:string|null;status:string;request_type:string}>('SELECT pilot_ticket_id::text AS ticket,status,request_type FROM intake.service_intake WHERE id=$1::uuid',[string(admission.intake_id)])).rows[0];assert.ok(intake);if(resolution==='CONFIRM_TICKET_ELIGIBLE'||resolution==='CLASSIFY_SERVICE_REQUEST'){assert.ok(intake.ticket);assert.equal(intake.request_type,resolution==='CLASSIFY_SERVICE_REQUEST'?'SERVICE_REQUEST':'INCIDENT');created++;const ticket=(await fixture.pool.query<{status:string;assignee:string|null}>('SELECT status,assignee_id::text AS assignee FROM pilot_ticket.ticket WHERE id=$1::uuid',[intake.ticket])).rows[0];assert.deepEqual(ticket,{status:'QUEUED',assignee:null});}else assert.equal(intake.ticket,null,resolution);
      assert.deepEqual(await conservation(fixture.pool),before,resolution);
    }
    assert.equal(created,2);const counts=await facts(fixture.pool);assert.equal(counts.intakes,8);assert.equal(counts.journeys,8);assert.equal(counts.legs,8);assert.equal(counts.reviews,8);assert.equal(counts.tickets,2);
  },enabled);
});

test('valid non-BMP report text is retained exactly and bounded Core excerpts do not manufacture replacement characters',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const prefix='打印机无法打印 ',description=prefix+'字'.repeat(199-prefix.length)+'𠮷'+'字'.repeat(298)+'𠮷原始描述',input=command(description),admitted=await post(fixture,await csrf(fixture),input);assert.equal(admitted.status,202);
    const result=object(await admitted.json()),row=(await fixture.pool.query<{title:string;summary:string;description:string}>('SELECT t.title,i.summary,i.manual_report_snapshot->>\'description\' AS description FROM intake.service_intake i JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id WHERE i.id=$1::uuid',[string(result.intake_id)])).rows[0];assert.ok(row);assert.equal(row.description,description);assert.ok(!row.title.includes('\uFFFD'),'a valid reporter character cannot become a replacement character in the Core title');assert.ok(!row.summary.includes('\uFFFD'),'a valid reporter character cannot become a replacement character in the Intake excerpt');assert.ok(row.title.length<=200);assert.ok(row.summary.length<=500);
  },enabled);
});
