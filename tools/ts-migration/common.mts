import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import {brotliCompressSync,brotliDecompressSync,constants,gunzipSync,gzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {assertBackendLayout,assertSharedBoundary,BACKEND_LAYOUT_BASE,isProductionSource,logicalSource} from './backend-layout.mjs';
export { sourceRoot, noLinks, cleanGenerated, controlledBuildRoot } from './bootstrap.mjs';

export const CONFIGS = ['tsconfig.base.json', 'tsconfig.tools.json', 'tsconfig.migration.json', 'tsconfig.type-tests.json'] as const;
export type FileDigest = { path: string; sha256: string };
export type OutputFile = FileDigest & { source: string; kind: 'COMPILED' | 'LEGACY' | 'RESOURCE' | 'WEB' };
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
export function git(root: string, args: string[]): string { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim(); }
export function workspaceFiles(root: string): string[] {
  const raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return [...new Set(raw.split('\0').filter(Boolean))].filter(p => existsSync(path.join(root, p))).sort();
}
// T00 was independently reviewed and merged; current policy edits cannot silently
// grow the set of JavaScript files grandfathered into the migration.
const LEGACY_POLICY_BASE = '162ffe7651c97329ace63532bd1f9739cf03550a';
export function assertProductionSources(root: string): void {
  const policy = record(JSON.parse(git(root, ['show', LEGACY_POLICY_BASE + ':plans/typescript-migration/scope.json'])) as unknown);
  const legacy = new Set([...Object.values(record(policy.migration_batches)).flatMap(strings),
    ...strings(policy.legacy_g0), ...strings(policy.retained_existing_tooling)]);
  const historicalTools = new Set(git(root, ['ls-tree', '-r', '--name-only', LEGACY_POLICY_BASE, '--', 'tools', '.github/review']).split('\n'));
  if (git(root, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('MIGRATION_FULL_HISTORY_REQUIRED');
  const retired = new Set(git(root, ['log', '--format=', '--name-only', '--diff-filter=A', '--no-renames', '-z', LEGACY_POLICY_BASE + '..HEAD', '--', 'src', 'scripts', 'app/server', 'shared', 'app/pc-admin/src', 'tools', '.github/review'])
    .split('\0').map(p => logicalSource(p.trim())).filter(p => p.endsWith('.mts') && !p.endsWith('.d.mts')).map(p => p.slice(0, -4) + '.mjs'));
  const files=workspaceFiles(root);
  for (const file of files.filter(f => (isProductionSource(f)||/^(src|scripts|tools|\.github\/review)\//u.test(f)) && /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/iu.test(f))) {
    const tooling = /^(tools|\.github\/review)\//u.test(file);
    const logical=logicalSource(file);
    if (retired.has(logical)) throw new Error('MIGRATION_RETIRED_LEGACY: ' + file);
    if (file.endsWith('.mts') || /\.d\.ts$/u.test(file)) {
      if (tooling && !file.startsWith('tools/ts-migration/')) throw new Error('MIGRATION_UNREGISTERED_TYPED_TOOL: ' + file);
      continue;
    }
    if (!file.endsWith('.mjs') || !(tooling ? historicalTools : legacy).has(logical)) throw new Error(tooling ? 'MIGRATION_NEW_UNTYPED_TOOL: ' + file : 'MIGRATION_NEW_UNTYPED_PRODUCTION: ' + file);
  }
  for(const file of files.filter(isProductionSource))safeFile(root,file);
  assertBackendLayout(root,files,git(root,['ls-tree','-r','--name-only',BACKEND_LAYOUT_BASE,'--','src','scripts']).split('\n'));
  assertSharedBoundary(root,files);
}
function unwrapAssertionOperand(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}
const isAssertion = (node: ts.Node): node is ts.AsExpression | ts.TypeAssertion => ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);

export function codeFiles(root: string): string[] {
  return workspaceFiles(root).filter(p => (isProductionSource(p)||/^(src|scripts|tests)\//u.test(p)) && /\.(mjs|mts)$/u.test(p) && !p.startsWith('tests/types/') && !p.endsWith('.d.mts'));
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
// H5 design originals and development-only fixtures never identify a release.
// Keep every production source/style/asset and the actual build configuration.
export function isH5ProductionInput(file: string): boolean {
  return ['app/h5/index.html','app/h5/package.json','app/h5/tsconfig.json','app/h5/vite.config.ts','app/h5/compile-i18n.ts','app/h5/components.json'].includes(file)
    || file.startsWith('app/h5/src/') && !file.startsWith('app/h5/src/dev/')
    || file.startsWith('app/h5/public/assets/');
}
// Vite retains module qualifiers (for example wecom.prod) in hashed chunk names.
const H5_ASSET = /^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|woff2|png|jpe?g|webp|svg)$/u;
const H5_ENCODED_ASSET = /^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css)\.(?:gz|br)$/u;
const H5_PUBLIC_ASSET = /^assets\/[A-Za-z0-9_-]+\.(?:woff2|png|jpe?g|webp|svg)$/u;
const H5_NON_PRODUCTION = /(?:^|\/)(?:docs|design-baseline|dev|__fixtures__|fixtures|preview)(?:[/.]|$)|^assets\/(?:preview|fixture)(?:[-_.]|$)/u;
export function h5OutputFiles(root: string, withInventories = true): string[] {
  const output = path.join(root,'.build/emit/h5'), files = outputFiles(output);
  const metadata = ['index.html','.vite/manifest.json',...(withInventories ? ['asset-inventory.json','dependency-inventory.json','startup-metrics.json'] : files.includes('startup-metrics.json')?['startup-metrics.json']:[])];
  if (metadata.some(file => !files.includes(file)) || files.some(file => !metadata.includes(file) && ((!H5_ASSET.test(file)&&!H5_ENCODED_ASSET.test(file)) || H5_NON_PRODUCTION.test(file)))) throw new Error('H5_BUILD_OUTPUT_INVALID');
  const manifest = record(readJson(safeFile(output,'.vite/manifest.json'))), referenced = new Set<string>();
  const asset = (value: unknown): void => {
    if (typeof value !== 'string' || !H5_ASSET.test(value) || !files.includes(value) || H5_NON_PRODUCTION.test(value)) throw new Error('H5_MANIFEST_ASSET_INVALID');
    referenced.add(value);
  };
  for (const [key,value] of Object.entries(manifest)) {
    relativePath(key);
    const chunk = record(value);
    if (H5_NON_PRODUCTION.test(key)) throw new Error('H5_NON_PRODUCTION_OUTPUT');
    if (chunk.src !== undefined) {
      if (typeof chunk.src !== 'string') throw new Error('H5_MANIFEST_SOURCE_INVALID');
      relativePath(chunk.src);
      if (H5_NON_PRODUCTION.test(chunk.src)) throw new Error('H5_NON_PRODUCTION_OUTPUT');
    }
    asset(chunk.file);
    for (const field of ['css','assets']) if (chunk[field] !== undefined) for (const file of strings(chunk[field])) asset(file);
    for (const field of ['imports','dynamicImports']) if (chunk[field] !== undefined) for (const imported of strings(chunk[field])) {
      relativePath(imported);
      if (!Object.hasOwn(manifest,imported)) throw new Error('H5_MANIFEST_IMPORT_MISSING');
    }
  }
  if (!Object.values(manifest).some(value => record(value).isEntry === true)) throw new Error('H5_MANIFEST_ENTRY_REQUIRED');
  const publicRoot = path.join(root,'app/h5/public');
  for (const file of existsSync(publicRoot) ? outputFiles(publicRoot) : []) {
    if (!H5_PUBLIC_ASSET.test(file) || H5_NON_PRODUCTION.test(file) || !files.includes(file)
      || !readFileSync(safeFile(output,file)).equals(readFileSync(safeFile(publicRoot,file)))) throw new Error('H5_PUBLIC_ASSET_INVALID');
    referenced.add(file);
  }
  const representations=record(manifest['index.html']).h5Representations;
  if(representations!==undefined){
    if(!Array.isArray(representations)||representations.length>768)throw new Error('H5_REPRESENTATION_SCHEMA');
    const declared=new Set<string>(),identities=new Set<string>();
    for(const value of representations){
      const item=record(value),{file,source,encoding,bytes,sha256}=item;
      if(typeof file!=='string'||typeof source!=='string'||!referenced.has(source)||!H5_ASSET.test(source)||declared.has(file)||!files.includes(file)||!Number.isSafeInteger(bytes)||typeof bytes!=='number'||bytes<0||bytes>20*1024*1024||typeof sha256!=='string'||!/^[a-f0-9]{64}$/u.test(sha256))throw new Error('H5_REPRESENTATION_INVALID');
      const actual=readFileSync(safeFile(output,file));if(actual.length!==bytes||hash(actual)!==sha256)throw new Error('H5_REPRESENTATION_DRIFT');
      if(encoding==='identity'){
        if(file!==source)throw new Error('H5_REPRESENTATION_INVALID');identities.add(source);
      }else if(encoding==='gzip'||encoding==='br'){
        if(!/\.(?:js|css)$/u.test(source)||file!==source+(encoding==='gzip'?'.gz':'.br'))throw new Error('H5_REPRESENTATION_INVALID');
        const decoded=encoding==='gzip'?gunzipSync(actual,{maxOutputLength:20*1024*1024}):brotliDecompressSync(actual,{maxOutputLength:20*1024*1024});
        if(!decoded.equals(readFileSync(safeFile(output,source))))throw new Error('H5_REPRESENTATION_CONTENT_DRIFT');
      }else throw new Error('H5_REPRESENTATION_INVALID');
      declared.add(file);
    }
    if([...referenced].some(file=>!identities.has(file)))throw new Error('H5_REPRESENTATION_IDENTITY_MISSING');
    for(const file of declared)referenced.add(file);
  }
  if (files.some(file => !metadata.includes(file) && !referenced.has(file))) throw new Error('H5_UNDECLARED_ASSET');
  if (withInventories && JSON.stringify(readJson(safeFile(output,'asset-inventory.json'))) !== JSON.stringify(files.filter(file => !['asset-inventory.json','dependency-inventory.json'].includes(file)))) throw new Error('H5_ASSET_INVENTORY_DRIFT');
  if(withInventories&&JSON.stringify(readJson(safeFile(output,'startup-metrics.json')))!==JSON.stringify(h5StartupMetrics(root)))throw new Error('H5_STARTUP_METRICS_DRIFT');
  return files;
}

/** Count the whole initial dependency closure plus each selected route. A small
 * entry chunk cannot hide its cost by moving required code into shared chunks. */
export function h5StartupMetrics(root:string){
  const output=path.join(root,'.build/emit/h5'),manifest=record(readJson(safeFile(output,'.vite/manifest.json')));
  const html=readFileSync(safeFile(output,'index.html'),'utf8'),byFile=new Map<string,string>();
  for(const [key,value] of Object.entries(manifest)){const chunk=record(value);if(typeof chunk.file==='string')byFile.set(chunk.file,key);}
  const base=new Set<string>(),sizes=new Map<string,{file:string;raw:number;gzip:number;brotli:number}>();
  function collect(key:string,files:Set<string>,seen=new Set<string>()):void{
    if(seen.has(key))return;seen.add(key);const chunk=record(manifest[key]);
    if(typeof chunk.file!=='string'||!H5_ASSET.test(chunk.file))throw new Error('H5_MANIFEST_ASSET_INVALID');
    if(chunk.file.endsWith('.js'))files.add(chunk.file);
    if(chunk.imports!==undefined)for(const dependency of strings(chunk.imports))collect(dependency,files,seen);
  }
  for(const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gu)){
    const url=match[1];if(!url?.startsWith('/wecom/yixiaoxiu/'))throw new Error('H5_STARTUP_SCRIPT_INVALID');
    const file=url.slice('/wecom/yixiaoxiu/'.length);if(!H5_ASSET.test(file)||!file.endsWith('.js'))throw new Error('H5_STARTUP_SCRIPT_INVALID');
    base.add(file);const key=byFile.get(file);if(key)collect(key,base);
  }
  if(!base.size)throw new Error('H5_STARTUP_SCRIPT_REQUIRED');
  function summary(files:Set<string>){
    const sorted=[...files].sort();let raw=0,gzip=0,brotli=0;
    for(const file of sorted){
      let size=sizes.get(file);if(!size){const bytes=readFileSync(safeFile(output,file));size={file,raw:bytes.length,gzip:gzipSync(bytes,{level:9}).length,brotli:brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length};sizes.set(file,size);}
      raw+=size.raw;gzip+=size.gzip;brotli+=size.brotli;
    }
    return {files:sorted,raw,gzip,brotli};
  }
  const initial=summary(base),routes=[];
  for(const [view,key] of Object.entries({home:'src/pages/Home.tsx',report:'src/pages/Report.tsx',reports:'src/pages/Reports.tsx',request:'src/pages/Detail.tsx',department:'src/pages/Department.tsx',reporter:'src/reporter/ReporterPage.tsx',reporterFeedback:'src/reporter/feedback.ts'})){
    if(!Object.hasOwn(manifest,key))continue;
    const files=new Set(base);collect(key,files);routes.push({view,...summary(files)});
    if(view==='reporterFeedback'&&Object.hasOwn(manifest,'src/reporter/ReporterPage.tsx')){collect('src/reporter/ReporterPage.tsx',files);routes[routes.length-1]={view,...summary(files)};}
  }
  return {schema_version:1,js_budget_gzip:120*1024,prepaint_budget_gzip:2048,initial,routes,assets:[...sizes.values()].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0)};
}
export function mappings(root: string): { source: string; path: string; kind: OutputFile['kind'] }[] {
  assertProductionSources(root);
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
  const webOutput=path.join(root,'.build/emit/web/admin-workbench');
  if(existsSync(webOutput))for(const file of outputFiles(webOutput)){
    add('app/pc-admin/index.html','web/admin-workbench/'+file,'WEB');
  }
  const loginOutput=path.join(root,'.build/emit/web/desktop-login');
  if(existsSync(loginOutput))for(const file of outputFiles(loginOutput))add('app/pc-admin/src/login/main.ts','web/desktop-login/'+file,'WEB');
  if(existsSync(path.join(root,'.build/emit/h5')))for(const file of h5OutputFiles(root))add('app/h5/index.html','h5/'+file,'WEB');
  return [...outputs.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function inputs(root: string): FileDigest[] {
  const files = workspaceFiles(root).filter(p => isProductionSource(p) || /^(src|scripts|tests|contracts|database\/migrations|config_examples|tools\/ts-migration|web\/p2-(workbench|reporter)|app\/pc-admin)\//u.test(p)
    || isH5ProductionInput(p) || CONFIGS.includes(p as typeof CONFIGS[number]) || ['package.json','package-lock.json','.env.example','.gitattributes'].includes(p)
    || p.startsWith('plans/typescript-migration/') || p.startsWith('.github/workflows/')
    || ['plans/yxx-current-readiness-scope.json', 'plans/yxx-current-readiness-acceptance.json', 'plans/yxx-current-readiness-scope.v2.json', 'plans/yxx-current-readiness-acceptance.v2.json', 'plans/yxx-ss-009-acceptance.json', '.github/review/pr21-evidence-exceptions.json',
      '.github/review/yxx-current-evidence-adjudication.json', '.github/review/pr-evidence-delta.test.mjs',
      '.github/review/verify-published-history.test.mjs', '.github/review/pr-evidence-delta.mjs',
      '.github/review/verify-published-history.mjs'].includes(p));
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
  assertProductionSources(root);
  const locked = record(readJson(safeFile(root, 'package.json'))), dev = record(locked.devDependencies);
  if (dev.typescript !== ts.version || typeof dev['@types/node'] !== 'string' || !/^24\.\d+\.\d+$/u.test(dev['@types/node']) || typeof dev['@types/pg'] !== 'string' || !/^8\.\d+\.\d+$/u.test(dev['@types/pg'])) throw new Error('MIGRATION_COMPILER_VERSION_MISMATCH');
  const p = parsedConfig(root, name); const result = ts.createProgram(p.fileNames, p.options);
  const typed = workspaceFiles(root).filter(f => name === 'tsconfig.tools.json' ? /^tools\/ts-migration\/.+\.mts$/u.test(f)
    : name === 'tsconfig.type-tests.json' ? /^tests\/types\/.+\.mts$/u.test(f)
    : (isProductionSource(f)||/^(src|scripts|tests)\//u.test(f)) && f.endsWith('.mts') && !f.startsWith('tests/types/'));
  if (!typed.length) throw new Error('MIGRATION_EMPTY_PROGRAM: ' + name);
  for (const f of typed) {
    if (!result.getSourceFile(slash(path.join(root, f))) || !p.fileNames.some(input => slash(input) === slash(path.join(root, f)))) throw new Error('MIGRATION_UNCHECKED_TARGET: ' + f);
  }
  if (name === 'tsconfig.type-tests.json') {
    for (const f of workspaceFiles(root).filter(f => /^contracts\/.+\.d\.(?:ts|mts)$/u.test(f))) {
      if (!result.getSourceFile(slash(path.join(root, f)))) throw new Error('MIGRATION_UNCHECKED_CONTRACT: ' + f);
    }
  }
  // Declaration files can otherwise introduce explicit any into typed consumers.
  // Scan every local input actually loaded by the program, including transitive
  // .d.ts/.d.mts, but never vendor declarations from the locked dependencies.
  for (const source of result.getSourceFiles()) {
    const f = slash(path.relative(root, source.fileName));
    if (path.isAbsolute(f) || f.startsWith('../') || f.startsWith('node_modules/') || !/\.(?:[cm]?ts|tsx)$/u.test(f)) continue;
    safeFile(root, f);
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isNonNullExpression(node)
        || isAssertion(node) && isAssertion(unwrapAssertionOperand(node.expression))) throw new Error('MIGRATION_TYPE_ESCAPE: ' + f);
      ts.forEachChild(node, visit);
    };
    visit(source);
    const comments = new Map<number, string>();
    const collectComments = (node: ts.Node): void => {
      for (const range of [...(ts.getLeadingCommentRanges(source.text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(source.text, node.end) ?? [])]) {
        comments.set(range.pos, source.text.slice(range.pos, range.end));
      }
      for (const child of node.getChildren(source)) collectComments(child);
    };
    collectComments(source);
    for (const comment of comments.values()) {
      if (/@ts-(?:ignore|nocheck)\b/u.test(comment)) throw new Error('MIGRATION_TYPE_SUPPRESSION: ' + f);
      for (const directive of comment.matchAll(/@ts-expect-error([^\r\n]*)/gu)) {
        const suffix = directive[1] ?? '';
        const explanation = suffix.match(/^\s+--\s*(.*?)(?:\*\/)?$/u)?.[1] ?? '';
        if (!f.startsWith('tests/types/') || !/[\p{L}\p{N}]/u.test(explanation) || explanation.replace(/\s/gu, '').length < 8) throw new Error('MIGRATION_TYPE_SUPPRESSION: ' + f);
      }
    }
  }
  const errors = ts.getPreEmitDiagnostics(result);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, diagnosticHost(root)));
  return result;
}
export function runNode(root: string, args: string[]): void {
  const compilerChild = args[1]==='--root' && args[2]===root && (
    args[0]===fileURLToPath(new URL('./emit.mjs',import.meta.url)) && (args.length===3 || args.length===4 && args[3]==='--types')
    || args[0]===fileURLToPath(new URL('./syntax-check.mjs',import.meta.url)) && args.length===3);
  const parseOnly = args[0]==='--check' && args.length===2;
  // Outer coverage observes execution. Compiling or parsing the full program
  // must not inherit that extra observer; actual tests retain their own coverage.
  const env = {...process.env};
  if (compilerChild || parseOnly) env.NODE_V8_COVERAGE='';
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
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
