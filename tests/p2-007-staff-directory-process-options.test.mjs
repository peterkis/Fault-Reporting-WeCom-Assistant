import test from 'node:test';
import assert from 'node:assert/strict';
import { createThirdPartyStaffDirectoryProcessOptions as options } from '../src/p2-007-third-party-staff-directory.mjs';
import { staffDirectorySchemaReady, requireStaffDirectorySchema } from '../src/p2-007-third-party-staff-directory.mjs';

test('enabled directory requires the local 036 marker before Worker readiness', async () => {
  const missing={query:async()=>({rowCount:0})};
  const applied={query:async sql=>{assert.match(sql,/036_p2_007_third_party_staff_directory/);return {rowCount:1};}};
  assert.equal(await staffDirectorySchemaReady(missing),false);
  assert.equal(await staffDirectorySchemaReady({query:async()=>{throw new Error('offline');}}),false);
  assert.equal(await staffDirectorySchemaReady(applied),true);
  await assert.rejects(requireStaffDirectorySchema({pool:missing,env:{THIRD_STAFF_DIRECTORY_ENABLED:'true'}}),/REQUIRES_036/);
  await requireStaffDirectorySchema({pool:applied,env:{THIRD_STAFF_DIRECTORY_ENABLED:'true'}});
  await requireStaffDirectorySchema({pool:{query:()=>{throw new Error('must not query');}},env:{}});
});

const env = { THIRD_STAFF_DIRECTORY_ENABLED: 'true', THIRD_STAFF_DIRECTORY_ROOT_ID: 'synthetic-root', THIRD_STAFF_INFO_SYNC_KEY: 'synthetic-key' };
const unexpected = () => { throw new Error('unexpected directory construction'); };

test('disabled process options do not create a store/provider or change legacy defaults', () => {
  for (const role of ['APP', 'WORKER', 'GATEWAY']) for (const value of [undefined, 'false']) {
    assert.deepEqual(options({ role, env: { THIRD_STAFF_DIRECTORY_ENABLED: value }, directoryFactory: unexpected, storeFactory: unexpected }), {});
  }
  for (const value of ['TRUE', '1', '', true]) assert.throws(() => options({ role: 'WORKER', env: { THIRD_STAFF_DIRECTORY_ENABLED: value } }), /FLAG_INVALID/u);
});

test('enabled App is local-read only; Gateway never constructs the provider', () => {
  const pool = {}, store = {};
  assert.deepEqual(options({ pool, role: 'APP', env, directoryFactory: unexpected,
    storeFactory: input => { assert.equal(input.pool, pool); return store; } }), { directoryStore: store, directorySourceScope: 'FORMAL' });
  assert.deepEqual(options({ role: 'GATEWAY', env, directoryFactory: unexpected, storeFactory: unexpected }), {});
});

test('enabled Worker wires the third-party port/source/job with an explicit Bot UID resolver', async () => {
  const pool = {}, reporterDirectory = {}, syncJob = {};
  let config;
  const result = options({ pool, role: 'WORKER', env, directoryFactory: value => {
    config = value; return { reporterDirectory, syncJob };
  } });
  assert.deepEqual(result, { directoryPort: reporterDirectory, directorySource: 'THIRD_PARTY_STAFF_DIRECTORY', directorySyncJob: syncJob });
  assert.equal(config.pool, pool);
  assert.equal(config.enabled, true);
  assert.equal(config.rootRef, 'synthetic-root');
  assert.equal(config.keyProvider(), 'synthetic-key');
  assert.equal((await config.uidResolver.resolveQueryUid({ source_namespace: 'WECOM_AIBOT', source_identity_ref: 'bot-a' })).uid, 'bot-a');
  assert.equal((await config.uidResolver.resolveQueryUid({ source_namespace: 'OPEN_USERID', source_identity_ref: 'bot-a' })).status, 'DEFERRED');
  for (const key of ['THIRD_STAFF_DIRECTORY_ROOT_ID', 'THIRD_STAFF_INFO_SYNC_KEY']) {
    assert.throws(() => options({ role: 'WORKER', env: { ...env, [key]: undefined }, directoryFactory: unexpected }), /CONFIGURATION_REQUIRED/u);
  }
});
