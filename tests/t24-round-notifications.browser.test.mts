import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createTicketRoundNotifications} from '../app/server/src/workbench-ticket-round-notifications.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type DeliveryReply={items:{delivery_id:string;node:string;cycle_no:number;destination_type:string;status:string;attempt_count:number;side_effect_state:string;sent_at:string|null}[]};
const instrument=`(()=>{const original=globalThis.fetch;globalThis.__t24UIReads=[];globalThis.__t24UIWrites=[];
  globalThis.fetch=async(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='GET')globalThis.__t24UIWrites.push({path,method});
    const response=await original(input,options);
    if(method==='GET'&&path.endsWith('/deliveries'))globalThis.__t24UIReads.push({path,status:response.status,body:await response.clone().json()});
    return response;};})()`;

test('production Ticket detail reads actual personal round Delivery facts and explicitly requeries without a business write',async()=>{
  await withT24Fixture(async context=>{
    const id=context.ticketId,http=await t11Http(context),started=await http.start(id);
    const consumer=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});
    await consumer.runOnce();
    assert.equal((await http.post(id,'complete',{...http.command(started),internal_process:'INTERNAL_T24_BROWSER_CANARY：仅内部合成排查过程',external_summary:'合成打印服务已恢复。'})).status,200);
    await consumer.runOnce();
    const completed=await http.detail(id);assert.equal(completed.status,'CLOSED');
    const path='/api/tickets/'+id+'/deliveries',response=await http.get(path);assert.equal(response.status,200);
    const actual=await response.json() as DeliveryReply;
    assert.deepEqual(actual.items.map(row=>({node:row.node,cycle:row.cycle_no,route:row.destination_type,status:row.status,attempts:row.attempt_count,effect:row.side_effect_state,sent:row.sent_at})).sort((a,b)=>a.node.localeCompare(b.node)),[
      {node:'FIRST_RESPONSIBILITY',cycle:1,route:'PERSON',status:'PENDING',attempts:0,effect:'NOT_ATTEMPTED',sent:null},
      {node:'STAFF_COMPLETED',cycle:1,route:'PERSON',status:'PENDING',attempts:0,effect:'NOT_ATTEMPTED',sent:null},
    ]);
    const cookie=context.browserCookies[0];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T24_BROWSER_COOKIE_REQUIRED');
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});
      const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
      await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'&&Boolean(document.querySelector('#detail-title'))`);
      const selector='[role="region"][aria-label="报修人通知送达"]';
      assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),true,'the formal production detail must expose its actual round Delivery facts');
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('details').open`),false,'delivery diagnostics are folded until requested');
      await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary').click()`);
      await browser.waitFor(`(()=>{const region=document.querySelector(${JSON.stringify(selector)});return region?.innerText.includes('首次责任')&&region.innerText.includes('工作人员完工')&&(region.innerText.match(/待发送/g)??[]).length===2;})()`);
      const visible=await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText`) as string;
      assert.equal(visible.includes('处理轮次 1'),true);assert.equal(visible.includes('原报修人单聊'),true);assert.equal(visible.includes('尝试次数 0'),true);
      const reads=await browser.evaluate('globalThis.__t24UIReads') as {path:string;status:number;body:DeliveryReply}[];
      assert.ok(reads.length);assert.equal(reads.at(-1)?.path,path);assert.equal(reads.at(-1)?.status,200);
      assert.deepEqual(reads.at(-1)?.body.items.map(row=>row.delivery_id).sort(),actual.items.map(row=>row.delivery_id).sort());
      const count=reads.length;
      await browser.evaluate(`(()=>{const region=document.querySelector(${JSON.stringify(selector)}),button=[...region.querySelectorAll('button')].find(item=>item.textContent.trim()==='重新读取通知');if(!button)throw Error('T24_REQUERY_BUTTON_MISSING');button.click();})()`);
      await browser.waitFor(`globalThis.__t24UIReads.length>${count}`);
      const reread=await browser.evaluate('globalThis.__t24UIReads.at(-1)') as {path:string;status:number;body:DeliveryReply};
      assert.equal(reread.path,path);assert.equal(reread.status,200);assert.deepEqual(reread.body.items.map(row=>row.delivery_id).sort(),actual.items.map(row=>row.delivery_id).sort());
      assert.deepEqual(await browser.evaluate('globalThis.__t24UIWrites'),[]);
      for(const marker of ['INTERNAL_T24_BROWSER_CANARY','user-test','bot-test']){assert.equal(visible.includes(marker),false);assert.equal(JSON.stringify(reread.body).includes(marker),false);}
      const after=await http.detail(id);assert.equal(after.status,'CLOSED');assert.equal(after.version,completed.version);
      const counts=(await context.pool.query<{messages:number;outboxes:number;deliveries:number;grants:number}>(`SELECT
        (SELECT count(*)::int FROM communication.message) AS messages,(SELECT count(*)::int FROM communication.outbox) AS outboxes,
        (SELECT count(*)::int FROM communication.delivery) AS deliveries,(SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants`)).rows[0];
      assert.deepEqual(counts,{messages:2,outboxes:2,deliveries:2,grants:0});
      await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);
      screenshots.push({file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')});
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',round_notifications:true,screenshots}));
    }catch(failure){
      error=failure;
      try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,reads:globalThis.__t24UIReads,writes:globalThis.__t24UIWrites})')));}}
      catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T24_BROWSER_FAILURE_EVIDENCE');}
      console.log('T24_BROWSER_FAILURE '+JSON.stringify({directory}));
    }
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  });
});
