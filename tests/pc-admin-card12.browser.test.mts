import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {clickWorkbenchControl,chooseWorkbenchSelect,typeWorkbenchDates} from './helpers/heroui-workbench-controls.mjs';
import {loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';
import {withWeb01Fixture,seedCard22Board,seedCard27Board,seedCard28Board} from './helpers/web01-workbench-fixture.mjs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {card22Filters,assertCard22Filters,assertCard22Avatars,captureCard22} from './helpers/card22-presentation.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import type {PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('Card 28 single table preserves read actions, grouped preferences and one-line search across Windows widths',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard28Board(f),directory=process.env.CARD28_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card28-list-'));await mkdir(directory,{recursive:true});
 const metrics:Record<string,unknown>={},screenshots:unknown[]=[],writes:string[]=[];
 const before=(await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,events=(await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows;
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST'&&!request.url?.startsWith('/api/workbench/search'))writes.push(request.url??'');};f.runtime.server.on('request',observe);
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?view=list&range=all',width:1440,height:1060,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.command('Page.bringToFront');
  const ready="document.querySelectorAll('.ds-work-table thead').length===1&&document.querySelectorAll('.ds-list-stage').length===3&&document.querySelectorAll('.ds-work-row').length>=8";
  await b.waitFor(ready);await b.waitFor("document.querySelector('[data-realtime-status=live]')!==null");await b.evaluate('document.fonts.ready');
  const click=async(selector:string)=>clickWorkbenchControl(b,selector);
  const settle=()=>b.waitFor("!document.querySelector('.workbench-search[aria-busy=true]')&&!document.querySelector('[role=option]')");
  const row=(id:string)=>'.ds-work-row[data-item-id="'+id+'"]';
  const capture=async(name:string,selector?:string)=>{
   await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
   let bytes:Buffer,clip:Record<string,number>|undefined;
   if(selector){await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);clip=await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),x=Math.max(0,Math.floor(r.left+scrollX)-2),y=Math.max(0,Math.floor(r.top+scrollY)-2);return {x,y,width:Math.ceil(r.right+scrollX)+2-x,height:Math.ceil(r.bottom+scrollY)+2-y,scale:2};})()`) as Record<string,number>;const shot=object(await b.command('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true}));bytes=Buffer.from(String(shot.data),'base64');}
   else bytes=Buffer.from(await b.screenshot(),'base64');
   if(clip){assert.equal(bytes.readUInt32BE(16),Number(clip.width)*2);assert.equal(bytes.readUInt32BE(20),Number(clip.height)*2);}
   const viewport=object(await b.evaluate('({platform:navigator.platform,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport.scale})'));if(process.platform==='win32')assert.equal(viewport.platform,'Win32');assert.equal(viewport.dpr,1);assert.equal(viewport.zoom,1);
   const file=join(directory,name+'.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex'),viewport,...(clip?{clip}:{})});
  };
  const sample=async()=>object(await b.evaluate(`(()=>{const table=document.querySelector('.ds-work-table'),rect=n=>n.getBoundingClientRect().toJSON(),handler=document.querySelector('[data-field-label=处理人]').closest('.ds-filter-chip'),closure=document.querySelector('[data-field-label=结束方式]').closest('.ds-filter-chip');return {columns:[...table.querySelectorAll('thead th')].map(n=>({text:n.textContent,...rect(n),background:getComputedStyle(n).backgroundColor,position:getComputedStyle(n.parentElement.parentElement).position})),rowHeights:[...table.querySelectorAll('.ds-work-row')].filter(n=>n.checkVisibility()).map(n=>rect(n).height),stageHeight:rect(table.querySelector('.ds-list-stage')).height,subgroupHeight:rect(table.querySelector('.ds-list-subgroup')).height,stage:rect(table.querySelector('.ds-list-stage .ds-status-badge')),stageStyle:(()=>{const s=getComputedStyle(table.querySelector('.ds-list-stage .ds-status-badge'));return {height:s.height,color:s.color,background:s.backgroundColor};})(),toolbar:rect(document.querySelector('.ds-board-toolbar-bottom')),chipGap:rect(closure).left-rect(handler).right,headers:table.querySelectorAll('thead').length,missing:table.innerText.includes('未提供'),leftEdges:[...table.querySelectorAll('.list-group')].map(n=>{const row=[...n.querySelectorAll('.ds-work-row')].find(n=>n.checkVisibility());return row?[...row.children].map(n=>rect(n).left):null;})};})()`));
  assert.equal(await b.evaluate("document.querySelectorAll('.ds-date-segments [aria-pressed=true]').length"),1,'all dates selects exactly one segment');metrics.dateAllSelected=true;
  metrics.groupControls=await b.evaluate("(()=>{const toggle=document.querySelector('.ds-list-stage-toggle'),more=document.querySelector('.ds-list-more button'),s=getComputedStyle(more);return {width:toggle.getBoundingClientRect().width,height:toggle.getBoundingClientRect().height,icon:toggle.querySelector('svg').getBoundingClientRect().width,moreSize:s.fontSize,morePadding:s.paddingLeft};})()");const groupControls=object(metrics.groupControls);assert.equal(groupControls.width,24);assert.equal(groupControls.height,24);assert.equal(groupControls.icon,14);assert.equal(groupControls.moreSize,'12px');assert.equal(groupControls.morePadding,'4px');
  metrics.initial=await sample();const initial=object(metrics.initial),columns=initial.columns;assert.ok(Array.isArray(columns));
  for(const [index,width]of [[0,192],[2,108],[3,124],[4,188],[5,124],[6,92]] as const)assert.ok(Math.abs(Number(object(columns[index]).width)-width)<=1,JSON.stringify(columns));
  assert.equal(object(columns[0]).height,36);assert.ok(Array.isArray(initial.rowHeights)&&initial.rowHeights.every(n=>n===44));assert.equal(initial.subgroupHeight,32);assert.equal(initial.chipGap,8);assert.equal(initial.headers,1);assert.equal(initial.missing,false);
  const firstEdges=(initial.leftEdges as unknown[]).filter(Boolean) as number[][];for(const edges of firstEdges)assert.deepEqual(edges,firstEdges[0]);
  assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-list-number')].every(n=>n.scrollWidth<=n.clientWidth+1)"),true);
  assert.ok(await b.evaluate("new Set([...document.querySelectorAll('.ds-ticket-category')].map(n=>n.dataset.category)).size>=4"));
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.pending[2]??'')+' .ds-list-reporter')})?.textContent`),'—');
  const ownerSample=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(row(ids.longOwner)+' .ds-list-owner-name')}),s=getComputedStyle(n),avatar=n.parentElement.querySelector('.ds-avatar');return {text:n.textContent,title:n.parentElement.title,width:n.clientWidth,scrollWidth:n.scrollWidth,height:n.clientHeight,scrollHeight:n.scrollHeight,font:s.fontSize,avatar:avatar.getBoundingClientRect().width,row:n.closest('tr').getBoundingClientRect().height};})()`));assert.equal(ownerSample.text,'阿卜杜拉艾合买提');assert.equal(ownerSample.title,ids.longOwnerName);assert.equal(ownerSample.font,'13px');assert.equal(ownerSample.avatar,20);assert.equal(ownerSample.row,44);// Card 29 L2: a long name stays on one line (ellipsis), the full name in title; the row stays 44px.
  assert.equal(ownerSample.height,20);assert.ok(Number(ownerSample.scrollHeight)<=Number(ownerSample.height));metrics.longOwner=ownerSample;

  await click('.ds-list-subgroup[data-board-group="已关闭"] button');await b.waitFor("document.querySelector('.ds-list-subgroup[data-board-group=已关闭] button').getAttribute('aria-expanded')==='true'");
  for(const selector of await b.evaluate("[...document.querySelectorAll('.ds-list-more [data-action=expand-column][aria-expanded=false]')].map(n=>'#'+n.closest('tr').id+' button')") as string[])await click(selector);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.completedIntake)+' .ds-list-status .ds-tag')}).textContent`),'已完成');assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.completedIntake)+' .ds-list-status .ds-tag')}).dataset.tone`),'success');
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.failedIntake)+' .ds-list-status .ds-tag')}).textContent`),'受理处理失败');assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.failedIntake)+' .ds-list-status .ds-tag')}).dataset.tone`),'danger');metrics.completedIntake='success';metrics.failedIntake='danger';
  const heat=await b.evaluate("[...document.querySelectorAll('.list-group[aria-label=待受理] .ds-ticket-heat')].map(n=>n.dataset.heatTone)");assert.ok(Array.isArray(heat)&&['danger','attention','neutral'].every(tone=>heat.includes(tone)));metrics.heatTones=heat;
  assert.match(String(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.pending[0]??'')+' .ds-list-tags')}).textContent`)),/催 2 次/u);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.duplicateWith)+' [data-closure-reason]')}).textContent`),'重复 · '+ids.duplicateOfRef);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.duplicate)+' [data-closure-reason]')}).textContent`),'重复报修');
  for(const width of [1440,1920]){await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await b.evaluate("document.querySelector('.ds-work-table-wrap').scrollTo(0,0)");await capture('list-'+width+'-all');}
  await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1060,deviceScaleFactor:1,mobile:false});
  await capture('group-x2','.ds-list-stage');await capture('subgroup-x2','.ds-list-subgroup');await capture('pending-heat-urge-x2',row(ids.pending[0]??''));
  for(const [name,id] of [['manual',ids.manual],['system',ids.system],['duplicate',ids.duplicateWith]] as const){const selector=row(id);await capture('closed-'+name+'-x2',selector);const value=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n.querySelector('.ds-ticket-category'));return {height:n.getBoundingClientRect().height,heat:n.querySelector('.ds-ticket-heat')!==null,filter:s.filter,opacity:s.opacity};})()`));assert.equal(value.height,44);assert.equal(value.heat,false);assert.equal(value.filter,'grayscale(1)');assert.equal(value.opacity,'0.55');metrics[name]=value;}
  await b.evaluate("document.querySelector('.ds-work-table-wrap').scrollTo(0,0)");
  const urgent=row(ids.pending[0]??'');await b.evaluate(`document.querySelector(${JSON.stringify(urgent)}).scrollIntoView({block:'center'})`);
  const hover=async(selector:string)=>{const point=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`));await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});};
  await hover(urgent);await b.waitFor(`document.querySelector(${JSON.stringify(urgent+' [data-board-claim-action]')})?.checkVisibility()===true`);assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(urgent+' kbd')})?.checkVisibility()`),true);await capture('hover-claim-x2',urgent);
  metrics.claimAction=await b.evaluate(`document.querySelector(${JSON.stringify(urgent+' [data-board-claim-action]')}).getAttribute('data-action')`);
  for(const selector of ['.ds-work-row[data-column=active]',row(ids.manual),'.ds-work-row[data-kind=review]']){await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await hover(selector);assert.equal(await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector+' [data-board-claim-action]')}))`),false,'only an eligible unassigned pending ticket may expose the existing claim action');assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(selector+' kbd')})?.checkVisibility()`),false,'the key hint follows the exact same eligibility');}
  const listOrder=await b.evaluate("[...document.querySelectorAll('.ds-work-row')].filter(n=>n.checkVisibility()).map(n=>({kind:n.dataset.kind,id:n.dataset.itemId,number:n.querySelector('.ds-list-number').textContent,closureKind:n.dataset.closureKind}))") as {kind:string;id:string;number:string;closureKind?:string}[];metrics.listOrder=listOrder;
  const waitDetail=(index:number)=>{const item=listOrder[index];assert.ok(item);return b.waitFor(`location.pathname.endsWith(${JSON.stringify('/'+item.kind+'/'+item.id)})&&document.querySelector('.ds-detail-position')?.textContent===${JSON.stringify((index+1)+' / '+listOrder.length)}&&document.querySelector('.detail-breadcrumb')?.textContent.includes(${JSON.stringify(item.number)})===true`);};
  // Tab/Enter use the original row-link; closing retains the selected row's original object.
  await b.evaluate(`document.querySelector(${JSON.stringify(urgent+' .row-link')}).focus()`);await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.waitFor("Boolean(document.querySelector('.detail-dialog'))");
  const selected=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(urgent)}),s=getComputedStyle(n.querySelector('th'));return {height:n.getBoundingClientRect().height,shadow:s.boxShadow,border:s.borderLeftWidth,selected:n.classList.contains('is-selected')};})()`));assert.equal(selected.selected,true);assert.match(String(selected.shadow),/2px 0px 0px/u);assert.equal(selected.border,'0px');metrics.selected=selected;await capture('selected-x2',urgent);
  const at=listOrder.findIndex(item=>item.id===ids.pending[0]);assert.ok(at>=0&&at<listOrder.length-1);assert.equal(await b.evaluate("document.querySelector('.ds-detail-position').textContent"),(at+1)+' / '+listOrder.length);await click('[aria-label=下一项]');await waitDetail(at+1);await click('[aria-label=上一项]');await waitDetail(at);metrics.groupedNavigationWithRealtime=true;
  await click('[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-dialog')");
  const lastCompleted=listOrder.filter(item=>item.closureKind==='COMPLETED').at(-1);assert.ok(lastCompleted);const boundary=listOrder.indexOf(lastCompleted),firstDismissed=listOrder[boundary+1];assert.ok(firstDismissed&&firstDismissed.closureKind==='DISMISSED');await click(row(lastCompleted.id)+' .row-link');await b.waitFor("document.querySelector('.detail-dialog')!==null");assert.equal(await b.evaluate("document.querySelector('.ds-detail-position').textContent"),(boundary+1)+' / '+listOrder.length);await click('[aria-label=下一项]');await waitDetail(boundary+1);await click('[aria-label=上一项]');await waitDetail(boundary);await click('[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-dialog')");metrics.completedDismissedNavigationWithRealtime=true;
  // Collapse in list, switch to board and back: same per-principal session preference.
  await click('.ds-list-subgroup[data-board-group="已关闭"] button');await click('.view-tabs button[aria-pressed=false]');await b.waitFor("document.querySelectorAll('.board-column').length===3");
  assert.equal(await b.evaluate("document.querySelector('.board-column.closed [data-board-group=已关闭] button').getAttribute('aria-expanded')"),'false');
  const boardStage=await b.evaluate("(()=>{const s=getComputedStyle(document.querySelector('.board-column.pending .ds-status-badge'));return {height:s.height,color:s.color,background:s.backgroundColor};})()");assert.deepEqual(boardStage,initial.stageStyle);metrics.boardStage=boardStage;
  await click('.board-column.closed [data-board-group="已关闭"] button');await b.waitFor("document.querySelector('.ticket-card[data-closure-kind=DISMISSED]')?.checkVisibility()===true");await b.waitFor("(()=>{const group=document.querySelector('.board-column.closed [data-board-group=已关闭]');return group?.querySelector('button')?.getAttribute('aria-expanded')==='true'&&!group.getAnimations({subtree:true}).some(a=>a.pending||a.playState==='running');})()");
  assert.equal(await b.evaluate("document.querySelectorAll('.ds-ticket-dismissed-body .ds-ticket-metadata').length"),0);assert.ok(Number(await b.evaluate("document.querySelectorAll('.ticket-card[data-closure-kind=COMPLETED] .ds-ticket-metadata').length"))>0);
  const manualCard='.board-column.closed .ticket-card[data-item-id="'+ids.manual+'"]';if(!await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(manualCard)}))`))await click('.board-column.closed [data-board-group=已关闭] [data-action=expand-column]');await b.waitFor(`document.querySelector(${JSON.stringify(manualCard)})?.checkVisibility()===true`);
  metrics.closedCardHeight=await b.evaluate(`(()=>{const n=document.querySelector('.ticket-card[data-item-id="${ids.manual}"]'),body=n.querySelector('.ds-ticket-body'),metadata=document.createElement('div');metadata.className='ds-ticket-metadata';metadata.innerHTML='<p class="card-meta">合成位置 · 医小修网页（合成）</p>';const after=n.getBoundingClientRect().height;body.insertBefore(metadata,body.querySelector('footer'));const withMetadata=n.getBoundingClientRect().height;metadata.remove();return {after,withMetadata,reduction:withMetadata-after,comparison:'same-card metadata row restored only for measurement'};})()`);assert.ok(Number(object(metrics.closedCardHeight).reduction)>0);
  await click('.view-tabs button[aria-pressed=false]');await b.waitFor(ready);assert.equal(await b.evaluate("document.querySelector('.ds-list-subgroup[data-board-group=已关闭] button').getAttribute('aria-expanded')"),'true');metrics.preferenceRoundtrip=true;
  await click('[data-date-preset=today]:not([data-compact])');await settle();assert.equal(await b.evaluate("document.querySelectorAll('.ds-date-segments [aria-pressed=true]').length"),1,'a preset selects exactly one segment');
  await click('[data-action=open-closed-date-filter]');await typeWorkbenchDates(b,ids.yesterday,ids.yesterday);await click('[aria-label=应用已处理日期]');await settle();assert.equal(await b.evaluate("document.querySelectorAll('.ds-date-segments [aria-pressed=true]').length"),1,'custom dates select exactly one segment');
  await click('[data-action=open-closed-date-filter]');await click('[aria-label=清除已处理日期和取消筛选]');await settle();assert.equal(await b.evaluate("document.querySelectorAll('.ds-date-segments [aria-pressed=true]').length"),1);metrics.datePresetAndCustomSelected=true;
  for(const kind of ['dismissed','completed','all']){if(kind==='dismissed')await click('[aria-label=折叠已处理]');await chooseWorkbenchSelect(b,'[data-field-label=结束方式]',kind);await settle();const visible=await b.evaluate("[...document.querySelectorAll('.ds-list-stage .ds-status-text,.ds-list-subgroup [data-slot=button-label]')].filter(n=>n.checkVisibility()).map(n=>n.textContent)");const stages=await b.evaluate("[...document.querySelectorAll('.list-group')].map(n=>n.getAttribute('aria-label'))"),subgroups=await b.evaluate("[...document.querySelectorAll('.ds-list-subgroup')].map(n=>n.dataset.boardGroup)");assert.deepEqual(subgroups,kind==='all'?['待判断','待接单','已完成','已关闭']:[kind==='completed'?'已完成':'已关闭']);assert.deepEqual(stages,kind==='all'?['待受理','处理中','已处理']:['已处理']);assert.equal(await b.evaluate("document.querySelectorAll('.ds-list-subgroup').length"),kind==='all'?4:1);metrics['filter-'+kind]={visible,stages,subgroups};if(kind==='dismissed'){assert.equal(await b.evaluate("document.querySelector('.ds-list-stage-toggle[aria-label=折叠已处理]')?.getAttribute('aria-expanded')"),'true');assert.equal(await b.evaluate("document.querySelector('.ds-list-note')?.checkVisibility()"),true);await click('[aria-label=折叠已处理]');await click('[aria-label=展开已处理]');metrics.filteredParentExpanded=true;}if(kind==='dismissed')for(const width of [1440,1920]){await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await capture('list-'+width+'-dismissed');}if(kind==='dismissed'){await click('.ds-list-subgroup[data-board-group=已关闭] button');assert.equal(await b.evaluate("document.querySelector('.ds-list-subgroup[data-board-group=已关闭] button').getAttribute('aria-expanded')"),'false','filtered groups can still be folded after their initial forced expansion');assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-work-row')].filter(n=>n.checkVisibility()).length"),0);await click('.ds-list-subgroup[data-board-group=已关闭] button');assert.equal(await b.evaluate("document.querySelector('.ds-list-subgroup[data-board-group=已关闭] button').getAttribute('aria-expanded')"),'true');}}
  await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1060,deviceScaleFactor:1,mobile:false});await settle();const heightBefore=object(await sample()).toolbar;
  await click('.search-main input[name=q]');await b.command('Input.insertText',{text:'（合成）'});await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.waitFor("new URLSearchParams(location.search).get('q')==='（合成）'&&!document.querySelector('.workbench-search[aria-busy=true]')");
  const searchLayout=await sample();metrics.search=searchLayout;assert.ok(Math.abs(Number(object(searchLayout.toolbar).height)-Number(object(heightBefore).height))<=1);assert.equal(searchLayout.chipGap,8);
  const clear=object(await b.evaluate("(()=>{const n=document.querySelector('[aria-label=结束搜索]'),s=n.querySelector('svg').getBoundingClientRect(),r=n.getBoundingClientRect(),i=document.querySelector('.search-main input').getBoundingClientRect();return {icon:s.width,top:r.top,bottom:r.bottom,inputTop:i.top,inputBottom:i.bottom};})()"));assert.equal(clear.icon,16);assert.ok(Number(clear.top)>=Number(clear.inputTop)&&Number(clear.bottom)<=Number(clear.inputBottom));metrics.searchClear=clear;
  for(const width of [1440,1920]){await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await capture('list-'+width+'-search');}
  await click('[aria-label=结束搜索]');await b.waitFor("!new URLSearchParams(location.search).has('search')");await settle();await b.waitFor(ready);
  metrics.containerWidths=[];
  for(const width of [1280,900]){
   await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await b.evaluate("document.querySelector('.ds-work-table-wrap').scrollTo(0,0)");
   const firstBefore=object(await b.evaluate("document.querySelector('.ds-work-row>th').getBoundingClientRect().toJSON()"));await b.evaluate("document.querySelector('.ds-work-table-wrap').scrollLeft=180");
   const firstAfter=object(await b.evaluate("document.querySelector('.ds-work-row>th').getBoundingClientRect().toJSON()")),area=object(await b.evaluate("(()=>{const n=document.querySelector('.ds-work-table-wrap');return {client:n.clientWidth,scroll:n.scrollWidth,left:n.scrollLeft};})()"));assert.ok(Number(area.client)<1080&&Number(area.scroll)>=1080&&Number(area.left)>0);assert.equal(firstBefore.left,firstAfter.left);
   const narrowHead=object(await b.evaluate("document.querySelector('.ds-list-stage .column-heading').getBoundingClientRect().toJSON()"));assert.ok(Number(narrowHead.left)>=Number(firstAfter.left)&&Number(narrowHead.right)<=width);const sample={width,firstBefore,firstAfter,narrowHead,area};(metrics.containerWidths as unknown[]).push(sample);if(width===900){metrics.narrow=sample;await capture('list-900-scroll');}
   const target='.ds-work-row[data-kind=ticket]';await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await b.evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'center',inline:'nearest'})`);await b.evaluate("document.querySelector('.ds-work-table-wrap').scrollLeft=180");
   // Resize, scrolling and closing the preceding drawer may still be laying out.
   // Use the same stable-geometry and hit-test boundary as clickWorkbenchControl.
   await b.waitFor(`(async()=>{const row=document.querySelector(${JSON.stringify(target)}),cell=row?.querySelector('th');if(!cell?.checkVisibility())return false;const before=cell.getBoundingClientRect();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!row.isConnected||document.querySelector(${JSON.stringify(target)})!==row)return false;const after=cell.getBoundingClientRect();if(['x','y','width','height'].some(key=>before[key]!==after[key]))return false;const hit=document.elementFromPoint(after.x+after.width/2,after.y+after.height/2);return hit?.closest('.row-link')?.closest('.ds-work-row')===row;})()`);
   const point=object(await b.evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(target)}),r=row.querySelector('th').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,id:row.dataset.itemId};})()`));
   console.log('CARD28_STICKY_POINTER '+JSON.stringify({width,...point}));
   await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await b.waitFor(`document.querySelector(${JSON.stringify(target+' [data-board-claim-action]')})?.checkVisibility()===true`);assert.equal(await b.evaluate(`Boolean(document.elementFromPoint(${point.x},${point.y})?.closest('.row-link'))`),true);
   await b.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:point.x,y:point.y});await b.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x,y:point.y});await b.waitFor(`location.pathname.endsWith(${JSON.stringify('/'+point.id)})&&document.querySelector('.detail-dialog')!==null`);await click('[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-dialog')");
  }
  metrics.stickyNumberPointer=true;
  // Empty stages have one shared header and an explicit empty row, never per-group headers.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?view=list&range=all&search=1&q='+encodeURIComponent('无匹配的合成验收关键词')});await b.waitFor("document.querySelector('[data-search-state=empty]')!==null");assert.equal(await b.evaluate("document.querySelectorAll('.ds-work-table thead').length"),1);assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-list-empty')].filter(n=>n.checkVisibility()).length"),3);metrics.emptyStages=3;
  assert.deepEqual(writes,[]);assert.deepEqual((await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,before);assert.deepEqual((await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,events);metrics.businessWrites=writes;
 }catch(error){failure=error;if(browser)metrics.failureState=await browser.evaluate("({path:location.pathname,query:location.search,q:document.querySelector('.search-main input')?.value,busy:document.querySelector('.workbench-search')?.getAttribute('aria-busy')})");}
 finally{await closeBrowserTestResources([async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},()=>writeFile(join(directory,'metrics.json'),JSON.stringify(metrics,null,2)),()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_WITH_EXPLICIT_CARD28_SYNTHETIC_READ_FIELDS',syntheticFields:['web_report_urge','review_reason','reporter/location absent'],screenshots},null,2)),()=>{ids.restore();f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchBoardActionsEnabled:true,workbenchSearchEnabled:true,workbenchRealtimeEnabled:true}));

test('Card 28 saved closure filters fall back to all ordinary stages when search capability is disabled',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard27Board(f),ticket=f.tickets[4],cookie=f.browserCookies[0];assert.ok(ticket&&cookie);
 const before=(await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,events=(await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,writes:string[]=[],searchReads:string[]=[];
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')writes.push(request.url??'');if(request.url?.startsWith('/api/workbench/search'))searchReads.push(request.url);};f.runtime.server.on('request',observe);
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie:f.cookies[0]??''}});assert.equal(bootstrap.status,200);assert.equal(object(await bootstrap.json()).workbench_search_enabled,false);
  const pages=await Promise.all(['pending','active','closed'].map(async column=>{const r=await fetch(f.origin+'/api/workbench/board?column='+column+'&range=all',{headers:{cookie:f.cookies[0]??''}});assert.equal(r.status,200);const p=object(await r.json());assert.ok(Array.isArray(p.items));return {column,count:p.items.length};})),total=pages.reduce((n,p)=>n+p.count,0);
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?view=list&range=all&search=1&closure_kind=dismissed',width:1440,height:1060,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  for(const kind of ['dismissed','completed']){
   const previousDocument=kind==='completed'?await b.evaluate('performance.timeOrigin'):undefined;
   if(kind==='completed')await b.command('Page.navigate',{url:f.origin+'/workbench/app/?view=list&range=all&search=1&closure_kind='+kind});
   await b.waitFor(`new URL(location.href).searchParams.get('closure_kind')===${JSON.stringify(kind)}&&new URL(location.href).searchParams.get('search')==='1'&&${previousDocument===undefined?'true':`performance.timeOrigin!==${JSON.stringify(previousDocument)}`}&&document.querySelectorAll('.list-group').length===3&&document.querySelector('.list-group[aria-label=已处理] .ds-list-stage-count')?.textContent==='9'&&document.querySelector('.ds-work-row[data-item-id="${ticket.ticket.id}"]')!==null`);
   assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.list-group')].map(n=>n.getAttribute('aria-label'))"),['待受理','处理中','已处理']);
   assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.ds-list-subgroup')].map(n=>n.dataset.boardGroup)"),['待判断','待接单','已完成','已关闭']);
   assert.equal(await b.evaluate("Boolean(document.querySelector('.workbench-search,[data-field-label=结束方式],.ds-list-note'))"),false);
   for(const page of pages)assert.equal(await b.evaluate(`document.querySelector('.list-group[aria-label="${page.column==='pending'?'待受理':page.column==='active'?'处理中':'已处理'}"] .ds-list-stage-count').textContent`),String(page.count));
   await clickWorkbenchControl(b,'.ds-work-row[data-item-id="'+ticket.ticket.id+'"] .row-link');await b.waitFor("document.querySelector('.detail-dialog')!==null");
   const position=String(await b.evaluate("document.querySelector('.ds-detail-position').textContent"));assert.match(position,/^[1-9]\d* \/ \d+$/u);assert.equal(Number(position.split('/')[1]?.trim()),total,'detail navigation must use every ordinary loaded stage, not stale closure-only URL state');
   await clickWorkbenchControl(b,'[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-dialog')");
  }
  assert.deepEqual(searchReads,[]);assert.deepEqual(writes,[]);assert.deepEqual((await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,before);assert.deepEqual((await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,events);
  console.log('CARD28_SEARCH_DISABLED '+JSON.stringify({kinds:['dismissed','completed'],ordinaryStages:pages,total,searchReads:0,businessPosts:0,fixtureSystemClosure:ids.system}));
 }catch(error){failure=error;}finally{await closeBrowserTestResources([()=>{f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchBoardActionsEnabled:true,workbenchSearchEnabled:false}));

test('Card 27B separates closure groups, rejects dismissed drops and filters the real read model without writes',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard27Board(f),directory=process.env.CARD27B_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card27b-board-'));await mkdir(directory,{recursive:true});console.log('CARD27B_BOARD '+JSON.stringify({directory}));
 const before=(await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows;
 const eventCount=(await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows;
 const posts:string[]=[],reads:string[]=[],screenshots:unknown[]=[],metrics:Record<string,unknown>={};
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(request.url??'');if(request.method==='GET'&&request.url?.startsWith('/api/workbench/'))reads.push(request.url);};f.runtime.server.on('request',observe);
 const get=async(path:string)=>{const response=await fetch(f.origin+path,{headers:{cookie:f.cookies[0]??''}});assert.equal(response.status,200,await response.clone().text());return object(await response.json());};
 const all=await get('/api/workbench/board?column=closed&range=all');assert.deepEqual(all.group_counts,{completed:4,dismissed:5});assert.ok(Array.isArray(all.items));
 const manual=object(all.items.find(item=>object(item).id===ids.manual)),system=object(all.items.find(item=>object(item).id===ids.system)),duplicate=object(all.items.find(item=>object(item).id===ids.duplicate)),unknown=object(all.items.find(item=>object(item).id===ids.unknown));
 assert.equal(object(manual.closure).source,'MANUAL');assert.equal(object(system.closure).source,'SYSTEM');assert.equal(object(duplicate.closure).duplicate_of,null);assert.equal(object(unknown.closure).source,'MANUAL');assert.equal(typeof object(unknown.closure).closed_at,'string');
 assert.ok(all.items.every(item=>object(object(item).closure).kind==='COMPLETED'||object(object(item).closure).can_restore===true));
 metrics.serverGroups=all.group_counts;
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1060,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  const navigate=async(url?:string)=>{const documentTime=await b.evaluate('performance.timeOrigin');if(url)await b.command('Page.navigate',{url});else await b.command('Page.reload');await b.waitFor(`performance.timeOrigin!==${JSON.stringify(documentTime)}&&document.readyState==='complete'`);};
  await b.command('Page.bringToFront');
  const group=(label:string)=>'.board-column.closed [data-board-group="'+label+'"]',trigger=(label:string)=>group(label)+' .ds-board-group-trigger';
  const visibleCards=(label:string)=>`[...document.querySelectorAll(${JSON.stringify(group(label)+' .ticket-card')})].filter(n=>n.checkVisibility()).length`;
  const ready="document.querySelectorAll('.column-cards').length===3&&document.querySelector('.board-column.closed .ds-stage-count')?.textContent==='9'";
  await b.waitFor(ready);await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(trigger('已完成'))}).getAttribute('aria-expanded')`),'true');
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(trigger('已关闭'))}).getAttribute('aria-expanded')`),'false');
  assert.equal(await b.evaluate(visibleCards('已完成')),3);assert.equal(await b.evaluate(visibleCards('已关闭')),0);
  assert.match(String(await b.evaluate(`document.querySelector(${JSON.stringify(trigger('已关闭'))}).textContent`)),/不计入完成数/u);
  assert.equal(await b.evaluate("Boolean(document.querySelector('[data-date-preset=cancelled],option[value=cancelled]'))"),false);
  const capture=async(name:string,selector?:string)=>{
   await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
   let bytes:Buffer,clip:Record<string,number>|undefined;
   if(selector){
    await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1060,deviceScaleFactor:2,mobile:false});
    await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
    await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    clip=await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),x=Math.max(0,Math.floor(r.left+scrollX)-8),y=Math.max(0,Math.floor(r.top+scrollY)-8);return {x,y,width:Math.ceil(r.right+scrollX)+8-x,height:Math.ceil(r.bottom+scrollY)+8-y,scale:1};})()`) as Record<string,number>;
    const result=object(await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip}));assert.equal(typeof result.data,'string');bytes=Buffer.from(String(result.data),'base64');
    assert.equal(bytes.readUInt32BE(16),Math.round(Number(clip.width)*2));assert.equal(bytes.readUInt32BE(20),Math.round(Number(clip.height)*2));
   }else if(name==='list-dismissed'){
    const area=await b.evaluate('({x:0,y:0,width:innerWidth,height:document.documentElement.scrollHeight,scale:1})');
    const result=object(await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:area}));bytes=Buffer.from(String(result.data),'base64');
   }else bytes=Buffer.from(await b.screenshot(),'base64');
   const viewport=object(await b.evaluate('({platform:navigator.platform,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport.scale})'));
   assert.equal(viewport.zoom,1);assert.equal(viewport.dpr,selector?2:1);if(process.platform==='win32')assert.equal(viewport.platform,'Win32');
   const file=join(directory,name+'.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex'),viewport,...(clip?{clip}:{})});
  };
  for(const width of [1440,1920]){await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await capture('board-'+width+'-dismissed-folded');}
  await clickWorkbenchControl(b,trigger('已关闭'));await b.waitFor(visibleCards('已关闭')+'===3');
  assert.match(String(await b.evaluate(`document.querySelector(${JSON.stringify(group('已完成')+' [data-action=expand-column]')}).textContent`)),/显示剩余 1 项/u);
  assert.match(String(await b.evaluate(`document.querySelector(${JSON.stringify(group('已关闭')+' [data-action=expand-column]')}).textContent`)),/显示剩余 2 项/u);
  const groupMetrics=await b.evaluate("[...document.querySelectorAll('.board-column.closed .ds-board-group-trigger')].map(n=>{const s=getComputedStyle(n);return {label:n.textContent,size:s.fontSize,weight:s.fontWeight,color:s.color,expanded:n.getAttribute('aria-expanded')};})");
  assert.ok(Array.isArray(groupMetrics));for(const value of groupMetrics){const row=object(value);assert.equal(row.size,'12px');assert.equal(row.weight,'500');}metrics.groups=groupMetrics;const secondaryColor=object(groupMetrics[0]).color;
  for(const width of [1440,1920]){await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await capture('board-'+width+'-dismissed-expanded');}
  await clickWorkbenchControl(b,group('已关闭')+' [data-action=expand-column]');await b.waitFor(visibleCards('已关闭')+'===5');assert.equal(await b.evaluate(visibleCards('已完成')),3,'expanding dismissed cards must not change the completed group limit');
  for(const [name,id] of [['manual',ids.manual],['system',ids.system],['duplicate',ids.duplicate]] as const){
   const selector='.board-column.closed .ticket-card[data-item-id="'+id+'"]';await b.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);
   const sample=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),title=getComputedStyle(n.querySelector('h3')),tile=getComputedStyle(n.querySelector('.ds-ticket-category')),s=getComputedStyle(n);return {kind:n.dataset.closureKind,ring:n.dataset.ring??null,heat:n.querySelector('.ds-ticket-heat')!==null,size:title.fontSize,weight:title.fontWeight,color:title.color,decoration:title.textDecorationLine,background:s.backgroundColor,shadow:s.boxShadow,filter:tile.filter,opacity:tile.opacity,text:n.textContent,restore:[...n.querySelectorAll('button')].some(n=>n.textContent.includes('恢复'))};})()`));
   assert.equal(sample.kind,'DISMISSED');assert.equal(sample.ring,null);assert.equal(sample.heat,false);assert.equal(sample.size,'14px');assert.equal(sample.weight,'500');assert.equal(sample.decoration,'none');assert.equal(sample.filter,'grayscale(1)');assert.equal(sample.opacity,'0.55');assert.equal(sample.restore,false);
   assert.equal(sample.color,secondaryColor);assert.match(String(sample.shadow),/0px 0px 0px 1px/u);assert.match(String(sample.shadow),/rgba\(15, 15, 15, 0\.06\)/u);
   assert.match(String(sample.text),name==='manual'?/人工关闭/u:name==='system'?/系统判定不受理/u:/重复/u);metrics[name]=sample;await capture('dismissed-'+name+'-x2',selector);
  }
  await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1060,deviceScaleFactor:1,mobile:false});await b.evaluate('scrollTo(0,0)');
  const unknownSelector='.ticket-card[data-item-id="'+ids.unknown+'"]';assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(unknownSelector)}).textContent.includes('人工关闭')`),true,'U7 recreates this synthetic case with a complete manual closure record');
  // Real pointer drag crosses the original activation threshold, then enters a sibling area outside the completed drop target.
  const draggable=f.tickets[4];assert.ok(draggable);const dragCard='.board-column.pending .ticket-card[data-item-id="'+draggable.ticket.id+'"]';
  if(!await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(dragCard)}))`))await clickWorkbenchControl(b,'.board-column.pending [data-action=expand-column]');
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(dragCard+' [data-action=board-drag-handle]')}))`);
  await b.evaluate("(()=>{const original=globalThis.fetch;globalThis.__card27Reads=[];globalThis.fetch=(...args)=>{globalThis.__card27Reads.push({path:String(args[0]),method:args[1]?.method??'GET'});return original(...args);};})()");
  const geometry=object(await b.evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(dragCard+' [data-action=board-drag-handle]')}).getBoundingClientRect(),z=document.querySelector(${JSON.stringify(trigger('已关闭'))}).getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,toX:z.x+z.width/2,toY:z.y+z.height/2};})()`));
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.x,y:geometry.y});await b.command('Input.dispatchMouseEvent',{type:'mousePressed',x:geometry.x,y:geometry.y,button:'left',clickCount:1});await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:Number(geometry.x)+8,y:geometry.y,button:'left',buttons:1});
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(dragCard+' .board-action-card.is-dragging')}))`);metrics.dragStartReads=await b.evaluate('globalThis.__card27Reads');await b.evaluate('globalThis.__card27Reads=[]');await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.toX,y:geometry.toY,button:'left',buttons:1});await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await b.evaluate("Boolean(document.querySelector('[data-board-drop-column=closed].is-drop-target'))"),false);
  await b.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:geometry.toX,y:geometry.toY,button:'left',clickCount:1});await b.waitFor("!document.querySelector('.board-action-card.is-dragging')");await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.deepEqual(await b.evaluate('globalThis.__card27Reads'),[],'dropping into dismissed must cause no read capability, detail, or business write request');assert.equal(await b.evaluate("Boolean(document.querySelector('.detail-dialog'))"),false);metrics.dismissedDrop={requests:await b.evaluate('globalThis.__card27Reads'),openedDrawer:false};
  await clickWorkbenchControl(b,'.ticket-card[data-item-id="'+ids.manual+'"] .card-open');await b.waitFor("document.querySelector('[data-closure-record]')?.checkVisibility()===true");
  const record=String(await b.evaluate("document.querySelector('[data-closure-record]').textContent"));for(const label of ['关闭记录','操作人','时间','方式','原因','原单','说明'])assert.ok(record.includes(label),label);assert.match(record,/人工关闭/u);assert.match(record,/与报修人核对为测试误报/u);metrics.closureRecord=record;await capture('drawer-closure-record');
  await clickWorkbenchControl(b,'.detail-dialog button[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-dialog')");
  await clickWorkbenchControl(b,group('已完成')+' [data-action=expand-column]');await b.waitFor(visibleCards('已完成')+'===4');
  const groupOrder=object(await b.evaluate("({completed:[...document.querySelectorAll('[data-board-group=已完成] .ticket-card')].map(n=>n.dataset.itemId),dismissed:[...document.querySelectorAll('[data-board-group=已关闭] .ticket-card')].map(n=>n.dataset.itemId)})"));
  assert.ok(Array.isArray(groupOrder.completed)&&Array.isArray(groupOrder.dismissed));const finalCompleted=groupOrder.completed.at(-1),firstDismissed=groupOrder.dismissed[0];assert.equal(typeof finalCompleted,'string');assert.equal(typeof firstDismissed,'string');
  await clickWorkbenchControl(b,'.ticket-card[data-item-id="'+String(finalCompleted)+'"] .card-open');await b.waitFor("Boolean(document.querySelector('.detail-dialog .detail-heading h2'))");await clickWorkbenchControl(b,'.detail-dialog button[aria-label=下一项]');await b.waitFor(`location.pathname.endsWith('/${String(firstDismissed)}')&&document.querySelector('[data-closure-record]')?.checkVisibility()===true`);metrics.groupNavigation={from:finalCompleted,to:firstDismissed};
  await clickWorkbenchControl(b,'.detail-dialog button[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-dialog')");
  await clickWorkbenchControl(b,trigger('已完成'));await navigate();await b.waitFor(ready);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(trigger('已完成'))}).getAttribute('aria-expanded')`),'false');assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(trigger('已关闭'))}).getAttribute('aria-expanded')`),'true','the current user remembers both group choices across a reload');metrics.preferenceAfterReload={completed:false,dismissed:true};
  await clickWorkbenchControl(b,'[data-date-preset=today]:not([data-compact])');await b.waitFor("document.querySelector('.board-column.closed .ds-stage-count')?.textContent==='8'");
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(group('已完成')+' .ds-board-group-count')}).textContent`),'4');assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(group('已关闭')+' .ds-board-group-count')}).textContent`),'4');
  assert.equal(await b.evaluate("document.querySelector('[data-summary-filter=today] .ds-summary-value').textContent"),'3');
  await clickWorkbenchControl(b,'[data-summary-filter=today]');await clickWorkbenchControl(b,trigger('已完成'));await b.waitFor(visibleCards('已完成')+'===3');assert.equal(await b.evaluate(visibleCards('已关闭')),0);
  assert.equal(await b.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].filter(n=>n.checkVisibility()).every(n=>n.dataset.closureKind==='COMPLETED')"),true);metrics.today={completedGroup:4,dismissedGroup:4,summary:3};
  await navigate(f.origin+'/workbench/app/?view=list&range=all');await b.waitFor("Boolean(document.querySelector('[data-field-label=结束方式] select'))&&document.querySelectorAll('.work-table').length===1");
  await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','dismissed');await b.waitFor("new URLSearchParams(location.search).get('closure_kind')==='dismissed'&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='5'");
  assert.ok(reads.some(url=>{const q=new URL(url,f.origin).searchParams;return url.startsWith('/api/workbench/search?')&&q.get('closure_kind')==='dismissed';}));
  await clickWorkbenchControl(b,'.list-group[aria-label=已处理] [data-action=expand-column]');await b.waitFor("document.querySelectorAll('.list-group[aria-label=已处理] tr.ds-work-row[data-closure-kind=DISMISSED]').length===5");
  const rows=await b.evaluate("[...document.querySelectorAll('.list-group[aria-label=已处理] tr.ds-work-row')].map(n=>{const reason=n.querySelector('[data-closure-reason]'),cell=reason?.closest('td');return {kind:n.dataset.closureKind,color:getComputedStyle(n).color,reason:reason?.textContent??null,width:cell?.getBoundingClientRect().width??null};})");assert.ok(Array.isArray(rows));assert.equal(rows.length,5);for(const value of rows){const row=object(value);assert.equal(row.kind,'DISMISSED');assert.equal(row.color,secondaryColor);assert.ok(row.reason);assert.ok(typeof row.width==='number'&&row.width<=160,JSON.stringify(row));}metrics.dismissedRows=rows;await capture('list-dismissed');
  await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','completed');await b.waitFor("new URLSearchParams(location.search).get('closure_kind')==='completed'&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='4'");assert.equal(await b.evaluate("[...document.querySelectorAll('.list-group[aria-label=已处理] tr.ds-work-row')].every(n=>n.dataset.closureKind==='COMPLETED')"),true);
  await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','all');await b.waitFor("!new URLSearchParams(location.search).has('closure_kind')&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='9'");
  await navigate(f.origin+'/workbench/app/?view=list');await b.waitFor("Boolean(document.querySelector('[data-field-label=结束方式] select'))&&document.querySelectorAll('.work-table').length===1");await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','dismissed');await b.waitFor("new URLSearchParams(location.search).get('range')==='recent'&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='5'");assert.ok(reads.some(url=>{const q=new URL(url,f.origin).searchParams;return url.startsWith('/api/workbench/search?')&&q.get('closure_kind')==='dismissed'&&q.get('range')==='recent';}));metrics.defaultListRange='recent';
  assert.deepEqual(posts,[]);assert.deepEqual((await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,before);assert.deepEqual((await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,eventCount);metrics.businessPosts=posts;
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([
  async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},
  ()=>writeFile(join(directory,'metrics.json'),JSON.stringify(metrics,null,2)),()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',screenshots},null,2)),
  ()=>{f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
 ],failure);}
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchBoardActionsEnabled:true,workbenchSearchEnabled:true}));

test('Card 27B B5 date presets and custom dates compose with every closure kind through the real search contract',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard27Board(f),directory=await mkdtemp(join(tmpdir(),'card27b-b5-'));console.log('CARD27B_B5 '+JSON.stringify({directory}));
 const before=(await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,eventCount=(await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows;
 const writes:string[]=[],searches:string[]=[],screenshots:unknown[]=[],windows:Record<string,unknown>[]=[],layouts:Record<string,unknown>[]=[],metrics:Record<string,unknown>={windows,layouts};
 const observe=(request:import('node:http').IncomingMessage)=>{const url=request.url??'';if(request.method==='POST'&&!url.startsWith('/api/workbench/search'))writes.push(url);if(url.startsWith('/api/workbench/search'))searches.push(url);};f.runtime.server.on('request',observe);
 const get=async(column:string)=>{const response=await fetch(f.origin+'/api/workbench/board?column='+column+'&range=all',{headers:{cookie:f.cookies[0]??''}});assert.equal(response.status,200);const page=object(await response.json());assert.equal(page.next_cursor,null);assert.ok(Array.isArray(page.items));return page.items.map(object);};
 const closed=await get('closed'),open=[...await get('pending'),...await get('active')].map(item=>item.id).sort();
 const facts=closed.map(item=>{const closure=object(item.closure);assert.ok(typeof item.id==='string'&&typeof item.status==='string');assert.ok(closure.kind==='COMPLETED'||closure.kind==='DISMISSED');return {id:item.id,status:item.status,kind:closure.kind,at:typeof item.completed_at==='string'?item.completed_at:typeof closure.closed_at==='string'?closure.closed_at:null};});
 const expected=(kind:'all'|'completed'|'dismissed',from:string,to:string)=>facts.filter(item=>(kind==='all'||item.kind===kind.toUpperCase())&&(item.status==='RESOLVED'||item.at!==null&&item.at.slice(0,10)>=from&&item.at.slice(0,10)<=to)).map(item=>item.id).sort();
 const today=ids.today,week=new Date(Date.parse(today+'T00:00:00Z')-6*86400000).toISOString().slice(0,10),month=today.slice(0,8)+'01',draftText='（合成）';
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?view=list&range=all',width:1440,height:1060,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.command('Page.bringToFront');await b.waitFor("document.querySelectorAll('.work-table').length===1&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='9'");
  const instrument="(()=>{if(globalThis.__b5Instrumented)return;globalThis.__b5Instrumented=true;globalThis.__b5Reads=[];const original=globalThis.fetch;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/search')&&response.ok){const page=await response.clone().json();globalThis.__b5Reads.push({criteria:page.criteria,range:page.range,closed:page.items.filter(n=>n.column==='closed').map(n=>n.id).sort(),open:page.items.filter(n=>n.column!=='closed').map(n=>n.id).sort()});}return response;};})()";
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});await b.evaluate(instrument);
  await clickWorkbenchControl(b,'.search-main input[name=q]');await b.command('Input.insertText',{text:draftText});await b.waitFor(`document.querySelector('.search-main input[name=q]').value===${JSON.stringify(draftText)}`);
  const rowIds="[...document.querySelectorAll('.list-group[aria-label=已处理] tr.ds-work-row .row-link')].map(n=>new URL(n.href).pathname.split('/').at(-1)).sort()";
  const confirm=async(kind:'all'|'completed'|'dismissed',from:string,to:string,q='')=>{
   const wanted=expected(kind,from,to),criteria=`c.range==='custom'&&c.closed_from===${JSON.stringify(from)}&&c.closed_to===${JSON.stringify(to)}&&c.q===${JSON.stringify(q)}&&${kind==='all'?"!Object.hasOwn(c,'closure_kind')":`c.closure_kind===${JSON.stringify(kind)}`}`;
   await b.waitFor(`(()=>{const r=globalThis.__b5Reads?.at(-1),c=r?.criteria;return c&&${criteria}&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent===${JSON.stringify(String(wanted.length))};})()`);
   const result=object(await b.evaluate('globalThis.__b5Reads.at(-1)'));assert.deepEqual(result.closed,wanted);if(q==='')assert.deepEqual(result.open,open,'date and closure kind must preserve the other stages');
   assert.deepEqual(result.range,{from:from+' 00:00:00',until:new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)+' 00:00:00',mode:'custom',timezone:'Asia/Shanghai'});
   for(const label of ['已完成','已关闭']){const trigger='.ds-list-subgroup[data-board-group="'+label+'"] button';if(await b.evaluate(`document.querySelector(${JSON.stringify(trigger)})?.getAttribute('aria-expanded')==='false'`))await clickWorkbenchControl(b,trigger);}
   for(const selector of await b.evaluate("[...document.querySelectorAll('.list-group[aria-label=已处理] [data-action=expand-column][aria-expanded=false]')].map(n=>'#'+n.closest('tr').id+' [data-action=expand-column]')") as string[])await clickWorkbenchControl(b,selector);
   await b.waitFor(`JSON.stringify(${rowIds})===${JSON.stringify(JSON.stringify(wanted))}`);assert.deepEqual(await b.evaluate(rowIds),wanted);
   assert.equal(await b.evaluate("document.querySelector('[data-field-label=结束方式] [data-slot=select-trigger]').disabled"),false);assert.equal(await b.evaluate("document.querySelector('.search-main input[name=q]').value"),draftText);
   return {kind,from,to,ids:wanted};
  };
  const capture=async(name:string,width:number)=>{
   await b.command('Emulation.setDeviceMetricsOverride',{width,height:1060,deviceScaleFactor:1,mobile:false});await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
   await b.waitFor("![...document.querySelectorAll('[role=option]')].some(n=>n.checkVisibility())");
   const layout=object(await b.evaluate("(()=>{const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {toolbar:rect(document.querySelector('.ds-board-toolbar-bottom')),dates:rect(document.querySelector('.ds-board-dates')),chip:rect(document.querySelector('[data-field-label=结束方式]').closest('.ds-filter-chip')),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,platform:navigator.platform,dpr:devicePixelRatio,zoom:visualViewport.scale};})()"));
   const toolbar=object(layout.toolbar),dates=object(layout.dates),chip=object(layout.chip);for(const r of [dates,chip]){assert.ok(Number(r.left)>=Number(toolbar.left)-.5&&Number(r.right)<=Number(toolbar.right)+.5);}
   const overlap=Math.min(Number(dates.right),Number(chip.right))>Math.max(Number(dates.left),Number(chip.left))&&Math.min(Number(dates.bottom),Number(chip.bottom))>Math.max(Number(dates.top),Number(chip.top));assert.equal(overlap,false);assert.ok(Number(layout.scrollWidth)<=width);assert.equal(layout.dpr,1);assert.equal(layout.zoom,1);if(process.platform==='win32')assert.equal(layout.platform,'Win32');layouts.push({name,width,...layout});
   const area=await b.evaluate('({x:0,y:0,width:innerWidth,height:document.documentElement.scrollHeight,scale:1})'),shot=object(await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:area}));assert.ok(typeof shot.data==='string');const bytes=Buffer.from(shot.data,'base64'),file=join(directory,name+'-'+width+'.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex'),viewport:layout});
  };
  for(const [preset,from,to] of [['today',today,today],['week',week,today],['month',month,today],['custom',ids.yesterday,ids.yesterday]] as const){
   if(preset==='custom'){await clickWorkbenchControl(b,'[data-action=open-closed-date-filter]');await typeWorkbenchDates(b,from,to);await clickWorkbenchControl(b,'[aria-label=应用已处理日期]');}
   else await clickWorkbenchControl(b,'[data-date-preset='+preset+']:not([data-compact])');
   await b.waitFor(`new URLSearchParams(location.search).get('range')==='custom'&&new URLSearchParams(location.search).get('closed_from')===${JSON.stringify(from)}&&new URLSearchParams(location.search).get('closed_to')===${JSON.stringify(to)}`);
   // A date change in search mode starts its own real read. Wait for that
   // result before the next kind change, preserving the App's single-search budget.
   if(await b.evaluate("new URLSearchParams(location.search).get('search')==='1'"))await confirm('all',from,to);
   else await b.waitFor(`document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent===${JSON.stringify(String(expected('all',from,to).length))}`);
   for(const kind of ['dismissed','completed','all'] as const){await chooseWorkbenchSelect(b,'[data-field-label=结束方式]',kind);const observation=await confirm(kind,from,to);windows.push({preset,...observation});if(kind==='dismissed')for(const width of [1440,1920])await capture('list-'+preset+'-dismissed',width);}
  }
  // The same unsubmitted q survives every date/kind update; committing it preserves the custom window.
  await clickWorkbenchControl(b,'.workbench-search .workbench-disclosure-trigger');await clickWorkbenchControl(b,'.workbench-search button[type=submit]');await confirm('all',ids.yesterday,ids.yesterday,draftText);
  const documentTime=await b.evaluate('performance.timeOrigin');await b.command('Page.reload');await b.waitFor(`performance.timeOrigin!==${JSON.stringify(documentTime)}&&document.readyState==='complete'`);await confirm('all',ids.yesterday,ids.yesterday,draftText);
  await clickWorkbenchControl(b,'.view-tabs button[aria-pressed=false]');await b.waitFor("new URLSearchParams(location.search).get('view')==='board'&&document.querySelectorAll('.column-cards').length===3");assert.equal(await b.evaluate("new URLSearchParams(location.search).get('closed_from')"),ids.yesterday);
  await clickWorkbenchControl(b,'.view-tabs button[aria-pressed=false]');await b.waitFor("new URLSearchParams(location.search).get('view')==='list'&&document.querySelectorAll('.work-table').length===1");await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','dismissed');await confirm('dismissed',ids.yesterday,ids.yesterday,draftText);
  await clickWorkbenchControl(b,'.search-main button[type=button]');await b.waitFor(`!new URLSearchParams(location.search).has('search')&&!new URLSearchParams(location.search).has('q')&&!new URLSearchParams(location.search).has('closure_kind')&&new URLSearchParams(location.search).get('range')==='custom'&&new URLSearchParams(location.search).get('closed_from')===${JSON.stringify(ids.yesterday)}&&new URLSearchParams(location.search).get('closed_to')===${JSON.stringify(ids.yesterday)}&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent===${JSON.stringify(String(expected('all',ids.yesterday,ids.yesterday).length))}`);
  await clickWorkbenchControl(b,'[data-action=open-closed-date-filter]');await clickWorkbenchControl(b,'[aria-label=清除已处理日期和取消筛选]');await b.waitFor("new URLSearchParams(location.search).get('range')==='all'&&!new URLSearchParams(location.search).has('closed_from')&&!new URLSearchParams(location.search).has('closed_to')");await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','dismissed');await b.waitFor("globalThis.__b5Reads?.at(-1)?.criteria.range==='all'&&globalThis.__b5Reads.at(-1).criteria.closure_kind==='dismissed'&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='5'");
  const allCriteria=object(object(await b.evaluate('globalThis.__b5Reads.at(-1)')).criteria);assert.equal(Object.hasOwn(allCriteria,'closed_from'),false);assert.equal(Object.hasOwn(allCriteria,'closed_to'),false);
  assert.ok(searches.length<=20,'the real search rate budget must hold: '+searches.length);assert.deepEqual(writes,[]);assert.deepEqual((await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,before);assert.deepEqual((await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,eventCount);metrics.searchRequests=searches.length;metrics.businessPosts=writes;metrics.reloadAndViewPreserved=true;metrics.leaveSearchPreservedDates=true;metrics.clearDateRemovedPair=true;
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([
  async()=>{metrics.searchRequests=searches.length;metrics.searchPaths=searches;if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},()=>writeFile(join(directory,'metrics.json'),JSON.stringify(metrics,null,2)),()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',screenshots},null,2)),()=>{f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
 ],failure);}
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchBoardActionsEnabled:true,workbenchSearchEnabled:true}));

test('Card 27B pending searches lock date and closure controls until the genuine server read settles',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard27Board(f),directory=await mkdtemp(join(tmpdir(),'card27b-overlap-'));console.log('CARD27B_OVERLAP '+JSON.stringify({directory}));
 const before=(await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,eventCount=(await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows;
 const reads:{url:string;status:number|null}[]=[],posts:string[]=[],screenshots:unknown[]=[],metrics:Record<string,unknown>={};
 const observe=(request:import('node:http').IncomingMessage,response:import('node:http').ServerResponse)=>{const url=request.url??'';if(new URL(url,f.origin).pathname==='/api/workbench/search'){const row={url,status:null as number|null};reads.push(row);response.once('finish',()=>{row.status=response.statusCode;});}else if(request.method==='POST')posts.push(url);};f.runtime.server.on('request',observe);
 const originalConnect=f.pool.connect,restoreQueries=new Map<PostgresPoolClient,()=>void>();
 let releaseGate:()=>void=()=>{},notifyHeld:()=>void=()=>{},heldCount=0,waitTimer:ReturnType<typeof setTimeout>|undefined;
 const gate=new Promise<void>(resolve=>{releaseGate=resolve;}),held=new Promise<void>(resolve=>{notifyHeld=resolve;});
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?view=list&range=all',width:1440,height:1060,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.command('Page.bringToFront');await b.waitFor("document.querySelectorAll('.work-table').length===1&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='9'");
  await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','dismissed');await b.waitFor("document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='5'&&document.querySelector('[data-date-preset=today]:not([data-compact])')?.disabled===false&&document.querySelector('[data-field-label=结束方式] [data-slot=select-trigger]')?.disabled===false");
  assert.equal(reads.length,1);assert.equal(reads[0]?.status,200);
  // Hold the next custom-window statement before execution. The real search
  // already owns its App-wide busy slot; statement_timeout itself is unchanged.
  f.pool.connect=new Proxy(originalConnect,{apply(target,receiver,args:unknown[]){
   if(args.length)return Reflect.apply(target,receiver,args);
   return Reflect.apply(target,receiver,args).then((client:PostgresPoolClient)=>{
    const originalQuery=client.query,originalRelease=client.release;
    client.query=new Proxy(originalQuery,{apply(execute,_this,queryArgs:unknown[]){
     const sql=typeof queryArgs[0]==='string'?queryArgs[0].trimStart():'',values=queryArgs[1];
     if(heldCount===0&&sql.startsWith('SELECT to_char($1::date,')&&sql.includes('AS "from"')&&Array.isArray(values)&&values[0]===ids.today&&values[1]===ids.today){heldCount++;notifyHeld();return gate.then(()=>Reflect.apply(execute,client,queryArgs));}
     return Reflect.apply(execute,client,queryArgs);
    }});
    const restore=()=>{client.query=originalQuery;client.release=originalRelease;restoreQueries.delete(client);};restoreQueries.set(client,restore);
    client.release=(...releaseArgs:Parameters<PostgresPoolClient['release']>)=>{restore();return Reflect.apply(originalRelease,client,releaseArgs);};return client;
   });
  }});
  await clickWorkbenchControl(b,'[data-date-preset=today]:not([data-compact])');
  await Promise.race([held,new Promise<void>((_resolve,reject)=>{waitTimer=setTimeout(()=>reject(new Error('The genuine custom-window query did not reach the gate')),15000);})]);if(waitTimer)clearTimeout(waitTimer);
  await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(heldCount,1);assert.equal(reads.length,2);assert.equal(reads[1]?.status,null,'the actual delayed response must still be unfinished');
  const state=object(await b.evaluate("(()=>{const one=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];return {dates:all('[data-date-preset]:not(summary):not([data-compact])').map(n=>({preset:n.dataset.datePreset,disabled:n.disabled})),custom:one('[data-action=open-closed-date-filter]').getAttribute('aria-disabled'),chip:one('[data-field-label=结束方式] [data-slot=select-trigger]').disabled,submit:one('.search-main button[type=submit]').disabled,exit:one('.search-main button[type=button]').disabled,refresh:one('button[aria-label=刷新]').disabled,scope:all('.ds-board-summary [data-summary-filter]').every(n=>n.getAttribute('aria-disabled')==='true'),qWritable:!one('.search-main input[name=q]').matches(':disabled'),url:location.search};})()"));
  assert.ok(Array.isArray(state.dates)&&state.dates.length===4);for(const date of state.dates)assert.equal(object(date).disabled,true);assert.equal(state.custom,'true');for(const key of ['chip','submit','exit','refresh','scope','qWritable'])assert.equal(state[key],true,key);metrics.held=state;
  const pointerClick=async(selector:string)=>{const point=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||!n.checkVisibility())return null;const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`));assert.ok(typeof point.x==='number'&&typeof point.y==='number');await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await b.command('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await b.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});};
  for(const selector of ['[data-field-label=结束方式] [data-slot=select-trigger]','[data-date-preset=week]:not([data-compact])','[data-action=open-closed-date-filter]','.search-main button[type=submit]','.search-main button[type=button]','button[aria-label=刷新]','.ds-board-summary [data-summary-filter=all]'])await pointerClick(selector);
  const draft='重叠查询草稿（合成）';await clickWorkbenchControl(b,'.search-main input[name=q]');await b.command('Input.insertText',{text:draft});await b.waitFor(`document.querySelector('.search-main input[name=q]').value===${JSON.stringify(draft)}`);await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(reads.length,2,'disabled interactions and editing q cannot start another search');assert.equal(await b.evaluate('location.search'),state.url);assert.equal(await b.evaluate("document.querySelector('[data-action=open-closed-date-filter]').closest('details').open"),false);assert.equal(await b.evaluate("[...document.querySelectorAll('[role=option]')].some(n=>n.checkVisibility())"),false);assert.equal(reads.some(row=>row.status===429),false);
  await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const clip=await b.evaluate("(()=>{const r=document.querySelector('.ds-board-toolbar').getBoundingClientRect(),x=Math.max(0,Math.floor(r.left+scrollX)-8),y=Math.max(0,Math.floor(r.top+scrollY)-8);return {x,y,width:Math.ceil(r.right+scrollX)+8-x,height:Math.ceil(r.bottom+scrollY)+8-y,scale:1};})()"),shot=object(await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip}));assert.ok(typeof shot.data==='string');const bytes=Buffer.from(shot.data,'base64'),file=join(directory,'search-controls-locked-1440.png');await writeFile(file,bytes);const viewport=object(await b.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport.scale,platform:navigator.platform})'));assert.equal(viewport.dpr,1);assert.equal(viewport.zoom,1);if(process.platform==='win32')assert.equal(viewport.platform,'Win32');screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex'),viewport});
  await clickWorkbenchControl(b,'.view-tabs button[aria-pressed=false]');await b.waitFor("new URLSearchParams(location.search).get('view')==='board'&&document.querySelectorAll('.board-column').length===3");await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(reads.length,2,'switching view cannot replace the unfinished search');assert.equal(await b.evaluate("document.querySelector('[data-date-preset=today]:not([data-compact])').disabled"),true);const heldView=object(await b.evaluate("({range:new URLSearchParams(location.search).get('range'),from:new URLSearchParams(location.search).get('closed_from'),to:new URLSearchParams(location.search).get('closed_to'),kind:new URLSearchParams(location.search).get('closure_kind')})"));assert.deepEqual(heldView,{range:'custom',from:ids.today,to:ids.today,kind:'dismissed'});metrics.heldViewSwitch=heldView;
  releaseGate();await b.waitFor("document.querySelector('.board-column.closed .ds-stage-count')?.textContent==='4'&&document.querySelector('[data-date-preset=today]:not([data-compact])')?.disabled===false&&document.querySelector('.search-main button[type=submit]')?.disabled===false&&document.querySelector('.search-main button[type=button]')?.disabled===false&&document.querySelector('button[aria-label=刷新]')?.disabled===false");
  assert.equal(await b.evaluate("document.querySelector('.search-main input[name=q]').value"),draft);assert.equal(reads[1]?.status,200);const todayRequest=new URL(reads[1]?.url??'',f.origin).searchParams;assert.equal(todayRequest.get('range'),'custom');assert.equal(todayRequest.get('closed_from'),ids.today);assert.equal(todayRequest.get('closed_to'),ids.today);assert.equal(todayRequest.get('closure_kind'),'dismissed');
  await clickWorkbenchControl(b,'.view-tabs button[aria-pressed=false]');await b.waitFor("new URLSearchParams(location.search).get('view')==='list'&&document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='4'&&document.querySelector('[data-field-label=结束方式] [data-slot=select-trigger]')?.disabled===false");assert.equal(reads.length,2);metrics.unlockedOnBoard=true;
  await chooseWorkbenchSelect(b,'[data-field-label=结束方式]','completed');await b.waitFor("document.querySelector('.list-group[aria-label=已处理] .column-heading>span')?.textContent==='4'&&document.querySelector('[data-field-label=结束方式] [data-slot=select-trigger]')?.disabled===false");
  assert.equal(await b.evaluate("document.querySelector('.search-main input[name=q]').value"),draft);assert.equal(reads.length,3);assert.ok(reads.every(row=>row.status===200));assert.ok(reads.length<20);assert.deepEqual(posts,[]);assert.deepEqual((await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,before);assert.deepEqual((await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,eventCount);metrics.released={dismissedToday:4,completedToday:4,qPreserved:true};metrics.searchRequests=reads.length;metrics.businessPosts=posts;
 }catch(error){failure=error;}
 finally{
  releaseGate();if(waitTimer)clearTimeout(waitTimer);f.pool.connect=originalConnect;for(const restore of [...restoreQueries.values()])restore();
  await closeBrowserTestResources([async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},()=>{f.runtime.server.off('request',observe);},()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',windowQueriesHeld:heldCount,searches:reads,metrics,screenshots},null,2))],failure);
 }
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchBoardActionsEnabled:true,workbenchSearchEnabled:true}));

test('Card 17 stages, date presets and custom calendar keep the original read-only range requests',{timeout:240000},()=>withT42BoardBrowser(async(f,browser)=>{
  await browser.command('Page.bringToFront');
  await browser.waitFor("document.querySelectorAll('.ds-stage-glyph').length===3");
  for(const stage of ['pending','active','closed']){
    assert.equal(await browser.evaluate(`document.querySelector('[data-stage-glyph=${stage}]')?.getAttribute('aria-hidden')`),'true');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.board-column.${stage} .column-heading')).borderTopWidth`),'0px');
  }
  assert.equal(await browser.evaluate("document.querySelector('[data-stage-glyph=pending] circle').getAttribute('stroke-dasharray')"),'2.4 2.1');
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-stage-glyph=active] circle,[data-stage-glyph=active] path').length"),2);
  assert.equal(await browser.evaluate("document.querySelector('[data-stage-glyph=active] path').getAttribute('d')"),'M8 4.5A3.5 3.5 0 0 1 8 11.5Z');
  assert.equal(await browser.evaluate("document.querySelector('[data-stage-glyph=active] circle').getAttribute('stroke-width')"),'1.6');
  assert.deepEqual(await browser.evaluate("(()=>{const s=getComputedStyle(document.querySelector('[data-date-preset=recent]'));return [s.fontSize,s.paddingLeft,s.height];})()"),['13px','12px','28px']);
  assert.equal(await browser.evaluate("document.querySelector('[data-stage-glyph=closed] .ds-stage-check').getAttribute('d')"),'m5 8.2 2 2 4-4.2');
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.board-column.active .ds-column-sort,.ds-column-sort-note'))"),false);
  assert.match(String(await browser.evaluate("document.querySelector('.board-column.closed .ds-column-sort').textContent")),/最新完成/u);
  assert.equal(await browser.evaluate("document.querySelector('[data-date-preset=recent]').getAttribute('aria-pressed')"),'true');
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.ds-board-page-header')).minHeight"),'0px');
  const reads:string[]=[];const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='GET'&&request.url?.startsWith('/api/workbench/board?'))reads.push(request.url);};f.runtime.server.on('request',observe);
  const waitRead=(matches:(url:string)=>boolean)=>new Promise<void>((resolve,reject)=>{
    if(reads.some(matches)){resolve();return;}
    const listener=()=>{if(reads.some(matches)){clearTimeout(timer);f.runtime.server.off('request',listener);resolve();}};
    const timer=setTimeout(()=>{f.runtime.server.off('request',listener);reject(Error('Expected range request; observed '+JSON.stringify(reads)));},5000);
    f.runtime.server.on('request',listener);
  });
  const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),week=new Date(Date.parse(day+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
  try{
    for(const [preset,from] of [['today',day],['week',week],['month',day.slice(0,8)+'01'],['recent',null]] as const){
      await clickWorkbenchControl(browser,`[data-date-preset=${preset}]:not([data-compact])`);
      await browser.waitFor(`new URLSearchParams(location.search).get('range')===${JSON.stringify(from?'custom':'recent')}&&${from?`new URLSearchParams(location.search).get('closed_from')===${JSON.stringify(from)}`:'true'}`);
      await browser.waitFor("document.querySelector('.board-column.closed .column-cards')!==null");
      await waitRead(url=>{const p=new URL(url,f.origin).searchParams;return p.get('column')==='closed'&&p.get('range')===(from?'custom':'recent')&&(!from||p.get('closed_from')===from&&p.get('closed_to')===day);});
      assert.ok(reads.some(url=>{const p=new URL(url,f.origin).searchParams;return p.get('column')==='closed'&&p.get('range')===(from?'custom':'recent')&&(!from||p.get('closed_from')===from&&p.get('closed_to')===day);}),'preset must send its existing range parameters: '+preset);
    }
    await clickWorkbenchControl(browser,'[data-action=open-closed-date-filter]');
    await browser.waitFor("document.querySelector('.processed-date-picker [role=spinbutton]')?.checkVisibility()");
    await typeWorkbenchDates(browser,'2024-02-29','2024-03-01');
    await clickWorkbenchControl(browser,'[aria-label=选择已处理日期]');
    await browser.waitFor("document.querySelectorAll('.processed-date-popover [data-slot=range-calendar-cell]').length>=28");
    await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await clickWorkbenchControl(browser,'[aria-label=应用已处理日期]');
    await browser.waitFor("new URLSearchParams(location.search).get('closed_from')==='2024-02-29'&&new URLSearchParams(location.search).get('closed_to')==='2024-03-01'");
    await waitRead(url=>{const p=new URL(url,f.origin).searchParams;return p.get('column')==='closed'&&p.get('range')==='custom'&&p.get('closed_from')==='2024-02-29'&&p.get('closed_to')==='2024-03-01';});
    assert.ok(reads.some(url=>{const p=new URL(url,f.origin).searchParams;return p.get('column')==='closed'&&p.get('range')==='custom'&&p.get('closed_from')==='2024-02-29'&&p.get('closed_to')==='2024-03-01';}));
    assert.deepEqual(await browser.evaluate("(()=>{const e=document.querySelector('[data-date-preset=custom]'),s=getComputedStyle(e);return [e.dataset.dateSelected,e.getAttribute('aria-current'),e.closest('details').open,s.backgroundColor,s.fontWeight,s.boxShadow!=='none'];})()"),['true','true',false,'rgb(255, 255, 255)','600',true]);
    // Choosing a range manually must remain visibly custom even when it equals a preset.
    await clickWorkbenchControl(browser,'[data-action=open-closed-date-filter]');
    await typeWorkbenchDates(browser,day,day);
    await clickWorkbenchControl(browser,'[aria-label=应用已处理日期]');
    await browser.waitFor(`new URLSearchParams(location.search).get('closed_from')===${JSON.stringify(day)}&&new URLSearchParams(location.search).get('closed_to')===${JSON.stringify(day)}&&document.querySelector('[data-date-preset=custom]')?.dataset.dateSelected==='true'&&document.querySelector('[data-date-preset=today]').getAttribute('aria-pressed')==='false'&&document.querySelector('.ds-date-wide').textContent===${JSON.stringify(day.slice(5).replace('-','/')+'–'+day.slice(5).replace('-','/'))}`);
    assert.equal(await browser.evaluate("document.querySelector('.ds-date-wide').textContent"),day.slice(5).replace('-','/')+'–'+day.slice(5).replace('-','/'));
    assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
  }finally{f.runtime.server.off('request',observe);}
},{search:true}));

test('Card 17 combined long filters stay inside the toolbar while date segments keep their original sizes',{timeout:240000},()=>withT42BoardBrowser(async(_f,browser)=>{
  await browser.command('Page.bringToFront');
  await browser.waitFor("Boolean(document.querySelector('[data-field-label=类别]'))");
  for(const width of [1101,1100]){
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.ds-board-filter-pill')].every(n=>{const p=n.getBoundingClientRect(),t=n.querySelector('[data-slot=select-trigger]').getBoundingClientRect(),l=n.querySelector('.ds-filter-prefix').getBoundingClientRect();return t.width<=p.width+1&&l.right<=p.right+1;})"),true);
  }
  await chooseWorkbenchSelect(browser,'[data-field-label=类别]','PATIENT_ACCESS');
  await chooseWorkbenchSelect(browser,'[data-field-label=处理人]','unassigned');
  for(const width of [1920,1440,1280,1101,1100,900]){
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
    await browser.waitFor("(()=>{const t=document.querySelector('.ds-board-toolbar-bottom').getBoundingClientRect(),d=document.querySelector('.ds-board-dates').getBoundingClientRect();return d.right<=t.right+1;})()");
    assert.equal(await browser.evaluate("(()=>{const t=document.querySelector('.ds-board-toolbar-bottom'),r=t.getBoundingClientRect();return t.scrollWidth<=t.clientWidth+1&&[...t.querySelectorAll('.ds-board-filter-pill,.ds-board-dates')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1;});})()"),true);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    if(width<=1100)assert.equal(await browser.evaluate("document.querySelector('.ds-board-dates').getBoundingClientRect().top>document.querySelector('.ds-board-filter-row').getBoundingClientRect().bottom"),true);
    if(width>=1280)assert.equal(await browser.evaluate("Math.abs(document.querySelector('.ds-board-dates').getBoundingClientRect().top-document.querySelector('.ds-board-search').getBoundingClientRect().top)<=1"),true);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.ds-board-filter-pill [data-slot=select-value]')].every(n=>n.clientWidth>=24)"),true);
    assert.equal(await browser.evaluate("(()=>{const value=document.querySelector('.ds-board-filter-pill:last-child [data-slot=select-value]');return value.clientWidth>=value.scrollWidth;})()"),true,'the short assignee value must fit in the current platform font at '+width);
  }
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
},{search:true}));

test('Card 17 advanced search keeps a visible pointer submit and applies the original read criteria',{timeout:240000},()=>withT42BoardBrowser(async(f,browser)=>{
  await clickWorkbenchControl(browser,'.workbench-search .workbench-disclosure-trigger');
  await chooseWorkbenchSelect(browser,'.workbench-select:has(select[name=column])','pending');
  await chooseWorkbenchSelect(browser,'.workbench-select:has(select[name=responsibility])','unassigned');
  for(const width of [1920,1440,1280,900]){
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
    assert.equal(await browser.evaluate("(()=>{const b=document.querySelector('.workbench-search button[type=submit]'),r=b.getBoundingClientRect();return getComputedStyle(b).clipPath==='none'&&r.width>40&&r.height>=24&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),true,'advanced search must retain a visible, unoccluded pointer submit at '+width);
  }
  const reads:string[]=[];const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='GET'&&request.url?.startsWith('/api/workbench/search?'))reads.push(request.url);};f.runtime.server.on('request',observe);
  await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__card27AdvancedRead=false;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/search?')&&response.ok){const c=(await response.clone().json()).criteria;if(c.column==='pending'&&c.responsibility==='unassigned')globalThis.__card27AdvancedRead=true;}return response;};})()");
  try{
    await clickWorkbenchControl(browser,'.workbench-search button[type=submit]');
    await browser.waitFor("new URLSearchParams(location.search).get('column')==='pending'&&new URLSearchParams(location.search).get('responsibility')==='unassigned'&&Boolean(document.querySelector('.ds-board-dates'))&&globalThis.__card27AdvancedRead===true");
    assert.ok(reads.some(url=>{const p=new URL(url,f.origin).searchParams;return p.get('column')==='pending'&&p.get('responsibility')==='unassigned';}));
    assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
  }finally{f.runtime.server.off('request',observe);}
},{search:true}));

test('Card 17 location hint requires both location and all reporter fields missing, and never appears in done',{timeout:240000},()=>withT42BoardBrowser(async(_f,browser,card)=>{
  await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__card17Fields={location:null,reporter_name:null,reporter_department:null};globalThis.__card17Seen=0;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/board?')&&response.ok){const body=await response.clone().json();body.items=body.items.map(item=>item.column==='closed'||item.id===document.querySelector(${JSON.stringify(card)})?.dataset.itemId?{...item,...globalThis.__card17Fields}:item);globalThis.__card17Seen++;const headers=new Headers(response.headers);headers.delete('content-length');return new Response(JSON.stringify(body),{status:response.status,headers});}return response;};})()`);
  for(const [fields,expected] of [[{location:'门诊二楼',reporter_name:null,reporter_department:null},false],[{location:null,reporter_name:'合成报修人',reporter_department:null},false],[{location:null,reporter_name:null,reporter_department:'合成科室'},false],[{location:null,reporter_name:null,reporter_department:null},true]] as const){
    await browser.evaluate(`globalThis.__card17Fields=${JSON.stringify(fields)};globalThis.__card17Seen=0`);
    await clickWorkbenchControl(browser,'.ds-page-header button[aria-label=刷新]');
    await browser.waitFor('globalThis.__card17Seen===3');
    await browser.waitFor(`document.querySelector(${JSON.stringify(card)})?.textContent.includes('待补位置')===${expected}`);
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card)})?.textContent.includes('待补位置')`),expected);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.board-column.closed .ticket-card')].some(card=>card.textContent.includes('待补位置'))"),false);
  }
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
}));

test('Card 12 category, state heat, missing fields and loaded filters use the real read projections',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0];assert.ok(first);
  const service=loadServiceCatalog().listServices().find(s=>s.service_code==='PRINT.PRINTER_DEVICE');assert.ok(service);
  await f.pool.query("UPDATE intake.web_submission SET safe_content=jsonb_set(safe_content,'{service_code}',to_jsonb($2::text)) WHERE intake_id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid) AND kind='SUBMIT'",[first.ticket.id,service.service_code]);
  await clickWorkbenchControl(browser,'.ds-page-header button[aria-label=刷新]');
  await browser.waitFor("document.querySelector('[data-field-label=类别] button')?.disabled===false");
  await clickWorkbenchControl(browser,'.board-column.pending [data-action=expand-column]');
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(card+' [data-category=ENDPOINT_PRINT]')}))`);
  const dto=object((await get('/api/workbench/items/ticket/'+first.ticket.id)).item),projected=object(dto.service);
  assert.equal(projected.code,service.service_code);assert.equal(projected.category,'ENDPOINT_PRINT');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .ds-ticket-category')}).title`),service.category_name_zh+' · '+service.name_zh);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card)}).dataset.ring`),'danger');
  assert.match(String(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .ds-ticket-heat')}).textContent`)),/^超时 \d+ 天$/u);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes('待补位置')`),false);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.ticket-card')].some(n=>/未提供|未登记/.test(n.innerText))"),false);
  assert.equal(await browser.evaluate("document.querySelectorAll('.board-column.closed .ds-ticket-heat').length"),0);
  assert.ok(Number(await browser.evaluate("document.querySelectorAll('.board-column.closed .ds-ticket-completed').length"))>0);
  const active=await get('/api/workbench/board?column=active');assert.ok(Array.isArray(active.items));
  const known=active.items.map(object).find(item=>item.stage_entered_at);assert.ok(known);
  const expected=String(known.stage_entered_at).replace(' ','T')+'+08:00';
  const activeCard='[data-item-id="'+String(known.id)+'"]';
  // The fixture's creation is 30 days ago; current state is recent. Activity updates must not create a false red timeout.
  assert.ok(Date.now()-Date.parse(expected)<4*3_600_000);
  assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(activeCard+' .ds-ticket-heat[data-heat-tone=danger]')}))`),false);
  await chooseWorkbenchSelect(browser,'[data-field-label=类别]',service.category);
  await browser.waitFor("document.querySelectorAll('.ticket-card').length===1");
  assert.equal(await browser.evaluate("document.querySelector('.ticket-card').dataset.itemId"),first.ticket.id);
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0,'filtering is read-only and never a command');
  await chooseWorkbenchSelect(browser,'[data-field-label=处理人]','unassigned');
  assert.equal(await browser.evaluate("document.querySelector('.ticket-card').dataset.itemId"),first.ticket.id);
  await clickWorkbenchControl(browser,card+' .card-open');await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(card)})).outlineWidth`),'2px');
}));

for(const trigger of ['pointer','keyboard'] as const)test('Card 12 '+trigger+' claim reuses one original command and animates the official column change',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0],actor=f.principals[0];assert.ok(first&&actor);
  const original=await get('/api/tickets/'+first.ticket.id);
  await browser.command('Page.bringToFront');
  if(trigger==='pointer')await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__card12ActiveHeld=false;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/board?column=active')&&globalThis.__t42Writes.length){globalThis.__card12ActiveHeld=true;await new Promise(resolve=>{globalThis.__card12ReleaseActive=resolve;});}return response;};})()`);
  await browser.evaluate(`(()=>{globalThis.__card12Motions=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.matches('.ticket-card'))globalThis.__card12Motions.push({id:this.dataset.itemId,duration:options.duration,frames});return animate.call(this,frames,options);};const link=document.querySelector(${JSON.stringify(card+' .card-open')});link.focus();})()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')}).dataset.tone`),'secondary');
  if(trigger==='keyboard'){await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'e',code:'KeyE',windowsVirtualKeyCode:69});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'e',code:'KeyE',windowsVirtualKeyCode:69});}
  else await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  if(trigger==='pointer'){
    await browser.waitFor(`globalThis.__card12ActiveHeld===true&&!document.querySelector(${JSON.stringify('.board-column.pending '+card)})`);
    await browser.evaluate('globalThis.__card12ReleaseActive()');
  }
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify('.board-column.active '+card)}))`);
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1);
  const sent=object((await browser.evaluate('globalThis.__t42Writes'))[0]),body=object(sent.body);
  assert.match(String(body.client_command_id),/^[0-9a-f-]{36}$/u);
  assert.equal(sent.path,'/api/tickets/'+first.ticket.id+'/take-and-start');
  assert.deepEqual(body,{client_command_id:body.client_command_id,expected_version:original.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:original.resolver_team_id});
  const result=await get('/api/tickets/'+first.ticket.id);assert.equal(result.status,'IN_PROGRESS');assert.equal(result.assignee_id,actor.id);
  const motions:unknown=await browser.evaluate('globalThis.__card12Motions');assert.ok(Array.isArray(motions));
  assert.ok(motions.some(motion=>object(motion).id===first.ticket.id&&object(motion).duration===180));
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog'))"),false,'the plain action needs no detail detour');
},{realtime:false}));

test('Card 12 UNKNOWN keeps the original controller and UUID when a current board read moves its card',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0];assert.ok(first);
  await browser.command('Page.bringToFront');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor("Boolean(document.querySelector('.board-claim-controller [data-action=check-self-handling]'))");
  const original=object((await browser.evaluate('globalThis.__t42Writes'))[0]);
  assert.equal((await get('/api/tickets/'+first.ticket.id)).status,'IN_PROGRESS','the response was dropped after the real commit');
  await clickWorkbenchControl(browser,'[data-workbench-toasts] button[aria-label=关闭提示]');
  await clickWorkbenchControl(browser,'.ds-page-header button[aria-label=刷新]');
  await browser.waitFor(`!document.querySelector(${JSON.stringify('.board-column.pending '+card)})`);
  assert.equal(await browser.evaluate("document.querySelector('.board-claim-controller [data-action=check-self-handling]').checkVisibility()"),true);
  f.restoreSelfHandlingResponses();
  await clickWorkbenchControl(browser,'.board-claim-controller [data-action=check-self-handling]');
  await browser.waitFor("document.querySelector('.board-claim-controller [data-board-claim-state]')?.dataset.boardClaimState==='succeeded'");
  const writes:unknown=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(writes));assert.equal(writes.length,2);assert.deepEqual(writes[1],original);
},{dropSelfHandlingResponses:true}));

test('Card 12 combined responsibility claim opens the original choice form without posting',{timeout:240000},()=>withT42BoardBrowser(async(_f,browser,card)=>{
  await browser.command('Page.bringToFront');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor("Boolean(document.querySelector('.detail-dialog .ticket-conversation-handling'))");
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
},{conversationHandling:true}));

test('Card 12 stale claim permission is rejected by the original command without a state or event change',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card)=>{
  const first=f.tickets[0],actor=f.principals[0];assert.ok(first&&actor);
  await browser.command('Page.bringToFront');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  const before=(await f.pool.query('SELECT status,assignee_id,version,(SELECT count(*) FROM pilot_ticket.ticket_event e WHERE e.ticket_id=t.id) AS events FROM pilot_ticket.ticket t WHERE id=$1::uuid',[first.ticket.id])).rows[0];
  await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor('globalThis.__t42Responses.some(response=>response.status===401)');
  const after=(await f.pool.query('SELECT status,assignee_id,version,(SELECT count(*) FROM pilot_ticket.ticket_event e WHERE e.ticket_id=t.id) AS events FROM pilot_ticket.ticket t WHERE id=$1::uuid',[first.ticket.id])).rows[0];
  assert.deepEqual(after,before);assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1);
}));

test('Card 20 K3 K4 categories, spacing and clear filters use real synthetic projections without writes',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown,writes=0;
 const before=(await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows;
 f.runtime.server.on('request',request=>{if(request.method==='POST')writes++;});
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelectorAll('.column-cards').length===3&&document.querySelector('[data-summary-filter=mine] .ds-summary-value')?.textContent==='3'");
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.connection-status'),'::before').display"),'none');
  assert.equal(await b.evaluate("(()=>{const toggle=document.querySelector('.topbar .icon-button'),settings=document.querySelector('.topbar-settings'),a=toggle.getBoundingClientRect(),z=settings.getBoundingClientRect();return toggle.dataset.tone==='ghost'&&a.width===z.width&&a.height===z.height&&a.width===32;})()"),true);
  for(const selector of ['.board-column.pending [data-action=expand-column]','.board-column.active [data-action=expand-column]'])await clickWorkbenchControl(b,selector);
  const cases=[{index:1,label:null,ring:null},{index:2,label:'12 分钟',ring:null},{index:5,label:'45 分钟',ring:null},{index:8,label:'2 小时',ring:'attention'},{index:6,label:'超时 5 小时',ring:'danger'},{index:0,label:'超时 1 天',ring:'danger'}];
  for(const item of cases){const ticket=f.tickets[item.index];assert.ok(ticket);const selector='.board .ticket-card[data-item-id="'+ticket.ticket.id+'"]';
   assert.deepEqual(await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {label:e.querySelector('.ds-ticket-heat')?.textContent??null,ring:e.dataset.ring??null};})()`),{label:item.label,ring:item.ring});
  }
  for(const [index,category,icon] of [[0,'ENDPOINT_PRINT','printer'],[1,'NETWORK_INFRASTRUCTURE','wifi'],[2,'DIAGNOSTIC','scan-line'],[3,'CLINICAL_CORE','stethoscope']] as const){const ticket=f.tickets[index];assert.ok(ticket);assert.equal(await b.evaluate(`Boolean(document.querySelector('.board [data-item-id="${ticket.ticket.id}"] [data-category=${category}] .lucide-${icon}'))`),true);}
  assert.equal(await b.evaluate("document.querySelectorAll('.board [data-category=unclassified]').length>=2"),true);
  for(const width of [1920,1440,1280,900]){
   await b.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
   const metrics=await b.evaluate("(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {title:r('.ds-board-toolbar-top').top-r('.ds-board-page-header h1').bottom,tabs:r('.ds-board-toolbar-bottom').top-r('.ds-board-toolbar-top').bottom,board:r('.board').top-r('.ds-board-toolbar-bottom').bottom,background:getComputedStyle(document.querySelector('.board')).backgroundColor,metadata:[...document.querySelectorAll('.board .ds-ticket-metadata')].filter(e=>e.checkVisibility()).map(e=>e.nextElementSibling.getBoundingClientRect().top-e.getBoundingClientRect().bottom),overflow:document.documentElement.scrollWidth>innerWidth};})()");
   assert.ok(metrics&&typeof metrics==='object');const m=metrics as {title:number;tabs:number;board:number;background:string;metadata:number[];overflow:boolean};
   // The 36px icon determines the heading row; its centered 32px h1 is inset within that row.
   const titleOffset=await b.evaluate("document.querySelector('.ds-board-page-header .ds-page-heading-line').getBoundingClientRect().bottom-document.querySelector('.ds-board-page-header h1').getBoundingClientRect().bottom") as number;
   assert.ok(Number.isFinite(titleOffset)&&titleOffset>=0,JSON.stringify({width,titleOffset}));
   console.log('CARD26_HEADER_ANCHOR '+JSON.stringify({width,titleTextGap:m.title,titleOffset,blockGap:m.title-titleOffset}));
   for(const [actual,target] of [[m.title-titleOffset,12],[m.tabs,12],[m.board,16]] as const)assert.ok(Math.abs(actual-target)<=1,JSON.stringify({width,m}));
   assert.equal(m.background,'rgba(0, 0, 0, 0)');assert.equal(m.overflow,false);assert.ok(m.metadata.every(gap=>Math.abs(gap-8)<=1));
  }
  await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
  // Card 26: use the existing Web fixture writes and real catalog projection for visual coverage.
  await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const card26=await b.evaluate("(()=>{const tiles=[...document.querySelectorAll('.board .ds-ticket-category')].filter(n=>{const r=n.getBoundingClientRect();return n.checkVisibility()&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});return {platform:navigator.platform,width:innerWidth,height:innerHeight,scale:devicePixelRatio,viewportScale:visualViewport.scale,categories:tiles.map(n=>({category:n.dataset.category,color:getComputedStyle(n).backgroundColor})),lanes:[...document.querySelectorAll('.ds-board-column')].map(n=>{const s=getComputedStyle(n);return {outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow};})};})()") as {platform:string;width:number;height:number;scale:number;viewportScale:number;categories:{category:string;color:string}[];lanes:{outlineStyle:string;outlineWidth:string;shadow:string}[]};
  assert.equal(card26.width,1440);assert.equal(card26.scale,1);assert.equal(card26.viewportScale,1);
  assert.ok(new Set(card26.categories.filter(tile=>tile.category!=='unclassified').map(tile=>tile.category)).size>=4,JSON.stringify(card26.categories));
  assert.ok(new Set(card26.categories.filter(tile=>tile.category!=='unclassified').map(tile=>tile.color)).size>=4,JSON.stringify(card26.categories));
  assert.ok(card26.categories.some(tile=>tile.category==='unclassified'),'one unclassified tile remains visible');
  assert.equal(card26.lanes.length,3);
  for(const lane of card26.lanes){assert.equal(lane.outlineStyle,'none');assert.equal(lane.outlineWidth,'0px');assert.match(lane.shadow,/rgba\(55, 53, 47, 0\.05\)/u);assert.match(lane.shadow,/0px 0px 0px 1px inset/u);}
  const card26Directory=process.env.CARD26_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card26-board-'));await mkdir(card26Directory,{recursive:true});
  await captureCard22(b,card26Directory,'board-1440');await writeFile(join(card26Directory,'board-metrics.json'),JSON.stringify(card26,null,2));
  console.log('CARD26_BOARD '+JSON.stringify({directory:card26Directory,...card26}));
  assert.match(String(await b.evaluate("document.querySelector('[data-summary-filter=all]').title")),/已加载 15 项；计数基于已加载数据/u);
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.range-bar')).position"),'absolute');
  assert.equal(await b.evaluate("document.querySelector('.search-main input').placeholder"),'搜索工单号、标题、报修人');
  assert.equal(await b.evaluate("(()=>{const input=document.querySelector('.search-main input').getBoundingClientRect(),trigger=document.querySelector('.workbench-search .workbench-disclosure-trigger').getBoundingClientRect(),icon=document.querySelector('.ds-search-options svg').getBoundingClientRect();return trigger.left>=input.left&&trigger.right<=input.right&&icon.width===16&&icon.height===16;})()"),true);
  assert.equal(await b.evaluate("document.querySelector('.workbench-search .workbench-disclosure-trigger').getAttribute('aria-label')"),'搜索选项');
  assert.equal(await b.evaluate("document.querySelector('.workbench-search .workbench-disclosure-trigger').title"),'搜索选项');
  // A Router transition can publish its URL before the new range owns the rendered controls.
  // Observe the existing date read so summary selection captures the current range scope.
  await b.evaluate("(()=>{const original=globalThis.fetch;globalThis.__card27CurrentDateRead=false;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/board?')){const q=new URL(String(path),location.href).searchParams;if(q.get('column')==='closed'&&q.get('range')==='custom'&&response.ok)globalThis.__card27CurrentDateRead=true;}return response;};})()");
  await clickWorkbenchControl(b,'[data-date-preset=today]:not([data-compact])');
  await b.waitFor("globalThis.__card27CurrentDateRead===true&&new URLSearchParams(location.search).get('range')==='custom'&&document.querySelectorAll('.column-cards').length===3");
  await clickWorkbenchControl(b,'[data-summary-filter=overdue]');
  await b.waitFor("document.querySelector('[data-summary-filter=overdue]').getAttribute('aria-pressed')==='true'");
  await chooseWorkbenchSelect(b,'[data-field-label=类别]','ENDPOINT_PRINT');
  assert.equal(await b.evaluate("document.querySelector('[data-action=clear-board-filters]')===null"),true);
  await chooseWorkbenchSelect(b,'[data-field-label=处理人]','unassigned');
  await b.waitFor("Boolean(document.querySelector('[data-action=clear-board-filters]'))");
  const search=await b.evaluate('location.search');
  await clickWorkbenchControl(b,'[data-action=clear-board-filters]');
  assert.equal(await b.evaluate('location.search'),search);assert.equal(await b.evaluate("document.querySelector('[data-summary-filter=overdue]').getAttribute('aria-pressed')"),'true');
  assert.equal(await b.evaluate("document.querySelectorAll('.ds-board-filter-pill[data-filter-active]').length"),0);
  await b.close();browser=undefined;
  const zero=f.browserCookies[2];assert.ok(zero);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...zero,url:f.origin+'/'}]});assert.ok(browser);
  await browser.waitFor("document.querySelector('[data-summary-filter=mine] .ds-summary-value')?.textContent==='0'");
  assert.equal(writes,0);assert.deepEqual((await f.pool.query('SELECT id::text,status,version,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,before);
 }catch(error){failure=error;}
 await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchFollowEnabled:true,workbenchSearchEnabled:true}));

test('Card 20 K3 unavailable ownership projection omits the count and explains why',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);
  await browser.waitFor("document.querySelectorAll('.column-cards').length===3");assert.equal(await browser.evaluate("document.querySelector('[data-summary-filter=mine] .ds-summary-value')===null"),true);assert.match(String(await browser.evaluate("document.querySelector('[data-summary-filter=mine]').title")),/当前没有本人处理关系资料，暂无法统计/u);
 }catch(error){failure=error;}await closeBrowserTestResources([async()=>{await browser?.close();}],failure);
}));

test('R1 R2 R5 card22 avatars, shared overdue membership and aligned board filters',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard22Board(f),directory=process.env.CARD22_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card22-board-'));await mkdir(directory,{recursive:true});
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;const metrics:unknown[]=[],posts:string[]=[];
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);
  const ready="Boolean(document.querySelector('[data-summary-filter=overdue] .ds-summary-value'))&&document.querySelectorAll('.column-cards .ticket-card').length>=9";
  await browser.waitFor(ready);await browser.evaluate("[...document.querySelectorAll('[data-action=expand-column]')].filter(n=>n.getAttribute('aria-expanded')==='false').forEach(n=>n.click())");
  await browser.waitFor("document.querySelectorAll('.board [data-heat-tone=danger]').length===2");
  const cards=await browser.evaluate("[...document.querySelectorAll('.board [data-item-id]')].map(n=>({id:n.dataset.itemId,kind:n.dataset.kind,column:n.closest('.board-column').className,heat:n.querySelector('[data-heat-tone]')?.dataset.heatTone??null}))") as {id:string;kind:string;column:string;heat:string|null}[];
  for(const [key,tone] of [['a','danger'],['b','danger'],['c','warning'],['d',null],['e',null]])assert.equal(cards.find(card=>card.id===ids[key??''])?.heat,tone,key??'');
  assert.equal(await browser.evaluate("Number(document.querySelector('[data-summary-filter=overdue] .ds-summary-value').textContent)"),2);
  metrics.push({R2:cards,avatars:await assertCard22Avatars(browser)});
  for(const width of [1920,1440]){await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('document.fonts.ready');await captureCard22(browser,directory,'board-'+width);}
  const defaults=await card22Filters(browser,'.ds-board-search');assert.ok(defaults.search);assertCard22Filters(defaults);assert.ok(defaults.chips.every(chip=>!chip.active));metrics.push({R5:'board-inactive',...defaults});
  await chooseWorkbenchSelect(browser,'[data-field-label="类别"]','unclassified');
  const active=await card22Filters(browser,'.ds-board-search');assertCard22Filters(active);assert.ok(active.chips.some(chip=>chip.active));metrics.push({R5:'board-active',...active});await captureCard22(browser,directory,'toolbar-board-1440','.ds-board-toolbar-bottom');
  await clickWorkbenchControl(browser,'[aria-label="清除类别筛选"]');
  await browser.evaluate("[...document.querySelectorAll('[data-action=expand-column]')].filter(n=>n.getAttribute('aria-expanded')==='false').forEach(n=>n.click())");
  await captureCard22(browser,directory,'avatar-board-owner','.board [data-item-id="'+ids.b+'"] .ds-ticket-owner');
  await captureCard22(browser,directory,'avatar-sidebar-account','.account-menu-trigger');
  await clickWorkbenchControl(browser,'[data-summary-filter=overdue]');
  await browser.waitFor("document.querySelectorAll('.board [data-item-id]').length===2");
  assert.deepEqual((await browser.evaluate("[...document.querySelectorAll('.board [data-item-id]')].map(n=>n.dataset.itemId)") as string[]).sort(),[ids.a,ids.b].sort());
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await captureCard22(browser,directory,'board-overdue-1920');
  await clickWorkbenchControl(browser,'.board [data-item-id="'+ids.b+'"] .card-open');await browser.waitFor("Boolean(document.querySelector('.property-field .ds-avatar[title=\"周宁（合成）\"]'))");
  metrics.push({R1:'drawer',avatars:await assertCard22Avatars(browser)});await captureCard22(browser,directory,'drawer-1920');await captureCard22(browser,directory,'avatar-drawer-owner','.property-field:has(.lucide-headset) dd');
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});await captureCard22(browser,directory,'drawer-1440');
  await f.pool.query("UPDATE intake.manual_review_item SET created_at=platform.local_now()-interval '5 hours' WHERE status='PENDING'");
  await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'});await browser.waitFor(ready);await browser.evaluate("[...document.querySelectorAll('[data-action=expand-column]')].filter(n=>n.getAttribute('aria-expanded')==='false').forEach(n=>n.click())");
  await browser.waitFor("document.querySelectorAll('.board [data-heat-tone=danger]').length===3");
  const red=await browser.evaluate("[...document.querySelectorAll('.board [data-heat-tone=danger]')].map(n=>({id:n.closest('[data-item-id]').dataset.itemId,kind:n.closest('[data-kind]').dataset.kind}))") as {id:string;kind:string}[];
  assert.ok(red.some(row=>row.kind==='review'));assert.equal(await browser.evaluate("Number(document.querySelector('[data-summary-filter=overdue] .ds-summary-value').textContent)"),red.length);
  await clickWorkbenchControl(browser,'[data-summary-filter=overdue]');await browser.waitFor("document.querySelectorAll('.board [data-item-id]').length===3");
  assert.deepEqual((await browser.evaluate("[...document.querySelectorAll('.board [data-item-id]')].map(n=>n.dataset.itemId)") as string[]).sort(),red.map(row=>row.id).sort());metrics.push({R2:'non-ticket-red',red});
  assert.deepEqual(posts,[],'R1/R2/R5 presentation never invokes a business command');
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([
  async()=>{if(failure&&browser)await captureCard22(browser,directory,'board-failure');},
  ()=>writeFile(join(directory,'board-metrics.json'),JSON.stringify(metrics,null,2)),
  ()=>{f.runtime.server.off('request',observe);},
  async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
 ],failure);}
},{precisionV212:true,workbenchSearchEnabled:true}));
