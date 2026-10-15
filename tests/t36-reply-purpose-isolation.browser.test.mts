import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply,supplementRow} from './helpers/t36-browser-risk-journey.mjs';
test('T36 loss of only Session REPLY preserves readable Ticket and independent disposition input',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async(browser,capture)=>{const row=supplementRow(f.r2),internal='T36_STILL_AUTHORIZED_INTERNAL_DISPOSITION';await input(browser,row+' textarea',internal);await browser.waitFor('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("已保存")');await openReply(browser,f.r2);await input(browser,'[data-supplement-bound-reply] textarea','T36原Session回复独立正文');await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("已保存")');
  await f.setActorRoles(['DISPATCHER']);const session=await f.read<{capabilities:string[]}>('/api/workbench/conversations/'+f.sessionId);assert.equal(session.capabilities.includes('REPLY'),false);assert.equal((await f.get('/api/tickets/'+f.ticketId)).status,200);assert.equal((await f.page()).items.some(item=>item.source_ref===f.r2.source_ref),true);
  await browser.evaluate('document.querySelector("[data-action=send-conversation-reply]").click()');await browser.waitFor('document.querySelector("[data-reply-outcome]")?.textContent.length>0||!document.querySelector("[data-supplement-bound-reply]")||!document.querySelector("[data-supplement-follow-up-state] li")');await capture();
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row+' textarea')})?.value`),internal,'REPLY loss cannot purge an independently authorized disposition draft or readable Ticket view');assert.equal(await browser.evaluate('globalThis.__t36Risk.filter(row=>row.method==="POST").length'),0);
 });
},{recovery:true}));
