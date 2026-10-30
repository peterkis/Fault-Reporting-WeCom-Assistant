import {launchWithHeldLoginCommit} from './helpers/workbench-login-commit-fixture.mjs';
import {openWorkbenchLogoutBoundary} from './helpers/heroui-workbench-controls.mjs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {createWeComWorkbenchAuthentication} from '../app/server/src/p2-016-workbench-wecom-auth.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {fillWaiting} from './helpers/t10-browser-fixture.mjs';
import type {T10Browser} from './helpers/t10-browser-fixture.mjs';

interface RealFixture extends Omit<T11Fixture,'browserCookies'> {
  backendOrigin:string;certificateSpki:string;sessionId:string;
  browserCookies:{name:string;value:string;url:string;httpOnly:boolean;secure:boolean;sameSite:string}[];
}
const copies="new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').count(),operations=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result,operations:operations.result});};};})";

async function withRealWaiting(run:(context:RealFixture)=>Promise<void>){
  await withWeb01Fixture(async(context:RealFixture)=>{
    await context.runtime.stop();
    const authentication=createWeComWorkbenchAuthentication({pool:context.pool,publicOrigin:context.origin,corpId:'ww-web01-synthetic',agentId:'1000001',identityHashKey:'web01-test-only-identity-hash-key',accessTokenProvider:async()=> 'web01-test-only-token',fetchImpl:async(input,init)=>{
      const url=input instanceof Request?new URL(input.url):new URL(String(input));
      assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/batch/userid_to_openuserid');assert.equal(init?.method,'POST');assert.equal(typeof init?.body,'string');
      const body=JSON.parse(String(init?.body)) as {userid_list:unknown};assert.ok(Array.isArray(body.userid_list));assert.equal(body.userid_list.length,5);const users:unknown[]=body.userid_list;
      return new Response(JSON.stringify({errcode:0,open_userid_list:users.map(userid=>{assert.equal(typeof userid,'string');return {userid,open_userid:'open-'+String(userid)};})}),{headers:{'content-type':'application/json'}});
    }});
    const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.backendOrigin).port),workbenchAuthentication:authentication,externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
    let primary:unknown;
    try{await authentication.initialize();await runtime.start();await run({...context,runtime});}catch(error){primary=error||new Error('T10_REAL_SESSION_NON_ERROR',{cause:error});}
    await closeBrowserTestResources([async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);},async()=>{await authentication.close();}],primary);
  },{realWorkbenchAuthentication:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
}

for(const mode of ['late-post','late-ack','late-decrypt'] as const)test('T10 production '+mode+' cannot restore private waiting state after the real current session logout',async()=>{
  await withRealWaiting(async context=>{
    const target=context.tickets[0],cookie=context.cookies[0];assert.ok(target&&cookie);const base='/api/tickets/'+target.ticket.id,path=base+'/request-information';
    const get=(route:string)=>fetch(context.backendOrigin+route,{headers:{cookie,connection:'close'}});
    const initialBootstrap=await get('/api/lifecycle/bootstrap');assert.equal(initialBootstrap.status,200);const bootstrap=await initialBootstrap.json() as {csrf_token:string;ticket_waiting_action_draft_recovery_enabled:boolean};assert.equal(bootstrap.ticket_waiting_action_draft_recovery_enabled,true);
    const initial=await (await get(base)).json() as {version:number;resolver_team_id:string};
    const startId=randomUUID(),start=await fetch(context.backendOrigin+base+'/take-and-start',{method:'POST',headers:{cookie,connection:'close',origin:context.origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':startId,'if-match':'"'+initial.version+'"'},body:JSON.stringify({client_command_id:startId,expected_version:initial.version,reason_code:'T10_LATE_SESSION_SETUP',resolver_team_id:initial.resolver_team_id})});
    assert.equal(start.status,200);const before=await (await get(base)).json() as {version:number;status:string};assert.equal(before.status,'IN_PROGRESS');
    const requests:{method:string;path:string;status:number|null}[]=[],hold:{reached:boolean;release:(()=>void)|null}={reached:false,release:null};
    const observe=(request:IncomingMessage,response:ServerResponse)=>{
      const url=request.url??'',row={method:request.method??'',path:url,status:null as number|null};if(url.startsWith('/api/')||url==='/workbench/logout')requests.push(row);response.once('finish',()=>{row.status=response.statusCode;});
      if(mode==='late-post'&&url===path&&row.method==='POST'||mode==='late-ack'&&url.startsWith(path+'/commands/')&&row.method==='GET'){
        const end=response.end.bind(response);response.end=((...args:Parameters<ServerResponse['end']>)=>{if(response.statusCode!==200)return end(...args);hold.reached=true;hold.release=()=>{hold.release=null;end(...args);};return response;}) as ServerResponse['end'];
      }
    };
    context.runtime.server.on('request',observe);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:T10Browser|undefined,primary:unknown;const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    try{
      browser=await launchWithHeldLoginCommit({url:context.origin+'/synthetic-start',width:1920,height:1080,certificateSpki:context.certificateSpki,cookies:context.browserCookies});assert.ok(browser);await browser.command('Page.navigate',{url:context.origin+'/workbench/app/items/ticket/'+target.ticket.id});
      await browser.waitFor("Boolean(document.querySelector('[data-action=request-information]'))&&!document.querySelector('[data-action=request-information]').disabled");await browser.evaluate("document.querySelector('[data-action=request-information]').click()");
      const form='form[aria-label="等待补充"]',input=form+' textarea';await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);await browser.evaluate(fillWaiting(input,'INTERNAL_T10_LATE_SESSION_CANARY：退出后不能恢复。'));await browser.waitFor("document.querySelector('[data-waiting-purpose=request-information] [data-waiting-draft-status]')?.textContent.includes('已保存恢复副本')");
      if(mode==='late-decrypt'){
        await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);crypto.subtle.decrypt=(...args)=>new TextDecoder().decode(args[0].additionalData).includes('waiting-requester')?new Promise((resolve,reject)=>{globalThis.__t10ReleaseDecrypt=()=>decrypt(...args).then(value=>{globalThis.__t10DecryptFinished=true;resolve(value);},reject);}):decrypt(...args);})()"});const origin=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${origin}&&typeof globalThis.__t10ReleaseDecrypt==='function'&&Boolean(document.querySelector('[data-action=open-user-menu]'))`);
      }else{
        await browser.evaluate(`(()=>{const original=fetch;globalThis.__t10Posts=[];globalThis.__t10LateFinished=false;globalThis.fetch=async(route,options)=>{try{const response=await original(route,options);if(String(route)===${JSON.stringify(path)}&&options?.method==='POST'&&response.status===200){globalThis.__t10Posts.push(JSON.parse(options.body));${mode==='late-ack'?"throw new TypeError('T10_ACTUAL_COMMITTED_RESPONSE_LOST');":''}}return response;}finally{if(${mode==='late-post'?`String(route)===${JSON.stringify(path)}&&options?.method==='POST'`:`String(route).startsWith(${JSON.stringify(path+'/commands/')})`})globalThis.__t10LateFinished=true;}};})()`);
        await browser.waitFor(`!document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).click()`);
        if(mode==='late-ack'){await browser.waitFor("globalThis.__t10Posts.length===1&&document.body.innerText.includes('结果未知')&&Boolean(document.querySelector('[data-action=check-request-information-command]'))");await browser.evaluate("document.querySelector('[data-action=check-request-information-command]').click()");}
        for(let attempt=0;attempt<100&&!hold.reached;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(hold.reached,true,'the actual committed POST or explicit safe GET reached its held 200 response');
      }
      const committed=await (await get(base)).json() as {version:number;status:string};assert.equal(committed.version,before.version+(mode==='late-decrypt'?0:1));assert.equal(committed.status,mode==='late-decrypt'?'IN_PROGRESS':'WAITING_REQUESTER');
      console.log('T10_REAL_SESSION_STAGE '+JSON.stringify({mode,currentRead:200,heldActual200:hold.reached,version:committed.version,status:committed.status,requests}));
      await openWorkbenchLogoutBoundary(browser);await browser.evaluate("(()=>{const original=fetch;globalThis.__t10LogoutResults=[];globalThis.fetch=async(route,options)=>{const response=await original(route,options);if(String(route)==='/workbench/logout')globalThis.__t10LogoutResults.push({status:response.status,body:await response.clone().json()});return response;};document.querySelector('[data-action=logout-workbench]').click();})()");
      await browser.waitFor("document.body.innerText.includes('正在打开企业微信扫码登录')&&!document.querySelector('[data-waiting-purpose=request-information]')");assert.deepEqual(await browser.evaluate('globalThis.__t10LogoutResults'),[{status:200,body:{logged_out:true}}]);
      if(mode==='late-decrypt'){await browser.evaluate('globalThis.__t10ReleaseDecrypt()');await browser.waitFor('globalThis.__t10DecryptFinished===true');}else{hold.release?.();await browser.waitFor('globalThis.__t10LateFinished===true');}
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await browser.evaluate("Boolean(document.querySelector('textarea'))||Boolean(document.querySelector('[data-waiting-purpose]'))||document.body.innerText.includes('INTERNAL_T10_LATE_SESSION_CANARY')"),false);assert.deepEqual(await browser.evaluate(copies),{drafts:0,operations:0});
      for(const route of ['/api/lifecycle/bootstrap',base])assert.equal((await get(route)).status,401);assert.equal((await context.pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[context.sessionId])).rows[0]?.state,'REVOKED');
      assert.equal(requests.filter(row=>row.path===path&&row.method==='POST').length,mode==='late-decrypt'?0:1);assert.equal(requests.filter(row=>row.path.startsWith(path+'/commands/')&&row.method==='GET').length,mode==='late-ack'?1:0);assert.equal(requests.filter(row=>row.path==='/workbench/logout'&&row.status===200).length,1);
      const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});console.log('T10_REAL_SESSION_TERMINAL '+JSON.stringify({mode,requests,actualSession:'REVOKED',heldActual200:hold.reached,privateCopies:{drafts:0,operations:0}}));
    }catch(error){primary=error||new Error('T10_LATE_SESSION_NON_ERROR',{cause:error});}
    await closeBrowserTestResources([async()=>{hold.release?.();},async()=>{if(primary&&browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({mode,requests,page:await browser.evaluate('({text:document.body.innerText,path:location.pathname})')}));console.log('T10_BROWSER_FAILURE '+JSON.stringify({directory}));}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{context.runtime.server.removeListener('request',observe);assert.equal((await context.runtime.observability.metrics()).sse_clients,0);}],primary);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'T10_CURRENT_SESSION_'+mode,screenshots}));
  });
});
