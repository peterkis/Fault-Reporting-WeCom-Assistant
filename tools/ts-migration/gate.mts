import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { diagnosticHost, hash, parsedConfig, program, slash, sourceRoot } from './common.mjs';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { runTests, runSelection } from './run-tests.mjs';
import { batchSelection } from './batches.mjs';
import { testEnvironment } from './routing.mjs';

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
  const root = sourceRoot();
  const args = process.argv.slice(2);
  if (args[0] === '--batch') {
    const id = args[1];
    if (!id || id.startsWith('--') || ![2, 4].includes(args.length) || (args.length === 4 && (args[2] !== '--report-dir' || !args[3] || args[3].startsWith('--')))) throw new Error('MIGRATION_BATCH_ARGUMENTS');
    const selected = batchSelection(root, id);
    const report = args[3] ? path.resolve(args[3]) : mkdtempSync(path.join(tmpdir(), 'migration-batch-'));
    const relative = path.relative(root, report);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('MIGRATION_REPORT_MUST_BE_OUTSIDE_SOURCE');
    mkdirSync(report, { recursive: true });
    if (existsSync(path.join(report, 'batch.json')) || existsSync(path.join(report, 'tests'))) throw new Error('MIGRATION_REPORT_ALREADY_EXISTS');
    const receipt: Record<string, unknown> = { batch: id, status: 'FAIL', selected_files: selected.entries.map(e => e.path), not_run: selected.entries.map(e => e.path), behavior: 'NOT_RUN', review: 'NOT_RUN', production_ready: false };
    try {
      testEnvironment(root, selected.entries);
      typeGate(root); negativeTypes(root);
      const first = build(root), digest = verifyArtifact(root);
      const second = build(root);
      if (digest !== verifyArtifact(root) || hash(JSON.stringify(first.outputs)) !== hash(JSON.stringify(second.outputs))) throw new Error('MIGRATION_NONDETERMINISTIC_BUILD');
      receipt.manifest_sha256 = digest;
      receipt.source = second.source;
      receipt.behavior = 'RUNNING';
      receipt.counts = runSelection(root, selected, { reportDir: path.join(report, 'tests') });
      receipt.behavior = 'PASS'; receipt.status = 'MIGRATION_AUTOMATED_CHECKS_PASS_NOT_REVIEW';
    } catch (error) {
      receipt.error = error instanceof Error ? error.message : 'MIGRATION_UNKNOWN_FAILURE';
      if (receipt.behavior === 'RUNNING') receipt.behavior = 'FAIL';
      throw error;
    } finally {
      const testSummary = path.join(report, 'tests/summary.json');
      if (existsSync(testSummary)) {
        const summary: unknown = JSON.parse(readFileSync(testSummary, 'utf8'));
        if (summary !== null && typeof summary === 'object' && 'not_run' in summary) receipt.not_run = summary.not_run;
      }
      writeFileSync(path.join(report, 'batch.json'), JSON.stringify(receipt, null, 2) + '\n');
      console.log(JSON.stringify({ batch: id, status: receipt.status, behavior: receipt.behavior, error: receipt.error, report_directory: report, production_ready: false }));
    }
  } else {
  if (args.length > 1) throw new Error('MIGRATION_UNKNOWN_GATE_ARGUMENT');
  const action = args[0] ?? 'all';
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
}
