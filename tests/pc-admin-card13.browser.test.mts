import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {t11Http,withT11Fixture} from './helpers/t11-completion-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
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
    // Card 32C-T: the drawer slides in (ds-drawer-enter, translateX 16px → 0); geometry is asserted only after it settles.
    await waitForAnimationsSettled(b,'.ds-drawer-content');
    assert.equal(await b.evaluate("document.querySelector('.ds-next-step [data-tone=primary]').textContent"),'领取并开始');
    assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-next-step [data-tone=secondary]')].filter(n=>n.checkVisibility()).length<=2"),true);
    assert.equal(await b.evaluate("document.querySelectorAll('.ds-detail-hero .ds-ticket-category').length"),1);
    assert.equal(await b.evaluate("document.querySelector('.ds-detail-missing').textContent.includes('报修人姓名')"),true);
    assert.equal(await b.evaluate("document.body.innerText.includes('当前范围的记录已加载完毕')"),false);
    const click=(selector:string)=>clickWorkbenchControl(b,selector);
    const fill=async(selector:string,text:string)=>{await b.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await b.command('Input.insertText',{text});};
    // Card 32C-T control: with reduced motion the entry animation is disabled, so without waiting the drawer is exactly in place.
    await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const width of [1920,1440]){
      await b.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
      assert.deepEqual(await b.evaluate("(()=>{const r=document.querySelector('.ds-drawer').getBoundingClientRect();return {width:r.width,top:r.top,right:innerWidth-r.right,running:document.querySelector('.ds-drawer-content').getAnimations({subtree:true}).filter(a=>a.animationName==='ds-drawer-enter').length};})()"),{width:720,top:8,right:8,running:0},'reduced-motion control at '+width);
    }
    await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    for(const width of [1920,1440,1280,900]){
      await b.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
      // A width change can replay the entry animation; wait for it, then the drawer must rest exactly in place (no residual transform).
      await waitForAnimationsSettled(b,'.ds-drawer-content');
      assert.ok(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(String(await b.evaluate("getComputedStyle(document.querySelector('.ds-drawer-content')).transform"))),'entry animation ends at its resting position at '+width);
      assert.deepEqual(await b.evaluate("(()=>{const r=document.querySelector('.ds-drawer').getBoundingClientRect();return {width:r.width,top:r.top,right:innerWidth-r.right,radius:getComputedStyle(document.querySelector('.ds-drawer')).borderRadius,overflow:document.documentElement.scrollWidth>innerWidth};})()"),{width:720,top:8,right:8,radius:'14px',overflow:false});
      assert.equal(await b.evaluate("document.querySelector('[data-action=save-internal-note]').getBoundingClientRect().bottom<=innerHeight"),true);
      assert.equal(await b.evaluate("document.querySelector('.ds-detail-missing').getBoundingClientRect().height<=64"),true,'missing fields occupy one compact row at '+width);
    }
    assert.equal(await b.evaluate('globalThis.__card13Writes.length'),0);
    await click('[data-action=take-and-start]');await b.waitFor("document.querySelector('.ds-next-step [data-tone=primary]')?.textContent==='登记完工'");
    const active=await http.detail(first.ticket.id);assert.equal(active.status,'IN_PROGRESS');assert.equal(active.version,before.version+2);
    await b.waitFor("document.querySelectorAll('.ticket-waiting-actions[data-routine-draft=true]').length===2");
    assert.equal(await b.evaluate("[...document.querySelectorAll('.ticket-waiting-actions[data-routine-draft=true]')].every(node=>{const status=node.querySelector('.workbench-draft-status'),style=getComputedStyle(node);return node.getBoundingClientRect().height<=24&&style.padding==='0px'&&style.borderTopWidth==='0px'&&status.checkVisibility()&&status.title==='草稿仅在当前浏览器恢复，最长24小时。'&&status.getAttribute('aria-label')===status.title&&status.querySelector('.sr-only').textContent===status.title;})"),true,'routine draft hints keep full accessible text in a compact row');
    assert.equal(await b.evaluate("document.querySelector('.detail-workflows').getBoundingClientRect().height<=24"),true,'routine-only workflow container does not reserve full-width empty rows');

    assert.equal(await b.evaluate("globalThis.__card13Writes.filter(w=>w.path.endsWith('/take-and-start')).length"),1);
    await click('[data-action=wait-vendor]');await b.waitFor("document.querySelector('form[aria-label=等待厂商]')?.checkVisibility()===true");
    await fill('form[aria-label=等待厂商] textarea','合成厂商等待原因，仅作内部记录');await click('form[aria-label=等待厂商] button[type=submit]');
    await b.waitFor("document.querySelector('.ds-next-step [data-tone=primary]')?.textContent==='恢复处理'");assert.equal((await http.detail(first.ticket.id)).status,'WAITING_VENDOR');
    assert.equal(await b.evaluate("globalThis.__card13Writes.filter(w=>w.path.endsWith('/wait-vendor')).length"),1);
    assert.equal(await b.evaluate("(()=>{const root=document.querySelector('.ds-drawer-status[data-waiting=true]'),badge=root.querySelector('.ds-status-badge'),icon=root.querySelector('.ds-drawer-pause-glyph'),style=getComputedStyle(badge);return icon.checkVisibility()&&icon.getBoundingClientRect().width===12&&icon.getBoundingClientRect().height===12&&style.height==='22px'&&style.backgroundColor==='rgb(241, 241, 239)'&&style.color==='rgb(95, 94, 91)'&&style.borderRadius==='4px'&&!badge.querySelector('.ds-status-dot').checkVisibility();})()"),true,'waiting shows the neutral pause label without changing its status text');

    assert.equal(await b.evaluate("(()=>{const step=document.querySelector('.ds-next-step'),style=getComputedStyle(step);return step.dataset.status==='WAITING_VENDOR'&&style.backgroundColor==='rgb(253, 246, 236)'&&style.borderTopWidth==='0px'&&style.boxShadow.includes('rgb(242, 217, 184)')&&style.boxShadow.includes('inset');})()"),true,'waiting uses the prototype warm surface and inset ring without changing its stage');
    const reviewEvidence=process.env.PC_ADMIN_CARD18_REVIEW_EVIDENCE_DIR;
    if(reviewEvidence){await mkdir(reviewEvidence,{recursive:true});for(const width of [1920,1440,1280,900]){await b.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await waitForAnimationsSettled(b,'.ds-drawer-content');await writeFile(join(reviewEvidence,'waiting-'+width+'.png'),Buffer.from(await b.screenshot(),'base64'));}}

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
    await b.waitFor("Boolean(document.querySelector('[data-record-kind=status]')&&document.querySelector('[data-record-kind=note][data-audience=INTERNAL]'))");
    assert.equal(await b.evaluate("[...document.querySelectorAll('[data-record-kind=status] .record-text')].every(node=>getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(node).padding==='0px')"),true,'status records have no yellow bubble or padding');
    assert.equal(await b.evaluate("[...document.querySelectorAll('[data-record-kind=status]')].every(node=>node.querySelectorAll('.ds-status-dot').length===2&&!node.querySelector('.record-audience'))"),true,'status changes retain both stage dots without a note audience badge');
    assert.equal(await b.evaluate("(()=>{const note=document.querySelector('[data-record-kind=note][data-audience=INTERNAL]');return getComputedStyle(note.querySelector('.record-text')).backgroundColor!=='rgba(0, 0, 0, 0)'&&note.querySelector('.record-audience svg')!==null;})()"),true);

    assert.equal(await b.evaluate("[...document.querySelectorAll('[data-record-kind=note],[data-record-kind=report]')].every(row=>{const head=row.querySelector('.record-heading'),body=row.querySelector('.record-text'),style=getComputedStyle(body),h=head.getBoundingClientRect(),b=body.getBoundingClientRect();return b.top>=h.bottom+5&&Math.abs(b.left-h.left)<=1&&style.fontSize==='14px'&&style.lineHeight==='22px'&&style.color==='rgb(55, 53, 47)'&&style.padding==='10px 12px'&&style.borderTopLeftRadius==='4px'&&style.borderTopRightRadius==='12px'&&style.borderBottomRightRadius==='12px'&&style.borderBottomLeftRadius==='12px'&&row.querySelectorAll('time').length===1;})"),true,'notes and reports keep a separate primary-text body below the header with prototype corners');
    assert.equal(await b.evaluate("(()=>{const style=getComputedStyle(document.querySelector('.detail-description'));return style.borderTopWidth==='0px'&&style.borderBottomWidth==='0px'&&getComputedStyle(document.querySelector('.ds-detail-tabs')).columnGap==='20px';})()"),true,'the tab baseline is the only description-area divider');
    assert.equal(await b.evaluate("(()=>{const input=document.querySelector('.ds-note-input'),frame=input.getBoundingClientRect(),count=input.querySelector('[data-note-count]').getBoundingClientRect(),button=input.querySelector('[data-action=save-internal-note]').getBoundingClientRect(),style=getComputedStyle(input);return style.backgroundColor==='rgb(255, 253, 246)'&&button.bottom<frame.bottom&&button.right<frame.right&&count.left>frame.left&&count.bottom<frame.bottom&&Math.abs((count.top+count.bottom)/2-(button.top+button.bottom)/2)<=1&&button.height===28;})()"),true,'Card 20 S9 keeps the warm-white surface, counter and original save action inside one footer row');
    assert.equal(await b.evaluate("document.querySelector('#detail-tab-trigger-attachments').textContent.includes(' 0')"),false);
    // Card 32C-T: the selected tab's underline colour transitions in; assert its resting style once the transition ends.
    await waitForAnimationsSettled(b,'.ds-detail-tabs');
    assert.equal(await b.evaluate("(()=>{const tab=document.querySelector('[role=tab][aria-selected=true]'),style=getComputedStyle(tab);return style.fontWeight==='600'&&style.borderBottomWidth==='2px'&&style.borderBottomColor===style.color&&style.backgroundColor==='rgba(0, 0, 0, 0)';})()"),true,'selected tab has a two-pixel primary-text underline');
    assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-detail time[datetime]')].every(node=>/^((\\d{4}-)?\\d{2}-\\d{2} \\d{2}:\\d{2})$/.test(node.textContent)&&/\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}（北京时间）/.test(node.title))"),true,'short times have full Beijing tooltips');
    const evidence=process.env.PC_ADMIN_CARD18_EVIDENCE_DIR;
    if(evidence){await mkdir(evidence,{recursive:true});for(const width of [1920,1440,1280,900]){
      await b.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
      await waitForAnimationsSettled(b,'.ds-drawer-content');
      assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await writeFile(join(evidence,'after-'+width+'.png'),Buffer.from(await b.screenshot(),'base64'));
    }}
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
    assert.equal(await browser.evaluate("(()=>{const glyph=document.querySelector('.ds-stage-pill [data-stage-glyph=pending]');return glyph?.querySelector('circle')?.getAttribute('stroke-dasharray')==='2.4 2.1'&&glyph.getBoundingClientRect().width===13&&!document.querySelector('.ds-stage-pill>.ds-status-dot')?.checkVisibility();})()"),true);

    await browser.command('Page.bringToFront');await clickWorkbenchControl(browser,'#detail-tab-trigger-attachments');await clickWorkbenchControl(browser,'#detail-tab-trigger-conversations');
    const reader=await t11Http(f);let activeId='',closedId='';
    for(const candidate of f.tickets){const facts=await reader.detail(candidate.ticket.id);if(facts.status==='IN_PROGRESS'&&!activeId)activeId=candidate.ticket.id;if(facts.status==='CLOSED'&&!closedId)closedId=candidate.ticket.id;if(activeId&&closedId)break;}
    assert.ok(activeId&&closedId);
    for(const target of [{stage:'active',id:activeId},{stage:'closed',id:closedId}]){
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+target.id});
      await browser.waitFor("Boolean(document.querySelector('.ds-stage-pill [data-stage-glyph="+target.stage+"]'))");
      assert.equal(await browser.evaluate("(()=>{const glyph=document.querySelector('.ds-stage-pill [data-stage-glyph="+target.stage+"]');return glyph.getBoundingClientRect().width===13&&glyph.getBoundingClientRect().height===13&&glyph.getAttribute('viewBox')==='0 0 16 16'&&glyph.querySelector('path')!==null&&!document.querySelector('.ds-stage-pill>.ds-status-dot')?.checkVisibility();})()"),true,'drawer stage geometry '+target.stage);
      assert.equal(await browser.evaluate("document.querySelectorAll('.ds-next-step [data-tone=primary]').length"),0);
    }
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
    await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__card13ReviewReads=0;globalThis.fetch=async(url,options)=>{const response=await original(url,options),path=new URL(String(url),location.href).pathname;if(path.startsWith('/api/manual-reviews/')&&!path.slice('/api/manual-reviews/'.length).includes('/')&&response.ok){const body=await response.clone().json();body.allowed_resolutions=[];globalThis.__card13ReviewReads++;return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});}return response;};})()`});
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
    await clickWorkbenchControl(b,'[aria-label="关闭详情"]');await b.waitFor("!document.querySelector('.ds-drawer')");
    await clickWorkbenchControl(b,'.board-column.pending .ticket-card:is([data-kind=review],[data-kind=intake]) .card-open');
    await b.waitFor("document.querySelector('.detail-breadcrumb')?.textContent.includes('事项')&&Boolean(document.querySelector('.detail-properties'))");
    assert.equal(await b.evaluate("document.querySelector('.reporter-contact').checkVisibility()"),false,'non-Ticket contact reads are disabled and never appear pending');
    assert.equal(await b.evaluate("document.querySelector('.ds-detail-missing').textContent.includes('联系电话')"),true);
    assert.equal(writes,0);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{workbenchManualReviewEnabled:true}));


test('Card 13 ordinary completion initial permission failure keeps its original retry reachable',{timeout:240000},()=>withT11Fixture(async f=>{
 const first=f.tickets[0],cookie=f.browserCookies[0];assert.ok(first&&cookie?.url);const http=await t11Http(f);await http.start(first.ticket.id);const before=await http.detail(first.ticket.id);
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const b=browser;
  await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__card13ReadLost=false;globalThis.__card13RetryPosts=0;globalThis.fetch=async(url,options)=>{if(options?.method==='POST')globalThis.__card13RetryPosts++;const response=await original(url,options);if(new URL(String(url),location.href).pathname===${JSON.stringify('/api/tickets/'+first.ticket.id)}&&!globalThis.__card13ReadLost){globalThis.__card13ReadLost=true;await response.arrayBuffer();throw new TypeError('SYNTHETIC_INITIAL_COMPLETION_CONTEXT_LOST');}return response;};})()`});
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id});await b.command('Page.bringToFront');
  await b.waitFor("document.querySelector('.ticket-completion [role=alert]')?.checkVisibility()===true&&document.querySelector('[data-action=refresh-completion]')?.checkVisibility()===true");
  assert.equal(await b.evaluate("document.querySelector('.ds-next-step').textContent.includes('你当前为只读')"),false);
  await clickWorkbenchControl(b,'[data-action=refresh-completion]');await b.waitFor("document.querySelector('.ds-next-step .detail-complete-button')?.checkVisibility()===true");
  const after=await http.detail(first.ticket.id);assert.equal(after.status,before.status);assert.equal(after.version,before.version);assert.equal(after.assignee_id,before.assignee_id);assert.deepEqual(after.handling_cycle,before.handling_cycle);
  assert.equal(await b.evaluate('globalThis.__card13RetryPosts'),0);
 }catch(error){failure=error;}
 await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{recoveryEnabled:false,notesEnabled:false}));


test('Card 18 detail read error uses danger alert and a read-only ghost retry',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const first=f.tickets[0],cookie=f.browserCookies[0];assert.ok(first&&cookie?.url);
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown,writes=0;
 f.runtime.server.on('request',request=>{if(request.method==='POST')writes++;});
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const b=browser;
  await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__card18ReadFailure=true;globalThis.fetch=(url,options)=>globalThis.__card18ReadFailure&&new URL(String(url),location.href).pathname===${JSON.stringify('/api/workbench/items/ticket/'+first.ticket.id)}?Promise.resolve(new Response(JSON.stringify({error:{code:'SYNTHETIC_UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}})):original(url,options);})()`});
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id});await b.command('Page.bringToFront');
  await b.waitFor("document.querySelector('.ds-detail .ds-inline-alert[data-tone=danger]')?.textContent.includes('加载失败，请检查网络后重试')");
  assert.equal(await b.evaluate("document.querySelector('.ds-detail .ds-inline-alert button').dataset.tone"),'ghost');
  const evidence=process.env.PC_ADMIN_CARD18_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'read-error-1440.png'),Buffer.from(await b.screenshot(),'base64'));}
  await b.evaluate('globalThis.__card18ReadFailure=false');await clickWorkbenchControl(b,'.ds-detail .ds-inline-alert button');await b.waitFor("Boolean(document.querySelector('#detail-title'))");
  assert.equal(writes,0);
 }catch(error){failure=error;}
 await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));

test('Card 20 T5 T7 S7 S8 S9 D2 D6 drawer refinements preserve focus, records and original commands',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown,writes=0;
 const cookie=f.browserCookies[0];assert.ok(cookie);const first=f.tickets[0];assert.ok(first);
 f.runtime.server.on('request',request=>{if(request.method==='POST')writes++;});
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id,width:1440,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelector('#internal-note')!==null&&document.querySelector('[data-action=save-internal-note]')!==null&&document.activeElement===document.querySelector('#detail-title')");
  assert.deepEqual(await b.evaluate("(()=>{const e=document.activeElement,s=getComputedStyle(e);return {id:e.id,outline:s.outlineStyle,shadow:s.boxShadow};})()"),{id:'detail-title',outline:'none',shadow:'none'});
  await b.command('Page.bringToFront');await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
  assert.equal(await b.evaluate("document.activeElement.tagName==='BUTTON'&&document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle==='solid'"),true);
  await b.evaluate("document.querySelector('#detail-title').focus();true");
  assert.equal(await b.evaluate("document.activeElement===document.querySelector('#detail-title')&&getComputedStyle(document.activeElement).outlineStyle==='none'&&getComputedStyle(document.activeElement).boxShadow==='none'"),true,'programmatic focus stays quiet after keyboard input as well');
  assert.equal(await b.evaluate("(()=>{const row=[...document.querySelectorAll('.detail-record')].find(e=>e.textContent.includes('正在核对打印队列（合成）'));return row?.dataset.recordKind==='note'&&!row.querySelector('.record-status-change')&&!row.textContent.includes('→');})()"),true);
  assert.equal(await b.evaluate("(()=>{const row=[...document.querySelectorAll('.detail-record')].find(e=>e.textContent.includes('请保留待打印的文件（合成）'));return row?.dataset.recordKind==='note'&&row.dataset.audience==='EXTERNAL'&&!row.querySelector('.record-status-change');})()"),true);
  assert.equal(await b.evaluate("(()=>{const h=document.querySelector('[data-record-kind=report] .record-heading'),name=h.querySelector('.record-name'),time=h.querySelector('time'),n=name.getBoundingClientRect(),t=time.getBoundingClientRect();return h.querySelector('.record-report-separator').textContent==='·'&&Math.abs(n.top-t.top)<=1&&t.left-n.right<24&&getComputedStyle(time).fontSize==='12px'&&getComputedStyle(time).color==='rgb(107, 105, 101)';})()"),true);
  assert.equal(await b.evaluate("document.querySelector('.ds-detail-ask')===null"),true);
  assert.equal(await b.evaluate("(()=>{const frame=document.querySelector('.ds-note-input').getBoundingClientRect(),count=document.querySelector('[data-note-count]').getBoundingClientRect(),save=document.querySelector('[data-action=save-internal-note]').getBoundingClientRect();return count.left>frame.left&&count.bottom<frame.bottom&&save.right<frame.right&&save.bottom<frame.bottom&&Math.abs((count.top+count.bottom)/2-(save.top+save.bottom)/2)<=1&&getComputedStyle(document.querySelector('[data-note-count]')).fontSize==='12px'&&document.querySelector('label[for=internal-note]').title.includes('仅信息科可见');})()"),true);
  await clickWorkbenchControl(b,'#internal-note');await b.command('Input.insertText',{text:'精修（合成）'});assert.equal(await b.evaluate("document.querySelector('[data-note-count]').textContent"),'6 / 2000');
  for(const [index,state] of [[0,'QUEUED'],[3,'ACCEPTED'],[2,'IN_PROGRESS'],[6,'WAITING_VENDOR'],[12,'RESOLVED']] as const){
   const ticket=f.tickets[index];assert.ok(ticket);await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+ticket.ticket.id});
   await b.waitFor(`document.querySelector('.ds-next-step')?.dataset.status===${JSON.stringify(state)}&&Boolean(document.querySelector('.detail-description'))`);
   const metrics=await b.evaluate("(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),c=s=>getComputedStyle(document.querySelector(s));return {hero:r('.ds-next-step').top-r('.ds-detail-hero').bottom,tabs:r('.detail-description').top-r('.ds-detail-tabs').bottom,message:c('.ds-next-step-copy p').color,title:c('.ds-next-step-copy h3').color,font:c('.ds-next-step-copy p').fontSize,weight:c('.ds-next-step-copy p').fontWeight,icon:r('.ds-next-step-icon,.ds-next-step-wait-icon').width};})()");
   assert.ok(metrics&&typeof metrics==='object');const m=metrics as {hero:number;tabs:number;message:string;title:string;font:string;weight:string;icon:number};
   assert.ok(Math.abs(m.hero-16)<=1);assert.ok(Math.abs(m.tabs-16)<=1);assert.equal(m.message,'rgb(55, 53, 47)');assert.equal(m.title,'rgb(107, 105, 101)');assert.equal(m.font,'14px');assert.equal(m.weight,'600');assert.equal(m.icon,34);
   assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.detail-body'),'::-webkit-scrollbar').width"),'8px');
   assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.detail-body'),'::-webkit-scrollbar-button').display"),'none');
   if(state==='IN_PROGRESS')assert.equal(await b.evaluate("Boolean(document.querySelector('[data-record-kind=status] .record-status-change'))"),true);
  }
  assert.equal(writes,0);
 }catch(error){failure=error;}
 await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{precisionV212:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchFollowEnabled:true}));
