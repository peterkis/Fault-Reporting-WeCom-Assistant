import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 a genuine Review denial clears its moved read intent while another authorized Item keeps its original recovery',{timeout:180_000},()=>withT35Fixture(async f=>{
  const retained=f.tickets[8];assert.ok(retained);
  const admitted=await f.post('/api/workbench/reports',{schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'合成现场代录：打印机情况不明',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'现场人工联系',department:null}});
  assert.equal(admitted.status,202);const admission=await admitted.json() as {intake_id:string;review:{id:string}},review='/api/manual-reviews/'+admission.review.id,ref='manual:'+admission.intake_id;
  const directory=join(tmpdir(),'t35-read-denial-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];globalThis.__t35Commits=[];globalThis.__t35Receipts=[];globalThis.__t35LostRefs=new Set();globalThis.__t35HoldReceipt=false;globalThis.__t35Held=0;globalThis.__t35Release=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const value=String(path),write=options?.method==='POST'&&value.endsWith('/read-position'),receipt=value.includes('/read-position/commands/'),body=write?JSON.parse(options.body):null;if(write)globalThis.__t35Posts.push({path:value,body});const fetchActual=()=>original(path,options).then(async response=>{if(write&&response.status===200&&!globalThis.__t35LostRefs.has(body.source_ref)){globalThis.__t35LostRefs.add(body.source_ref);globalThis.__t35Commits.push(await response.clone().json());throw new TypeError('T35 authentic ACK delivery lost after COMMIT');}if(receipt)globalThis.__t35Receipts.push({path:value,status:response.status,body:await response.clone().json()});return response;});if(receipt&&globalThis.__t35HoldReceipt){globalThis.__t35Held++;return new Promise(resolve=>globalThis.__t35Release.push(()=>resolve(fetchActual())));}return fetchActual();};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+retained.ticket.id+'?detail=page'});await browser.waitFor("Boolean(document.querySelector('.activity-list p[data-personal-read-ref]'))");
    const show=async(selector:string)=>{await browser?.evaluate(`(()=>{document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);};
    const card=async(id:string)=>{
      await browser?.evaluate("globalThis.__t35Visible=false;document.dispatchEvent(new Event('visibilitychange'));document.querySelector('.sidebar a[title=\"工作台\"]').click()");await browser?.waitFor("Boolean(document.querySelector('.tools button'))");
      await browser?.evaluate("[...document.querySelectorAll('.tools button')].find(button=>button.textContent.includes('刷新')).click()");await browser?.waitFor(`Boolean(document.querySelector('.ticket-card[data-item-id="${id}"]'))`);
      await browser?.evaluate("(()=>{for(const button of document.querySelectorAll('[data-action=\"expand-column\"]'))if(button.getAttribute('aria-expanded')==='false')button.click();})()");
      await browser?.waitFor(`Boolean(document.querySelector('.ticket-card[data-item-id="${id}"] .card-open'))`);await browser?.evaluate(`document.querySelector('.ticket-card[data-item-id="${id}"] .card-open').click()`);
    };
    await show('.activity-list p[data-personal-read-ref]');await browser.waitFor('globalThis.__t35Commits.length===1');
    const retainedCommand=(await browser.evaluate('globalThis.__t35Posts') as {body:{client_command_id:string;source_ref:string;revision:string}}[])[0]?.body;assert.ok(retainedCommand);
    await card(admission.review.id);await browser.waitFor(`Boolean(document.querySelector('p[data-personal-read-ref="${ref}"]'))`);await show(`p[data-personal-read-ref="${ref}"]`);await browser.waitFor('globalThis.__t35Commits.length===2');
    const revokedCommand=(await browser.evaluate('globalThis.__t35Posts') as {body:typeof retainedCommand}[]).find(row=>row.body.source_ref===ref)?.body;assert.ok(revokedCommand);
    const detail=await (await f.get(review)).json() as {row_version:string;material_basis:{current_hash:string}},csrf=(await (await f.get('/api/lifecycle/bootstrap')).json() as {csrf_token:string}).csrf_token,uuid=randomUUID();
    const resolved=await fetch(f.origin+review+'/resolve',{method:'POST',headers:{cookie:f.firstCookie,origin:f.origin,'content-type':'application/json','idempotency-key':uuid,'if-match':'"'+detail.row_version+'"','x-csrf-token':csrf},body:JSON.stringify({client_command_id:uuid,expected_row_version:detail.row_version,expected_material_basis:detail.material_basis.current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'FAULT_CONFIRMED'})});assert.equal(resolved.status,200,await resolved.clone().text());
    const current=await (await f.get(review)).json() as {canonical_item:{kind:string;id:string}};assert.equal(current.canonical_item.kind,'ticket');
    await browser.evaluate("globalThis.__t35HoldReceipt=true;globalThis.__t35Visible=false;document.dispatchEvent(new Event('visibilitychange'))");await show(`p[data-personal-read-ref="${ref}"]`);await browser.waitFor('globalThis.__t35Held===1');
    await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await f.get('/api/workbench/items/review/'+admission.review.id+'/read-position')).status,404);assert.equal((await f.get('/api/workbench/items/ticket/'+retained.ticket.id+'/read-position')).status,200);
    await browser.evaluate("globalThis.__t35HoldReceipt=false;for(const release of globalThis.__t35Release.splice(0))release()");await browser.waitFor('globalThis.__t35Receipts.some(response=>response.status===404)');await browser.waitFor("!document.querySelector('[data-review-materials]')");
    console.log('T35_REKEY_CURRENT_DENIAL '+JSON.stringify({current_review_receipt:404,other_assigned_item:200,revoked_command_id:revokedCommand.client_command_id}));
    await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    await card(current.canonical_item.id);await browser.waitFor(`Boolean(document.querySelector('.activity-list p[data-personal-read-ref="${ref}"]'))`);await browser.waitFor("Boolean(document.querySelector('[aria-label=\"选择复核项\"]'))");
    await browser.evaluate("(()=>{const select=document.querySelector('[aria-label=\"选择复核项\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'');select.dispatchEvent(new Event('change',{bubbles:true}));})()");await browser.waitFor("!document.querySelector('[data-review-materials]')");
    await show(`.activity-list p[data-personal-read-ref="${ref}"]`);await browser.waitFor(`globalThis.__t35Posts.filter(row=>row.body.source_ref===${JSON.stringify(ref)}).length===2`);
    const renewed=(await browser.evaluate('globalThis.__t35Posts') as {body:typeof revokedCommand}[]).filter(row=>row.body.source_ref===ref);assert.notEqual(renewed[1]?.body.client_command_id,revokedCommand.client_command_id);
    assert.equal(await browser.evaluate(`globalThis.__t35Receipts.some(response=>response.path.includes(${JSON.stringify('/ticket/'+current.canonical_item.id+'/')})&&response.body.client_command_id===${JSON.stringify(revokedCommand.client_command_id)})`),false,'revoked recovery metadata must not survive its moved key');
    await card(retained.ticket.id);await browser.waitFor("Boolean(document.querySelector('.activity-list p[data-personal-read-ref]'))");await show('.activity-list p[data-personal-read-ref]');
    await browser.waitFor(`globalThis.__t35Receipts.some(response=>response.status===200&&response.body.client_command_id===${JSON.stringify(retainedCommand.client_command_id)}&&response.body.state==='COMMITTED')`);
    assert.equal(await browser.evaluate(`globalThis.__t35Posts.filter(row=>row.body.source_ref===${JSON.stringify(retainedCommand.source_ref)}).length`),1);
    await writeFile(join(directory,'exact-denial-other-recovery-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_REKEY_EXACT_CLEANUP '+JSON.stringify({directory,moved_intent_cleared:true,other_original_uuid:true}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,commits:globalThis.__t35Commits,receipts:globalThis.__t35Receipts,held:globalThis.__t35Held})')));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
