import { Pool, Client } from 'pg';
import { types as utilTypes } from 'node:util';
import { stringPreservingPgTypes } from './postgres-types.mjs';
import type { PoolConfig, ClientConfig, PoolClient, QueryConfig, QueryArrayConfig, QueryResult, QueryArrayResult, QueryResultRow, Submittable } from 'pg';

// Defaults are deliberately unknown: PG row values have not been schema-validated.
export interface PostgresQuery {
  <T extends Submittable>(stream: T): T;
  <R extends unknown[] = unknown[], I extends unknown[] = unknown[]>(config: QueryArrayConfig<I>, values?: I): Promise<QueryArrayResult<R>>;
  <R extends QueryResultRow = Record<string, unknown>, I extends unknown[] = unknown[]>(text: string | QueryConfig<I>, values?: I): Promise<QueryResult<R>>;
  <R extends unknown[] = unknown[], I extends unknown[] = unknown[]>(config: QueryArrayConfig<I>, callback: (error: Error, result: QueryArrayResult<R>) => void): void;
  <R extends QueryResultRow = Record<string, unknown>, I extends unknown[] = unknown[]>(text: string | QueryConfig<I>, callback: (error: Error, result: QueryResult<R>) => void): void;
  <R extends unknown[] = unknown[], I extends unknown[] = unknown[]>(config: QueryArrayConfig<I>, values: I, callback: (error: Error, result: QueryArrayResult<R>) => void): void;
  <R extends QueryResultRow = Record<string, unknown>, I extends unknown[] = unknown[]>(text: string | QueryConfig<I>, values: I, callback: (error: Error, result: QueryResult<R>) => void): void;
}
type Callable = ((...args: never[]) => unknown) & { __arch005Guarded?: boolean };
interface SessionClient { query(text: string): unknown }
interface PoolTarget { query: Callable; connect?: Callable }
interface ClientTarget extends SessionClient { connect: Callable }
export type PostgresPoolClient = Omit<PoolClient, 'query'> & { query: PostgresQuery };
export type PostgresPool<T extends PoolTarget = Pool> = Omit<T, 'query' | 'connect' | (T extends Pool ? 'on' : never)> & {
  query: T extends Pool ? PostgresQuery : T['query'];
} & (T extends Pool ? {
  on<K extends 'error' | 'release' | 'connect' | 'acquire' | 'remove'>(event: K, listener: K extends 'error' | 'release' ? (error: Error, client: PostgresPoolClient) => void : (client: PostgresPoolClient) => void): PostgresPool<T>;
  connect(): Promise<PostgresPoolClient>;
  // The existing async wrapper resolves undefined for native callback acquisition.
  connect(callback: (error: Error | undefined, client: PostgresPoolClient | undefined, release: (error?: Error | boolean) => void) => void): Promise<void>;
} : T extends { connect: Callable } ? {
  connect(...args: Parameters<T['connect']>): Promise<Awaited<ReturnType<T['connect']>>>;
} : {});
export type PostgresClient<T extends ClientTarget = Client> = Omit<T, 'query' | 'connect'> & {
  query: T extends Client ? PostgresQuery : T['query'];
  // Client callback timing is retained at runtime, but is not certified by this API.
  connect(): Promise<T extends Client ? PostgresClient<T> : Awaited<ReturnType<T['connect']>>>;
};

export const POSTGRES_TIME_SESSION_OPTIONS = '-c timezone=Asia/Shanghai -c datestyle=ISO,YMD';

export class PostgresBoundaryError extends TypeError {
  declare code: string;
  constructor(code: string) {
    super(code);
    this.name = 'PostgresBoundaryError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new PostgresBoundaryError(code);
}

function assertSafeParameter(value: unknown, ancestors: Set<object>): void {
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

export function assertNoDateQueryParameters(values: unknown): unknown[] | undefined {
  if (values === undefined) return values;
  if (!Array.isArray(values)) fail('POSTGRES_QUERY_VALUES_ARRAY_REQUIRED');
  assertSafeParameter(values, new Set());
  return values;
}

function valuesFromQueryArguments(first: unknown, second: unknown): unknown {
  if (first && typeof first === 'object' && !Array.isArray(first) && Object.hasOwn(first, 'values')) {
    return (first as { values: unknown }).values;
  }
  return Array.isArray(second) ? second : undefined;
}

function guardQuery<T>(target: T): T {
  // Preserve this dynamic adapter's pass-through for absent/non-query targets.
  const candidate = target as { query?: Callable } | null | undefined;
  if (!candidate || typeof candidate.query !== 'function' || candidate.query.__arch005Guarded === true) return target;
  const original = candidate.query.bind(target);
  const guarded = function guardedPostgresQuery(first: unknown, second: unknown, third: unknown): unknown {
    assertNoDateQueryParameters(valuesFromQueryArguments(first, second));
    return Reflect.apply(original, undefined, [first, second, third]);
  };
  Object.defineProperty(guarded, '__arch005Guarded', { value: true });
  candidate.query = guarded;
  return target;
}

async function initializeSession(client: SessionClient): Promise<void> {
  await client.query("SET TIME ZONE 'Asia/Shanghai'");
  await client.query("SET DateStyle = 'ISO, YMD'");
}

function poolConfig(config: PoolConfig, onConnect: PoolConfig['onConnect']): PoolConfig {
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

export function createPostgresPool(config: PoolConfig): PostgresPool;
export function createPostgresPool<T extends PoolTarget>(config: PoolConfig, injection: { PoolClass: new (config: PoolConfig) => T }): PostgresPool<T>;
export function createPostgresPool(config: PoolConfig, { PoolClass = Pool }: { PoolClass?: new (config: PoolConfig) => PoolTarget } = {}) {
  if (typeof PoolClass !== 'function') fail('POSTGRES_POOL_CLASS_INVALID');
  const pool = new PoolClass(poolConfig(config, config?.onConnect));
  guardQuery(pool);
  if (typeof pool.connect === 'function') {
    const originalConnect = pool.connect.bind(pool);
    pool.connect = async function guardedConnect(...args: unknown[]): Promise<unknown> {
      const callback = args[0];
      if (typeof callback === 'function') {
        args[0] = function guardedConnectCallback(this: unknown, ...callbackArgs: unknown[]): unknown {
          if (callbackArgs.length > 1) callbackArgs[1] = guardQuery(callbackArgs[1]);
          return Reflect.apply(callback, this, callbackArgs);
        };
      }
      const client: unknown = await Reflect.apply(originalConnect, undefined, args);
      return guardQuery(client);
    };
  }
  return pool;
}

export function createPostgresClient(config?: ClientConfig): PostgresClient;
export function createPostgresClient<T extends ClientTarget>(config: ClientConfig | undefined, injection: { ClientClass: new (config: ClientConfig) => T }): PostgresClient<T>;
export function createPostgresClient(config?: ClientConfig, { ClientClass = Client }: { ClientClass?: new (config: ClientConfig) => ClientTarget } = {}) {
  if (typeof ClientClass !== 'function') fail('POSTGRES_CLIENT_CLASS_INVALID');
  const client = new ClientClass({
    ...config,
    options: config?.options ?? POSTGRES_TIME_SESSION_OPTIONS,
    types: config?.types ?? stringPreservingPgTypes,
  });
  const originalConnect = client.connect.bind(client);
  client.connect = async function guardedClientConnect(...args: unknown[]): Promise<unknown> {
    const result: unknown = await Reflect.apply(originalConnect, undefined, args);
    await initializeSession(client);
    return result;
  };
  return guardQuery(client);
}

export function guardPostgresQueryClient<T>(client: T): T {
  return guardQuery(client);
}
