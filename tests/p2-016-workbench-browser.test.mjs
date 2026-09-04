import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createP2016BrowserFixture } from './helpers/p2-016-browser-fixture.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';
for(const [width,height] of [[1440,900],[390,844]])test('P2-016 native browser '+width+'x'+height+' command, review, refresh, SSE, polling, XSS and auth-expiry',{timeout:90000},async()=>{
  const fixture=await createP2016BrowserFixture();let browser;
  const click=label=>browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  try{
    browser=await launchSystemBrowser({url:fixture.origin+'/workbench/lifecycle',width,height});
    await browser.waitFor("document.querySelectorAll('[data-resource-id]').length===1");
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await browser.pressTab();assert.notEqual(await browser.evaluate('document.activeElement.tagName'),'BODY');
    await browser.evaluate("document.querySelector('[data-resource-id]').click()");
    await browser.waitFor("document.querySelector('#lc-detail').textContent.includes('双责任')");
    await click('接单');await browser.waitFor("document.querySelector('#lc-detail form button')?.textContent==='确认：接单'");
    await browser.evaluate("const submit=document.querySelector('#lc-detail form button');submit.click();submit.click();");
    await browser.waitFor("document.querySelector('.detail-header .badge')?.textContent==='已接单'");
    assert.equal(fixture.calls.filter(c=>c.action==='accept').length,1);
    await click('添加备注');await browser.evaluate("document.querySelector('#lc-detail textarea').value='<script>window.p2016_xss=1</script>';document.querySelector('#lc-detail form button').click()");
    await browser.waitFor("document.querySelector('#lc-detail').textContent.includes('含内部备注')");
    assert.equal(fixture.calls.find(c=>c.action==='add-note').external_visible,false);
    assert.notEqual(await browser.evaluate('window.p2016_xss'),1);
    await browser.evaluate('location.reload()',{awaitPromise:false});await browser.waitFor("document.querySelector('#lc-detail').textContent.includes('双责任')");
    fixture.update();await browser.waitFor("document.querySelector('.detail-header .badge')?.textContent==='处理中'");
    fixture.disconnect();await browser.waitFor("document.querySelector('#lc-connection').textContent.includes('轮询')");
    const lists=fixture.listCalls;fixture.update('WAITING_VENDOR',false);
    await browser.waitFor("document.querySelector('.detail-header .badge')?.textContent==='等待厂商'");assert.ok(fixture.listCalls>lists);
    await click('待人工审核');await browser.waitFor("document.querySelector('#lc-list').textContent.includes('需要人工判断')");
    await browser.evaluate("document.querySelector('[data-resource-id]').click()");await browser.waitFor("document.querySelector('#lc-detail').textContent.includes('原始安全判定')");
    assert.equal(await browser.evaluate("document.querySelectorAll('#lc-detail img,#lc-detail script').length"),0);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await click('确认：保存人工结论并执行安全动作');await browser.waitFor("document.querySelector('#lc-detail').textContent.includes('该审核已完成')");
    assert.equal(fixture.calls.filter(c=>c.resolution_code).length,1);
    fixture.expire();await click('刷新');await browser.waitFor("document.querySelector('#lc-connection').textContent==='认证已失效'");
    assert.equal(await browser.evaluate("document.querySelector('#lc-detail').children.length"),0);
  }finally{await browser?.close();await fixture.close();}
});

test('confirmation survives realtime refetch and rejects a stale version instead of overwriting the form',{timeout:60000},async()=>{
  const fixture=await createP2016BrowserFixture();let browser;
  try{
    browser=await launchSystemBrowser({url:fixture.origin+'/workbench/lifecycle',width:1440,height:900});
    await browser.waitFor("document.querySelector('[data-resource-id]')!==null");await browser.evaluate("document.querySelector('[data-resource-id]').click()");
    await browser.waitFor("document.querySelector('.ticket-number')!==null");
    await browser.evaluate("Array.from(document.querySelectorAll('#lc-detail button')).find(b=>b.textContent==='接单').click()");
    await browser.waitFor("document.querySelector('#lc-detail form')!==null");fixture.update('IN_PROGRESS');
    await browser.waitFor("document.querySelector('#lc-list').textContent.includes('处理中')");
    assert.equal(await browser.evaluate("document.querySelector('#lc-detail form button').textContent"),'确认：接单');
    await browser.evaluate("document.querySelector('#lc-detail form button').click()");
    await browser.waitFor("document.querySelector('#lc-status').textContent.includes('状态已变化')");
    await browser.waitFor("document.querySelector('.detail-header .badge')?.textContent==='处理中'");
    assert.equal(fixture.calls.length,0);
  }finally{await browser?.close();await fixture.close();}
});
