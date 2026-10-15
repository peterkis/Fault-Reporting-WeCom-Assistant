import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeReminderPage,decodeReminderCoordination,decodeReminderPreferences,mutedReminderPreferences} from '../src/workbench-reminder-browser-contracts.mjs';

test('T40 browser preferences accept only bounded settings and fail closed for identity or draft fields',()=>{
  assert.deepEqual(decodeReminderPreferences(null),mutedReminderPreferences);
  assert.deepEqual(decodeReminderPreferences('{"schema_version":1,"sound_enabled":true,"desktop_enabled":false}'),{schema_version:1,sound_enabled:true,desktop_enabled:false});
  for(const raw of ['{',' '.repeat(129),'{"schema_version":1,"sound_enabled":true,"desktop_enabled":true,"principal":"secret"}',
    '{"schema_version":1,"sound_enabled":"true","desktop_enabled":false}'])assert.deepEqual(decodeReminderPreferences(raw),mutedReminderPreferences);
});
test('T40 reminder reads preserve decimal IDs and reject extra payload, invalid source revision or calendar',()=>{
  const row={reminder_id:'a'.repeat(64),event_id:'9223372036854775807',reason:'RELATED_FOLLOW_UP_DUE',canonical_item:{kind:'ticket',id:'2b1f2c30-a051-4a44-8a2a-dc4b6467d7b1'},source_key:'b'.repeat(64),source_revision:'1',occurred_at:'2024-02-29 12:30:00'};
  const page={schema_version:1,items:[row],as_of_event_id:'9223372036854775807',baseline_token:'opaque_token',next_cursor:null,reset_required:false};
  assert.equal(decodeReminderPage(page).items[0]?.event_id,'9223372036854775807');
  for(const changed of [{...row,internal_note:'must not leak'},{...row,source_revision:'0'},{...row,occurred_at:'2025-02-29 12:30:00'},
    {...row,canonical_item:{...row.canonical_item,kind:'review'}},{...row,event_id:'9223372036854775808'}])assert.throws(()=>decodeReminderPage({...page,items:[changed]}));
  assert.throws(()=>decodeReminderPage({...page,reset_required:true}));
});
test('T40 cross-tab messages contain only a current opaque scope and a reminder digest',()=>{
  const scope='c'.repeat(64),seen={schema_version:1,authority_scope:scope,kind:'SEEN',reminder_id:'a'.repeat(64)};
  assert.deepEqual(decodeReminderCoordination(seen,scope),seen);
  assert.equal(decodeReminderCoordination(seen,'d'.repeat(64)),null);
  assert.equal(decodeReminderCoordination({...seen,body:'untrusted'},scope),null);
  assert.equal(decodeReminderCoordination({...seen,reminder_id:'raw-ticket-id'},scope),null);
});
