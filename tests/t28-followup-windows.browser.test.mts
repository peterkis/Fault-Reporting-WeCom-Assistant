import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,navigateFollowup,chooseFollowup,rows} from './helpers/t28-followup-source-fixture.mjs';

test('T28 real report/history pages retain at most three pages and keep an explicitly selected primary when its page leaves the window',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28windows',reporters:100},async context=>{
    const {http,id,path}=await prepareFollowup(context);
    for(let i=0;i<96;i++){const current=await http.get(path);await http.post(path+'/correct-scope',{client_command_id:randomUUID(),expected_row_version:text(current.row_version),reason_code:'SCOPE_CORRECTION',confirmed_scope:i%2?'LOCAL':'BUILDING'});}
    const reportPage=await http.get(path+'/reports?limit=30'),first=rows(reportPage.items)[0];assert.ok(first);const eventPage=await http.get(path+'/events?limit=30');assert.equal(rows(eventPage.items).length,30);assert.equal(typeof eventPage.next_cursor,'string');
    await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("section[aria-label=公共故障历史]")?.querySelectorAll("li").length===30');
    assert.equal(await context.browser.evaluate('document.querySelector("section[aria-label=公共故障历史]").innerText.includes("当前页 30 项")'),true);
    assert.equal(await context.browser.evaluate('document.querySelector("section[aria-label=关联个人报修]").querySelectorAll("li").length'),30);
    await chooseFollowup(context.browser,'公共故障操作','SET_PRIMARY_TICKET');await chooseFollowup(context.browser,'决定原因','WORKBENCH_CONFIRMED');await chooseFollowup(context.browser,'主工单',text(first.ticket_id));
    for(const part of ['报修','历史'])for(const expected of part==='报修'?[60,90,70]:[60,90,90]){await context.browser.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='下一页'+${JSON.stringify(part)}).click()`);await context.browser.waitFor(`document.querySelector(${JSON.stringify('section[aria-label="'+(part==='报修'?'关联个人报修':'公共故障历史')+'"]')}).querySelectorAll('li').length===${expected}`);}
    assert.equal(await context.browser.evaluate('document.querySelector("select[aria-label=主工单]").value'),first.ticket_id,'eviction is not an implicit change of selected primary');
    assert.equal(await context.browser.evaluate('document.querySelector("section[aria-label=关联个人报修]").innerText.includes("已加载窗口 70 项")'),true);
    assert.equal(await context.browser.evaluate('document.body.innerText.includes("共100")'),false);
    assert.equal(await context.browser.evaluate('globalThis.__t27DomainReads.filter(path=>["reports","events","subscriptions","linkable-reports"].includes(new URL(path,location.href).pathname.split("/").at(-1))).every(path=>new URL(path,location.href).searchParams.get("limit")==="30")'),true);
    const children=rows(reportPage.items);assert.equal(children.some(row=>Object.hasOwn(row,'reporter_identity_hash')),false);const events=rows(eventPage.items);assert.equal(events.some(row=>['payload_hash','safe_payload','source_command_id','actor_principal_id'].some(key=>Object.hasOwn(row,key))),false);
    assert.equal((await http.get(path)).primary_ticket_id,null,'loading pages and preserving selection do not submit a primary change');
    await context.capture();await context.browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  });
});

test('T28 a selected source survives bounded page eviction without guessing a replacement or sending',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28srcwindow',reporters:100},async context=>{
    const {http,id,path}=await prepareFollowup(context,1),first=rows((await http.get(path+'/linkable-reports?limit=30')).items)[0];assert.ok(first);
    await navigateFollowup(context,id);await chooseFollowup(context.browser,'公共故障操作','LINK_REPORT');await chooseFollowup(context.browser,'决定原因','CONFIRMED_SHARED_FAULT');await chooseFollowup(context.browser,'报修来源',text(first.source_decision_id));
    for(const expected of [60,90,69]){await context.browser.evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="下一页来源").click()');await context.browser.waitFor(`document.querySelector('section[aria-label="可关联来源窗口"]').querySelectorAll('li').length===${expected}`);}
    assert.equal(await context.browser.evaluate('document.querySelector("select[aria-label=报修来源]").value'),first.source_decision_id);assert.equal(await context.browser.evaluate('document.querySelector("section[aria-label=可关联来源窗口]").innerText.includes("已加载窗口 69 项")'),true);assert.equal((await http.get(path)).row_version,'1');assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).length,0);
  });
});
