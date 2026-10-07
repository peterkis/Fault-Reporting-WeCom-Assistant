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
        const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);
        await writeFile(file,bytes);
        screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});
      };
      const reload=async()=>{
        const previous=await browser.evaluate('performance.timeOrigin');
        await browser.command('Page.reload');
        await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
      };
      await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      assert.equal(await browser.evaluate("document.querySelectorAll('.board-column').length"),3);
      assert.ok(await browser.evaluate("document.body.innerText.includes('已解决待确认')"));
      await capture('new-board-1920.png');
      const id=tickets[5].ticket.id;
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor(`document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'`);
      assert.equal(await browser.evaluate("document.querySelector('dialog').open"),true);
      assert.ok(await browser.evaluate("document.querySelector('dialog').innerText.includes('仅供内部的合成处理记录')"));
      await capture('new-detail-1920.png');
      await reload();await browser.waitFor(`document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'`);
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");await browser.waitFor("!document.querySelector('dialog')");
      await browser.evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.includes('列表')).click()");
      await browser.waitFor("document.querySelectorAll('tbody tr').length===15");
      await reload();await browser.waitFor("document.querySelectorAll('tbody tr').length===15");
      await capture('new-list-1920.png');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
      await browser.evaluate("document.querySelector('tbody tr a').click()");await browser.waitFor("Boolean(document.querySelector('dialog')?.open&&document.querySelector('#detail-title'))");
      assert.equal(await browser.evaluate("document.querySelector('dialog').getBoundingClientRect().width<=innerWidth"),true);
      await capture('new-detail-900.png');
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
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
      await browser.command('Page.navigate',{url:origin+'/workbench/app/'});await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      assert.equal(await browser.evaluate("document.querySelector('.board').getBoundingClientRect().width<=innerWidth"),true);
      await capture('new-board-900.png');
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
