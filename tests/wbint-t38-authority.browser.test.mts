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
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {pool:PostgresPool;origin:string;backendOrigin?:string;sessionId:string;certificateSpki:string;browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];principals:{id:string;wecom_user_id:string;display_name:string}[];runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>}}}
const inputExpression=(note:string)=>`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(note)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,6);})()`;

test('effective scope changes revoke facts and draft authority without relying on a visible SSE event, and a later grant re-reads',async()=>{
  await withWeb01Fixture(async({pool,origin,browserCookies,tickets,principals,runtime}:Fixture)=>{
    const ticket=tickets[5],principal=principals[0],cookie=browserCookies[0];assert.ok(ticket&&principal&&cookie);
    let deniedBodies=false,posts=0,denials=0;
    runtime.server.on('request',(request,response)=>{
      if(request.method==='POST')posts++;
      if(request.method!=='GET'||!((request.url??'').startsWith('/api/workbench/items/ticket/'+ticket.ticket.id)||(request.url??'')==='/api/tickets/'+ticket.ticket.id))return;
      const end=response.end;response.end=(...args:unknown[])=>{const rejected=[401,403,404].includes(response.statusCode);if(rejected)denials++;Reflect.apply(end,response,deniedBodies&&rejected?['{']:args);return response;};
    });
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[cookie]});
      assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate(inputExpression('T38 authorized draft revoked with its scope'));
      await browser.waitFor('document.querySelector("[data-draft-status]")?.textContent.includes("已保存恢复副本")');
      const access=createPilotAccessService({pool});deniedBodies=true;
      await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:[]});
      await browser.waitFor('!document.querySelector("textarea")&&!document.querySelector(".activity-list")');
      for(let i=0;i<100&&denials===0;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(denials>0,'current object GET must actually reject the changed scope before the later grant');
      assert.equal(await browser.evaluate('document.body.innerText.includes("T38 authorized draft revoked with its scope")'),false);
      assert.equal(posts,0);
      const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookie.name+'='+cookie.value}});assert.equal(bootstrap.status,200);
      deniedBodies=false;await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'','lost authorization must not restore revoked plaintext after a new grant');
      assert.equal(posts,0);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',effective_scope_revoke:true,malformed_credible_denial:true,new_grant_reauth:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,draft:document.querySelector("textarea")?.value})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('a genuinely expired current Cookie session stops its production stream, facts and editor',async()=>{
  await withWeb01Fixture(async({pool,origin,sessionId,certificateSpki,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5];assert.ok(ticket);let posts=0;runtime.server.on('request',request=>{if(request.method==='POST')posts++;});
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:browserCookies,certificateSpki});
      assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate(inputExpression('T38 current Cookie expiry draft'));
      await browser.waitFor('document.querySelector("[data-draft-status]")?.textContent.includes("已保存恢复副本")');
      await pool.query('UPDATE pilot_ticket.workbench_auth_session SET expires_epoch_ms=$2::bigint,expires_at=platform.local_from_epoch_ms($2::bigint) WHERE session_id=$1::uuid',[sessionId,String(Date.now()-1)]);
      await browser.waitFor('document.body.innerText.includes("会话已失效")&&!document.querySelector("textarea")&&!document.querySelector(".activity-list")');
      assert.equal(await browser.evaluate('document.body.innerText.includes("T38 current Cookie expiry draft")'),false);assert.equal(posts,0);
      assert.equal((await runtime.observability.metrics()).sse_clients,0);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_TLS_HTTP_PG',real_session_expiry:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);
  },{realWorkbenchAuthentication:true,workbenchRealtimeEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
test('a real Cookie principal change fences an old in-flight GET and does not carry the former draft into the newly authorized page',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,principals,runtime}:Fixture)=>{
    const ticket=tickets[5],oldCookie=browserCookies[0],nextCookie=browserCookies[2],nextPrincipal=principals[1];assert.ok(ticket&&oldCookie&&nextCookie&&nextPrincipal);
    let holdNext=false,release:(()=>void)|undefined,posts=0;
    runtime.server.on('request',(request,response)=>{
      if(request.method==='POST')posts++;
      if(request.method!=='GET'||!(request.url??'').startsWith('/api/workbench/items/ticket/'+ticket.ticket.id))return;
      const end=response.end;response.end=(...args:unknown[])=>{if(holdNext){holdNext=false;release=()=>{Reflect.apply(end,response,args);};return response;}Reflect.apply(end,response,args);return response;};
    });
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[oldCookie]});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.evaluate(inputExpression('T38 former principal private draft'));
      await browser.waitFor('document.querySelector("[data-draft-status]")?.textContent.includes("已保存恢复副本")');holdNext=true;
      for(let i=0;i<150&&!release;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(release,'a real old-principal authorized detail GET must be in flight');
      await browser.command('Network.deleteCookies',{name:oldCookie.name,url:origin});await browser.command('Network.setCookies',{cookies:[nextCookie]});
      await browser.waitFor(`document.querySelector('.account strong')?.textContent===${JSON.stringify(nextPrincipal.display_name)}||document.body.innerText.includes('会话需要重新核验')`);
      assert.equal(await browser.evaluate('document.querySelector(".account strong")?.textContent??null'),nextPrincipal.display_name,'the newly authenticated principal must not be closed by the former draft purge broadcast');
      await browser.waitFor('Boolean(document.querySelector("textarea"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'');release();
      await new Promise(resolve=>setTimeout(resolve,50));assert.equal(await browser.evaluate('document.querySelector(".account strong")?.textContent'),nextPrincipal.display_name);assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'');assert.equal(posts,0);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',real_cookie_principal_change:true,old_get_fenced:true,former_draft_not_inherited:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    release?.();await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{workbenchRealtimeEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
test('a valid current Cookie without the independent CSRF cookie can still read production GET/SSE facts; writes retain the original CSRF requirement',async()=>{
  await withWeb01Fixture(async({origin,backendOrigin,certificateSpki,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5],cookie=browserCookies[0];assert.ok(ticket&&cookie&&backendOrigin);let posts=0;runtime.server.on('request',request=>{if(request.method==='POST')posts++;});
    const response=await fetch(backendOrigin+'/api/lifecycle/bootstrap',{headers:{cookie:cookie.name+'='+cookie.value}});assert.equal(response.status,200);const bootstrap=await response.json() as {csrf_token:string|null;realtime_sse_enabled:boolean};assert.equal(bootstrap.csrf_token,null);assert.equal(bootstrap.realtime_sse_enabled,true);
    const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1280,height:900,cookies:[cookie],certificateSpki});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector(".activity-list"))||document.body.innerText.includes("服务请求失败（502）")');
      assert.equal(await browser.evaluate('Boolean(document.querySelector(".activity-list"))'),true,'realtime decoding must preserve the existing csrf_token:null read contract');
      await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');assert.equal((await runtime.observability.metrics()).sse_clients,1);assert.equal(posts,0);
      const contextResponse=await fetch(backendOrigin+'/api/tickets/'+ticket.ticket.id,{headers:{cookie:cookie.name+'='+cookie.value}});assert.equal(contextResponse.status,200);const context=await contextResponse.json() as {version:number};
      const command={client_command_id:randomUUID(),expected_version:context.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T38 CSRF denial must not commit',external_visible:false};
      const denied=await fetch(backendOrigin+'/api/tickets/'+ticket.ticket.id+'/internal-notes',{method:'POST',headers:{cookie:cookie.name+'='+cookie.value,origin,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+context.version+'"'},body:JSON.stringify(command)});assert.equal(denied.status,403);await denied.json();assert.equal(posts,1);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_TLS_HTTP_PG',valid_cookie_nullable_csrf_reads:true,missing_csrf_write403:true,automatic_posts:0,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await rmdir(directory);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  },{realWorkbenchAuthentication:true,workbenchRealtimeEnabled:true,workbenchInternalNotesEnabled:true});
});
