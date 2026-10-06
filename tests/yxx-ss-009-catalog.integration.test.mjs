import test from 'node:test';
import assert from 'node:assert/strict';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {migrateCurrentBaseline} from '../scripts/migrate-current-baseline.mjs';
import {migrateYxxSelfService,yxxCatalogInventory,validateYxxCatalog} from '../scripts/yxx-self-service-migrate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {randomUUID} from 'node:crypto';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxMemberCommandContext} from '../src/yxx-self-service-command.mjs';

test('SS-009 catalog rejects weakened CHECK despite preserved names and fragments',async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009schema',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaseline({databaseUrl});await migrateYxxSelfService({databaseUrl});
    await pool.query('ALTER TABLE intake.web_request_binding DROP CONSTRAINT web_binding_revision_check, ADD CONSTRAINT web_binding_revision_check CHECK (processed_revision <= input_revision OR true)');
    assert.throws(()=>validateYxxCatalog(null));
    const inventory=await yxxCatalogInventory(pool);assert.throws(()=>validateYxxCatalog(inventory));
  }});
});

test('SS-009 migration check rolls back and five catalog drift classes fail closed',async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009drift',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaseline({databaseUrl});
    const before=await yxxCatalogInventory(pool);
    assert.equal((await migrateYxxSelfService({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');
    assert.deepEqual(await yxxCatalogInventory(pool),before);
    const applied=await migrateYxxSelfService({databaseUrl});assert.equal(applied.status,'APPLIED');
    assert.equal((await migrateYxxSelfService({databaseUrl})).status,'NOOP_ALREADY_APPLIED');
    const cases=[
      ['COLUMN','ALTER TABLE intake.web_request_binding DROP COLUMN proof_ref'],
      ['CHECK','ALTER TABLE intake.web_request_binding DROP CONSTRAINT web_binding_revision_check, ADD CONSTRAINT web_binding_revision_check CHECK (processed_revision <= input_revision OR true)'],
      ['FK','ALTER TABLE intake.web_submission DROP CONSTRAINT web_submission_command_receipt_id_fkey, ADD CONSTRAINT web_submission_command_receipt_id_fkey FOREIGN KEY(command_receipt_id) REFERENCES intake.web_submission(id)'],
      ['UNIQUE','ALTER TABLE intake.web_command_receipt DROP CONSTRAINT web_command_receipt_idempotency_unique, ADD CONSTRAINT web_command_receipt_idempotency_unique UNIQUE(scope_hash,client_command_id,command_hash)'],
      ['INDEX','DROP INDEX intake.web_binding_member_created_idx; CREATE INDEX web_binding_member_created_idx ON intake.web_request_binding(created_at)'],
    ];
    const client=await pool.connect();try{
      for(const [kind,sql] of cases){await client.query('BEGIN');try{await client.query(sql);const changed=await yxxCatalogInventory(client);assert.throws(()=>validateYxxCatalog(changed),{code:'YXX_SELF_SERVICE_CATALOG_DRIFT'},kind);}finally{await client.query('ROLLBACK');}}
      for(const sql of ['DROP INDEX intake.decision_web_submission_idx','ALTER TABLE intake.service_intake_event DROP CONSTRAINT service_intake_event_type_check','ALTER TABLE intake.deterministic_decision ALTER COLUMN basis_input_revision TYPE numeric']){
        await client.query('BEGIN');try{await client.query(sql);const changed=await yxxCatalogInventory(client);assert.throws(()=>validateYxxCatalog(changed),{code:'YXX_SELF_SERVICE_CATALOG_DRIFT'});}finally{await client.query('ROLLBACK');}
      }
    }finally{client.release();}
    assert.deepEqual(await yxxCatalogInventory(pool),applied.inventory);
    t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'catalog',status:'PASS',candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,drift_classes:cases.map(c=>c[0]),check_rollback:true,forbidden_timezone_columns:applied.inventory.forbidden_timezone_columns}));
  }});
});

test('SS-009 PostgreSQL rejects mixed Web Bot fields missing source and deferred orphan commits',async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009fk',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaseline({databaseUrl});await migrateYxxSelfService({databaseUrl});
    const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    const auth={profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:'synthetic-csrf',canonical_reporter_binding:'a'.repeat(64),source_corp_scope:'synthetic-corp',source_app_scope:'synthetic-app',proof_ref:'tests/ss009'};
    const command=createYxxMemberCommandContext({store:createYxxSelfServiceStore({pool,scopeSecret:'ss009-synthetic-key-longer-than-32'}),profile:auth.profile,flags,authenticate:async()=>auth,recheck:Object.assign(async()=>auth,{localOnly:true}),quota:Object.assign(async()=>true,{localOnly:true})});
    const input={schema_version:1,client_command_id:randomUUID(),description:'处方提交不了',location:{text:null,unknown:true},service_code:null,impact_scope:'UNKNOWN',reported_department_text:null,extension:null};
    const accepted=await command.accept({input,request:{headers:{'x-csrf-token':auth.csrf_token,'idempotency-key':input.client_command_id}}});
    const client=await pool.connect();try{
      for(const assignment of ["source_bot_id='fake-bot'",'primary_web_submission_id=NULL','source_app_scope=NULL','canonical_reporter_binding=NULL',"source_provider='WECOM_AIBOT',source_channel='WECOM_DIRECT',primary_web_submission_id=NULL,source_app_scope=NULL,canonical_reporter_binding=NULL"]){
        await client.query('BEGIN');try{await assert.rejects(client.query('UPDATE intake.service_intake SET '+assignment),e=>['23514','23502'].includes(e.code));}finally{await client.query('ROLLBACK');}
      }
      await client.query('BEGIN');await client.query('UPDATE intake.service_intake SET primary_web_submission_id=$1',[randomUUID()]);await assert.rejects(client.query('COMMIT'),e=>e.code==='23503');await client.query('ROLLBACK');
    }finally{client.release();}
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM intake.web_request_binding WHERE request_ref=$1',[accepted.receipt.request_ref])).rows[0].n,1);
  }});
});
