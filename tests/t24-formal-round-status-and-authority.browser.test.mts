// SOURCE_REGISTERED_NOT_RUN. Mechanical copy of preserved external first; original body, roles, flags[] and 240000ms budget retained.
// Future SOURCE prerequisite: apply only the accompanying default-false capability-off fixture option.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Reply={items:{delivery_id:string;node:string;cycle_no:number;destination_type:string;status:string;attempt_count:number;side_effect_state:string;sent_at:string|null}[]};
type Read={path:string;status:number;body:Reply};
const region='[role="region"][aria-label="报修人通知送达"]';
const instrument=`(()=>{const original=globalThis.fetch;globalThis.__t24PCReads=[];globalThis.__t24PCWrites=[];globalThis.__t24PCBootstrap=[];
  globalThis.fetch=async(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='GET')globalThis.__t24PCWrites.push({path,method});
    const response=await original(input,options);
    if(method==='GET'&&path.endsWith('/deliveries'))globalThis.__t24PCReads.push({path,status:response.status,body:await response.clone().json()});
    if(method==='GET'&&path==='/api/lifecycle/bootstrap')globalThis.__t24PCBootstrap.push({status:response.status,body:await response.clone().json()});
    return response;};})()`;
const render=()=>`(()=>{const r=document.querySelector(${JSON.stringify(region)});return r?.innerText.includes('首次责任')&&r.innerText.includes('工作人员完工')&&(r.innerText.match(/待发送/g)??[]).length===2;})()`;
const click=()=>`(()=>{const r=document.querySelector(${JSON.stringify(region)}),b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新读取通知');if(!b)throw Error('T24_REAL_REQUERY_BUTTON_REQUIRED');b.click();})()`;
async function load(browser:Browser){
  await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});
  const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'&&Boolean(document.querySelector('#detail-title'))`);
}
async function receiptScreenshot(browser:Browser){
  const imageDirectory=join(tmpdir(),'web01-ui-'+randomUUID());
  await mkdir(imageDirectory);
  return screenshot(browser,imageDirectory,'new-detail-1920');
}
async function screenshot(browser:Browser,directory:string,name:string){
  const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name+'.png');await writeFile(file,pixels);
  return {file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};
}

test('formal compiled PC reads actual round states, explicitly requeries, evicts lost Ticket authorization and honors disabled capability',{timeout:240000},async()=>{
  const directory=join(tmpdir(),'t24-formal-pc-'+randomUUID());await mkdir(directory);
  await withT24Fixture(async context=>{
    const id=context.ticketId,producer=await t11Http(context),reader=await t11Http(context,2),started=await producer.start(id);
    await context.runtime.roundNotifications.runOnce();
    assert.equal((await producer.post(id,'complete',{...producer.command(started),internal_process:'INTERNAL_T24_PC_CANARY：仅内部合成过程',external_summary:'合成服务已恢复。'})).status,200);
    await context.runtime.roundNotifications.runOnce();
    const completed=await producer.detail(id);assert.equal(completed.status,'CLOSED');
    const path='/api/tickets/'+id+'/deliveries',response=await reader.get(path);assert.equal(response.status,200);
    const actual=await response.json() as Reply;
    assert.deepEqual(actual.items.map(x=>({node:x.node,cycle:x.cycle_no,route:x.destination_type,status:x.status,attempts:x.attempt_count,effect:x.side_effect_state,sent:x.sent_at})).sort((a,b)=>a.node.localeCompare(b.node)),[
      {node:'FIRST_RESPONSIBILITY',cycle:1,route:'PERSON',status:'PENDING',attempts:0,effect:'NOT_ATTEMPTED',sent:null},
      {node:'STAFF_COMPLETED',cycle:1,route:'PERSON',status:'PENDING',attempts:0,effect:'NOT_ATTEMPTED',sent:null},
    ]);
    const physical=async()=>(await context.pool.query<{messages:string[];outboxes:string[];deliveries:string[];bindings:string[];rounds:string[];attempts:string[];grants:number}>(`SELECT
      ARRAY(SELECT id::text FROM communication.message ORDER BY id) AS messages,
      ARRAY(SELECT id::text FROM communication.outbox ORDER BY id) AS outboxes,
      ARRAY(SELECT id::text FROM communication.delivery ORDER BY id) AS deliveries,
      ARRAY(SELECT id::text FROM communication.ticket_notification_binding ORDER BY id::text) AS bindings,
      ARRAY(SELECT cycle_id::text||':'||node||':'||recipient_binding_hash||':'||destination_type FROM communication.ticket_round_notification_binding ORDER BY 1) AS rounds,
      ARRAY(SELECT id::text FROM communication.delivery_attempt ORDER BY id::text) AS attempts,
      (SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants`)).rows[0];
    const baseline=await physical();assert.ok(baseline);assert.equal(baseline.grants,0);
    for(const item of actual.items)assert.ok(baseline.deliveries.includes(item.delivery_id));
    const cookie=context.browserCookies[2];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T24_REAL_READER_COOKIE_REQUIRED');
    let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await load(browser);
        await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(region)})?.querySelector('li'))`);
        assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).querySelector('details').open`),false,'notification diagnostics start folded');
        await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).querySelector('summary').click()`);
        await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.querySelector('li')?.checkVisibility()===true`);
        await browser.waitFor(render());
      const visible=await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).innerText`) as string;
      assert.equal(visible.includes('处理轮次 1'),true);assert.equal(visible.includes('原报修人单聊'),true);assert.equal(visible.includes('尝试次数 0'),true);assert.equal(visible.includes('尚未尝试'),true);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).querySelectorAll('li').length`),2);
      assert.equal(await browser.evaluate('globalThis.__t24PCBootstrap.at(-1).body.ticket_round_notifications_enabled'),true);
      const reads=await browser.evaluate('globalThis.__t24PCReads') as Read[];assert.ok(reads.length);assert.equal(reads.at(-1)?.path,path);assert.equal(reads.at(-1)?.status,200);
      assert.deepEqual(reads.at(-1)?.body.items.map(x=>x.delivery_id).sort(),actual.items.map(x=>x.delivery_id).sort());
      await browser.evaluate(click());await browser.waitFor(`globalThis.__t24PCReads.length>${reads.length}`);await browser.waitFor(render());
      const reread=await browser.evaluate('globalThis.__t24PCReads.at(-1)') as Read;assert.equal(reread.path,path);assert.equal(reread.status,200);assert.deepEqual(reread.body.items,actual.items);
      for(const marker of ['INTERNAL_T24_PC_CANARY','user-test','bot-test']){assert.equal(visible.includes(marker),false);assert.equal(JSON.stringify(reread.body).includes(marker),false);}
      const positive=await receiptScreenshot(browser);
      // Change only real synthetic access facts through the existing Port. No business SQL or browser identity override.
      const readerId=context.principals[1]?.id;assert.ok(readerId);
      const principal=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[readerId])).rows[0];assert.ok(principal);
      const updated=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:[]});assert.equal(updated.id,readerId);
      const count=await browser.evaluate('globalThis.__t24PCReads.length') as number;await browser.evaluate(click());
      await browser.waitFor(`globalThis.__t24PCReads.length>${count}&&[401,403,404].includes(globalThis.__t24PCReads.at(-1).status)`);
      await browser.waitFor(`!document.querySelector(${JSON.stringify(region)})?.querySelector('li')`);
      const rejected=await browser.evaluate('globalThis.__t24PCReads.at(-1)') as {path:string;status:number};assert.equal(rejected.path,path);assert.ok([401,403,404].includes(rejected.status));
      const negative=await receiptScreenshot(browser);
      assert.deepEqual(await browser.evaluate('globalThis.__t24PCWrites'),[]);assert.deepEqual(await physical(),baseline);
      const after=await producer.detail(id);assert.equal(after.status,'CLOSED');assert.equal(after.version,completed.version);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T24_FORMAL_LIST_REFRESH_AUTH',screenshots:[positive,negative]}));
    }catch(failure){
      error=failure;try{if(browser){await screenshot(browser,directory,'failure');await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,reads:globalThis.__t24PCReads,writes:globalThis.__t24PCWrites})')));}}
      catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T24_PC_FAILURE_EVIDENCE');}
      console.log('T24_BROWSER_FAILURE '+JSON.stringify({directory}));
    }
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{manualRoundConsumption:true,roundNotificationsOff:false});
  // Sequential fresh fixture/browser: no overlap, stale profile or fake capability. This is not process-restart evidence.
  await withT24Fixture(async context=>{
    const http=await t11Http(context,2),bootstrapResponse=await http.get('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);
    const bootstrap=await bootstrapResponse.json() as {ticket_round_notifications_enabled:boolean};assert.equal(bootstrap.ticket_round_notifications_enabled,false);
    const cookie=context.browserCookies[2];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T24_DISABLED_COOKIE_REQUIRED');
    let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+context.ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);await load(browser);
      await browser.waitFor('globalThis.__t24PCBootstrap.length>0');
      assert.equal(await browser.evaluate('globalThis.__t24PCBootstrap.at(-1).body.ticket_round_notifications_enabled'),false);
      assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(region)}))`),false);
      assert.deepEqual(await browser.evaluate('globalThis.__t24PCReads'),[]);assert.deepEqual(await browser.evaluate('globalThis.__t24PCWrites'),[]);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T24_FORMAL_CAPABILITY_OFF',screenshots:[await receiptScreenshot(browser)]}));
    }catch(failure){error=failure;try{if(browser)await screenshot(browser,directory,'disabled-failure');}catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T24_PC_DISABLED_FAILURE_EVIDENCE');}console.log('T24_BROWSER_FAILURE '+JSON.stringify({directory}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{manualRoundConsumption:true,roundNotificationsOff:true});
});
