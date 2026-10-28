import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ownerTransferBrowser} from './helpers/t29-owner-transfer-browser-fixture.mjs';
import {record,text} from './helpers/t29-owner-transfer-http-fixture.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Context=Parameters<Parameters<typeof ownerTransferBrowser>[0]>[0];

async function holdIncidentResponses(browser:Context['browser'],path:string){
  await browser.evaluate(`(()=>{const send=globalThis.fetch,waiting=[];let active=true;globalThis.__t29GeneralHeld=false;globalThis.__t29ReleaseGeneral=()=>{active=false;for(const release of waiting.splice(0))release();};globalThis.fetch=async(input,options)=>{const response=await send(input,options);if(active&&String(input)===${JSON.stringify(path)}&&response.status===200){globalThis.__t29GeneralHeld=true;await new Promise(resolve=>waiting.push(resolve));}return response;};})()`);
  return ()=>browser.evaluate('globalThis.__t29ReleaseGeneral?.()');
}

async function selectOwner({browser,choose,f}:Context){
  const target=text(record(f.dispatcher).id);
  await browser.waitFor(`Boolean(document.querySelector('.workbench-select[data-field-label="交接负责人"] select option[value="${target}"]'))`);
  await choose('交接负责人',target);await choose('交接责任组','PILOT_IT');await choose('交接原因','OPERATOR_REVIEWED');
  await browser.waitFor(`globalThis.__t29Transport.filter(row=>row.path.includes('/owner-transfer-targets')&&row.phase==='start').every(start=>globalThis.__t29Transport.some(row=>row.request===start.request&&['response','reject'].includes(row.phase)))`);
  assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0);
}

async function loseOwnerPurpose({pool,f,get,incidentId}:Context){
  const actor=text(record(f.admin).id),path='/api/incidents/'+incidentId;
  await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[actor]);
  await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[actor]);
  assert.equal((await get('/api/lifecycle/bootstrap')).status,200);
  assert.equal((await get(path)).status,200);
  assert.equal((await get(path+'/owner-transfer-targets')).status,403);
}

async function assertOnlyOwnerPurposeCleared({browser,get,incidentId}:Context){
  await browser.waitFor('!document.querySelector(".workbench-select[data-field-label=交接负责人] select")');
  await browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`);
  assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0);
  assert.equal((await get('/api/lifecycle/bootstrap')).status,200,'purpose loss must retain the valid global Session');
  const incident=await get('/api/incidents/'+incidentId);assert.equal(incident.status,200);assert.equal(incident.body.row_version,'1');
}

async function purposeLoss(order:'targets-first'|'detail-first'|'natural'){
  await ownerTransferBrowser(async context=>{
    const {browser,incidentId,deferNextTargetRead}=context,path='/api/incidents/'+incidentId;
    await selectOwner(context);await loseOwnerPurpose(context);
    const releaseGeneral=order==='natural'?null:await holdIncidentResponses(browser,path);
    const deferred=order==='detail-first'?deferNextTargetRead(incidentId):null;
    const before=Number(await browser.evaluate('globalThis.__t29Transport.length'));let primaryError:unknown;
    try{
      await browser.evaluate('document.querySelector("[data-action=refresh-owner-transfer]").click()');
      if(order==='detail-first'){
        assert.ok(deferred);assert.equal(await deferred.waitForResponse(),403,'hold the real denied HTTP response before delivery');
        await browser.waitFor('globalThis.__t29GeneralHeld===true');await releaseGeneral?.();
        await browser.waitFor(`globalThis.__t29Transport.slice(${before}).some(row=>row.path.includes('/owner-transfer-targets')&&row.phase==='reject'&&row.error_name==='AbortError')`);
        assert.equal(await browser.evaluate(`globalThis.__t29Reads.some(row=>row.path.includes('/owner-transfer-targets')&&row.status===403)`),false,'the abort scenario cannot substitute an invented browser403');
      }else if(order==='targets-first'){
        await browser.waitFor('globalThis.__t29Reads.some(read=>read.path.includes("/owner-transfer-targets")&&read.status===403)');
        await releaseGeneral?.();
      }else{
        await browser.waitFor(`globalThis.__t29Transport.slice(${before}).some(row=>row.path.includes('/owner-transfer-targets')&&(row.phase==='response'&&row.status===403||row.phase==='reject'&&row.error_name==='AbortError'))`);
      }
      await assertOnlyOwnerPurposeCleared(context);
      console.log('T29_SCOPED_READ403 '+JSON.stringify({order,bootstrap:200,incident_read:200,purpose_read:403,general_view_retained:true,posts:0}));
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([async()=>{await releaseGeneral?.();},()=>{deferred?.release();}],primaryError);
  });
}

test('T29 a real scoped target-read403 clears only owner input while the valid Session and Incident READ remain',{timeout:240000},()=>purposeLoss('targets-first'));
test('T29 an Incident role refresh cancels its pending target read without clearing the valid Session or Incident',{timeout:240000},()=>purposeLoss('detail-first'));
test('T29 natural parallel refresh preserves the same purpose boundary for either legal response order',{timeout:240000},()=>purposeLoss('natural'));

test('T29 a cancelled late real200 target response cannot restore scoped input after real403 and navigation',{timeout:240000},async()=>{
  await ownerTransferBrowser(async context=>{
    const {browser,incidentId}=context;let primaryError:unknown,releaseGeneral:(()=>Promise<unknown>)|undefined;
    try{
      await selectOwner(context);
      await browser.evaluate("(()=>{const send=globalThis.fetch;let held=false;globalThis.fetch=async(path,options)=>{const response=await send(path,options);if(!held&&String(path).includes('/owner-transfer-targets')&&response.status===200){held=true;globalThis.__t29HeldTargets=true;await new Promise(resolve=>{globalThis.__t29ReleaseTargets=resolve;});globalThis.__t29HeldReleased=true;}return response;};})()");
      await browser.evaluate('document.querySelector("[data-action=refresh-owner-transfer]").click()');await browser.waitFor('globalThis.__t29HeldTargets===true');
      await loseOwnerPurpose(context);releaseGeneral=await holdIncidentResponses(browser,'/api/incidents/'+incidentId);
      await browser.evaluate('document.querySelector("[data-action=refresh-owner-transfer]").click()');
      await browser.waitFor('globalThis.__t29Reads.some(read=>read.path.includes("/owner-transfer-targets")&&read.status===403)');
      await releaseGeneral();await assertOnlyOwnerPurposeCleared(context);
      await browser.evaluate('globalThis.__t29ReleaseTargets()');await browser.waitFor('globalThis.__t29HeldReleased===true');
      await assertOnlyOwnerPurposeCleared(context);
      await browser.evaluate('document.querySelector('+JSON.stringify('a[href="/workbench/app/incidents/candidates"]')+').click()');
      await browser.waitFor('location.pathname.endsWith("/incidents/candidates")');assert.equal(await browser.evaluate('globalThis.__t29Posts.length'),0);
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([async()=>{await releaseGeneral?.();},async()=>{await browser.evaluate('globalThis.__t29ReleaseTargets?.()');}],primaryError);
  });
});
