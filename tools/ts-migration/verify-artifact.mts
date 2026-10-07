import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { controlledBuildRoot, hash, identity, mappings, outputFiles, record, safeFile, sourceRoot } from './common.mjs';

export function verifyArtifact(root: string, expectedManifest?: string): string {
  const runtime = path.join(controlledBuildRoot(root), 'runtime');
  const text = readFileSync(safeFile(runtime, 'build-manifest.json'), 'utf8');
  const digest = hash(text), proof = record(JSON.parse(readFileSync(safeFile(root, '.build/artifact-proof.json'), 'utf8')) as unknown);
  if (digest !== (expectedManifest ?? proof.manifest_sha256)) throw new Error('MIGRATION_MANIFEST_TAMPERED');
  const manifest = record(JSON.parse(text) as unknown), current = identity(root);
  if (manifest.schema_version !== 1 || manifest.status !== 'STAGED_NOT_ACTIVATED' || manifest.node_major !== 24 || manifest.compiler !== ts.version
    || JSON.stringify(manifest.source) !== JSON.stringify(current) || proof.source_input_hash !== current.input_hash) throw new Error('MIGRATION_INPUT_DRIFT');
  if (!Array.isArray(manifest.outputs)) throw new Error('MIGRATION_OUTPUT_SCHEMA');
  const expected = mappings(root), seen = manifest.outputs.map((value: unknown) => record(value));
  if (seen.length !== expected.length) throw new Error('MIGRATION_OUTPUT_COUNT');
  for (const [i, item] of expected.entries()) {
    const actual = seen[i];
    if (!actual || actual.path !== item.path || actual.source !== item.source || actual.kind !== item.kind) throw new Error('MIGRATION_OUTPUT_MAPPING');
    const bytes = readFileSync(safeFile(runtime, item.path));
    if (actual.sha256 !== hash(bytes)) throw new Error('MIGRATION_OUTPUT_TAMPERED: ' + item.path);
    if (item.kind !== 'COMPILED'&&item.kind!=='WEB' && !bytes.equals(readFileSync(safeFile(root, item.source)))) throw new Error('MIGRATION_LEGACY_OR_RESOURCE_DRIFT');
    if(item.kind==='WEB'&&!bytes.equals(readFileSync(safeFile(root,'.build/emit/'+item.path))))throw new Error('WEB01_OUTPUT_DRIFT');
    if (item.path.endsWith('.map')) {
      const map = record(JSON.parse(bytes.toString('utf8')) as unknown);
      if (!Array.isArray(map.sources) || map.sources.some((v: unknown) => typeof v !== 'string' || path.isAbsolute(v))) throw new Error('MIGRATION_ABSOLUTE_SOURCE_MAP');
    }
  }
  const actualFiles = outputFiles(runtime);
  const expectedFiles = [...expected.map(item => item.path), 'build-manifest.json'].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('MIGRATION_UNDECLARED_OUTPUT');
  return digest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ status: 'ARTIFACT_VERIFIED_NOT_ACTIVATED', manifest_sha256: verifyArtifact(sourceRoot(), process.argv[2]) }));
