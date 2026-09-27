import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { migrateWorkbenchAuth } from '../scripts/p2-016-workbench-auth-migrate.mjs';
import { migrateThirdPartyStaffDirectory, validateThirdPartyStaffDirectoryCatalog } from '../scripts/p2-007-migrate.mjs';
import { createThirdPartyStaffDirectoryStore } from '../src/p2-007-staff-directory-store.mjs';
import { withP2016IsolatedDatabase, applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;

async function prepare({ pool, databaseUrl: isolated }) {
  await applyThrough030({ pool, databaseUrl: isolated });
  await migrateP2016({ databaseUrl: isolated });
  await migrateWorkbenchAuth({ databaseUrl: isolated });
  await migrateThirdPartyStaffDirectory({ databaseUrl: isolated });
}

function snapshot(version, departmentId = 'dept-a') {
  return {
    snapshot_version: version,
    departments: [{ provider_department_id: 'root', parent_provider_department_id: null, name: '医院', provider_gid: '1', provider_gid_type: 'number', depth: 0 },
      { provider_department_id: departmentId, parent_provider_department_id: 'root', name: departmentId, provider_gid: '2', provider_gid_type: 'number', depth: 1 }],
    members: [{ provider_user_id: 'provider-user-a', employee_id: 'EMP-A', nickname: '用户 A', phone: '13800000000', provider_wecom_id: 'provider-wecom-a' }],
    memberships: [{ provider_user_id: 'provider-user-a', provider_department_id: departmentId }],
    protocol_warnings: ['GID_DOCUMENTED_STRING_OBSERVED_NUMBER'],
    counts: { departments: 2, members: 1, memberships: 1, max_depth: 1 },
  };
}

test('036 directory migration is checkable, atomic, reentrant and catalog-complete', async () => {
  assert.ok(databaseUrl, 'PILOT_DATABASE_URL is required; database tests must not be skipped');
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'p2007migrate', run: async ({ pool, databaseUrl: isolated }) => {
    await applyThrough030({ pool, databaseUrl: isolated });
    await migrateP2016({ databaseUrl: isolated });
    await migrateWorkbenchAuth({ databaseUrl: isolated });
    assert.equal((await migrateThirdPartyStaffDirectory({ databaseUrl: isolated, mode: 'status' })).status, 'READY_FOR_036');
    assert.equal((await migrateThirdPartyStaffDirectory({ databaseUrl: isolated, mode: 'check' })).status, 'CHECK_ROLLBACK_SUCCEEDED');
    assert.equal((await pool.query("SELECT to_regclass('directory.member_current') AS relation")).rows[0].relation, null);
    assert.equal((await migrateThirdPartyStaffDirectory({ databaseUrl: isolated })).status, 'APPLIED');
    assert.deepEqual((await validateThirdPartyStaffDirectoryCatalog(pool)).relations, [
      'directory.current_snapshot', 'directory.department_current', 'directory.identity_binding',
      'directory.member_current', 'directory.membership_current', 'directory.sync_run',
    ]);
    assert.equal((await migrateThirdPartyStaffDirectory({ databaseUrl: isolated })).status, 'NOOP_ALREADY_APPLIED');
  }});
});

test('current directory replacement keeps bindings usable and exposes only current membership', async () => {
  assert.ok(databaseUrl, 'PILOT_DATABASE_URL is required; database tests must not be skipped');
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'p2007store', run: async ({ pool, databaseUrl: isolated }) => {
    await prepare({ pool, databaseUrl: isolated });
    const store = createThirdPartyStaffDirectoryStore({ pool });
    await store.publishSnapshot({ source_scope: 'FORMAL', root_ref: 'root', snapshot: snapshot('a'.repeat(64)) });
    const member = await store.findMemberByProviderUserId({ source_scope: 'FORMAL', provider_user_id: 'provider-user-a' });
    assert.equal(member.memberships[0].department_ref, 'dept-a');
    const saved = await store.saveResolvedProfile({ source_scope: 'FORMAL', reporter_identity_hash: 'b'.repeat(64),
      source_namespace: 'WECOM_AIBOT', resolution_method: 'BOT_RAW_USERID_EXPLICIT_PROFILE', member,
      profile: { provider_user_id: 'provider-user-a', employee_id: 'EMP-A', display_name: '用户 A', phone: '13800000000', sex: '1', avatar_url: 'https://avatar.example.test/a' } });
    assert.equal(saved.sex, '1');
    assert.equal(saved.avatar_url, 'https://avatar.example.test/a');
    assert.equal((await store.findByReporterHash({ source_scope: 'FORMAL', reporter_identity_hash: 'b'.repeat(64) })).provider_user_id, 'provider-user-a');
    await store.publishSnapshot({ source_scope: 'FORMAL', root_ref: 'root', snapshot: snapshot('c'.repeat(64), 'dept-b') });
    const current = await store.findByReporterHash({ source_scope: 'FORMAL', reporter_identity_hash: 'b'.repeat(64) });
    assert.equal(current.snapshot_version, 'c'.repeat(64));
    assert.equal(current.memberships[0].department_ref, 'dept-b');
    assert.equal(current.avatar_url, null);
  }});
});
