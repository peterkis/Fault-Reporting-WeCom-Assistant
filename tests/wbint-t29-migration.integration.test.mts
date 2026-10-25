import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {ownerTransferHttp,text,record} from './helpers/t29-owner-transfer-http-fixture.mjs';
import {migrateIncidentOwnerTransfer} from '../app/server/scripts/incident-owner-transfer-migrate.mjs';
import {migrateIncidentInternalNotes} from '../app/server/scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../app/server/scripts/incident-public-progress-migrate.mjs';
import {ownerTransferSchemaReady} from '../app/server/src/p2-012-owner-transfer-schema.mjs';
import {publicProgressSchemaReady} from '../app/server/src/p2-012-public-progress-schema.mjs';
import {internalNoteSchemaReady} from '../app/server/src/p2-012-internal-note-schema.mjs';
test('T29 typed054 check rolls back; apply stamps only054 and exact guards reject checksum or catalog tamper together',async()=>{
  await ownerTransferHttp(async({pool,databaseUrl})=>{
    const original=(await pool.query("SELECT * FROM platform.schema_migration WHERE migration_id IN ('032_p2_012_human_confirmed_incident','055_workbench_incident_internal_notes','058_workbench_incident_public_progress') ORDER BY migration_id")).rows;
    assert.equal((await migrateIncidentOwnerTransfer({databaseUrl,mode:'status'})).status,'READY_FOR_054');assert.equal((await migrateIncidentOwnerTransfer({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');assert.equal(await ownerTransferSchemaReady(pool),false);assert.equal(await publicProgressSchemaReady(pool),true);
    assert.equal((await migrateIncidentOwnerTransfer({databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal(await ownerTransferSchemaReady(pool),true);assert.equal(await publicProgressSchemaReady(pool),true);assert.equal(await internalNoteSchemaReady(pool),true);
    assert.deepEqual((await pool.query("SELECT * FROM platform.schema_migration WHERE migration_id IN ('032_p2_012_human_confirmed_incident','055_workbench_incident_internal_notes','058_workbench_incident_public_progress') ORDER BY migration_id")).rows,original);
    for(const mode of ['status','check','apply'] as const){assert.equal((await migrateIncidentOwnerTransfer({databaseUrl,mode})).status,'NOOP_ALREADY_APPLIED');assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode})).status,'NOOP_ALREADY_APPLIED');assert.equal((await migrateIncidentPublicProgress({databaseUrl,mode})).status,'NOOP_ALREADY_APPLIED');}
    const own=(await pool.query<{checksum_sha256:string}>("SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id='054_workbench_incident_owner_transfer'")).rows[0];assert.ok(own);await pool.query("UPDATE platform.schema_migration SET checksum_sha256=$1 WHERE migration_id='054_workbench_incident_owner_transfer'",['a'.repeat(64)]);assert.equal(await ownerTransferSchemaReady(pool),false);await assert.rejects(migrateIncidentOwnerTransfer({databaseUrl,mode:'status'}),{code:'P2_012_COMMAND_FAILED'});
    await pool.query("UPDATE platform.schema_migration SET checksum_sha256=$1 WHERE migration_id='054_workbench_incident_owner_transfer'",[own.checksum_sha256]);await pool.query('ALTER TABLE incident.incident_event DROP CONSTRAINT p2012_owner_transfer_shape');await pool.query('ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_owner_transfer_shape CHECK (true)');for(const guard of [ownerTransferSchemaReady,publicProgressSchemaReady,internalNoteSchemaReady])assert.equal(await guard(pool),false);for(const migrate of [migrateIncidentOwnerTransfer,migrateIncidentPublicProgress,migrateIncidentInternalNotes])await assert.rejects(migrate({databaseUrl,mode:'status'}),{code:'P2_012_COMMAND_FAILED'});
  },{ownerEnabled:false,ownerDDL:false});
});
test('T29 default OFF keeps the original032 host usable without new schema while mounting no transfer purpose',async()=>{
  await ownerTransferHttp(async({pool,get,post,confirm,f})=>{const incident=await confirm(),path='/api/incidents/'+incident;const bootstrap=(await get('/api/lifecycle/bootstrap')).body;assert.equal(bootstrap.incident_owner_transfer_enabled,false);assert.equal(bootstrap.incident_owner_transfer_draft_recovery_enabled,false);assert.equal((await get(path)).status,200);assert.equal((await get(path+'/owner-transfer-targets')).status,404);assert.equal((await post(path+'/transfer-owner',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED',owner_principal_id:text(record(f.dispatcher).id),owner_team_id:null})).status,404);assert.equal((await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id LIKE '054_%' OR migration_id LIKE '055_%' OR migration_id LIKE '058_%'")).rowCount,0);},{ownerEnabled:false,ddl:false});
});
