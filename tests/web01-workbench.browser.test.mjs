import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

test('a real object denial clears cached note actions even when the rejection body is unreadable',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,pool})=>{
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page',width:1920,height:1080,cookies:[browserCookies[0]]});
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"内部备注\"]'))");
      await browser.evaluate("(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T02 denied synthetic note');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.body.innerText.includes('事项不存在，或不在当前授权范围内')&&!document.querySelector('[aria-label=\"内部备注\"]')");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-allowed-actions'))"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('结果未知')"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('仅供内部的合成处理记录')"),false);
    }catch(failure){error=failure;console.log('T02_DENIAL_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText})"):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,malformedInternalNoteDenial:true});
});

for(const fault of ['disconnect','invalid-success'])test('Ticket internal note production form preserves the original command after '+fault,async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,restoreInternalNoteResponses})=>{
    const ticketId=tickets[5].ticket.id;
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots=[];
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticketId+'?detail=page',width:1920,height:1080,cookies:[browserCookies[0]]});
      const capture=async name=>{const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
      await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
      await browser.waitFor("document.querySelector('.ticket-command-version')?.textContent==='工单版本 2'");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[aria-label=\"内部备注\"]'))"),true);
      assert.equal(await browser.evaluate("document.querySelector('.ticket-command-version')?.textContent"),'工单版本 2');
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t02Commands=[];globalThis.fetch=(path,options)=>{if(String(path).endsWith('/internal-notes'))globalThis.__t02Commands.push(JSON.parse(options.body));return original(path,options);};const input=document.querySelector('[aria-label="内部备注"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T02 bundle synthetic canary');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:false,latency:250,downloadThroughput:-1,uploadThroughput:-1});
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('正在保存')");
      assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]').disabled"),true);
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')");
      await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"内部备注\"]').disabled"),true);
      assert.equal(await browser.evaluate("globalThis.__t02Commands.length"),1);
      await capture('new-detail-1920.png');
      const before=await browser.evaluate(`fetch('/api/tickets/${ticketId}').then(r=>r.json()).then(v=>v.version)`);assert.equal(before,3);
      restoreInternalNoteResponses();
      await browser.evaluate("document.querySelector('[data-action=check-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('已保存')");
      const commands=await browser.evaluate('globalThis.__t02Commands');assert.equal(commands.length,2);assert.deepEqual(commands[1],commands[0]);assert.equal(commands[0].external_visible,false);assert.equal(commands[0].expected_version,2);
      await browser.waitFor("document.querySelector('.activity-list')?.innerText.includes('T02 bundle synthetic canary')&&document.querySelector('.ticket-command-version')?.textContent==='工单版本 3'");
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"内部备注\"]').value"),'');
      assert.equal(await browser.evaluate(`fetch('/api/tickets/${ticketId}/events').then(r=>r.json()).then(v=>v.items.filter(e=>e.event_type==='ticket.note_added').length)`),1);
      await capture('new-detail-page-1920.png');console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',ticket_internal_notes:true,fault,screenshots}));
    }catch(failure){error=failure;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate("({text:document.body.innerText,commands:globalThis.__t02Commands})")));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,dropInternalNoteResponses:fault==='disconnect',malformedInternalNoteSuccess:fault==='invalid-success'});
});

test('Ticket note conflict retains input without resending and a later identity rejection clears the session',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,pool,principals})=>{
    const ticketId=tickets[5].ticket.id;let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticketId+'?detail=page',width:900,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('.ticket-command-version')?.textContent==='工单版本 2'");
      await browser.evaluate(`(async()=>{const bootstrap=await fetch('/api/lifecycle/bootstrap').then(r=>r.json()),body={client_command_id:crypto.randomUUID(),expected_version:2,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T02 independent version update',external_visible:false};const response=await fetch('/api/tickets/${ticketId}/internal-notes',{method:'POST',headers:{'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"2"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});if(response.status!==200)throw Error('setup command failed');})()`);
      await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t02Commands=[];globalThis.__t02PostStatuses=[];globalThis.__t02InFlight=0;globalThis.fetch=(path,options)=>{globalThis.__t02InFlight++;const note=String(path).endsWith('/internal-notes');if(note)globalThis.__t02Commands.push(JSON.parse(options.body));return original(path,options).then(response=>{if(note)globalThis.__t02PostStatuses.push(response.status);return response;}).finally(()=>{globalThis.__t02InFlight--;});};const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T02 conflict retained input');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('保存冲突')&&document.querySelector('.ticket-command-version')?.textContent==='工单版本 3'");
      assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'T02 conflict retained input');assert.equal(await browser.evaluate('globalThis.__t02Commands.length'),1);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('已保存')");
      const commands=await browser.evaluate('globalThis.__t02Commands');assert.equal(commands.length,2);assert.notEqual(commands[0].client_command_id,commands[1].client_command_id);assert.equal(commands[1].expected_version,3);
      // Finish the actual post-save refetches before changing identity, so this phase tests mutation denial rather than a racing query denial.
      await browser.waitFor("globalThis.__t02InFlight===0&&document.querySelector('.ticket-command-version')?.textContent==='工单版本 4'");
      await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
      await browser.evaluate("(async()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T02 rejected after expiry');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));document.querySelector('[data-action=save-internal-note]').click();})()");
      await browser.waitFor("(document.body.innerText.includes('会话已失效')||document.body.innerText.includes('当前身份没有查看权限'))&&!document.querySelector('textarea')&&!document.querySelector('.sidebar')");
      const statuses=await browser.evaluate('globalThis.__t02PostStatuses');assert.equal(statuses.length,3);assert.deepEqual(statuses.slice(0,2),[409,200]);assert.ok([401,403].includes(statuses[2]));
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-allowed-actions')||document.querySelector('#detail-title'))"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('仅供内部的合成处理记录')"),false);
    }catch(failure){error=failure;console.log('T02_EXPIRY_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText,statuses:globalThis.__t02PostStatuses,inFlight:globalThis.__t02InFlight})"):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true});
});
test('WEB01 Chromium production bundle reads real HTTP, board/list/detail/back/refresh and denied state',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,pool,principals})=>{
    const directory=resolve(process.env.WEB01_SCREENSHOT_DIR??join(tmpdir(),'web01-ui-'+randomUUID()));await mkdir(directory,{recursive:true});
    const screenshots=[];
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1920,height:1080,cookies:[browserCookies[0]]});
      const capture=async name=>{
        // Allow subsequent frame opportunities after DOM readiness; capture once
        // with the unchanged helper deadline, without retries or a longer timeout.
        await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        await browser.evaluate("Promise.all((document.querySelector('.detail-dialog')?.getAnimations()??[]).map(animation=>animation.finished)).then(()=>true)");
        const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);
        await writeFile(file,bytes);
        screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});
      };
      const reload=async()=>{
        const previous=await browser.evaluate('performance.timeOrigin');
        await browser.command('Page.reload');
        await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
      };
      const expandAll=async()=>{
        await browser.waitFor("document.querySelector('.range-bar')?.textContent.includes('已加载 15 项')&&document.querySelectorAll('[data-action=expand-column]').length===3");
        await browser.evaluate("[...document.querySelectorAll('[data-action=expand-column][aria-expanded=false]')].forEach(button=>button.click())");
      };
      await browser.waitFor("document.querySelectorAll('.ticket-card').length===9&&document.querySelector('.range-bar')?.textContent.includes('已加载 15 项')");
      assert.equal(await browser.evaluate("document.querySelectorAll('.board-column').length"),3);
      assert.deepEqual(await browser.evaluate("(()=>{const card=document.querySelector('.ticket-card'),main=document.querySelector('h1');return {border:getComputedStyle(card).borderWidth,titleSize:getComputedStyle(main).fontSize,text:getComputedStyle(main).color,columns:getComputedStyle(document.querySelector('.board')).gridTemplateColumns.split(' ').length}})()"),{border:'0px',titleSize:'36px',text:'rgb(55, 53, 47)',columns:3});
      await capture('new-board-1920.png');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await capture('new-board-1280.png');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
      await expandAll();await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      assert.ok(await browser.evaluate("document.body.innerText.includes('已解决待确认')"));
      const id=tickets[5].ticket.id;
      await browser.evaluate(`(()=>{const link=document.querySelector('[data-item-id="${id}"] .card-open');link.focus();link.click();})()`);
      await browser.waitFor(`document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'`);
      assert.equal(await browser.evaluate("document.querySelector('dialog').open"),true);
      assert.equal(await browser.evaluate("document.querySelector('dialog').contains(document.activeElement)"),true);
      assert.equal(await browser.evaluate("Math.round(document.querySelector('dialog').getBoundingClientRect().width)"),600);
      assert.ok(await browser.evaluate("document.querySelector('dialog').innerText.includes('仅供内部的合成处理记录')"));
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').focus()");
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});
      assert.equal(await browser.evaluate("document.querySelector('dialog').contains(document.activeElement)&&document.activeElement.getAttribute('aria-label')!=='关闭详情'"),true);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
      assert.equal(await browser.evaluate("document.activeElement.getAttribute('aria-label')==='关闭详情'"),true);
      await browser.evaluate("document.querySelector('[aria-label=\"下一项\"]').click()");
      await browser.waitFor("document.querySelector('#detail-title')?.textContent==='PACS 调阅影像时加载缓慢'");
      await browser.evaluate("document.querySelector('[aria-label=\"上一项\"]').click()");
      await browser.waitFor("document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'");
      await capture('new-detail-1920.png');
      // CDP key/code without the virtual key generates keyCode=0 and does not
      // invoke Chromium's native dialog cancellation; use an actual Escape key.
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
      await browser.waitFor("!document.querySelector('dialog')");
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('[data-item-id="${id}"] .card-open')`),true);
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('dialog')?.open&&document.querySelector('#detail-title'))");
      await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:100,button:'left',clickCount:1});
      await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:100,button:'left',clickCount:1});
      await browser.waitFor("!document.querySelector('dialog')");
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('dialog')?.open&&document.querySelector('#detail-title'))");
      await browser.evaluate("document.querySelector('[aria-label=\"展开完整页面\"]').click()");
      await browser.waitFor("Boolean(document.querySelector('.detail-page #detail-title'))&&!document.querySelector('dialog')");
      assert.equal(await browser.evaluate("document.activeElement.id==='detail-title'"),true);
      await capture('new-detail-page-1920.png');
      await reload();await browser.waitFor("Boolean(document.querySelector('.detail-page #detail-title'))");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("Boolean(document.querySelector('.board'))");
      await expandAll();await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('dialog')?.open&&document.querySelector('#detail-title'))");
      await reload();await browser.waitFor(`document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'`);
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");await browser.waitFor("!document.querySelector('dialog')");
      await browser.evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.includes('列表')).click()");
      await browser.waitFor("document.querySelectorAll('tbody tr').length===9");
      await reload();await browser.waitFor("document.querySelectorAll('tbody tr').length===9");
      await capture('new-list-1920.png');
      await expandAll();await browser.waitFor("document.querySelectorAll('tbody tr').length===15");
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await capture('new-list-900.png');
      await browser.evaluate("document.querySelector('tbody tr a').click()");await browser.waitFor("Boolean(document.querySelector('dialog')?.open&&document.querySelector('#detail-title'))");
      assert.equal(await browser.evaluate("document.querySelector('dialog').getBoundingClientRect().width<=innerWidth"),true);
      await capture('new-detail-900.png');
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
      await browser.waitFor("document.querySelector('.connection.offline')?.textContent==='网络已断开'&&getComputedStyle(document.querySelector('.connection.offline')).display!=='none'");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新')).click()");
      await browser.waitFor("document.body.innerText.includes('连接失败')");
      await capture('new-offline-900.png');
      await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      // The existing test-auth port issues a distinct cookie name per principal.
      await browser.command('Network.deleteCookies',{name:browserCookies[0].name,url:origin});
      await browser.command('Network.setCookies',{cookies:[browserCookies[1]]});await reload();
      await browser.waitFor("document.body.innerText.includes('当前授权范围内暂无事项')");assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-card').length"),0);
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+id});
      await browser.waitFor("document.body.innerText.includes('事项不存在，或不在当前授权范围内')");
      await browser.command('Network.deleteCookies',{name:browserCookies[1].name,url:origin});
      await browser.command('Network.setCookies',{cookies:[browserCookies[0]]});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/'});await browser.waitFor("document.querySelectorAll('.ticket-card').length===9&&document.querySelector('.range-bar')?.textContent.includes('已加载 15 项')");
      assert.equal(await browser.evaluate("document.querySelector('.board').getBoundingClientRect().width<=innerWidth"),true);
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.sidebar')).display==='none'&&getComputedStyle(document.querySelector('.board')).gridTemplateColumns.split(' ').length===1"),true);
      await capture('new-board-900.png');
      await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.ticket-card')).transitionDuration==='0s'"),true);
      await expandAll();await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('dialog')");
      const access=createPilotAccessService({pool});
      await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
      // Count real requests, without changing their HTTP result or adding retries.
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__web01DenialReads=0;globalThis.fetch=(...args)=>{if(String(args[0]).startsWith('/api/workbench/items/ticket/${id}'))globalThis.__web01DenialReads++;return original(...args);};return true})()`);
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("document.body.innerText.includes('事项不存在，或不在当前授权范围内')&&document.querySelectorAll('.ticket-card').length===2");
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.ok(await browser.evaluate('globalThis.__web01DenialReads<=2'),'a denied active query must not recreate and request in a loop');
      assert.equal(await browser.evaluate("document.querySelector('dialog').innerText.includes('仅供内部的合成处理记录')"),false);
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('dialog')");
      await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
      await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新')).click()");
      await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
      await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新')).click()");
      await browser.waitFor("document.body.innerText.includes('会话已失效')");assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-card').length"),0);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',screenshots}));
    }catch(failure){error=failure;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate("({url:location.href,text:document.body.innerText,rows:document.querySelectorAll('tbody tr').length})")));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  });
});
test('source group administrator edits real HTTP metadata and refreshes card, list and detail',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,pool})=>{
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory,{recursive:true});
    const screenshots=[];
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1280,height:900,cookies:[browserCookies[0]]});
      const id=tickets[0].ticket.id;
      await browser.waitFor(`Boolean(document.querySelector('[data-item-id="${id}"] .card-open'))`);
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('form[aria-label=\"维护来源群名称\"] input'))");
      assert.ok(await browser.evaluate("document.querySelector('dialog').innerText.includes('群名称未登记')"));
      const change=async name=>{
        await browser.evaluate(`(()=>{const input=document.querySelector('input[name="source-group-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await browser.evaluate("document.querySelector('form[aria-label=\"维护来源群名称\"]').requestSubmit()");
        await browser.waitFor(`document.querySelector('dialog .properties')?.innerText.includes(${JSON.stringify('群聊报修 · '+name)})`);
        await browser.waitFor(`document.querySelector('[data-item-id="${id}"]')?.innerText.includes(${JSON.stringify(name)})`);
      };
      await change('信息科支持群');
      assert.equal((await pool.query('SELECT display_name,row_version::text FROM workbench.source_group_name')).rows[0].row_version,'1');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,bytes);
      screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await change('合成群'.repeat(42));
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      const literal='<img src=x onerror=alert(1)>合成群';await change(literal);
      assert.equal(await browser.evaluate("document.querySelectorAll('dialog .properties img').length"),0);
      assert.equal((await pool.query('SELECT display_name FROM workbench.source_group_name')).rows[0].display_name,literal);
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('dialog')");
      await browser.evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.includes('列表')).click()");
      await browser.waitFor(`document.querySelector('.work-table')?.innerText.includes(${JSON.stringify(literal)})`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=(SELECT id FROM pilot_ticket.pilot_principal WHERE wecom_user_id='web01-synthetic-0') AND role='ADMIN'");
      await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) SELECT id,'HANDLER' FROM pilot_ticket.pilot_principal WHERE wecom_user_id='web01-synthetic-0'");
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+id+'?detail=page'});
      await browser.waitFor("Boolean(document.querySelector('.detail-page .properties'))");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('form[aria-label=\"维护来源群名称\"]'))"),false);
      assert.ok(await browser.evaluate(`document.querySelector('.detail-page .properties').innerText.includes(${JSON.stringify(literal)})`));
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',source_group_names:true,screenshots}));
    }catch(failure){error=failure;if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{sourceGroupDirectoryEnabled:true});
});
