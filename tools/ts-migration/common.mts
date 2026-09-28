import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
export { sourceRoot, noLinks, cleanGenerated, controlledBuildRoot } from './bootstrap.mjs';

export const CONFIGS = ['tsconfig.base.json', 'tsconfig.tools.json', 'tsconfig.migration.json', 'tsconfig.type-tests.json'] as const;
export type FileDigest = { path: string; sha256: string };
export type OutputFile = FileDigest & { source: string; kind: 'COMPILED' | 'LEGACY' | 'RESOURCE' };
export type SourceIdentity = { head: string; tree: string; dirty: boolean; input_hash: string; inputs: FileDigest[] };
export type BuildManifest = { schema_version: 1; status: 'STAGED_NOT_ACTIVATED'; node_major: 24; compiler: string; source: SourceIdentity; typed_implementations: string[]; unchecked_legacy: string[]; declaration_inputs: string[]; outputs: OutputFile[] };
export const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const slash = (p: string): string => p.split(path.sep).join('/');
export function relativePath(p: string): string {
  if (!p || path.isAbsolute(p) || p.includes('\\') || p.includes('\0') || p.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('MIGRATION_INVALID_PATH: ' + p);
  return p;
}
export function safeFile(root: string, relative: string): string {
  const parts = relativePath(relative).split('/'); let current = root;
  for (const part of parts) { current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('MIGRATION_INPUT_SYMLINK: ' + relative); }
  if (!lstatSync(current).isFile()) throw new Error('MIGRATION_NOT_FILE: ' + relative);
  return current;
}
export function readJson(file: string): unknown { return JSON.parse(readFileSync(file, 'utf8')); }
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('MIGRATION_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v: unknown) => typeof v === 'string') || new Set(value).size !== value.length) throw new Error('MIGRATION_STRING_ARRAY_REQUIRED');
  return value;
}
export function git(root: string, args: string[]): string { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); }
export function workspaceFiles(root: string): string[] {
  const raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return [...new Set(raw.split('\0').filter(Boolean))].filter(p => existsSync(path.join(root, p))).sort();
}
export function codeFiles(root: string): string[] {
  return workspaceFiles(root).filter(p => /^(src|scripts|tests)\/.+\.(mjs|mts)$/u.test(p) && !p.startsWith('tests/types/') && !p.endsWith('.d.mts'));
}
export function resources(root: string): string[] {
  const manifest = record(readJson(safeFile(root, 'tools/ts-migration/resources.json')));
  if (manifest.schema_version !== 1) throw new Error('MIGRATION_RESOURCE_SCHEMA');
  const files = strings(manifest.files);
  for (const p of files) {
    relativePath(p);
    if (!/^(contracts\/|config_examples\/|database\/migrations\/|web\/p2-(workbench|reporter)\/|tests\/fixtures\/|package(?:-lock)?\.json$|\.env\.example$)/u.test(p)
      || p.endsWith('.mts') || /(^|\/)(?:node_modules|\.git|\.env(?!\.example$))\b|\.(?:key|pem|pfx|p12)$/iu.test(p)) throw new Error('MIGRATION_RESOURCE_NOT_ALLOWED: ' + p);
    safeFile(root, p);
  }
  return files.sort();
}
export function outputPath(source: string): string { return source.endsWith('.mts') ? source.slice(0, -4) + '.mjs' : source; }
export function mappings(root: string): { source: string; path: string; kind: OutputFile['kind'] }[] {
  const outputs = new Map<string, { source: string; path: string; kind: OutputFile['kind'] }>();
  const add = (source: string, out: string, kind: OutputFile['kind']): void => {
    relativePath(source); relativePath(out);
    if (outputs.has(out)) throw new Error('MIGRATION_OUTPUT_COLLISION: ' + out);
    outputs.set(out, { source, path: out, kind });
  };
  for (const source of codeFiles(root)) {
    safeFile(root, source);
    const compiled = source.endsWith('.mts');
    add(source, outputPath(source), compiled ? 'COMPILED' : 'LEGACY');
    if (compiled) add(source, outputPath(source) + '.map', 'COMPILED');
  }
  for (const source of resources(root)) if (!outputs.has(source)) add(source, source, 'RESOURCE');
  return [...outputs.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function inputs(root: string): FileDigest[] {
  const files = workspaceFiles(root).filter(p => /^(src|scripts|tests|contracts|config_examples|tools\/ts-migration|web\/p2-(workbench|reporter))\//u.test(p)
    || CONFIGS.includes(p as typeof CONFIGS[number]) || ['package.json','package-lock.json','.env.example'].includes(p)
    || p.startsWith('plans/typescript-migration/') || p === '.github/workflows/types-migration.yml');
  return files.map(p => ({ path: p, sha256: hash(readFileSync(safeFile(root, p))) }));
}
export function identity(root: string): SourceIdentity {
  const list = inputs(root);
  return { head: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), dirty: git(root, ['status', '--porcelain']).length > 0, input_hash: hash(JSON.stringify(list)), inputs: list };
}
export function parsedConfig(root: string, name: string): ts.ParsedCommandLine {
  const file = safeFile(root, name), result = ts.readConfigFile(file, ts.sys.readFile);
  if (result.error) throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(result.config, ts.sys, root, undefined, file);
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, diagnosticHost(root)));
  const o = parsed.options;
  for (const key of ['strict', 'noEmitOnError', 'verbatimModuleSyntax', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'useUnknownInCatchVariables', 'forceConsistentCasingInFileNames'] as const) {
    if (o[key] !== true) throw new Error('MIGRATION_REQUIRED_COMPILER_FLAG: ' + key);
  }
  if (['noImplicitAny','strictNullChecks','strictFunctionTypes','strictBindCallApply','strictPropertyInitialization','noImplicitThis','alwaysStrict'].some(key => o[key] === false)) throw new Error('MIGRATION_STRICT_OVERRIDE');
  if (o.noCheck || o.skipLibCheck || o.module !== ts.ModuleKind.NodeNext || o.moduleResolution !== ts.ModuleResolutionKind.NodeNext) throw new Error('MIGRATION_COMPILER_BYPASS');
  if (name !== 'tsconfig.type-tests.json' && (o.noEmit || slash(o.outDir ?? '') !== slash(path.join(root, name === 'tsconfig.tools.json' ? '.build/tools' : '.build/emit')))) throw new Error('MIGRATION_INVALID_EMIT_DIRECTORY');
  return parsed;
}
export const diagnosticHost = (root: string): ts.FormatDiagnosticsHost => ({ getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => '\n' });
export function program(root: string, name: string): ts.Program {
  const locked = record(readJson(safeFile(root, 'package.json'))), dev = record(locked.devDependencies);
  if (dev.typescript !== ts.version || typeof dev['@types/node'] !== 'string' || !/^24\.\d+\.\d+$/u.test(dev['@types/node']) || typeof dev['@types/pg'] !== 'string' || !/^8\.\d+\.\d+$/u.test(dev['@types/pg'])) throw new Error('MIGRATION_COMPILER_VERSION_MISMATCH');
  const p = parsedConfig(root, name); const result = ts.createProgram(p.fileNames, p.options);
  const typed = workspaceFiles(root).filter(f => name === 'tsconfig.tools.json' ? /^tools\/ts-migration\/.+\.mts$/u.test(f)
    : name === 'tsconfig.type-tests.json' ? /^tests\/types\/.+\.mts$/u.test(f)
    : /^(src|scripts|tests)\/.+\.mts$/u.test(f) && !f.startsWith('tests/types/') && !f.endsWith('.d.mts'));
  if (!typed.length) throw new Error('MIGRATION_EMPTY_PROGRAM: ' + name);
  for (const f of typed) {
    if (!result.getSourceFile(slash(path.join(root, f))) || !p.fileNames.some(input => slash(input) === slash(path.join(root, f)))) throw new Error('MIGRATION_UNCHECKED_TARGET: ' + f);
    const source = result.getSourceFile(slash(path.join(root, f)));
    if (!source) throw new Error('MIGRATION_MISSING_TARGET');
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isNonNullExpression(node)
        || ts.isAsExpression(node) && ts.isAsExpression(node.expression)) throw new Error('MIGRATION_TYPE_ESCAPE: ' + f);
      ts.forEachChild(node, visit);
    };
    visit(source);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.text);
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
      const comment = scanner.getTokenText();
      if (/@ts-(?:ignore|nocheck)\b/u.test(comment) || /@ts-expect-error/u.test(comment) && (!f.startsWith('tests/types/') || !/@ts-expect-error -- .{8}/u.test(comment))) throw new Error('MIGRATION_TYPE_SUPPRESSION: ' + f);
    }
  }
  const errors = ts.getPreEmitDiagnostics(result);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, diagnosticHost(root)));
  return result;
}
export function runNode(root: string, args: string[]): void {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('MIGRATION_COMMAND_FAILED: ' + String(r.status));
}
export function outputFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => { for (const name of readdirSync(dir).sort()) {
    const f = path.join(dir, name), stat = lstatSync(f);
    if (stat.isSymbolicLink()) throw new Error('MIGRATION_OUTPUT_SYMLINK');
    if (stat.isDirectory()) walk(f); else if (stat.isFile()) found.push(slash(path.relative(root, f))); else throw new Error('MIGRATION_SPECIAL_OUTPUT');
  }};
  walk(realpathSync(root)); return found.sort();
}
