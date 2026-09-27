import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const pool = { query: async () => ({ rows: [], rowCount: 1 }), connect: async () => { throw new Error('unexpected database call'); } };
let appOptions, workerOptions;
mock.module('../scripts/p2-g1-process-role.mjs', { namedExports: {
  runApp: options => options.runtimeFactory({ pool, publicOrigin: 'https://example.test' }),
  runWorker: async options => { await options.beforeReady?.({pool}); return options.extensionFactory({ pool }); },
  runGateway: () => 'gateway',
} });
mock.module('../src/p2-016-runtime.mjs', { namedExports: {
  createP2016Runtime: options => { appOptions = options; return {}; },
} });
mock.module('../src/p2-012-workbench-assembly.mjs', { namedExports: {
  createP2012Runtime: options => { appOptions = options; return {}; },
  createP2012WorkbenchExtension: () => ({ runOnce: async () => ({}) }),
} });
mock.module('../src/p2-016-orchestration-adapters.mjs', { namedExports: {
  createP2016OrchestrationWorker: options => { workerOptions = options; return {}; },
} });
const launchers = [
  (await import('../scripts/p2-016-process-role.mjs')).main,
  (await import('../scripts/p2-012-process-role.mjs')).main,
];

test('both deployed launchers forward enabled directory options only to the owning roles', async t => {
  const saved = { ...process.env }, send = process.send;
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
    if (send === undefined) delete process.send; else process.send = send; });
  process.send = () => {};
  Object.assign(process.env, { THIRD_STAFF_DIRECTORY_ENABLED: 'true', THIRD_STAFF_DIRECTORY_ROOT_ID: 'synthetic-root',
    THIRD_STAFF_INFO_SYNC_KEY: 'synthetic-key', P2_G1_SENDER_ENABLED: 'false', P2_G1_GATEWAY_ENABLED: 'false',
    WORKBENCH_WECOM_LOGIN_ENABLED: 'false', PILOT_LOG_IDENTITY_HASH_KEY: 'synthetic-identity-key-with-32-characters',
    P2_016_REPORTER_HMAC_SECRET: 'synthetic-reporter-secret-with-32-characters',
    P2_012_REPORTER_HMAC_SECRET: 'synthetic-reporter-secret-with-32-characters',
    P2_016_REPORTER_ALLOWED_HOSTS: 'example.test', P2_012_REPORTER_ALLOWED_HOSTS: 'example.test',
    P2_012_SCOPE_BOT_ID: 'synthetic-bot', P2_012_TEST_GROUP_TARGET_HASHES: 'a'.repeat(64),
  });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected live request'); });
  for (const main of launchers) {
    await main(['--role=app']);
    assert.equal(typeof appOptions.directoryStore.findByReporterHash, 'function');
    assert.equal(appOptions.directorySourceScope, 'FORMAL');
    assert.equal(appOptions.directorySyncJob, undefined);
    assert.equal(appOptions.directoryPort, undefined);
    await main(['--role=worker']);
    assert.equal(workerOptions.directorySource, 'THIRD_PARTY_STAFF_DIRECTORY');
    assert.equal(typeof workerOptions.directoryPort.resolve, 'function');
    assert.equal(typeof workerOptions.directorySyncJob.runIfDue, 'function');
    assert.equal(await main(['--role=gateway']), 'gateway');
  }
  process.env.THIRD_STAFF_DIRECTORY_ENABLED = 'false';
  for (const main of launchers) {
    await main(['--role=app']); assert.equal(appOptions.directoryStore, undefined);
    await main(['--role=worker']); assert.ok(!workerOptions.directorySyncJob); assert.ok(!workerOptions.directoryPort);
    assert.ok(workerOptions.directorySource === undefined || workerOptions.directorySource === 'WECOM_DIRECTORY');
  }
});
