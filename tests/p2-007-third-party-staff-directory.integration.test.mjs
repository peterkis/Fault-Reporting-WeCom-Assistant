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
    assert.equal(current.sex, '1');
    assert.equal(current.avatar_url, 'https://avatar.example.test/a');
  }});
});

test('failed publication rolls back; reused IDs and removed members cannot inherit profiles or active bindings', async () => {
  assert.ok(databaseUrl, 'PILOT_DATABASE_URL is required');
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'p2007id', run: async ({ pool, databaseUrl: isolated }) => {
    await prepare({ pool, databaseUrl: isolated });
    const store = createThirdPartyStaffDirectoryStore({ pool });
    const key = { source_scope: 'FORMAL', reporter_identity_hash: 'b'.repeat(64) };
    const publish = value => store.publishSnapshot({ source_scope: 'FORMAL', root_ref: 'root', snapshot: value });
    await publish(snapshot('a'.repeat(64)));
    const member = await store.findMemberByProviderUserId({ source_scope: 'FORMAL', provider_user_id: 'provider-user-a' });
    await store.saveResolvedProfile({ ...key, member, profile: { provider_user_id: 'provider-user-a', employee_id: 'EMP-A', sex: '1', avatar_url: 'https://avatar.example.test/a' } });
    const before = await store.findByReporterHash(key);
    const broken = snapshot('c'.repeat(64));
    broken.memberships[0].provider_department_id = 'missing';
    await assert.rejects(publish(broken), { code: '23503' });
    assert.deepEqual(await store.findByReporterHash(key), before);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM directory.sync_run')).rows[0].count, 1);

    const replacement = snapshot('d'.repeat(64));
    replacement.members[0].employee_id = 'EMP-B';
    await publish(replacement);
    assert.equal(await store.findByReporterHash(key), null);
    const replaced = await store.findMemberByProviderUserId({ source_scope: 'FORMAL', provider_user_id: 'provider-user-a' });
    assert.equal(replaced.sex, null); assert.equal(replaced.avatar_url, null);
    assert.equal((await pool.query('SELECT binding_status FROM directory.identity_binding')).rows[0].binding_status, 'STALE');
    await assert.rejects(store.saveResolvedProfile({ ...key, member, profile: { provider_user_id: 'provider-user-a', employee_id: 'EMP-A' } }), { code: 'THIRD_STAFF_DIRECTORY_IDENTITY_CONFLICT' });

    const empty = snapshot('e'.repeat(64)); empty.members = []; empty.memberships = [];
    empty.counts.members = 0; empty.counts.memberships = 0;
    await publish(empty);
    await publish(snapshot('f'.repeat(64)));
    assert.equal(await store.findByReporterHash(key), null);
    assert.equal((await store.findMemberByProviderUserId({ source_scope: 'FORMAL', provider_user_id: 'provider-user-a' })).avatar_url, null);
  }});
});

test('detail enrichment and publication share the source lock and preserve committed enrichment', async () => {
  assert.ok(databaseUrl, 'PILOT_DATABASE_URL is required');
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'p2007race', run: async ({ pool, databaseUrl: isolated }) => {
    await prepare({ pool, databaseUrl: isolated });
    const store = createThirdPartyStaffDirectoryStore({ pool });
    await store.publishSnapshot({ source_scope: 'FORMAL', root_ref: 'root', snapshot: snapshot('a'.repeat(64)) });
    const member = await store.findMemberByProviderUserId({ source_scope: 'FORMAL', provider_user_id: 'provider-user-a' });
    const locks = [];
    const observed = createThirdPartyStaffDirectoryStore({ pool: {
      query: (...args) => pool.query(...args),
      connect: async () => {
        const client = await pool.connect();
        return { release: value => client.release(value), query: (sql, values) => {
          if (sql.includes('pg_advisory_xact_lock') && values?.[0]?.startsWith('THIRD_STAFF_DIRECTORY_SYNC:')) locks.push(values[0]);
          return client.query(sql, values);
        } };
      },
    } });
    const key = { source_scope: 'FORMAL', reporter_identity_hash: 'b'.repeat(64) };
    await Promise.all([
      observed.saveResolvedProfile({ ...key, member, profile: { provider_user_id: 'provider-user-a', employee_id: 'EMP-A', sex: '1', avatar_url: 'https://avatar.example.test/a' } }),
      observed.publishSnapshot({ source_scope: 'FORMAL', root_ref: 'root', snapshot: snapshot('c'.repeat(64), 'dept-b') }),
    ]);
    assert.deepEqual(locks, ['THIRD_STAFF_DIRECTORY_SYNC:FORMAL', 'THIRD_STAFF_DIRECTORY_SYNC:FORMAL']);
    const current = await store.findByReporterHash(key);
    assert.equal(current.sex, '1'); assert.equal(current.avatar_url, 'https://avatar.example.test/a');
    assert.equal(current.memberships[0].department_ref, 'dept-b');
    assert.equal(current.snapshot_version, 'c'.repeat(64));
  }});
});
