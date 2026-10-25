import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t31Http} from './helpers/t31-public-progress-fixture.mjs';
import {migrateIncidentInternalNotes} from '../app/server/scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../app/server/scripts/incident-public-progress-migrate.mjs';
import {internalNoteSchemaReady,internalNoteSchemaInventory,internalNoteSchemaHash,INTERNAL_NOTE_SCHEMA_SHA256} from '../app/server/src/p2-012-internal-note-schema.mjs';
import {publicProgressSchemaReady} from '../app/server/src/p2-012-public-progress-schema.mjs';
test('T31 actual additive migration preserves 055 marker/checksum/NOOP and exact private/public constraints fail closed together',async()=>{
  await t31Http({purpose:'t31migrate',ddl:false,notes:false,publication:false},async({pool,databaseUrl})=>{
    assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal(internalNoteSchemaHash(await internalNoteSchemaInventory(pool)),INTERNAL_NOTE_SCHEMA_SHA256);
    assert.equal((await migrateIncidentPublicProgress({databaseUrl,mode:'status'})).status,'READY_FOR_058');assert.equal((await migrateIncidentPublicProgress({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');assert.equal(await publicProgressSchemaReady(pool),false);assert.equal(internalNoteSchemaHash(await internalNoteSchemaInventory(pool)),INTERNAL_NOTE_SCHEMA_SHA256);
    assert.equal((await migrateIncidentPublicProgress({databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal(await publicProgressSchemaReady(pool),true);assert.equal(await internalNoteSchemaReady(pool),true);
    for(const mode of ['status','check','apply'] as const){assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode})).status,'NOOP_ALREADY_APPLIED');assert.equal((await migrateIncidentPublicProgress({databaseUrl,mode})).status,'NOOP_ALREADY_APPLIED');}
    await pool.query("UPDATE platform.schema_migration SET checksum_sha256=$1 WHERE migration_id='058_workbench_incident_public_progress'",['a'.repeat(64)]);await assert.rejects(migrateIncidentPublicProgress({databaseUrl,mode:'status'}),{code:'P2_012_COMMAND_FAILED'});await assert.rejects(migrateIncidentInternalNotes({databaseUrl,mode:'status'}),{code:'P2_012_COMMAND_FAILED'});
    await pool.query('ALTER TABLE incident.incident_event DROP CONSTRAINT p2012_internal_note_shape');await pool.query('ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_internal_note_shape CHECK (true)');assert.equal(await publicProgressSchemaReady(pool),false);assert.equal(await internalNoteSchemaReady(pool),false);await assert.rejects(migrateIncidentInternalNotes({databaseUrl,mode:'status'}),{code:'P2_012_COMMAND_FAILED'});
  });
});
