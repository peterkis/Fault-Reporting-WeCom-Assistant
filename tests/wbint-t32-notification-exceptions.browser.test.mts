import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {t32Browser} from './helpers/t32-notification-exception-browser-fixture.mjs';
import {t32Record,t32Text,withT32Fixture,seedCard21Exceptions,seedN3SessionProfile} from './helpers/t32-notification-exception-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {chooseWorkbenchSelect,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';

test('T32 production bundle reads the bounded real queue and exact item instead of per-card fanout',{timeout:240000},async()=>{
  await t32Browser('t32-real-queue',async({browser,seed,capture})=>{
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-notification-exceptions]"))'),true,'the formal exceptions page must be mounted');
    await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===10');
    assert.equal(await browser.evaluate("document.querySelector('.notification-source-link[data-source-domain=SESSION]')?.textContent"),'会话 · 报修人（资料未提供）');
    const ids=await browser.evaluate('Array.from(document.querySelectorAll("[data-exception-row]")).map(row=>row.dataset.deliveryId)');assert.ok(Array.isArray(ids));assert.equal(new Set(ids).size,10);assert.ok(ids.every(id=>seed.deliveryIds.includes(t32Text(id))));
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-exception-row][data-delivery-status=RECONCILIATION_REQUIRED]").length>0'),true);
    const selected=t32Text(ids[0]);await browser.evaluate('document.querySelector("[data-action=open-exception]").click()');
    await browser.waitFor(`document.querySelector('[data-exception-detail]')?.dataset.deliveryId===${JSON.stringify(selected)}`);await capture('detail');
    const reads=await browser.evaluate('globalThis.__t32Reads');assert.ok(Array.isArray(reads));assert.ok(reads.map(t32Record).some(r=>r.status===200&&r.id===selected),'the exact item GET completed with the selected fact');
    assert.equal(await browser.evaluate('document.querySelector("[data-action=next-exceptions]").disabled'),false);await browser.evaluate('document.querySelector("[data-action=next-exceptions]").click()');
    await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===1');assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=next-exceptions]"))'),false);
    const after=await browser.evaluate('globalThis.__t32Reads');assert.ok(Array.isArray(after));assert.ok(after.map(t32Record).some(r=>r.status===200&&Array.isArray(r.items)&&r.items.length===1));
    assert.equal(await browser.evaluate('/T32_PRIVATE_SESSION_CANARY|T32_RAW_PROVIDER_CANARY|target_hash|target_id|provider_message/.test(document.body.innerText)'),false);
    assert.equal(await browser.evaluate('globalThis.__t32Posts'),0);assert.equal(seed.senderCalls(),11);assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  });
});

test('v2.1.2 N1–N4 S10 S11 show six real synthetic exceptions with bounded balanced columns',{timeout:240000},async()=>{
  await withT32Fixture(async f=>{
    const seed=await seedCard21Exceptions(f);await seedN3SessionProfile(f,seed.sessionId);const beforeCalls=seed.senderCalls(),page=await f.get('/api/notification-exceptions?limit=10');assert.equal(page.status,200);assert.ok(Array.isArray(page.body.items));
    const rows=page.body.items.map(t32Record);assert.equal(rows.length,6);assert.deepEqual([...new Set(rows.map(row=>row.domain))].sort(),['SESSION','TICKET']);assert.deepEqual([...new Set(rows.map(row=>row.route_kind))].sort(),['BOT_DIRECT','GROUP','YIXIAOXIU_APP']);assert.deepEqual([...new Set(rows.map(row=>row.attempt_count))].sort(),[1,2,3]);assert.deepEqual([...new Set(rows.map(row=>row.status))].sort(),['DEAD_LETTER','RECONCILIATION_REQUIRED']);
    assert.ok(rows.filter(row=>row.domain==='TICKET').every(row=>/^IT-/u.test(t32Text(row.ticket_no))&&t32Text(row.ticket_title).includes('（合成）')&&row.reporter_name===null),'N3 uses the current Ticket fields');
    assert.ok(rows.filter(row=>row.domain==='SESSION').every(row=>row.ticket_no===null&&row.ticket_title===null&&row.reporter_name==='欧阳慧敏（合成）'),'N3 uses the retained bound Session profile');
    const directory=process.env.CARD21_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card21-notifications-'));await mkdir(directory,{recursive:true});
    const cookie=f.browserCookies[0];assert.ok(cookie);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;const posts:string[]=[],reads:string[]=[],metrics:unknown[]=[];
    const observe=(request:import('node:http').IncomingMessage)=>{const path=new URL(request.url??'/',f.origin).pathname;if(request.method==='POST')posts.push(path);else if(request.method==='GET')reads.push(path);};f.runtime.server.on('request',observe);
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/notification-exceptions',width:1920,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor("document.querySelectorAll('[data-exception-row]').length===6");
      const displayed=await browser.evaluate("[...document.querySelectorAll('[data-exception-row]')].map(n=>({id:n.dataset.deliveryId,link:n.querySelector('.notification-source-link').textContent,href:n.querySelector('.notification-source-link').getAttribute('href'),title:n.querySelector('.notification-summary')?.textContent??null}))") as {id:string;link:string;href:string;title:string|null}[];
      for(const actual of displayed){const row=rows.find(row=>row.delivery_id===actual.id);assert.ok(row);assert.equal(actual.link,row.domain==='TICKET'?row.ticket_no:'会话 · '+t32Text(row.reporter_name));assert.equal(actual.title,row.domain==='TICKET'?row.ticket_title:null);assert.equal(actual.href,row.parent_link);}
      for(const width of [1920,1440,1280,900]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('window.scrollTo(0,0);document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        const sample=await browser.evaluate(`(()=>{const table=document.querySelector('.notification-table'),header=document.querySelector('.ds-page-header'),toolbar=document.querySelector('.ds-toolbar'),columns=[...table.querySelectorAll('th')].map(n=>({text:n.textContent,...n.getBoundingClientRect().toJSON(),align:getComputedStyle(n).textAlign}));return {width:innerWidth,title:document.querySelector('h1').getBoundingClientRect().toJSON(),headerGap:toolbar.getBoundingClientRect().top-header.getBoundingClientRect().bottom,columns,tableWidth:table.getBoundingClientRect().width,sourceRatio:columns[1].width/table.getBoundingClientRect().width,rowHeights:[...table.querySelectorAll('tbody tr')].map(n=>n.getBoundingClientRect().height),chips:[...document.querySelectorAll('.ds-filter-chip')].map(n=>({height:n.getBoundingClientRect().height,active:n.dataset.filterActive??null})),next:document.querySelectorAll('[data-action=next-exceptions]').length,sourceColor:getComputedStyle(document.querySelector('.notification-source-link')).color,summaryOverflow:getComputedStyle(document.querySelector('.notification-summary')).textOverflow,overflow:document.documentElement.scrollWidth>innerWidth};})()`) as {width:number;title:{x:number;y:number};headerGap:number;columns:{text:string;width:number;align:string}[];tableWidth:number;sourceRatio:number;rowHeights:number[];chips:{height:number;active:string|null}[];next:number;sourceColor:string;summaryOverflow:string;overflow:boolean};
        assert.equal(sample.headerGap,12);assert.equal(sample.columns.length,7);assert.ok(sample.sourceRatio<=.4);assert.ok((sample.columns[1]?.width??0)>=239);for(const [index,expected] of [[0,120],[2,120],[3,120],[4,120],[5,140],[6,80]])assert.ok(Math.abs((sample.columns[index??0]?.width??0)-(expected??0))<=1);assert.ok(sample.rowHeights.every(height=>height===56));assert.deepEqual(sample.chips.map(chip=>chip.height),[30,30,30]);assert.deepEqual(sample.chips.map(chip=>chip.active),[null,null,'true']);assert.equal(sample.next,0);assert.equal(sample.sourceColor,'rgb(37, 99, 201)');assert.equal(sample.summaryOverflow,'ellipsis');assert.equal(sample.columns[5]?.align,'right');assert.equal(sample.columns[6]?.align,'right');assert.equal(sample.overflow,false);
        metrics.push(sample);await writeFile(join(directory,'notifications-data-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
        await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'});await browser.waitFor("Boolean(document.querySelector('.ds-board-page-header'))");const title=await browser.evaluate("document.querySelector('h1').getBoundingClientRect().toJSON()") as {x:number;y:number};assert.equal(title.x,sample.title.x);assert.equal(title.y,sample.title.y);
        await browser.command('Page.navigate',{url:f.origin+'/workbench/app/notification-exceptions'});await browser.waitFor("document.querySelectorAll('[data-exception-row]').length===6");
      }
      assert.equal(reads.some(path=>/^\/api\/workbench\/items\//u.test(path)),false,'N3 queue never fans out to per-parent detail reads');
      await clickWorkbenchControl(browser,'[data-action=review-exceptions]');await browser.waitFor("Boolean(document.querySelector('[data-exception-detail][data-delivery-id]'))");await clickWorkbenchControl(browser,'[aria-label="关闭通知核对"]');assert.equal(await browser.evaluate('document.activeElement?.dataset.action'),'review-exceptions');
      const select='[data-field-label="异常业务域"]';await chooseWorkbenchSelect(browser,select,'INCIDENT');await browser.waitFor("Boolean(document.querySelector('[data-exception-empty]'))");
      for(const width of [1920,1440,1280,900]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');await writeFile(join(directory,'notifications-empty-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=next-exceptions]'))"),false);
      }
      assert.deepEqual(posts,[]);assert.equal(seed.senderCalls(),beforeCalls,'filtering and exact-item review never send or retry');
      await writeFile(join(directory,'notification-metrics.json'),JSON.stringify({metrics,rows,posts,reads,senderCalls:beforeCalls},null,2));console.log('CARD21_NOTIFICATION_EVIDENCE '+directory);
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'notification-failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'notification-failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
    finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  });
});
