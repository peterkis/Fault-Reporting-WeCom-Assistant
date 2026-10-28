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
test('navigation retains cards and resolved reporter profiles during refresh, then clears them on READ denial',async()=>{
  await withWeb01Fixture(async({origin,browserCookies}:Fixture)=>{
    const browserCookie=browserCookies[0];assert.ok(browserCookie);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/health',width:1280,height:900,cookies:[browserCookie]});assert.ok(browser);
      // The board is real HTTP/PG. Only the external profile response and its UI capability are synthetic.
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const original=window.fetch;window.__profileGets=0;window.__currentProfileGets=0;window.__holdBoard=false;window.__heldBoard=[];window.__denyBoard=false;
        window.fetch=async(input,options)=>{
          const url=new URL(input instanceof Request?input.url:String(input),location.href);
          if(url.pathname==='/api/workbench/profile'){window.__currentProfileGets++;return Response.json({name:'合成当前员工',department:'合成当前科室'});}
          if(url.pathname.endsWith('/reporter-profile')){window.__profileGets++;return Response.json({name:'合成导航报修人',department:'合成导航科室',source:'CURRENT_PROFILE'});}
          if(url.pathname==='/api/workbench/board'){
            if(window.__holdBoard)await new Promise(resolve=>window.__heldBoard.push(resolve));
            if(window.__denyBoard)return Response.json({error:'FORBIDDEN'},{status:403});
          }
          const response=await original(input,options);
          if(url.pathname==='/api/lifecycle/bootstrap'&&response.ok){const data=await response.json();return Response.json({...data,web_reports_enabled:true,current_profile_available:true,conversation_workspace_enabled:true});}
          return response;
        };
      })()`});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/'});
      await browser.waitFor('document.querySelector(".board")?.innerText.includes("合成导航报修人")&&document.body.innerText.includes("合成当前员工")');
      const before=await browser.evaluate('({cards:document.querySelectorAll("article.ticket-card").length,profiles:window.__profileGets,currentProfiles:window.__currentProfileGets})') as {cards:number;profiles:number;currentProfiles:number};
      assert.ok(before.cards>0&&before.profiles>0);
      for(let turn=0;turn<2;turn++){
        await browser.evaluate('document.querySelector("[data-action=open-conversations]").click()');
        await browser.waitFor('location.pathname.endsWith("/conversations")');
        await browser.evaluate('window.__holdBoard=true;document.querySelector("a[title=工作台]").click()');
        await browser.waitFor('window.__heldBoard.length>0');
        await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.deepEqual(await browser.evaluate('({cards:document.querySelectorAll("article.ticket-card").length,profiles:window.__profileGets,currentProfiles:window.__currentProfileGets})'),before);
        assert.equal(await browser.evaluate('document.querySelector(".board").innerText.includes("合成导航报修人")&&document.querySelector(".board").innerText.includes("合成导航科室")'),true);
        assert.equal(await browser.evaluate('document.body.innerText.includes("合成当前员工")&&document.body.innerText.includes("合成当前科室")'),true);
        await browser.evaluate(`window.__denyBoard=${turn===1};window.__holdBoard=false;window.__heldBoard.splice(0).forEach(resolve=>resolve())`);
        if(turn===0)await browser.waitFor('document.querySelector(".board")?.innerText.includes("合成导航报修人")');
      }
      await browser.waitFor('!document.querySelector(".board")&&!document.body.innerText.includes("合成导航报修人")');
      assert.equal(await browser.evaluate('document.body.innerText.includes("合成导航科室")'),false);
      assert.equal(await browser.evaluate('document.body.innerText.includes("合成当前员工")'),false);
      console.log('WEB01_NAVIGATION_CACHE '+JSON.stringify({cards:before.cards,profile_requests:before.profiles,navigation_rounds:2,extra_profile_requests:0,read_denial_clears:true,profile_boundary:'SYNTHETIC',board:'REAL_HTTP_PG'}));
    }catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{ticketSelfHandlingEnabled:true});
});

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
      await browser.evaluate(`(()=>{const host=document.querySelector('.detail-page')||document.querySelector('main');const nodes=[...host.querySelectorAll('textarea,button,details')];window.__refreshStability={nodes,disabled:0};window.__refreshObserver=new MutationObserver(rows=>{window.__refreshStability.disabled+=rows.filter(row=>row.type==='attributes'&&row.attributeName==='disabled').length;});window.__refreshObserver.observe(host,{subtree:true,attributes:true,attributeFilter:['disabled']});})()`);
      const quietGets=requests.filter(request=>request.path.startsWith(path)).length;
      for(let i=0;i<180&&requests.filter(request=>request.path.startsWith(path)).length<quietGets+2;i++)await new Promise(resolve=>setTimeout(resolve,100));
      assert.ok(requests.filter(request=>request.path.startsWith(path)).length>=quietGets+2,'observe at least two real background authorization reads');
      await browser.evaluate('new Promise(resolve=>setTimeout(resolve,200))');
      assert.deepEqual(await browser.evaluate('({disabled:__refreshStability.disabled,removed:__refreshStability.nodes.filter(node=>!node.isConnected).length})'),{disabled:0,removed:0});
      await browser.evaluate('__refreshObserver.disconnect()');
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
