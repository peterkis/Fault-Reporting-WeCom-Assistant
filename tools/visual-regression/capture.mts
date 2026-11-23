import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { release, version } from 'node:os';
import path from 'node:path';
import { manifest } from '../../tests/visual/manifest.mjs';
import { withVisualFixture } from '../../tests/visual/fixture.mjs';
import { prepareScreen, fixtureScript } from '../../tests/visual/prepare.mjs';
import { installVisualStability, settleVisual } from '../../tests/helpers/visual-stable.mjs';
import {
  launchSystemBrowser,
  closeBrowserTestResources,
} from '../../tests/helpers/p2-006-browser-harness.mjs';
import type { CaptureMeta } from './model.mjs';
export async function capture(
  root: string,
  platform: string,
  currentDir: string,
  names: string[],
  runId?: string,
  transform?: (
    browser: NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>,
    name: string,
  ) => Promise<void>,
): Promise<void> {
  const database = new URL(process.env.PILOT_DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
  )
    throw Error('Visual capture requires loopback PostgreSQL');
  const selected = names.length ? manifest.filter((s) => names.includes(s.name)) : manifest;
  if (
    !selected.length ||
    names.some((n) => !manifest.some((s) => s.name === n)) ||
    new Set(names).size !== names.length
  )
    throw Error('Unknown/duplicate screen selection');
  if (runId && !/^[a-zA-Z0-9-]+$/u.test(runId)) throw Error('Invalid run id');
  const artifact = JSON.parse(
    await readFile(path.join(root, '.build/runtime/build-manifest.json'), 'utf8'),
  ) as {
    source: {
      head: string;
      input_hash: string;
    };
  };
  const meta: CaptureMeta = {
    schema_version: 1,
    platform,
    os_version:
      (process.platform === 'darwin'
        ? 'macOS ' +
          execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() +
          ' / '
        : '') +
      version() +
      ' / ' +
      release(),
    browser_version: '',
    dpr: 1,
    viewports: {},
    source_head: artifact.source.head,
    input_hash: artifact.source.input_hash,
    captured_at: new Date().toISOString(),
    screens: {},
  };
  await mkdir(currentDir, { recursive: true });
  // Invalidate the complete-capture receipt first; a failed capture must never be approvable as an older set.
  await writeFile(
    path.join(currentDir, 'meta.json'),
    JSON.stringify({ ...meta, incomplete: true }, null, 2) + '\n',
  );
  for (const s of selected) {
    console.log('Capturing ' + s.name);
    await withVisualFixture(s.prepare, async (f) => {
      const cookie = f.browserCookies[0];
      assert.ok(cookie);
      const b = await launchSystemBrowser({
        url: f.origin + '/workbench/app/',
        width: s.viewport.width,
        height: s.viewport.height,
        fullRaster: true,
        cookies: [{ ...cookie, url: cookie.url ?? f.origin + '/' }],
      });
      assert.ok(b);
      let failure: unknown;
      try {
        await installVisualStability(b, s.viewport);
        await b.command('Page.addScriptToEvaluateOnNewDocument', {
          source: fixtureScript(s.prepare.includes('fixed-presence'), f.principals[0]?.id),
        });
        const route = s.route.replace(
          /\{(processing|dismissed|completed|conversation)\}/gu,
          (_, key: keyof typeof f.ids) => f.ids[key],
        );
        if (s.route.includes('/items/')) {
          await b.command('Page.navigate', { url: f.origin + '/workbench/app/?range=all' });
          await prepareScreen(b, f, {
            ...s,
            route: '/workbench/app/?range=all',
            prepare: ['seed-board', 'expand-board-groups'],
          });
          await settleVisual(b, []);
          const id = route.split('/items/ticket/')[1]?.split('?')[0];
          assert.ok(id);
          await b.evaluate(`(() => {
  const link = document.querySelector('a[href*="/items/ticket/${id}"]');
  if (!link) throw Error('Seeded detail link missing');
  link.click();
})();`);
          await b.waitFor(
            "Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.detail-body'))",
          );
          if (route.includes('detail=page')) {
            await b.evaluate('document.querySelector(\'a[aria-label="展开完整页面"]\').click()');
            await b.waitFor("Boolean(document.querySelector('.detail-page'))");
          }
        } else await b.command('Page.navigate', { url: f.origin + route });
        await prepareScreen(b, f, s);
        if (transform) await transform(b, s.name);
        await settleVisual(b, s.mask);
        const state = (await b.evaluate(`({
  width: innerWidth,
  height: innerHeight,
  dpr: devicePixelRatio,
  now: Date.now(),
  date: new Date().getTime(),
  motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});`)) as {
          width: number;
          height: number;
          dpr: number;
          now: number;
          date: number;
          motion: boolean;
        };
        assert.deepEqual(
          [state.width, state.height, state.dpr, state.now === state.date, state.motion],
          [s.viewport.width, s.viewport.height, s.viewport.dpr, true, true],
        );
        const bytes = Buffer.from(String(await b.screenshot()), 'base64');
        await writeFile(path.join(currentDir, s.name + '.png'), bytes);
        meta.screens[s.name] = createHash('sha256').update(bytes).digest('hex');
        meta.viewports[s.name] = s.viewport;
        const info = (await b.command('Browser.getVersion')) as {
          product: string;
        };
        meta.browser_version = info.product;
      } catch (e) {
        failure = e;
        try {
          await writeFile(
            path.join(currentDir, s.name + '-failure.png'),
            Buffer.from(String(await b.screenshot()), 'base64'),
          );
          await writeFile(
            path.join(currentDir, s.name + '-failure.json'),
            JSON.stringify(
              await b.evaluate(`({
  search: location.search,
  inputs: [...document.querySelectorAll('input[name=q]')].map((n) => n.value),
  busy: document.querySelector('.workbench-search')?.getAttribute('aria-busy'),
});`),
            ),
          );
          console.error(
            'Screen preparation failed: ' +
              s.name +
              ' ' +
              String(await b.evaluate('document.body.innerText')).slice(0, 2500),
          );
        } catch (diagnosticError) {
          failure = new AggregateError(
            [e, diagnosticError],
            'Visual capture and diagnostics failed',
          );
        }
      }
      await closeBrowserTestResources(
        [
          async () => {
            await b.close();
            assert.deepEqual(b.ownedResourceState(), {
              processes: 0,
              profiles: 0,
              commandTimers: 0,
              sockets: 0,
            });
          },
        ],
        failure,
      );
    });
  }
  await writeFile(path.join(currentDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  if (runId) {
    const archive = path.join(root, '.build/visual/runs', runId, platform);
    await mkdir(archive, { recursive: true });
    for (const name of [...selected.map((s) => s.name + '.png'), 'meta.json'])
      await copyFile(path.join(currentDir, name), path.join(archive, name));
  }
  console.log(JSON.stringify({ captured: selected.length, platform, currentDir, runId }));
}
