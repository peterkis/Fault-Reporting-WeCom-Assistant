import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t31Browser} from './helpers/t31-public-progress-browser-fixture.mjs';
test('T31 production bundle begins with an independent empty summary and requires preview plus explicit confirmation before publication',async()=>{
  await t31Browser('t31browser',async({browser,put,capture,get,incidentId})=>{
    assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=公开进展摘要]").value'),'');
    assert.equal(await browser.evaluate('document.querySelector("[data-action=submit-public-progress]").disabled'),true);
    await put('合成人工摘要：正在核查服务连接。');
    assert.equal(await browser.evaluate('document.querySelector("[data-action=submit-public-progress]").disabled'),true);
    await browser.evaluate('document.querySelector("[data-action=preview-public-progress]").click()');
    await browser.waitFor('document.querySelector("[data-public-progress-preview]")?.textContent.includes("正在核查服务连接")');
    assert.equal(await browser.evaluate('document.querySelector("[data-action=submit-public-progress]").disabled'),true);
    await browser.evaluate('document.querySelector("input[aria-label=确认安全公开摘要]").click()');
    await browser.waitFor('document.querySelector("[data-action=submit-public-progress]")?.disabled===false');
    await capture('preview');await browser.evaluate('document.querySelector("[data-action=submit-public-progress]").click()');
    await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("已发布")');
    const response=await get('/api/incidents/'+incidentId+'/public-progress?limit=10');assert.equal(response.status,200);assert.ok(Array.isArray(response.body.items));assert.equal(response.body.items.length,1);
    await browser.waitFor('document.querySelector("[data-public-progress-routes]")?.textContent.includes("待发送")');
  });
});
