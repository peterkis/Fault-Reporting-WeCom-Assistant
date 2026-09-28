import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

const connectionString = process.env.PILOT_DATABASE_URL;
if (!connectionString) throw new Error('POSTGRES_CALLBACK_TEST_DATABASE_REQUIRED');

test('callback-acquired PostgreSQL client rejects Date before SQL and retains valid query/release behavior', async () => {
  const pool = createPostgresPool({ connectionString, max: 1 });
  const disconnects: Promise<void>[] = [];
  pool.on('connect', client => disconnects.push(new Promise(resolve => client.once('end', resolve))));
  let callbacks = 0;
  let returned: unknown;
  try {
    const { client, release } = await new Promise<{ client: PoolClient; release: unknown }>((resolve, reject) => {
      returned = pool.connect((error, value, release) => {
        callbacks += 1;
        if (error) { reject(error); return; }
        if (!value) { reject(new Error('POSTGRES_CALLBACK_CLIENT_MISSING')); return; }
        resolve({ client: value, release });
      });
      if (returned instanceof Promise) void returned.catch(reject);
    });
    let unguardedQuery: Promise<unknown> | undefined;
    try {
      assert.equal(release, client.release);
      assert.ok(returned instanceof Promise, 'preserve the existing wrapper return form');
      assert.equal(await returned, undefined);
      assert.throws(() => { unguardedQuery = client.query('SELECT $1::timestamptz', [new Date()]); }, { code: 'POSTGRES_DATE_PARAMETER_FORBIDDEN' });
      const result = await client.query<{ value: string }>('SELECT $1::text AS value', ['valid']);
      assert.deepEqual(result.rows, [{ value: 'valid' }]);
      let invalidCallbacks = 0;
      assert.throws(() => client.query({ text: 'SELECT $1::jsonb', values: [{ nested: new Date() }] }, () => { invalidCallbacks += 1; }), { code: 'POSTGRES_DATE_PARAMETER_FORBIDDEN' });
      assert.equal(invalidCallbacks, 0);
      let queryCallbacks = 0;
      let queryReturn: unknown;
      const response = await new Promise<QueryResult<{ value: string }>>((resolve, reject) => {
        queryReturn = client.query<{ value: string }>('SELECT $1::text AS value', ['callback'], (error, response) => {
          queryCallbacks += 1;
          if (error) { reject(error); return; }
          resolve(response);
        });
      });
      assert.equal(queryReturn, undefined);
      assert.equal(queryCallbacks, 1);
      assert.deepEqual(response.rows, [{ value: 'callback' }]);
      await client.query('BEGIN');
      try {
        const first = await client.query<{ id: string }>('SELECT pg_backend_pid()::text AS id');
        const second = await client.query<{ id: string }>({ text: 'SELECT pg_backend_pid()::text AS id' });
        assert.deepEqual(second.rows, first.rows);
      } finally { await client.query('ROLLBACK'); }
      assert.equal(callbacks, 1);
    } finally { await unguardedQuery?.catch(() => {}); client.release(); }
  } finally { await pool.end(); await Promise.all(disconnects); }
});

test('callback adapter preserves receivers, arguments, query return and single wrapping for an injected Pool class', async t => {
  class InjectedPool extends Pool {}
  const callbackReceiver = Object.freeze({ receiver: 'callback' });
  const queryReturn = Object.freeze({ original: 'query-result' });
  const connectReturn = Object.freeze({ original: 'connect-result' });
  const queryCalls: unknown[][] = [];
  const client = { query(...args: unknown[]): unknown { assert.equal(this, client); queryCalls.push(args); return queryReturn; } };
  const release = () => {};
  let pool: Pool;
  t.mock.method(Pool.prototype, 'connect', function(this: Pool, callback: unknown) {
    assert.equal(this, pool);
    assert.equal(typeof callback, 'function');
    if (typeof callback !== 'function') throw new Error('CALLBACK_REQUIRED');
    Reflect.apply(callback, callbackReceiver, [undefined, client, release]);
    return connectReturn;
  });
  pool = createPostgresPool({ max: 1 }, { PoolClass: InjectedPool });
  assert.ok(pool instanceof InjectedPool);
  let callbackCount = 0;
  let queryIdentity: unknown;
  try {
    for (let index = 0; index < 2; index += 1) {
      const returned: unknown = pool.connect(function(this: unknown, error, value, done) {
        callbackCount += 1;
        assert.equal(this, callbackReceiver);
        assert.equal(arguments.length, 3);
        assert.equal(error, undefined);
        assert.equal(value, client);
        assert.equal(done, release);
        assert.ok(value);
        if (index === 0) queryIdentity = value.query;
        else assert.equal(value.query, queryIdentity);
        const queryCallback = () => {};
        assert.equal(value.query('SELECT $1', ['safe'], queryCallback), queryReturn);
        assert.deepEqual(queryCalls.at(-1), ['SELECT $1', ['safe'], queryCallback]);
        assert.throws(() => value.query('SELECT $1', [new Date()]), { code: 'POSTGRES_DATE_PARAMETER_FORBIDDEN' });
      });
      assert.ok(returned instanceof Promise);
      assert.equal(await returned, connectReturn);
    }
    assert.equal(callbackCount, 2);
    assert.equal(queryCalls.length, 2);
  } finally { await pool.end(); }
});

test('connection error callback keeps its receiver, argument count, identity and return form', async t => {
  const failure = new Error('synthetic connection failure');
  const receiver = Object.freeze({ receiver: 'error-callback' });
  t.mock.method(Pool.prototype, 'connect', function(callback: unknown) {
    if (typeof callback !== 'function') throw new Error('CALLBACK_REQUIRED');
    Reflect.apply(callback, receiver, [failure]);
  });
  const pool = createPostgresPool({ max: 1 });
  let calls = 0;
  try {
    const returned: unknown = pool.connect(function(this: unknown, error) {
      calls += 1;
      assert.equal(this, receiver);
      assert.equal(arguments.length, 1);
      assert.equal(error, failure);
    });
    assert.ok(returned instanceof Promise);
    assert.equal(await returned, undefined);
    assert.equal(calls, 1);
  } finally { await pool.end(); }
});

test('Promise acquisition continues to guard Date and preserves transaction client capability', async () => {
  const pool = createPostgresPool({ connectionString, max: 1 });
  const disconnects: Promise<void>[] = [];
  pool.on('connect', client => disconnects.push(new Promise(resolve => client.once('end', resolve))));
  try {
    const client = await pool.connect();
    try {
      assert.throws(() => client.query('SELECT $1', [new Date()]), { code: 'POSTGRES_DATE_PARAMETER_FORBIDDEN' });
      assert.deepEqual((await client.query<{ value: string }>('SELECT $1::text AS value', ['promise'])).rows, [{ value: 'promise' }]);
      assert.equal(typeof client.release, 'function');
    } finally { client.release(); }
  } finally { await pool.end(); await Promise.all(disconnects); }
});
