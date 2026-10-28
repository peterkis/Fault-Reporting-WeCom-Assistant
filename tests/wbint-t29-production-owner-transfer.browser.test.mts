import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ownerTransferBrowser} from './helpers/t29-owner-transfer-browser-fixture.mjs';
import {record,text} from './helpers/t29-owner-transfer-http-fixture.mjs';
test('T29 production bundle explicitly transfers once, renders responsibility history and reloads authoritative owner facts',{timeout:240000},async()=>{
  await ownerTransferBrowser(async context=>{
    const {browser,incidentId,choose,get,f}=context,path='/api/incidents/'+incidentId,target=text(record(f.dispatcher).id);
    await browser.waitFor(`Boolean(document.querySelector('.workbench-select[data-field-label="交接负责人"] select option[value="${target}"]'))`);
    const before=(await get(path)).body,notifications=await get(path+'/notifications?limit=100');
    assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0);
    await choose('交接负责人',target);await choose('交接责任组','PILOT_IT');await choose('交接原因','OPERATOR_REVIEWED');
    assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0,'selecting inputs must not POST');
    await browser.waitFor('!document.querySelector("[data-action=submit-owner-transfer]").disabled');
    await browser.evaluate('document.querySelector("[data-action=submit-owner-transfer]").click()');
    await browser.waitFor('document.querySelector("[data-owner-transfer-outcome]")?.textContent.includes("交接已提交")');
    const after=(await get(path)).body;assert.equal(after.owner_principal_id,target);assert.equal(after.owner_team_id,'PILOT_IT');assert.equal(after.row_version,'2');assert.equal(after.status,before.status);
    const display=`(()=>{const root=document.querySelector('[data-incident-id="${incidentId}"]');const value=label=>[...(root?.querySelectorAll('dt')??[])].find(item=>item.textContent===label)?.nextElementSibling?.textContent;return value('故障负责人')==='合成调度员'&&value('责任组')==='PILOT_IT'&&value('公共故障版本')==='2'&&document.body.innerText.includes('交接公共故障负责人');})()`;
    await browser.waitFor(display);assert.equal(await browser.evaluate('globalThis.__t29Posts.filter(post=>post.path.endsWith("/transfer-owner")).length'),1);
    assert.deepEqual(await get(path+'/notifications?limit=100'),notifications);
    await context.capture();await browser.command('Page.reload');await browser.waitFor(display);assert.equal((await get(path)).body.row_version,'2');assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0,'reload must not POST');
  });
});
