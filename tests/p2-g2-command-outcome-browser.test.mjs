import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database, applyThrough031, fixtureP2012 } from './helpers/p2-012-postgres-harness.mjs';
import { launchSystemBrowser,closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

test('P2-G2 generic proxy 503 after commit keeps the command id for reconciliation; stable failure and conflict stay distinct', { timeout: 90000 }, async () => {
  await withP2012Database({ databaseUrl: process.env.PILOT_DATABASE_URL, purpose: 'g2outcome', run: async ({ pool, databaseUrl }) => {
    await applyThrough031({ pool, databaseUrl }); await migrateP2012({ databaseUrl });
    // Mechanical response-loss fixture; this does not count as normal incident recognition.
    const f = await fixtureP2012(pool, { reporters: 3 }), candidate = await f.newCandidate();
    const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port; await new Promise(r => probe.close(r));
    const origin = 'http://127.0.0.1:' + port;
    const runtime = createP2012Runtime({ pool, principalId: f.admin.id, publicOrigin: origin, listenPort: port,
      flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true }, incidentFlags: { INCIDENT_CORRELATION_ENABLED: true } });
    let browser,primaryError=null;
    const click = label => browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    const submit = async () => {
      await click('开始审核');
      await browser.evaluate("document.querySelector('select[name=reason_code]').value='OPERATOR_REVIEWED'");
      await click('确认：开始审核');
      await browser.waitFor("!document.querySelector('#detail form')");
    };
    try {
      const started = await runtime.start(); await runtime.coordinator.runOnce();
      browser = await launchSystemBrowser({ url: origin + '/workbench/incidents#mode=candidates&selected=' + candidate.id,
        width: 1440, height: 900, cookies: [started.cookie] });
      await browser.waitFor("document.querySelector('#detail').textContent.includes('冻结的候选证据')");
      await browser.evaluate(`window.originalFetch=window.fetch;window.postIds=[];window.postBodies=[];window.fault='stable';
        window.fetch=async(path,options)=>{
          if(options?.method!=='POST')return window.originalFetch(path,options);
          window.postIds.push(options.headers['Idempotency-Key']);window.postBodies.push(options.body);
          if(window.fault==='stable')return new Response(JSON.stringify({ok:false,error:{code:'P2_012_NOTIFICATION_FAILED',retryable:false},replayed:true}),{status:503});
          if(window.fault==='conflict')return new Response(JSON.stringify({ok:false,error:{code:'P2_012_VERSION_CONFLICT',retryable:false},replayed:false}),{status:409});
          const response=await window.originalFetch(path,options);window.actualResult=await response.clone().json();
          if(window.fault==='proxy')return new Response(JSON.stringify({error:'upstream unavailable'}),{status:503});
          return response;
        };`);
      await submit();
      assert.match(await browser.evaluate("document.querySelector('#status').textContent"), /业务未提交/u);
      assert.equal(await browser.evaluate("document.querySelector('#retry').hidden"), true);
      await browser.evaluate("window.fault='conflict'"); await submit();
      assert.match(await browser.evaluate("document.querySelector('#status').textContent"), /版本或状态已变化/u);
      assert.equal(await browser.evaluate("document.querySelector('#retry').hidden"), true);
      await browser.evaluate("window.fault='proxy'"); await submit();
      assert.equal((await pool.query('SELECT row_version::text FROM incident.candidate_review WHERE id=$1', [candidate.id])).rows[0].row_version, '2');
      const status = await browser.evaluate("document.querySelector('#status').textContent");
      assert.doesNotMatch(status, /业务未提交/u);
      assert.match(status, /未确认/u);
      assert.equal(await browser.evaluate("document.querySelector('#retry').hidden"), false);
      await browser.evaluate("window.fault='none';document.querySelector('#retry').click()");
      await browser.waitFor("document.querySelector('#retry').hidden&&document.querySelector('#status').textContent.includes('已提交')");
      const ids = await browser.evaluate('window.postIds'), bodies = await browser.evaluate('window.postBodies');
      assert.equal(ids.length, 4); assert.equal(ids[2], ids[3]); assert.equal(bodies[2], bodies[3]);
      assert.equal(await browser.evaluate('window.actualResult.replayed'), true);
      assert.equal((await pool.query('SELECT row_version::text FROM incident.candidate_review WHERE id=$1', [candidate.id])).rows[0].row_version, '2');
    } catch(error){primaryError=error;} finally { await closeBrowserTestResources([()=>browser?.close(),()=>runtime.stop()],primaryError); }
    assert.equal(runtime.server.listening, false);
  } });
});
