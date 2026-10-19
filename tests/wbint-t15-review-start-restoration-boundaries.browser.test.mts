import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {evaluateConversationSessionStatusTransition} from '../src/p2-001-conversation-contracts.mjs';
import {appendReviewMaterial} from './helpers/wbint-t14-review-material.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';

// This later public tracer runs only after the original HTTP1 has actually gone RED -> GREEN.
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {
  origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];
  pool:PostgresPool;principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string}}[];runtime:P2016EnabledRuntime;
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

type Boundary='ended'|'purpose-denied'|'restore-denied'|'opaque-failed'|'purpose-regrant';
const snapshot=(reviewId:string)=>`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wecom-workbench-drafts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const load=name=>new Promise((resolve,reject)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const drafts=await load('drafts'),operations=await load('operations');db.close();return {sensitive:drafts.filter(r=>r.id===${JSON.stringify(reviewId)}&&r.purpose==='review-resolve-start').length,ordinary:drafts.filter(r=>r.id===${JSON.stringify(reviewId)}&&r.purpose==='manual-review').length,operations:operations.filter(r=>r.id===${JSON.stringify(reviewId)}&&r.purpose==='review-resolve-start').map(r=>r.commandId)};})()`;
function installTrace(mode:Boundary,reviewId:string){return `(()=>{
  const original=globalThis.fetch;globalThis.__t15Writes=[];globalThis.__t15Responses=[];globalThis.__t15Revokes=0;
  const publish=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(value){if(value?.id===${JSON.stringify(reviewId)}&&value?.purpose==='review-resolve-start'&&value?.reason==='revoked')globalThis.__t15Revokes++;return publish.call(this,value);};
  globalThis.fetch=async(path,options)=>{
    const write=String(options?.method??'GET').toUpperCase()==='POST'&&String(path).endsWith('/resolve-and-start');
    if(write){globalThis.__t15Writes.push({body:JSON.parse(options.body)});if(${JSON.stringify(mode)}==='opaque-failed'&&!globalThis.__t15GateUsed){globalThis.__t15GateUsed=true;await new Promise(resolve=>{globalThis.__t15Release=resolve;globalThis.__t15Held=true;});}}
    const response=await original(path,options);
    if(write){globalThis.__t15Responses.push({status:response.status,body:await response.clone().json()});if(${JSON.stringify(mode)}!=='purpose-denied'&&!globalThis.__t15AckDropped){globalThis.__t15AckDropped=true;throw new TypeError('T15_TEST_LOST_ACK_AFTER_ACTUAL_RESPONSE');}}
    if(globalThis.__t15ArmCleanup&&String(path).includes('/resolve-and-start/commands/')){const receipt=await response.clone().json();globalThis.__t15CheckedReceipt=receipt;if(receipt.state==='FAILED')globalThis.__t15FailCleanup=true;}
    return response;
  };
})()`;}
async function runBoundary(mode:Boundary){
  const denying=mode==='purpose-denied'||mode==='purpose-regrant';
  await withWeb01Fixture(async(fixture:Fixture)=>{
    await projectFixtureMaterial(fixture.runtime);
    const actor=fixture.principals[0],known=fixture.tickets[0],browserCookie=fixture.browserCookies[0],cookie=fixture.cookies[0];
    assert.ok(actor&&known&&browserCookie&&cookie);
    const access=createPilotAccessService({pool:fixture.pool});
    const identity=(await fixture.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[actor.id])).rows[0];assert.ok(identity);
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
      await browser.evaluate(installTrace(mode==='purpose-regrant'?'purpose-denied':mode,reviewId));
      await browser.evaluate(`document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] a').click()`);
      await browser.waitFor(`Boolean(document.querySelector('.detail-dialog[open] [data-review-id="${reviewId}"] [data-review-materials]'))`);
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),600);
      await browser.waitFor("document.querySelector('[data-review-workspace] [data-review-materials]')?.textContent.includes('打印机无法打印处方')");
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-review-version]').textContent"),originalReview.row_version);
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-material-basis]').getAttribute('data-captured-material-basis')"),basis.current_hash);
      const contextBefore=object(await browser.evaluate('({href:location.href,timeOrigin:performance.timeOrigin})'));
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
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.waitFor("document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]')?.disabled===false");

      const close=async()=>{assert.ok(browser);await browser.waitFor("document.querySelector('[aria-label=\"关闭详情\"]')?.disabled===false");await browser.evaluate("document.querySelector('[aria-label=\"关闭详情\"]').click()");await browser.waitFor("!document.querySelector('.detail-dialog[open]')");};
      const reopen=async()=>{assert.ok(browser);await browser.evaluate(`document.querySelector('[data-kind="ticket"][data-item-id="${known.ticket.id}"] a').click()`);await browser.waitFor("Boolean(document.querySelector('.detail-dialog[open] [data-review-workspace]'))");await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="选择复核项"]');if(input){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(reviewId)});input.dispatchEvent(new Event('change',{bubbles:true}));}})()`);await browser.waitFor(`Boolean(document.querySelector('.detail-dialog[open] [data-review-id="${reviewId}"]'))`);};
      if(denying)await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['ADMIN'],resolverTeamIds:[]});
      await browser.evaluate("document.querySelector('[data-review-workspace] [data-action=resolve-and-start-review]').click()");
      if(mode==='opaque-failed'){
        await browser.waitFor('globalThis.__t15Held===true');
        await appendReviewMaterial(fixture.pool,known.intake.intakeId,'T15 actual new fault material arrived before the held original command reached HTTP');
        await projectFixtureMaterial(fixture.runtime);
        await browser.evaluate('globalThis.__t15Release()');
      }
      await browser.waitFor('globalThis.__t15Responses.length===1');
      const response=object(list(await browser.evaluate('globalThis.__t15Responses'))[0]),first=object(list(await browser.evaluate('globalThis.__t15Writes'))[0]),original=object(first.body),commandId=text(original.client_command_id);
      console.log('T15_RESTORATION_BOUNDARY '+JSON.stringify({mode,phase:'ACTUAL_POST',status:response.status,body:response.body,command_id:commandId}));
      assert.equal(response.status,denying?403:mode==='opaque-failed'?409:200);
      if(denying){
        await browser.waitFor('globalThis.__t15Revokes>0');await delay(250);
        const revokes=await browser.evaluate('globalThis.__t15Revokes');console.log('T15_RESTORATION_BOUNDARY '+JSON.stringify({mode,phase:'BOUNDED_REVOCATION',revokes}));
        assert.ok(typeof revokes==='number'&&revokes<=2,'one real purpose denial must stop broadcasting after its scoped cleanup');
        const copies=object(await browser.evaluate(snapshot(reviewId)));assert.equal(copies.sensitive,0);assert.deepEqual(copies.operations,[]);assert.ok(Number(copies.ordinary)>0);
        assert.equal((await get('/api/lifecycle/bootstrap')).principal_id,actor.id);await get('/api/manual-reviews/'+reviewId);await get('/api/tickets/'+known.ticket.id);
        if(mode==='purpose-regrant'){
          await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
          await browser.evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='重新核对确认并开始权限').click()");
          await browser.waitFor("Boolean(document.querySelector('[data-review-start-controls] [data-session-choice]'))");
          await browser.evaluate("document.querySelector('[data-review-workspace] [data-action=capture-review]').click()");
          await browser.waitFor(`document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"]')?.disabled===false`);
          await browser.evaluate(`document.querySelector('[data-review-workspace] [data-session-choice="${sessionId}"]').click()`);
          await browser.waitFor("document.querySelector('[data-review-start-draft-status]')?.textContent.includes('已保存恢复副本')");
          assert.equal(object(await browser.evaluate(snapshot(reviewId))).sensitive,1);
          await browser.waitFor("document.querySelector('[data-action=resolve-and-start-review]')?.disabled===false");
          await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['ADMIN'],resolverTeamIds:[]});
          await browser.evaluate("document.querySelector('[data-action=resolve-and-start-review]').click()");
          await browser.waitFor('globalThis.__t15Responses.length===2');await delay(250);
          const second=object(list(await browser.evaluate('globalThis.__t15Responses'))[1]);assert.equal(second.status,403);
          assert.notEqual(object(object(list(await browser.evaluate('globalThis.__t15Writes'))[1]).body).client_command_id,commandId);
          const secondCopies=object(await browser.evaluate(snapshot(reviewId)));console.log('T15_RESTORATION_BOUNDARY '+JSON.stringify({mode,phase:'SECOND_CURRENT_PURPOSE_DENIAL',copies:secondCopies}));
          assert.equal(secondCopies.sensitive,0,'a fresh explicit intent must be cleared by its own current-purpose rejection after regrant');assert.deepEqual(secondCopies.operations,[]);assert.ok(Number(secondCopies.ordinary)>0);
          await get('/api/manual-reviews/'+reviewId);await get('/api/tickets/'+known.ticket.id);
        }
      }else{
        await browser.waitFor("document.querySelector('[data-review-start-result]')?.textContent.includes('结果未知')");
        const receipt=await get('/api/manual-reviews/'+reviewId+'/resolve-and-start/commands/'+commandId);assert.equal(receipt.state,mode==='opaque-failed'?'FAILED':'COMMITTED');
        await close();
        if(mode==='ended'){
          const state=text(object((await get('/api/conversations/'+sessionId)).session).status);assert.ok(state==='OPEN'||state==='WAITING_USER');
          assert.equal(evaluateConversationSessionStatusTransition({fromStatus:state,toStatus:'ENDED'}).ok,true);
          // Synthetic lifecycle setup through the existing isolated row, not an invented public END command.
          await fixture.pool.query("UPDATE conversation.session SET status='ENDED',ended_at=platform.local_now(),close_reason='T15_SYNTHETIC_LAWFUL_ENDED' WHERE id=$1::uuid",[sessionId]);
          assert.equal(object((await get('/api/conversations/'+sessionId)).session).status,'ENDED');
          assert.ok(!list((await get('/api/tickets/'+known.ticket.id+'/related-conversations')).items).some(row=>row.session_id===sessionId));
          await get('/api/manual-reviews/'+reviewId);await get('/api/tickets/'+known.ticket.id);
        }
        if(mode==='restore-denied'){
          const target=fixture.principals[1];assert.ok(target);await access.upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
          const current=object((await get('/api/conversations/'+sessionId)).session),bootstrap=await get('/api/lifecycle/bootstrap');
          const transfer={client_command_id:randomUUID(),expected_row_version:integer(current.row_version),target_principal_id:target.id,force:true,reason_code:'T15_CURRENT_VIEW_REMOVED'};
          const moved=await fetch(fixture.origin+'/api/conversations/'+sessionId+'/transfer',{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','idempotency-key':transfer.client_command_id,'if-match':'"'+transfer.expected_row_version+'"','x-csrf-token':text(bootstrap.csrf_token)},body:JSON.stringify(transfer)});assert.equal(moved.status,200,await moved.clone().text());
          await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
          await get('/api/manual-reviews/'+reviewId);await get('/api/tickets/'+known.ticket.id);await get('/api/manual-reviews/'+reviewId+'/resolve-and-start-context');
          await get('/api/conversations/'+sessionId);
          // Hold this precise restore read after its current context/team check.
          // Official membership loss then removes Session VIEW while the assigned Ticket and Review remain readable.
          await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.fetch=async(path,options)=>{const selected=String(options?.method??'GET').toUpperCase()==='GET'&&String(path)===${JSON.stringify('/api/conversations/'+sessionId)};if(selected&&!globalThis.__t15SessionHeld){globalThis.__t15SessionHeld=true;await new Promise(resolve=>{globalThis.__t15SessionRelease=resolve;});}const response=await original(path,options);if(selected)globalThis.__t15RestoredSessionStatus=response.status;return response;};})()`);
        }
        if(mode==='opaque-failed')await browser.evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wecom-workbench-drafts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),r=store.getAll();r.onsuccess=()=>{for(const row of r.result)if(row.id===${JSON.stringify(reviewId)}&&row.purpose==='review-resolve-start'){row.firstSavedAt=Date.now()-86401000;row.expiresAt=row.firstSavedAt+86400000;store.put(row);}};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();})()`);
        await reopen();
        if(mode==='restore-denied'){
          await browser.waitFor('globalThis.__t15SessionHeld===true');
          await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:[]});
          await get('/api/manual-reviews/'+reviewId);await get('/api/tickets/'+known.ticket.id);
          const denied=await fetch(fixture.origin+'/api/conversations/'+sessionId,{headers:{cookie}});assert.equal(denied.status,404,await denied.clone().text());
          await browser.evaluate('globalThis.__t15SessionRelease()');
        }
        if(mode==='ended'){
          await browser.waitFor("Boolean(document.querySelector('[data-action=replay-review-start]'))");
          assert.equal(object(await browser.evaluate(snapshot(reviewId))).sensitive,1);
          assert.equal((await get('/api/manual-reviews/'+reviewId+'/resolve-and-start/commands/'+commandId)).state,'COMMITTED');
        }else if(mode==='restore-denied'){
          await browser.waitFor('globalThis.__t15RestoredSessionStatus===404');
          let copies=object(await browser.evaluate(snapshot(reviewId)));const until=performance.now()+2000;
          while(copies.sensitive!==0&&performance.now()<until){await delay(20);copies=object(await browser.evaluate(snapshot(reviewId)));}
          console.log('T15_RESTORATION_BOUNDARY '+JSON.stringify({mode,phase:'CURRENT_SESSION_DENIED',copies}));
          assert.equal(copies.sensitive,0,'a real selected Session 404 must clear this purpose sensitive ciphertext and key');assert.ok(Number(copies.ordinary)>0);
        }else{
          await browser.waitFor("Boolean(document.querySelector('[data-action=check-review-start-receipt]'))&&!document.querySelector('[data-action=replay-review-start]')");
          assert.deepEqual(object(await browser.evaluate(snapshot(reviewId))).operations,[commandId]);
          await browser.evaluate(`(()=>{const original=IDBDatabase.prototype.transaction;globalThis.__t15ArmCleanup=true;globalThis.__t15CleanupFaults=0;IDBDatabase.prototype.transaction=function(names,mode,...rest){if(globalThis.__t15FailCleanup&&mode==='readwrite'&&Array.from(typeof names==='string'?[names]:names).includes('operations')){globalThis.__t15FailCleanup=false;globalThis.__t15CleanupFaults++;throw new DOMException('T15_TEST_ONE_SETTLEMENT_FAILURE','UnknownError');}return original.call(this,names,mode,...rest);};globalThis.__t15RestoreStorage=()=>{IDBDatabase.prototype.transaction=original;globalThis.__t15ArmCleanup=false;};})()`);
          await browser.evaluate("document.querySelector('[data-action=check-review-start-receipt]').click()");
          await browser.waitFor('globalThis.__t15CleanupFaults===1');await delay(100);await browser.evaluate('globalThis.__t15RestoreStorage()');
          assert.equal(object(await browser.evaluate('globalThis.__t15CheckedReceipt')).state,'FAILED');
          assert.equal(await browser.evaluate("document.querySelector('[data-action=check-review-start-receipt]')?.disabled"),false,'known FAILED cleanup failure must retain a usable original UUID read-only retry');
          await browser.evaluate("document.querySelector('[data-action=check-review-start-receipt]').click()");
          await browser.waitFor("document.querySelector('[data-review-start-result]')?.textContent.includes('已只读确认原操作失败')");
          assert.deepEqual(object(await browser.evaluate(snapshot(reviewId))).operations,[]);
        }
      }
      assert.equal(list(await browser.evaluate('globalThis.__t15Writes')).length,mode==='purpose-regrant'?2:1,'restoration and explicit receipt checks must never autoPOST');
      await capture('new-detail-900.png');
    }catch(failure){error=failure;if(browser)await capture('new-detail-900.png').catch(captureError=>{error=new AggregateError([failure,captureError],'T15_BROWSER_AND_CAPTURE_FAILED');});}
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',review_resolve_and_start_boundary:mode,screenshots}));
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(!screenshots.length)await rmdir(directory);}],error);
  },{workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,workbenchDraftRecoveryEnabled:true});
}
test('T15 restores original UNKNOWN intent when its exact still-readable selected Session has lawfully ended',()=>runBoundary('ended'));
test('T15 real current-purpose rejection clears once without a self-sustaining draft invalidation broadcast',()=>runBoundary('purpose-denied'));
test('T15 selected Session current READ denial during restore clears only this purpose sensitive copy',()=>runBoundary('restore-denied'));
test('T15 opaque FAILED receipt settlement can be explicitly retried after one local cleanup failure',()=>runBoundary('opaque-failed'));
test('T15 a regranted same-mount explicit intent is cleared on its second real purpose rejection',()=>runBoundary('purpose-regrant'));

test('MVP keeps the original committed review-start opaque receipt reachable on a terminal review after raw recovery is switched off',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  await projectFixtureMaterial(f.runtime);
  const known=f.tickets[0],actor=f.principals[0],initialCookie=f.browserCookies[0];assert.ok(known&&actor&&initialCookie);
  let cookie=text(f.cookies[0]),replacement:P2016EnabledRuntime|undefined,browser:Browser|undefined,primary:unknown;
  const get=async(path:string)=>{const response=await fetch(f.origin+path,{headers:{cookie,connection:'close'}});assert.equal(response.status,200,path);return object(await response.json());};
  const item=await get('/api/workbench/items/ticket/'+known.ticket.id),ref=list(item.review_refs)[0];assert.ok(ref);
  const reviewId=text(ref.id),startPath='/api/manual-reviews/'+reviewId+'/resolve-and-start';
  const observe='(()=>{const original=fetch;globalThis.__reviewFixPosts=[];globalThis.__reviewFixReads=[];globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(options?.method==="POST"){globalThis.__reviewFixPosts.push({path:String(path),body:JSON.parse(options.body),status:response.status});if(String(path)==='+JSON.stringify(startPath)+'&&response.status===200){await response.clone().json();throw new TypeError("SYNTHETIC_REVIEW_START_LOST_ACK");}}else{const row={path:String(path),status:response.status};if(String(path).startsWith('+JSON.stringify(startPath+'/commands/')+'))row.state=(await response.clone().json()).state;globalThis.__reviewFixReads.push(row);}return response;};})()';
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+known.ticket.id+'?detail=page',width:1280,height:1000,cookies:[initialCookie]});assert.ok(browser);
   await browser.command('Page.enable');await browser.evaluate(observe);
   await browser.waitFor("document.querySelector('[aria-label=\"复核结论\"]')?.disabled===false&&Boolean(document.querySelector('[data-captured-review-version]'))");
   await browser.evaluate('(()=>{const input=document.querySelector("[aria-label=复核结论]");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(input,"CONFIRM_TICKET_ELIGIBLE");input.dispatchEvent(new Event("change",{bubbles:true}));})()');
   await browser.waitFor("document.querySelector('[data-review-start-controls] [data-session-choice]')?.disabled===false");
   await browser.evaluate("document.querySelector('[data-review-start-controls] [data-session-choice]').click()");
   await browser.waitFor("document.querySelector('[data-action=resolve-and-start-review]')?.disabled===false");
   await browser.evaluate("document.querySelector('[data-action=resolve-and-start-review]').click()");
   await browser.waitFor("document.querySelector('[data-review-start-result]')?.textContent.includes('结果未知')");
   const posts=await browser.evaluate('globalThis.__reviewFixPosts') as {path:string;body:ReviewResolveAndStartCommand;status:number}[];
   assert.equal(posts.length,1);const original=posts[0];assert.ok(original);assert.equal(original.status,200);const commandId=original.body.client_command_id;
   assert.equal((await get('/api/manual-reviews/'+reviewId)).status,'RESOLVED');
   const before=await get('/api/tickets/'+known.ticket.id);assert.equal(before.status,'IN_PROGRESS');
   assert.deepEqual(object(await browser.evaluate(snapshot(reviewId))).operations,[commandId]);
   await f.runtime.stop();assert.equal(f.runtime.server.listening,false);
   const next=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[actor.id],externalSendEnabled:false,
    workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:false});
   if('disabled' in next)throw Error('REVIEW_RAW_OFF_RUNTIME_DISABLED');replacement=next;
   const fresh=(await next.start()).cookies?.[0];assert.ok(fresh);cookie=fresh.name+'='+fresh.value;
   assert.equal((await get('/api/lifecycle/bootstrap')).manual_review_draft_recovery_enabled,false);
   await browser.command('Network.setCookies',{cookies:[{...fresh,url:f.origin+'/'}]});
   await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observe});
   const timeOrigin=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor('performance.timeOrigin!=='+timeOrigin+"&&document.readyState==='complete'");
   await browser.waitFor("document.querySelector('[data-action=check-review-start-receipt]')?.checkVisibility()===true");
   assert.deepEqual(await browser.evaluate('globalThis.__reviewFixPosts'),[],'restoration on the terminal review never resubmits');
   assert.equal(await browser.evaluate('globalThis.__reviewFixReads.some(row=>row.path.startsWith('+JSON.stringify(startPath+'/commands/')+'))'),false,'the original receipt is only checked explicitly');
   const opaque=object(await browser.evaluate(snapshot(reviewId)));assert.equal(opaque.sensitive,0);assert.deepEqual(opaque.operations,[commandId]);
   assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=replay-review-start]'))"),false);
   await browser.evaluate("document.querySelector('[data-action=check-review-start-receipt]').click()");
   await browser.waitFor('globalThis.__reviewFixReads.some(row=>row.path==='+JSON.stringify(startPath+'/commands/'+commandId)+'&&row.status===200&&row.state==="COMMITTED")');
   await browser.waitFor('(async()=>{const value=await ('+snapshot(reviewId)+');return value.operations.length===0;})()');
   assert.deepEqual(await browser.evaluate('globalThis.__reviewFixPosts'),[]);assert.deepEqual(await get('/api/tickets/'+known.ticket.id),before);
   const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-page-1280.png');await writeFile(file,bytes);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',raw_off_terminal_original_receipt:true,screenshots:[{file,width:1280,height:1000,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
  }catch(error){primary=error;try{if(browser){const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'failure-1280.png');await writeFile(file,bytes);await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__reviewFixPosts,reads:globalThis.__reviewFixReads})')));console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:1280,height:1000,sha256:createHash('sha256').update(bytes).digest('hex')}]}));}}catch(diagnostic){primary=new AggregateError([error,diagnostic],'T15_BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await replacement?.stop();if(replacement)assert.equal(replacement.server.listening,false);}],primary);
 },{workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,workbenchDraftRecoveryEnabled:true});
});
