import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import {
  TimeContractError,
  addEpochMilliseconds,
  assertEpochMsString,
  assertLocalDate,
  assertLocalDateTime,
  assertLocalTime,
  compareLocalDateTime,
  formatEpochMsToShanghaiLocal,
  localDateTimeToDisplay,
  shanghaiLocalToEpochMs,
} from '../src/platform/time-contract.mjs';

test('LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values', () => {
  assert.equal(assertLocalDate('2024-02-29'), '2024-02-29');
  assert.equal(assertLocalTime('23:59'), '23:59');
  assert.equal(assertLocalDateTime('2026-09-03 12:34:56'), '2026-09-03 12:34:56');
  assert.equal(localDateTimeToDisplay('2026-09-03 12:34:56'), '2026-09-03 12:34');
  assert.equal(compareLocalDateTime('2026-09-03 12:34:55', '2026-09-03 12:34:56'), -1);
});

test('LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects', () => {
  const invalid = [
    '2026-02-30 00:00:00', '2023-02-29 00:00:00', '2026-09-03T12:34:56',
    '2026-09-03 12:34:56Z', '2026-09-03 12:34:56 UTC', '2026-09-03 12:34:56+08:00',
    '2026-09-03 12:34:56-05:00', '2026-09-03 12:34:56 Asia/Shanghai',
    '2026-09-03 12:34:56.001', ' 2026-09-03 12:34:56', '2026-09-03 12:34:56 ',
    new Date(), new String('2026-09-03 12:34:56'), new Proxy({}, {}),
    { get value() { throw new Error('must not run'); } }, { toJSON() { return '2026-09-03 12:34:56'; } },
  ];
  for (const value of invalid) {
    assert.throws(() => assertLocalDateTime(value), (error) => error instanceof TimeContractError && error.code === 'LOCAL_DATETIME_INVALID');
  }
});

test('PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds', () => {
  assert.equal(assertEpochMsString('0'), '0');
  for (const value of [0, -1, '01', '+1', '1.0', '1e3', ' 1', new Date()]) assert.throws(() => assertEpochMsString(value));
  assert.equal(formatEpochMsToShanghaiLocal('0'), '1970-01-01 08:00:00');
  const local = '2026-09-03 12:34:56';
  const epoch = shanghaiLocalToEpochMs(local);
  assert.equal(formatEpochMsToShanghaiLocal(epoch), local);
  assert.equal(addEpochMilliseconds(epoch, 1000), String(BigInt(epoch) + 1000n));
});

test('explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ', () => {
  const expression = "import('./src/platform/time-contract.mjs').then(m=>process.stdout.write(m.formatEpochMsToShanghaiLocal('1788406496000')))";
  const values = ['UTC', 'Asia/Tokyo', 'America/New_York'].map((TZ) => spawnSync(process.execPath, ['-e', expression], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, TZ },
  }));
  for (const value of values) assert.equal(value.status, 0, value.stderr);
  assert.equal(new Set(values.map((value) => value.stdout)).size, 1);
  assert.match(values[0].stdout, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u);
});
