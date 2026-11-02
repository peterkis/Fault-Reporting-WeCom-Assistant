import {openWorkbenchUserMenu,assertWorkbenchPrimaryActions,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';

test('v2.1 SSE arrival keeps the frozen detail navigation inside the rendered intake group',{timeout:120000},()=>withWeb01Fixture(async f=>{
  let browser,error;
  try{
    await f.runtime.realtimeProjector.runOnce();
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...f.browserCookies[0],url:f.origin}]});assert.ok(browser);
    await browser.command('Page.bringToFront');
    await browser.waitFor("document.querySelectorAll('.ticket-card').length===9&&document.querySelector('.range-bar')?.textContent.includes('已加载 15 项')&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
    await clickWorkbenchControl(browser,'.board-column.pending [data-action=expand-column]');
    const initial=await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>n.dataset.itemId)");assert.equal(initial.length,7);
    await clickWorkbenchControl(browser,'.board-column.pending [data-item-id="'+initial[1]+'"] .card-open');
    await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
    assert.equal(await browser.evaluate("document.querySelector('.board-column.pending .ds-column-sort').disabled"),true,'order freeze must be active');
    const source=await seedPersistedIntake({pool:f.pool,text:'SSE新增待判断分组的合成报修。'});await f.processReviewIntake(source.intakeId);
    const review=(await f.pool.query('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[source.intakeId])).rows[0];assert.ok(review);
    await f.runtime.realtimeProjector.runOnce();
    await browser.waitFor("document.querySelector('.range-bar')?.textContent.includes('已加载 16 项')&&Boolean(document.querySelector('.board-column.pending [data-item-id=\""+review.id+"\"]'))");
    const current=await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>n.dataset.itemId)");assert.equal(current[current.indexOf(initial[1])+1],review.id);
    assert.equal(await browser.evaluate("document.querySelector('.board-column.pending .ds-column-sort').disabled"),true,'freeze must remain active after the real SSE reread');
    assert.equal(await browser.evaluate("location.pathname.split('/').at(-1)"),initial[1]);
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=下一项]');
    await browser.waitFor("location.pathname.split('/').at(-1)!=="+JSON.stringify(initial[1]));
    assert.equal(await browser.evaluate("location.pathname.split('/').at(-1)"),review.id,'next follows the new rendered group member');
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=上一项]');
    await browser.waitFor("location.pathname.split('/').at(-1)==="+JSON.stringify(initial[1]));
    assert.deepEqual(current.filter(id=>id!==review.id),initial,'the original group order stays stable');
  }catch(failure){error=failure;}finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
},{workbenchRealtimeEnabled:true,manualProjection:true}));

test('v2.1 board summary, sorting and intake groups only filter loaded authorized HTTP data',{timeout:120000},async()=>{
  await withWeb01Fixture(async f=>{
    const extra=await seedPersistedIntake({pool:f.pool,text:'卡10分组边界的全新合成材料，请判断。'});await f.processReviewIntake(extra.intakeId);
    const posts=[],reads=[];
    const observe=req=>{const path=new URL(req.url??'/',f.origin).pathname;if(req.method==='POST')posts.push(path);if(path==='/api/workbench/board')reads.push(path);};
    f.runtime.server.on('request',observe);let browser,error;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...f.browserCookies[0],url:f.origin}]});assert.ok(browser);
      await browser.command('Page.bringToFront');
      await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await browser.waitFor("document.querySelectorAll('.ticket-card').length===9&&document.querySelector('[data-summary-filter=mine]')?.getAttribute('aria-disabled')==='false'");
      const pages=await Promise.all(['pending','active','closed'].map(async column=>{const response=await fetch(f.origin+'/api/workbench/board?column='+column+'&range=recent',{headers:{cookie:f.cookies[0]}});assert.equal(response.status,200);return response.json();}));
      const loaded=pages.flatMap(page=>page.items),mine=loaded.filter(item=>item.attention.related_reasons.includes('HANDLING'));
      const initialReads=reads.length;
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=pending] .ds-summary-value').textContent"),String(pages[0].items.length));
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=mine] .ds-summary-value').textContent"),String(mine.length));
      assert.ok(mine.length>0);
      assert.equal(await browser.evaluate("[...document.querySelectorAll('[data-summary-filter]')].every(n=>n.title.includes('基于已加载的 '+"+loaded.length+"+' 项'))"),true);
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=overdue]').title.includes('处理中暂未计入')"),true);
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=pending]').getAttribute('aria-label')"),'待受理 '+pages[0].items.length);
      assert.equal(await browser.evaluate("document.querySelectorAll('[data-board-group=待接单] .ticket-card').length"),1,'three-or-more intakes cannot starve the nonempty Ticket group');
      await clickWorkbenchControl(browser,'[data-summary-filter=pending]');
      await browser.waitFor("document.querySelector('[data-summary-filter=pending]').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('.board-column.active .ticket-card,.board-column.closed .ticket-card').length===0");
      await browser.waitFor("getComputedStyle(document.querySelector('[data-summary-filter=pending]')).borderColor==='rgb(37, 99, 201)'");
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('[data-summary-filter=pending]')).borderColor"),'rgb(37, 99, 201)','selected border survives the pointer hover after a real click');
      assert.equal(await browser.evaluate("location.search"),'','local summary does not replace server query criteria');
      await clickWorkbenchControl(browser,'[data-summary-filter=pending]');
      await browser.waitFor("document.querySelectorAll('.ticket-card').length===9");
      await clickWorkbenchControl(browser,'[data-board-group=待判断] .ds-board-group-trigger');
      await browser.waitFor("document.querySelector('[data-board-group=待判断] .ds-board-group-trigger').getAttribute('aria-expanded')==='false'");
      await browser.waitFor("[...document.querySelectorAll('[data-board-group=待判断] .ticket-card')].every(n=>!n.checkVisibility())");
      assert.equal(await browser.evaluate("[...document.querySelectorAll('[data-board-group=待判断] .ticket-card')].every(n=>!n.checkVisibility())"),true);
      await browser.evaluate("document.querySelector('[data-board-group=待判断] .ds-board-group-trigger').focus()");
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
      await browser.waitFor("document.querySelector('[data-board-group=待判断] .ds-board-group-trigger').getAttribute('aria-expanded')==='true'");
      await clickWorkbenchControl(browser,'.board-column.pending [data-action=expand-column]');
      assert.equal(await browser.evaluate("[...document.querySelectorAll('[data-board-group=待判断] .ticket-card')].every(n=>n.dataset.kind!=='ticket')&&[...document.querySelectorAll('[data-board-group=待接单] .ticket-card')].every(n=>n.dataset.kind==='ticket')"),true);
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.card-tags .ds-tag')].some(n=>['待判断','待接单'].includes(n.textContent))"),false);
      await clickWorkbenchControl(browser,'.board-column.closed .ds-column-sort');
      await browser.waitFor("Boolean(document.querySelector('[role=menu][aria-label=已处理排序方式]'))");
      await clickWorkbenchControl(browser,'[role=menu] [data-key=newest]');
      await browser.waitFor("document.querySelector('.board-column.closed .ds-column-sort').textContent.includes('最新到达')");
      const expected=pages[2].items.toSorted((a,b)=>a.completed_at===null?1:b.completed_at===null?-1:b.completed_at.localeCompare(a.completed_at)).slice(0,3).map(item=>item.id);
      assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].map(n=>n.dataset.itemId)"),expected);
      await clickWorkbenchControl(browser,'[data-summary-filter=mine]');
      await browser.waitFor("document.querySelector('[data-summary-filter=mine]').getAttribute('aria-pressed')==='true'");
      assert.deepEqual((await browser.evaluate("[...document.querySelectorAll('.ticket-card')].map(n=>n.dataset.itemId)")).sort(),mine.map(item=>item.id).sort());
      await clickWorkbenchControl(browser,'.view-tabs button[aria-pressed=false]');
      await browser.waitFor("Boolean(document.querySelector('.work-table'))");
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=mine]').getAttribute('aria-pressed')"),'true');
      assert.equal(await browser.evaluate("document.querySelectorAll('.work-table tbody tr').length"),mine.length);
      assert.equal(reads.length,initialReads,'summary, sorting, grouping and view changes reuse loaded queries');
      assert.deepEqual(posts,[],'presentation controls never POST a business command');
    }catch(failure){error=failure;}finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
  },{workbenchFollowEnabled:true});
  await withWeb01Fixture(async f=>{
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:900,height:1080,cookies:[{...f.browserCookies[0],url:f.origin}]});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-action=new-report] kbd'))&&document.querySelectorAll('.ticket-card').length===9");
      assert.equal(await browser.evaluate("document.querySelector('[data-action=new-report] kbd').textContent"),'N');
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=mine]').getAttribute('aria-disabled')"),'true');
      assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=mine] .ds-summary-value').textContent"),'—');
      await assertWorkbenchPrimaryActions(browser);
      assert.equal(await browser.evaluate("document.querySelectorAll('[data-tone=primary]').length"),1);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth"),false);
    }catch(failure){error=failure;}finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
  },{workbenchManualReportsEnabled:true});
});

for(const realtime of [false,true])test('v2.1 displayed order drives detail navigation; SSE='+realtime,{timeout:120000},()=>withWeb01Fixture(async f=>{
  let browser,error;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...f.browserCookies[0],url:f.origin}]});assert.ok(browser);
    await browser.waitFor("document.querySelectorAll('.ticket-card').length===9&&document.querySelector('.range-bar')?.textContent.includes('已加载 15 项')");
    const before=await browser.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].map(n=>n.dataset.itemId)");assert.equal(before.length,3);
    const card='.board-column.closed [data-item-id="'+before[1]+'"] .card-open';
    await clickWorkbenchControl(browser,card);await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
    assert.equal(await browser.evaluate("document.querySelector('.board-column.closed .ds-column-sort').disabled"),realtime,'only SSE detail activates the existing order freeze');
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].map(n=>n.dataset.itemId)"),before,'opening a detail freezes the displayed sort, not server order');
    const previousTitle=await browser.evaluate("document.querySelector('.detail-dialog #detail-title').textContent");
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=下一项]');
    await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title')?.textContent)&&document.querySelector('.detail-dialog #detail-title').textContent!=="+JSON.stringify(previousTitle));
    assert.equal(await browser.evaluate("location.pathname.split('/').at(-1)"),before[2],'next opens the item below the selected card');
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=上一项]');
    await browser.waitFor("location.pathname.split('/').at(-1)==="+JSON.stringify(before[1]));
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].map(n=>n.dataset.itemId)"),before);
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=关闭详情]');
    await browser.waitFor("!document.querySelector('.detail-dialog')");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].map(n=>n.dataset.itemId)"),before);
    await clickWorkbenchControl(browser,'[data-summary-filter=pending]');
    const pending=await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>n.dataset.itemId)");assert.equal(pending.length,3);
    await clickWorkbenchControl(browser,'.board-column.pending [data-item-id="'+pending[1]+'"] .card-open');
    await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=下一项]');
    await browser.waitFor("location.pathname.split('/').at(-1)==="+JSON.stringify(pending[2]));
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=上一项]');
    await browser.waitFor("location.pathname.split('/').at(-1)==="+JSON.stringify(pending[1]));
  }catch(failure){error=failure;}finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
},{workbenchRealtimeEnabled:realtime}));

test('open workbench filters stay inside content bounds with reachable search and date controls',{timeout:120000},()=>withWeb01Fixture(async f=>{
  const directory=join(tmpdir(),'toolbar-filter-'+randomUUID());await mkdir(directory);const samples=[],screenshots=[],writes=[];
  const observe=request=>{if(request.method==='POST')writes.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);let browser,error;
  try{const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:900,cookies:[{...cookie,url:f.origin}]});assert.ok(browser);await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    for(const collapsed of [false,true])for(const mode of ['board','search']){
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:900,deviceScaleFactor:1,mobile:false});await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'+(mode==='search'?'?search=1':'')});await browser.waitFor('Boolean(document.querySelector(".ds-toolbar-filters>summary"))');
      if((await browser.evaluate("document.querySelector('.app').classList.contains('sidebar-collapsed')"))!==collapsed)await clickWorkbenchControl(browser,'.topbar button[aria-label="收起侧栏"]');
      await clickWorkbenchControl(browser,'.ds-toolbar-filters>summary');
      if(await browser.evaluate("Boolean(document.querySelector('.workbench-search .workbench-disclosure-trigger[aria-expanded=false]'))"))await clickWorkbenchControl(browser,'.workbench-search .workbench-disclosure-trigger');
      for(const width of [1920,1440,1280,1000,900,600,390]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const sample=await browser.evaluate(`(()=>{const n=document.querySelector('.ds-toolbar-filter-content'),r=n.getBoundingClientRect(),t=document.querySelector('.ds-toolbar').getBoundingClientRect();return {width:${width},mode:${JSON.stringify(mode)},collapsed:${collapsed},left:r.left,right:r.right,toolbarLeft:t.left,toolbarRight:t.right,panelOverflow:n.scrollWidth>n.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>${width}+1};})()`);
        assert.ok(sample.left>=0&&sample.right<=width+1);assert.ok(Math.abs(sample.left-sample.toolbarLeft)<=1&&sample.right<=sample.toolbarRight+1);assert.equal(sample.panelOverflow,false);assert.equal(sample.pageOverflow,false);samples.push(sample);
        const reachable=await browser.evaluate(`(()=>{const panel=document.querySelector('.ds-toolbar-filter-content'),items=[...panel.querySelectorAll('input:not([type=hidden]):not(:disabled),button:not(:disabled),[role=spinbutton]')].filter(n=>{const r=n.getBoundingClientRect();return n.checkVisibility()&&r.width>8&&r.height>8;});return items.length>0;})()`);assert.equal(reachable,true);
        await browser.evaluate("(()=>{const p=document.querySelector('.ds-toolbar-filter-content'),a=[...p.querySelectorAll('button:not(:disabled)')].filter(n=>n.checkVisibility());a.at(-1)?.scrollIntoView({block:'nearest',inline:'nearest'});})()");
        try{await browser.waitFor(`(async()=>{const p=document.querySelector('.ds-toolbar-filter-content'),n=[...p.querySelectorAll('button:not(:disabled)')].filter(n=>n.checkVisibility()).at(-1);if(!n)return false;n.scrollIntoView({block:'nearest',inline:'nearest'});const before=n.getBoundingClientRect();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!n.isConnected)return false;const r=n.getBoundingClientRect();if(['x','y','width','height'].some(key=>before[key]!==r[key]))return false;return r.left>=0&&r.right<=${width}+1&&r.top>=0&&r.bottom<=innerHeight+1&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);}catch(failure){console.log('WORKBENCH_FILTER_HIT_FAILURE '+JSON.stringify({width,mode,collapsed,geometry:await browser.evaluate("(()=>{const p=document.querySelector('.ds-toolbar-filter-content'),n=[...p.querySelectorAll('button:not(:disabled)')].filter(n=>n.checkVisibility()).at(-1),r=n?.getBoundingClientRect(),h=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return {panel:p.getBoundingClientRect().toJSON(),scrollTop:p.scrollTop,scrollHeight:p.scrollHeight,button:r?.toJSON(),hitTag:h?.tagName,hitClass:h?.className,innerWidth,innerHeight};})()")}));throw failure;}
        assert.equal(await browser.evaluate(`(()=>{const p=document.querySelector('.ds-toolbar-filter-content'),n=[...p.querySelectorAll('button:not(:disabled)')].filter(n=>n.checkVisibility()).at(-1),r=n?.getBoundingClientRect();return Boolean(r&&r.left>=0&&r.right<=${width}+1&&r.top>=0&&r.bottom<=innerHeight+1&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)));})()`),true,'last filter/date action is visible and unobstructed at '+width);
        if(!collapsed&&[1920,1440,1280,900,600,390].includes(width)){const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'filters-'+mode+'-'+width+'.png');await writeFile(file,bytes);screenshots.push({file,width,height:900,sha256:createHash('sha256').update(bytes).digest('hex')});}
      }
    }
    assert.deepEqual(writes,[],'opening and navigating filter controls never posts business commands');console.log('WORKBENCH_FILTER_VIEWPORTS '+JSON.stringify({samples,screenshots}));
  }catch(failure){error=failure;}finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
},{workbenchSearchEnabled:true,workbenchFollowEnabled:true,sourceGroupDirectoryEnabled:true}));

test('source group name editing keeps an exact version basis, reconciles the original unknown command, and fences revoked ADMIN authority',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,pool})=>{
    const read=async path=>{const r=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(r.status,200);return r.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap'),itemPath='/api/workbench/items/ticket/'+tickets[0].ticket.id,ref=(await read(itemPath)).item.source_group.ref;
    const post=async body=>{const r=await fetch(origin+'/api/workbench/source-groups/'+ref+'/name',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
    await post({client_command_id:randomUUID(),expected_row_version:'0',display_name:'T23初始名称'});
    // A synthetic BIGINT fixture proves the browser never narrows the source-group version to a Ticket number.
    await pool.query('UPDATE workbench.source_group_name SET row_version=9007199254740993 WHERE ref=$1',[ref]);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/settings/source-groups?q='+ref,width:1920,height:1080,cookies:[browserCookies[0]]});
      await browser.waitFor('document.querySelectorAll("[data-source-group-ref]").length===1');
      await browser.evaluate('document.querySelector("[data-action=edit-source-group]").click()');
      await browser.waitFor('document.querySelector(".source-group-version")?.textContent.includes("9007199254740993")');
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t23Commands=[];globalThis.__t23Statuses=[];globalThis.__t23InvalidSuccess=true;globalThis.__t23InvalidDenial=false;globalThis.fetch=async(path,options)=>{if(!String(path).includes('/api/workbench/source-groups/')||!String(path).endsWith('/name'))return original(path,options);globalThis.__t23Commands.push({body:JSON.parse(options.body),match:options.headers['if-match'],key:options.headers['idempotency-key']});const response=await original(path,options);globalThis.__t23Statuses.push(response.status);if(response.status===200&&globalThis.__t23InvalidSuccess){globalThis.__t23InvalidSuccess=false;await response.text();return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}});}if(response.status===403&&globalThis.__t23InvalidDenial){await response.text();return new Response('{',{status:403,headers:{'content-type':'application/json'}});}return response;};})()`);
      const change=async value=>{await browser.evaluate(`(()=>{const input=document.querySelector('input[name="source-group-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
      await change('T23未知结果名称');await browser.evaluate('document.querySelector("form[aria-label=维护来源群名称]").requestSubmit()');
      await browser.waitFor('globalThis.__t23Statuses.length===1');
      assert.equal((await read(itemPath)).item.source_group.row_version,'9007199254740994');
      await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("结果未知")');
      assert.equal(await browser.evaluate('document.querySelector("input[name=source-group-name]").disabled'),true);
      assert.equal(await browser.evaluate('document.querySelector("[data-action=search-source-groups]").disabled'),true);
      await browser.evaluate('document.querySelector("aside a[title=工作台]").click()');
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/settings/source-groups','UNKNOWN must not silently lose its original command through the sidebar');
      assert.ok(await browser.evaluate('document.querySelector(".source-group-save-state")?.textContent.includes("结果未知")'));
      await openWorkbenchUserMenu(browser);await browser.evaluate('document.querySelector("[data-action=open-settings]").click()');
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.equal(await browser.evaluate('location.search'),'?q='+ref,'the settings link must preserve the selected UNKNOWN command and its directory');
      await browser.evaluate('document.querySelector("[data-action=check-source-group-name]").click()');
      await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("已保存")');
      await browser.waitFor('document.querySelector("input[name=source-group-name]")?.disabled===false&&document.querySelector(".source-group-version")?.textContent.includes("9007199254740994")');
      const firstCommands=await browser.evaluate('globalThis.__t23Commands');assert.equal(firstCommands.length,2);assert.deepEqual(firstCommands[1],firstCommands[0]);
      assert.equal(firstCommands[0].body.expected_row_version,'9007199254740993');assert.equal(firstCommands[0].match,'"9007199254740993"');assert.equal(firstCommands[0].key,firstCommands[0].body.client_command_id);
      assert.equal((await read(itemPath)).item.source_group.row_version,'9007199254740994');
      await change('T23冲突后仍保留我的名称');
      await post({client_command_id:randomUUID(),expected_row_version:'9007199254740994',display_name:'T23同事的新名称'});
      await browser.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("重新读取目录")).click()');
      await browser.waitFor('document.querySelector("[data-source-group-ref]")?.textContent.includes("T23同事的新名称")');
      assert.ok(await browser.evaluate('document.querySelector(".source-group-version").textContent.includes("9007199254740994")'));
      await browser.evaluate('document.querySelector("form[aria-label=维护来源群名称]").requestSubmit()');
      await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("冲突")');
      await browser.waitFor('Boolean(document.querySelector("[data-action=refresh-source-group]"))&&document.querySelector("input[name=source-group-name]")?.disabled===false');
      assert.equal(await browser.evaluate('document.querySelector("input[name=source-group-name]").value'),'T23冲突后仍保留我的名称');
      assert.equal(await browser.evaluate('globalThis.__t23Commands.length'),3);
      assert.equal((await read(itemPath)).item.source_group.display_name,'T23同事的新名称');
      await browser.evaluate('document.querySelector("[data-action=refresh-source-group]").click()');
      await browser.waitFor('document.querySelector(".source-group-version")?.textContent.includes("9007199254740995")');
      assert.equal(await browser.evaluate('document.querySelector("input[name=source-group-name]").value'),'T23冲突后仍保留我的名称');
      await browser.evaluate('document.querySelector("form[aria-label=维护来源群名称]").requestSubmit()');
      await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("已保存")&&globalThis.__t23Commands.length===4');
      await browser.waitFor('document.querySelector("input[name=source-group-name]")?.disabled===false&&document.querySelector(".source-group-version")?.textContent.includes("9007199254740996")');
      const commands=await browser.evaluate('globalThis.__t23Commands');assert.equal(commands[2].body.expected_row_version,'9007199254740994');assert.equal(commands[3].body.expected_row_version,'9007199254740995');assert.notEqual(commands[3].body.client_command_id,commands[2].body.client_command_id);
      assert.equal((await read(itemPath)).item.source_group.row_version,'9007199254740996');
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
      await browser.evaluate('globalThis.__t23InvalidDenial=true');await change('T23拒绝后必须清理的输入');
      await browser.evaluate('document.querySelector("form[aria-label=维护来源群名称]").requestSubmit()');
      await browser.waitFor('document.body.innerText.includes("来源群目录仅管理员可维护")');
      assert.equal(await browser.evaluate('document.querySelectorAll("[data-source-group-ref]").length'),0);assert.equal(await browser.evaluate('Boolean(document.querySelector("form[aria-label=维护来源群名称]"))'),false);
      assert.equal(await browser.evaluate('document.body.innerText.includes("T23拒绝后必须清理的输入")'),false);
      assert.deepEqual(await browser.evaluate('globalThis.__t23Statuses'),[200,200,409,200,403]);
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/settings/source-groups?q='+ref});
      await browser.waitFor('document.querySelectorAll("[data-source-group-ref]").length===1');await browser.evaluate('document.querySelector("[data-action=edit-source-group]").click()');
      await browser.waitFor('Boolean(document.querySelector("[data-action=refresh-source-group]"))');await change('T23读取失权时须清理的输入');
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
      await browser.evaluate('document.querySelector("[data-action=refresh-source-group]").click()');
      await browser.waitFor('document.body.innerText.includes("来源群目录仅管理员可维护")');
      assert.equal(await browser.evaluate('document.querySelectorAll("[data-source-group-ref]").length'),0);assert.equal(await browser.evaluate('Boolean(document.querySelector("form[aria-label=维护来源群名称]"))'),false);
      assert.equal(await browser.evaluate('document.body.innerText.includes("T23读取失权时须清理的输入")'),false);
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+tickets[0].ticket.id+'?detail=page'});
      await browser.waitFor('Boolean(document.querySelector("input[name=source-group-name]"))');
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t23DetailCommands=[];globalThis.__t23DropDetailSuccess=true;globalThis.fetch=async(path,options)=>{if(!String(path).includes('/api/workbench/source-groups/')||!String(path).endsWith('/name'))return original(path,options);globalThis.__t23DetailCommands.push(JSON.parse(options.body));const response=await original(path,options);if(response.status===200&&globalThis.__t23DropDetailSuccess){globalThis.__t23DropDetailSuccess=false;await response.text();return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}});}return response;};})()`);
      await change('T23详情未知结果名称');await browser.evaluate('document.querySelector("form[aria-label=维护来源群名称]").requestSubmit()');
      await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("结果未知")');
      await browser.evaluate('document.querySelector("aside a[title=工作台]").click()');
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/items/ticket/'+tickets[0].ticket.id,'detail UNKNOWN must survive sidebar navigation attempts');
      await openWorkbenchUserMenu(browser);await browser.evaluate('document.querySelector("[data-action=open-settings]").click()');
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/items/ticket/'+tickets[0].ticket.id);
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
      await openWorkbenchUserMenu(browser);
      await browser.evaluate('document.querySelector("[data-action=open-settings]").click()');
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/items/ticket/'+tickets[0].ticket.id,'compact settings must preserve detail UNKNOWN');
      await browser.evaluate('document.querySelector("[data-action=check-source-group-name]").click()');await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("已保存")');
      const detailCommands=await browser.evaluate('globalThis.__t23DetailCommands');assert.equal(detailCommands.length,2);assert.deepEqual(detailCommands[1],detailCommands[0]);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',source_group_command_basis:true,screenshots:[]}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,commands:globalThis.__t23Commands,statuses:globalThis.__t23Statuses})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    if(!error)await import('node:fs/promises').then(fs=>fs.rmdir(directory));
  },{sourceGroupDirectoryEnabled:true});
});

test('the default-off source group settings stays closed without requesting directory storage',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,runtime})=>{
    const requests=[];runtime.server.on('request',request=>{if(request.url?.startsWith('/api/workbench/source-groups'))requests.push(request.url);});
    let browser,error;
    try{browser=await launchSystemBrowser({url:origin+'/workbench/app/settings/source-groups',width:900,height:900,cookies:[browserCookies[0]]});await browser.waitFor('document.body.innerText.includes("来源群目录未开放")');assert.equal(requests.length,0);assert.equal(await browser.evaluate('document.querySelectorAll("[data-source-group-ref]").length'),0);assert.equal(await browser.evaluate('Boolean(document.querySelector("form[aria-label=维护来源群名称]"))'),false);}
    catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  });
});

test('administrator source group settings searches the real directory across pages and keeps same-name identities separate',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,pool})=>{
    for(let index=0;index<56;index++)await seedPersistedIntake({pool,text:'T23有界目录合成材料'+index,status:'WAITING_DESCRIPTION'});
    const read=async path=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(response.status,200);return response.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap'),refs=[];
    for(const ticket of tickets.slice(0,2)){
      const item=(await read('/api/workbench/items/ticket/'+ticket.ticket.id)).item;refs.push(item.source_group.ref);
      const command={client_command_id:randomUUID(),expected_row_version:'0',display_name:'T23同名支持群'};
      const saved=await fetch(origin+'/api/workbench/source-groups/'+item.source_group.ref+'/name',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"0"'},body:JSON.stringify(command)});assert.equal(saved.status,200);
    }
    assert.notEqual(refs[0],refs[1]);
    const before=await read('/api/tickets/'+tickets[0].ticket.id),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    let browser,error;const screenshots=[];
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1920,height:1080,cookies:[browserCookies[0]]});
      await openWorkbenchUserMenu(browser);
      await browser.evaluate('document.querySelector("[data-action=open-settings]").click()');await browser.waitFor('Boolean(document.querySelector(".workbench-settings"))');await browser.evaluate('document.querySelector("[data-action=open-source-groups]").click()');
      await browser.waitFor('document.querySelectorAll("[data-source-group-ref]").length===50');
      assert.ok(await browser.evaluate('document.body.innerText.includes("群名称未登记")'));
      await browser.evaluate('document.querySelector("[data-action=next-source-groups]").click()');
      await browser.waitFor('document.querySelector("[data-source-group-page]")?.textContent.includes("第 2 页")&&document.querySelectorAll("[data-source-group-ref]").length>0&&document.querySelectorAll("[data-source-group-ref]").length<50');
      await browser.evaluate('document.querySelector("[data-action=previous-source-groups]").click()');
      await browser.waitFor('document.querySelector("[data-source-group-page]")?.textContent.includes("第 1 页")&&document.querySelectorAll("[data-source-group-ref]").length===50');
      await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="检索来源群"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'T23同名');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.evaluate('document.querySelector("[data-action=search-source-groups]").click()');
      await browser.waitFor('document.querySelectorAll("[data-source-group-ref]").length===2');
      assert.deepEqual(new Set(await browser.evaluate('[...document.querySelectorAll("[data-source-group-ref]")].map(row=>row.dataset.sourceGroupRef)')),new Set(refs));
      await browser.evaluate(`document.querySelector('[data-source-group-ref="${refs[0]}"] [data-action=edit-source-group]').click()`);
      await browser.waitFor('Boolean(document.querySelector("input[name=source-group-name]"))');
      const literal='<img src=x onerror=alert(1)>T23资料';
      await browser.evaluate(`(()=>{const input=document.querySelector('input[name="source-group-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(literal)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.evaluate('document.querySelector("form[aria-label=维护来源群名称]").requestSubmit()');
      await browser.waitFor('document.querySelector(".source-group-save-state")?.textContent.includes("已保存")');
      const current=(await read('/api/workbench/items/ticket/'+tickets[0].ticket.id)).item;
      assert.equal(current.source_group.ref,refs[0]);assert.equal(current.source_group.display_name,literal);assert.equal(current.source_group.row_version,'2');
      const after=await read('/api/tickets/'+tickets[0].ticket.id);assert.equal(after.status,before.status);assert.equal(after.version,before.version);
      assert.equal(await browser.evaluate('document.querySelectorAll(".source-group-directory img").length'),0);
      await browser.waitFor('document.querySelectorAll("[data-source-group-ref]").length===1');
      const capture=async(name)=>{const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
      await capture('new-list-1920.png');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await capture('new-list-900.png');
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:-1,uploadThroughput:-1});
      await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="检索来源群"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'T23没有匹配的全新名称');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.evaluate('document.querySelector("[data-action=search-source-groups]").click()');
      await browser.waitFor('document.body.innerText.includes("正在读取来源群目录")');
      await browser.waitFor('document.body.innerText.includes("未找到匹配来源群")');assert.equal(await browser.evaluate('document.querySelectorAll("[data-source-group-ref]").length'),0);
      await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
      await browser.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("重新读取目录")).click()');
      await browser.waitFor('document.body.innerText.includes("目录读取失败")');assert.equal(await browser.evaluate('document.body.innerText.includes("未找到匹配来源群")'),false);
      await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await browser.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("重新读取目录")).click()');await browser.waitFor('document.body.innerText.includes("未找到匹配来源群")');
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/settings/source-groups'});
      await browser.waitFor('document.body.innerText.includes("来源群目录仅管理员可维护")');
      assert.equal(await browser.evaluate('document.querySelectorAll("[data-source-group-ref]").length'),0);
      assert.equal(await browser.evaluate('Boolean(document.querySelector("form[aria-label=维护来源群名称]"))'),false);
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+tickets[0].ticket.id+'?detail=page'});
      await browser.waitFor(`document.querySelector('.properties')?.innerText.includes(${JSON.stringify(literal)})`);
      assert.equal(await browser.evaluate('Boolean(document.querySelector("form[aria-label=维护来源群名称]"))'),false);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',source_group_directory:true,screenshots}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{sourceGroupDirectoryEnabled:true});
});

test('a real object denial clears cached note actions even when the rejection body is unreadable',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,pool})=>{
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page',width:1920,height:1080,cookies:[browserCookies[0]]});
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"内部备注\"]'))");
      await browser.evaluate("(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T02 denied synthetic note');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.body.innerText.includes('找不到这条事项，或您目前无法查看')&&!document.querySelector('[aria-label=\"内部备注\"]')");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-allowed-actions'))"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('结果未知')"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('仅供内部的合成处理记录')"),false);
    }catch(failure){error=failure;try{console.log('T02_DENIAL_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText})"):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
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
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t02Commands=[];const responseGate=new Promise(resolve=>globalThis.__t02ReleaseResponse=resolve);globalThis.fetch=async(path,options)=>{const isNote=String(path).endsWith('/internal-notes');if(isNote)globalThis.__t02Commands.push(JSON.parse(options.body));try{const response=await original(path,options);if(isNote)await responseGate;return response;}catch(error){if(isNote)await responseGate;throw error;}};const input=document.querySelector('[aria-label="内部备注"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T02 bundle synthetic canary');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:false,latency:250,downloadThroughput:-1,uploadThroughput:-1});
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('正在保存')");
      assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]').disabled"),true);
      await browser.evaluate("globalThis.__t02ReleaseResponse()");
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
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate("({text:document.body.innerText,commands:globalThis.__t02Commands})")));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
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
      await browser.waitFor("(document.body.innerText.includes('会话已失效')||document.body.innerText.includes('当前账号无法查看工作台'))&&!document.querySelector('textarea')&&!document.querySelector('.sidebar')");
      const statuses=await browser.evaluate('globalThis.__t02PostStatuses');assert.equal(statuses.length,3);assert.deepEqual(statuses.slice(0,2),[409,200]);assert.ok([401,403].includes(statuses[2]));
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-allowed-actions')||document.querySelector('#detail-title'))"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('仅供内部的合成处理记录')"),false);
    }catch(failure){error=failure;try{console.log('T02_EXPIRY_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText,statuses:globalThis.__t02PostStatuses,inFlight:globalThis.__t02InFlight})"):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
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
        await assertWorkbenchPrimaryActions(browser);
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
      assert.deepEqual(await browser.evaluate("(()=>{const card=document.querySelector('.ticket-card'),main=document.querySelector('h1');return {border:getComputedStyle(card).borderWidth,titleSize:getComputedStyle(main).fontSize,text:getComputedStyle(main).color,columns:getComputedStyle(document.querySelector('.board')).gridTemplateColumns.split(' ').length}})()"),{border:'0px',titleSize:'24px',text:'rgb(55, 53, 47)',columns:3});
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.ticket-card')].every(card=>card.querySelector('.ds-ticket-body')?.children.length===4&&card.querySelector('.card-meta .ds-source-label')&&!card.querySelector('.card-tags .ds-source-label'))"),true,'four rows and neutral source metadata');
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.ticket-card')].every(card=>[...card.querySelectorAll('.card-tags .ds-tag[data-tone]')].filter(tag=>tag.dataset.tone!=='neutral').length<=2)"),true,'at most two colored action tags');
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.ticket-card .card-tags')].some(tags=>['待接单','处理中','已关闭'].some(label=>[...tags.querySelectorAll('.ds-tag')].some(tag=>tag.textContent===label)))"),false,'card does not repeat its column stage');
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.board-column')].every(column=>getComputedStyle(column).backgroundColor==='rgb(244, 243, 239)'&&column.querySelector('.column-heading .ds-status-dot')&&getComputedStyle(column.querySelector('.stage-pill')).backgroundColor==='rgba(0, 0, 0, 0)')"),true,'v2.1 warm neutral columns with dot status headings');
      await capture('new-board-1920.png');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await capture('new-board-1280.png');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
      await expandAll();await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.ticket-card .card-tags .ds-tag')].some(tag=>tag.textContent==='待确认'&&tag.title==='已解决待确认')"),true,'resolved remains a distinct substatus after regrouping');
      const id=tickets[5].ticket.id;
      await browser.evaluate(`(()=>{const link=document.querySelector('[data-item-id="${id}"] .card-open');link.focus();link.click();})()`);
      await browser.waitFor(`document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'`);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog'))"),true);
      await browser.waitFor("document.querySelector('.detail-dialog')?.contains(document.activeElement)===true");
      assert.equal(await browser.evaluate("document.querySelector('.detail-dialog').contains(document.activeElement)"),true);
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),720);
      assert.ok(await browser.evaluate("document.querySelector('.detail-dialog').innerText.includes('仅供内部的合成处理记录')"));
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').focus()");
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});
      assert.equal(await browser.evaluate("document.querySelector('.detail-dialog').contains(document.activeElement)&&document.activeElement.getAttribute('aria-label')!=='关闭详情'&&document.activeElement.checkVisibility({checkVisibilityCSS:true})"),true);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
      assert.equal(await browser.evaluate("document.activeElement.getAttribute('aria-label')==='关闭详情'"),true);
      await browser.evaluate("document.querySelector('[aria-label=\"下一项\"]').click()");
      await browser.waitFor("document.querySelector('#detail-title')?.textContent==='PACS 调阅影像时加载缓慢'");
      await browser.evaluate("document.querySelector('[aria-label=\"上一项\"]').click()");
      await browser.waitFor("document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'");
      await capture('new-detail-1920.png');
      // CDP key/code without the virtual key generates keyCode=0 and does not
      // invoke the real Escape handler; use an actual Escape key.
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
      await browser.waitFor("!document.querySelector('.detail-dialog')");
      await browser.waitFor(`document.activeElement===document.querySelector('[data-item-id="${id}"] .card-open')`);
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('[data-item-id="${id}"] .card-open')`),true);
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('.detail-dialog')&&document.querySelector('#detail-title'))");
      await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:100,button:'left',clickCount:1});
      await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:100,button:'left',clickCount:1});
      await browser.waitFor("!document.querySelector('.detail-dialog')");
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('.detail-dialog')&&document.querySelector('#detail-title'))");
      await browser.evaluate("document.querySelector('[aria-label=\"展开完整页面\"]').click()");
      await browser.waitFor("Boolean(document.querySelector('.detail-page #detail-title'))&&!document.querySelector('.detail-dialog')");
      await browser.waitFor("document.activeElement?.id==='detail-title'");
      assert.equal(await browser.evaluate("document.activeElement.id==='detail-title'"),true);
      await capture('new-detail-page-1920.png');
      await reload();await browser.waitFor("Boolean(document.querySelector('.detail-page #detail-title'))");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("Boolean(document.querySelector('.board'))");
      await expandAll();await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("Boolean(document.querySelector('.detail-dialog')&&document.querySelector('#detail-title'))");
      await reload();await browser.waitFor(`document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'`);
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");await browser.waitFor("!document.querySelector('.detail-dialog')");
      await browser.evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.includes('列表')).click()");
      await browser.waitFor("document.querySelectorAll('tbody tr').length===9");
      await reload();await browser.waitFor("document.querySelectorAll('tbody tr').length===9");
      await capture('new-list-1920.png');
      await expandAll();await browser.waitFor("document.querySelectorAll('tbody tr').length===15");
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await capture('new-list-900.png');
      await browser.evaluate("document.querySelector('tbody tr a').click()");await browser.waitFor("Boolean(document.querySelector('.detail-dialog')&&document.querySelector('#detail-title'))");
      assert.equal(await browser.evaluate("document.querySelector('.detail-dialog').getBoundingClientRect().width<=innerWidth"),true);
      await capture('new-detail-900.png');
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
      await browser.waitFor('navigator.onLine===false');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.topbar .connection'))"),false,'connection state does not reintroduce the removed header label');
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新')).click()");
      await browser.waitFor("document.body.innerText.includes('连接失败')");
      await capture('new-offline-900.png');
      await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      // The existing test-auth port issues a distinct cookie name per principal.
      await browser.command('Network.deleteCookies',{name:browserCookies[0].name,url:origin});
      await browser.command('Network.setCookies',{cookies:[browserCookies[1]]});await reload();
      await browser.waitFor("document.body.innerText.includes('这里暂时没有工单')");assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-card').length"),0);
      await browser.evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.includes('看板')).click()");
      await browser.waitFor("Boolean(document.querySelector('.board-column.closed [data-action=view-earlier]'))");
      await browser.evaluate("document.querySelector('.board-column.closed [data-action=view-earlier]').click()");
      await browser.waitFor("new URLSearchParams(location.search).get('range')==='all'&&document.querySelector('.range-bar')?.textContent.includes('已加载 0 项')");
      assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-card').length"),0,'earlier shortcut reuses the existing all-date filter without widening READ');
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+id});
      await browser.waitFor("document.body.innerText.includes('找不到这条事项，或您目前无法查看')");
      await browser.command('Network.deleteCookies',{name:browserCookies[1].name,url:origin});
      await browser.command('Network.setCookies',{cookies:[browserCookies[0]]});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/'});await browser.waitFor("document.querySelectorAll('.ticket-card').length===9&&document.querySelector('.range-bar')?.textContent.includes('已加载 15 项')");
      assert.equal(await browser.evaluate("document.querySelector('.board').getBoundingClientRect().width<=innerWidth"),true);
      assert.equal(await browser.evaluate("(()=>{const board=document.querySelector('.board'),style=getComputedStyle(board),columns=style.gridTemplateColumns.split(' ').map(Number.parseFloat);return getComputedStyle(document.querySelector('.sidebar')).display==='none'&&columns.length===3&&columns.every(width=>width>=300)&&style.overflowX==='auto'&&board.scrollWidth>board.clientWidth;})()"),true,'v2 narrow board keeps three readable columns inside a horizontal scroller');
      await capture('new-board-900.png');
      await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.ticket-card')).transitionDuration==='0s'"),true);
      await expandAll();await browser.waitFor("document.querySelectorAll('.ticket-card').length===15");
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("document.querySelector('#detail-title')?.textContent==='住院部西区无线网络频繁断开'");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('.detail-dialog')");
      const access=createPilotAccessService({pool});
      await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
      // Count real requests, without changing their HTTP result or adding retries.
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__web01DenialReads=0;globalThis.fetch=(...args)=>{if(String(args[0]).startsWith('/api/workbench/items/ticket/${id}'))globalThis.__web01DenialReads++;return original(...args);};return true})()`);
      await browser.evaluate(`document.querySelector('[data-item-id="${id}"] .card-open').click()`);
      await browser.waitFor("document.body.innerText.includes('找不到这条事项，或您目前无法查看')&&document.querySelectorAll('.ticket-card').length===2");
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      assert.ok(await browser.evaluate('globalThis.__web01DenialReads<=2'),'a denied active query must not recreate and request in a loop');
      assert.equal(await browser.evaluate("document.querySelector('.detail-dialog').innerText.includes('仅供内部的合成处理记录')"),false);
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('.detail-dialog')");
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
      assert.ok(await browser.evaluate("document.querySelector('.detail-dialog').innerText.includes('群名称未登记')"));
      const change=async name=>{
        // Refreshed names can render while the previous save still awaits its refresh.
        await browser.waitFor("(()=>{const input=document.querySelector('input[name=\"source-group-name\"]');return input instanceof HTMLInputElement&&!input.disabled&&!input.matches(':disabled');})()");
        await browser.evaluate(`(()=>{const input=document.querySelector('input[name="source-group-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await browser.waitFor(`(()=>{const input=document.querySelector('input[name="source-group-name"]'),button=document.querySelector('[data-action="save-source-group-name"]');if(!(input instanceof HTMLInputElement)||input.disabled||input.value!==${JSON.stringify(name)}||!(button instanceof HTMLButtonElement)||button.disabled||button.matches(':disabled'))return false;button.click();return true;})()`);
        await browser.waitFor(`document.querySelector('.detail-dialog .properties')?.innerText.includes(${JSON.stringify('群聊报修 · '+name)})`);
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
      assert.equal(await browser.evaluate("document.querySelectorAll('.detail-dialog .properties img').length"),0);
      assert.equal((await pool.query('SELECT display_name FROM workbench.source_group_name')).rows[0].display_name,literal);
      await browser.waitFor("(()=>{const button=document.querySelector('[aria-label=\"关闭详情\"]');return button instanceof HTMLButtonElement&&!button.disabled&&!button.matches(':disabled');})()");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('.detail-dialog')");
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
    }catch(failure){error=failure;try{if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{sourceGroupDirectoryEnabled:true});
});
