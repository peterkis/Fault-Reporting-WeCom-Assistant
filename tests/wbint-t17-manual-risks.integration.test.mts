import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PilotPrincipal} from '../src/p1-009-pilot-access-workbench.mjs';
import type {ManualReportCommand} from '../contracts/workbench_manual_report_contracts.js';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
interface Fixture {origin:string;backendOrigin:string;pool:PostgresPool;principals:PilotPrincipal[];cookies:string[]}
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
