import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {IncomingMessage} from 'node:http';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser,fillWaiting} from './helpers/t10-browser-fixture.mjs';

test('closing only waiting write and raw recovery preserves current readable detail and the original explicit safe ACK while another recovery purpose remains active',async()=>{
  await withT10Fixture(async context=>{
    const handler=await t11Http(context,2,{closeConnections:true}),target=context.tickets[0];assert.ok(target);await handler.start(target.ticket.id);
    const path='/api/tickets/'+target.ticket.id+'/request-information',requests:{method:string;path:string}[]=[];
    const observe=(request:IncomingMessage)=>{if(request.url===path||request.url?.startsWith(path+'/commands/'))requests.push({method:request.method??'',path:request.url});};context.runtime.server.on('request',observe);
    try{await withT10Browser(context,target.ticket.id,2,'T10_WAITING_ONLY_CAPABILITY_CLOSE',async(browser,capture)=>{
      await browser.evaluate(`(()=>{const original=fetch;globalThis.__t10Posts=[];globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(options?.method==='POST'&&String(path)===${JSON.stringify(path)}&&response.status===200){globalThis.__t10Posts.push(JSON.parse(options.body));throw new TypeError('T10_ACTUAL_COMMITTED_RESPONSE_LOST');}return response;};})()`);
      await browser.waitFor("Boolean(document.querySelector('[data-action=request-information]'))&&!document.querySelector('[data-action=request-information]').disabled");await browser.evaluate("document.querySelector('[data-action=request-information]').click()");
      const form='form[aria-label="等待报修人"]',input=form+' textarea[aria-label="等待原因"]';await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);await browser.evaluate(fillWaiting(input,'INTERNAL_T10_CAPABILITY_CANARY：仅关闭原文恢复。'));
      await browser.waitFor(`!document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).click()`);await browser.waitFor("globalThis.__t10Posts.length===1&&document.body.innerText.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t10Posts[0]') as {client_command_id:string};assert.ok(original.client_command_id);
      assert.equal((await handler.detail(target.ticket.id)).status,'WAITING_REQUESTER');
      await context.runtime.stop();
      const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:false,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
      runtime.server.on('request',observe);
      try{
        const started=await runtime.start();assert.ok(started.cookies);const closed=await t11Http({...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)},2,{closeConnections:true});
        const bootstrap=await (await closed.get('/api/lifecycle/bootstrap')).json() as {ticket_waiting_actions_enabled:boolean;ticket_waiting_action_draft_recovery_enabled:boolean;draft_recovery_enabled:boolean};assert.equal(bootstrap.ticket_waiting_actions_enabled,false);assert.equal(bootstrap.ticket_waiting_action_draft_recovery_enabled,false);assert.equal(bootstrap.draft_recovery_enabled,true,'the existing Shell listener stays active for the unrelated internal note purpose');
        assert.equal((await closed.get('/api/tickets/'+target.ticket.id)).status,200,'actual Ticket READ remains allowed');
        for(const cookie of started.cookies){assert.ok(cookie.url);await browser.command('Network.setCookie',{...cookie,url:cookie.url});}
        await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{globalThis.__t10Revocations=[];const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.onmessage=event=>{if(event.data?.reason==='revoked')globalThis.__t10Revocations.push(event.data);};globalThis.__t10CloseObserver=()=>channel.close();})()"});
        const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
        await browser.waitFor("document.body.innerText.includes('只读核对')||document.body.innerText.includes('无权访问')||document.body.innerText.includes('不可访问')||document.body.innerText.includes('未找到')");
        console.log('T10_CLOSED_CAPABILITY_STAGE '+JSON.stringify({actualReadStatus:200,write:false,raw:false,otherRecovery:true,text:await browser.evaluate('document.body.innerText')}));
        assert.equal(await browser.evaluate("Boolean(document.querySelector('#detail-title'))"),true,'purpose-local sensitive removal must not turn current READ into a cached 404');
        await browser.waitFor("Boolean(document.querySelector('[data-action=check-request-information-command]'))");assert.equal(await browser.evaluate("document.body.innerText.includes('INTERNAL_T10_CAPABILITY_CANARY')"),false);
        assert.equal(requests.filter(row=>row.method==='POST').length,1);assert.equal(requests.filter(row=>row.method==='GET').length,0,'capability closure does not automatically ACK');
        await browser.evaluate("document.querySelector('[data-action=check-request-information-command]').click()");await browser.waitFor("document.querySelector('[data-waiting-purpose=request-information]')?.innerText.includes('原操作已核对为提交')");
        assert.deepEqual(requests.filter(row=>row.method==='GET').map(row=>row.path),[path+'/commands/'+original.client_command_id]);assert.equal(requests.filter(row=>row.method==='POST').length,1);assert.equal((await closed.get('/api/tickets/'+target.ticket.id)).status,200);
        await capture('new-detail-1920.png');
      }finally{await browser.evaluate('globalThis.__t10CloseObserver?.()');runtime.server.removeListener('request',observe);await runtime.stop();assert.equal(runtime.server.listening,false);}
    });}finally{context.runtime.server.removeListener('request',observe);}
  });
});
