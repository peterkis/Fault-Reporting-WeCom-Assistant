import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';

test('system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York', async () => {
  const moduleSource = await readFile('web/p2-workbench/time-display.mjs', 'utf8');
  const server = createServer((request, response) => {
    if (request.url === '/time-display.mjs') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(moduleSource); return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><output id="value"></output><script type="module">import { workbenchLocalDateTimeDisplay } from './time-display.mjs';document.querySelector('#value').textContent=workbenchLocalDateTimeDisplay('2026-09-03 12:34:56');document.body.dataset.ready='true';</script>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const browser = await launchSystemBrowser({ url: `http://127.0.0.1:${port}/`, width: 390, height: 844 });
  try {
    const matrix = {};
    for (const timezone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
      await browser.setTimezone(timezone);
      await browser.evaluate('location.reload()');
      await browser.waitFor("document.body.dataset.ready === 'true'");
      matrix[timezone] = await browser.evaluate("document.querySelector('#value').textContent");
      assert.equal(await browser.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone'), timezone);
    }
    assert.deepEqual(matrix, { UTC: '2026-09-03 12:34', 'Asia/Tokyo': '2026-09-03 12:34', 'America/New_York': '2026-09-03 12:34' });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
