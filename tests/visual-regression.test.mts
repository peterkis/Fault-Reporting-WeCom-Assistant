import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import {
  platformName,
  browserName,
  overThreshold,
  validateManifest,
  assertHumanApproval,
  DEFAULT_THRESHOLD,
  transientCurrentRoot,
} from '../tools/visual-regression/model.mjs';
import { comparePixels, compare } from '../tools/visual-regression/compare.mjs';
import { manifest } from './visual/manifest.mjs';
import { replaceSourceOnce } from '../tools/visual-regression/reverse-validation.mjs';
import { prepareVisualEvidence } from '../tools/visual-regression/evidence.mjs';
import { mkdtemp, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('visual threshold: any changed pixel by default; explicit ratio overrides retain strict boundaries', () => {
  assert.deepEqual(DEFAULT_THRESHOLD, { pixelmatch: 0.1, ratio: 0 });
  assert.equal(overThreshold(0, 1000000, DEFAULT_THRESHOLD.ratio), false);
  assert.equal(overThreshold(1, 1000000, DEFAULT_THRESHOLD.ratio), true);
  assert.equal(overThreshold(1000, 1000000, 0.001), false);
  assert.equal(overThreshold(1001, 1000000, 0.001), true);
  assert.throws(() => overThreshold(-1, 100, 0.001));
  assert.throws(() => overThreshold(0, 0, 0.001));
});
test('visual platform/browser mapping and unsupported values', () => {
  assert.equal(platformName('darwin', 'chrome'), 'darwin-chrome');
  assert.equal(platformName('win32', 'edge'), 'win32-edge');
  assert.equal(browserName('/Applications/Microsoft Edge'), 'edge');
  assert.throws(() => platformName('../darwin', 'chrome'));
  assert.throws(() => platformName('darwin', 'safari'));
});
test('visual alternate current outputs cannot target official baselines or escape temporary artifacts', () => {
  const root = path.join(tmpdir(), 'visual-scope');
  const target = path.join(root, '.build/visual/experiment/current');
  assert.equal(transientCurrentRoot(root, target), target);
  assert.throws(() => transientCurrentRoot(root, path.join(root, 'docs/ui/visual-baseline')));
  assert.throws(() => transientCurrentRoot(root, path.join(root, '.build/visual/../../docs')));
  assert.throws(() => transientCurrentRoot(root, path.join(root, '..', 'elsewhere')));
});
test('visual manifest: exact 18 names, viewport and mandatory override/mask reasons', () => {
  validateManifest(manifest);
  assert.equal(manifest.length, 18);
  for (const screen of manifest) {
    assert.deepEqual(screen.threshold, DEFAULT_THRESHOLD);
    assert.deepEqual(screen.mask, []);
  }
  const first = manifest[0];
  assert.ok(first);
  assert.throws(() => validateManifest([first, first]));
  assert.throws(() =>
    validateManifest([{ ...first, threshold: { pixelmatch: 0.1, ratio: 0.001 } }]),
  );
  assert.throws(() => validateManifest([{ ...first, threshold: { pixelmatch: 0.2, ratio: 0 } }]));
  assert.throws(() =>
    validateManifest([{ ...first, threshold: { pixelmatch: 0.1, ratio: 0.001, reason: ' ' } }]),
  );
  validateManifest([{ ...first, threshold: { pixelmatch: 0.1, ratio: 0 } }]);
  assert.throws(() => validateManifest([{ ...first, mask: [{ selector: '.live', reason: ' ' }] }]));
  assert.throws(() =>
    validateManifest([{ ...first, viewport: { width: 0, height: 1000, dpr: 1 } }]),
  );
  validateManifest([
    {
      ...first,
      threshold: {
        pixelmatch: 0.1,
        ratio: 0.001,
        reason: '单元测试：小面积固定噪声的显式比例覆盖',
      },
      mask: [{ selector: '.live', reason: '单元测试：验证小区域必须说明遮罩理由' }],
    },
  ]);
});
test('visual approval refuses non-TTY and agents, including empty marker values', () => {
  assert.throws(() => assertHumanApproval(false, {}));
  assert.throws(() => assertHumanApproval(undefined, {}));
  for (const key of [
    'CODEX_THREAD_ID',
    'CODEX_CI',
    'CLAUDECODE',
    'CURSOR_AGENT',
    'CI',
    'AGENT_ID',
    'GITHUB_ACTIONS',
  ])
    assert.throws(() => assertHumanApproval(true, { [key]: '' }));
  assertHumanApproval(true, { PATH: '/bin' });
});
test('visual images: equality, raw stability, pixel difference and dimension failure', () => {
  const a = new PNG({ width: 100, height: 100 });
  a.data.fill(255);
  const bytes = PNG.sync.write(a);
  assert.equal(comparePixels(bytes, bytes).raw_diff_pixels, 0);
  for (let i = 0; i < 100; i++) a.data[i * 4] = 0;
  const changed = comparePixels(bytes, PNG.sync.write(a));
  assert.equal(changed.raw_diff_pixels, 100);
  assert.ok(changed.diff_pixels > 0);
  assert.equal(
    comparePixels(bytes, PNG.sync.write(new PNG({ width: 50, height: 100 }))).size_mismatch,
    true,
  );
});
test('visual missing baseline/current produces a complete readable report and failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'visual-tool-'));
  try {
    assert.equal(
      await compare({
        platform: 'darwin-chrome',
        currentDir: path.join(dir, 'current'),
        baselineDir: path.join(dir, 'baseline'),
        reportDir: path.join(dir, 'report'),
      }),
      1,
    );
    const report = JSON.parse(await readFile(path.join(dir, 'report/report.json'), 'utf8')) as {
      results: unknown[];
    };
    assert.equal(report.results.length, 18);
    assert.match(
      await readFile(path.join(dir, 'report/index.html'), 'utf8'),
      /Current screenshot is missing/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('visual report flags the changed screen and clearly reports a missing baseline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'visual-report-')),
    current = path.join(dir, 'current'),
    baseline = path.join(dir, 'baseline');
  const { mkdir, writeFile } = await import('node:fs/promises');
  try {
    await mkdir(current);
    await mkdir(baseline);
    const meta = {
      schema_version: 1,
      platform: 'darwin-chrome',
      os_version: 'synthetic',
      browser_version: 'Chrome/synthetic',
      dpr: 1,
      screens: {} as Record<string, string>,
    };
    for (const screen of manifest) {
      const png = new PNG({ width: screen.viewport.width, height: screen.viewport.height });
      png.data.fill(255);
      const bytes = PNG.sync.write(png);
      meta.screens[screen.name] = createHash('sha256').update(bytes).digest('hex');
      await writeFile(path.join(current, screen.name + '.png'), bytes);
      await writeFile(path.join(baseline, screen.name + '.png'), bytes);
    }
    for (const folder of [current, baseline])
      await writeFile(path.join(folder, 'meta.json'), JSON.stringify(meta));
    const options = {
      platform: 'darwin-chrome',
      currentDir: current,
      baselineDir: baseline,
      reportDir: path.join(dir, 'report'),
    };
    assert.equal(await compare(options), 0);
    const first = manifest[0];
    assert.ok(first);
    const png = PNG.sync.read(await readFile(path.join(current, first.name + '.png')));
    // One changed pixel in the whole viewport must fail the default comparison.
    png.data[0] = 0;
    const changed = PNG.sync.write(png);
    await writeFile(path.join(current, first.name + '.png'), changed);
    meta.screens[first.name] = createHash('sha256').update(changed).digest('hex');
    await writeFile(path.join(current, 'meta.json'), JSON.stringify(meta));
    assert.equal(await compare(options), 1);
    let report = JSON.parse(
      await readFile(path.join(options.reportDir, 'report.json'), 'utf8'),
    ) as {
      changed: string[];
      missing_baselines: string[];
      results: { name: string; diff_pixels: number; threshold: number }[];
    };
    assert.deepEqual(report.changed, [first.name]);
    assert.equal(report.results[0]?.diff_pixels, 1);
    assert.equal(report.results[0]?.threshold, 0);
    const html = await readFile(path.join(options.reportDir, 'index.html'), 'utf8');
    assert.match(html, /default: any changed pixel/u);
    assert.match(html, /Product-owner decision 2026-11-18/u);
    await rm(path.join(baseline, first.name + '.png'));
    assert.equal(await compare(options), 1);
    report = JSON.parse(
      await readFile(path.join(options.reportDir, 'report.json'), 'utf8'),
    ) as typeof report;
    assert.deepEqual(report.missing_baselines, [first.name]);
    assert.match(
      await readFile(path.join(options.reportDir, 'index.html'), 'utf8'),
      /Baseline is missing/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('visual realtime fixtures stay fixed while business reads still use the real transport', async () => {
  const { runInNewContext } = await import('node:vm'),
    { fixtureScript } = await import('./visual/prepare.mjs');
  const forwarded: string[] = [];
  const context: Record<string, unknown> = {
    EventTarget,
    Event,
    Request,
    Response,
    URL,
    queueMicrotask,
    Date: { now: () => 1794535200000 },
    location: { href: 'http://127.0.0.1/workbench/app/' },
    fetch: async (input: string) => {
      forwarded.push(input);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  };
  context.window = context;
  runInNewContext(fixtureScript(true), context);
  const Source = context.EventSource as new (url: string) => EventTarget & {
    readyState: number;
    close(): void;
  };
  const source = new Source('/api/realtime/events?scope=workbench');
  await new Promise<void>((resolve) =>
    source.addEventListener('open', () => resolve(), { once: true }),
  );
  assert.equal(source.readyState, 1);
  source.close();
  assert.equal(source.readyState, 2);
  const fetchFixture = context.fetch as (
    input: string,
    options?: {
      method: string;
      body?: string;
    },
  ) => Promise<Response>;
  const first = await (await fetchFixture('/api/workbench/online')).json(),
    second = await (await fetchFixture('/api/workbench/online')).json();
  assert.deepEqual(first, second);
  const ack = (await (
    await fetchFixture('/api/workbench/activity', { method: 'POST', body: '{}' })
  ).json()) as {
    accepted: boolean;
    expires_epoch_ms: string;
  };
  assert.equal(ack.accepted, true);
  assert.equal(ack.expires_epoch_ms, '1794535215000');
  const bootstrap = (await (await fetchFixture('/api/lifecycle/bootstrap')).json()) as {
    expires_epoch_ms: string;
  };
  assert.equal(bootstrap.expires_epoch_ms, '1794536100000');
  await fetchFixture('/api/workbench/board?column=pending');
  assert.deepEqual(forwarded, ['/api/lifecycle/bootstrap', '/api/workbench/board?column=pending']);
});

test('visual source experiment rejects ambiguous edits and changes exactly one real fragment', () => {
  const source = ':root { --radius-lg: 12px; }';
  assert.equal(
    replaceSourceOnce(source, '--radius-lg: 12px;', '--radius-lg: 14px;'),
    ':root { --radius-lg: 14px; }',
  );
  assert.throws(() =>
    replaceSourceOnce(source + source, '--radius-lg: 12px;', '--radius-lg: 14px;'),
  );
  assert.throws(() => replaceSourceOnce(source, '--radius-lg: 13px;', '--radius-lg: 14px;'));
  assert.throws(() => replaceSourceOnce(source, '--radius-lg: 12px;', '--radius-lg: 12px;'));
});

test('visual clock freezes Date.now and new Date, preserving explicit constructors and Date.UTC', async () => {
  const { runInNewContext } = await import('node:vm');
  const { VISUAL_CLOCK_SCRIPT } = await import('./helpers/visual-stable.mjs');
  const context = {
    document: {
      documentElement: { append() {} },
      createElement: () => ({ dataset: {}, textContent: '' }),
    },
  };
  runInNewContext(VISUAL_CLOCK_SCRIPT, context);
  const actual = runInNewContext(
    `[
    Date.now(), new Date().getTime(), new Date(123).getTime(), Date.UTC(2000, 0, 1),
    new Date(2026, 10, 13, 10).getTime()
  ]`,
    context,
  ) as number[];
  assert.deepEqual(Array.from(actual), [
    new Date(2026, 10, 13, 10).getTime(),
    new Date(2026, 10, 13, 10).getTime(),
    123,
    946684800000,
    new Date(2026, 10, 13, 10).getTime(),
  ]);
});

async function withReceiptFixture(
  run: (fixture: {
    options: { platform: string; currentDir: string; baselineDir: string; reportDir: string };
    meta: {
      schema_version: number;
      platform: string;
      os_version: string;
      browser_version: string;
      dpr: number;
      screens: Record<string, string>;
    };
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'visual-receipt-'));
  const options = {
    platform: 'darwin-chrome',
    currentDir: path.join(directory, 'current'),
    baselineDir: path.join(directory, 'baseline'),
    reportDir: path.join(directory, 'report'),
  };
  try {
    const png = new PNG({ width: 100, height: 100 });
    png.data.fill(255);
    const bytes = PNG.sync.write(png);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const meta = {
      schema_version: 1,
      platform: options.platform,
      os_version: 'synthetic',
      browser_version: 'Chrome/synthetic',
      dpr: 1,
      screens: Object.fromEntries(manifest.map((screen) => [screen.name, sha])),
    };
    for (const folder of [options.currentDir, options.baselineDir]) {
      await mkdir(folder);
      for (const screen of manifest)
        await writeFile(path.join(folder, screen.name + '.png'), bytes);
      await writeFile(path.join(folder, 'meta.json'), JSON.stringify(meta));
    }
    await run({ options, meta });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('visual partial capture cannot silently reuse 17 old PNGs; named subset is explicit', async () => {
  await withReceiptFixture(async ({ options, meta }) => {
    assert.equal(await compare(options), 0);
    const first = manifest[0];
    assert.ok(first);
    const partial = { ...meta, screens: { [first.name]: meta.screens[first.name] } };
    await writeFile(path.join(options.currentDir, 'meta.json'), JSON.stringify(partial));
    assert.equal(await compare(options), 1);
    const report = JSON.parse(
      await readFile(path.join(options.reportDir, 'report.json'), 'utf8'),
    ) as {
      unrecorded: string[];
      results: { status: string; current: string | null }[];
    };
    assert.equal(report.unrecorded.length, 17);
    assert.ok(
      report.results
        .filter((row) => row.status === 'unrecorded')
        .every((row) => row.current === null),
    );
    const subset = { ...options, names: [first.name] };
    assert.equal(await compare(subset), 0);
    const selected = JSON.parse(
      await readFile(path.join(options.reportDir, 'report.json'), 'utf8'),
    ) as {
      scope: string;
      selected_screens: string[];
      not_compared: string[];
    };
    assert.equal(selected.scope, 'named-subset');
    assert.deepEqual(selected.selected_screens, [first.name]);
    assert.equal(selected.not_compared.length, 17);
    await assert.rejects(compare({ ...options, names: ['unknown-screen'] }));
  });
});

test('visual current PNG hash must match the receipt; incomplete capture also fails closed', async () => {
  await withReceiptFixture(async ({ options, meta }) => {
    const first = manifest[0];
    assert.ok(first);
    const file = path.join(options.currentDir, first.name + '.png');
    const png = PNG.sync.read(await readFile(file));
    png.data[0] = 0;
    await writeFile(file, PNG.sync.write(png));
    assert.equal(await compare(options), 1);
    const report = JSON.parse(
      await readFile(path.join(options.reportDir, 'report.json'), 'utf8'),
    ) as {
      stale: string[];
      results: { status: string; current: string | null; diff: string | null }[];
    };
    assert.deepEqual(report.stale, [first.name]);
    assert.equal(report.results[0]?.status, 'stale');
    assert.equal(report.results[0]?.current, null);
    assert.equal(report.results[0]?.diff, null);
    await writeFile(file, await readFile(path.join(options.baselineDir, first.name + '.png')));
    await writeFile(
      path.join(options.currentDir, 'meta.json'),
      JSON.stringify({ ...meta, incomplete: true }),
    );
    assert.equal(await compare({ ...options, names: [first.name] }), 1);
  });
});

test('visual evidence writers prepare fresh nested logs before ordinary and restore-path writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'visual-evidence-'));
  try {
    const first = await prepareVisualEvidence(root);
    assert.equal((await stat(first.logs)).isDirectory(), true);
    await writeFile(path.join(first.logs, 'experiment.log'), 'synthetic experiment');
    await writeFile(path.join(first.logs, 'restored-build.log'), 'synthetic restore');
    await writeFile(path.join(first.directory, 'stability.json'), '{}');
    assert.deepEqual(await prepareVisualEvidence(root), first);
    assert.equal(
      await readFile(path.join(first.logs, 'restored-build.log'), 'utf8'),
      'synthetic restore',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
