import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertEpochMsString, assertLocalDate, addEpochMilliseconds, compareLocalDateTime, nowShanghaiLocal, shanghaiLocalToEpochMs, formatEpochMsToShanghaiLocal, TimeContractError } from '../src/platform/time-contract.mjs';
import { createStringPreservingPgTypes, postgresTimestampToLocalDateTime, STRING_PRESERVED_POSTGRES_OIDS } from '../src/platform/postgres-types.mjs';
import { arch005MigrationApplied, stopLegacyMigrationAfterArch005 } from '../src/platform/legacy-migration-guard.mjs';
import { assertNoDateQueryParameters, createPostgresClient, createPostgresPool, guardPostgresQueryClient, POSTGRES_TIME_SESSION_OPTIONS } from '../src/platform/postgres-pool.mjs';

test('time boundaries retain leap/range errors, string epochs, comparison and enumerable error shape', () => {
  assert.equal(assertLocalDate('2000-02-29'),'2000-02-29');
  for (const value of ['1900-02-29','0000-01-01','2024-13-01']) assert.throws(()=>assertLocalDate(value), {code:'LOCAL_DATE_INVALID'});
  assert.equal(assertEpochMsString('8640000000000001'),'8640000000000001');
  assert.throws(()=>formatEpochMsToShanghaiLocal('8640000000000001'),{code:'EPOCH_MS_OUT_OF_RANGE'});
  assert.throws(()=>shanghaiLocalToEpochMs('1970-01-01 07:59:59'),{code:'EPOCH_MS_OUT_OF_RANGE'});
  assert.throws(()=>addEpochMilliseconds('0',-1),{code:'EPOCH_MS_OUT_OF_RANGE'});
  assert.throws(()=>addEpochMilliseconds('0',0.5),{code:'EPOCH_MS_STRING_INVALID'});
  assert.equal(nowShanghaiLocal({nowEpochMs:'0'}),'1970-01-01 08:00:00');
  for(const value of ['2024-02-29 23:59:59','2024-03-01 00:00:00']) assert.equal(formatEpochMsToShanghaiLocal(shanghaiLocalToEpochMs(value)),value);
  assert.equal(compareLocalDateTime('2024-03-01 00:00:00','2024-03-01 00:00:00'),0);
  assert.equal(compareLocalDateTime('2024-03-01 00:00:01','2024-03-01 00:00:00'),1);
  assert.deepEqual(Object.keys(new TimeContractError('X')),['name','code']);
});

test('parser text OIDs preserve strings and other/binary parsers retain receiver and original arguments', () => {
  const calls: unknown[][]=[];
  const parser=(value: unknown)=>({value});
  const base={getTypeParser(oid: number, format?: 'text'|'binary') { assert.equal(this,base);calls.push([oid,format]);return parser; }};
  const types=createStringPreservingPgTypes(base);
  for(const oid of Object.values(STRING_PRESERVED_POSTGRES_OIDS)) {
    assert.equal(types.getTypeParser(oid)('9223372036854775807'),'9223372036854775807');
    assert.equal(Reflect.apply(types.getTypeParser,types,[String(oid)])('raw'),'raw');
    assert.equal(types.getTypeParser(oid,'binary'),parser);
  }
  assert.equal(types.getTypeParser(23),parser);
  Reflect.apply(types.getTypeParser,types,['23','binary']);
  assert.deepEqual(calls.at(-1),['23','binary']);
  assert.equal(calls.length,8);
  assert.equal(Object.isFrozen(types),true);
  assert.equal(postgresTimestampToLocalDateTime('2026-09-03 04:34:56.123456+00'),'2026-09-03 12:34:56');
  assert.equal(postgresTimestampToLocalDateTime('2026-09-03T12:34:56+0800'),'2026-09-03 12:34:56');
  for(const value of [null,'2026-02-30 00:00:00+00','2026-09-03 12:34:56+15','2026-09-03 12:34:56Z']) assert.throws(()=>postgresTimestampToLocalDateTime(value));
});

test('legacy guard retains query ordering, strict true checks, error propagation and stdout contract', async t => {
  for(const first of [[],[{marker_table_exists:false}],[{marker_table_exists:'true'}]]) {
    let count=0;
    assert.equal(await arch005MigrationApplied({async query(){count++;return {rows:first};}}),false);
    assert.equal(count,1);
  }
  const sql: string[]=[];
  const queryable={async query(text: string){sql.push(text);return {rows:sql.length%2 ? [{marker_table_exists:true}] : [{applied:true}]};}};
  assert.equal(await arch005MigrationApplied(queryable),true);
  assert.match(sql[0] ?? '',/pg_catalog\.pg_class/u);assert.match(sql[1] ?? '',/022_arch_005_asia_shanghai_time_contract/u);
  const writes: unknown[]=[];
  t.mock.method(process.stdout,'write',(chunk: unknown)=>{writes.push(chunk);return true;});
  await assert.rejects(stopLegacyMigrationAfterArch005(queryable,'test-id'),{message:'LEGACY_MIGRATION_SUPERSEDED',code:'LEGACY_MIGRATION_SUPERSEDED',migration_id:'test-id'});
  assert.deepEqual(writes,['{"ok":true,"status":"LEGACY_MIGRATION_SUPERSEDED","migration_id":"test-id","superseded_by":"022_arch_005_asia_shanghai_time_contract","write_performed":false}\n']);
  const failure=new Error('query failed');
  await assert.rejects(arch005MigrationApplied({async query(){throw failure;}}),error=>error===failure);
});

test('parameter boundary retains cyclic/getter/proxy/key rejection and binary acceptance', () => {
  const cycle: unknown[]=[];cycle.push(cycle);
  for(const value of [cycle,[new Proxy({}, {})],[{get x(){throw new Error('getter executed');}}],[Object.create(null,{constructor:{value:1}})],[{toJSON(){return 1;}}]]) assert.throws(()=>assertNoDateQueryParameters(value));
  const values=[Buffer.from('safe'),new Uint8Array([1,2]),{nested:['safe',null]}];
  assert.equal(assertNoDateQueryParameters(values),values);
  let count=0;const result={returned:true};const target={query(...args:unknown[]){assert.equal(this,target);count++;assert.deepEqual(args,['text',[],undefined]);return result;}};
  assert.equal(guardPostgresQueryClient(target),target);const query=target.query;guardPostgresQueryClient(target);assert.equal(target.query,query);
  assert.equal(target.query('text',[]),result);assert.equal(count,1);
});

test('injected factories keep capabilities, config bounds and session initialization order', async () => {
  const calls:string[]=[];
  class FakeClient {
    custom='retained';
    constructor(readonly config: unknown) {}
    query(text:string){calls.push(text);return Promise.resolve({rows:[]});}
    connect(){calls.push('connect');return Promise.resolve('connected');}
  }
  const client=createPostgresClient({}, {ClientClass:FakeClient});
  assert.equal(client.custom,'retained');
  assert.equal(await client.connect(),'connected');
  assert.deepEqual(calls,['connect',"SET TIME ZONE 'Asia/Shanghai'","SET DateStyle = 'ISO, YMD'"]);
  for(const max of [0,9,1.5]) assert.throws(()=>createPostgresPool({max}),{code:'POSTGRES_POOL_MAX_INVALID'});
  const pool=createPostgresPool({max:1});
  assert.equal(pool.options.max,1);assert.equal(pool.options.options,POSTGRES_TIME_SESSION_OPTIONS);await pool.end();
});
