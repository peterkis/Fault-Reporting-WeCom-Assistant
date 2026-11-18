import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from '../../tests/visual/manifest.mjs';
import { comparePixels } from './compare.mjs';
import type { CaptureMeta } from './model.mjs';
import { prepareVisualEvidence } from './evidence.mjs';
export async function stability(
  root: string,
  platform: string,
  runs: readonly string[],
): Promise<void> {
  if (
    runs.length !== 5 ||
    new Set(runs).size !== 5 ||
    runs.some((r) => !/^[a-zA-Z0-9-]+$/u.test(r))
  )
    throw Error('Exactly five distinct capture run IDs required');
  const rows: {
    name: string;
    pairwise_max: number;
    runs: {
      run: string;
      raw_diff_pixels: number;
    }[];
  }[] = [];
  const metas: CaptureMeta[] = [];
  for (const run of runs)
    metas.push(
      JSON.parse(
        await readFile(path.join(root, '.build/visual/runs', run, platform, 'meta.json'), 'utf8'),
      ) as CaptureMeta,
    );
  const first = metas[0];
  assert.ok(first);
  for (const meta of metas) {
    assert.equal(meta.source_head, first.source_head);
    assert.equal(meta.input_hash, first.input_hash);
    assert.equal(meta.os_version, first.os_version);
    assert.equal(meta.browser_version, first.browser_version);
    assert.equal(meta.platform, platform);
    assert.equal(Object.keys(meta.screens).length, manifest.length);
  }
  for (const screen of manifest) {
    const bytes: Buffer[] = [];
    for (const run of runs)
      bytes.push(
        await readFile(path.join(root, '.build/visual/runs', run, platform, screen.name + '.png')),
      );
    let max = 0;
    for (let a = 0; a < 5; a++)
      for (let b = a + 1; b < 5; b++) {
        const left = bytes[a],
          right = bytes[b];
        assert.ok(left && right);
        max = Math.max(max, comparePixels(left, right).raw_diff_pixels);
      }
    const base = bytes[0];
    assert.ok(base);
    rows.push({
      name: screen.name,
      pairwise_max: max,
      runs: runs.map((run, i) => {
        const current = bytes[i];
        assert.ok(current);
        return { run, raw_diff_pixels: comparePixels(base, current).raw_diff_pixels };
      }),
    });
  }
  const { directory: dir } = await prepareVisualEvidence(root);
  const result = {
    passed: rows.every((r) => r.pairwise_max === 0),
    platform,
    os_version: first.os_version,
    browser_version: first.browser_version,
    source_head: first.source_head,
    input_hash: first.input_hash,
    comparisons: manifest.length * 10,
    runs,
    rows,
  };
  await writeFile(path.join(dir, 'stability.json'), JSON.stringify(result, null, 2) + '\n');
  const tableRows = runs.map((run) => {
    const values = rows.map(
      (row) => row.runs.find((item) => item.run === run)?.raw_diff_pixels ?? 'MISSING',
    );
    return '| ' + run + ' | ' + values.join(' | ') + ' |';
  });
  const summaryRows = rows.map((row) => '| ' + row.name + ' | ' + row.pairwise_max + ' |');
  const markdown = [
    '# Five consecutive captures',
    '',
    `${platform}; ${first.os_version}; ${first.browser_version}; DPR 1.`,
    '',
    `Head: \`${first.source_head}\`; uncommitted input fingerprint: \`${first.input_hash}\`.`,
    'Same build and machine; each screen owns a new DB/browser. All 10 pairs per screen',
    'are compared with raw RGBA differences, with zero tolerance.',
    `Screens with masks: ${manifest.filter((screen) => screen.mask.length > 0).length}.`,
    '',
    '| Run | ' + manifest.map((screen) => screen.name).join(' | ') + ' |',
    '| --- | ' + manifest.map(() => '---:').join(' | ') + ' |',
    ...tableRows,
    '',
    '| Screen | Maximum raw changed pixels over 10 pairs |',
    '| --- | ---: |',
    ...summaryRows,
    '',
    `Result: ${result.passed ? 'PASS' : 'FAIL'}; ${result.comparisons} pairwise comparisons.`,
    '',
  ].join('\n');
  await writeFile(path.join(dir, 'stability.md'), markdown);

  console.log(
    JSON.stringify({
      passed: result.passed,
      pairwise: result.comparisons,
      failures: rows.filter((r) => r.pairwise_max > 0),
    }),
  );
  if (!result.passed) throw Error('Screens are unstable; do not approve');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, ...runs] = process.argv.slice(2);
  if (!platform) throw Error('Platform required');
  await stability(fileURLToPath(new URL('../../../../', import.meta.url)), platform, runs);
}
