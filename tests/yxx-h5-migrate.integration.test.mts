// Exercise real PostgreSQL18 migration DDL and the existing ARCH005 boundary.
// Fixtures own their databases; no production identity or cloud access is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {migrateWorkbenchAuth} from '../scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory} from '../scripts/p2-007-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../scripts/workbench-follow-up-due-migrate.mjs';
import {migrateYxxH5} from '../scripts/yxx-h5-migrate.mjs';
type Fixture=Parameters<Parameters<typeof withT24Fixture>[0]>[0];
const ids=['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media','066_yixiaoxiu_h5_media_previews'];
async function prepared(run:(fixture:Fixture)=>Promise<void>){
  await withT24Fixture(async f=>{
    await f.runtime.stop();
    for(const migrate of [migrateWorkbenchAuth,migrateThirdPartyStaffDirectory,migrateWorkbenchFollowUpSchedules,migrateWorkbenchFollowUpDueSignals])await migrate({databaseUrl:f.databaseUrl,mode:'apply'});
    await run(f);
  },{ticketReopenRoundsEnabled:true,mvpNotificationsEnabled:true});
}
const options=(f:Fixture)=>({databaseUrl:f.databaseUrl,expectedDatabase:new URL(f.databaseUrl).pathname.slice(1)});
const receiptRows=async(f:Fixture)=>(await f.pool.query('SELECT migration_id,checksum_sha256,applied_epoch_ms::text,applied_at::text FROM platform.schema_migration ORDER BY migration_id')).rows;
const h5Rows=async(f:Fixture)=>(await f.pool.query<{migration_id:string;checksum_sha256:string;time_pair:boolean}>(`SELECT migration_id,checksum_sha256,
  applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair FROM platform.schema_migration
  WHERE migration_id=ANY($1::text[]) ORDER BY migration_id`,[ids])).rows;
function migrationCli(f:Fixture,args:readonly string[]){
  const entry=fileURLToPath(new URL('../scripts/yxx-h5-migrate.mjs',import.meta.url));
  const env:NodeJS.ProcessEnv={PILOT_DATABASE_URL:f.databaseUrl};
  // Do not inherit NODE_OPTIONS, .env loading, Provider credentials or PG_*.
  for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR'])if(process.env[name]!==undefined)env[name]=process.env[name];
  return spawnSync(process.execPath,[entry,...args],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,encoding:'utf8',windowsHide:true,timeout:15_000,maxBuffer:64*1024});
}
async function preservedFacts(f:Fixture){
  // Only synthetic fixture data. Keep values private; assertions compare these
  // snapshots without emitting any real cloud identity or payload.
  return (await f.pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM pilot_ticket.pilot_principal p) AS principals,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text) FROM pilot_ticket.pilot_principal_role p) AS roles,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text) FROM pilot_ticket.pilot_team_member p) AS teams,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM pilot_ticket.ticket p) AS tickets,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.event_id) FROM pilot_ticket.ticket_event p) AS events,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text) FROM communication.outbox p) AS outbox`)).rows;
}

test('H5 migration check reports missing SQL without DDL or changing existing facts/receipts',async()=>{
  assert.ok(process.env.PILOT_DATABASE_URL,'owned PostgreSQL18 is required');
  await prepared(async f=>{
    const before=await receiptRows(f),facts=await preservedFacts(f);
    const expected=await migrateYxxH5({...options(f),mode:'check',includePreviews:true});assert.equal(expected.status,'PENDING');
    const target='--expected-database='+options(f).expectedDatabase;
    for(const args of [[target,'--include-previews'],['--check',target,'--include-previews']]){
      const result=migrationCli(f,args);assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0);assert.equal(result.stderr,'');
      const output:unknown=JSON.parse(result.stdout);assert.deepEqual(output,expected);
    }
    const rejected=migrationCli(f,[target,'--unknown-option']);
    assert.equal(rejected.error,undefined);assert.equal(rejected.signal,null);assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');
    const errorOutput:unknown=JSON.parse(rejected.stderr);assert.deepEqual(errorOutput,{ok:false,error_code:'H5_MIGRATION_FAILED'});
    assert.ok(!rejected.stderr.includes(f.databaseUrl));
    assert.deepEqual(await receiptRows(f),before);assert.deepEqual(await preservedFacts(f),facts);
    assert.equal((await f.pool.query("SELECT to_regclass('intake.web_media_upload') AS media")).rows[0]?.media,null);
  });
});

test('H5 maintenance rejects a prerequisite receipt with a broken ARCH005 time pair before H5 DDL',async()=>{
  await prepared(async f=>{
    const prerequisite='031_p2_016_ticket_lifecycle_workbench_notifications';
    const before=await receiptRows(f),facts=await preservedFacts(f);
    const constraint=(await f.pool.query<{definition:string;validated:boolean;enforced:boolean;deferrable:boolean}>(`SELECT pg_get_constraintdef(oid) AS definition,convalidated AS validated,conenforced AS enforced,condeferrable AS deferrable
      FROM pg_constraint WHERE conrelid='platform.schema_migration'::regclass AND conname='platform_schema_migration_time_check' AND contype='c'`)).rows[0];
    assert.ok(constraint);assert.equal(constraint.validated,true);assert.equal(constraint.enforced,true);assert.equal(constraint.deferrable,false);
    const update='UPDATE platform.schema_migration SET applied_at=applied_at+interval \'1 second\' WHERE migration_id=$1';
    await assert.rejects(f.pool.query(update,[prerequisite]),{code:'23514',constraint:'platform_schema_migration_time_check'});
    assert.deepEqual(await receiptRows(f),before);
    const changedChecks=async()=>(await f.pool.query(`SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='conversation.realtime_event'::regclass AND conname='conversation_realtime_event_source_type_check'
      OR conrelid='intake.web_command_receipt'::regclass AND conname IN ('web_command_receipt_schema_check','web_command_receipt_kind_check') ORDER BY relation,conname`)).rows;
    const originalChecks=await changedChecks();
    // Corrupt only this fixture UUID database, after proving the real guard.
    // Production migration code never disables or alters this constraint.
    await f.pool.query('ALTER TABLE platform.schema_migration DROP CONSTRAINT platform_schema_migration_time_check');
    try{
      assert.equal((await f.pool.query(update,[prerequisite])).rowCount,1);
      const broken=(await f.pool.query<{time_pair:boolean}>('SELECT applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair FROM platform.schema_migration WHERE migration_id=$1',[prerequisite])).rows[0];
      assert.equal(broken?.time_pair,false);
      const corrupted=await receiptRows(f);
      for(const mode of ['check','apply'] as const){
        await assert.rejects(migrateYxxH5({...options(f),mode,includePreviews:true}),{message:'H5_MIGRATION_PREREQUISITE_INVALID'});
        assert.deepEqual(await receiptRows(f),corrupted);assert.deepEqual(await preservedFacts(f),facts);assert.deepEqual(await h5Rows(f),[]);assert.deepEqual(await changedChecks(),originalChecks);
        const absent=(await f.pool.query<{pristine:boolean}>(`SELECT to_regclass('intake.web_report_urge') IS NULL AND to_regclass('intake.web_report_evaluation') IS NULL
          AND to_regclass('pilot_ticket.ticket_public_progress') IS NULL AND to_regclass('intake.web_media_upload') IS NULL
          AND to_regprocedure('intake.guard_web_media_identity()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND (
            attrelid='intake.web_command_receipt'::regclass AND attname='h5_result'
            OR attrelid='intake.web_request_binding'::regclass AND attname IN ('h5_profile_attempts','h5_profile_next_attempt_epoch_ms'))) AS pristine`)).rows[0];
        assert.equal(absent?.pristine,true);
      }
    }finally{
      await f.pool.query('UPDATE platform.schema_migration SET applied_at=platform.local_from_epoch_ms(applied_epoch_ms) WHERE migration_id=$1',[prerequisite]);
      await f.pool.query('ALTER TABLE platform.schema_migration ADD CONSTRAINT platform_schema_migration_time_check '+constraint.definition);
    }
    assert.deepEqual(await receiptRows(f),before);assert.deepEqual(await preservedFacts(f),facts);
    const restored=(await f.pool.query<{validated:boolean;enforced:boolean;definition:string}>("SELECT convalidated AS validated,conenforced AS enforced,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform.schema_migration'::regclass AND conname='platform_schema_migration_time_check'")).rows[0];
    assert.deepEqual(restored,{validated:true,enforced:true,definition:constraint.definition});
  });
});

test('H5 migration applies real 064/065/066 and ARCH005 receipts once, preserving staff and facts',async()=>{
  await prepared(async f=>{
    const before=await receiptRows(f),facts=await preservedFacts(f);
    assert.equal((await migrateYxxH5({...options(f),mode:'apply',includePreviews:true})).status,'APPLIED');
    const installed=await h5Rows(f);assert.equal(installed.length,3);
    for(const row of installed){assert.equal(row.time_pair,true);assert.equal(row.checksum_sha256,createHash('sha256').update(await readFile(new URL('../database/migrations/'+row.migration_id+'.sql',import.meta.url),'utf8')).digest('hex'));}
    assert.deepEqual((await receiptRows(f)).filter(row=>!ids.includes(String(row.migration_id))),before);
    assert.deepEqual(await preservedFacts(f),facts);
    const after=await receiptRows(f);
    assert.equal((await migrateYxxH5({...options(f),mode:'apply',includePreviews:true})).status,'NOOP_ALREADY_APPLIED');
    assert.deepEqual(await receiptRows(f),after);assert.deepEqual(await preservedFacts(f),facts);
  });
});

test('a nonpreview installation resumes with 066 and never removes existing preview schema',async()=>{
  await prepared(async f=>{
    await migrateYxxH5({...options(f),mode:'apply',includePreviews:false});assert.equal((await h5Rows(f)).length,2);
    const first=await h5Rows(f);await migrateYxxH5({...options(f),mode:'apply',includePreviews:true});
    assert.deepEqual((await h5Rows(f)).slice(0,2),first);
    assert.equal((await migrateYxxH5({...options(f),mode:'apply',includePreviews:false})).status,'NOOP_ALREADY_APPLIED');
    assert.equal((await h5Rows(f)).length,3);
  });
});

test('H5 migration rejects wrong receipts, missing constraints, and a superficially named weak CHECK',async()=>{
  await prepared(async f=>{
    await migrateYxxH5({...options(f),mode:'apply',includePreviews:true});
    const rows=await h5Rows(f),checksum=rows.find(row=>row.migration_id===ids[2])?.checksum_sha256;assert.ok(checksum);
    await f.pool.query('UPDATE platform.schema_migration SET checksum_sha256=$2 WHERE migration_id=$1',[ids[2],'0'.repeat(64)]);
    await assert.rejects(migrateYxxH5({...options(f),mode:'apply',includePreviews:true}),/H5_MIGRATION_RECEIPT_DRIFT/u);
    await f.pool.query('UPDATE platform.schema_migration SET checksum_sha256=$2 WHERE migration_id=$1',[ids[2],checksum]);
    await f.pool.query('ALTER TABLE intake.web_media_upload DROP CONSTRAINT web_media_thumbnail_state');
    await assert.rejects(migrateYxxH5({...options(f),mode:'check',includePreviews:true}),/H5_MIGRATION_/u);
    await f.pool.query("ALTER TABLE intake.web_media_upload ADD CONSTRAINT web_media_thumbnail_state CHECK ((thumbnail_status='READY' AND kind='IMAGE' AND thumbnail_mime_type='image/jpeg' AND thumbnail_byte_size IS NOT NULL AND thumbnail_sha256 IS NOT NULL) OR true)");
    await assert.rejects(migrateYxxH5({...options(f),mode:'check',includePreviews:true}),/H5_MIGRATION_/u);
  });
});

test('unreceipted H5 objects and a different expected database fail before application',async()=>{
  await prepared(async f=>{
    const before=await receiptRows(f);
    await assert.rejects(migrateYxxH5({...options(f),expectedDatabase:'wrong_synthetic_database',mode:'apply'}),/H5_MIGRATION_DATABASE_MISMATCH/u);
    await f.pool.query('CREATE TABLE intake.web_report_urge(id uuid)');
    await assert.rejects(migrateYxxH5({...options(f),mode:'apply'}),/H5_MIGRATION_UNRECEIPTED_OBJECTS/u);
    assert.deepEqual(await receiptRows(f),before);assert.equal((await f.pool.query("SELECT to_regclass('intake.web_media_upload') AS media")).rows[0]?.media,null);
  });
});

test('a real 066 DDL error rolls back preceding 064/065 DDL and their receipts together',async()=>{
  await prepared(async f=>{
    const before=await receiptRows(f),facts=await preservedFacts(f);
    // An ordinary table occupies the same schema-level relation name as the
    // 066 index. This belongs only to this fixture UUID database.
    await f.pool.query('CREATE TABLE intake.web_media_pending_thumbnail(collision boolean)');
    await assert.rejects(migrateYxxH5({...options(f),mode:'apply',includePreviews:true}),{message:'H5_MIGRATION_FAILED'});
    assert.deepEqual(await receiptRows(f),before);assert.deepEqual(await preservedFacts(f),facts);
    const objects=(await f.pool.query("SELECT to_regclass('intake.web_report_urge') AS urge,to_regclass('intake.web_media_upload') AS media")).rows[0];
    assert.deepEqual(objects,{urge:null,media:null});
  });
});

test('concurrent explicit H5 maintenance serializes to one apply and one verified NOOP',async()=>{
  await prepared(async f=>{
    const result=await Promise.all([migrateYxxH5({...options(f),mode:'apply',includePreviews:true}),migrateYxxH5({...options(f),mode:'apply',includePreviews:true})]);
    assert.deepEqual(result.map(row=>row.status).sort(),['APPLIED','NOOP_ALREADY_APPLIED']);
    assert.equal((await h5Rows(f)).length,3);
  });
});

test('H5 maintenance detects trigger/function drift, composite FK actions, and widened partial indexes',async()=>{
  await prepared(async f=>{
    await migrateYxxH5({...options(f),mode:'apply',includePreviews:true});
    const before=await receiptRows(f),facts=await preservedFacts(f);
    const reject=()=>assert.rejects(migrateYxxH5({...options(f),mode:'check',includePreviews:true}),{message:'H5_MIGRATION_STRUCTURE_DRIFT'});
    const functionSql=(await f.pool.query<{definition:string}>("SELECT pg_get_functiondef('intake.guard_web_media_identity()'::regprocedure) AS definition")).rows[0]?.definition;
    const indexSql=(await f.pool.query<{definition:string}>("SELECT pg_get_indexdef('intake.web_media_scope_unbound'::regclass) AS definition")).rows[0]?.definition;
    const foreignKeySql=(await f.pool.query<{definition:string}>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='intake.web_media_upload'::regclass AND conname='web_media_submission_intake_fk'")).rows[0]?.definition;
    assert.ok(functionSql);assert.ok(indexSql);assert.ok(foreignKeySql);
    await f.pool.query('ALTER TABLE intake.web_media_upload DISABLE TRIGGER web_media_identity_guard');
    try{await reject();}finally{await f.pool.query('ALTER TABLE intake.web_media_upload ENABLE TRIGGER web_media_identity_guard');}
    await f.pool.query('CREATE OR REPLACE FUNCTION intake.guard_web_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
    try{await reject();}finally{await f.pool.query(functionSql);}
    await f.pool.query('ALTER TABLE intake.web_media_upload DROP CONSTRAINT web_media_submission_intake_fk');
    await f.pool.query('ALTER TABLE intake.web_media_upload ADD CONSTRAINT web_media_submission_intake_fk FOREIGN KEY(submission_id,intake_id) REFERENCES intake.web_submission(id,intake_id) ON DELETE CASCADE');
    try{await reject();}finally{
      await f.pool.query('ALTER TABLE intake.web_media_upload DROP CONSTRAINT web_media_submission_intake_fk');
      await f.pool.query('ALTER TABLE intake.web_media_upload ADD CONSTRAINT web_media_submission_intake_fk '+foreignKeySql);
    }
    await f.pool.query('DROP INDEX intake.web_media_scope_unbound');
    await f.pool.query('CREATE INDEX web_media_scope_unbound ON intake.web_media_upload(scope_hash,expires_epoch_ms) WHERE true');
    try{await reject();}finally{await f.pool.query('DROP INDEX intake.web_media_scope_unbound');await f.pool.query(indexSql);}
    assert.equal((await migrateYxxH5({...options(f),mode:'check',includePreviews:true})).status,'NOOP_ALREADY_APPLIED');
    assert.deepEqual(await receiptRows(f),before);assert.deepEqual(await preservedFacts(f),facts);
  });
});

test('required H5 guards tolerate nonconflicting successor columns, checks, and indexes',async()=>{
  await prepared(async f=>{
    await migrateYxxH5({...options(f),mode:'apply',includePreviews:true});
    const before=await receiptRows(f),facts=await preservedFacts(f);
    await f.pool.query('ALTER TABLE intake.web_media_upload ADD COLUMN synthetic_successor_note text CHECK(synthetic_successor_note IS NULL OR char_length(synthetic_successor_note)<=100)');
    await f.pool.query('CREATE INDEX synthetic_successor_media_idx ON intake.web_media_upload(created_epoch_ms)');
    assert.equal((await migrateYxxH5({...options(f),mode:'check',includePreviews:true})).status,'NOOP_ALREADY_APPLIED');
    assert.deepEqual(await receiptRows(f),before);assert.deepEqual(await preservedFacts(f),facts);
    assert.equal((await f.pool.query<{present:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='intake.web_media_upload'::regclass AND attname='synthetic_successor_note' AND NOT attisdropped) AS present")).rows[0]?.present,true);
  });
});

test('H5 stage receipts must be contiguous and retain exact original UTF8 checksums',async()=>{
  await prepared(async f=>{
    await migrateYxxH5({...options(f),mode:'apply',includePreviews:true});
    const before=(await f.pool.query<{migration_id:string;checksum_sha256:string;applied_epoch_ms:string;applied_at:string}>('SELECT migration_id,checksum_sha256,applied_epoch_ms::text,applied_at::text FROM platform.schema_migration WHERE migration_id=$1',[ids[1]])).rows;
    const middle=before[0];assert.ok(middle);
    await f.pool.query('DELETE FROM platform.schema_migration WHERE migration_id=$1',[middle.migration_id]);
    await assert.rejects(migrateYxxH5({...options(f),mode:'apply',includePreviews:true}),{message:'H5_MIGRATION_RECEIPT_DRIFT'});
    // This restoration is fixture-only and uses its original ARCH005 time pair.
    // The production adapter never recreates a receipt without executing SQL.
    const stamp=await f.pool.query(`INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      VALUES($1,$2,$3::timestamp without time zone,$4::bigint) RETURNING migration_id`,[middle.migration_id,middle.checksum_sha256,middle.applied_at,middle.applied_epoch_ms]);
    assert.equal(stamp.rowCount,1);
    const original=await readFile(new URL('../database/migrations/'+middle.migration_id+'.sql',import.meta.url));
    const alternate=Buffer.from(original.toString('utf8').includes('\r\n')?original.toString('utf8').replaceAll('\r\n','\n'):original.toString('utf8').replaceAll('\n','\r\n'));
    const alternateHash=createHash('sha256').update(alternate).digest('hex');
    assert.notEqual(alternateHash,middle.checksum_sha256);
    await f.pool.query('UPDATE platform.schema_migration SET checksum_sha256=$2 WHERE migration_id=$1',[middle.migration_id,alternateHash]);
    await assert.rejects(migrateYxxH5({...options(f),mode:'check',includePreviews:true}),{message:'H5_MIGRATION_RECEIPT_DRIFT'});
    await f.pool.query('UPDATE platform.schema_migration SET checksum_sha256=$2 WHERE migration_id=$1',[middle.migration_id,middle.checksum_sha256]);
    assert.equal((await migrateYxxH5({...options(f),mode:'check',includePreviews:true})).status,'NOOP_ALREADY_APPLIED');
  });
});
