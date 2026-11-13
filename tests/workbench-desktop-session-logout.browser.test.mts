import {clickWorkbenchControl,openWorkbenchUserMenu,openWorkbenchSettings} from './helpers/heroui-workbench-controls.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

const draftCounts=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),a=tx.objectStore('drafts').count(),b=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:a.result,operations:b.result});};};})`;

const bridge=`(()=>{window.__loginRequests=0;window.__desktopContext=null;window.workbenchDesktop={version:1,getState:async()=>({version:1,visible:true,focused:true,locked:false,suspended:false,remindersEnabled:false,revision:0}),onState:()=>()=>{},updateContext:async value=>{window.__desktopContext=value;},setReminders:async()=>false,showReminder:async()=>false,clearReminders:async()=>{},onReminderClick:()=>()=>{},requestLogin:async()=>{window.__loginRequests++;const counts=(await indexedDB.databases()).some(row=>row.name==='wecom-workbench-drafts-v1')?await (${draftCounts}):{drafts:0,operations:0};const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);sessionStorage.setItem('synthetic-login-proof',JSON.stringify({calls:window.__loginRequests,counts,blocked:event.defaultPrevented,context:window.__desktopContext,oldTextVisible:document.body.innerText.includes('PRIVATE_AUTH_DRAFT')}));location.replace('/workbench/desktop');}};})()`;

for(const mode of ['browser','desktop','logout-unknown','logout-cleanup-failure'] as const)test('user menu, local preferences and direct logout login: '+mode,{timeout:120_000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture&{certificateSpki:string})=>{
  const original=f.runtime.server.listeners('request');let qr=0,logoutPosts=0,reminderReads=0;
  f.runtime.server.removeAllListeners('request');f.runtime.server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
   if(request.url?.startsWith('/api/workbench/reminders'))reminderReads++;
   if(request.method==='POST'&&request.url==='/workbench/logout'){
    logoutPosts++;if(mode==='logout-unknown'){response.writeHead(503,{'content-type':'application/json'});response.end(JSON.stringify({error:{code:'WORKBENCH_UNAVAILABLE',retryable:true}}));return;}
   }
   if(request.url==='/workbench/desktop'){qr++;response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><h1>合成企业微信二维码登录</h1>');return;}
   for(const listener of original)Reflect.apply(listener,f.runtime.server,[request,response]);
  });
  const cookie=f.browserCookies[0];assert.ok(cookie?.url);let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,error:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,certificateSpki:f.certificateSpki,cookies:f.browserCookies.map(value=>{assert.ok(value.url);return {...value,url:value.url};})});assert.ok(browser);
   await browser.command('Page.enable');if(mode==='desktop'){
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:bridge});await browser.command('Page.reload');
   }
   await browser.waitFor('Boolean(document.querySelector("[data-action=open-user-menu]"))&&Boolean(document.querySelector(".board"))');
   assert.equal(await browser.evaluate('document.querySelector(".topbar [data-action=logout-workbench]")!==null||document.querySelector(".sidebar [data-action=open-settings]")!==null'),false,'secondary actions are inside the account menu');
   if(mode==='browser'){
    await openWorkbenchSettings(browser);await browser.waitFor('document.querySelector(".workbench-settings")?.contains(document.activeElement)');
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll(".workbench-settings input[role=switch]")].map(node=>node.disabled)'),[false,false]);
    assert.equal(await browser.evaluate('document.body.innerText.includes("尚未启用提醒功能")'),false);
    await clickWorkbenchControl(browser,'input[aria-label="开启声音提醒"]');
    await browser.command('Browser.setPermission',{permission:{name:'notifications'},setting:'granted',origin:f.origin});
    await clickWorkbenchControl(browser,'input[aria-label="开启桌面通知"]');
    await browser.waitFor(`document.querySelector('input[aria-label="开启桌面通知"]').checked`);
    assert.deepEqual(await browser.evaluate('JSON.parse(localStorage.getItem("wbint-reminder-preferences-v1"))'),{schema_version:1,sound_enabled:true,desktop_enabled:true});
    assert.equal(reminderReads,0,'local preferences do not invent a disabled server feed');
    await clickWorkbenchControl(browser,'button[aria-label="关闭设置"]');
    await browser.waitFor('document.activeElement?.dataset.action==="open-user-menu"');
    const directory=join(tmpdir(),'user-menu-'+randomUUID());await mkdir(directory,{recursive:true});
    for(const width of [1280,390]){
     await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
     await openWorkbenchUserMenu(browser);
     assert.equal(await browser.evaluate('(()=>{const r=document.querySelector("[role=menu][aria-label=用户操作]").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()'),true);
     await writeFile(join(directory,'menu-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
     // The dismiss layer intentionally covers the page; click the observed blank margin through it.
     const outside:unknown=await browser.evaluate('(()=>{const r=document.querySelector("[role=menu][aria-label=用户操作]").getBoundingClientRect(),x=8,y=innerHeight/2;return {x,y,outside:x<r.left||x>r.right||y<r.top||y>r.bottom};})()');
     assert.ok(outside&&typeof outside==='object'&&'x' in outside&&'y' in outside&&'outside' in outside&&outside.outside===true&&typeof outside.x==='number'&&typeof outside.y==='number');
     await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:outside.x,y:outside.y});
     await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:outside.x,y:outside.y});
     await browser.waitFor('!document.querySelector("[role=menu][aria-label=用户操作]")');
     assert.equal(await browser.evaluate('getComputedStyle([...document.querySelectorAll("[data-action=open-user-menu]")].find(node=>node.checkVisibility())).outlineStyle'),'none','pointer dismissal must not leave an account outline');
     assert.equal(await browser.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--focus").trim()'),await browser.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--border-focus").trim()'),'HeroUI portals and controls use the v2 semantic focus token');
     assert.notEqual(await browser.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--focus").trim()'),'transparent','v2 keyboard focus must remain visible');
     await writeFile(join(directory,'account-closed-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
     await openWorkbenchUserMenu(browser);
     await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
     await browser.waitFor('!document.querySelector("[role=menu][aria-label=用户操作]")');
    }
    console.log('USER_MENU_VISUAL '+JSON.stringify({directory,widths:[1280,390],local_preferences_with_feed_disabled:true}));
   }
   if(mode==='logout-cleanup-failure'){
    const ticket=f.tickets[5];assert.ok(ticket);await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page'});
    await browser.waitFor('document.querySelector("#internal-note")?.disabled===false');
    await browser.evaluate(`(()=>{const e=document.querySelector('#internal-note');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'SYNTHETIC_MENU_DRAFT');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await browser.waitFor('document.body.innerText.includes("草稿已保存")');
    await browser.evaluate(`(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){if(this.name==='wecom-workbench-drafts-v1'&&mode==='readwrite')throw Error('SYNTHETIC_CLEANUP_REFUSED');return original.call(this,stores,mode,...args);};})()`);
   }
   await openWorkbenchUserMenu(browser);await clickWorkbenchControl(browser,'[data-action="logout-workbench"]');
   if(mode==='logout-unknown'||mode==='logout-cleanup-failure'){
    await browser.waitFor(mode==='logout-unknown'?'document.body.innerText.includes("尚未确认")':'document.body.innerText.includes("清理尚未确认")');assert.equal(qr,0);
   }else{
    await browser.waitFor('location.pathname==="/workbench/desktop"&&document.body.innerText.includes("合成企业微信二维码登录")');assert.equal(qr,1);
    if(mode==='desktop'){const proof=await browser.evaluate('JSON.parse(sessionStorage.getItem("synthetic-login-proof"))') as {calls:number;blocked:boolean;counts:{drafts:number;operations:number}};assert.equal(proof.calls,1);assert.equal(proof.blocked,false);assert.deepEqual(proof.counts,{drafts:0,operations:0});}
   }
   assert.equal(logoutPosts,1);
  }catch(e){error=e;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();}],error);}
 },{realWorkbenchAuthentication:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
