import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';

// This later public tracer runs only after the original HTTP1 has actually gone RED -> GREEN.
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {
  origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];
  principals:{id:string}[];tickets:{ticket:{id:string}}[];runtime:P2016EnabledRuntime;
}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function list(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function integer(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
function sessionVersion(value:unknown):number{const captured=text(value);assert.match(captured,/^[1-9][0-9]*$/u);return integer(Number(captured));}
async function projectFixtureMaterial(runtime:P2016EnabledRuntime){
  const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await runtime.coordinator.runOnce(),material=await runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    const remaining=await runtime.coordinator.backlog();
    if(inbound.processed===0&&material.processed===0&&remaining.total===0)return;
  }
  assert.fail('the finite synthetic source material did not finish projection');
}
const traceWrites=`(()=>{
  const original=globalThis.fetch;globalThis.__t15Writes=[];globalThis.__t15Responses=[];
  globalThis.fetch=async(path,options)=>{
    const method=String(options?.method??'GET').toUpperCase(),url=String(path);
    if(method==='POST'){
      const headers=new Headers(options?.headers);
      globalThis.__t15Writes.push({path:url,body:JSON.parse(options.body),ifMatch:headers.get('if-match'),idempotency:headers.get('idempotency-key')});
    }
    const response=await original(path,options);
    if(method==='POST'){globalThis.__t15Responses.push({path:url,status:response.status});if(url.endsWith('/resolve-and-start')){globalThis.__t15ActualACK=await response.clone().json();if(!globalThis.__t15AckDropped){globalThis.__t15AckDropped=true;throw new TypeError('T15_TEST_LOST_ACK_AFTER_REAL_COMMIT');}}}
    return response;
  };
})()`;

test('T15 lost composite ACK survives an explicitly safe close and reopen with its original UUID, Ticket capture and Session intent',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    await projectFixtureMaterial(fixture.runtime);
    const actor=fixture.principals[0],known=fixture.tickets[0],browserCookie=fixture.browserCookies[0],cookie=fixture.cookies[0];
    assert.ok(actor&&known&&browserCookie&&cookie);
    const requests:{path:string;method:string}[]=[];
    fixture.runtime.server.on('request',request=>requests.push({path:request.url??'',method:request.method??''}));
    const get=async(path:string)=>{
      const response=await fetch(fixture.origin+path,{headers:{cookie}});
      assert.equal(response.status,200,await response.clone().text());return object(await response.json());
    };
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.principal_id,actor.id);
    const initialItem=await get('/api/workbench/items/ticket/'+known.ticket.id),reference=list(initialItem.review_refs)[0];assert.ok(reference);
    const reviewId=text(reference.id),originalReview=await get('/api/manual-reviews/'+reviewId),basis=object(originalReview.material_basis);
    assert.equal(originalReview.status,'PENDING');assert.equal(basis.stale,false);
    assert.ok(list(originalReview.materials).some(material=>typeof material.text==='string'&&material.text.includes('打印机无法打印处方')));
    const originalTicket=await get('/api/tickets/'+known.ticket.id);assert.equal(originalTicket.status,'QUEUED');
    const eligible=list((await get('/api/tickets/'+known.ticket.id+'/eligible-principals')).items);
    assert.ok(eligible.some(principal=>principal.principal_id===actor.id),'the actor must currently be an effective member of the Ticket group');
    const related=list((await get('/api/tickets/'+known.ticket.id+'/related-conversations')).items);assert.equal(related.length,1);
    const session=related[0];assert.ok(session);assert.equal(session.take_allowed,true);
    const sessionId=text(session.session_id),startPath='/api/manual-reviews/'+reviewId+'/resolve-and-start';
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    let browser:Browser|undefined,error:unknown;
    const capture=async(name:string)=>{
      assert.ok(browser);const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);
      await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});
    };
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/',width:900,height:900,cookies:[{...browserCookie,url:fixture.origin+'/'}]});assert.ok(browser);
      await browser.waitFor(`Boolean(document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] a'))`);
      assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('script[type=module][src]')).some(script=>new URL(script.src).pathname.startsWith('/workbench/app/assets/'))"),true,'the caller must use the formal production bundle');
      await browser.evaluate(traceWrites);
      await browser.evaluate(`document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] a').click()`);
      await browser.waitFor(`Boolean(document.querySelector('.detail-dialog [data-review-id="${reviewId}"] [data-review-materials]'))`);
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),780);
      await browser.waitFor("document.querySelector('[data-review-workspace] [data-review-materials]')?.textContent.includes('打印机无法打印处方')");
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-review-version]').textContent"),originalReview.row_version);
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-material-basis]').getAttribute('data-captured-material-basis')"),basis.current_hash);
      const contextBefore=object(await browser.evaluate('({href:location.href,timeOrigin:performance.timeOrigin})'));
      // A human explicitly adopts current material and makes both choices. None is a write command.
      await browser.evaluate("document.querySelector('[data-review-workspace] [data-action=capture-review]').click()");
      await browser.evaluate(`(()=>{
        const set=(label,value)=>{const input=document.querySelector('[data-review-workspace] .workbench-select[data-field-label="'+label+'"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));};
        set('复核结论','CONFIRM_TICKET_ELIGIBLE');set('复核原因','HUMAN_CONFIRMED');
      })()`);
      await browser.waitFor(`Boolean(document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"] input[type=checkbox]:not(:disabled)'))`);
      assert.equal(await browser.evaluate("document.querySelectorAll('[data-review-workspace] [data-session-choice] input[type=checkbox]:checked').length"),0,'no Session may be guessed or automatically selected');
      await browser.evaluate(`document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"] input[type=checkbox]').click()`);
      await browser.waitFor(`document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"] input[type=checkbox]')?.checked===true`);
      assert.deepEqual(await browser.evaluate('globalThis.__t15Writes'),[]);
      assert.equal(requests.filter(request=>request.method==='POST').length,0,'material and Session selection must not submit an intermediate command');
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.waitFor("document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]').click()");
      await browser.waitFor("document.querySelector('[data-review-start-result]')?.textContent.includes('结果未知')");
      const firstWrites=list(await browser.evaluate('globalThis.__t15Writes'));assert.equal(firstWrites.length,1);
      const first=firstWrites[0];assert.ok(first);const original=object(first.body),commandId=text(original.client_command_id);
      assert.equal(object(await browser.evaluate('globalThis.__t15ActualACK')).ok,true);
      assert.equal((await get('/api/tickets/'+known.ticket.id)).status,'IN_PROGRESS');
      assert.equal(requests.filter(request=>request.method==='POST').length,1);
      // A saved ordinary Review draft cannot stand in for this different purpose.
      // A safe close is allowed only after the complete composite intent is durable.
      await browser.waitFor("document.querySelector('[aria-label=\"关闭详情\"]')?.disabled===false");
      await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");
      await browser.waitFor("!document.querySelector('.detail-dialog')");
      await browser.evaluate(`document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] a').click()`);
      await browser.waitFor(`Boolean(document.querySelector('.detail-dialog [data-review-id="${reviewId}"]'))`);
      await browser.waitFor("Boolean(document.querySelector('[data-review-start-controls] [data-action=replay-review-start]'))");
      assert.equal(requests.filter(request=>request.method==='POST').length,1,'restoration must never autoPOST');
      const saved=object(await browser.evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wecom-workbench-drafts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const rows=await new Promise((resolve,reject)=>{const tx=db.transaction(['drafts'],'readonly'),r=tx.objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();const row=rows.find(row=>row.purpose==='review-resolve-start'&&row.id===${JSON.stringify(reviewId)});return row?{purpose:row.purpose,ttl:row.expiresAt-row.firstSavedAt,extractable:row.key.extractable,ciphertext:row.ciphertext instanceof ArrayBuffer,hasPlaintext:Object.hasOwn(row,'text')||Object.hasOwn(row,'pending')}:null;})()`));
      assert.deepEqual(saved,{purpose:'review-resolve-start',ttl:86400000,extractable:false,ciphertext:true,hasPlaintext:false});
      // Only an explicit replay may send the same immutable original command.
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.fetch=async(path,options)=>{if(String(options?.method??'GET').toUpperCase()==='POST'&&String(path).endsWith('/resolve-and-start')){globalThis.__t15RestoredWrite={body:JSON.parse(options.body),headers:Object.fromEntries(new Headers(options.headers))};return original(path,options);}return original(path,options);};})()`);
      await browser.evaluate("document.querySelector('[data-action=replay-review-start]').click()");
      await browser.waitFor("Boolean(globalThis.__t15RestoredWrite)");
      assert.deepEqual(object(await browser.evaluate('globalThis.__t15RestoredWrite')).body,original);
      await browser.waitFor("globalThis.__t15Responses.filter(row=>row.path.endsWith('/resolve-and-start')&&row.status===200).length===2&&!document.querySelector('[data-action=replay-review-start]')");
      assert.equal(requests.filter(request=>request.method==='POST').length,2);
      const currentTicket=await get('/api/tickets/'+known.ticket.id);assert.equal(currentTicket.version,object(await browser.evaluate('globalThis.__t15ActualACK')).ticket_version);
      assert.equal(object(original.expected_ticket).ticket_id,known.ticket.id);assert.equal(list(original.sessions)[0]?.session_id,sessionId);
      assert.equal(text(original.client_command_id),commandId);
      assert.equal(await browser.evaluate('performance.timeOrigin'),contextBefore.timeOrigin);
      await capture('new-detail-900.png');
    }catch(failure){error=failure;if(browser)await capture('new-detail-900.png').catch(captureError=>{error=new AggregateError([failure,captureError],'T15_BROWSER_AND_CAPTURE_FAILED');});}
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',review_resolve_and_start:true,screenshots}));
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(!screenshots.length)await rmdir(directory);}],error);
  },{workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,workbenchDraftRecoveryEnabled:true});
});
