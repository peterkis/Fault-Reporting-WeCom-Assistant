import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

const draftCounts=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),a=tx.objectStore('drafts').count(),b=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:a.result,operations:b.result});};};})`;
const bridge=`(()=>{window.__loginRequests=0;window.__desktopContext=null;window.workbenchDesktop={version:1,getState:async()=>({version:1,visible:true,focused:true,locked:false,suspended:false,remindersEnabled:false,revision:0}),onState:()=>()=>{},updateContext:async value=>{window.__desktopContext=value;},setReminders:async()=>false,showReminder:async()=>false,clearReminders:async()=>{},onReminderClick:()=>()=>{},requestLogin:async()=>{window.__loginRequests++;const counts=(await indexedDB.databases()).some(row=>row.name==='wecom-workbench-drafts-v1')?await (${draftCounts}):{drafts:0,operations:0};const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);sessionStorage.setItem('synthetic-login-proof',JSON.stringify({calls:window.__loginRequests,counts,blocked:event.defaultPrevented,context:window.__desktopContext,oldTextVisible:document.body.innerText.includes('PRIVATE_AUTH_DRAFT')}));location.replace('/workbench/desktop');}};})()`;

for(const mode of ['initial-401','draft-401','cleanup-failure','permission-403','service-503','ordinary-browser'] as const)test('desktop automatic QR login respects '+mode,{timeout:90_000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture)=>{
  const target=f.tickets[5],cookie=f.browserCookies[0];assert.ok(target&&cookie?.url);
  const original=f.runtime.server.listeners('request');let qrRequests=0,posts=0;
  f.runtime.server.removeAllListeners('request');
  f.runtime.server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
   if(request.method==='POST')posts++;
   if(request.url==='/workbench/desktop'){qrRequests++;response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><h1>合成企业微信二维码登录</h1>');return;}
   if(request.url==='/api/lifecycle/bootstrap'&&['initial-401','permission-403','service-503'].includes(mode)){
    const status=mode==='initial-401'?401:mode==='permission-403'?403:503;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:{code:status===401?'P2_016_AUTH_REQUIRED':status===403?'P2_016_FORBIDDEN':'P2_016_ACTION_FAILED',retryable:false}}));return;
   }
   for(const listener of original)Reflect.apply(listener,f.runtime.server,[request,response]);
  });
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.command('Page.enable');if(mode!=='ordinary-browser')await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:bridge});
   const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id});
   await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
   if(mode==='permission-403'||mode==='service-503'){
    await browser.waitFor(mode==='permission-403'?"document.body.innerText.includes('没有查看权限')":"document.body.innerText.includes('503')");
    assert.equal(qrRequests,0);assert.equal(await browser.evaluate('window.__loginRequests'),0);assert.equal(posts,0);return;
   }
   if(mode!=='initial-401'){
    await browser.waitFor("Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.board'))");
    if(mode==='draft-401'||mode==='cleanup-failure'){
     await browser.waitFor("document.querySelector('#internal-note')?.disabled===false");
     await browser.evaluate("(()=>{const input=document.querySelector('#internal-note');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'PRIVATE_AUTH_DRAFT：仅合成未提交输入');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
     await browser.waitFor("document.body.innerText.includes('已保存恢复副本')");assert.equal((await browser.evaluate(draftCounts) as {drafts:number}).drafts,1);
     if(mode==='cleanup-failure')await browser.evaluate("(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(this.name==='wecom-workbench-drafts-v1'&&mode==='readwrite')throw new DOMException('SYNTHETIC_STORAGE_UNAVAILABLE','InvalidStateError');return original.call(this,stores,mode,...rest);};})()");
    }
    await browser.waitFor("[...document.querySelectorAll('.ticket-notes button')].some(button=>button.textContent==='重新读取工单动作'&&!button.disabled)");
    await browser.command('Network.clearBrowserCookies');assert.equal((await fetch(f.origin+'/api/lifecycle/bootstrap')).status,401);
    // Another in-flight read can already have closed the view after cookie loss.
    await browser.evaluate("[...document.querySelectorAll('.ticket-notes button')].find(button=>button.textContent==='重新读取工单动作')?.click()");
    if(mode==='ordinary-browser'){await browser.waitFor("document.body.innerText.includes('会话已失效')");assert.equal(qrRequests,0);return;}
    if(mode==='cleanup-failure'){await browser.waitFor("document.body.innerText.includes('清理尚未确认')");assert.equal(qrRequests,0);assert.equal(await browser.evaluate('window.__loginRequests'),0);assert.equal(posts,0);return;}
   }
   await browser.waitFor("location.pathname==='/workbench/desktop'&&document.body.innerText.includes('合成企业微信二维码登录')");
   const proof=await browser.evaluate("JSON.parse(sessionStorage.getItem('synthetic-login-proof'))") as {calls:number;counts:{drafts:number;operations:number};blocked:boolean;oldTextVisible:boolean;context:{epoch:null;blocked:boolean;live:boolean;remindersAvailable:boolean}};
   assert.equal(qrRequests,1);assert.equal(proof.calls,1);assert.deepEqual(proof.counts,{drafts:0,operations:0});assert.equal(proof.blocked,false);assert.equal(proof.oldTextVisible,false);assert.deepEqual(proof.context,{epoch:null,blocked:false,live:false,remindersAvailable:false});assert.equal(posts,0,'authentication recovery must never replay a business POST');
  }catch(error){failure=error;if(browser)console.log('DESKTOP_AUTH_FAILURE',JSON.stringify({mode,state:await browser.evaluate('({text:document.body.innerText.slice(-700),calls:window.__loginRequests,path:location.pathname})')}));}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
 },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
