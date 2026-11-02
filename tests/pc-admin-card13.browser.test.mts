import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';

test('Card 13 next step preserves original commands, inline wait/resume, note UUID recovery and four-width drawer',{timeout:240000},()=>withDetailRestructureFixture(async f=>{
  const first=f.tickets[0],cookie=f.browserCookies[0];assert.ok(first&&cookie&&cookie.url);
  const http=await t11Http(f),before=await http.detail(first.ticket.id);
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const b=browser;
    await b.command('Page.enable');await b.command('Page.bringToFront');
    await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__card13Writes=[];globalThis.__card13LostNote=false;globalThis.__card13HoldContext=true;let release;const gate=new Promise(resolve=>release=resolve);globalThis.__card13ReleaseContext=()=>{globalThis.__card13HoldContext=false;release();};globalThis.fetch=async(url,options)=>{const path=new URL(String(url),location.href).pathname;if(options?.method==='POST')globalThis.__card13Writes.push({path,body:JSON.parse(options.body)});const response=await original(url,options);if((options?.method??'GET')==='GET'&&path===${JSON.stringify('/api/tickets/'+first.ticket.id)}&&globalThis.__card13HoldContext)await gate;if(options?.method==='POST'&&path.endsWith('/internal-notes')&&response.ok&&!globalThis.__card13LostNote){await response.arrayBuffer();globalThis.__card13LostNote=true;throw new TypeError('SYNTHETIC_COMMITTED_NOTE_RESPONSE_LOST');}return response;};})()`});
    await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id});
    await b.waitFor("document.querySelector('.ds-next-step')?.textContent.includes('正在核对可用操作')");
    assert.equal(await b.evaluate("document.querySelector('.ds-next-step').textContent.includes('你当前为只读')"),false);
    await b.evaluate('globalThis.__card13ReleaseContext()');
    await b.waitFor("document.querySelector('.ds-next-step [data-action=take-and-start]')?.disabled===false");
    assert.equal(await b.evaluate("document.querySelector('.ds-next-step [data-tone=primary]').textContent"),'领取并开始');
    assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-next-step [data-tone=secondary]')].filter(n=>n.checkVisibility()).length<=2"),true);
    assert.equal(await b.evaluate("document.querySelectorAll('.ds-detail-hero .ds-ticket-category').length"),1);
    assert.equal(await b.evaluate("document.querySelector('.ds-detail-missing').textContent.includes('报修人姓名')"),true);
    assert.equal(await b.evaluate("document.body.innerText.includes('当前范围的记录已加载完毕')"),false);
    const click=(selector:string)=>clickWorkbenchControl(b,selector);
    const fill=async(selector:string,text:string)=>{await b.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await b.command('Input.insertText',{text});};
    for(const width of [1920,1440,1280,900]){
      await b.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
      assert.deepEqual(await b.evaluate("(()=>{const r=document.querySelector('.ds-drawer').getBoundingClientRect();return {width:r.width,top:r.top,right:innerWidth-r.right,radius:getComputedStyle(document.querySelector('.ds-drawer')).borderRadius,overflow:document.documentElement.scrollWidth>innerWidth};})()"),{width:720,top:8,right:8,radius:'14px',overflow:false});
      assert.equal(await b.evaluate("document.querySelector('[data-action=save-internal-note]').getBoundingClientRect().bottom<=innerHeight"),true);
    }
    assert.equal(await b.evaluate('globalThis.__card13Writes.length'),0);
    await click('[data-action=take-and-start]');await b.waitFor("document.querySelector('.ds-next-step [data-tone=primary]')?.textContent==='登记完工'");
    const active=await http.detail(first.ticket.id);assert.equal(active.status,'IN_PROGRESS');assert.equal(active.version,before.version+2);
    assert.equal(await b.evaluate("globalThis.__card13Writes.filter(w=>w.path.endsWith('/take-and-start')).length"),1);
    await click('[data-action=wait-vendor]');await b.waitFor("document.querySelector('form[aria-label=等待厂商]')?.checkVisibility()===true");
    await fill('form[aria-label=等待厂商] textarea','合成厂商等待原因，仅作内部记录');await click('form[aria-label=等待厂商] button[type=submit]');
    await b.waitFor("document.querySelector('.ds-next-step [data-tone=primary]')?.textContent==='恢复处理'");assert.equal((await http.detail(first.ticket.id)).status,'WAITING_VENDOR');
    assert.equal(await b.evaluate("globalThis.__card13Writes.filter(w=>w.path.endsWith('/wait-vendor')).length"),1);
    await click('[data-action=resume]');await fill('form[aria-label=恢复处理] textarea','合成厂商已回复，恢复本轮处理');await click('form[aria-label=恢复处理] button[type=submit]');
    await b.waitFor("document.querySelector('.ds-next-step [data-tone=primary]')?.textContent==='登记完工'");assert.equal((await http.detail(first.ticket.id)).status,'IN_PROGRESS');
    await fill('#internal-note','合成内部备注：不得出现在对外摘要');
    await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:2});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:2});
    await b.waitFor("document.querySelector('[data-action=check-internal-note]')?.checkVisibility()===true");
    await click('#detail-tab-trigger-attachments');await click('#detail-tab-trigger-conversations');await click('#detail-tab-trigger-activity');
    assert.equal(await b.evaluate("document.querySelector('#internal-note').value"),'合成内部备注：不得出现在对外摘要');
    await click('[data-action=check-internal-note]');await b.waitFor("document.querySelector('#internal-note')?.value===''");
    assert.equal(await b.evaluate("(()=>{const writes=globalThis.__card13Writes.filter(w=>w.path.endsWith('/internal-notes'));return writes.length===2&&JSON.stringify(writes[0].body)===JSON.stringify(writes[1].body)&&writes[0].body.external_visible===false;})()"),true);
    assert.equal((await http.detail(first.ticket.id)).status,'IN_PROGRESS');
    await click('.detail-complete-button');await b.waitFor("document.querySelector('.ds-step-inline-form #completion-process')?.checkVisibility()===true");
    assert.equal(await b.evaluate("document.querySelector('.detail-complete-button').closest('.ds-next-step')!==null"),true);
    assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-detail [data-tone=primary]')].filter(n=>n.checkVisibility()).length"),1);
    assert.equal(await b.evaluate("document.querySelector('.detail-complete-button').closest('[role=dialog]')===document.querySelector('.ds-drawer')"),true);
    assert.equal(await b.evaluate("(()=>{const form=document.querySelector('.ds-step-inline-form'),step=document.querySelector('.ds-next-step'),body=document.querySelector('.detail-body'),f=form.getBoundingClientRect(),s=step.getBoundingClientRect();return getComputedStyle(form).position==='static'&&f.top>=s.bottom&&f.left>=body.getBoundingClientRect().left&&f.right<=body.getBoundingClientRect().right;})()"),true,'the form follows the next-step card inside the drawer');
    assert.equal(await b.evaluate("(()=>{const form=document.querySelector('.ds-step-inline-form'),body=document.querySelector('.detail-body'),before=form.getBoundingClientRect().top,old=body.scrollTop;body.scrollTop+=32;const delta=body.scrollTop-old;return delta>0&&Math.abs(form.getBoundingClientRect().top-before+delta)<=1;})()"),true,'inline form moves with the content scroll');
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));

test('Card 13 clears a mounted conversation count when the same principal loses the capability',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
  await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:f.principals.map((principal:{id:string})=>principal.id),flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},externalSendEnabled:false,workbenchConversationsEnabled:true,workbenchRealtimeEnabled:true});
  if('disabled' in runtime)throw Error('CARD13_RUNTIME_DISABLED');
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown,writes=0;
  runtime.server.on('request',request=>{if(request.method==='POST')writes++;});
  try{
    const started=await runtime.start(),cookie=started.cookies?.[0],first=f.tickets[0];assert.ok(cookie&&cookie.url&&first);
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const b=browser;
    // A lower capability snapshot from the normal bootstrap refresh, with the same identity.
    await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const Source=EventSource;globalThis.__card13Sources=[];globalThis.__card13ConversationsOff=false;globalThis.EventSource=class extends Source{constructor(...args){super(...args);globalThis.__card13Sources.push(this);}};const original=fetch;globalThis.fetch=async(url,options)=>{const response=await original(url,options);if(new URL(String(url),location.href).pathname==='/api/lifecycle/bootstrap'&&response.ok&&globalThis.__card13ConversationsOff){const body=await response.clone().json();body.conversation_workspace_enabled=false;return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});}return response;};})()`});
    await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id});await b.command('Page.bringToFront');
    await b.waitFor("/^会话 \\d+$/.test(document.querySelector('#detail-tab-trigger-conversations')?.textContent)&&globalThis.__card13Sources.some(source=>source.readyState===1)");
    await b.evaluate("(()=>{globalThis.__card13Title=document.querySelector('#detail-title');globalThis.__card13ConversationsOff=true;globalThis.__card13Sources.find(source=>source.readyState===1).dispatchEvent(new MessageEvent('message',{data:'{}'}));return true;})()");
    await b.waitFor("document.querySelector('#detail-tab-trigger-conversations')?.textContent==='会话'&&!document.querySelector('.item-conversations')");
    assert.equal(await b.evaluate("document.querySelector('#detail-title')===globalThis.__card13Title"),true,'capability-only refresh leaves the detail mounted');
    assert.equal(writes,0);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],failure);
},{workbenchRealtimeEnabled:true}));

test('Card 13 read-only drawer has no primary workflow action and tab navigation does not write',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
  const first=f.tickets[0],cookie=f.browserCookies[0];assert.ok(first&&cookie&&cookie.url);
  let writes=0;f.runtime.server.on('request',request=>{if(request.method==='POST')writes++;});
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id,width:900,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
    await browser.waitFor("Boolean(document.querySelector('.ds-next-step')?.textContent.includes('你当前为只读')&&document.querySelector('.detail-properties'))");
    assert.equal(await browser.evaluate("document.querySelectorAll('.ds-next-step [data-tone=primary]').length"),0);
    await browser.command('Page.bringToFront');await clickWorkbenchControl(browser,'#detail-tab-trigger-attachments');await clickWorkbenchControl(browser,'#detail-tab-trigger-conversations');
    assert.equal(writes,0);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));

test('Card 13 reopening a cached read-only Review settles its permission read without a parent reset',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
  const first=f.tickets[0],cookie=f.browserCookies[0];assert.ok(first&&cookie&&cookie.url);
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown,writes=0;
  f.runtime.server.on('request',request=>{if(request.method==='POST')writes++;});
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const b=browser;
    await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__card13ReviewReads=0;globalThis.fetch=async(url,options)=>{const response=await original(url,options),path=new URL(String(url),location.href).pathname;if(/^\/api\/manual-reviews\/[0-9a-f-]+$/.test(path)&&response.ok){const body=await response.clone().json();body.allowed_resolutions=[];globalThis.__card13ReviewReads++;return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});}return response;};})()`});
    await b.command('Page.navigate',{url:f.origin+'/workbench/app/'});await b.command('Page.bringToFront');
    const card='.ticket-card[data-item-id="'+first.ticket.id+'"] .card-open';
    await b.waitFor("Boolean(document.querySelector('.board-column.pending'))");
    await b.evaluate("[...document.querySelectorAll('.board-column.pending button')].find(button=>button.textContent.includes('显示剩余'))?.click()");
    await clickWorkbenchControl(b,card);await b.waitFor("document.querySelector('.ds-next-step')?.textContent.includes('你当前为只读')&&globalThis.__card13ReviewReads>0");
    await clickWorkbenchControl(b,'[aria-label="关闭详情"]');await b.waitFor("!document.querySelector('.ds-drawer')");
    await clickWorkbenchControl(b,card);await b.waitFor("globalThis.__card13ReviewReads>=2&&Boolean(document.querySelector('[data-review-id]'))");
    await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await b.evaluate("document.querySelector('.ds-next-step').textContent.includes('你当前为只读')"),true);
    assert.equal(await b.evaluate("document.querySelector('.ds-next-step').textContent.includes('正在核对可用操作')"),false);
    assert.equal(writes,0);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{workbenchManualReviewEnabled:true}));
