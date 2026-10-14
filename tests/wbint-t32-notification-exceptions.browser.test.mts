import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t32Browser} from './helpers/t32-notification-exception-browser-fixture.mjs';
import {t32Record,t32Text} from './helpers/t32-notification-exception-fixture.mjs';

test('T32 production bundle reads the bounded real queue and exact item instead of per-card fanout',{timeout:240000},async()=>{
  await t32Browser('t32-real-queue',async({browser,seed,capture})=>{
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-notification-exceptions]"))'),true,'the formal exceptions page must be mounted');
    await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===10');
    const ids=await browser.evaluate('Array.from(document.querySelectorAll("[data-exception-row]")).map(row=>row.dataset.deliveryId)');assert.ok(Array.isArray(ids));assert.equal(new Set(ids).size,10);assert.ok(ids.every(id=>seed.deliveryIds.includes(t32Text(id))));
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-exception-row][data-delivery-status=RECONCILIATION_REQUIRED]").length>0'),true);
    const selected=t32Text(ids[0]);await browser.evaluate('document.querySelector("[data-action=open-exception]").click()');
    await browser.waitFor(`document.querySelector('[data-exception-detail]')?.dataset.deliveryId===${JSON.stringify(selected)}`);await capture('detail');
    const reads=await browser.evaluate('globalThis.__t32Reads');assert.ok(Array.isArray(reads));assert.ok(reads.map(t32Record).some(r=>r.status===200&&r.id===selected),'the exact item GET completed with the selected fact');
    assert.equal(await browser.evaluate('document.querySelector("[data-action=next-exceptions]").disabled'),false);await browser.evaluate('document.querySelector("[data-action=next-exceptions]").click()');
    await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===1');assert.equal(await browser.evaluate('document.querySelector("[data-action=next-exceptions]").disabled'),true);
    const after=await browser.evaluate('globalThis.__t32Reads');assert.ok(Array.isArray(after));assert.ok(after.map(t32Record).some(r=>r.status===200&&Array.isArray(r.items)&&r.items.length===1));
    assert.equal(await browser.evaluate('/T32_PRIVATE_SESSION_CANARY|T32_RAW_PROVIDER_CANARY|target_hash|target_id|provider_message/.test(document.body.innerText)'),false);
    assert.equal(await browser.evaluate('globalThis.__t32Posts'),0);assert.equal(seed.senderCalls(),11);assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  });
});
