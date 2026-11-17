import assert from 'node:assert/strict';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {candidateCopies} from './helpers/wbint-t27-draft-observation.mjs';
import {prepareFollowup,navigateFollowup,chooseFollowup,rows} from './helpers/t28-followup-source-fixture.mjs';
import {readFile} from 'node:fs/promises';

for(const pending of [false,true])test('T28 valid normalized incident draft restores regardless of old optional fields and JSON order',{timeout:240000},async()=>{
  await candidateBrowser({purpose:pending?'t28normpend':'t28norm',reporters:3,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context);await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("草稿已保存")');
    if(pending){await context.browser.evaluate(`(()=>{const send=fetch;fetch=async(path,options)=>{const response=await send(path,options);if(options?.method==='POST'&&String(path).endsWith('/correct-scope'))throw new TypeError('T28_LOST_ACK');return response;};})()`);await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');}
    const snapshot=record(await context.browser.evaluate(candidateCopies)),row=rows(snapshot.drafts).find(item=>item.kind==='incident'&&item.id===id);assert.ok(row);
    const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,scope={principal:text(record(context.f.admin).id),kind:'incident',id,purpose:'incident-followup'};
    await context.browser.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)}),value=JSON.parse(copy.text);delete value.value.direct;const reordered=JSON.stringify({pending:value.pending,value:value.value,schema:1});await store.saveDraft(copy.handle,reordered,value.pending?{commandId:value.pending.body.client_command_id}:{});})()`);
    const before=await context.browser.evaluate('performance.timeOrigin');await context.browser.command('Page.reload');await context.browser.waitFor(`performance.timeOrigin!==${JSON.stringify(before)}&&document.readyState==='complete'`);
    if(pending){await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');assert.equal(await context.browser.evaluate('document.querySelector("[data-action=submit-incident]")?.disabled'),true);}
    else{await context.browser.waitFor('document.querySelector(".workbench-select[data-field-label=确认范围] select")?.value==="BUILDING"&&/已恢复|草稿已保存/u.test(document.querySelector("[data-incident-draft]")?.textContent??"")');assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=确认范围] select")?.value'),'BUILDING');}
  });
});

test('T28 encrypted Incident follow-up restores the original unknown operation and settles only its safe receipt without a new POST',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28draft',reporters:3,recovery:true},async context=>{
    const {http,id,path}=await prepareFollowup(context);await navigateFollowup(context,id);
    assert.equal(await context.browser.evaluate('document.querySelectorAll("[data-incident-draft]").length'),1,'Incident follow-up needs its own enabled encrypted recovery consumer');
    await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("草稿已保存")');
    const initial=record(await context.browser.evaluate(candidateCopies)),saved=rows(initial.drafts).find(row=>row.kind==='incident'&&row.id===id);assert.ok(saved);assert.equal(saved.purpose,'incident-followup');assert.equal(Number(saved.expiresAt)-Number(saved.firstSavedAt),86400000);
    await context.browser.command('Page.reload');await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("已恢复")');
    assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=确认范围] select").value'),'BUILDING');assert.deepEqual(await context.browser.evaluate('globalThis.__t27Posts'),[]);
    await context.browser.evaluate(`(()=>{const send=globalThis.fetch;globalThis.__t28ActualCommand=null;globalThis.fetch=async(input,options)=>{const response=await send(input,options);if(options?.method==='POST'&&new URL(String(input),location.href).pathname===${JSON.stringify(path+'/correct-scope')}){globalThis.__t28ActualCommand=JSON.parse(options.body);await response.arrayBuffer();throw new TypeError('T28_SYNTHETIC_LOST_REPLY');}return response;};})()`);
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');
    const command=record(await context.browser.evaluate('globalThis.__t28ActualCommand'));assert.equal(command.expected_row_version,'1');assert.equal((await http.get(path)).row_version,'2');
    const stored=record(await context.browser.evaluate(candidateCopies));assert.equal(rows(stored.operations).find(row=>row.kind==='incident'&&row.id===id)?.commandId,command.client_command_id);
    const before=await context.browser.evaluate('performance.timeOrigin');await context.browser.command('Page.reload');await context.browser.waitFor('performance.timeOrigin!=='+JSON.stringify(before)+'&&Boolean(document.querySelector("[data-incident-unknown]"))&&Boolean(document.querySelector("[data-action=submit-incident]"))&&document.querySelector("[data-action=copy-diagnostics]")?.dataset.diagnostics.includes('+JSON.stringify(command.client_command_id)+')');
    assert.deepEqual(await context.browser.evaluate('globalThis.__t27Posts'),[]);assert.equal(await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").disabled'),true);
    await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已确认提交")');
    const settled=record(await context.browser.evaluate(candidateCopies));assert.equal(rows(settled.drafts).filter(row=>row.kind==='incident'&&row.id===id).length,0);assert.equal(rows(settled.operations).filter(row=>row.kind==='incident'&&row.id===id).length,0);
    assert.deepEqual(await context.browser.evaluate('globalThis.__t27Posts'),[]);assert.equal((await http.get(path)).row_version,'2');assert.ok(text(await context.browser.evaluate('document.body.innerText')).includes('个人工单'));
  });
});
