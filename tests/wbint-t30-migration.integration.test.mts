import assert from 'node:assert/strict';
import {test} from 'node:test';
import {migrateIncidentInternalNotes,INTERNAL_NOTE_MIGRATION_ID} from '../scripts/incident-internal-notes-migrate.mjs';
import {internalNoteSchemaReady} from '../src/p2-012-internal-note-schema.mjs';
import {t30Http,text,record} from './helpers/t30-internal-note-fixture.mjs';
import {randomUUID} from 'node:crypto';
test('T30 actual 055 check rolls back, apply records its checksum, repeat validates and schema drift fails closed',async()=>{
  await t30Http({purpose:'t30migrate',notes:false,ddl:false},async({pool,databaseUrl,confirm})=>{
    const incident=await confirm();assert.equal(await internalNoteSchemaReady(pool),false);
    assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode:'status'})).status,'READY_FOR_055');
    assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');assert.equal(await internalNoteSchemaReady(pool),false);assert.equal((await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[INTERNAL_NOTE_MIGRATION_ID])).rowCount,0);
    assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal(await internalNoteSchemaReady(pool),true);assert.equal((await migrateIncidentInternalNotes({databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
    const admin=text(record((await pool.query("SELECT id::text FROM pilot_ticket.pilot_principal WHERE display_name='合成管理员'")).rows[0]).id),receipt=randomUUID();
    await pool.query(`INSERT INTO incident.command_receipt(id,command_scope,client_command_id,command_hash,command_type,incident_id,actor_principal_id,expected_row_version) VALUES($1::uuid,$2,$3::uuid,$4,'ADD_INTERNAL_NOTE',$5::uuid,$6::uuid,1)`,[receipt,'P2_012:'+admin,randomUUID(),'a'.repeat(64),incident,admin]);
    for(const bad of ['x\u0001',' \t\n','😀'.repeat(2001)])await assert.rejects(pool.query(`INSERT INTO incident.incident_event(event_key,incident_id,event_ordinal,event_type,actor_kind,actor_principal_id,source_command_id,safe_payload,payload_hash,internal_note_text,internal_note_incident_version) VALUES($1,$2::uuid,99,'incident.internal_note_added','HUMAN',$3::uuid,$4::uuid,'{}'::jsonb,$5,$6,2)`,['incident_event_v1_'+randomUUID().replaceAll('-','').padEnd(64,'a'),incident,admin,receipt,'a'.repeat(64),bad]),{code:'23514'});
    await pool.query('ALTER TABLE incident.incident_event DROP CONSTRAINT p2012_internal_note_shape');await pool.query('ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_internal_note_shape CHECK (true)');assert.equal(await internalNoteSchemaReady(pool),false);await assert.rejects(migrateIncidentInternalNotes({databaseUrl,mode:'status'}),{code:'P2_012_COMMAND_FAILED'});
  });
});
