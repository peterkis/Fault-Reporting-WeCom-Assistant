import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
interface Fixture {origin:string;cookies:string[];pool:PostgresPool;principals:{id:string}[]}
interface Conservation {messages:number;conversations:number;communications:number;communication_outbox:number;deliveries:number;notifications:number;notification_deliveries:number;tickets:number}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
async function conservation(pool:PostgresPool){
  const result=(await pool.query<Conservation>(`SELECT
    (SELECT count(*)::integer FROM channel.message_inbox) AS messages,
    (SELECT count(*)::integer FROM conversation.session) AS conversations,
    (SELECT count(*)::integer FROM communication.message) AS communications,
    (SELECT count(*)::integer FROM communication.outbox) AS communication_outbox,
    (SELECT count(*)::integer FROM communication.delivery) AS deliveries,
    (SELECT count(*)::integer FROM notification.outbox) AS notifications,
    (SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries,
    (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets`)).rows[0];assert.ok(result);return result;
}

test('an unresolved genuine on-site report exposes its own retained MANUAL material and permits lawful Review acknowledgement without communication',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool,principals}:Fixture)=>{
    const cookie=cookies[0],actor=principals[0];assert.ok(cookie);assert.ok(actor);
    const get=(path:string)=>fetch(origin+path,{headers:{cookie}});
    const bootstrapResponse=await get('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);
    const csrf=string(object(await bootstrapResponse.json()).csrf_token),before=await conservation(pool);
    const command={schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'合成现场代录：打印机情况不明',
      location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成现场报修人',contact:'现场人工联系',department:null}};
    const admitted=await fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
      'idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
    assert.equal(admitted.status,202,await admitted.clone().text());const result=object(await admitted.json());
    assert.equal(result.result_code,'NEEDS_DESCRIPTION');assert.equal(result.ticket,null);
    const reviewResult=object(result.review),reviewId=string(reviewResult.id);assert.equal(reviewResult.status,'PENDING');
    const intakeId=string(result.intake_id),stored=(await pool.query<{source_channel:string;source_provider:string;manual_actor_principal_id:string;manual_report_snapshot:unknown;reporter_wecom_userid:string|null;source_bot_id:string|null;source_chat_type:string|null;primary_message_id:string|null}>(
      `SELECT source_channel,source_provider,manual_actor_principal_id::text,manual_report_snapshot,reporter_wecom_userid,source_bot_id,source_chat_type,primary_message_id::text
        FROM intake.service_intake WHERE id=$1::uuid`,[intakeId])).rows[0];assert.ok(stored);
    assert.equal(stored.source_channel,'MANUAL');assert.equal(stored.source_provider,'STAFF_MANUAL_REPORT');
    assert.equal(stored.manual_actor_principal_id,actor.id);assert.deepEqual(object(stored.manual_report_snapshot).reporter,command.reporter);
    assert.equal(stored.reporter_wecom_userid,null);assert.equal(stored.source_bot_id,null);assert.equal(stored.source_chat_type,null);assert.equal(stored.primary_message_id,null);
    const path='/api/manual-reviews/'+reviewId,detailResponse=await get(path);assert.equal(detailResponse.status,200,await detailResponse.clone().text());
    const detail=object(await detailResponse.json()),basis=object(detail.material_basis);
    assert.equal(basis.source_kind,'MANUAL');assert.equal(basis.original_revision,'1');assert.equal(basis.current_revision,'1');assert.equal(basis.stale,false);assert.equal(basis.reason,'CURRENT');
    assert.deepEqual(detail.materials,[{source_ref:'manual:'+intakeId,revision:'1',text:command.description,in_original_basis:true}]);
    assert.deepEqual(detail.manual_report,{source_kind:'MANUAL_REPORT',source:command.source,description:command.description,location:command.location,reporter:command.reporter,
      identity_source:'HAND_ENTERED',actor_principal_id:actor.id,manual_contact_required:true,external_notification:false});
    assert.equal(Object.hasOwn(detail,'web_report'),false);assert.deepEqual(detail.canonical_item,{kind:'review',id:reviewId});
    assert.ok(Array.isArray(detail.allowed_resolutions)&&detail.allowed_resolutions.includes('ACKNOWLEDGE'));
    await assertP2016Schema('p2_016_manual_review_detail',detail);
    const stranger=cookies[1];assert.ok(stranger);assert.equal((await fetch(origin+path,{headers:{cookie:stranger}})).status,404);
    const resolution={client_command_id:randomUUID(),expected_row_version:string(detail.row_version),expected_material_basis:string(basis.current_hash),
      resolution_code:'ACKNOWLEDGE',resolution_reason_code:'MANUAL_CONTACT_ACKNOWLEDGED'};
    const acknowledged=await fetch(origin+path+'/resolve',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':resolution.client_command_id,
      'if-match':'"'+resolution.expected_row_version+'"','x-csrf-token':csrf},body:JSON.stringify(resolution)});
    assert.equal(acknowledged.status,200,await acknowledged.clone().text());const acknowledgedResult=object(await acknowledged.json());
    assert.equal(acknowledgedResult.ok,true);assert.equal(acknowledgedResult.status,'RESOLVED');assert.equal(acknowledgedResult.replayed,false);
    const currentResponse=await get(path);assert.equal(currentResponse.status,200);const current=object(await currentResponse.json());
    assert.deepEqual(current.safe_result,detail.safe_result);assert.deepEqual(current.allowed_resolutions,[]);
    const intake=(await pool.query<{request_type:string;status:string;pilot_ticket_id:string|null}>(`SELECT request_type,status,pilot_ticket_id::text FROM intake.service_intake WHERE id=$1::uuid`,[intakeId])).rows[0];
    assert.ok(intake);assert.equal(intake.request_type,'CHATTER');assert.equal(intake.status,'COMPLETED');assert.equal(intake.pilot_ticket_id,null);
    assert.deepEqual(await conservation(pool),before,'manual admission and acknowledgement never manufacture Channel/Conversation/Communication or force a Ticket');
  },{workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true});
});
