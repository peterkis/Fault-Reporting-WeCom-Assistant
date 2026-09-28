import path from 'node:path';
import { record, strings, readJson, safeFile, workspaceFiles, git, outputPath } from './common.mjs';

export const ROUTING_BASE = '84d39b964d02db335c6c0c900d56d5b0a383f621';
export type Host = 'SOURCE_HOST' | 'STAGED_RUNTIME' | 'MIXED_EXPLICIT_ROOTS';
export type Entry = { path: string; mode: Host; node_flags: string[]; requires_database: boolean; requires_browser: boolean; requires_powershell: boolean; requires_pyyaml: boolean };
export type Selection = { entries: Entry[]; flags: string[]; label: string };
export type Routes = { entries: Entry[]; selections: Record<string, unknown>; aliases: Record<string, unknown> };
export const logical = (p: string): string => p.endsWith('.mts') ? p.slice(0, -4) + '.mjs' : p;
const hostNames = new Set(['SOURCE_HOST', 'STAGED_RUNTIME', 'MIXED_EXPLICIT_ROOTS']);
export function flags(value: unknown): string[] {
  const result = strings(value);
  if (result.some(f => !/^(?:--expose-gc|--experimental-test-module-mocks|--test-concurrency=[1-9]\d*)$/u.test(f))) throw new Error('MIGRATION_TEST_FLAG_REJECTED');
  return result;
}
export function loadRoutes(root: string): Routes {
  const raw = record(readJson(safeFile(root, 'plans/typescript-migration/test-routing.json')));
  if (raw.schema_version !== 2 || !Array.isArray(raw.entries)) throw new Error('MIGRATION_ROUTING_SCHEMA');
  const entries: Entry[] = raw.entries.map((value: unknown) => {
    const e = record(value);
    if (typeof e.path !== 'string' || !/^(?:tests\/|\.github\/review\/).+\.test\.(?:mjs|mts)$/u.test(e.path)
      || typeof e.mode !== 'string' || !hostNames.has(e.mode)) throw new Error('MIGRATION_TEST_ENTRY');
    for (const field of ['requires_database', 'requires_browser', 'requires_powershell', 'requires_pyyaml']) if (typeof e[field] !== 'boolean') throw new Error('MIGRATION_TEST_REQUIREMENT');
    return { path: e.path, mode: e.mode as Host, node_flags: flags(e.node_flags), requires_database: e.requires_database === true,
      requires_browser: e.requires_browser === true, requires_powershell: e.requires_powershell === true, requires_pyyaml: e.requires_pyyaml === true };
  });
  const current = workspaceFiles(root).filter(p => /^(?:tests\/|\.github\/review\/).+\.test\.(?:mjs|mts)$/u.test(p)).sort();
  const declared = entries.map(e => e.path).sort();
  if (new Set(declared.map(logical)).size !== declared.length || JSON.stringify(current) !== JSON.stringify(declared)) throw new Error('MIGRATION_TEST_INVENTORY_MISMATCH');
  const old = record(JSON.parse(git(root, ['show', ROUTING_BASE + ':plans/typescript-migration/test-routing.json'])) as unknown);
  const required = Object.values(record(old.proposed_groups)).flatMap(strings);
  if (required.some(f => !declared.map(logical).includes(logical(f)))) throw new Error('MIGRATION_LEGACY_TEST_REMOVED');
  for (const e of entries) { safeFile(root, e.path); if (e.mode === 'SOURCE_HOST' && e.path.endsWith('.mts')) throw new Error('MIGRATION_TYPED_SOURCE_TEST_REQUIRES_MIXED_HOST'); }
  const aliases = record(raw.legacy_commands), pkg = record(readJson(safeFile(root, 'package.json')));
  const original = record(JSON.parse(git(root, ['show', ROUTING_BASE + ':package.json'])) as unknown);
  const originalAliases = Object.entries(record(original.scripts)).filter(([name, command]) => name.startsWith('test:') && typeof command === 'string'
    && (/^node .*--test(?: |$)/u.test(command) || /^node scripts\/p2-g2-synthetic-e2e\.mjs --suite=(?:g2|integration|browser)$/u.test(command))).map(([name]) => name).sort();
  if (JSON.stringify(Object.keys(aliases).sort()) !== JSON.stringify(originalAliases)) throw new Error('MIGRATION_TEST_ALIAS_INVENTORY_MISMATCH');
  for (const [name, value] of Object.entries(aliases)) {
    const spec = record(value);
    if (!name.startsWith('test:') || spec.original !== record(original.scripts)[name]
      || record(pkg.scripts)[name] !== 'npm run migration:tools && node .build/tools/run-tests.mjs --alias ' + name) throw new Error('MIGRATION_TEST_ALIAS_DRIFT: ' + name);
    const reconstructed = parseOriginal(String(spec.original));
    if (JSON.stringify(flags(spec.node_flags)) !== JSON.stringify(reconstructed.flags)
      || JSON.stringify(strings(spec.patterns)) !== JSON.stringify(reconstructed.patterns)) throw new Error('MIGRATION_TEST_ALIAS_SELECTION_DRIFT: ' + name);
  }
  return { entries, selections: record(raw.selections), aliases };
}
export function parseOriginal(command: string): { flags: string[]; patterns: string[] } {
  if (command.startsWith('node scripts/p2-g2-synthetic-e2e.mjs --suite=')) {
    const suite = command.split('--suite=')[1];
    const pattern = suite === 'g2' ? 'tests/p2-g2-*.test.mjs' : suite === 'integration' ? 'tests/p2-g2-*.integration.test.mjs' : suite === 'browser' ? 'tests/p2-g2-*browser*.test.mjs' : '';
    if (!pattern) throw new Error('MIGRATION_UNSUPPORTED_G2_SUITE');
    return { flags: ['--expose-gc', '--test-concurrency=1'], patterns: [pattern] };
  }
  const parts = command.split(/\s+/u);
  if (parts.shift() !== 'node' || !parts.includes('--test')) throw new Error('MIGRATION_UNSUPPORTED_TEST_ALIAS');
  const selectedFlags = parts.filter(p => p.startsWith('--') && p !== '--test' && p !== '--env-file=.env.pilot');
  const patterns = parts.filter(p => !p.startsWith('--'));
  flags(selectedFlags);
  if (!patterns.length || patterns.some(p => !/^tests\/[\w./*-]+\.test\.mjs$/u.test(p))) throw new Error('MIGRATION_UNSUPPORTED_TEST_PATTERN');
  return { flags: selectedFlags, patterns };
}
export function expandPatterns(patterns: string[], entries: Entry[]): Entry[] {
  const selected = new Map<string, Entry>();
  for (const pattern of patterns) {
    const re = new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('[^/]*') + '$', 'u');
    const matches = entries.filter(e => re.test(logical(e.path)));
    if (!matches.length) throw new Error('MIGRATION_EMPTY_TEST_PATTERN: ' + pattern);
    for (const entry of matches) selected.set(entry.path, entry);
  }
  return [...selected.values()].sort((a,b) => a.path.localeCompare(b.path, 'en'));
}
export function select(routes: Routes, kind: 'alias' | 'selection', name: string): Selection {
  if (kind === 'alias') {
    const spec = record(routes.aliases[name]);
    return { entries: expandPatterns(strings(spec.patterns), routes.entries), flags: flags(spec.node_flags), label: name };
  }
  const names = strings(routes.selections[name]);
  if (!names.length) throw new Error('MIGRATION_EMPTY_SELECTION');
  return { label: name, flags: [], entries: names.map(p => {
    const e = routes.entries.find(v => logical(v.path) === logical(p));
    if (!e) throw new Error('MIGRATION_SELECTION_UNKNOWN_ENTRY: ' + p);
    return e;
  }) };
}
export function testEnvironment(root: string, entries: Entry[], input: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','HOME','USERPROFILE','TEMP','TMP','TMPDIR','LOCALAPPDATA','APPDATA','LANG','LC_ALL','TZ']) {
    if (input[name] !== undefined) result[name] = input[name];
  }
  // No .env loading, NODE_OPTIONS, provider credentials or production flags.
  if (entries.some(e => e.requires_database)) {
    const raw = input.PILOT_DATABASE_URL;
    if (input.TS_MIGRATION_TEST_DB_ISOLATED !== '1' || !raw) throw new Error('MIGRATION_ISOLATED_DATABASE_REQUIRED');
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
      || !url.pathname || url.search || url.hash) throw new Error('MIGRATION_TEST_DATABASE_NOT_LOOPBACK');
    result.PILOT_DATABASE_URL = raw;
  }
  if (input.TS_MIGRATION_BROWSER_EXECUTABLE) result.TS_MIGRATION_BROWSER_EXECUTABLE = input.TS_MIGRATION_BROWSER_EXECUTABLE;
  result.TS_MIGRATION_TEST_SOURCE_ROOT = root;
  result.TS_MIGRATION_TEST_RUNTIME_ROOT = path.join(root, '.build/runtime');
  return result;
}
export function execution(root: string, entry: Entry, reference = false): { cwd: string; file: string; mode: string } {
  const source = reference || entry.mode === 'SOURCE_HOST';
  if (reference && entry.path.endsWith('.mts')) throw new Error('MIGRATION_TYPED_TEST_HAS_NO_SOURCE_REFERENCE');
  const cwd = source ? root : path.join(root, '.build/runtime');
  return { cwd, file: safeFile(cwd, source ? entry.path : outputPath(entry.path)), mode: reference ? 'REFERENCE_SOURCE_NOT_MIGRATION_PROOF' : entry.mode };
}
