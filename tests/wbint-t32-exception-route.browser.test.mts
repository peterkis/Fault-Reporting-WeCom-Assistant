import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t32Browser} from './helpers/t32-notification-exception-browser-fixture.mjs';
test('T32 accepted trailing-slash HTTP entry mounts the same genuine exception queue',{timeout:240000},async()=>{
 await t32Browser('t32-trailing-slash',async({browser,origin,seed})=>{
  await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===1');
  await browser.command('Page.navigate',{url:origin+'/workbench/app/notification-exceptions/'});
  await browser.waitFor('Boolean(document.querySelector(".page-title h1"))');
  assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-notification-exceptions]"))'),true,'an accepted trailing-slash entry must mount the exceptions feature');
  await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===1');
  assert.equal(await browser.evaluate('document.querySelector("[data-exception-row]").dataset.deliveryId'),seed.deliveryIds[0]);
  assert.equal(await browser.evaluate('globalThis.__t32Posts'),0);assert.equal(seed.senderCalls(),1);
 },1);
});
