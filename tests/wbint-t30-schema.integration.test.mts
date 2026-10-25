import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t30Http} from './helpers/t30-internal-note-fixture.mjs';
import {internalNoteSchemaReady,internalNoteSchemaInventory,internalNoteSchemaHash} from '../app/server/src/p2-012-internal-note-schema.mjs';
test('T30 readiness requires the actual additive private-note constraints, including their definitions',async()=>{
  await t30Http({purpose:'t30schema'},async({pool})=>{
    const inventory=await internalNoteSchemaInventory(pool);console.log('T30_055_CATALOG '+JSON.stringify({hash:internalNoteSchemaHash(inventory),inventory}));
    assert.equal(await internalNoteSchemaReady(pool),true);
    await pool.query('ALTER TABLE incident.incident_event DROP CONSTRAINT p2012_internal_note_shape');
    await pool.query('ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_internal_note_shape CHECK (true)');
    assert.equal(await internalNoteSchemaReady(pool),false,'a validated but weakened private-text constraint must fail closed');
  });
});
