import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Server} from 'node:http';
import {request as httpRequest} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {pool:PostgresPool;origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>};disconnectRealtimePrincipal:(index?:number)=>unknown}}
test('native 32 admission preserves the budget; the 33rd production client polls bounded GET and permits a human command while REST stays authorized',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5],cookie=browserCookies[0];assert.ok(ticket&&cookie);let rejected=0,posts=0;
    runtime.server.on('request',(request,response)=>{if(request.method==='POST')posts++;if((request.url??'').startsWith('/api/realtime/events')){const writeHead=response.writeHead;response.writeHead=(status:number,...args:unknown[])=>{if(status===503)rejected++;Reflect.apply(writeHead,response,[status,...args]);return response;};}});
    const peers:{close:()=>Promise<void>}[]=[],directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      for(let i=0;i<32;i++){
        let closed:Promise<void>;const peer=await new Promise<{close:()=>Promise<void>}>((resolve,reject)=>{
          const request=httpRequest(origin+'/api/realtime/events?scope=workbench',{headers:{cookie:cookies[0]??''},agent:false},response=>{response.resume();if(response.statusCode!==200){request.destroy();reject(new Error('T38_NATIVE_PEER_NOT_ADMITTED'));return;}resolve({close:async()=>{response.destroy();request.destroy();await closed;}});});
          closed=new Promise(resolveClosed=>request.once('close',()=>resolveClosed()));request.once('error',reject);request.end();
        });peers.push(peer);
      }
      assert.equal((await runtime.observability.metrics()).sse_clients,32);
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[cookie]});
      assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))');
      for(let i=0;i<100&&rejected===0;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(rejected>0,'the real 33rd stream must be rejected by the native budget');
      const firstRejections=rejected;await new Promise(resolve=>setTimeout(resolve,1000));assert.equal(rejected,firstRejections,'a terminal503 must wait for the single 5s recovery cadence');assert.equal((await runtime.observability.metrics()).sse_clients,32);
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T38 manual REST command while capacity is full');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.evaluate('document.querySelector("form:has(textarea)").requestSubmit()');await browser.waitFor('document.querySelector(".ticket-note-state")?.textContent.includes("已保存内部备注")');assert.equal(posts,1,'only the explicitly requested human operation is sent');
      await peers.pop()?.close();
      await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');assert.equal((await runtime.observability.metrics()).sse_clients,32);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',native_admitted:32,native_33rd503:true,bounded_capacity_recovery:true,manual_rest_allowed:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await Promise.all(peers.map(peer=>peer.close()));}],error);
    if(!error)await rmdir(directory);
    for(let i=0;i<100&&(await runtime.observability.metrics()).sse_clients;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true});
});
test('an actual colleague update does not reorder the card being operated on while its detail editor is open',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[6],cookie=browserCookies[0];assert.ok(ticket&&cookie);let posts=0,updatedAt='';runtime.server.on('request',(request,response)=>{
      if(request.method==='POST')posts++;
      if(!(request.url??'').startsWith('/api/workbench/board?column=active'))return;
      const end=response.end;response.end=(...args:unknown[])=>{try{const raw=args[0],body:unknown=JSON.parse(typeof raw==='string'?raw:Buffer.isBuffer(raw)?raw.toString('utf8'):'');if(body&&typeof body==='object'&&'items' in body&&Array.isArray(body.items)){const first:unknown=body.items[0];if(first&&typeof first==='object'&&'id' in first&&first.id===ticket.ticket.id&&'updated_at' in first&&typeof first.updated_at==='string')updatedAt=first.updated_at;}}catch{}Reflect.apply(end,response,args);return response;};
    });
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id,width:1280,height:900,cookies:[cookie]});
      assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T38 open target draft');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,6);})()`);
      const positionExpression=`[...document.querySelectorAll('.board-column.active .ticket-card')].findIndex(card=>card.dataset.itemId===${JSON.stringify(ticket.ticket.id)})`;
      const before=await browser.evaluate(positionExpression);assert.ok(typeof before==='number'&&before>0,'the target starts after another real server-ordered card');
      const response=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]??''}}),bootstrap=await response.json() as {csrf_token:string};assert.equal(response.status,200);
      const contextResponse=await fetch(origin+'/api/tickets/'+ticket.ticket.id,{headers:{cookie:cookies[0]??''}}),context=await contextResponse.json() as {version:number};assert.equal(contextResponse.status,200);
      const command={client_command_id:randomUUID(),expected_version:context.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T38 real target reorder fact',external_visible:false};
      const result=await fetch(origin+'/api/tickets/'+ticket.ticket.id+'/internal-notes',{method:'POST',headers:{cookie:cookies[0]??'',origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"'+context.version+'"'},body:JSON.stringify(command)});assert.equal(result.status,200);await result.json();
      await browser.waitFor('document.querySelector(".activity-list")?.textContent.includes("T38 real target reorder fact")');
      for(let i=0;i<100&&!updatedAt;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(updatedAt,'the actual fresh board GET must put the updated target first');
      await browser.waitFor(`document.querySelector('.board-column.active [data-item-id="${ticket.ticket.id}"] .activity-time')?.title===${JSON.stringify('最新活动：')}+${JSON.stringify(updatedAt)}+${JSON.stringify('（北京时间）')}`);
      assert.equal(await browser.evaluate(positionExpression),before,'fresh facts must not move the operating target');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'T38 open target draft');assert.equal(await browser.evaluate('document.activeElement===document.querySelector("textarea")'),true);assert.equal(posts,1);
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.evaluate('document.querySelector("button[aria-label=关闭详情]").click()');await browser.waitFor('!document.querySelector(".detail-dialog")');
      assert.equal(await browser.evaluate(positionExpression),0,'closing the operated detail applies the actual fresh server order');
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',current_target_position:true,fresh_order_after_close:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true});
});
