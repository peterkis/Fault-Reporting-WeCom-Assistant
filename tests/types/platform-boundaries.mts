import type { LocalDate, LocalTime, LocalDateTime, PhysicalEpochMs } from '../../contracts/time_contracts.js';
import { assertLocalDate, assertLocalTime, assertLocalDateTime, assertEpochMsString, formatEpochMsToShanghaiLocal, shanghaiLocalToEpochMs, addEpochMilliseconds } from '../../src/platform/time-contract.mjs';
import { createPostgresPool, createPostgresClient } from '../../src/platform/postgres-pool.mjs';
const date: LocalDate = assertLocalDate('2024-02-29');
const time: LocalTime = assertLocalTime('12:30');
const local: LocalDateTime = formatEpochMsToShanghaiLocal(assertEpochMsString('0'));
const epoch: PhysicalEpochMs = shanghaiLocalToEpochMs(assertLocalDateTime('2024-02-29 12:30:00'));
// @ts-expect-error -- Local calendar time is not a physical epoch brand.
const wrongEpoch: PhysicalEpochMs = local;
// @ts-expect-error -- Epoch values remain strings rather than numeric milliseconds.
const wrongNumber: number = epoch;
// @ts-expect-error -- Millisecond arithmetic requires a numeric integer delta.
addEpochMilliseconds(epoch, '1');
const pool = createPostgresPool({ max: 1 });
const client = createPostgresClient({});
const result = await pool.query<{ value: string }>('SELECT $1::text AS value', ['value']);
const value: string | undefined = result.rows[0]?.value;
const unknownResult = await pool.query('SELECT 1 AS value');
// @ts-expect-error -- An unspecified database row must not leak an unchecked value.
const unchecked: string = unknownResult.rows[0]?.value;
const callbackReturn: void = pool.query<{ value: string }>({ text: 'SELECT $1', values: ['value'] }, (error, result) => { const row: string | undefined = result.rows[0]?.value; void [error,row]; });
const acquired = await pool.connect();
acquired.release();
await client.connect();
await client.query<{ value: string }>('SELECT $1', ['value']);
void [date,time,local,epoch,wrongEpoch,wrongNumber,value,unchecked,callbackReturn];

const connected = await client.connect();
// @ts-expect-error -- Awaited client connections must retain the unknown-row boundary.
const connectedLeak: string = (await connected.query('SELECT 1')).rows[0]?.value;
pool.on('connect', async connection => {
  // @ts-expect-error -- Event clients must not expose unchecked default row values.
  const eventLeak: string = (await connection.query('SELECT 1')).rows[0]?.value;
  void eventLeak;
});
import { createStringPreservingPgTypes } from '../../src/platform/postgres-types.mjs';
// @ts-expect-error -- A parser factory must return parser functions, never a scalar.
createStringPreservingPgTypes({ getTypeParser() { return 42; } });
const textParser = createStringPreservingPgTypes().getTypeParser(20);
// @ts-expect-error -- Text parser inputs are strings, distinct from binary buffers.
textParser(Buffer.from('1'));
const binaryParser = createStringPreservingPgTypes().getTypeParser(20, 'binary');
// @ts-expect-error -- Binary parser inputs are buffers rather than text.
binaryParser('1');
void connectedLeak;

class IndependentPool {
  query(text: string): { text: string } { return {text}; }
  connect(value: number): number { return value; }
  on(event: 'custom'): string { return event; }
}
const injected = createPostgresPool({}, {PoolClass: IndependentPool});
const customEvent: string = injected.on('custom');
const customConnection: number = await injected.connect(1);
const customResult: {text: string} = injected.query('text');
const arrayResult = await pool.query<[string]>({text:'SELECT 1',rowMode:'array'});
const arrayValue: string | undefined = arrayResult.rows[0]?.[0];
// @ts-expect-error -- Invalid pool maxima cannot be supplied as strings.
createPostgresPool({max:'8'});
void [customEvent,customConnection,customResult,arrayValue];

pool.query({text:'SELECT $1',rowMode:'array'}, ['value'], (error, result) => {
  const row: unknown[] | undefined = result.rows[0];
  void [error,row];
});
