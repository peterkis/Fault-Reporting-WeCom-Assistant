import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { sourceRoot, hash, record } from './common.mjs';

// A side-effect-free observation uses real exported guards and data, not a type-only fixture.
const probe = `
import {pathToFileURL} from 'node:url'; import path from 'node:path';
const root=process.cwd();
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const names=['src/platform/time-contract.mjs','src/p2-007-domain-utils.mjs','src/p2-007-staff-directory-contracts.mjs','src/p2-016-domain-contracts.mjs'];
const modules=await Promise.all(names.map(load));const [time,json,staff,ticket]=modules;
const outcome=fn=>{try{return {ok:true,data:fn()};}catch(e){return {ok:false,code:e.code??e.message,status:e.status??null};}};
const value={status:'WAITING_VENDOR',version:3,memberships:[{department_ref:'synthetic-dept',role:'MEMBER'}]};
const results={exports:names.map((p,i)=>({path:p,exports:Object.keys(modules[i]).sort()})),
clock:outcome(()=>time.formatEpochMsToShanghaiLocal('0')), invalidClock:outcome(()=>time.assertLocalDateTime('wrong')),
copy:outcome(()=>json.assertPlainJson(value)),badJson:outcome(()=>json.assertPlainJson({invalid:undefined})),
flags:outcome(()=>ticket.flagsP2016()),limit:outcome(()=>ticket.limitP2016('100')),badLimit:outcome(()=>ticket.limitP2016('0')),
snapshot:outcome(()=>ticket.publicP2016(value)),capacity:staff.THIRD_STAFF_DIRECTORY_LIMITS};
console.log(JSON.stringify(results));`;
function observe(root: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TZ: 'Asia/Shanghai' }, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2*1024*1024 });
  if (result.status !== 0 || result.error) throw new Error('MIGRATION_OBSERVATION_FAILED: ' + result.stderr);
  return record(JSON.parse(result.stdout.trim()) as unknown);
}
export function compareRuntime(root: string): Record<string, unknown> {
  const reference = observe(root), first = build(root), digest = verifyArtifact(root);
  const one = observe(path.join(root, '.build/runtime'));
  const second = build(root), two = observe(path.join(root, '.build/runtime'));
  assert.deepEqual(reference, one); assert.deepEqual(one, two);
  assert.equal(digest, verifyArtifact(root)); assert.deepEqual(first.outputs, second.outputs);
  return { status: 'SOURCE_AND_TWO_SHADOWS_EQUIVALENT', observation: reference, observation_sha256: hash(JSON.stringify(reference)), manifest_sha256: digest, production_ready: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(compareRuntime(sourceRoot())));
