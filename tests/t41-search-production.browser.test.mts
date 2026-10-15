import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT41RiskFixture,object} from './helpers/t41-search-risk-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function input(browser:Browser,value:string){
 await browser.evaluate('(()=>{const input=document.querySelector("form[aria-label=\\"搜索全部获权事项\\"] input[name=q]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(value)+');input.dispatchEvent(new Event("input",{bubbles:true}));})()');
}
async function capture(browser:Browser,directory:string,name:string){
 const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);
 console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
}
test('T41 production search keeps URL, board/list identity, independent input and explicit empty/offline states without a business write',{timeout:240000},async()=>{
 await withT41RiskFixture(async f=>{
  const target=f.tickets[2];assert.ok(target);const original=await f.get('/api/tickets/'+target.ticket.id);assert.equal(original.status,200);
  const before=object(await original.json()),query='自助机读卡失败';
  assert.match(tmpdir(),/^D:[\\/]/iu,'the owned browser/evidence runtime must use D temp');
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?search=1&view=board&column=pending&range=all&q='+encodeURIComponent(query),width:1920,height:1080,cookies:[f.browserCookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("form[aria-label=\\"搜索全部获权事项\\"] input[name=q]"))&&Boolean(document.querySelector("article[data-item-id=\\"'+target.ticket.id+'\\"]"))');
   assert.equal(await browser.evaluate('document.querySelectorAll("article[data-kind=\\"ticket\\"][data-item-id=\\"'+target.ticket.id+'\\"]").length'),1);
   await capture(browser,directory,'new-board-1920.png');
   await input(browser,'尚未提交的独立搜索输入');
   await browser.evaluate('Array.from(document.querySelectorAll("[aria-label=展示方式] button")).find(button=>button.textContent.includes("列表")).click()');
   await browser.waitFor('new URL(location.href).searchParams.get("view")==="list"&&Boolean(document.querySelector(".work-table a[href*=\\"'+target.ticket.id+'\\"]"))');
   assert.equal(await browser.evaluate('document.querySelector("form input[name=q]").value'),'尚未提交的独立搜索输入');
   assert.equal(await browser.evaluate('new URL(location.href).searchParams.get("q")'),query);await capture(browser,directory,'new-list-1920.png');
   await input(browser,'T41没有匹配的全新合成检索词');
   await browser.evaluate('document.querySelector("form[aria-label=\\"搜索全部获权事项\\"]").requestSubmit()');
   await browser.waitFor('document.querySelector("[data-search-state=empty]")?.textContent.includes("没有匹配")');
   assert.equal(await browser.evaluate('new URL(location.href).searchParams.get("q")'),'T41没有匹配的全新合成检索词');
   await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
   await browser.evaluate('Array.from(document.querySelectorAll(".tools button")).find(button=>button.textContent.includes("刷新")).click()');
   await browser.waitFor('Boolean(document.querySelector("[data-search-state=error]"))');
   assert.equal(await browser.evaluate('document.querySelector("form input[name=q]").value'),'T41没有匹配的全新合成检索词');await capture(browser,directory,'new-offline-1920.png');
   await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
   await browser.command('Page.reload');await browser.waitFor('Boolean(document.querySelector("[data-search-state=empty]"))');
   assert.equal(await browser.evaluate('document.querySelector("form input[name=q]").value'),'T41没有匹配的全新合成检索词');
   const read=await f.get('/api/tickets/'+target.ticket.id);assert.equal(read.status,200);const after=object(await read.json());
   for(const field of ['status','version','assignee_id','resolver_team_id'])assert.equal(after[field],before[field]);
  }catch(error){primary=error;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 });
});
