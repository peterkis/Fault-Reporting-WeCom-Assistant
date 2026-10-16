import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser} from './helpers/t42-board-browser-fixture.mjs';

// Public browser capability-transition seam only. Every request still reaches
// the real server; only the successful bootstrap's optional T42 field changes.
// Actor/session/READ and original business flags, commands and results stay real.
const installCapabilityFallback=`(()=>{const original=globalThis.fetch;globalThis.__t42CapabilityOff=false;globalThis.__t42OffBootstraps=0;globalThis.__t42OriginalCapability=null;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path)==='/api/lifecycle/bootstrap'&&response.status===200&&globalThis.__t42CapabilityOff){const body=await response.json();globalThis.__t42OriginalCapability={board:body.board_actions_enabled,selfHandling:body.ticket_self_handling_enabled,notes:body.internal_notes_enabled};const headers=new Headers(response.headers);headers.delete('content-length');globalThis.__t42OffBootstraps++;return new Response(JSON.stringify({...body,board_actions_enabled:false}),{status:response.status,statusText:response.statusText,headers});}return response;};})()`;

test('T42 capability fallback preserves the mounted original UNKNOWN controller and exact explicit replay',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card,get)=>{
    const first=f.tickets[0];assert.ok(first);const path='/api/tickets/'+first.ticket.id;
    await browser.evaluate(installCapabilityFallback);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor("document.querySelector('[data-action=take-and-start]')?.disabled===false");
    await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
    await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('结果未知')");
    const before=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(before));assert.equal(before.length,1);
    const committed=await get(path);assert.equal(committed.status,'IN_PROGRESS');
    await browser.evaluate("globalThis.__t42OriginalDetail=document.querySelector('.detail-dialog');globalThis.__t42OriginalController=document.querySelector('.ticket-self-handling');globalThis.__t42CapabilityOff=true");
    await browser.waitFor("globalThis.__t42OffBootstraps>0&&!document.querySelector('[data-action=board-drag-handle]')");
    assert.deepEqual(await browser.evaluate('globalThis.__t42OriginalCapability'),{board:true,selfHandling:true,notes:true},'only the optional T42 capability is changed at the browser seam');
    assert.equal(await browser.evaluate("globalThis.__t42OriginalDetail.isConnected&&document.querySelector('.detail-dialog')===globalThis.__t42OriginalDetail"),true,'capability fallback must preserve the original Detail instance');
    assert.equal(await browser.evaluate("globalThis.__t42OriginalController.isConnected&&document.querySelector('.ticket-self-handling')===globalThis.__t42OriginalController"),true,'the original command controller must not unmount');
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=check-self-handling]'))"),true);
    assert.equal(await browser.evaluate("document.querySelector('[aria-label=关闭详情]')?.disabled"),true,'UNKNOWN remains an unresolved original command');
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),before,'capability change cannot submit or automatically replay');
    f.restoreSelfHandlingResponses();await browser.evaluate("document.querySelector('[data-action=check-self-handling]').click()");
    await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('已核对')");
    const after=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(after));assert.equal(after.length,2);assert.deepEqual(after[1],after[0],'explicit original-purpose replay preserves the captured UUID and complete body');
    assert.equal((await get(path)).version,committed.version,'replay cannot create another responsibility cycle');
  },{dropSelfHandlingResponses:true,realtime:true});
});

test('T42 capability fallback preserves an ordinary unsaved input and its original DOM without a business POST',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card,get)=>{
    const first=f.tickets[0];assert.ok(first);
    await browser.evaluate(installCapabilityFallback);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor("document.querySelector('textarea[aria-label=内部备注]')?.disabled===false");
    await browser.evaluate("document.querySelector('textarea[aria-label=内部备注]').focus()");
    const note='T42仅关闭拖动能力，原未保存备注和业务控制器保持挂载。';await browser.command('Input.insertText',{text:note});
    await browser.evaluate("globalThis.__t42OriginalDetail=document.querySelector('.detail-dialog');globalThis.__t42OriginalInput=document.querySelector('textarea[aria-label=内部备注]');globalThis.__t42CapabilityOff=true");
    await browser.waitFor("globalThis.__t42OffBootstraps>0&&!document.querySelector('[data-action=board-action-menu]')");
    assert.deepEqual(await browser.evaluate('globalThis.__t42OriginalCapability'),{board:true,selfHandling:true,notes:true});
    assert.equal(await browser.evaluate("globalThis.__t42OriginalDetail.isConnected&&document.querySelector('.detail-dialog')===globalThis.__t42OriginalDetail"),true);
    assert.equal(await browser.evaluate("globalThis.__t42OriginalInput.isConnected&&document.querySelector('textarea[aria-label=内部备注]')===globalThis.__t42OriginalInput"),true);
    assert.equal(await browser.evaluate("document.querySelector('textarea[aria-label=内部备注]').value"),note);
    assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]')?.disabled"),false,'the still-authorized original note action remains available');
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),[]);
    assert.equal((await get('/api/tickets/'+first.ticket.id)).status,'QUEUED');
  },{realtime:true});
});
