import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply,supplementRow} from './helpers/t36-browser-risk-journey.mjs';
test('T36 a retained readable supplement after the first 50 remains an exact reply target',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 let last=f.r2;for(let i=0;i<51;i++)last=await f.appendR3();
 const first=await f.page();assert.equal(first.items.length,50);assert.ok(first.next_cursor);assert.equal(first.items.some(row=>row.source_ref===last.source_ref),false);
 await withT36Browser(f,async(browser,capture)=>{await browser.evaluate(`Array.from(document.querySelectorAll('[data-supplement-follow-up-state] button')).find(b=>b.textContent==='加载更多补充').click()`);await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(supplementRow(last))}))`);await openReply(browser,last);
  await input(browser,'[data-supplement-bound-reply] textarea','T36合法后页材料独立回复');await browser.waitFor('Boolean(document.querySelector("[data-action=send-conversation-reply]:not(:disabled)"))');await browser.evaluate('document.querySelector("[data-action=send-conversation-reply]").click()');
  await browser.waitFor('globalThis.__t36Risk.some(row=>row.method==="POST"&&row.path.endsWith("/messages"))||(document.querySelector("[data-reply-outcome]")?.textContent.length>0&&!document.querySelector("[data-reply-outcome]")?.textContent.includes("正在"))||!document.querySelector("[data-supplement-bound-reply]")');await capture();
  const posted=await browser.evaluate('globalThis.__t36Risk.filter(row=>row.method==="POST"&&row.path.endsWith("/messages"))') as {status:number}[];assert.equal(posted.length,1,'an authorized later page target must reach the real original Message HTTP command');assert.equal(posted[0]?.status,202);
 });
}));
