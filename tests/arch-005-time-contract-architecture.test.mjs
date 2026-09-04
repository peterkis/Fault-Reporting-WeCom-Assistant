import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { validateArch005TimeContract } from '../scripts/validate-arch-005-time-contract.mjs';

test('ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero', async () => {
  const result = await validateArch005TimeContract();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.frozen_migration_count, 14);
  assert.equal(result.contract_date_time_format_count, 0);
  assert.equal(result.api_offset_timestamp_leak_count, 0);
  assert.equal(result.direct_pg_factory_bypass_count, 0);
  assert.equal(result.browser_timezone_display_mismatch_count, 0);
  assert.equal(result.event_ordering_violation_count, 0);
});

test('P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract', async () => {
  const note = await readFile('docs/49_p2_007_time_contract_migration_note.md', 'utf8');
  const manifest = JSON.parse(await readFile('MANIFEST.json', 'utf8'));
  assert.match(note, /v1\.2\.1/u);
  assert.match(note, /format: date-time/u);
  assert.equal(manifest.last_completed_architecture_task, 'ARCH-006');
  assert.equal(manifest.arch_005_status, 'DONE');
  assert.equal(manifest.arch_006_status, 'DONE');
  assert.equal(['P2-007', 'P2-015', 'P2-016'].includes(manifest.last_completed_task), true);
  if (manifest.p2_015_status === 'AUTHORIZED') {
    assert.equal(manifest.active_task, 'P2-015'); assert.equal(manifest.active_lane, 'P2-C');
    assert.equal(manifest.next_task_candidate, 'P2-015'); assert.equal(manifest.next_task_authorized, true);
  } else if (manifest.p2_016_status==='DONE') {
    assert.equal(manifest.last_completed_task,'P2-016');assert.equal(manifest.p2_015_status,'DONE');
    assert.equal(manifest.active_task,null);assert.equal(manifest.active_lane,null);
    assert.equal(manifest.next_task_candidate,'P2-012');assert.equal(manifest.next_task_authorized,false);
  } else if (['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION'].includes(manifest.p2_016_status)) {
    assert.equal(manifest.p2_015_status,'DONE');assert.equal(manifest.last_completed_task,'P2-015');
    assert.equal(manifest.active_task,'P2-016');assert.equal(manifest.active_lane,'P2-B');
    assert.equal(manifest.next_task_candidate,'P2-016');assert.equal(manifest.next_task_authorized,true);
  } else {
    assert.equal(manifest.p2_015_status, 'DONE'); assert.equal(manifest.active_task, null); assert.equal(manifest.active_lane, null);
    assert.equal(manifest.next_task_candidate, 'P2-016'); assert.equal(manifest.next_task_authorized, false);
  }
  assert.equal(manifest.p2_007_status, 'DONE');
  assert.equal(manifest.p2_008_status, 'TODO_BLOCKED_BY_P2_G2');
  assert.equal(manifest.p2_g2_status, 'NOT_STARTED');
});
