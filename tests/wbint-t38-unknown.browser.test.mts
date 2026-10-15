import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Server} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {pool:PostgresPool;origin:string;browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];restoreInternalNoteResponses:()=>void;runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>}}}
test('temporary GET unavailability preserves UNKNOWN and permits explicit original-command reconciliation without a new intent',async()=>{
  await withWeb01Fixture(async({pool,origin,browserCookies,tickets,restoreInternalNoteResponses,runtime}:Fixture)=>{
    const ticket=tickets[5],cookie=browserCookies[0];assert.ok(ticket&&cookie);let unreadable=false;const commands:{id:string|string[]|undefined;version:string|string[]|undefined}[]=[];
    runtime.server.on('request',(request,response)=>{
      if(request.method==='POST')commands.push({id:request.headers['idempotency-key'],version:request.headers['if-match']});
      if(request.method!=='GET'||!((request.url??'').startsWith('/api/workbench/items/ticket/'+ticket.ticket.id)||(request.url??'')==='/api/tickets/'+ticket.ticket.id))return;
      const end=response.end;response.end=(...args:unknown[])=>{Reflect.apply(end,response,unreadable?['{']:args);return response;};
    });
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[cookie]});
      assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T38 original committed but unreadable result');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.waitFor('document.querySelector("[data-draft-status]")?.textContent.includes("已保存恢复副本")');
      await browser.evaluate('document.querySelector("form:has(textarea)").requestSubmit()');
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-internal-note]"))');assert.equal(commands.length,1);
      unreadable=true;
      await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="offline"');
      assert.ok(await browser.evaluate('document.querySelector(".ticket-note-state")?.textContent.includes("结果未知")'));
      assert.equal(commands.length,1,'failed reads must not infer a retry or settle the unknown command');
      restoreInternalNoteResponses();
      await browser.evaluate('document.querySelector("[data-action=check-internal-note]").click()');
      await browser.waitFor('document.querySelector(".ticket-note-state")?.textContent.includes("已核对原操作结果")');
      assert.equal(commands.length,2);assert.deepEqual(commands[1],commands[0],'explicit reconciliation retains the captured command ID and version');
      const row=(await pool.query<{count:string}>('SELECT count(*)::text AS count FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND internal_note=$2',[ticket.ticket.id,'T38 original committed but unreadable result'])).rows[0];assert.equal(row?.count,'1');
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',unknown_preserved:true,explicit_same_command_replay:true,committed_note_count:1,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,malformedInternalNoteSuccess:true});
});
