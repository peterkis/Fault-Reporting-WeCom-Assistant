import {writeFile,mkdir}from'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,fixtureP2012 } from './helpers/p2-012-postgres-harness.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';
for(const [width,height] of [[1440,900],[1366,768],[390,844]])test('P2-012 database-backed browser '+width+'x'+height+' human confirmation, refresh and accessibility',{timeout:90000},async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012browser',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate();
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
    const runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true}});let browser;
    const click=async label=>{
      if(label.startsWith('确认：'))await browser.evaluate("(()=>{const reason=document.querySelector('select[name=reason_code]');if(reason)reason.value='OPERATOR_REVIEWED';const primary=document.querySelector('select[name=primary_ticket_id]');if(primary)primary.value='__NONE__';const scope=document.querySelector('select[name=confirmed_scope]');if(scope)scope.value='LOCAL'})()");
      return browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    };
    try{
      const started=await runtime.start();await runtime.coordinator.runOnce();
      browser=await launchSystemBrowser({url:origin+'/workbench/incidents#mode=candidates&selected='+candidate.id,width,height,cookies:[started.cookie]});
      await browser.waitFor("document.querySelector('#detail').textContent.includes('冻结的候选证据')");
      assert.equal(await browser.evaluate("document.querySelector('#list').textContent.includes('上报人')"),true);
      assert.equal(await browser.evaluate("document.querySelector('#detail').textContent.includes('P2-015 Decision')&&document.querySelector('#detail').textContent.includes('Manual Review')"),true);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await browser.pressTab();assert.notEqual(await browser.evaluate('document.activeElement.tagName'),'BODY');
      await click('开始审核');assert.equal(await browser.evaluate("document.querySelector('select[name=reason_code]').required"),true);await click('确认：开始审核');
      await browser.waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='确认公共故障')");
      await click('确认公共故障');
      await browser.waitFor("document.querySelector('#detail form select[name=reason_code]')&&document.querySelector('#detail form select[name=primary_ticket_id]')&&document.querySelector('#detail form select[name=confirmed_scope]')");
      assert.equal(await browser.evaluate("document.querySelector('select[name=confirmed_scope]').required&&document.querySelector('select[name=primary_ticket_id]').required&&document.querySelector('select[name=reason_code]').required"),true);
      await browser.evaluate("const form=document.querySelector('#detail form');form.querySelectorAll('select')[1].selectedIndex=1;form.querySelectorAll('input[type=checkbox]').forEach(x=>x.checked=true)");
      await click('确认：确认公共故障');await browser.waitFor("!document.querySelector('#detail form')");
      const count=(await pool.query('SELECT count(*)::integer AS n FROM incident.incident')).rows[0].n;
      assert.equal(count,1,await browser.evaluate("document.querySelector('#status').textContent+' | '+document.querySelector('#detail').textContent"));
      await click('进行中的公共故障');await browser.waitFor("document.querySelector('#list strong')?.textContent.startsWith('INC-')");
      await browser.evaluate("document.querySelector('#list button').click()");await browser.waitFor("document.querySelector('#detail').textContent.includes('个人上报与恢复')");
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await click('开始调查处理');await click('确认：开始调查处理');await browser.waitFor("document.querySelector('#detail').textContent.includes('调查处理中')");
      await browser.evaluate('location.reload()',{awaitPromise:false});await browser.waitFor("document.querySelector('#detail').textContent.includes('调查处理中')");
      assert.equal(await browser.evaluate("document.querySelectorAll('#detail script,#detail img').length"),0);
      await mkdir('evidence/p2-012-browser',{recursive:true});await writeFile('evidence/p2-012-browser/workbench-'+width+'x'+height+'.png',Buffer.from(await browser.screenshot(),'base64'));
      await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[f.admin.id]);
      await click('刷新');await browser.waitFor("document.querySelector('#status').textContent.includes('访问')");
    }finally{await browser?.close();await runtime.stop();}
    assert.equal(runtime.server.listening,false);
  }});
});
