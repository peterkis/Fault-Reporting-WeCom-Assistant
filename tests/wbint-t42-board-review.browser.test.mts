import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';

// T42 current board-to-Review tracer reuses the existing real T15 public behavior; no original test is changed.
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
    if(method==='POST')globalThis.__t15Responses.push({path:url,status:response.status});
    return response;
  };
})()`;

test('T42 board action requires an explicit current review conclusion before the original atomic start and official movement',{timeout:240000},async()=>{
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
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...browserCookie,url:fixture.origin+'/'}]});assert.ok(browser);
      await browser.waitFor(`Boolean(document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] a'))`);
      assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('script[type=module][src]')).some(script=>new URL(script.src).pathname.startsWith('/workbench/app/assets/'))"),true,'the caller must use the formal production bundle');
      await browser.evaluate(traceWrites);
      await browser.evaluate(`document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] [data-action="board-action-menu"]').click()`);
      await browser.evaluate(`document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] [data-board-action-target="active"]').click()`);
      await browser.waitFor(`Boolean(document.querySelector('.detail-dialog[open] [data-review-id="${reviewId}"] [data-review-materials]'))`);
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),600);
      await browser.waitFor("document.querySelector('[data-review-workspace] [data-review-materials]')?.textContent.includes('打印机无法打印处方')");
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-review-version]').textContent"),originalReview.row_version);
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-material-basis]').getAttribute('data-captured-material-basis')"),basis.current_hash);
      const contextBefore=object(await browser.evaluate('({href:location.href,timeOrigin:performance.timeOrigin})'));
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-board-intent-panel]'))"),true);
      assert.equal(await browser.evaluate("document.querySelector('[data-action=resolve-and-start-review]')?.disabled"),true,'opening the board action must not guess a conclusion');
      assert.deepEqual(await browser.evaluate('globalThis.__t15Writes'),[]);
      assert.equal((await get('/api/tickets/'+known.ticket.id)).status,'QUEUED');
      // A human explicitly adopts current material and makes both choices. None is a write command.
      await browser.evaluate("document.querySelector('[data-review-workspace] [data-action=capture-review]').click()");
      await browser.evaluate(`(()=>{
        const set=(label,value)=>{const input=document.querySelector('[data-review-workspace] [aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));};
        set('复核结论','CONFIRM_TICKET_ELIGIBLE');set('复核原因','HUMAN_CONFIRMED');
      })()`);
      await browser.waitFor(`Boolean(document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"]:not(:disabled)'))`);
      assert.equal(await browser.evaluate("document.querySelectorAll('[data-review-workspace] [data-session-choice]:checked').length"),0,'no Session may be guessed or automatically selected');
      await browser.evaluate(`document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"]').click()`);
      await browser.waitFor(`document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"]')?.checked===true`);
      assert.deepEqual(await browser.evaluate('globalThis.__t15Writes'),[]);
      assert.equal(requests.filter(request=>request.method==='POST').length,0,'material and Session selection must not submit an intermediate command');
      await browser.waitFor("document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]').click()");
      await browser.waitFor(`globalThis.__t15Responses.some(response=>new URL(response.path,location.origin).pathname===${JSON.stringify(startPath)}&&response.status===200)`);
      await browser.waitFor("document.querySelector('.detail-dialog[open] .properties')?.textContent.includes('处理中')");
      const writes=list(await browser.evaluate('globalThis.__t15Writes'));assert.equal(writes.length,1);
      const sent=writes[0];assert.ok(sent);const body=object(sent.body),commandId=text(body.client_command_id);
      assert.match(commandId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      const expected:ReviewResolveAndStartCommand={client_command_id:commandId,expected_row_version:text(originalReview.row_version),expected_material_basis:text(basis.current_hash),
        resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'HUMAN_CONFIRMED',expected_ticket:{ticket_id:known.ticket.id,expected_version:integer(originalTicket.version)},
        resolver_team_id:text(originalTicket.resolver_team_id),communication_choice:'TAKE_SELECTED',sessions:[{session_id:sessionId,expected_row_version:sessionVersion(session.session_row_version)}]};
      assert.equal(new URL(text(sent.path),fixture.origin).pathname,startPath);assert.deepEqual(body,expected);
      assert.equal(sent.ifMatch,'"'+expected.expected_row_version+'"');assert.equal(sent.idempotency,commandId);
      assert.deepEqual(requests.filter(request=>request.method==='POST'),[{path:startPath,method:'POST'}],'one composite request must own the confirmation and both responsibilities');
      const currentTicket=await get('/api/tickets/'+known.ticket.id),currentReview=await get('/api/manual-reviews/'+reviewId);
      assert.equal(currentTicket.status,'IN_PROGRESS');assert.equal(currentTicket.assignee_id,actor.id);assert.equal(currentTicket.resolver_team_id,originalTicket.resolver_team_id);
      assert.ok(integer(currentTicket.version)>integer(originalTicket.version));assert.equal(object(currentTicket.handling_cycle).cycle_no,1);
      assert.ok(list((await get('/api/tickets/'+known.ticket.id+'/eligible-principals')).items).some(principal=>principal.principal_id===actor.id));
      const responsibilities=list((await get('/api/tickets/'+known.ticket.id+'/responsibility')).conversations);
      assert.equal(responsibilities.find(value=>value.session_id===sessionId)?.conversation_principal_id,actor.id);
      assert.equal(currentReview.status,'RESOLVED');assert.equal(currentReview.linked_ticket_id,known.ticket.id);
      assert.deepEqual(currentReview.safe_result,originalReview.safe_result);assert.deepEqual(currentReview.allowed_resolutions,[]);
      assert.deepEqual(currentReview.canonical_item,{kind:'ticket',id:known.ticket.id});
      const alias=await get('/api/workbench/items/review/'+reviewId);assert.equal(object(alias.item).id,known.ticket.id);
      const active=list((await get('/api/workbench/board?column=active')).items),pending=list((await get('/api/workbench/board?column=pending')).items);
      assert.equal(active.filter(value=>value.id===known.ticket.id).length,1);assert.ok(![...active,...pending].some(value=>value.kind==='review'&&value.id===reviewId));
      await browser.waitFor(`Boolean(document.querySelector('.board-column.active [data-kind="ticket"][data-item-id="${known.ticket.id}"]'))&&!document.querySelector('.board-column.pending [data-kind="ticket"][data-item-id="${known.ticket.id}"]')`);
      assert.deepEqual(await browser.evaluate('({href:location.href,timeOrigin:performance.timeOrigin})'),contextBefore,'the same authorized Item workspace must stay open without navigation or reload');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog[open] #detail-title'))"),true);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-kind="ticket"][data-item-id="${known.ticket.id}"]').length`),1);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]:not(:disabled)'))"),false,'a resolved Review must not leave an old-version operation active');
      assert.equal(requests.filter(request=>request.method==='POST').length,1);
      await browser.evaluate("document.querySelector('[data-review-workspace]')?.scrollIntoView({block:'start'})");await capture('new-detail-1920.png');
    }catch(failure){error=failure;if(browser)await capture('new-detail-900.png').catch(captureError=>{error=new AggregateError([failure,captureError],'T15_BROWSER_AND_CAPTURE_FAILED');});}
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',review_resolve_and_start:true,screenshots}));
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(!screenshots.length)await rmdir(directory);}],error);
  },{workbenchBoardActionsEnabled:true,workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false});
});
