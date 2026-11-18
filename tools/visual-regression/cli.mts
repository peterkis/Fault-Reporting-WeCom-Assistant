import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findSystemBrowser } from '../../tests/helpers/p2-006-browser-harness.mjs';
import { platformName, browserName, assertHumanApproval, transientCurrentRoot } from './model.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  // Guard before module imports, filesystem access, or browser lookup.
  if (command === 'approve') assertHumanApproval(process.stdin.isTTY, process.env);
  const platform = platformName(process.platform, browserName(findSystemBrowser()));
  let baselineRoot = path.join(root, 'docs/ui/visual-baseline'),
    currentRoot = path.join(root, '.build/visual/current'),
    reportDir = path.join(root, '.build/visual/report'),
    runId: string | undefined;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (['--baseline-dir', '--current-dir', '--report-dir', '--run-id'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error('Missing option value: ' + arg);
      if (command === 'approve') throw Error('Approval accepts only screen names or --all');
      if (arg === '--baseline-dir' && command === 'compare') baselineRoot = path.resolve(value);
      else if (arg === '--current-dir' && (command === 'capture' || command === 'compare'))
        currentRoot = transientCurrentRoot(root, value);
      else if (arg === '--report-dir' && command === 'compare') reportDir = path.resolve(value);
      else if (arg === '--run-id' && command === 'capture') runId = value;
      else throw Error('Option not valid for command: ' + arg);
    } else if (arg.startsWith('--') && !(command === 'approve' && arg === '--all'))
      throw Error('Unknown option: ' + arg);
    else names.push(arg);
  }
  const currentDir = path.join(currentRoot, platform),
    baselineDir = path.join(baselineRoot, platform);
  if (command === 'capture' || command === 'approve')
    try {
      execFileSync(process.execPath, [path.join(root, '.build/tools/verify-artifact.mjs')], {
        cwd: root,
        stdio: 'pipe',
        windowsHide: true,
      });
    } catch {
      throw Error(
        'Artifact verification failed. Run npm run migration:build before capture or approval.',
      );
    }
  if (command === 'capture') {
    process.env.PILOT_DATABASE_URL ??= 'postgresql://petervans@127.0.0.1:5432/postgres';
    const db = new URL(process.env.PILOT_DATABASE_URL);
    if (
      !['postgres:', 'postgresql:'].includes(db.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname)
    )
      throw Error('Visual capture requires loopback PostgreSQL');
    process.env.TS_MIGRATION_TEST_SOURCE_ROOT = root;
    process.env.TS_MIGRATION_TEST_RUNTIME_ROOT = path.join(root, '.build/runtime');
    const { capture } = await import('./capture.mjs');
    await capture(root, platform, currentDir, names, runId);
  } else if (command === 'compare') {
    const { compare } = await import('./compare.mjs');
    process.exitCode = await compare({ platform, currentDir, baselineDir, reportDir, names });
  } else if (command === 'approve') {
    const { approve } = await import('./approve.mjs');
    await approve(names, currentDir, baselineDir, platform);
  } else throw Error('Use capture, compare, or approve');
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
