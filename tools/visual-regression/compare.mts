import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { manifest } from '../../tests/visual/manifest.mjs';
import { DEFAULT_THRESHOLD, overThreshold } from './model.mjs';
import type { CaptureMeta, Mask } from './model.mjs';
export interface Comparison {
  name: string;
  status:
    | 'unchanged'
    | 'changed'
    | 'missing-baseline'
    | 'missing-current'
    | 'unrecorded'
    | 'stale'
    | 'size-mismatch'
    | 'invalid-image';
  diff_pixels: number | null;
  diff_ratio: number | null;
  over_threshold: boolean;
  threshold: number;
  pixelmatch_threshold: number;
  threshold_reason: string | null;
  masks: readonly Mask[];
  message: string;
  baseline: string | null;
  current: string | null;
  diff: string | null;
}
export function comparePixels(
  baseline: Buffer,
  current: Buffer,
  threshold = 0.1,
): {
  diff_pixels: number;
  raw_diff_pixels: number;
  total: number;
  diff: Buffer;
  size_mismatch: boolean;
} {
  const a = PNG.sync.read(baseline),
    b = PNG.sync.read(current),
    width = Math.max(a.width, b.width),
    height = Math.max(a.height, b.height),
    total = width * height;
  const diff = new PNG({ width, height });
  if (a.width !== b.width || a.height !== b.height) {
    diff.data.fill(255);
    return {
      diff_pixels: total,
      raw_diff_pixels: total,
      total,
      diff: PNG.sync.write(diff),
      size_mismatch: true,
    };
  }
  let raw = 0;
  for (let p = 0; p < a.data.length; p += 4)
    if (
      a.data[p] !== b.data[p] ||
      a.data[p + 1] !== b.data[p + 1] ||
      a.data[p + 2] !== b.data[p + 2] ||
      a.data[p + 3] !== b.data[p + 3]
    )
      raw++;
  return {
    diff_pixels: pixelmatch(a.data, b.data, diff.data, width, height, { threshold }),
    raw_diff_pixels: raw,
    total,
    diff: PNG.sync.write(diff),
    size_mismatch: false,
  };
}
async function optionalBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    throw e;
  }
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
export async function compare(options: {
  platform: string;
  currentDir: string;
  baselineDir: string;
  reportDir: string;
  names?: readonly string[];
}): Promise<number> {
  const { platform, currentDir, baselineDir, reportDir } = options;
  const names = options.names ?? [];
  if (
    new Set(names).size !== names.length ||
    names.some((name) => !manifest.some((screen) => screen.name === name))
  ) {
    throw Error('Compare requires known, unique screen names');
  }
  const selected = names.length
    ? manifest.filter((screen) => names.includes(screen.name))
    : manifest;
  await mkdir(path.join(reportDir, 'images'), { recursive: true });
  await copyFile(
    new URL('../../../../app/pc-admin/src/design/tokens.css', import.meta.url),
    path.join(reportDir, 'tokens.css'),
  );
  const currentMeta = await optionalBytes(path.join(currentDir, 'meta.json')),
    baseMeta = await optionalBytes(path.join(baselineDir, 'meta.json'));
  const metadataErrors: string[] = [];
  let currentScreens: Record<string, string> | undefined;
  for (const [kind, bytes] of [
    ['current', currentMeta],
    ['baseline', baseMeta],
  ] as const) {
    if (!bytes) {
      metadataErrors.push(kind + ' meta.json is missing');
      continue;
    }
    try {
      const meta = JSON.parse(bytes.toString()) as CaptureMeta & { incomplete?: boolean };
      if (
        meta.schema_version !== 1 ||
        meta.platform !== platform ||
        typeof meta.os_version !== 'string' ||
        !meta.os_version ||
        typeof meta.browser_version !== 'string' ||
        !meta.browser_version ||
        meta.dpr !== 1
      ) {
        metadataErrors.push(kind + ' metadata is invalid or belongs to another platform');
      } else if (kind === 'current') {
        if (!meta.screens || typeof meta.screens !== 'object' || Array.isArray(meta.screens)) {
          metadataErrors.push('current capture receipt has no valid screens map');
        } else {
          currentScreens = meta.screens;
        }
        if (meta.incomplete)
          metadataErrors.push('current capture is incomplete; finish capture before comparing');
      }
    } catch {
      metadataErrors.push(kind + ' meta.json is invalid');
    }
  }
  const results: Comparison[] = [];
  for (const s of selected) {
    const file = s.name + '.png',
      a = await optionalBytes(path.join(baselineDir, file)),
      b = await optionalBytes(path.join(currentDir, file));
    const recorded = currentScreens !== undefined && Object.hasOwn(currentScreens, s.name);
    const verified =
      b !== null &&
      recorded &&
      createHash('sha256').update(b).digest('hex') === currentScreens?.[s.name];
    const row: Comparison = {
      name: s.name,
      status: 'unchanged',
      diff_pixels: null,
      diff_ratio: null,
      over_threshold: false,
      threshold: s.threshold.ratio,
      pixelmatch_threshold: s.threshold.pixelmatch,
      threshold_reason: s.threshold.reason ?? null,
      masks: s.mask,
      message: '',
      baseline: null,
      current: null,
      diff: null,
    };
    for (const [key, bytes] of [
      ['baseline', a],
      ['current', b],
    ] as const)
      if (bytes && (key === 'baseline' || verified)) {
        const target = 'images/' + s.name + '-' + key + '.png';
        await writeFile(path.join(reportDir, target), bytes);
        row[key] = target;
      }
    if (!b) {
      row.status = 'missing-current';
      row.message = 'Current screenshot is missing. Run visual:capture.';
    } else if (!recorded) {
      row.status = 'unrecorded';
      row.message =
        'PNG is not recorded in current meta.json.screens and was not compared. Run a full capture or explicitly compare a recorded named subset.';
    } else if (!verified) {
      row.status = 'stale';
      row.message =
        'PNG SHA-256 does not match the current capture receipt. The stale file was not compared; capture it again.';
    } else if (!a) {
      row.status = 'missing-baseline';
      row.message = 'Baseline is missing. Product owner must review and approve manually.';
    } else
      try {
        const result = comparePixels(a, b, s.threshold.pixelmatch);
        row.diff_pixels = result.diff_pixels;
        row.diff_ratio = result.diff_pixels / result.total;
        row.over_threshold = overThreshold(result.diff_pixels, result.total, s.threshold.ratio);
        row.status = result.size_mismatch
          ? 'size-mismatch'
          : row.over_threshold
            ? 'changed'
            : 'unchanged';
        row.message = result.size_mismatch
          ? 'Image dimensions differ.'
          : row.over_threshold
            ? 'Changed: configured pixel limit exceeded.'
            : result.diff_pixels === 0
              ? 'No changed pixels.'
              : 'Within the per-screen override limit.';
        row.diff = 'images/' + s.name + '-diff.png';
        await writeFile(path.join(reportDir, row.diff), result.diff);
      } catch (e) {
        row.status = 'invalid-image';
        row.message = e instanceof Error ? e.message : 'Invalid PNG';
      }
    results.push(row);
  }
  const failed = metadataErrors.length > 0 || results.some((r) => r.status !== 'unchanged'),
    summary = {
      platform,
      baseline_dir: baselineDir,
      current_dir: currentDir,
      scope: names.length ? 'named-subset' : 'full-manifest',
      selected_screens: selected.map((screen) => screen.name),
      not_compared: manifest
        .filter((screen) => !selected.includes(screen))
        .map((screen) => screen.name),
      metadata_errors: metadataErrors,
      changed: results.filter((r) => r.over_threshold).map((r) => r.name),
      missing_baselines: results.filter((r) => r.status === 'missing-baseline').map((r) => r.name),
      unrecorded: results.filter((row) => row.status === 'unrecorded').map((row) => row.name),
      stale: results.filter((row) => row.status === 'stale').map((row) => row.name),
      failed,
      results,
    };
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  const triptych = (r: Comparison, key: 'baseline' | 'current' | 'diff') =>
    `<figure><figcaption>${key}</figcaption>${r[key] ? `<a href="${r[key]}"><img alt="${escape(r.name + ' ' + key)}" src="${r[key]}" loading="lazy"></a>` : '<p>Missing / unavailable</p>'}</figure>`;
  const sections = results.map(
    (row) => `
    <section data-failed="${row.status !== 'unchanged'}">
      <h2>${escape(row.name)} · ${row.status}</h2>
      <p>
        Diff: ${row.diff_pixels ?? '—'} pixels /
        ${row.diff_ratio === null ? '—' : (row.diff_ratio * 100).toFixed(6) + '%'} ·
        limit ${row.threshold === 0 ? 'any changed pixel (ratio &gt; 0)' : 'ratio &gt; ' + (row.threshold * 100).toFixed(3) + '%'} ·
        over threshold: ${row.over_threshold ? 'YES' : 'NO'}
      </p>
      <p>${escape(row.message)} Color threshold: ${row.pixelmatch_threshold}.
        ${row.threshold_reason ? escape(row.threshold_reason) : ''}
      </p>
      ${row.masks.map((mask) => '<p>Mask: ' + escape(mask.selector) + ' · ' + escape(mask.reason) + '</p>').join('')}
      <div class="images">
        ${(['baseline', 'current', 'diff'] as const).map((key) => triptych(row, key)).join('')}
      </div>
    </section>`,
  );
  await writeFile(
    path.join(reportDir, 'index.html'),
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Visual comparison — ${escape(platform)}</title>
<link rel="stylesheet" href="tokens.css">
<style>
  body {
    font-family: var(--font-sans);
    font-size: var(--fs-md);
    margin: var(--space-6);
    background: var(--bg-subtle);
    color: var(--text-primary);
  }
  section {
    background: var(--bg-canvas);
    border: 1px solid var(--border-default);
    padding: var(--space-4);
    margin: var(--space-5) 0;
  }
  section[data-failed=true] { border-color: var(--tone-danger-fg); }
  .images { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); }
  figure { margin: 0; }
  img { width: 100%; border: 1px solid var(--border-default); }
  figcaption { font-weight: var(--fw-semibold); margin-bottom: var(--space-2); }
  a { color: inherit; }
</style>
<h1>Visual comparison · ${escape(platform)}</h1>
<p>Scope: ${summary.scope}; ${selected.length}/${manifest.length} manifest screens selected.</p>
<p>
  ${summary.changed.length} changed screens; ${summary.missing_baselines.length} missing baselines.
  ${summary.unrecorded.length} unrecorded current files; ${summary.stale.length} stale current files.
  ${failed ? 'Review required.' : 'All selected screens within configured limits.'}
</p>
<p>
  Pixelmatch ${DEFAULT_THRESHOLD.pixelmatch}; default: any changed pixel (diff count &gt; 0; ratio &gt; 0).
  Product-owner decision 2026-11-18; the card's original ratio &gt; 0.1% is superseded.
  Per-screen overrides require a reason. <a href="report.json">report.json</a>
</p>
${metadataErrors.map((error) => '<p>' + escape(error) + '</p>').join('')}
${sections.join('')}
</html>`,
  );

  if (currentMeta)
    await copyFile(path.join(currentDir, 'meta.json'), path.join(reportDir, 'current-meta.json'));
  console.log(
    JSON.stringify({
      platform,
      scope: summary.scope,
      changed: summary.changed,
      missing_baselines: summary.missing_baselines,
      unrecorded: summary.unrecorded,
      stale: summary.stale,
      metadata_errors: metadataErrors,
      report: path.join(reportDir, 'index.html'),
    }),
  );
  return failed ? 1 : 0;
}
