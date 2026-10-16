import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Server} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {cleanupRealtimeRetention,REALTIME_MAX_CLEANUP_LIMIT} from '../src/p2-003-realtime-event-log.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {pool:PostgresPool;origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>};disconnectRealtimePrincipal:(index?:number)=>unknown}}
test('a real retained replay gap falls back to current GET facts and creates a fresh native source without carrying the obsolete cursor',async()=>{
  await withWeb01Fixture(async({pool,origin,cookies,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5],cookie=browserCookies[0];assert.ok(ticket&&cookie);let posts=0;
    const requests:{cursor:string|null;status:number}[]=[];
    runtime.server.on('request',(request,response)=>{if(request.method==='POST')posts++;if((request.url??'').startsWith('/api/realtime/events')){const row={cursor:typeof request.headers['last-event-id']==='string'?request.headers['last-event-id']:null,status:0};requests.push(row);const writeHead=response.writeHead;response.writeHead=(status:number,...args:unknown[])=>{row.status=status;Reflect.apply(writeHead,response,[status,...args]);return response;};}});
    const read=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]??''}});assert.equal(response.status,200);return response.json() as Promise<{csrf_token:string;version:number}>;};
    const csrf=(await read('/api/lifecycle/bootstrap')).csrf_token;
    const commit=async(note:string)=>{const version=(await read('/api/tickets/'+ticket.ticket.id)).version,command={client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_INTERNAL_NOTE',note,external_visible:false};const response=await fetch(origin+'/api/tickets/'+ticket.ticket.id+'/internal-notes',{method:'POST',headers:{cookie:cookies[0]??'',origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':command.client_command_id,'if-match':'"'+version+'"'},body:JSON.stringify(command)});assert.equal(response.status,200);await response.json();};
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[cookie]});
      assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await commit('T38 real pre-gap fact');await browser.waitFor('document.querySelector(".activity-list")?.textContent.includes("T38 real pre-gap fact")');
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T38 gap leaves this draft mine');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,6);})()`);
      runtime.disconnectRealtimePrincipal(0);await commit('T38 real post-gap fact');
      // Existing public retention clock, applied to this isolated durable log only; no expiry row rewriting.
      const cleanup=await cleanupRealtimeRetention({pool,authorized:true,limit:REALTIME_MAX_CLEANUP_LIMIT,now_epoch_ms:String(Date.now()+8*24*3600000)});assert.ok(cleanup.deleted_count>0);
      for(let i=0;i<200&&!requests.some(request=>request.cursor&&request.status===410);i++)await new Promise(resolve=>setTimeout(resolve,50));
      const gapIndex=requests.findIndex(request=>request.cursor&&request.status===410);assert.ok(gapIndex>=0,'the production native resume must actually encounter the real retention floor');
      await browser.waitFor('document.querySelector(".activity-list")?.textContent.includes("T38 real post-gap fact")&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      assert.ok(requests.slice(gapIndex+1).some(request=>request.cursor===null&&request.status===200),'fresh native recovery must clear Last-Event-ID after real GET revalidation');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'T38 gap leaves this draft mine');assert.equal(await browser.evaluate('document.activeElement===document.querySelector("textarea")'),true);assert.equal(posts,2);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',real_retention_gap:true,fresh_native_cursor:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true});
});
