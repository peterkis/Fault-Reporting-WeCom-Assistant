import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT43Fixture,object,text} from './helpers/t43-full-service-fixture.mjs';
import type {HttpResponse} from './helpers/t43-full-service-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T43 same original full service App admits group, direct, H5 and manual reports before the production React board reads their authorized canonical facts',async()=>{
 await withT43Fixture(async f=>{
  const group=await f.inbound('group','T43群来源：合成门诊打印机打印不了。');
  const direct=await f.inbound('single','T43单聊来源：合成门诊打印机打印不了。','synthetic-B');
  const web=await f.webReport('T43网页来源：合成门诊打印机打印不了。');
  const manual=await f.manualReport('T43电话来源：合成门诊打印机打印不了。');
  assert.equal(group.source,'WECOM_GROUP');assert.equal(direct.source,'WECOM_DIRECT');assert.equal(manual.source,'MANUAL');
  const all=[group,direct,web,manual];assert.equal(new Set(all.map(x=>x.intakeId)).size,4);
  const admin=f.staff[0];assert.ok(admin);
  const canonical=[];
  for(const report of all){
   const kind=report.ticketId?'ticket':'review',id=report.ticketId??report.reviewId;assert.ok(id,'normal accepted source must yield a real visible Ticket or pending Review');
   const detail:HttpResponse=await admin.get('/api/workbench/items/'+kind+'/'+id);assert.equal(detail.status,200,detail.raw);
   const item=object(detail.body.item);assert.equal(item.id,id);assert.equal(item.kind,kind);canonical.push({kind,id,number:text(item.number)});
  }
  assert.equal(f.directoryCalls(),0,'normal unverified/manual and base service intake must not need a remote personnel directory');
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  try{
   const cookie=f.browserCookies[0];assert.ok(cookie);
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:900,height:900,cookies:[cookie],certificateSpki:f.certificateSpki});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector(".page-title h1"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
   await browser.evaluate('document.querySelectorAll("button[aria-controls^=cards-][aria-expanded=false]").forEach(button=>button.click())');
   for(const target of canonical)await browser.waitFor(`Boolean(document.querySelector('article.ticket-card[data-kind="${target.kind}"][data-item-id="${target.id}"]'))`);
   assert.equal(await browser.evaluate('document.querySelectorAll("article.ticket-card").length'),4,'one canonical card per admitted source, no Ticket/review duplicate');
   const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
   const image=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-board-900.png');await writeFile(file,image);screenshots.push({file,width:image.readUInt32BE(16),height:image.readUInt32BE(20),sha256:createHash('sha256').update(image).digest('hex')});
   const target=canonical[0];assert.ok(target);await browser.evaluate(`document.querySelector('article.ticket-card[data-item-id="${target.id}"] .card-open').click()`);
   await browser.waitFor('Boolean(document.querySelector(".detail-body"))');
   assert.equal(await browser.evaluate('document.querySelector(".detail-heading")?.textContent.includes('+JSON.stringify(target.number)+')'),true);
   const visible=await admin.get('/api/workbench/items/'+target.kind+'/'+target.id);assert.equal(visible.status,200);assert.deepEqual(object(visible.body.item).id,target.id);
   console.log('T43_FOUR_SOURCES '+JSON.stringify({surface:'REAL_FULL_SERVICE_APP_PG_HTTP_PRODUCTION_REACT',normal_ingress:true,sources:all.map(x=>x.source),intake_ids:all.map(x=>x.intakeId),canonical,external_directory_calls:f.directoryCalls(),ai_enabled:false}));
  }catch(error){failure=error;if(browser)console.log('T43_FIRST_DIAGNOSTIC '+JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'t43-four-source-first',screenshots}));
 });
});
