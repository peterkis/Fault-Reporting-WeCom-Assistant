import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function capture(browser:Browser,directory:string,name:string){const file=join(directory,name),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));}

test('T36 production exact supplement reply uses an existing authorized Session and reliable original Delivery; new revision remains pending',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 const session=await f.read<{capabilities:string[]}>('/api/workbench/conversations/'+f.sessionId);assert.ok(session.capabilities.includes('REPLY'));
 const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,primaryError:unknown;
 const row=`[data-supplement-source-ref="${f.r2.source_ref}"][data-supplement-revision="${f.r2.revision}"]`,path='/api/workbench/conversations/'+f.sessionId+'/messages';
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:1080,cookies:[f.browserCookie]});assert.ok(browser);await browser.command('Page.enable');
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t36Bound=[];const original=fetch;globalThis.fetch=(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href),method=options?.method??(input instanceof Request?input.method:'GET');return original(input,options).then(async response=>{if(url.origin===location.origin&&url.pathname===${JSON.stringify(path)}&&method==='POST'){const body=JSON.parse(options.body),result=await response.clone().json();globalThis.__t36Bound.push({status:response.status,body,result});}return response;});};})()`});
  await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+f.ticketId+'?detail=page'});await browser.waitFor(`document.querySelector(${JSON.stringify(row)})?.getAttribute('data-follow-up-state')==='PENDING'`);await capture(browser,directory,'new-detail-1920.png');
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(row)})?.querySelector('[data-action="reply-supplement"]'))`);
  assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)})?.querySelector('[data-action="reply-supplement"]'))`),true,'only a real existing REPLY-capable Session permits the optional bound reply entry');
  await browser.evaluate(`document.querySelector(${JSON.stringify(row)}).querySelector('[data-action="reply-supplement"]').click()`);
  await browser.waitFor('Boolean(document.querySelector("[data-supplement-bound-reply] textarea[data-purpose=messages]"))');
  assert.equal(await browser.evaluate('document.querySelector("[data-supplement-bound-reply] textarea").value'),'','internal disposition/note must not prefill an external reply');
  const text='T36独立人工回复：已收到本次补充。';
  await browser.evaluate(`(()=>{const field=document.querySelector('[data-supplement-bound-reply] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await browser.waitFor('Boolean(document.querySelector("[data-supplement-bound-reply] [data-action=send-conversation-reply]:not(:disabled)"))');
  await browser.evaluate('document.querySelector("[data-supplement-bound-reply] [data-action=send-conversation-reply]").click()');await browser.waitFor('globalThis.__t36Bound.some(row=>row.status===202)');
  const records=await browser.evaluate('globalThis.__t36Bound') as {status:number;body:{client_command_id:string;text:string;follow_up_target:{ticket_id:string;source_ref:string;revision:string}};result:{message_id:string;delivery_ids:string[]}}[];assert.equal(records.length,1);const accepted=records[0];assert.ok(accepted);assert.equal(accepted.body.text,text);assert.deepEqual(accepted.body.follow_up_target,{ticket_id:f.ticketId,...f.r2});assert.equal(JSON.stringify(accepted.body).includes(f.internalCanary),false);assert.equal(accepted.result.delivery_ids.length,1);
  assert.equal((await f.page()).items.find(x=>x.source_ref===f.r2.source_ref)?.follow_up_state,'PENDING','202 is not verified follow-up');const r3=await f.appendR3();
  let calls=0;const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,batchSize:1,sender:{send:async()=>{calls++;return {outcome:'ACKNOWLEDGED' as const,provider_message_id:'t36-ui-isolated',error_code:null,retryable:false};}}});const deliveryId=accepted.result.delivery_ids[0];assert.ok(deliveryId);await worker.deliver({deliveryId});assert.equal(calls,1);
  await browser.evaluate('document.querySelector("[data-action=refresh-supplement-follow-up]").click()');await browser.waitFor(`document.querySelector(${JSON.stringify(row)})?.getAttribute('data-follow-up-state')==='FOLLOWED_UP'`);
  const current=await f.page(),resolved=current.items.find(x=>x.source_ref===f.r2.source_ref);assert.equal(resolved?.resolution?.basis,'VERIFIED_REPLY');assert.equal(current.items.find(x=>x.source_ref===r3.source_ref)?.follow_up_state,'PENDING');assert.equal(current.has_pending_supplements,true);assert.equal(await browser.evaluate('globalThis.__t36Bound.length'),1);await capture(browser,directory,'new-detail-page-1920.png');
 }catch(error){primaryError=error;}finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primaryError);}
}));
