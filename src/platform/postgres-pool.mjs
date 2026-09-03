import { Pool, Client } from 'pg';
import { types as utilTypes } from 'node:util';
import { stringPreservingPgTypes } from './postgres-types.mjs';

export const POSTGRES_TIME_SESSION_OPTIONS = '-c timezone=Asia/Shanghai -c datestyle=ISO,YMD';

export class PostgresBoundaryError extends TypeError {
  constructor(code) {
    super(code);
    this.name = 'PostgresBoundaryError';
    this.code = code;
  }
}

function fail(code) {
  throw new PostgresBoundaryError(code);
}

function assertSafeParameter(value, ancestors) {
  if (value === null || value === undefined) return;
  if (value instanceof Date) fail('POSTGRES_DATE_PARAMETER_FORBIDDEN');
  if (typeof value !== 'object') return;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return;
  if (utilTypes.isProxy(value) || ancestors.has(value)) fail('POSTGRES_PARAMETER_OBJECT_INVALID');

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail('POSTGRES_PARAMETER_OBJECT_INVALID');
  }
  if (Object.hasOwn(value, 'toJSON')) fail('POSTGRES_PARAMETER_TO_JSON_FORBIDDEN');

  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      fail('POSTGRES_PARAMETER_KEY_FORBIDDEN');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('POSTGRES_PARAMETER_GETTER_FORBIDDEN');
    assertSafeParameter(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

export function assertNoDateQueryParameters(values) {
  if (values === undefined) return values;
  if (!Array.isArray(values)) fail('POSTGRES_QUERY_VALUES_ARRAY_REQUIRED');
  assertSafeParameter(values, new Set());
  return values;
}

function valuesFromQueryArguments(first, second) {
  if (first && typeof first === 'object' && !Array.isArray(first) && Object.hasOwn(first, 'values')) {
    return first.values;
  }
  return Array.isArray(second) ? second : undefined;
}

function guardQuery(target) {
  if (!target || typeof target.query !== 'function' || target.query.__arch005Guarded === true) return target;
  const original = target.query.bind(target);
  const guarded = function guardedPostgresQuery(first, second, third) {
    assertNoDateQueryParameters(valuesFromQueryArguments(first, second));
    return original(first, second, third);
  };
  Object.defineProperty(guarded, '__arch005Guarded', { value: true });
  target.query = guarded;
  return target;
}

async function initializeSession(client) {
  await client.query("SET TIME ZONE 'Asia/Shanghai'");
  await client.query("SET DateStyle = 'ISO, YMD'");
}

function poolConfig(config, onConnect) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('POSTGRES_POOL_CONFIG_INVALID');
  const maximum = config.max ?? 8;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 8) fail('POSTGRES_POOL_MAX_INVALID');
  return {
    ...config,
    max: maximum,
    options: config.options ?? POSTGRES_TIME_SESSION_OPTIONS,
    types: config.types ?? stringPreservingPgTypes,
    async onConnect(client) {
      await initializeSession(client);
      if (typeof onConnect === 'function') await onConnect(client);
    },
  };
}

export function createPostgresPool(config, { PoolClass = Pool } = {}) {
  if (typeof PoolClass !== 'function') fail('POSTGRES_POOL_CLASS_INVALID');
  const pool = new PoolClass(poolConfig(config, config?.onConnect));
  guardQuery(pool);
  if (typeof pool.connect === 'function') {
    const originalConnect = pool.connect.bind(pool);
    pool.connect = async function guardedConnect(...args) {
      const client = await originalConnect(...args);
      return guardQuery(client);
    };
  }
  return pool;
}

export function createPostgresClient(config, { ClientClass = Client } = {}) {
  if (typeof ClientClass !== 'function') fail('POSTGRES_CLIENT_CLASS_INVALID');
  const client = new ClientClass({
    ...config,
    options: config?.options ?? POSTGRES_TIME_SESSION_OPTIONS,
    types: config?.types ?? stringPreservingPgTypes,
  });
  const originalConnect = client.connect.bind(client);
  client.connect = async function guardedClientConnect(...args) {
    const result = await originalConnect(...args);
    await initializeSession(client);
    return result;
  };
  return guardQuery(client);
}

export function guardPostgresQueryClient(client) {
  return guardQuery(client);
}
