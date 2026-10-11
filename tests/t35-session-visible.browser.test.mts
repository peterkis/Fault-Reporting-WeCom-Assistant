import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT22Fixture,appendT22LiveItem} from './helpers/wbint-t22-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchManualReports} from '../scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../scripts/workbench-personal-read-migrate.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 actual Session items use their own cursor without latest metadata, other Session or source-position writes',{timeout:120_000},()=>withT22Fixture(async f=>{
  const session=f.sessions[0],other=f.sessions[1];assert.ok(session);assert.ok(other);
  for(let i=0;i<32;i++)await appendT22LiveItem(f.pool,session.id,'T35合成会话材料 '+i+'，仅实际可见正文算阅读。');
  await f.runtime.stop();const input={databaseUrl:f.databaseUrl,mode:'apply'};await migrateP2012(input);await migrateYxxSelfService(input);await migrateWorkbenchManualReports({databaseUrl:f.databaseUrl,mode:'apply'});await migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'apply'});
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.principals[1]?.id??''],externalSendEnabled:false,workbenchConversationsEnabled:true,workbenchManualReviewEnabled:true,workbenchPersonalReadEnabled:true});
  let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;const directory=join(tmpdir(),'t35-session-visible-'+randomUUID());await mkdir(directory);
  try{
    const {cookies}=await runtime.start();assert.ok(cookies);const a=cookies[0],b=cookies[1];assert.ok(a);assert.ok(b);
    const get=(path:string,second=false)=>fetch(f.origin+path,{headers:{cookie:(second?b:a).name+'='+(second?b:a).value}});
    const cursor=async(id:string,second=false)=>(await (await get('/api/conversations/'+id,second)).json() as {read_cursor:{last_read_sequence:string}}).read_cursor;
    const sourcePath='/api/workbench/items/ticket/'+session.ticketId+'/read-position';
    const beforeSource=await (await get(sourcePath)).json();assert.equal((await cursor(session.id)).last_read_sequence,'0');
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...a,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35SessionPosts=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{if(options?.method==='POST'&&/\/(read-cursor|read-position)$/.test(String(path)))globalThis.__t35SessionPosts.push({path:String(path),body:JSON.parse(options.body)});return original(path,options);};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});
    await browser.waitFor("document.querySelector('[data-conversation-timeline]')?.textContent.includes('参与者甲的打印机主题')");
    assert.deepEqual(await browser.evaluate('globalThis.__t35SessionPosts'),[]);assert.equal((await cursor(session.id)).last_read_sequence,'0');
    await browser.evaluate("(()=>{document.querySelector('[data-conversation-timeline] li p').scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()");
    await browser.waitFor("globalThis.__t35SessionPosts.some(row=>row.path.endsWith('/read-cursor'))");
    await browser.waitFor(`fetch('/api/conversations/${session.id}').then(r=>r.json()).then(v=>BigInt(v.read_cursor.last_read_sequence)>0n)`);
    const actual=BigInt((await cursor(session.id)).last_read_sequence);assert.ok(actual>0n&&actual<33n,'unseen latest metadata does not become the cursor');
    assert.equal((await cursor(other.id)).last_read_sequence,'0');assert.equal((await cursor(session.id,true)).last_read_sequence,'0');
    assert.deepEqual(await (await get(sourcePath)).json(),beforeSource,'Session sequence never advances the Intake sequence');
    const posts=await browser.evaluate('globalThis.__t35SessionPosts') as {path:string}[];assert.ok(posts.every(row=>row.path.endsWith('/read-cursor')));
    await writeFile(join(directory,'actual-session-material-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_SESSION_VISIBLE '+JSON.stringify({directory,actual_sequence:String(actual),latest_metadata:'33',other_session:'0',other_reader:'0'}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35SessionPosts})')));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],failure);
}));
