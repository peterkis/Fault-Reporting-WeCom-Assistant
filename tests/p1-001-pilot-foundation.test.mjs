import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPilotOnlyDependencies,
  buildSafePreflightSummary,
  closePilotFoundation,
  createPilotFoundationServer,
  listenPilotFoundation,
  parseCliArgs,
  runPilotPreflight,
  validatePilotConfig,
} from '../src/p1-001-pilot-foundation.mjs';

const baseEnv = {
  ARCHITECTURE_BASELINE: 'V1.2',
  APP_PHASE: 'P1',
  PILOT_ENV: 'test',
  PILOT_LISTEN_HOST: '127.0.0.1',
  PILOT_LISTEN_PORT: '3100',
  PILOT_PUBLIC_EDGE_APPROVED: 'false',
  PILOT_SECURITY_BOUNDARY_APPROVED: 'false',
  PILOT_OWNER_ID: 'pilot-owner-for-test',
  PILOT_TEST_GROUP_ID: 'pilot-test-group-for-test',
  PILOT_DATABASE_URL: 'postgresql://pilot-user:database-secret@localhost:5432/pilot',
  WECOM_BOT_ID: 'bot-for-p1-test',
  WECOM_BOT_SECRET: 'wecom-secret-for-p1-test',
  WECOM_WS_URL: 'wss://openws.work.weixin.qq.com',
  AI_TRIAGE_ENABLED: 'false',
  OCR_ENABLED: 'false',
  HOSPITAL_TICKETS_ENABLED: 'false',
};

test('P1 configuration accepts Pilot-only dependencies and produces a secret-free summary', () => {
  const config = validatePilotConfig(baseEnv);
  const summary = buildSafePreflightSummary(config);
  const serialized = JSON.stringify(summary);

  assert.equal(config.phase, 'P1');
  assert.equal(config.featureFlags.hospitalTicketsEnabled, false);
  assert.deepEqual(summary.declared_dependencies, ['Pilot PostgreSQL', 'WeCom Gateway']);
  assert.equal(serialized.includes(baseEnv.WECOM_BOT_SECRET), false);
  assert.equal(serialized.includes('database-secret'), false);
  assert.equal(serialized.includes(baseEnv.PILOT_OWNER_ID), false);
  assert.equal(serialized.includes(baseEnv.PILOT_TEST_GROUP_ID), false);
});

test('P1 configuration rejects missing, cross-phase, and unapproved public-edge settings', () => {
  assert.throws(() => validatePilotConfig({ ...baseEnv, WECOM_BOT_SECRET: '' }), /MISSING_WECOM_BOT_SECRET/);
  assert.throws(() => validatePilotConfig({ ...baseEnv, APP_PHASE: 'G0' }), /APP_PHASE/);
  assert.throws(() => validatePilotConfig({ ...baseEnv, AI_TRIAGE_ENABLED: 'true' }), /AI_TRIAGE_ENABLED_MUST_BE_FALSE/);
  assert.throws(() => validatePilotConfig({ ...baseEnv, HOSPITAL_TICKETS_ENABLED: 'true' }), /HOSPITAL_TICKETS_ENABLED_MUST_BE_FALSE/);
  assert.throws(() => assertPilotOnlyDependencies({ ...baseEnv, HOSPITAL_TICKETS_URL: 'https://hospital.invalid' }), /FORBIDDEN_DEPENDENCY_HOSPITAL_TICKETS_URL/);
  assert.throws(() => validatePilotConfig({ ...baseEnv, PILOT_LISTEN_HOST: '0.0.0.0' }), /PILOT_PUBLIC_EDGE_APPROVAL_REQUIRED/);
  assert.equal(validatePilotConfig({ ...baseEnv, PILOT_LISTEN_HOST: '0.0.0.0', PILOT_PUBLIC_EDGE_APPROVED: 'true' }).listen.publicEdgeApproved, true);
  assert.throws(() => validatePilotConfig({ ...baseEnv, PILOT_ENV: 'pilot' }), /PILOT_SECURITY_BOUNDARY_APPROVAL_REQUIRED/);
  assert.equal(validatePilotConfig({ ...baseEnv, PILOT_ENV: 'pilot', PILOT_SECURITY_BOUNDARY_APPROVED: 'true' }).listen.securityBoundaryApproved, true);
});

test('preflight output and CLI options do not expose configuration secrets', () => {
  const events = [];
  const result = runPilotPreflight({ env: baseEnv, writeEvent: (event) => events.push(event) });
  const invalidEvents = [];
  const invalid = runPilotPreflight({ env: { ...baseEnv, WECOM_BOT_SECRET: '' }, writeEvent: (event) => invalidEvents.push(event) });

  assert.equal(result.ok, true);
  assert.equal(invalid.ok, false);
  assert.equal(Object.hasOwn(invalid, 'error'), false);
  assert.equal(JSON.stringify(events).includes(baseEnv.WECOM_BOT_SECRET), false);
  assert.equal(JSON.stringify(invalidEvents).includes(baseEnv.WECOM_BOT_SECRET), false);
  assert.deepEqual(parseCliArgs([]), { mode: 'check' });
  assert.deepEqual(parseCliArgs(['--serve']), { mode: 'serve' });
  assert.throws(() => parseCliArgs(['--serve', '--unknown']), /UNSUPPORTED_ARGUMENTS/);
});

test('the Pilot foundation health endpoint starts and stops without business routes', async () => {
  const server = createPilotFoundationServer();
  const address = await listenPilotFoundation(server, { host: '127.0.0.1', port: 0 });
  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  const unknown = await fetch(`http://127.0.0.1:${address.port}/tickets`);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'pilot-foundation', phase: 'P1' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'NOT_FOUND' });
  await closePilotFoundation(server);
});
