import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ownerTransferBrowser} from './helpers/t29-owner-transfer-browser-fixture.mjs';
import {record,text} from './helpers/t29-owner-transfer-http-fixture.mjs';
test('T29 a real scoped target-read403 clears only owner input while the valid Session and Incident READ remain',{timeout:240000},async()=>{
  await ownerTransferBrowser(async({browser,incidentId,choose,pool,f,get})=>{
    const target=text(record(f.dispatcher).id),actor=text(record(f.admin).id),path='/api/incidents/'+incidentId;
    await browser.waitFor(`Boolean(document.querySelector('select[aria-label="交接负责人"] option[value="${target}"]'))`);
    await choose('交接负责人',target);await choose('交接责任组','PILOT_IT');await choose('交接原因','OPERATOR_REVIEWED');
    assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0);
    await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[actor]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[actor]);
    assert.equal((await get('/api/lifecycle/bootstrap')).status,200);assert.equal((await get(path)).status,200);assert.equal((await get(path+'/owner-transfer-targets')).status,403);
    await browser.evaluate('document.querySelector("[data-action=refresh-owner-transfer]").click()');
    await browser.waitFor('globalThis.__t29Reads.some(read=>read.path.includes("/owner-transfer-targets")&&read.status===403)');
    await browser.waitFor('!document.querySelector("select[aria-label=交接负责人]")');
    const observation=record(await browser.evaluate(`({generalViewRetained:Boolean(document.querySelector('[data-incident-id="${incidentId}"]')),posts:globalThis.__t29Posts.length,text:document.body.innerText})`));
    console.log('T29_SCOPED_READ403 '+JSON.stringify({bootstrap:200,incident_read:200,purpose_read:403,general_view_retained:observation.generalViewRetained,posts:observation.posts}));
    assert.equal(observation.generalViewRetained,true,'purpose403 must not invalidate the valid global Session');assert.equal(observation.posts,0);assert.equal((await get(path)).body.row_version,'1');
  });
});
