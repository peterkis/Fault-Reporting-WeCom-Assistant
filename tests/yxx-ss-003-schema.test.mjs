import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createYxxSelfServiceStore,parseYxxRequestInput,parseYxxSupplementInput} from '../src/yxx-self-service-store.mjs';
import {migrateYxxSelfService,yxxCatalogHash} from '../scripts/yxx-self-service-migrate.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';

const databaseUrl=process.env.PILOT_DATABASE_URL;

test('SS-003 migration and store contracts are source-complete',async()=>{
  const sql=await readFile('database/migrations/033_yxx_self_service_intake.sql','utf8');
  for(const name of ['web_request_binding','web_submission','web_command_receipt','service_intake_web_source_check','channel_leg_web_source_check','deterministic_decision_web_source_check','web_binding_pending_idx'])assert.match(sql,new RegExp(name,'u'));
  assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS pilot_ticket\./u);assert.match(sql,/FOREIGN KEY \(primary_web_submission_id, id\)/u);assert.match(sql,/FOREIGN KEY \(channel_leg_id, service_intake_id, primary_web_submission_id\)/u);assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/u);
  assert.equal(typeof migrateCurrentBaselineWithYxx,'function');
  const input=parseYxxRequestInput({schema_version:1,client_command_id:'11111111-1111-4111-8111-111111111111',description:'打印机无响应',location:{text:'住院楼8层护士站',unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null});
  assert.equal(input.description,'打印机无响应');
  assert.throws(()=>parseYxxRequestInput({...input,reporter:'member'}),{message:'YXX_INPUT_INVALID'});
  assert.throws(()=>parseYxxSupplementInput({schema_version:1,client_command_id:'22222222-2222-4222-8222-222222222222',expected_input_revision:'0',text:'补充'}),{message:'YXX_INPUT_INVALID'});
});

test('SS-003 fresh applied migration, idempotent Web acceptance and source constraints', {skip:!databaseUrl}, async()=>{
  const applied=await migrateYxxSelfService({databaseUrl});assert.ok(['APPLIED','NOOP_ALREADY_APPLIED'].includes(applied.status));assert.equal(applied.inventory.forbidden_timezone_columns,0);
  const {Pool}=await import('pg');const pool=new Pool({connectionString:databaseUrl,max:2});
  try {
    const store=createYxxSelfServiceStore({pool,scopeSecret:'yxx-self-service-test-secret-32-bytes'});
    const scope={scopeHash:createHash('sha256').update(randomUUID()).digest('hex'),sourceCorpScope:'synthetic-corp',sourceAppScope:'synthetic-app',proofRef:'tests/synthetic'};
    const input={schema_version:1,client_command_id:randomUUID(),description:'网页自助报修测试',location:{text:'本部8层',unknown:false},service_code:null,impact_scope:'SELF',reported_department_text:null,extension:null};
    const client=await pool.connect();let first;try {await client.query('BEGIN');first=await store.acceptInTransaction({scope,input,transaction:client});await client.query('COMMIT');} finally {client.release();} assert.equal(first.replayed,false);assert.equal(first.receipt.accepted_revision,'1');
    const replay=await store.accept({scope,input});assert.equal(replay.replayed,true);assert.equal(replay.receipt.request_ref,first.receipt.request_ref);
    const listed=await store.listMyReports({scope});assert.ok(listed.items.some(item=>item.ref===first.receipt.request_ref));
    const command=await store.command({scope,clientCommandId:input.client_command_id});assert.equal(command.request_ref,first.receipt.request_ref);assert.ok(command.intake_no);
    const boundaryInput={...input,client_command_id:randomUUID(),description:'x'.repeat(4000),reported_department_text:'科'.repeat(100)};const boundary=await store.accept({scope,input:boundaryInput});const boundaryDetail=await store.getRequest({scope,requestRef:boundary.receipt.request_ref});assert.equal(boundaryDetail.safe_description.length,4000);
    const detail=await store.getRequest({scope,requestRef:first.receipt.request_ref});assert.equal(detail.source_kind,'WEB_REQUEST');assert.equal(detail.input_revision,'1');assert.equal(detail.ticket,null);
    const supplement={schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'仅护士站这一台电脑异常'};
    const added=await store.accept({scope,input:supplement,kind:'SUPPLEMENT',requestRef:first.receipt.request_ref});assert.equal(added.receipt.accepted_revision,'2');
    const again=await store.accept({scope,input:supplement,kind:'SUPPLEMENT',requestRef:first.receipt.request_ref});assert.equal(again.replayed,true);
    const timelinePage=await store.timeline({scope,requestRef:first.receipt.request_ref,limit:1});assert.equal(timelinePage.items.length,1);assert.ok(timelinePage.next_cursor);const timelineNext=await store.timeline({scope,requestRef:first.receipt.request_ref,cursor:timelinePage.next_cursor,limit:1});assert.equal(timelineNext.items.length,1);assert.equal(timelineNext.items[0].event_type,'SUPPLEMENT_ACCEPTED');
    const secondInput={...input,client_command_id:randomUUID(),description:'第二个网页报修'};const second=await store.accept({scope,input:secondInput});await assert.rejects(store.accept({scope,input:supplement,kind:'SUPPLEMENT',requestRef:second.receipt.request_ref}),error=>error.code==='YXX_COMMAND_CONFLICT'&&error.status===409);
    await pool.query("UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1",[first.receipt.request_ref]);await assert.rejects(store.accept({scope,input:{...supplement,client_command_id:randomUUID()},kind:'SUPPLEMENT',requestRef:first.receipt.request_ref}),error=>error.code==='YXX_NOT_FOUND'&&error.status===404);
    const events=await pool.query('SELECT event_type FROM intake.service_intake_event e JOIN intake.web_request_binding b ON b.intake_id=e.intake_id WHERE b.request_ref=$1 ORDER BY e.event_ordinal',[first.receipt.request_ref]);assert.deepEqual(events.rows.map(v=>v.event_type),['intake.web_received','intake.web_supplement_added']);
    const refs=await pool.query('SELECT source_channel,source_provider,source_bot_id,source_chat_type,primary_message_id FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=$1',[first.receipt.request_ref]);assert.deepEqual(refs.rows[0],{source_channel:'PORTAL',source_provider:'YIXIAOXIU_WEB',source_bot_id:null,source_chat_type:null,primary_message_id:null});
  } finally {await pool.end();}
});
