import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type BrowserCookie=NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>[number];
interface Fixture {origin:string;cookies:string[];browserCookies:BrowserCookie[];tickets:{ticket:{id:string}}[]}
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function image(browser:Browser,directory:string,name='new-detail-1920.png'){
 const file=join(directory,name),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);
 console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
}
test('T34 formal production detail explicitly follows once and server related scope is consistent in board, list and reload',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=f.tickets[1],cookie=f.browserCookies[2],cookieHeader=f.cookies[2];assert.ok(target&&cookie&&cookieHeader);
  const path='/api/workbench/items/ticket/'+target.ticket.id,read=async(p:string)=>{const r=await fetch(f.origin+p,{headers:{cookie:cookieHeader}});assert.equal(r.status,200);return r.json() as Promise<Record<string,unknown>>;};
  const before=await read('/api/tickets/'+target.ticket.id),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("#detail-title"))');await image(browser,directory);
   assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=toggle-item-follow]"))'),true,'authorized real production detail must expose the explicit follow control');
   assert.equal(await browser.evaluate('document.querySelector("[data-action=toggle-item-follow]").getAttribute("aria-pressed")'),'false');
   await browser.evaluate('document.querySelector("[data-action=toggle-item-follow]").click()');
   await browser.waitFor('document.querySelector("[data-action=toggle-item-follow]")?.getAttribute("aria-pressed")==="true"');
   const detail=await read(path),attention=(detail.item as {attention:{following:boolean;related_reasons:string[]}}).attention;assert.equal(attention.following,true);assert.deepEqual(attention.related_reasons,['FOLLOW']);
   await browser.command('Page.reload');await browser.waitFor('document.querySelector("[data-action=toggle-item-follow]")?.getAttribute("aria-pressed")==="true"');
   await image(browser,directory,'new-detail-page-1920.png');
   await browser.evaluate('document.querySelector("button[aria-label=关闭详情]").click()');await browser.waitFor('Boolean(document.querySelector("[data-action=related-scope]"))');
   await browser.evaluate('document.querySelector("[data-action=related-scope]").click()');
   await browser.waitFor('new URLSearchParams(location.search).get("scope")==="related"&&[...document.querySelectorAll(".ticket-card")].filter(e=>e.dataset.itemId==="'+target.ticket.id+'").length===1');
   await browser.evaluate('document.querySelector("button[aria-pressed][title=列表],button[aria-label=列表]")?.click()||[...document.querySelectorAll(".view-tabs button")].find(b=>b.textContent.includes("列表")).click()');
   await browser.waitFor('new URLSearchParams(location.search).get("view")==="list"&&document.querySelectorAll(".work-table tbody tr").length>0');
   assert.equal(await browser.evaluate('[...document.querySelectorAll(".work-table tbody a")].filter(a=>a.href.includes("'+target.ticket.id+'")).length'),1);
   const after=await read('/api/tickets/'+target.ticket.id);for(const key of ['assignee_id','status','version'])assert.equal(after[key],before[key]);
   console.log('T34_FORMAL_FOLLOW_UI '+JSON.stringify({ticket_id:target.ticket.id,actual_server_following:attention.following,board_once:true,list_once:true,reload_authorized:true}));
  }catch(error){primary=error;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{workbenchFollowEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});
