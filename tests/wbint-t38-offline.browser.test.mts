import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Server} from 'node:http';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {origin:string;browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>}}}
test('ordinary failed authoritative reads retain the visible draft and confirmed facts; a new write waits for fresh REST while the stream is healthy',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5],cookie=browserCookies[0];assert.ok(ticket&&cookie);
    let unreadable=false,posts=0,reads=0,attachmentReads=0;
    // Only the test-owned HTTP output boundary is faulted, after the real authentication and query.
    // The stream and domain facts remain real; no EventSource/frame or successful fact is simulated.
    runtime.server.on('request',(request,response)=>{
      if(request.method==='POST')posts++;
      const path=new URL(request.url??'/',origin).pathname;
      if(request.method==='GET'&&path==='/api/workbench/items/ticket/'+ticket.ticket.id+'/attachments'){response.once('finish',()=>{if(response.statusCode===200)attachmentReads++;});return;}
      if(request.method!=='GET'||!(path==='/api/workbench/items/ticket/'+ticket.ticket.id||path==='/api/tickets/'+ticket.ticket.id))return;
      reads++;const end=response.end;
      response.end=(...args:unknown[])=>{Reflect.apply(end,response,unreadable?['{']:args);return response;};
    });
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[cookie]});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea[aria-label=内部备注]"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T38 draft during temporary read failure');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(4,8);})()`);
      await browser.waitFor('document.querySelector("[data-draft-status]")?.textContent.includes("已保存恢复副本")');
      const priorReads=reads;unreadable=true;
      await browser.evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="重新读取工单动作").click()');
      await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="offline"');
      assert.ok(reads>priorReads);assert.equal((await runtime.observability.metrics()).sse_clients,1,'a readable REST failure must not be guessed from SSE connection health');
      assert.equal(await browser.evaluate('document.querySelector("textarea")?.value??null'),'T38 draft during temporary read failure','ordinary failed refetch must not replace the current editor with an error-only view');
      assert.equal(await browser.evaluate('document.activeElement===document.querySelector("textarea")'),true);
      assert.equal(await browser.evaluate('Boolean(document.querySelector(".activity-list"))'),true,'last confirmed authorized facts remain visible');
      const beforeAttachments=attachmentReads;
      await browser.evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="重新读取附件").click()');
      for(let i=0;i<100&&attachmentReads===beforeAttachments;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(attachmentReads>beforeAttachments,'an unrelated authorized attachment family actually returned200');
      await browser.waitFor('!document.querySelector(".attachment-section button")?.disabled&&!document.querySelector(".attachment-section")?.textContent.includes("附件响应无法安全识别")');
      await browser.evaluate('document.querySelector("form:has(textarea)").requestSubmit()');
      await browser.waitFor('(()=>{const text=document.querySelector(".ticket-note-state")?.textContent??"";return ["尚未准备或发送","已保存","结果未知","保存被拒绝"].some(state=>text.includes(state));})()');
      assert.equal(posts,0,'no new prepare/POST may be inferred from stale/unreadable action data');
      assert.ok(await browser.evaluate('document.querySelector(".ticket-note-state")?.textContent.includes("尚未准备或发送")'));
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'T38 draft during temporary read failure');
      unreadable=false;
      await browser.evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="重新读取工单动作").click()');
      await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate('document.querySelector("form:has(textarea)").requestSubmit()');
      await browser.waitFor('document.querySelector(".ticket-note-state")?.textContent.includes("已保存内部备注")');assert.equal(posts,1);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',ordinary_failure_cached_draft:true,new_write_waits_for_rest:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,draft:document.querySelector("textarea")?.value})')));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);
  },{workbenchRealtimeEnabled:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
