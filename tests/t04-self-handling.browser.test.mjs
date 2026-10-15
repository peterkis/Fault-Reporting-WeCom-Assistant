import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

async function handlingBrowser(context,run,{width=1920,page=true}={}){
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const screenshots=[];let browser,error;
  try{
    browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+context.tickets[0].ticket.id+(page?'?detail=page':''),width,height:1080,cookies:[context.browserCookies[0]]});
    await browser.waitFor("document.querySelector('.ticket-handling-version')?.textContent==='工单版本 2'&&document.querySelector('[data-action=take-and-start]')?.disabled===false");
    const capture=async name=>{const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    await run(browser,capture);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',ticket_self_handling:true,screenshots}));
  }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate("({text:document.body.innerText,commands:globalThis.__t04Posts})")));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
}
const instrument="(()=>{const original=globalThis.fetch;globalThis.__t04Posts=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t04Posts.push({path:String(path),body:JSON.parse(options.body)});return original(path,options);};})()";

test('production Ticket-only controls use one POST, GET refresh, and reuse the accept-for-later cycle',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots=[];let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+tickets[0].ticket.id+'?detail=page',width:1920,height:1080,cookies:[browserCookies[0]]});
      const capture=async name=>{const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
      await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
      await browser.waitFor("Boolean(document.querySelector('[data-action=take-and-start]'))");
      assert.equal(await browser.evaluate("document.querySelector('[data-action=take-and-start]')?.textContent"),'我来处理');
      assert.equal(await browser.evaluate("document.querySelector('[data-action=accept-for-later]')?.textContent"),'先接单，稍后处理');
      await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t04Posts=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t04Posts.push({path:String(path),body:JSON.parse(options.body)});return original(path,options);};document.querySelector('[data-action=take-and-start]').click();})()");
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('已开始处理')&&document.querySelector('.properties')?.innerText.includes('处理中')&&document.querySelector('.properties')?.innerText.includes('林舟')&&document.querySelector('.ticket-handling-version')?.textContent==='工单版本 4'&&document.querySelector('.ticket-handling-cycle')?.textContent.includes('处理轮次 1')");
      assert.equal(await browser.evaluate('globalThis.__t04Posts.length'),1);
      assert.ok(await browser.evaluate("document.querySelector('.ticket-handling-cycle')?.textContent.includes('处理轮次 1')"));
      await capture('new-detail-1920.png');
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+tickets[1].ticket.id+'?detail=page'});
      await browser.waitFor("Boolean(document.querySelector('[data-action=accept-for-later]'))");
      await browser.evaluate("document.querySelector('[data-action=accept-for-later]').click()");
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('已接单')&&document.querySelector('.properties')?.innerText.includes('已领取')&&document.querySelector('.ticket-handling-version')?.textContent==='工单版本 4'");
      const accepted=await browser.evaluate(`fetch('/api/tickets/${tickets[1].ticket.id}').then(r=>r.json())`);
      assert.equal(accepted.status,'ACCEPTED');assert.equal(accepted.handling_cycle.cycle_no,1);
      await browser.waitFor("document.querySelector('[data-action=take-and-start]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('已开始处理')&&document.querySelector('.properties')?.innerText.includes('处理中')");
      const started=await browser.evaluate(`fetch('/api/tickets/${tickets[1].ticket.id}').then(r=>r.json())`);
      assert.deepEqual(started.handling_cycle,accepted.handling_cycle);assert.equal(started.version,5);
      await capture('new-detail-page-1920.png');
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',ticket_self_handling:true,screenshots}));
    }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`(async()=>({text:document.body.innerText,commands:globalThis.__t04Posts,context:await fetch('/api/tickets/${tickets[0].ticket.id}').then(r=>r.json()),responsibility:await fetch('/api/tickets/${tickets[0].ticket.id}/responsibility').then(r=>r.json())}))()`)));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{ticketSelfHandlingEnabled:true});
});

for(const fault of ['disconnect','invalid-success'])test('formal self handling keeps the original intent and verifies one cycle after '+fault,async()=>{
  await withWeb01Fixture(async context=>{
    await handlingBrowser(context,async(browser,capture)=>{
      await browser.evaluate(instrument);
      await browser.command('Network.enable');await browser.command('Network.emulateNetworkConditions',{offline:false,latency:250,downloadThroughput:-1,uploadThroughput:-1});
      await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('正在提交')");
      assert.equal(await browser.evaluate("document.querySelector('[data-action=accept-for-later]').disabled"),true);
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('结果未知')");
      await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      assert.equal(await browser.evaluate('globalThis.__t04Posts.length'),1);
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').disabled"),true);
      const before=await browser.evaluate(`fetch('/api/tickets/${context.tickets[0].ticket.id}').then(r=>r.json())`);assert.equal(before.version,4);assert.equal(before.handling_cycle.cycle_no,1);
      await capture('new-detail-1920.png');context.restoreSelfHandlingResponses();
      await browser.evaluate("document.querySelector('[data-action=check-self-handling]').click()");
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('已核对：原操作已开始处理')&&document.querySelector('.ticket-handling-version')?.textContent==='工单版本 4'&&document.querySelector('.properties')?.innerText.includes('林舟')");
      const intents=await browser.evaluate('globalThis.__t04Posts');assert.equal(intents.length,2);assert.deepEqual(intents[1],intents[0]);assert.equal(intents[0].body.expected_version,2);
      const after=await browser.evaluate(`fetch('/api/tickets/${context.tickets[0].ticket.id}').then(r=>r.json())`);assert.deepEqual(after.handling_cycle,before.handling_cycle);assert.equal(after.version,4);
      assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[context.tickets[0].ticket.id])).rows[0].n,1);
      await capture('new-detail-page-1920.png');
    });
  },{ticketSelfHandlingEnabled:true,dropSelfHandlingResponses:fault==='disconnect',malformedSelfHandlingSuccess:fault==='invalid-success'});
});

test('another actor winning causes a refreshed conflict, and later identity loss clears all cached actions',async()=>{
  await withWeb01Fixture(async context=>{
    await handlingBrowser(context,async(browser,capture)=>{
      const bootstrap=await (await fetch(context.origin+'/api/lifecycle/bootstrap',{headers:{cookie:context.cookies[2]}})).json();
      const body={client_command_id:randomUUID(),expected_version:2,reason_code:'T04_COMPETING_ACTOR',resolver_team_id:'PILOT_IT'};
      const response=await fetch(context.origin+'/api/tickets/'+context.tickets[0].ticket.id+'/accept-for-later',{method:'POST',headers:{cookie:context.cookies[2],origin:context.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"2"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});assert.equal(response.status,200);
      await browser.evaluate(instrument);await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
      await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('操作冲突')&&document.querySelector('.ticket-handling-version')?.textContent==='工单版本 3'&&document.querySelector('.properties')?.innerText.includes('陈悦')");
      assert.equal(await browser.evaluate('globalThis.__t04Posts.length'),1);assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=take-and-start]'))"),false);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await capture('new-detail-900.png');
      await browser.command('Page.navigate',{url:context.origin+'/workbench/app/items/ticket/'+context.tickets[1].ticket.id+'?detail=page'});
      await browser.waitFor("document.querySelector('.ticket-handling-version')?.textContent==='工单版本 2'&&document.querySelector('[data-action=take-and-start]')?.disabled===false");
      await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[context.principals[0].id]);
      await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
      await browser.waitFor("(document.body.innerText.includes('会话已失效')||document.body.innerText.includes('当前身份没有查看权限'))&&!document.querySelector('.sidebar')&&!document.querySelector('.ticket-self-handling')");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('#detail-title'))"),false);
    },{width:900});
  },{ticketSelfHandlingEnabled:true});
});

test('malformed object denial is authoritative and the original 600px shell stays bounded',async()=>{
  await withWeb01Fixture(async context=>{
    await handlingBrowser(context,async(browser,capture)=>{
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),600);
      await capture('new-detail-1920.png');
      await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
      await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
      await browser.waitFor("document.body.innerText.includes('事项不存在，或不在当前授权范围内')&&!document.querySelector('.ticket-self-handling')");
      assert.equal(await browser.evaluate("document.body.innerText.includes('结果未知')"),false);
      assert.equal(await browser.evaluate("document.body.innerText.includes('仅供内部的合成处理记录')"),false);
    },{page:false});
  },{ticketSelfHandlingEnabled:true,malformedSelfHandlingDenial:true});
});

// Final-review failure-path regression: real owned CDP disconnection, no fake Browser.
test('ALL43 disconnected diagnostics retain the primary failure and close the owned browser',async()=>{
  await withWeb01Fixture(async context=>{
    let owned,caught;
    try{
      try{await handlingBrowser(context,async browser=>{
        owned=browser;
        const info=await browser.command('Target.getTargetInfo');
        try{await browser.command('Target.closeTarget',{targetId:info.targetInfo.targetId});}catch{/* the owned target really disconnects */}
        throw Error('ALL43_ORIGINAL_BUSINESS_FAILURE');
      });}catch(error){caught=error;}
      const messages=error=>error instanceof AggregateError?error.errors.flatMap(messages):[error instanceof Error?error.message:String(error)];
      const observed={messages:messages(caught),owned:owned?.ownedResourceState()};
      console.log('ALL43_BROWSER_DIAGNOSTIC_CLEANUP '+JSON.stringify(observed));
      assert.deepEqual(observed.owned,{processes:0,profiles:0,commandTimers:0,sockets:0});
      assert.ok(observed.messages.includes('ALL43_ORIGINAL_BUSINESS_FAILURE'));
      assert.ok(observed.messages.some(message=>message!=='ALL43_ORIGINAL_BUSINESS_FAILURE'));
    }finally{await owned?.close();}
  },{ticketSelfHandlingEnabled:true});
});
