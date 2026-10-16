import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Server} from 'node:http';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>};disconnectRealtimePrincipal:(index?:number)=>unknown}}
test('production bundle uses a real authorized stream to GET committed Ticket facts without replacing an active draft or focus',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5],browserCookie=browserCookies[0];assert.ok(ticket&&browserCookie);const path='/api/workbench/items/ticket/'+ticket.ticket.id;
    const requests:{path:string;method:string;cursor:string|null}[]=[];
    runtime.server.on('request',request=>requests.push({path:request.url??'',method:request.method??'',cursor:typeof request.headers['last-event-id']==='string'?request.headers['last-event-id']:null}));
    const read=async(url:string)=>{const response=await fetch(origin+url,{headers:{cookie:cookies[0]??''}});assert.equal(response.status,200);return response.json() as Promise<{csrf_token:string;version:number}>;};
    const bootstrap=await read('/api/lifecycle/bootstrap');
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[browserCookie]});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea[aria-label=内部备注]"))');
      assert.equal((await runtime.observability.metrics()).sse_clients,1,'formal enabled bundle must own a real SSE stream');
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T38 unsent draft remains mine');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(3,7);document.scrollingElement.scrollTop=300;})()`);
      const before=await browser.evaluate('({scroll:document.scrollingElement.scrollTop,selection:document.querySelector("textarea").selectionStart,href:location.href})');
      const version=(await read('/api/tickets/'+ticket.ticket.id)).version;
      const command={client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T38 committed colleague fact',external_visible:false};
      const priorGets=requests.filter(request=>request.path.startsWith(path)).length;
      const committed=await fetch(origin+'/api/tickets/'+ticket.ticket.id+'/internal-notes',{method:'POST',headers:{cookie:cookies[0]??'',origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"'+version+'"'},body:JSON.stringify(command)});assert.equal(committed.status,200);await committed.json();
      await browser.waitFor('document.querySelector(".activity-list")?.textContent.includes("T38 committed colleague fact")');
      assert.ok(requests.filter(request=>request.path.startsWith(path)).length>priorGets,'SSE must trigger an authorized GET, not inject its payload');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'T38 unsent draft remains mine');
      assert.equal(await browser.evaluate('document.activeElement===document.querySelector("textarea")'),true);
      assert.deepEqual(await browser.evaluate('({scroll:document.scrollingElement.scrollTop,selection:document.querySelector("textarea").selectionStart,href:location.href})'),before);
      assert.equal(requests.filter(request=>request.method==='POST').length,1,'only the explicit colleague command may be submitted');
      runtime.disconnectRealtimePrincipal(0);
      await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      for(let i=0;i<100&&!requests.some(request=>request.path.startsWith('/api/realtime/events')&&request.cursor);i++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.ok(requests.some(request=>request.path.startsWith('/api/realtime/events')&&request.cursor),'native reconnect must carry its real Last-Event-ID');
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',realtime_fact_get:true,native_resume:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);
    assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true});
});
