import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from '../../tests/visual/manifest.mjs';
import { findSystemBrowser } from '../../tests/helpers/p2-006-browser-harness.mjs';
import { browserName, DEFAULT_THRESHOLD, platformName } from './model.mjs';
import type { CaptureMeta } from './model.mjs';
import { comparePixels } from './compare.mjs';
const execute = promisify(execFile);
const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function replaceSourceOnce(source: string, before: string, after: string): string {
  if (!before || before === after || source.split(before).length !== 2) {
    throw new Error('Source experiment requires exactly one matching, changed source fragment');
  }
  return source.replace(before, after);
}
interface ComparisonReport {
  changed: string[];
  missing_baselines: string[];
  metadata_errors: string[];
  results: {
    name: string;
    status: string;
    diff_pixels: number;
    diff_ratio: number;
    over_threshold: boolean;
  }[];
}
/** Edits real source, rebuilds, captures through the CLI, then restores and rebuilds. */
export async function reverseValidation(root: string): Promise<void> {
  for (const screen of manifest) {
    assert.deepEqual(
      screen.threshold,
      DEFAULT_THRESHOLD,
      'Source experiments require default thresholds',
    );
  }
  const platform = platformName(process.platform, browserName(findSystemBrowser()));
  const temporary = path.join(root, '.build/visual/source-reverse-any-pixel');
  const baselineRoot = path.join(temporary, 'baseline');
  const current = path.join(root, '.build/visual/current', platform);
  const evidence = path.join(root, 'docs/ui/evidence/v228-card35/35b');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const sources = [
    {
      experiment: 'radius',
      file: 'app/pc-admin/src/design/tokens.css',
      before: '--radius-lg: 12px;',
      after: '--radius-lg: 14px;',
    },
    {
      experiment: 'label',
      file: 'app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx',
      before: '>确认关闭</Button>',
      after: '>确认关单</Button>',
    },
  ];
  const receipts: Record<string, unknown>[] = [];
  await mkdir(temporary, { recursive: true });
  await mkdir(baselineRoot, { recursive: true });
  const approvedMeta = await readFile(path.join(current, 'meta.json'));
  const captureMeta = JSON.parse(approvedMeta.toString('utf8')) as CaptureMeta;
  assert.equal(
    Object.keys(captureMeta.screens).length,
    manifest.length,
    'Complete current set required',
  );
  const approvedHashes = new Map<string, string>();
  for (const screen of manifest) {
    const hash = digest(await readFile(path.join(current, screen.name + '.png')));
    assert.equal(hash, captureMeta.screens[screen.name], 'Current capture hash mismatch');
    approvedHashes.set(screen.name, hash);
  }
  async function assertCurrentUnchanged(): Promise<void> {
    assert.equal(digest(await readFile(path.join(current, 'meta.json'))), digest(approvedMeta));
    for (const [name, hash] of approvedHashes) {
      assert.equal(
        digest(await readFile(path.join(current, name + '.png'))),
        hash,
        'Approved current changed; stop without overwriting it: ' + name,
      );
    }
  }
  async function command(args: string[], log: string, allowed = [0]): Promise<number> {
    let code = 0;
    let output = '';
    try {
      const result = await execute(npm, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      output = result.stdout + result.stderr;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'number')
        throw error;
      code = error.code;
      const result = error as Error & {
        stdout?: string;
        stderr?: string;
      };
      output = (result.stdout ?? '') + (result.stderr ?? '');
    }
    await writeFile(path.join(evidence, 'logs', log), output);
    if (!allowed.includes(code)) throw new Error(args.join(' ') + ' failed; see ' + log);
    return code;
  }
  // No source edit starts until both targets are clean and recoverable originals exist.
  const originals = new Map<string, Buffer>();
  for (const source of sources) {
    const diff = await execute('git', ['diff', '--', source.file], { cwd: root });
    assert.equal(
      diff.stdout,
      '',
      'Product source must be clean before experiments: ' + source.file,
    );
    const bytes = await readFile(path.join(root, source.file));
    originals.set(source.file, bytes);
    await writeFile(path.join(temporary, source.experiment + '-original'), bytes);
  }
  await cp(current, path.join(baselineRoot, platform), { recursive: true });
  for (const source of sources) {
    await assertCurrentUnchanged();
    const currentRoot = path.join(temporary, source.experiment, 'current');
    const experimentCurrent = path.join(currentRoot, platform);
    const file = path.join(root, source.file);
    const original = originals.get(source.file);
    assert.ok(original);
    const edited = replaceSourceOnce(original.toString('utf8'), source.before, source.after);
    assert.equal(digest(await readFile(file)), digest(original), 'Source drift before experiment');
    await writeFile(file, edited);
    try {
      const patch = await execute('git', ['diff', '--', source.file], { cwd: root });
      await writeFile(
        path.join(evidence, 'source-reverse-' + source.experiment + '.patch'),
        patch.stdout,
      );
      await command(
        ['run', 'migration:build'],
        'source-reverse-' + source.experiment + '-build.log',
      );
      await command(
        [
          'run',
          'visual:capture',
          '--',
          '--current-dir',
          currentRoot,
          '--run-id',
          'source-any-pixel-' + source.experiment,
        ],
        'source-reverse-' + source.experiment + '-capture.log',
      );
      const reportDir = path.join(temporary, source.experiment, 'report');
      const exitCode = await command(
        [
          'run',
          'visual:compare',
          '--',
          '--current-dir',
          currentRoot,
          '--baseline-dir',
          baselineRoot,
          '--report-dir',
          reportDir,
        ],
        'source-reverse-' + source.experiment + '-compare.log',
        [0, 1],
      );
      const report = JSON.parse(
        await readFile(path.join(reportDir, 'report.json'), 'utf8'),
      ) as ComparisonReport;
      assert.deepEqual(report.metadata_errors, []);
      assert.deepEqual(report.missing_baselines, []);
      assert.ok(report.results.every((row) => ['changed', 'unchanged'].includes(row.status)));
      const meta = JSON.parse(
        await readFile(path.join(experimentCurrent, 'meta.json'), 'utf8'),
      ) as CaptureMeta;
      const results = [];
      for (const row of report.results) {
        const baselinePng = await readFile(path.join(baselineRoot, platform, row.name + '.png'));
        const currentPng = await readFile(path.join(experimentCurrent, row.name + '.png'));
        results.push({
          ...row,
          raw_diff_pixels: comparePixels(baselinePng, currentPng).raw_diff_pixels,
        });
      }
      receipts.push({
        experiment: source.experiment,
        source_file: source.file,
        source_before: source.before,
        source_after: source.after,
        original_sha256: digest(original),
        edited_sha256: digest(edited),
        captured_input_hash: meta.input_hash,
        thresholds: DEFAULT_THRESHOLD,
        exit_code: exitCode,
        detected: report.changed.length > 0,
        changed: report.changed,
        results,
        report: path.relative(root, reportDir),
        baseline: path.relative(root, baselineRoot),
        current: path.relative(root, experimentCurrent),
        approved_capture_input_hash: captureMeta.input_hash,
        approved_current_sha256: Object.fromEntries(approvedHashes),
      });
    } finally {
      // Never overwrite an unexpected concurrent edit; the original remains in the temporary directory.
      assert.equal(
        digest(await readFile(file)),
        digest(edited),
        'Source drift: original preserved; restore manually',
      );
      await writeFile(file, original);
      assert.equal(digest(await readFile(file)), digest(original));
      const diff = await execute('git', ['diff', '--', ...sources.map((item) => item.file)], {
        cwd: root,
      });
      assert.equal(diff.stdout, '', 'Experimental source edit remains');
      await writeFile(
        path.join(evidence, 'source-reverse-' + source.experiment + '-restored.json'),
        JSON.stringify(
          { source: source.file, sha256: digest(original), git_diff: diff.stdout },
          null,
          2,
        ) + '\n',
      );
      await command(
        ['run', 'migration:build'],
        'source-reverse-' + source.experiment + '-restored-build.log',
      );
      await assertCurrentUnchanged();
    }
    await writeFile(
      path.join(evidence, 'source-reverse.json'),
      JSON.stringify(receipts, null, 2) + '\n',
    );
  }
  await assertCurrentUnchanged();
  for (const receipt of receipts) {
    assert.equal(receipt.exit_code, 1, 'The source experiment must fail comparison');
    assert.equal(receipt.detected, true, 'The source experiment must flag changed screens');
  }
  console.log(
    JSON.stringify({
      executed: true,
      detection_passed: receipts.every((receipt) => receipt.detected),
      results: receipts.map(({ experiment, changed, exit_code }) => ({
        experiment,
        changed,
        exit_code,
      })),
      source_restored: true,
      approved_current_unchanged: true,
      approved_current_sha256: Object.fromEntries(approvedHashes),
    }),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  await reverseValidation(root);
}
