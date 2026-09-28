import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, record, slash, sourceRoot, outputPath, codeFiles } from './common.mjs';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { loadRoutes, select, testEnvironment, execution, type Selection } from './routing.mjs';

export type Counts = { tests: number; pass: number; fail: number; cancelled: number; skipped: number; todo: number };
export function counts(tap: string): Counts {
  const result = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const key of Object.keys(result) as (keyof Counts)[]) {
    const matches = [...tap.matchAll(new RegExp('^# ' + key + ' (\\d+)\\r?$', 'gmu'))];
    const match = matches.at(-1)?.[1];
    if (match === undefined) throw new Error('MIGRATION_TEST_REPORT_INCOMPLETE: ' + key);
    result[key] = Number(match);
  }
  return result;
}
function loadedFiles(coverage: string): string[] {
  const urls = new Set<string>();
  for (const name of readdirSync(coverage).filter(n => n.endsWith('.json'))) {
    const doc = record(JSON.parse(readFileSync(path.join(coverage, name), 'utf8')) as unknown);
    if (!Array.isArray(doc.result)) throw new Error('MIGRATION_COVERAGE_SCHEMA');
    for (const item of doc.result) {
      const value = record(item);
      if (typeof value.url === 'string' && value.url.startsWith('file:')) urls.add(fileURLToPath(value.url));
    }
  }
  return [...urls].sort();
}
export function runSelection(root: string, selection: Selection, options: { reference?: boolean; reportDir?: string } = {}): Counts {
  const manifest = verifyArtifact(root), env = testEnvironment(root, selection.entries);
  if (options.reference && codeFiles(root).some(p => /^(src|scripts)\//u.test(p) && p.endsWith('.mts') && p !== 'src/migration-canary.mts')) throw new Error('MIGRATION_SOURCE_REFERENCE_RETIRED');
  const total: Counts = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const log = options.reportDir ?? mkdtempSync(path.join(tmpdir(), 'ts-migration-results-'));
  if (path.relative(root, path.resolve(log)) === '' || !path.relative(root, path.resolve(log)).startsWith('..') && !path.isAbsolute(path.relative(root, path.resolve(log)))) throw new Error('MIGRATION_REPORT_MUST_BE_OUTSIDE_SOURCE');
  mkdirSync(log, { recursive: true });
  const files: Record<string, unknown>[] = [];
  for (const [index, entry] of selection.entries.entries()) {
    const target = execution(root, entry, options.reference), coverage = mkdtempSync(path.join(tmpdir(), 'ts-migration-coverage-'));
    const nodeFlags = [...new Set([...selection.flags, ...entry.node_flags])];
    if (!nodeFlags.some(f => f.startsWith('--test-concurrency='))) nodeFlags.push('--test-concurrency=1');
    const args = [...nodeFlags, '--test', '--test-reporter=tap', target.file];
    const prefix = String(index + 1).padStart(3, '0') + '-' + path.basename(entry.path);
    try {
      const result = spawnSync(process.execPath, args, { cwd: target.cwd, env: { ...env, NODE_V8_COVERAGE: coverage }, encoding: 'utf8', windowsHide: true, timeout: 240_000, maxBuffer: 32 * 1024 * 1024 });
      const redact = (text: string): string => {
        const raw = env.PILOT_DATABASE_URL;
        const secrets = raw ? [raw, new URL(raw).password, decodeURIComponent(new URL(raw).password)].filter(Boolean) : [];
        return secrets.reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), text);
      };
      const text = redact(result.stdout ?? ''), stderr = redact(result.stderr ?? '');
      writeFileSync(path.join(log, prefix + '.tap'), text); writeFileSync(path.join(log, prefix + '.stderr'), stderr);
      process.stdout.write(text); process.stderr.write(stderr);
      if (result.error) throw result.error;
      const c = counts(text), loaded = loadedFiles(coverage);
      if (!loaded.some(p => path.relative(p, target.file) === '')) throw new Error('MIGRATION_TEST_NOT_EXECUTED: ' + entry.path);
      const projectLoaded = loaded.filter(p => !path.relative(root, p).startsWith('..') && !path.isAbsolute(path.relative(root,p))).map(p => slash(path.relative(root, p)));
      if (!options.reference && entry.mode !== 'SOURCE_HOST' && projectLoaded.some(p => /^(?:src|scripts|tests)\//u.test(p))) throw new Error('MIGRATION_RUNTIME_LOADED_SOURCE: ' + entry.path);
      const fileResult = { path: entry.path, runtime_path: outputPath(entry.path), mode: target.mode, node_flags: nodeFlags, exit_code: result.status, counts: c, loaded_project_files: projectLoaded,
        tap_sha256: hash(text), stderr_sha256: hash(stderr) };
      files.push(fileResult);
      writeFileSync(path.join(log, prefix + '.json'), JSON.stringify(fileResult, null, 2) + '\n');
      if (result.status !== 0 || c.fail || c.cancelled || c.skipped || c.todo || !c.tests || c.tests !== c.pass) throw new Error('MIGRATION_TEST_NOT_PASS: ' + entry.path);
      for (const key of Object.keys(total) as (keyof Counts)[]) total[key] += c[key];
    } finally { rmSync(coverage, { recursive: true, force: true }); }
  }
  verifyArtifact(root, manifest);
  writeFileSync(path.join(log, 'summary.json'), JSON.stringify({ selection: selection.label, status: 'SELECTED_TESTS_PASS', representation: options.reference ? 'REFERENCE_SOURCE' : 'EXPLICIT_ROUTED_HOSTS', manifest_sha256: manifest, files, counts: total, production_ready: false }, null, 2) + '\n');
  console.log(JSON.stringify({ selection: selection.label, ...total, log_directory: log, production_ready: false }));
  return total;
}
export function runTests(root: string): void { runSelection(root, select(loadRoutes(root), 'selection', 'canary')); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = sourceRoot();
  let kind: 'alias' | 'selection' = 'selection', name = 'canary', reference = false;
  let reportDir: string | undefined;
  const args = process.argv.slice(2);
  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    if (arg === '--reference-source') reference = true;
    else if (arg === '--alias' || arg === '--selection' || arg === '--report-dir') {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('MIGRATION_ARGUMENT_VALUE_REQUIRED');
      if (arg === '--report-dir') reportDir = path.resolve(value); else { kind = arg === '--alias' ? 'alias' : 'selection'; name = value; }
    } else throw new Error('MIGRATION_UNKNOWN_RUNNER_ARGUMENT');
  }
  const selected = select(loadRoutes(root), kind, name);
  testEnvironment(root, selected.entries); // Fail missing isolation before doing build work.
  build(root);
  runSelection(root, selected, { reference, ...(reportDir ? { reportDir } : {}) });
}
