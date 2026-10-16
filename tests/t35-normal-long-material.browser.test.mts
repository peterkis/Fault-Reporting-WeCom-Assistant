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
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];Object.defineProperty(document,'visibilityState',{get:()=>globalThis.__t35Visible?'visible':'hidden',configurable:true});const fetchOriginal=fetch;globalThis.fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/read-position'))globalThis.__t35Posts.push(JSON.parse(options.body));return fetchOriginal(path,options);};})()`});assert.ok(browser);
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id+'?detail=page'});
    await browser.waitFor(`document.querySelector('.activity-list')?.textContent.includes(${JSON.stringify(text)})`);
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    const locate=`[...document.querySelectorAll('.activity-list p')].find(p=>p.textContent===${JSON.stringify(text)})`;
    await browser.evaluate(`(()=>{globalThis.__t35Body=${locate};if(!globalThis.__t35Body)throw Error('ACTUAL_BODY_REQUIRED');globalThis.__t35Body.scrollIntoView({block:'start'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);
    const height=await browser.evaluate('globalThis.__t35Body.getBoundingClientRect().height');assert.ok(typeof height==='number'&&height>720,'legitimate material is taller than the viewport');
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[],'only the first portion has been seen');
    assert.equal((await position())?.last_read_position,'0');
    for(let step=0;step<Math.ceil(height/250)+3;step++)await browser.evaluate(`new Promise(resolve=>{let root=globalThis.__t35Body.parentElement;while(root&&!(root.scrollHeight>root.clientHeight&&['auto','scroll'].includes(getComputedStyle(root).overflowY)))root=root.parentElement;if(root)root.scrollBy(0,250);else window.scrollBy(0,250);requestAnimationFrame(()=>requestAnimationFrame(resolve));})`);
    await browser.waitFor('globalThis.__t35Posts.some(command=>command.revision===\'2\')');
    assert.equal((await position())?.last_read_position,'2');assert.equal((await position(1))?.last_read_position,'0');
    const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'normal-long-body-1280.png');await writeFile(file,bytes);
    console.log('T35_NORMAL_LONG '+JSON.stringify({actual_body_height:height,source:'BOT',normal_ticket_without_review:true,screenshots:[{file,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
  }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
