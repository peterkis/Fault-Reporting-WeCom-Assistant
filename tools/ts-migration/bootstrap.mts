import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function present(target: string): boolean {
  try { lstatSync(target); return true; } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}
const OWNER = 'fault-reporting-wecom-assistant/types-migration-v1\n';
export function noLinks(target: string): void {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('MIGRATION_SYMLINK: ' + target);
  if (stat.isDirectory()) for (const name of readdirSync(target)) noLinks(path.join(target, name));
}
export function sourceRoot(cwd = process.cwd()): string {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('MIGRATION_NODE24_REQUIRED');
  const root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true }).trim());
  if (realpathSync(cwd) !== root) throw new Error('MIGRATION_REQUIRES_REPOSITORY_ROOT');
  return root;
}
export function controlledBuildRoot(root: string): string {
  const output = path.join(root, '.build');
  if (present(output)) {
    if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) throw new Error('MIGRATION_UNSAFE_BUILD_ROOT');
    const marker = path.join(output, '.migration-owner');
    if (!existsSync(marker) || lstatSync(marker).isSymbolicLink() || readFileSync(marker, 'utf8') !== OWNER) throw new Error('MIGRATION_UNOWNED_BUILD_ROOT');
  } else {
    mkdirSync(output);
    writeFileSync(path.join(output, '.migration-owner'), OWNER, { flag: 'wx' });
  }
  return output;
}
export function cleanGenerated(root: string, name: 'tools' | 'emit' | 'runtime' | 'artifact-proof.json'): void {
  if (!['tools', 'emit', 'runtime', 'artifact-proof.json'].includes(name)) throw new Error('MIGRATION_INVALID_CLEAN_TARGET');
  const target = path.join(controlledBuildRoot(root), name);
  if (present(target)) { noLinks(target); rmSync(target, { recursive: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('MIGRATION_NODE24_REQUIRED');
  const root = sourceRoot();
  for (const name of ['tools', 'emit', 'runtime', 'artifact-proof.json'] as const) cleanGenerated(root, name);
  const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
  const shown: unknown = JSON.parse(execFileSync(process.execPath, [compiler, '--showConfig', '-p', 'tsconfig.tools.json'], { cwd: root, encoding: 'utf8', windowsHide: true }));
  if (!shown || typeof shown !== 'object' || !('compilerOptions' in shown) || !shown.compilerOptions || typeof shown.compilerOptions !== 'object') throw new Error('MIGRATION_TOOLS_CONFIG_REQUIRED');
  const options = shown.compilerOptions;
  if (!('outDir' in options) || options.outDir !== './.build/tools' || !('rootDir' in options) || options.rootDir !== './tools/ts-migration' || !('strict' in options) || options.strict !== true || 'noCheck' in options && options.noCheck) throw new Error('MIGRATION_TOOLS_CONFIG_UNSAFE');
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.tools.json'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { cleanGenerated(root, 'tools'); process.exitCode = result.status ?? 1; }
}
