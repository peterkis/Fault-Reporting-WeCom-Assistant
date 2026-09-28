import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { diagnosticHost, hash, parsedConfig, program, slash, sourceRoot } from './common.mjs';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { runTests } from './run-tests.mjs';

export function typeGate(root: string): void {
  program(root, 'tsconfig.tools.json'); program(root, 'tsconfig.migration.json'); program(root, 'tsconfig.type-tests.json');
}
export function negativeTypes(root: string): void {
  const options = { ...parsedConfig(root, 'tsconfig.type-tests.json').options, noEmit: true };
  const filename = slash(path.join(root, 'tests/types/__intentional_negative__.mts'));
  for (const bad of [false, true]) {
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (f, language, onError, shouldCreate) => f === filename ? ts.createSourceFile(f,
      `import { canary } from '../../src/migration-canary.mjs';\ncanary({ label: 'checked', sequence: ${bad ? "'invalid'" : '1'} });`, language, true, ts.ScriptKind.TS)
      : original(f, language, onError, shouldCreate);
    const candidate = ts.createProgram([filename], options, host), errors = ts.getPreEmitDiagnostics(candidate);
    if (bad ? !errors.some(e => e.code === 2322 && e.file?.fileName === filename) : errors.length !== 0) throw new Error('MIGRATION_NEGATIVE_TYPE_CANARY_FAILED\n' + ts.formatDiagnosticsWithColorAndContext(errors, diagnosticHost(root)));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = sourceRoot(), action = process.argv[2] ?? 'all';
  if (!['all','types','type-tests'].includes(action)) throw new Error('MIGRATION_UNKNOWN_GATE');
  typeGate(root); negativeTypes(root);
  if (action === 'all') {
    const first = build(root), firstDigest = verifyArtifact(root);
    const second = build(root), secondDigest = verifyArtifact(root);
    if (firstDigest !== secondDigest || hash(JSON.stringify(first.outputs)) !== hash(JSON.stringify(second.outputs))) throw new Error('MIGRATION_NONDETERMINISTIC_BUILD');
    runTests(root);
  }
  console.log(JSON.stringify({ status: 'MIGRATION_GATE_PASS', scope: action, compiler: ts.version, production_ready: false }));
}
