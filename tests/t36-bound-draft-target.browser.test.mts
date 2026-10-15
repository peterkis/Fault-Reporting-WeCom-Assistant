import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply,closeReply} from './helpers/t36-browser-risk-journey.mjs';
test('T36 an unsent encrypted r2 reply never restores as r3 after r2 retention expires',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async(browser,capture)=>{await openReply(browser,f.r2);const privateText='T36_ONLY_ORIGINAL_R2_UNSENT_BODY';await input(browser,'[data-supplement-bound-reply] textarea',privateText);await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("已保存")');await closeReply(browser);
  const r3=await f.appendR3();await f.expire(f.r2);await browser.evaluate('document.querySelector("[data-action=refresh-supplement-follow-up]").click()');await openReply(browser,r3);await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("草稿")||document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("恢复")');await capture();
  assert.equal(await browser.evaluate('document.querySelector("[data-supplement-bound-reply] textarea").value'),'','r2 body must not be decrypted or retargeted under the authorized r3 context');assert.equal(await browser.evaluate('globalThis.__t36Risk.filter(row=>row.method==="POST").length'),0);
 });
},{recovery:true}));
