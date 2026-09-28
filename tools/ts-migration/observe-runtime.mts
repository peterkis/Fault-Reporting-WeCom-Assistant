import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { sourceRoot, hash, record, git } from './common.mjs';

// A side-effect-free observation uses real exported guards and data, not a type-only fixture.
const probe = `
import {pathToFileURL} from 'node:url'; import path from 'node:path';
const root=process.cwd();
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const names=['src/platform/time-contract.mjs','src/p2-007-domain-utils.mjs','src/p2-007-staff-directory-contracts.mjs','src/p2-016-domain-contracts.mjs','src/platform/postgres-types.mjs','src/platform/legacy-migration-guard.mjs','src/platform/postgres-pool.mjs'];
const modules=await Promise.all(names.map(load));const [time,json,staff,ticket,parsers,legacy,pg]=modules;
const outcome=fn=>{try{return {ok:true,data:fn()};}catch(e){return {ok:false,code:e.code??e.message,status:e.status??null};}};
const value={status:'WAITING_VENDOR',version:3,memberships:[{department_ref:'synthetic-dept',role:'MEMBER'}]};
const results={exports:names.map((p,i)=>({path:p,exports:Object.keys(modules[i]).sort()})),
clock:outcome(()=>time.formatEpochMsToShanghaiLocal('0')), invalidClock:outcome(()=>time.assertLocalDateTime('wrong')),
copy:outcome(()=>json.assertPlainJson(value)),badJson:outcome(()=>json.assertPlainJson({invalid:undefined})),
flags:outcome(()=>ticket.flagsP2016()),limit:outcome(()=>ticket.limitP2016('100')),badLimit:outcome(()=>ticket.limitP2016('0')),
snapshot:outcome(()=>ticket.publicP2016(value)),capacity:staff.THIRD_STAFF_DIRECTORY_LIMITS};
results.timeCases=['0','1788406496000','8640000000000001','-1','01'].map(x=>outcome(()=>time.formatEpochMsToShanghaiLocal(x)));
results.roundTrips=['2024-02-29 23:59:59','1970-01-01 07:59:59'].map(x=>outcome(()=>time.formatEpochMsToShanghaiLocal(time.shanghaiLocalToEpochMs(x))));
results.parserCases=['2026-09-03 04:34:56.123456+00','2026-09-03T12:34:56+0800','2026-09-03 12:34:56+15',null].map(x=>outcome(()=>parsers.postgresTimestampToLocalDateTime(x)));
const parserCalls=[];const parser=v=>({raw:v});const types=parsers.createStringPreservingPgTypes({getTypeParser(oid,format){parserCalls.push([oid,format]);return parser;}});
results.parsers=[types.getTypeParser('20')('9223372036854775807'),types.getTypeParser(23)('1'),types.getTypeParser(20,'binary')('bytes')];results.parserCalls=parserCalls;
const sql=[];results.marker=await legacy.arch005MigrationApplied({async query(text){sql.push(text);return {rows:sql.length===1?[{marker_table_exists:true}]:[{applied:true}]};}});results.sql=sql;
const writes=[];const write=process.stdout.write;process.stdout.write=text=>{writes.push(text);return true;};
try {await legacy.stopLegacyMigrationAfterArch005({async query(){return {rows:[{marker_table_exists:true,applied:true}]};}},'synthetic');}catch(e){results.legacyError={message:e.message,keys:Object.keys(e),code:e.code,migration_id:e.migration_id};}finally{process.stdout.write=write;}
results.legacyWrites=writes;
const order=[];class FakeClient{constructor(config){this.config=config;}query(...args){order.push(args);return {rows:[]};}async connect(){order.push('connect');return 'connected';}}
const client=pg.createPostgresClient({}, {ClientClass:FakeClient});results.clientReturn=await client.connect();results.clientOptions=client.config.options;results.clientOrder=order;
results.rejected=outcome(()=>client.query('SELECT $1',[new Date(0)]));
results.errorKeys=Object.keys(new pg.PostgresBoundaryError('X'));
console.log(JSON.stringify(results));`;
function observe(root: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TZ: 'Asia/Shanghai' }, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2*1024*1024 });
  if (result.status !== 0 || result.error) throw new Error('MIGRATION_OBSERVATION_FAILED: ' + result.stderr);
  return record(JSON.parse(result.stdout.trim()) as unknown);
}
export function compareRuntime(root: string, referenceRoot: string): Record<string, unknown> {
  if (git(referenceRoot, ['rev-parse', 'HEAD']) !== '7eefaa99591bfaa2e787701efd315ff701c51f35' || git(referenceRoot, ['status', '--porcelain'])) throw new Error('MIGRATION_REFERENCE_NOT_CLEAN_T02');
  const reference = observe(referenceRoot), first = build(root), digest = verifyArtifact(root);
  const one = observe(path.join(root, '.build/runtime'));
  const second = build(root), two = observe(path.join(root, '.build/runtime'));
  assert.deepEqual(reference, one); assert.deepEqual(one, two);
  assert.equal(digest, verifyArtifact(root)); assert.deepEqual(first.outputs, second.outputs);
  return { status: 'SOURCE_AND_TWO_SHADOWS_EQUIVALENT', observation: reference, observation_sha256: hash(JSON.stringify(reference)), manifest_sha256: digest, production_ready: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(compareRuntime(sourceRoot(), process.argv[2] ?? (() => { throw new Error('MIGRATION_REFERENCE_ROOT_REQUIRED'); })())));
