import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { cleanGenerated, controlledBuildRoot, hash, identity, mappings, program, sourceRoot, runNode, type BuildManifest } from './common.mjs';
import {buildWeb} from './web.mjs';

export function build(root: string): BuildManifest {
  sourceRoot(root);
  // Invalidate first: a failed configuration, resource or compile must not leave a usable old artifact.
  for (const name of ['artifact-proof.json', 'runtime', 'emit'] as const) cleanGenerated(root, name);
  const before = identity(root);
  // Preserve source collisions and resource guards before compiling or invoking Vite.
  mappings(root);
  const compiler = program(root, 'tsconfig.migration.json');
  const emitted = compiler.emit();
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error('MIGRATION_EMIT_FAILED');
  const output = path.join(controlledBuildRoot(root), 'runtime');
  try {
    buildWeb(root);
    const map=mappings(root);
    for (const item of map) {
      const from = path.join(root, item.kind === 'COMPILED'||item.kind==='WEB' ? '.build/emit/' + item.path : item.source);
      const to = path.join(output, item.path);
      mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to);
    }
    for (const item of map.filter(f => f.kind === 'COMPILED' && f.path.endsWith('.mjs'))) runNode(root, ['--check', path.join(output, item.path)]);
    const after = identity(root);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('MIGRATION_SOURCE_CHANGED_DURING_BUILD');
    const manifest: BuildManifest = {
      schema_version: 1, status: 'STAGED_NOT_ACTIVATED', node_major: 24, compiler: ts.version, source: before,
      typed_implementations: map.filter(f => f.kind === 'COMPILED' && !f.path.endsWith('.map')).map(f => f.source),
      unchecked_legacy: map.filter(f => f.kind === 'LEGACY').map(f => f.source),
      declaration_inputs: before.inputs.filter(f => /\.d\.(?:ts|mts)$/u.test(f.path)).map(f => f.path),
      outputs: map.map(item => ({ ...item, sha256: hash(readFileSync(path.join(output, item.path))) })),
    };
    const text = JSON.stringify(manifest, null, 2) + '\n';
    writeFileSync(path.join(output, 'build-manifest.json'), text);
    writeFileSync(path.join(root, '.build/artifact-proof.json'), JSON.stringify({ manifest_sha256: hash(text), source_input_hash: before.input_hash }) + '\n');
    return manifest;
  } catch (error) {
    cleanGenerated(root, 'runtime'); cleanGenerated(root, 'artifact-proof.json'); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = build(sourceRoot());
  console.log(JSON.stringify({ status: result.status, source: result.source.head, input_hash: result.source.input_hash, typed: result.typed_implementations.length, unchecked_legacy: result.unchecked_legacy.length, outputs: result.outputs.length }));
}
