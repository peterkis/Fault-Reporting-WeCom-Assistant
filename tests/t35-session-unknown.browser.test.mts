// Registered Session cursor delivery-fault tracer; external preparation remains unrun.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchManualReports} from '../scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../scripts/workbench-personal-read-migrate.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 a lost Session cursor ACK is checked through its current own cursor on the next real foreground observation',{timeout:120_000},()=>withT22Fixture(async f=>{
  const session=f.sessions[0],other=f.sessions[1];assert.ok(session);assert.ok(other);
  await f.runtime.stop();const input={databaseUrl:f.databaseUrl,mode:'apply'};await migrateP2012(input);await migrateYxxSelfService(input);await migrateWorkbenchManualReports(input);await migrateWorkbenchPersonalRead(input);
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.principals[1]?.id??''],externalSendEnabled:false,workbenchConversationsEnabled:true,workbenchManualReviewEnabled:true,workbenchPersonalReadEnabled:true});
  let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;const directory=join(tmpdir(),'t35-session-unknown-'+randomUUID());await mkdir(directory);
  try{
    const {cookies}=await runtime.start();assert.ok(cookies);const a=cookies[0],b=cookies[1];assert.ok(a);assert.ok(b);
    const get=(path:string,second=false)=>fetch(f.origin+path,{headers:{cookie:(second?b:a).name+'='+(second?b:a).value}}),path='/api/conversations/'+session.id;
    const cursor=async(id:string,second=false)=>(await (await get('/api/conversations/'+id,second)).json() as {read_cursor:{last_read_sequence:string}}).read_cursor;
    const sourcePath='/api/workbench/items/ticket/'+session.ticketId+'/read-position',source=await (await get(sourcePath)).json();
    assert.equal((await cursor(session.id)).last_read_sequence,'0');
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...a,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];globalThis.__t35Commits=[];globalThis.__t35CurrentChecks=[];globalThis.__t35LoseAck=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const value=String(path),write=options?.method==='POST'&&value.endsWith('/read-cursor');if(write)globalThis.__t35Posts.push({path:value,body:JSON.parse(options.body)});return original(path,options).then(async response=>{if(write&&response.status===200&&globalThis.__t35LoseAck){globalThis.__t35LoseAck=false;globalThis.__t35Commits.push(await response.clone().json());throw new TypeError('T35 authentic Session ACK delivery lost after COMMIT');}if(value===${JSON.stringify(path)}&&options?.method!=='POST'&&globalThis.__t35Commits.length)globalThis.__t35CurrentChecks.push({status:response.status,body:await response.clone().json()});return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});await browser.waitFor("Boolean(document.querySelector('p[data-session-read-sequence=\"1\"]'))");assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    const show="(()=>{document.querySelector('p[data-session-read-sequence=\"1\"]').scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()";
    await browser.evaluate(show);await browser.waitFor('globalThis.__t35Commits.length===1');
    const original=await browser.evaluate('globalThis.__t35Posts') as {path:string;body:{client_command_id:string;last_read_sequence:number}}[];assert.equal(original.length,1);assert.equal(original[0]?.body.last_read_sequence,1);
    assert.equal((await cursor(session.id)).last_read_sequence,'1');console.log('T35_SESSION_UNKNOWN_COMMIT '+JSON.stringify({delivery_failed:true,actual_cursor:'1',original_uuid:original[0]?.body.client_command_id}));
    await browser.evaluate("globalThis.__t35Visible=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'))");await browser.evaluate(show);
    await browser.waitFor("globalThis.__t35CurrentChecks.some(response=>response.status===200&&response.body.read_cursor.last_read_sequence==='1')");
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),original,'current cursor confirmation must not generate another UUID or POST');assert.equal((await cursor(session.id,true)).last_read_sequence,'0');assert.equal((await cursor(other.id)).last_read_sequence,'0');assert.deepEqual(await (await get(sourcePath)).json(),source);
    await writeFile(join(directory,'session-original-cursor-check-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_SESSION_UNKNOWN_CHECKED '+JSON.stringify({directory,own_current_cursor:true,posts:1,no_new_receipt_route:true}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,commits:globalThis.__t35Commits,current_checks:globalThis.__t35CurrentChecks})')));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],failure);
}));
