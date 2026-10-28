import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {appendReviewMaterial} from './helpers/wbint-t14-review-material.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 a normal Ticket without Review advances a long actual Bot body only after its full foreground scroll', {timeout:120_000},()=>withT35Fixture(async f=>{
  const selected=f.tickets[1];assert.ok(selected);const text='T35长正文：'+'合成材料逐段核对，不含真实人员信息。'.repeat(200);
  await appendReviewMaterial(f.pool,selected.intake.intakeId,text);
  const path='/api/workbench/items/ticket/'+selected.ticket.id,readPath=path+'/read-position';
  const item=await (await f.get(path)).json() as {review_refs:{id:string}[];records:{text:string|null}[]};
  assert.deepEqual(item.review_refs,[]);assert.ok(item.records.some(record=>record.text===text));
  const position=async(reader:0|1=0)=>(await (await f.get(readPath,reader)).json() as {sources:{last_read_position:string;latest_position:string}[]}).sources[0];
  assert.equal((await position())?.last_read_position,'0');assert.equal((await position())?.latest_position,'2');
  const directory=join(tmpdir(),'t35-normal-long-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:720,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];globalThis.__t35Replies=[];Object.defineProperty(document,'visibilityState',{get:()=>globalThis.__t35Visible?'visible':'hidden',configurable:true});const fetchOriginal=fetch;globalThis.fetch=async(path,options)=>{const body=options?.method==='POST'&&String(path).endsWith('/read-position')?JSON.parse(options.body):null;if(body)globalThis.__t35Posts.push(body);const response=await fetchOriginal(path,options);if(body)globalThis.__t35Replies.push({revision:body.revision,status:response.status});return response;};})()`});assert.ok(browser);
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id+'?detail=page'});
    await browser.waitFor(`document.querySelector('.activity-list')?.textContent.includes(${JSON.stringify(text)})`);
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    const locate=`[...document.querySelectorAll('.activity-list .record-text')].find(p=>p.textContent===${JSON.stringify(text)})`;
    await browser.evaluate(`(()=>{globalThis.__t35Body=${locate};if(!globalThis.__t35Body)throw Error('ACTUAL_BODY_REQUIRED');globalThis.__t35Body.scrollIntoView({block:'start'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await browser.evaluate('globalThis.__t35Body.scrollWidth>globalThis.__t35Body.clientWidth'),true,'the unexpanded source is visibly truncated');
    assert.deepEqual(await browser.evaluate("globalThis.__t35Posts.filter(row=>row.revision==='2')"),[],'ellipsis must not acknowledge the unread long revision; visible older short records may advance independently');
    await browser.evaluate("globalThis.__t35Body.closest('.record-content').click()");
    const height=await browser.evaluate('globalThis.__t35Body.getBoundingClientRect().height');assert.ok(typeof height==='number'&&height>720,'expanded legitimate material is taller than the viewport');
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.deepEqual(await browser.evaluate("globalThis.__t35Posts.filter(row=>row.revision==='2')"),[],'only the first portion of the long revision has been seen');
    assert.notEqual((await position())?.last_read_position,'2');
    for(let step=0;step<Math.ceil(height/250)+3;step++)await browser.evaluate(`new Promise(resolve=>{let root=globalThis.__t35Body.parentElement;while(root&&!(root.scrollHeight>root.clientHeight&&['auto','scroll'].includes(getComputedStyle(root).overflowY)))root=root.parentElement;if(root)root.scrollBy(0,250);else window.scrollBy(0,250);requestAnimationFrame(()=>requestAnimationFrame(resolve));})`);
    await browser.waitFor('globalThis.__t35Replies.some(reply=>reply.revision===\'2\'&&reply.status===200)');
    assert.equal((await position())?.last_read_position,'2');assert.equal((await position(1))?.last_read_position,'0');
    const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'normal-long-body-1280.png');await writeFile(file,bytes);
    console.log('T35_NORMAL_LONG '+JSON.stringify({actual_body_height:height,source:'BOT',normal_ticket_without_review:true,screenshots:[{file,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
  }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));

test('T35 an open cancellation dialog pauses otherwise visible source reading until it closes',{timeout:120_000},()=>withT35Fixture(async f=>{
  const selected=f.tickets[0];assert.ok(selected);const text='T35弹窗遮挡：'+'合成材料需要实际阅读。'.repeat(8);
  await appendReviewMaterial(f.pool,selected.intake.intakeId,text);
  const readPath='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position';
  const current=await f.get('/api/tickets/'+selected.ticket.id);assert.equal(current.status,200);assert.ok((await current.json() as {allowed_actions:string[]}).allowed_actions.includes('cancel'),'overlay scenario must use a legally cancellable Ticket');
  const position=async()=>(await (await f.get(readPath)).json() as {sources:{last_read_position:string}[]}).sources[0]?.last_read_position;
  const directory=join(tmpdir(),'t35-modal-'+randomUUID());await mkdir(directory);
  let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{globalThis.__visible=false;globalThis.__readPosts=[];Object.defineProperty(document,'visibilityState',{get:()=>globalThis.__visible?'visible':'hidden',configurable:true});const original=fetch;globalThis.fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/read-position'))globalThis.__readPosts.push(JSON.parse(options.body));return original(path,options);};})()"});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id+'?detail=page'});
    await browser.waitFor(`document.querySelector('.activity-list')?.textContent.includes(${JSON.stringify(text)})&&document.querySelector('[data-action=cancel]')?.disabled===false`);
    await browser.evaluate("document.querySelector('[data-action=cancel]').focus();document.querySelector('[data-action=cancel]').click()");await browser.waitFor("Boolean(document.querySelector('.detail-cancel-dialog'))");
    await browser.evaluate(`(()=>{globalThis.__material=[...document.querySelectorAll('.activity-list .record-text')].find(p=>p.textContent===${JSON.stringify(text)});globalThis.__material.closest('.record-content').click();globalThis.__material.scrollIntoView({block:'center'});globalThis.__visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('scroll'));})()`);
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.deepEqual(await browser.evaluate('globalThis.__readPosts'),[]);assert.equal(await position(),'0','visible source behind the modal remains unread');
    assert.equal(await browser.evaluate("document.activeElement.closest('[data-workbench-overlay]')===document.querySelector('.detail-cancel-dialog')"),true);
    await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await browser.waitFor("!document.querySelector('.detail-cancel-dialog')");
    assert.equal(await browser.evaluate("document.activeElement===document.querySelector('[data-action=cancel]')"),true,'close restores trigger focus');
    await browser.evaluate("globalThis.__material.scrollIntoView({block:'center'});window.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('focus'))");
    await browser.waitFor("globalThis.__readPosts.some(row=>row.revision==='2')");
    for(let attempt=0;attempt<100&&await position()!=='2';attempt++)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(await position(),'2');
  }catch(error){failure=error;if(browser)await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__readPosts,active:document.activeElement?.outerHTML})')));}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{waiting:true}));
