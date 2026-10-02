import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Execute the discovered launcher. Its directory is not an npm installation contract.
export function findNpmLauncher(options: SpawnSyncOptionsWithStringEncoding): string {
  const found = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['npm'],
    { cwd: options.cwd, env: options.env, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/u);
  const launcher = process.platform === 'win32'
    ? found.find(file => /\.(?:cmd|bat|exe|com|[cm]?js)$/iu.test(file)) : found[0];
  assert.ok(launcher, 'NPM_LAUNCHER_REQUIRED');
  return launcher;
}

export function runNpm(args: string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  return runNpmLauncher(findNpmLauncher(options), args, options);
}

export function runNpmLauncher(launcher: string, args: string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(launcher)) {
    // Escape cmd parsing separately from Windows argv quoting, preserving literal values.
    const meta = (value: string): string => value.replace(/[()\[\]%!^"`<>&|; ,*?]/gu, '^$&');
    const quote = (value: string): string => {
      assert.ok(!/[\r\n\0]/u.test(value), 'NPM_CMD_LITERAL_ARGUMENT_REQUIRED');
      // Doubled quotes keep cmd's quote context balanced and encode a literal CRT quote.
      const escaped = value.replace(/(\\*)"/gu, '$1$1""').replace(/(\\*)$/gu, '$1$1');
      return meta(meta('"' + escaped + '"'));
    };
    const command = '"' + meta(launcher) + ' ' + args.map(quote).join(' ') + '"';
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/v:off', '/s', '/c', command],
      { ...options, windowsHide: true, windowsVerbatimArguments: true });
  }
  if (/\.[cm]?js$/iu.test(launcher)) return spawnSync(process.execPath, [launcher, ...args], options);
  return spawnSync(launcher, args, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = runNpm(process.argv.slice(2), { encoding: 'utf8', windowsHide: true });
  process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
}
