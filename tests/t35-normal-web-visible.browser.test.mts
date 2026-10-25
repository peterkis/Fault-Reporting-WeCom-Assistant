import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {createYxxSelfServiceAuthorization} from '../app/server/src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceStore} from '../app/server/src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../app/server/src/yxx-self-service-orchestrator.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 normal Web Ticket without Review acknowledges only its actual original submission body',{timeout:120_000},()=>withT35Fixture(async f=>{
  const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
  const auth={profile:'MEMBER_SELF_SERVICE',write_flag:true,flags,csrf_token:'synthetic-local-csrf',canonical_reporter_binding:createHash('sha256').update(randomUUID()).digest('hex'),source_corp_scope:'t35-synthetic-corp',source_app_scope:'t35-synthetic-app',proof_ref:'tests/t35-normal-web'};
  const authorization=createYxxSelfServiceAuthorization<null>({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async()=>auth,recheck:Object.assign(async()=>auth,{localOnly:true as const})});
  const context=await authorization.authorize({request:null,operation:'WEB_COMMAND',source:'WEB'});assert.ok(context.scope);
  const store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:'t35-synthetic-web-source-secret'}),description='处方提交不了';
  const accepted=await store.accept({scope:context.scope,input:{schema_version:1,client_command_id:randomUUID(),description,location:{text:'本部8层',unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null}});
  const processed=await createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags}).processOne({requestRef:accepted.receipt.request_ref});
  assert.equal(processed.processed,true);assert.ok('ticket_id' in processed);assert.ok(processed.ticket_id);assert.equal(processed.result_code,'TICKET_ELIGIBLE');
  const itemPath='/api/workbench/items/ticket/'+processed.ticket_id,path=itemPath+'/read-position';
  type Detail={description:string;review_refs:unknown[];records:{audience:string;text:string;read_material?:{source_ref:string;revision:string}}[];responsibility:unknown};
  const response=await f.get(itemPath);assert.equal(response.status,200);const detail=await response.json() as Detail;assert.deepEqual(detail.review_refs,[]);assert.equal(detail.description,description);
  const source=detail.records.find(record=>record.audience==='REPORT'&&record.text===description)?.read_material;assert.ok(source);assert.match(source.source_ref,/^web:[a-f0-9-]{36}$/u);assert.equal(source.revision,'1');
  const page=async(reader:0|1=0)=>(await (await f.get(path,reader)).json() as {sources:{source_kind:string;last_read_position:string;latest_position:string}[]}).sources;
  assert.deepEqual((await page()).map(s=>[s.source_kind,s.last_read_position,s.latest_position]),[['WEB','0','1']]);assert.equal((await page(1))[0]?.last_read_position,'0');
  assert.deepEqual((await (await f.get(itemPath+'/conversations')).json() as {items:unknown[]}).items,[]);
  const directory=join(tmpdir(),'t35-normal-web-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];globalThis.__t35Acks=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const write=options?.method==='POST'&&String(path).endsWith('/read-position');if(write)globalThis.__t35Posts.push(JSON.parse(options.body));return original(path,options).then(async response=>{if(write&&response.status===200)globalThis.__t35Acks.push(await response.clone().json());return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+processed.ticket_id+'?detail=page'});await browser.waitFor(`[...document.querySelectorAll('.activity-list p[data-personal-read-ref]')].some(p=>p.getAttribute('data-personal-read-ref')===${JSON.stringify(source.source_ref) }&&p.getAttribute('data-personal-read-revision')==='1'&&p.textContent===${JSON.stringify(description)})`);assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    await browser.evaluate(`(()=>{const body=[...document.querySelectorAll('.activity-list p[data-personal-read-ref]')].find(p=>p.getAttribute('data-personal-read-ref')===${JSON.stringify(source.source_ref)}&&p.getAttribute('data-personal-read-revision')==='1'&&p.textContent===${JSON.stringify(description)});if(!body)throw Error('ACTUAL_WEB_BODY_REQUIRED');body.scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);
    await browser.waitFor("globalThis.__t35Acks.some(ack=>ack.source_kind==='WEB'&&ack.last_read_position==='1')");
    assert.deepEqual((await browser.evaluate('globalThis.__t35Posts') as {source_ref:string;revision:string}[]).map(post=>[post.source_ref,post.revision]),[[source.source_ref,'1']]);assert.equal((await page())[0]?.last_read_position,'1');assert.equal((await page(1))[0]?.last_read_position,'0');
    const after=await (await f.get(itemPath)).json() as Detail;assert.deepEqual(after.records,detail.records);assert.deepEqual(after.responsibility,detail.responsibility);assert.deepEqual(after.review_refs,[]);
    await writeFile(join(directory,'normal-web-body-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_NORMAL_WEB '+JSON.stringify({directory,normal_ticket_without_review:true,exact_submission_ref:source.source_ref,revision:'1',other_reader:'0',no_session:true,public_local_source_ports:true}));
  }catch(error){failure=error;if(browser)try{await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,acks:globalThis.__t35Acks})')));}catch(diagnosticError){failure=new AggregateError([error,diagnosticError],'T35_PRIMARY_AND_DIAGNOSTIC_FAILURE');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
