// Registered original production-bundle tracer; initially NOT_RUN. Production bundle, real commit and read-only original UUID recovery.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const root="document.querySelector('.ticket-unassign')";
const reasonInput="document.querySelector('.ticket-unassign textarea')";
const fill=(value:string)=>`(()=>{const input=${reasonInput};Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
const copies=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{const result={drafts:drafts.result.filter(row=>row.purpose==='ticket-unassign').map(row=>({purpose:row.purpose,revision:row.revision,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,bytes:row.ciphertext.byteLength,extractable:row.key.extractable,algorithm:row.key.algorithm.name,keys:Object.keys(row)})),operations:operations.result.filter(row=>row.purpose==='ticket-unassign')};db.close();resolve(result);};};})`;
const queued="Array.from(document.querySelectorAll('.properties dt')).find(row=>row.textContent?.trim()==='状态')?.nextElementSibling?.textContent?.trim()==='待接单'";
function failure(error:unknown){return error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:{value:String(error)};}

for(const recovery of [false,true])test('production unassign UNKNOWN '+(recovery?'survives 24h sensitive expiry and cleanup failure with only original read-only ACK':'stays in memory without storage and reconciles through GET without a second POST'),async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticket=await fixture.createTicket(),path='/api/tickets/'+ticket;
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_UNKNOWN_REAL_ACCEPT'})).status,200);
  const before=await admin.get(path),history=rows((await admin.get(path+'/events?limit=200')).value.items),deliveries=(await admin.get(path+'/deliveries')).value;
  assert.equal(before.status,200);assert.equal(before.value.version,2);assert.equal(before.value.assignee_id,fixture.handler);
  const bootstrap=await admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.value.ticket_unassign_draft_recovery_enabled,recovery);
  const cookie=fixture.runtime.authenticate.browserCookies?.()[0];assert.ok(cookie);
  const requests:{method:string;path:string;status:number|null}[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{if(!request.headers.cookie?.split(';').some(part=>part.trim()===cookie.name+'='+cookie.value))return;
   const url=new URL(request.url??'/',fixture.origin);if(!url.pathname.startsWith('/api/'))return;const row={method:request.method??'',path:url.pathname,status:null as number|null};requests.push(row);response.once('finish',()=>{row.status=response.statusCode;});};
  fixture.runtime.server.on('request',observe);let browser:Browser|undefined,primary:unknown,terminal:unknown;
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  const capture=async()=>{assert.ok(browser);if(screenshots.length)return;const bytes=Buffer.from(text(await browser.screenshot()),'base64'),file=join(directory,'new-detail-600.png');await writeFile(file,bytes);
   screenshots.push({file:file.replaceAll('\\','/'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  try{
   browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticket,width:600,height:1080,cookies:[{...cookie,url:fixture.origin}]});assert.ok(browser);
   await browser.waitFor(`Boolean(${reasonInput})&&document.querySelector('[data-action=unassign]')?.disabled===true`);
   if(recovery)await browser.waitFor("document.querySelector('[data-unassign-draft-status]')?.textContent.includes('最长24小时')");
   else{assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-unassign-draft-status]'))"),false);assert.deepEqual(await browser.evaluate('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);}
   const reason='T08 UNKNOWN 合成内部原因 '+randomUUID();await browser.evaluate(fill(reason));
   await browser.waitFor("document.querySelector('[data-action=unassign]')?.disabled===false");
   let expiry:number|null=null;
   if(recovery){await browser.waitFor("document.querySelector('[data-unassign-draft-status]')?.textContent.includes('已保存恢复副本')");const saved=object(await browser.evaluate(copies)),draft=rows(saved.drafts)[0];assert.ok(draft);
    assert.equal(draft.extractable,false);assert.equal(draft.algorithm,'AES-GCM');assert.equal(Number(draft.expiresAt)-Number(draft.firstSavedAt),86400000);assert.ok(Number(draft.bytes)<=16400);assert.equal(typeof draft.expiresAt,'number');expiry=Number(draft.expiresAt);
    assert.equal(JSON.stringify(saved).includes(reason),false);assert.deepEqual(saved.operations,[]);}
   // The production fetch awaits its actual server result, then loses that ACK. No test success handler or business fixture writes.
   await browser.evaluate(`(()=>{const send=fetch;globalThis.fetch=async(path,options)=>{const response=await send(path,options);if(options?.method==='POST'&&String(path)==='${path}/unassign'){globalThis.__t08RealCommit={status:response.status,body:await response.clone().json()};globalThis.__t08OriginalCommand=JSON.parse(options.body);throw new TypeError('T08_REAL_ACK_LOST');}return response;};})()`);
   await browser.evaluate("document.querySelector('[data-action=unassign]').click()");
   await browser.waitFor(`(${root})?.innerText.includes('结果未知')&&Boolean(document.querySelector('[data-action=check-unassign-command]'))`);
   const transport=object(await browser.evaluate('globalThis.__t08RealCommit')),original=object(await browser.evaluate('globalThis.__t08OriginalCommand'));
   assert.equal(transport.status,200);assert.equal(object(transport.body).ok,true);assert.equal(original.expected_version,2);assert.equal(original.reason,reason);
   const id=text(original.client_command_id);assert.equal(requests.filter(row=>row.method==='POST').length,1);
   assert.equal(requests.filter(row=>row.path.includes('/unassign/commands/')).length,0,'restoration and UNKNOWN never automatically reconcile');
   const committed=(await admin.get(path)).value;assert.equal(committed.version,3);assert.equal(committed.assignee_id,null);assert.equal(committed.status,'QUEUED');
   const committedHistory=rows((await admin.get(path+'/events?limit=200')).value.items);assert.equal(committedHistory.length,history.length+1);
   assert.deepEqual(committedHistory.slice(0,-1),history);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
   let operation:Record<string,unknown>|null=null;
   if(recovery){const stored=object(await browser.evaluate(copies));operation=rows(stored.operations)[0]??null;assert.ok(operation);assert.equal(operation.commandId,id);
    assert.equal(JSON.stringify(operation).includes(reason),false);assert.deepEqual(Object.keys(operation).sort(),['commandId','createdAt','id','kind','principal','purpose','scope']);assert.ok(expiry!==null);
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`Date.now=()=>${expiry+1};`});const old=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
    await browser.waitFor(`performance.timeOrigin!==${old}&&Boolean(document.querySelector('[data-action=check-unassign-command]'))&&document.querySelector('[data-unassign-draft-status]')?.textContent.includes('过期')`);
    const expired=object(await browser.evaluate(copies));assert.deepEqual(expired.drafts,[]);assert.deepEqual(expired.operations,[operation]);
    assert.equal(await browser.evaluate(`(${root})?.innerText.includes(${JSON.stringify(reason)})`),false);assert.equal(requests.filter(row=>row.method==='POST').length,1);assert.equal(requests.filter(row=>row.path.includes('/unassign/commands/')).length,0);
    // Existing original IDB seam: a real cleanup failure cannot relabel a read COMMITTED receipt as UNKNOWN.
    await browser.evaluate("(()=>{globalThis.__t08Delete=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(...args){if(this.name==='operations')throw new DOMException('T08_SETTLEMENT_FAILURE','UnknownError');return globalThis.__t08Delete.apply(this,args);};})()");
    await browser.evaluate("document.querySelector('[data-action=check-unassign-command]').click()");
    await browser.waitFor(`(${root})?.innerText.includes('终态已读到')&&(${root})?.innerText.includes('清理尚未确认')`);
    assert.equal(await browser.evaluate(`(${root})?.innerText.includes('结果未知')`),false);assert.deepEqual(object(await browser.evaluate(copies)).operations,[operation]);
    assert.equal(requests.filter(row=>row.method==='POST').length,1);await browser.evaluate('IDBObjectStore.prototype.delete=globalThis.__t08Delete');
   }
   await browser.evaluate("document.querySelector('[data-action=check-unassign-command]').click()");
   await browser.waitFor(`(${root})?.innerText.includes('原操作已核对为提交')&&(${queued})`);
   assert.equal(requests.filter(row=>row.method==='POST').length,1,'ACK is GET-only even when the current write action disappeared');
   const acknowledgements=requests.filter(row=>row.method==='GET'&&row.path===path+'/unassign/commands/'+id);assert.equal(acknowledgements.length,recovery?2:1);assert.ok(acknowledgements.every(row=>row.status===200));
   if(recovery)assert.deepEqual(object(await browser.evaluate(copies)),{drafts:[],operations:[]});else assert.deepEqual(await browser.evaluate('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
   assert.deepEqual((await admin.get(path)).value,committed);assert.deepEqual((await admin.get(path+'/events?limit=200')).value.items,committedHistory);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);await capture();
  }catch(error){primary=error;}
  finally{
   try{await closeBrowserTestResources([async()=>{if(primary&&browser)await capture();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{fixture.runtime.server.removeListener('request',observe);assert.equal((await fixture.runtime.observability.metrics()).sse_clients,0);}],primary);}catch(error){terminal=error;}
   const diagnostic=join(tmpdir(),'t08-command-recovery-'+randomUUID()+'.json');await writeFile(diagnostic,JSON.stringify({recovery,requests,screenshots,...(terminal?{error:failure(terminal)}:{})},null,2));console.log('T08_BROWSER_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/')}));
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',original_uuid_read_only:true,raw_recovery:recovery,screenshots}));if(terminal)throw terminal;
  }
 },{workbenchDraftRecoveryEnabled:recovery,ticketAssignmentEnabled:false,ticketConversationSelfHandlingEnabled:false,workbenchConversationsEnabled:false,workbenchRealtimeEnabled:false});
});
