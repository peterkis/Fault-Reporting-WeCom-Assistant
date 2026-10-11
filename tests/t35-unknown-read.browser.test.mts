import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 a real committed read with lost ACK delivery keeps its UUID across remount and checks only its safe receipt',{timeout:120_000},()=>withT35Fixture(async f=>{
  const selected=f.tickets[1];assert.ok(selected);const path='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position';
  const position=async(reader:0|1)=>(await (await f.get(path,reader)).json() as {sources:{last_read_position:string}[]}).sources[0]?.last_read_position;
  assert.equal(await position(0),'0');assert.equal(await position(1),'0');
  const directory=join(tmpdir(),'t35-unknown-read-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35LoseAck=true;globalThis.__t35Posts=[];globalThis.__t35ActualCommits=[];globalThis.__t35Receipts=[];globalThis.__t35ReceiptResults=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const value=String(path),write=options?.method==='POST'&&value.endsWith('/read-position'),receipt=value.includes('/read-position/commands/');if(write)globalThis.__t35Posts.push(JSON.parse(options.body));if(receipt)globalThis.__t35Receipts.push(value);return original(path,options).then(async response=>{if(write&&response.status===200&&globalThis.__t35LoseAck){globalThis.__t35LoseAck=false;globalThis.__t35ActualCommits.push(await response.clone().json());throw new TypeError('T35 authentic ACK delivery lost after COMMIT');}if(receipt)globalThis.__t35ReceiptResults.push({status:response.status,body:await response.clone().json()});return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id+'?detail=page'});
    await browser.waitFor("Boolean(document.querySelector('.activity-list p[data-personal-read-ref]'))");assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    const show="(()=>{document.querySelector('.activity-list p[data-personal-read-ref]').scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()";
    await browser.evaluate(show);await browser.waitFor('globalThis.__t35ActualCommits.length===1');
    const posts=await browser.evaluate('globalThis.__t35Posts') as {client_command_id:string;source_ref:string;revision:string}[];const original=posts[0];assert.ok(original);assert.equal(posts.length,1);
    assert.equal(await position(0),'1');assert.equal(await position(1),'0');
    console.log('T35_READ_UNKNOWN_COMMITTED '+JSON.stringify({original_command_id:original.client_command_id,A:'1',B:'0',delivery_failed:true}));
    // Real React Router navigation unmounts the observer without reloading the JS process.
    await browser.evaluate("document.querySelector('.sidebar a[title=\"工作台\"]').click()");await browser.waitFor("Boolean(document.querySelector('.board-column'))");
    await browser.evaluate(`document.querySelector('.ticket-card[data-item-id="${selected.ticket.id}"] .card-open').click()`);
    await browser.waitFor("Boolean(document.querySelector('.activity-list p[data-personal-read-ref]'))");await browser.evaluate(show);
    await browser.waitFor(`globalThis.__t35ReceiptResults.some(response=>response.status===200&&response.body.client_command_id===${JSON.stringify(original.client_command_id)}&&response.body.state==='COMMITTED')`);
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[original],'UNKNOWN must not be replaced by a second UUID or a repeated body POST');
    assert.equal(await position(0),'1');assert.equal(await position(1),'0');
    await writeFile(join(directory,'original-read-safe-receipt-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_READ_UNKNOWN_RECOVERED '+JSON.stringify({directory,original_uuid:true,read_only_receipt:true,posts:1}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,actual_commits:globalThis.__t35ActualCommits,receipts:globalThis.__t35Receipts,receipt_results:globalThis.__t35ReceiptResults})')));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
