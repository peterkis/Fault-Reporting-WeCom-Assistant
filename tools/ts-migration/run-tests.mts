import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash, record, slash, sourceRoot, outputPath, codeFiles, strings, git } from './common.mjs';
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
  const routes = loadRoutes(root);
  let completed = false;
  const summary = (): void => writeFileSync(path.join(log, 'summary.json'), JSON.stringify({
    selection: selection.label, status: completed ? 'SELECTED_TESTS_PASS' : 'SELECTED_TESTS_FAIL',
    representation: options.reference ? 'REFERENCE_SOURCE' : 'EXPLICIT_ROUTED_HOSTS', manifest_sha256: manifest,
    selected_files: selection.entries.map(e => e.path), files,
    not_run: selection.entries.filter(e => !files.some(f => f.path === e.path)).map(e => e.path),
    counts: total, production_ready: false,
  }, null, 2) + '\n');
  try {
  for (const [index, entry] of selection.entries.entries()) {
    const target = execution(root, entry, options.reference), coverage = mkdtempSync(path.join(tmpdir(), 'ts-migration-coverage-'));
    // Legacy tests own and remove their files here; an empty scratch directory is not an artifact.
    if (target.cwd !== root) mkdirSync(path.join(target.cwd, 'tmp'), { recursive: true });
    const nodeFlags = [...new Set([...selection.flags, ...entry.node_flags])];
    if (!nodeFlags.some(f => f.startsWith('--test-concurrency='))) nodeFlags.push('--test-concurrency=1');
    const sourceHook = !options.reference && entry.mode === 'SOURCE_HOST' ? ['--import', pathToFileURL(path.join(root, '.build/tools/source-hook.mjs')).href] : [];
    const args = [...sourceHook, ...nodeFlags, '--test', '--test-reporter=tap', target.file];
    // Preserve the serial browser recovery and two 360-second capacity case budgets.
    const timeoutMs = ['tests/yxx-ss-007-native-ui.browser.test.mjs', 'tests/yxx-ss-009-capacity.integration.test.mjs'].includes(entry.path) ? 900_000 : 240_000;
    const prefix = String(index + 1).padStart(3, '0') + '-' + path.basename(entry.path);
    const fileResult: Record<string, unknown> = { path: entry.path, runtime_path: outputPath(entry.path), mode: target.mode, node_flags: [...sourceHook, ...nodeFlags], status: 'RUNNING', timeout_ms: timeoutMs };
    files.push(fileResult);
    try {
      const result = spawnSync(process.execPath, args, { cwd: target.cwd, env: { ...env, NODE_V8_COVERAGE: coverage }, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
      const redact = (text: string): string => {
        const raw = env.PILOT_DATABASE_URL;
        const secrets = raw ? [raw, new URL(raw).password, decodeURIComponent(new URL(raw).password)].filter(Boolean) : [];
        return secrets.reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), text);
      };
      const text = redact(result.stdout ?? ''), stderr = redact(result.stderr ?? '');
      writeFileSync(path.join(log, prefix + '.tap'), text); writeFileSync(path.join(log, prefix + '.stderr'), stderr);
      process.stdout.write(text); process.stderr.write(stderr);
      Object.assign(fileResult, { exit_code: result.status, signal: result.signal, tap_sha256: hash(text), stderr_sha256: hash(stderr) });
      if (result.error) throw result.error;
      const c = counts(text), loaded = loadedFiles(coverage);
      fileResult.counts = c;
      for (const key of Object.keys(total) as (keyof Counts)[]) total[key] += c[key];
      if (!loaded.some(p => path.relative(p, target.file) === '')) throw new Error('MIGRATION_TEST_NOT_EXECUTED: ' + entry.path);
      const projectLoaded = loaded.filter(p => !path.relative(root, p).startsWith('..') && !path.isAbsolute(path.relative(root,p))).map(p => slash(path.relative(root, p)));
      if (!options.reference && projectLoaded.some(p => p.startsWith('src/'))) throw new Error('MIGRATION_SOURCE_IMPLEMENTATION_LOADED: ' + entry.path);
      if (!options.reference && entry.mode !== 'SOURCE_HOST' && projectLoaded.some(p => /^(?:src|scripts|tests)\//u.test(p))) throw new Error('MIGRATION_RUNTIME_LOADED_SOURCE: ' + entry.path);
      fileResult.loaded_project_files = projectLoaded;
      const requiredChildren = strings(routes.subprocesses[entry.path] ?? []).map(p => options.reference ? p : '.build/runtime/' + outputPath(p));
      if (requiredChildren.some(p => !projectLoaded.includes(p))) throw new Error('MIGRATION_SUBPROCESS_NOT_OBSERVED: ' + entry.path);
      fileResult.observed_subprocess_entries = requiredChildren;
      if (result.status !== 0 || c.fail || c.cancelled || c.skipped || c.todo || !c.tests || c.tests !== c.pass) throw new Error('MIGRATION_TEST_NOT_PASS: ' + entry.path);
      fileResult.status = 'PASS';
    } catch (error) {
      fileResult.status = 'FAIL'; fileResult.error = error instanceof Error ? error.message : 'MIGRATION_UNKNOWN_FAILURE'; throw error;
    } finally {
      writeFileSync(path.join(log, prefix + '.json'), JSON.stringify(fileResult, null, 2) + '\n');
      rmSync(coverage, { recursive: true, force: true });
    }
  }
  verifyArtifact(root, manifest);
  completed = true;
  } finally { summary(); }
  console.log(JSON.stringify({ selection: selection.label, ...total, log_directory: log, production_ready: false }));
  return total;
}
export function runFrozen(root: string, name: string, reportDir: string): void {
  const route = record(loadRoutes(root).frozen[name]);
  const command = strings(route.command);
  const relative = path.relative(root, path.resolve(reportDir));
  if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('MIGRATION_REPORT_MUST_BE_OUTSIDE_SOURCE');
  mkdirSync(reportDir, { recursive: true });
  const result = spawnSync(process.execPath, command.slice(1), { cwd: root, env: testEnvironment(root, []), encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  writeFileSync(path.join(reportDir, 'historical.stdout'), stdout); writeFileSync(path.join(reportDir, 'historical.stderr'), stderr);
  writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify({ mode: 'FROZEN_CHECKOUT', entry_host: 'SOURCE_HOST', source_head: git(root, ['rev-parse', 'HEAD']), command,
    exit_code: result.status, status: result.status === 0 && !result.error ? 'PASS' : 'FAIL', stdout_sha256: hash(stdout), stderr_sha256: hash(stderr), historical_only: true, production_ready: false }, null, 2) + '\n');
  process.stdout.write(stdout); process.stderr.write(stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('MIGRATION_FROZEN_CHECK_FAILED');
}
export function runTests(root: string): void { runSelection(root, select(loadRoutes(root), 'selection', 'canary')); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = sourceRoot();
  let kind: 'alias' | 'selection' = 'selection', name = 'canary', reference = false;
  let reportDir: string | undefined;
  let frozen: string | undefined;
  const args = process.argv.slice(2);
  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    if (arg === '--reference-source') reference = true;
    else if (arg === '--alias' || arg === '--selection' || arg === '--report-dir' || arg === '--frozen') {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('MIGRATION_ARGUMENT_VALUE_REQUIRED');
      if (arg === '--report-dir') reportDir = path.resolve(value); else if (arg === '--frozen') frozen = value; else { kind = arg === '--alias' ? 'alias' : 'selection'; name = value; }
    } else throw new Error('MIGRATION_UNKNOWN_RUNNER_ARGUMENT');
  }
  if (frozen) {
    runFrozen(root, frozen, reportDir ?? mkdtempSync(path.join(tmpdir(), 'ts-migration-history-')));
  } else {
  const selected = select(loadRoutes(root), kind, name);
  testEnvironment(root, selected.entries); // Fail missing isolation before doing build work.
  build(root);
  runSelection(root, selected, { reference, ...(reportDir ? { reportDir } : {}) });
  }
}
