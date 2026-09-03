import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest('shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects', async () => {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, allowExitOnIdle: true });
  try {
    const result = await pool.query(`SELECT
      DATE '2026-09-03' AS local_date,
      TIME '12:34:00' AS local_time,
      TIMESTAMP '2026-09-03 12:34:56.123456' AS local_datetime,
      TIMESTAMPTZ '2026-09-03 04:34:56.123456+00' AS legacy_instant,
      '[2026-09-03 00:00:00,2026-09-04 00:00:00)'::tsrange AS local_range,
      9223372036854775807::bigint AS epoch_value,
      '{"safe":true}'::jsonb AS payload,
      current_setting('TimeZone') AS timezone,
      current_setting('DateStyle') AS datestyle`);
    const row = result.rows[0];
    for (const key of ['local_date', 'local_time', 'local_datetime', 'legacy_instant', 'local_range', 'epoch_value']) assert.equal(typeof row[key], 'string', key);
    assert.deepEqual(row.payload, { safe: true });
    assert.equal(row.local_datetime, '2026-09-03 12:34:56.123456');
    assert.equal(row.epoch_value, '9223372036854775807');
    assert.equal(row.timezone, 'Asia/Shanghai');
    assert.equal(row.datestyle, 'ISO, YMD');
  } finally { await pool.end(); }
});

integrationTest('shared pg factory rejects Date recursively before sending SQL', async () => {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, allowExitOnIdle: true });
  try {
    assert.throws(() => pool.query('SELECT $1::jsonb', [{ nested: new Date() }]), { code: 'POSTGRES_DATE_PARAMETER_FORBIDDEN' });
    const valid = await pool.query('SELECT $1::timestamp without time zone AS value', ['2026-09-03 12:34:56']);
    assert.equal(valid.rows[0].value, '2026-09-03 12:34:56');
  } finally { await pool.end(); }
});
