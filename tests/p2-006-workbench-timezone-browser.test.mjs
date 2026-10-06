import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { launchSystemBrowser, closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

test('system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York', async (t) => {
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
  let browser,primaryError,chromeVersion;
  try {
    browser = await launchSystemBrowser({ url: `http://127.0.0.1:${port}/`, width: 390, height: 844 })
      .catch(cause=>{throw new Error('P2_006_TIMEZONE_BROWSER_START_FAILED',{cause});});
    chromeVersion=(await browser.command('Browser.getVersion')).product;
    const matrix = {};
    for (const timezone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
      await browser.setTimezone(timezone).catch(cause=>{throw new Error('P2_006_TIMEZONE_SET_FAILED:'+timezone,{cause});});
      await browser.command('Page.reload').catch(cause=>{throw new Error('P2_006_TIMEZONE_RELOAD_FAILED:'+timezone,{cause});});
      await browser.waitFor("document.readyState === 'complete' && document.body?.dataset.ready === 'true'")
        .catch(cause=>{throw new Error('P2_006_TIMEZONE_PAGE_NOT_READY:'+timezone,{cause});});
      matrix[timezone] = await browser.evaluate("document.querySelector('#value').textContent")
        .catch(cause=>{throw new Error('P2_006_TIMEZONE_VALUE_READ_FAILED:'+timezone,{cause});});
      assert.equal(matrix[timezone],'2026-09-03 12:34','P2_006_TIMEZONE_VALUE_MISMATCH:'+timezone);
      assert.equal(await browser.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone'), timezone,'P2_006_TIMEZONE_SET_FAILED:'+timezone);
    }
    assert.deepEqual(matrix, { UTC: '2026-09-03 12:34', 'Asia/Tokyo': '2026-09-03 12:34', 'America/New_York': '2026-09-03 12:34' });
  } catch(error) { primaryError=error; } finally {
    try{
      await closeBrowserTestResources([()=>browser?.close(),()=>new Promise((resolve,reject)=>{
        server.close(error=>error?reject(error):resolve());server.closeAllConnections();
      })],primaryError);
    }finally{
      t.diagnostic(JSON.stringify({kind:'P2_006_TIMEZONE_BROWSER_RESOURCES',browser_executable:browser?.executable??primaryError?.cause?.browser_executable??null,
        chrome_version:chromeVersion??null,browser_owned_resource_state:browser?.ownedResourceState()??primaryError?.cause?.browser_owned_resource_state??null,
        server_listening:server.listening,phase_error:primaryError?.message??null,cdp_exception_description:primaryError?.cause?.message??null,
        runner_image:process.env.ImageOS??null,runner_image_version:process.env.ImageVersion??null,runner_region:process.env.RUNNER_REGION??null}));
    }
  }
});
