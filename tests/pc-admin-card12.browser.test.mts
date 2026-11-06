import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {clickWorkbenchControl,chooseWorkbenchSelect,typeWorkbenchDates} from './helpers/heroui-workbench-controls.mjs';
import {loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';
import {withWeb01Fixture,seedCard22Board} from './helpers/web01-workbench-fixture.mjs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {card22Filters,assertCard22Filters,assertCard22Avatars,captureCard22} from './helpers/card22-presentation.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

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
  try{
    await clickWorkbenchControl(browser,'.workbench-search button[type=submit]');
    await browser.waitFor("new URLSearchParams(location.search).get('column')==='pending'&&new URLSearchParams(location.search).get('responsibility')==='unassigned'&&!document.querySelector('.ds-board-dates')");
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
  await clickWorkbenchControl(b,'[data-date-preset=today]:not([data-compact])');
  await b.waitFor("new URLSearchParams(location.search).get('range')==='custom'&&document.querySelectorAll('.column-cards').length===3");
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
