import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {IncomingMessage} from 'node:http';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser,fillWaiting} from './helpers/t10-browser-fixture.mjs';

test('production cancellation requires an independent human confirmation and preserves a closed form reason without sending or creating a round',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context),target=context.tickets[0];assert.ok(target);const before=await http.detail(target.ticket.id);assert.equal(before.status,'QUEUED');assert.equal(before.handling_cycle,null);
    const path='/api/tickets/'+target.ticket.id+'/cancel';let posts=0;const observe=(request:IncomingMessage)=>{if(request.method==='POST'&&request.url===path)posts++;};context.runtime.server.on('request',observe);
    try{await withT10Browser(context,target.ticket.id,0,'T10_SEPARATE_LEGAL_CANCEL_CONFIRMATION',async(browser,capture)=>{
      const form='form[aria-label="取消工单"]',input=form+' textarea[aria-label="取消原因"]',submit=form+' button[type="submit"]',note='INTERNAL_T10_CANCEL_UI：报修人撤销合成请求。';
      await browser.waitFor("Boolean(document.querySelector('[data-action=cancel]'))&&!document.querySelector('[data-action=cancel]').disabled");await browser.evaluate("document.querySelector('[data-action=cancel]').click()");await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).disabled`),true);await browser.evaluate(fillWaiting(input,note));assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).disabled`),true);
      await browser.evaluate(`Array.from(document.querySelector(${JSON.stringify(form)}).querySelectorAll('button')).find(row=>row.textContent==='关闭表单').click()`);assert.equal(posts,0);assert.equal((await http.detail(target.ticket.id)).status,'QUEUED');
      await browser.evaluate("document.querySelector('[data-action=cancel]').click()");await browser.waitFor(`document.querySelector(${JSON.stringify(input)})?.value===${JSON.stringify(note)}`);assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(form+' input[type="checkbox"]')}).checked`),false);
      await browser.evaluate(`document.querySelector(${JSON.stringify(form+' input[type="checkbox"]')}).click()`);await browser.waitFor(`!document.querySelector(${JSON.stringify(submit)}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).click()`);
      await browser.waitFor("document.querySelector('[data-waiting-purpose=cancel] .ticket-waiting-state')?.innerText.includes('工单已取消')");const after=await http.detail(target.ticket.id);assert.equal(posts,1);assert.equal(after.status,'CANCELLED');assert.equal(after.version,before.version+1);assert.equal(after.handling_cycle,null);assert.equal(after.assignee_id,before.assignee_id);assert.equal(after.resolver_team_id,before.resolver_team_id);
      await capture('new-detail-1920.png');
    });}finally{context.runtime.server.removeListener('request',observe);}
  });
});
