import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 a normal telephone Ticket without Review acknowledges only its actual immutable original body',{timeout:120_000},()=>withT35Fixture(async f=>{
  const description='合成电话报修：打印机无法打印',command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description,location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'T35合成电话报修人',contact:'合成内线1234',department:null}};
  const admission=await f.post('/api/workbench/reports',command);assert.equal(admission.status,202,await admission.clone().text());
  const admitted=await admission.json() as {intake_id:string;ticket:{id:string}|null;review:unknown;external_notification:boolean};assert.ok(admitted.ticket);assert.equal(admitted.review,null);assert.equal(admitted.external_notification,false);
  const itemPath='/api/workbench/items/ticket/'+admitted.ticket.id,path=itemPath+'/read-position';
  const detail=await (await f.get(itemPath)).json() as {description:string;review_refs:unknown[];records:unknown[];responsibility:unknown};assert.deepEqual(detail.review_refs,[]);assert.equal(detail.description,description);
  const page=async(reader:0|1=0)=>(await (await f.get(path,reader)).json() as {sources:{source_kind:string;last_read_position:string;latest_position:string}[]}).sources;
  assert.deepEqual((await page()).map(s=>[s.source_kind,s.last_read_position,s.latest_position]),[['MANUAL','0','1']]);
  assert.deepEqual((await (await f.get(itemPath+'/conversations')).json() as {items:unknown[]}).items,[]);
  const directory=join(tmpdir(),'t35-normal-manual-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];globalThis.__t35Acks=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const write=options?.method==='POST'&&String(path).endsWith('/read-position');if(write)globalThis.__t35Posts.push(JSON.parse(options.body));return original(path,options).then(async response=>{if(write&&response.status===200)globalThis.__t35Acks.push(await response.clone().json());return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+admitted.ticket.id+'?detail=page'});
    await browser.waitFor(`[...document.querySelectorAll('.activity-list .record-text[data-personal-read-ref]')].some(p=>p.getAttribute('data-personal-read-ref')===${JSON.stringify('manual:'+admitted.intake_id) }&&p.getAttribute('data-personal-read-revision')==='1'&&p.textContent===${JSON.stringify(description)})`);assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    await browser.evaluate(`(()=>{const text=${JSON.stringify(description)},body=[...document.querySelectorAll('.activity-list .record-text[data-personal-read-ref]')].find(p=>p.getAttribute('data-personal-read-ref')===${JSON.stringify('manual:'+admitted.intake_id)}&&p.getAttribute('data-personal-read-revision')==='1'&&p.textContent===text);if(!body)throw Error('ACTUAL_MANUAL_BODY_REQUIRED');body.scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);
    await browser.waitFor(`globalThis.__t35Acks.some(ack=>ack.source_kind==='MANUAL'&&ack.last_read_position==='1')`);
    const posts=await browser.evaluate('globalThis.__t35Posts') as {source_ref:string;revision:string}[];assert.ok(posts.some(p=>p.source_ref==='manual:'+admitted.intake_id&&p.revision==='1'));
    assert.equal((await page())[0]?.last_read_position,'1');assert.equal((await page(1))[0]?.last_read_position,'0');
    const after=await (await f.get(itemPath)).json() as typeof detail;assert.deepEqual(after.records,detail.records);assert.deepEqual(after.responsibility,detail.responsibility);assert.deepEqual(after.review_refs,[]);
    await writeFile(join(directory,'normal-manual-body-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_NORMAL_MANUAL '+JSON.stringify({directory,normal_ticket_without_review:true,immutable_position:'1',other_reader:'0',no_session:true}));
  }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,acks:globalThis.__t35Acks})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
