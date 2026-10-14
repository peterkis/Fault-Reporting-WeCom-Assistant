import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Cookie=NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>[number];
interface Fixture {pool:PostgresPool;origin:string;cookies:string[];browserCookies:Cookie[];tickets:{ticket:{id:string}}[];restoreFollowBootstrapResponses:()=>void;followBootstrapFaultState:()=>{committed_responses:number;failed_bootstrap_reads:number}}
async function screenshot(browser:Browser,directory:string,name:string){const file=join(directory,name),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));}

test('T34 a real committed POST followed by HTTP bootstrap503 preserves its UUID for read-only acknowledgement',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=f.tickets[1],cookie=f.browserCookies[2];assert.ok(target&&cookie);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("[data-action=toggle-item-follow]")&&!document.querySelector("[data-action=toggle-item-follow]").disabled)');
   await browser.evaluate(`window.__t34Posts=[];const actual=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(init?.method==='POST'&&url.endsWith('/follow'))window.__t34Posts.push(JSON.parse(init.body));return actual(input,init);};document.querySelector('[data-action=toggle-item-follow]').click();`);
   await browser.waitFor('Boolean(document.querySelector("[data-follow-state=unknown], [data-follow-state=conflict], [data-follow-state=succeeded]"))');
   await screenshot(browser,directory,'follow-after-bootstrap-failure.png');
   const fault=f.followBootstrapFaultState();assert.equal(fault.committed_responses,1);assert.ok(fault.failed_bootstrap_reads>=1);
   const rows=(await f.pool.query<{client_command_id:string;state:string}>("SELECT client_command_id::text,state FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_ITEM_FOLLOW'")).rows;
   assert.equal(rows.length,1);assert.equal(rows[0]?.state,'COMMITTED');
   assert.equal((await f.pool.query('SELECT following FROM pilot_ticket.workbench_item_follow')).rows[0]?.following,true);
   assert.equal(await browser.evaluate('document.querySelector("[data-follow-state]")?.getAttribute("data-follow-state")'),'unknown','a failed read after successful POST does not prove business rejection');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=follow-ack]"))'),true);
   const posts:unknown=await browser.evaluate('window.__t34Posts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);
   assert.ok(posts[0]&&typeof posts[0]==='object'&&!Array.isArray(posts[0]));assert.equal((posts[0] as Record<string,unknown>).client_command_id,rows[0]?.client_command_id);
   f.restoreFollowBootstrapResponses();await browser.evaluate('document.querySelector("[data-action=follow-ack]").click()');
   await browser.waitFor('document.querySelector("[data-action=toggle-item-follow]")?.getAttribute("aria-pressed")==="true"&&!document.querySelector("[data-action=follow-ack]")');
   assert.equal(await browser.evaluate('window.__t34Posts.length'),1,'read-only recovery cannot issue another POST');
   assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_ITEM_FOLLOW'")).rows[0]?.n,1);
   await screenshot(browser,directory,'follow-after-readonly-ack.png');
  }catch(error){primary=error;}
  finally{f.restoreFollowBootstrapResponses();await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{workbenchFollowEnabled:true,failFollowBootstrapAfterCommit:true,manualProjection:true,chronologicalTicketEvents:true});
});
