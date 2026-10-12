import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,personalSnapshots,navigateFollowup,chooseFollowup,observeFollowupPosts,assertClosedUiCommand,rows} from './helpers/t28-followup-source-fixture.mjs';

// SOURCE_ONLY / NOT_BUILT_NOT_RUN: future reply loss leaves the actual HTTP command unchanged.
test('T28 follow-up preserves unsubmitted input across parent conflict and retains exact UNKNOWN intent',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28input',reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context),personal=await personalSnapshots(http,context.f.reports);
    await navigateFollowup(context,id);await observeFollowupPosts(context.browser);
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await http.post(path+'/start-investigating',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
    await context.browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');
    await context.browser.waitFor('document.body.innerText.includes("已捕获公共故障版本 1；当前版本 2")');
    assert.equal(await context.browser.evaluate('document.querySelector("select[aria-label=确认范围]").value'),'BUILDING');
    assert.equal(await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").disabled'),true);
    assert.equal(rows(await context.browser.evaluate('globalThis.__t28Posts')).filter(value=>value.path===path+'/correct-scope').length,0);
    await context.browser.evaluate('document.querySelector("[data-action=adopt-incident-version]").click()');
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');
    await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');
    await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已提交")');
    await assertClosedUiCommand(context.browser,path+'/correct-scope',{expected_row_version:'2',reason_code:'SCOPE_CORRECTION',confirmed_scope:'BUILDING'});assert.equal((await http.get(path)).row_version,'3');
    await navigateFollowup(context,id);await observeFollowupPosts(context.browser);
    await context.browser.evaluate(`(()=>{const send=globalThis.fetch;globalThis.__t28LostAck=null;globalThis.fetch=async(input,options)=>{const response=await send(input,options);const target=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(options?.method==='POST'&&target===${JSON.stringify(path+'/correct-scope')}){globalThis.__t28LostAck={status:response.status,body:await response.json()};throw new TypeError('T28_SYNTHETIC_REPLY_LOSS_AFTER_ACTUAL_HTTP');}return response;};})()`);
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','CAMPUS');
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');
    await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');
    const lost=record(await context.browser.evaluate('globalThis.__t28LostAck'));assert.equal(lost.status,200);assert.equal(record(lost.body).ok,true);
    const command=await assertClosedUiCommand(context.browser,path+'/correct-scope',{expected_row_version:'3',reason_code:'SCOPE_CORRECTION',confirmed_scope:'CAMPUS'}),unknown=text(await context.browser.evaluate('document.querySelector("[data-incident-unknown]").textContent'));
    assert.ok(unknown.includes(text(command.client_command_id))&&unknown.includes('3'));assert.equal((await http.get(path)).row_version,'4');
    await context.browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');
    await context.browser.waitFor('document.body.innerText.includes("当前版本 4")');
    assert.equal(await context.browser.evaluate('document.querySelector("[data-incident-unknown]").textContent'),unknown);assert.equal(await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").disabled'),true);
    const posts=rows(await context.browser.evaluate('globalThis.__t28Posts'));assert.equal(posts.filter(value=>value.path===path+'/correct-scope').length,1);
    const reads=await context.browser.evaluate('globalThis.__t27DomainReads');assert.ok(Array.isArray(reads));assert.equal(reads.some(value=>typeof value==='string'&&value.startsWith(path+'/commands/')),false);
    assert.deepEqual(await personalSnapshots(http,context.f.reports),personal);
  });
});
