import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sourceRoot, record } from './common.mjs';
import { verifyArtifact } from './verify-artifact.mjs';

const probe = `
import {pathToFileURL} from 'node:url';import path from 'node:path';
const root=process.env.T03_INVENTORY_ROOT;const runtime=process.cwd();const m=await import(pathToFileURL(path.join(runtime,'src/p2-g2-candidate.mjs')));
const inventory=m.g2CandidateInventory(root);let rejection,liveRejection;
const config=await import(pathToFileURL(path.join(runtime,'src/p2-g2-validation-config.mjs')));
const {configurationFixture}=await import(pathToFileURL(path.join(runtime,'tests/helpers/p2-g2-configuration-fixture.mjs')));
const old=configurationFixture('live');old.manifest.candidate_fingerprint=process.env.T02_OLD_SOURCE_FINGERPRINT??'0'.repeat(64);
try{config.readG2Configuration({...old,candidateFingerprint:inventory.fingerprint});}catch(e){liveRejection=e.code??e.message;}

try{m.verifyG2Candidate(process.env.T02_OLD_SOURCE_FINGERPRINT??'0'.repeat(64),root);}catch(e){rejection=e.code??e.message;}
console.log(JSON.stringify({schema:inventory.schema_version,fingerprint:inventory.fingerprint,file_count:inventory.file_count,algorithm:inventory.algorithm,rejection,liveRejection,files:inventory.files.map(f=>f.path)}));`;
export function g2Fingerprints(root: string): Record<string, unknown> {
  const manifest = verifyArtifact(root);
  const get = (cwd: string, old?: string): Record<string, unknown> => {
    const result = spawnSync(process.execPath, ['--input-type=module','-e',probe], { cwd:path.join(root,'.build/runtime'), env:{ T03_INVENTORY_ROOT:cwd, PATH:process.env.PATH, SystemRoot:process.env.SystemRoot, ...(old ? {T02_OLD_SOURCE_FINGERPRINT:old}: {}) }, encoding:'utf8',windowsHide:true,timeout:30_000,maxBuffer:4*1024*1024 });
    if(result.status!==0 || result.error)throw new Error('MIGRATION_G2_INVENTORY_FAILED: '+result.stderr);
    return record(JSON.parse(result.stdout.trim()) as unknown);
  };
  const source = get(root); assert.equal(typeof source.fingerprint,'string');
  const artifact = get(path.join(root,'.build/runtime'), String(source.fingerprint));
  assert.notEqual(source.fingerprint,artifact.fingerprint);
  assert.ok(Array.isArray(source.files) && source.files.includes('tsconfig.migration.json'));
  assert.ok(Array.isArray(artifact.files) && artifact.files.includes('build-manifest.json'));
  assert.equal(artifact.rejection, 'P2_G2_CANDIDATE_CHANGED'); assert.equal(artifact.liveRejection,'P2_G2_CANDIDATE_CHANGED');
  return { status:'G2_MIGRATION_SYNTHETIC_IDENTITY_ONLY', source, artifact, manifest_sha256:manifest, old_source_approval_reused:false, live_authorized:false };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(g2Fingerprints(sourceRoot())));
