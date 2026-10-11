import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 an unknown read survives real Review resolution and canonical Ticket navigation with its original UUID',{timeout:120_000},()=>withT35Fixture(async f=>{
  const admitted=await f.post('/api/workbench/reports',{schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'合成现场代录：打印机情况不明',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'现场人工联系',department:null}});
  assert.equal(admitted.status,202);const admission=await admitted.json() as {intake_id:string;review:{id:string}};
  const review='/api/manual-reviews/'+admission.review.id,ref='manual:'+admission.intake_id;
  const directory=join(tmpdir(),'t35-unknown-canonical-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35LoseAck=true;globalThis.__t35Posts=[];globalThis.__t35Commits=[];globalThis.__t35Receipts=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const value=String(path),write=options?.method==='POST'&&value.endsWith('/read-position'),receipt=value.includes('/read-position/commands/');if(write)globalThis.__t35Posts.push(JSON.parse(options.body));return original(path,options).then(async response=>{if(write&&response.status===200&&globalThis.__t35LoseAck){globalThis.__t35LoseAck=false;globalThis.__t35Commits.push(await response.clone().json());throw new TypeError('T35 authentic ACK delivery lost after COMMIT');}if(receipt)globalThis.__t35Receipts.push({path:value,status:response.status,body:await response.clone().json()});return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/review/'+admission.review.id+'?detail=page'});
    const selector='p[data-personal-read-ref="'+ref+'"]';
    await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    const show=`(()=>{document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`;
    await browser.evaluate(show);await browser.waitFor('globalThis.__t35Commits.length===1');
    const posts=await browser.evaluate('globalThis.__t35Posts') as {client_command_id:string;source_ref:string;revision:string}[];const original=posts[0];assert.ok(original);assert.equal(posts.length,1);assert.equal(original.source_ref,ref);assert.equal(original.revision,'1');
    // Resolve through the existing public Review HTTP command; this is not a read-side effect.
    const detail=await (await f.get(review)).json() as {row_version:string;material_basis:{current_hash:string}};
    const csrf=(await (await f.get('/api/lifecycle/bootstrap')).json() as {csrf_token:string}).csrf_token,commandId=randomUUID();
    const resolve=await fetch(f.origin+review+'/resolve',{method:'POST',headers:{cookie:f.firstCookie,origin:f.origin,'content-type':'application/json','idempotency-key':commandId,'if-match':'"'+detail.row_version+'"','x-csrf-token':csrf},body:JSON.stringify({client_command_id:commandId,expected_row_version:detail.row_version,expected_material_basis:detail.material_basis.current_hash,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'FAULT_CONFIRMED'})});
    assert.equal(resolve.status,200,await resolve.clone().text());const resolved=await (await f.get(review)).json() as {canonical_item:{kind:string;id:string}};assert.equal(resolved.canonical_item.kind,'ticket');
    const target='/api/workbench/items/ticket/'+resolved.canonical_item.id+'/read-position';
    const position=async(reader:0|1)=>(await (await f.get(target,reader)).json() as {sources:{last_read_position:string}[]}).sources[0]?.last_read_position;
    assert.equal(await position(0),'1');assert.equal(await position(1),'0');console.log('T35_UNKNOWN_CANONICAL_COMMITTED '+JSON.stringify({uuid:original.client_command_id,review:admission.review.id,ticket:resolved.canonical_item.id,A:'1',B:'0',delivery_failed:true}));
    await browser.evaluate("document.querySelector('.sidebar a[title=\"工作台\"]').click()");await browser.waitFor("Boolean(document.querySelector('.board-column.pending .ticket-card'))");
    await browser.evaluate("[...document.querySelectorAll('.tools button')].find(button=>button.textContent.includes('刷新')).click()");
    await browser.waitFor(`Boolean(document.querySelector('.ticket-card[data-item-id="${resolved.canonical_item.id}"]'))`);
    await browser.evaluate("(()=>{for(const button of document.querySelectorAll('.board-column.pending [data-action=\"expand-column\"]'))if(button.getAttribute('aria-expanded')==='false')button.click();})()");
    await browser.waitFor(`Boolean(document.querySelector('.ticket-card[data-item-id="${resolved.canonical_item.id}"] .card-open'))`);await browser.evaluate(`document.querySelector('.ticket-card[data-item-id="${resolved.canonical_item.id}"] .card-open').click()`);
    await browser.waitFor(`Boolean(document.querySelector('.activity-list ${selector}'))`);await browser.evaluate(show);
    await browser.waitFor(`globalThis.__t35Receipts.some(response=>response.status===200&&response.body.client_command_id===${JSON.stringify(original.client_command_id)}&&response.body.state==='COMMITTED')`);
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[original]);assert.equal(await position(0),'1');assert.equal(await position(1),'0');
    await writeFile(join(directory,'canonical-original-read-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_UNKNOWN_CANONICAL_RECOVERED '+JSON.stringify({directory,original_uuid:true,posts:1}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,commits:globalThis.__t35Commits,receipts:globalThis.__t35Receipts})')));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
