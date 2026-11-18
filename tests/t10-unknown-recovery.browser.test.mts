import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import type {IncomingMessage} from 'node:http';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser,fillWaiting} from './helpers/t10-browser-fixture.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

test('T10 blank observer preserves a peer failed waiting draft',{timeout:240000},async()=>{
 await withT10Fixture(async context=>{
  const http=await t11Http(context,2),target=context.tickets[0];assert.ok(target);await http.start(target.ticket.id);const bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {principal_id:string},ticketId=target.ticket.id,path='/api/tickets/'+ticketId+'/request-information';
  await withT10Browser(context,ticketId,2,'T10_FAILED_PEER',async browser=>{
   await browser.waitFor("document.querySelector('[data-action=request-information]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=request-information]').click()");
   const form='form[aria-label="等待补充"]',input=form+' textarea[aria-label="等待原因"]';await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
   const tab=await yxxTab(browser,context.origin+'/workbench/app/items/ticket/'+ticketId);
   try{
    await tab.waitFor("document.querySelector('[data-action=request-information]')?.disabled===false");await tab.evaluate("document.querySelector('[data-action=request-information]').click()");await tab.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);await tab.evaluate(fillWaiting(input,'T10_FAILED_PEER_NOTE'));
    await tab.waitFor("document.querySelector('[data-waiting-purpose=request-information] .workbench-draft-status')?.textContent.includes('草稿已保存')");
    await tab.evaluate(`(()=>{const send=fetch;fetch=(url,options)=>{if(options?.method==='POST'&&String(url)===${JSON.stringify(path)}){globalThis.__t10Peer=JSON.parse(options.body);return new Promise(()=>{});}return send(url,options);};})()`);
    await tab.waitFor(`document.querySelector(${JSON.stringify(form+' button[type="submit"]')})?.disabled===false`);await tab.evaluate(`document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).click()`);await tab.waitFor('Boolean(globalThis.__t10Peer?.client_command_id)');
    await browser.waitFor("Boolean(document.querySelector('[data-action=check-request-information-command]'))");const original=await tab.evaluate('globalThis.__t10Peer') as {client_command_id:string},id=original.client_command_id;
    await browser.evaluate(`(()=>{const read=fetch;fetch=(url,options)=>String(url).endsWith('/request-information/commands/${id}')?Promise.resolve(Response.json({state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}})):read(url,options);})()`);
    await browser.evaluate("document.querySelector('[data-action=check-request-information-command]').click()");
    const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,scope={principal:bootstrap.principal_id,kind:'ticket',id:ticketId,purpose:'waiting-requester'};
    await tab.waitFor(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)});return copy.handle.operation===null;})()`);
    const saved=await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)});return copy.text;})()`) as string|null;assert.ok(saved);const copy=JSON.parse(saved) as {note:string;pending:unknown};assert.equal(copy.note,'T10_FAILED_PEER_NOTE');assert.equal(copy.pending,null);
   }finally{await tab.close();}
  });
 });
});

test('production UNKNOWN keeps the original waiting UUID and uses only explicit safe GET after the action disappears and reloads',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context,2),target=context.tickets[0];assert.ok(target);const before=await http.start(target.ticket.id),path='/api/tickets/'+target.ticket.id+'/request-information';
    const requests:{method:string;path:string;uuid:string|null}[]=[];
    const observe=(request:IncomingMessage)=>{if(request.url===path||request.url?.startsWith(path+'/commands/')){const uuid=request.headers['idempotency-key'];requests.push({method:request.method??'',path:request.url,uuid:typeof uuid==='string'?uuid:null});}};
    context.runtime.server.on('request',observe);
    try{await withT10Browser(context,target.ticket.id,2,'T10_ORIGINAL_UNKNOWN_EXPLICIT_ACK',async(browser,capture)=>{
      await browser.evaluate(`(()=>{const original=fetch;globalThis.__t10Posts=[];globalThis.__t10Reads=[];let dropped=false;globalThis.fetch=async(path,options)=>{if(options?.method==='POST'&&String(path)===${JSON.stringify(path)}){const row={path:String(path),body:JSON.parse(options.body),status:null};globalThis.__t10Posts.push(row);const result=await original(path,options);row.status=result.status;if(result.status===200&&!dropped){dropped=true;throw new TypeError('T10_ACTUAL_COMMITTED_RESPONSE_LOST');}return result;}globalThis.__t10Reads.push(String(path));return original(path,options);};})()`);
      await browser.waitFor("Boolean(document.querySelector('[data-action=request-information]'))&&!document.querySelector('[data-action=request-information]').disabled");await browser.evaluate("document.querySelector('[data-action=request-information]').click()");
      const form='form[aria-label="等待补充"]',input=form+' textarea[aria-label="等待原因"]';await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);await browser.evaluate(fillWaiting(input,'INTERNAL_T10_UNKNOWN_CANARY：原输入保持。'));
      await browser.waitFor(`!document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).click()`);
      await browser.waitFor("globalThis.__t10Posts[0]?.status===200&&document.body.innerText.includes('结果未知')");const posts=await browser.evaluate('globalThis.__t10Posts') as {body:{client_command_id:string;expected_version:number;note:string}}[];assert.equal(posts.length,1);const original=posts[0];assert.ok(original);assert.equal(original.body.expected_version,before.version);
      assert.equal((await http.detail(target.ticket.id)).status,'WAITING_REQUESTER');
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-request-information-command]'))");assert.equal(await browser.evaluate('globalThis.__t10Posts.length'),1);
      assert.equal(await browser.evaluate("(()=>{const root=document.querySelector('[data-waiting-purpose=request-information]'),status=root.querySelector('.workbench-draft-status'),check=root.querySelector('[data-action=check-request-information-command]');return root.dataset.routineDraft==='false'&&root.checkVisibility()&&root.getBoundingClientRect().height>24&&check.checkVisibility()&&status.title.length>0&&status.getAttribute('aria-label')===status.title&&status.querySelector('.sr-only').textContent===status.title;})()"),true,'UNKNOWN retains the full recovery surface, original check action and complete status text');

      const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&Boolean(document.querySelector('[data-action=check-request-information-command]'))`);
      assert.deepEqual(requests.filter(row=>row.method==='POST').map(row=>row.uuid),[original.body.client_command_id]);assert.equal(requests.filter(row=>row.method==='GET').length,0,'reload does not automatically reconcile');
      assert.equal(await browser.evaluate("document.querySelector('[data-waiting-purpose=request-information]').dataset.routineDraft"),'false','restored original operation is never a routine compact hint');
      assert.equal(await browser.evaluate("document.querySelector('[data-action=check-request-information-command]').checkVisibility()"),true);

      const counts=await context.pool.query<{count:string}>('SELECT count(*)::text AS count FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type=$2',[target.ticket.id,'ticket.waiting_requester']);assert.equal(counts.rows[0]?.count,'1');
      await browser.evaluate("document.querySelector('[data-action=check-request-information-command]').click()");await browser.waitFor("document.querySelector('[data-toast-source=ticket-waiting-request-information]')?.innerText.includes('原操作已核对为提交')");
      const after=await http.detail(target.ticket.id);assert.equal(after.version,before.version+1);assert.deepEqual(after.handling_cycle,before.handling_cycle);assert.equal(after.assignee_id,before.assignee_id);
      assert.deepEqual(requests.filter(row=>row.method==='POST').map(row=>row.uuid),[original.body.client_command_id]);assert.deepEqual(requests.filter(row=>row.method==='GET').map(row=>row.path),[path+'/commands/'+original.body.client_command_id]);
      await capture('new-detail-1920.png');
    });}finally{context.runtime.server.removeListener('request',observe);}
  });
});
