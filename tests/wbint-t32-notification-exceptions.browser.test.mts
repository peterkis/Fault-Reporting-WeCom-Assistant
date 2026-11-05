import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {t32Browser} from './helpers/t32-notification-exception-browser-fixture.mjs';
import {t32Record,t32Text,withT32Fixture,seedCard21Exceptions,seedN3SessionProfile} from './helpers/t32-notification-exception-fixture.mjs';
import {card22Filters,assertCard22Filters,captureCard22} from './helpers/card22-presentation.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {chooseWorkbenchSelect,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';

test('V14 notification header has no column separators and today uses HH:mm',{timeout:240000},async()=>{
 await withT32Fixture(async f=>{
  const seed=await seedCard21Exceptions(f),senderCalls=seed.senderCalls(),directory=process.env.CARD23_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card23-notifications-'));await mkdir(directory,{recursive:true});
  const cookie=f.browserCookies[0];assert.ok(cookie);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown,sample:unknown;const posts:string[]=[];
  const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/notification-exceptions',width:1440,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor("document.querySelectorAll('[data-exception-row]').length===6");
   const measured=await browser.evaluate(`(()=>{
    const headers=[...document.querySelectorAll('.notification-table th')].map(n=>({text:n.textContent,styles:[null,'::before','::after'].map(p=>{const s=getComputedStyle(n,p);return {left:s.borderLeftWidth,right:s.borderRightWidth,bottom:s.borderBottomWidth,content:s.content,width:s.width};})}));
    return {headers,times:[...document.querySelectorAll('.notification-time time')].map(n=>({text:n.textContent,title:n.title,dateTime:n.dateTime,attempts:n.nextElementSibling.textContent})),rowBorder:getComputedStyle(document.querySelector('.notification-table thead tr')).borderBottomWidth};
   })()`) as {headers:{text:string;styles:{left:string;right:string;bottom:string;content:string;width:string}[]}[];times:{text:string;title:string;dateTime:string;attempts:string}[];rowBorder:string};
   sample=measured;assert.equal(measured.headers.length,7);assert.equal(measured.rowBorder,'1px');
   for(const header of measured.headers){for(const s of header.styles){assert.equal(s.left,'0px');assert.equal(s.right,'0px');}assert.equal(header.styles[2]?.content,'none');assert.equal(header.styles[2]?.width,'0px');}
   assert.equal(measured.times.length,6);
   for(const time of measured.times){assert.match(time.text,/^\d{2}:\d{2}$/u);assert.match(time.title,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}（北京时间）$/u);assert.match(time.dateTime,/T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+08:00$/u);assert.match(time.attempts,/^[123] 次尝试$/u);}
   await captureCard22(browser,directory,'notifications-1440');assert.deepEqual(posts,[]);assert.equal(seed.senderCalls(),senderCalls);
  }catch(error){failure=error;}
  finally{await closeBrowserTestResources([
   ()=>{f.runtime.server.off('request',observe);},
   ()=>writeFile(join(directory,'card23-notification-metrics.json'),JSON.stringify({sample,posts,senderCalls:seed.senderCalls()},null,2)),
   async()=>{if(failure&&browser)await captureCard22(browser,directory,'card23-notification-failure');},
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
  ],failure);}
 });
});

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
        assert.equal(sample.headerGap,12);assert.equal(sample.columns.length,7);assert.ok(sample.sourceRatio<=.25);assert.ok((sample.columns[1]?.width??0)>=140);assert.ok((sample.columns[2]?.width??0)>(sample.columns[1]?.width??0));assert.ok((sample.columns[2]?.width??0)>(sample.columns[3]?.width??0));for(const [index,expected] of [[0,120],[4,120],[5,140],[6,80]])assert.ok(Math.abs((sample.columns[index??0]?.width??0)-(expected??0))<=1);assert.ok(sample.rowHeights.every(height=>height===56));assert.deepEqual(sample.chips.map(chip=>chip.height),[32,32,32]);assert.deepEqual(sample.chips.map(chip=>chip.active),[null,null,'true']);assert.equal(sample.next,0);assert.equal(sample.sourceColor,'rgb(37, 99, 201)');assert.equal(sample.summaryOverflow,'ellipsis');assert.equal(sample.columns[5]?.align,'right');assert.equal(sample.columns[6]?.align,'right');assert.equal(sample.overflow,false);
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
      // A valid long name must really overflow the source cell, including at 1920.
      const longName='欧阳慧敏（合成）'.repeat(8);await seedN3SessionProfile(f,seed.sessionId,longName);await chooseWorkbenchSelect(browser,select,'ALL');
      await browser.waitFor("[...document.querySelectorAll('.notification-source-link[data-source-domain=SESSION]')].some(n=>n.textContent==="+JSON.stringify('会话 · '+longName)+')');
      const longNameMetrics:unknown[]=[];
      for(const width of [1920,1440,1280,900]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        const names=await browser.evaluate("[...document.querySelectorAll('.notification-source-link[data-source-domain=SESSION]')].map(n=>({text:n.textContent,right:n.getBoundingClientRect().right,cellRight:n.closest('td').getBoundingClientRect().right,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,ellipsis:getComputedStyle(n).textOverflow}))") as {text:string;right:number;cellRight:number;scrollWidth:number;clientWidth:number;ellipsis:string}[];
        assert.equal(names.length,2);assert.ok(names.every(n=>n.text==='会话 · '+longName&&n.right<=n.cellRight+1&&n.scrollWidth>n.clientWidth&&n.ellipsis==='ellipsis'),'N3 long name actually overflows within its cell at '+width+': '+JSON.stringify(names));longNameMetrics.push({width,names});await writeFile(join(directory,'notifications-long-name-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
      }
      assert.deepEqual(posts,[]);assert.equal(seed.senderCalls(),beforeCalls);
      await writeFile(join(directory,'notification-metrics.json'),JSON.stringify({metrics,rows,longNameMetrics,posts,reads,senderCalls:beforeCalls},null,2));console.log('CARD21_NOTIFICATION_EVIDENCE '+directory);
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'notification-failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'notification-failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
    finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  });
});

test('R5 R6 card22 notification flex widths, shared chips and scroll without wrapping',{timeout:240000},async()=>{
 await withT32Fixture(async f=>{
  const seed=await seedCard21Exceptions(f);await seedN3SessionProfile(f,seed.sessionId);const beforeCalls=seed.senderCalls(),directory=process.env.CARD22_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card22-notifications-'));await mkdir(directory,{recursive:true});
  const cookie=f.browserCookies[0];assert.ok(cookie);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;const metrics:unknown[]=[],posts:string[]=[];
  const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/notification-exceptions',width:1440,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor("document.querySelectorAll('[data-exception-row]').length===6");
   const filters=await card22Filters(browser,null);assertCard22Filters(filters);assert.equal(filters.search,null);assert.ok(filters.chips.some(chip=>chip.active)&&filters.chips.some(chip=>!chip.active));metrics.push({R5:'notifications-no-search-by-design',...filters});await captureCard22(browser,directory,'toolbar-notifications-1440','.notification-exceptions>.ds-toolbar');
   for(const width of [1440,1920,900]){
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const sample=await browser.evaluate("(()=>{const table=document.querySelector('.notification-table'),scroll=table.parentElement,columns=[...table.querySelectorAll('th')].map(n=>({text:n.textContent,...n.getBoundingClientRect().toJSON()})),links=[...table.querySelectorAll('.notification-source-link')],types=[...table.querySelectorAll('.notification-type')],cells=[...table.querySelectorAll('td')];return {width:innerWidth,tableWidth:table.getBoundingClientRect().width,columns,sourceRatio:columns[1].width/table.getBoundingClientRect().width,scrollClient:scroll.clientWidth,scrollWidth:scroll.scrollWidth,scrollOverflow:getComputedStyle(scroll).overflowX,links:links.map(n=>({text:n.textContent,align:getComputedStyle(n).textAlign,whiteSpace:getComputedStyle(n).whiteSpace,color:getComputedStyle(n).color,icon:n.querySelector('svg')?.getBoundingClientRect().width??0})),types:types.map(n=>({text:n.textContent,title:n.title,ellipsis:getComputedStyle(n).textOverflow,whiteSpace:getComputedStyle(n).whiteSpace})),allCellsNoWrap:cells.every(n=>getComputedStyle(n).whiteSpace==='nowrap'),overlap:[...table.querySelectorAll('tbody tr')].some(row=>{const cells=[...row.children];return cells.some((cell,index)=>index>0&&cell.getBoundingClientRect().left<cells[index-1].getBoundingClientRect().right-1);}),pageOverflow:document.documentElement.scrollWidth>innerWidth};})()") as {width:number;tableWidth:number;columns:{text:string;width:number}[];sourceRatio:number;scrollClient:number;scrollWidth:number;scrollOverflow:string;links:{text:string;align:string;whiteSpace:string;color:string;icon:number}[];types:{text:string;title:string;ellipsis:string;whiteSpace:string}[];allCellsNoWrap:boolean;overlap:boolean;pageOverflow:boolean};
    assert.deepEqual(sample.columns.map(n=>n.text),['结果','关联来源','通知类型','接收人','渠道','时间','操作']);assert.ok(sample.sourceRatio<=.25);assert.ok((sample.columns[2]?.width??0)>(sample.columns[1]?.width??Infinity));assert.ok((sample.columns[2]?.width??0)>(sample.columns[3]?.width??Infinity));
    assert.equal(sample.links.length,6);assert.ok(sample.links.every(n=>n.align==='left'&&n.whiteSpace==='nowrap'&&n.color==='rgb(37, 99, 201)'&&n.icon===14));assert.ok(sample.types.every(n=>n.text===n.title&&n.ellipsis==='ellipsis'&&n.whiteSpace==='nowrap'));assert.equal(sample.allCellsNoWrap,true);assert.equal(sample.overlap,false);assert.equal(sample.pageOverflow,false);
    if(width===900){assert.ok(sample.scrollWidth>sample.scrollClient);assert.ok(['auto','scroll'].includes(sample.scrollOverflow));const moved=await browser.evaluate("(()=>{const n=document.querySelector('.notification-table').parentElement;n.scrollLeft=n.scrollWidth;return n.scrollLeft;})()");assert.ok(Number(moved)>0);await captureCard22(browser,directory,'notifications-900-scrolled');await browser.evaluate("document.querySelector('.notification-table').parentElement.scrollLeft=0");}
    metrics.push({R6:sample});await captureCard22(browser,directory,'notifications-'+width);
   }
   assert.deepEqual(posts,[]);assert.equal(seed.senderCalls(),beforeCalls,'R5/R6 never send or retry');
  }catch(error){failure=error;}
  finally{await closeBrowserTestResources([
   async()=>{if(failure&&browser)await captureCard22(browser,directory,'notifications-failure');},
   ()=>{f.runtime.server.off('request',observe);},
   ()=>writeFile(join(directory,'notification-metrics.json'),JSON.stringify(metrics,null,2)),
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
  ],failure);}
 });
});
