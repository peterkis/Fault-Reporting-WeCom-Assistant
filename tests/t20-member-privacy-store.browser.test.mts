// Retired V1 client fixture: preserves historical API/lifecycle assertions; not new H5 UI acceptance.
// SOURCE_ONLY_DRAFT / NOT_REGISTERED / NOT_BUILT / NOT_RUN.
// Intended tests/ placement. Existing staged .mjs imports; two 240s native cases, concurrency1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT20FeedbackFixture} from './helpers/t20-feedback-fixture.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createRetiredSelfServiceFixture} from './helpers/retired-self-service-ui.mjs';
import type {WeComOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {mapping} from './helpers/yxx-ss-009-http-fixture.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type FeedbackFixture=Parameters<Parameters<typeof withT20FeedbackFixture>[0]>[0];
interface Authority {principal:string;requestRef:string;ticketNo:string;completedRoundNo:number;completedRoundRef:string;ticketVersion:number}
interface PendingObservation {path:string;body:{client_command_id:string;completed_round_ref:string;expected_ticket_version:number}}

// Existing fixture composition, not another server/browser/store architecture.
async function withMemberStoreBrowser(run:(value:{f:FeedbackFixture;tab:Browser;authority:Authority;directory:string})=>Promise<void>){
 await withT20FeedbackFixture(async f=>{
  await f.app.stop();const identityMapping=await mapping(),directory=join(tmpdir(),'t20-member-privacy-store-'+randomUUID());await mkdir(directory);
  let fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,tab:Browser|undefined,app:ReturnType<typeof createYxxProfile>|undefined,error:unknown;
  try{
   fixture=await createYxxBrowserFixture({pool:f.context.pool,createApp:({oauth,origin:publicOrigin}:{oauth:WeComOAuth;origin:string})=>{
    const value=createYxxProfile({...f.options,identityMapping,profile:'MEMBER_SELF_SERVICE',oauth,publicOrigin,h5Presentation:createRetiredSelfServiceFixture(),yxxSelfService:{featureFlags:f.options.featureFlags,pollMilliseconds:100,reporterFeedbackEnabled:true,reporterFeedbackDraftRecoveryEnabled:true}});app=value;return value.server;
   }});
   assert.ok(fixture);fixture.setMember('open-a');tab=await fixture.launch({path:'/synthetic-start',width:390,height:844});assert.ok(tab);
   await tab.evaluate("location.assign('/wecom/yixiaoxiu/')",{awaitPromise:false});await tab.waitFor("document.querySelector('#home-view')?.hidden===false");
   await tab.evaluate('location.assign('+JSON.stringify('/wecom/yixiaoxiu/reports/'+f.requestRef)+')',{awaitPromise:false});
   await tab.waitFor("document.querySelector('#detail-view')?.hidden===false&&document.querySelector('#detail-status')?.textContent.includes('关闭')&&Boolean(document.querySelector('[data-action=submit-feedback]'))");
   // Actual current Member reads precede every use of the served T03 module.
   const authority=await tab.evaluate(`(async()=>{const b=await fetch('/api/yixiaoxiu/bootstrap'),d=await fetch(${JSON.stringify(f.path)});if(b.status!==200||d.status!==200)throw Error('CURRENT_MEMBER_READ_REQUIRED');const bootstrap=await b.json(),detail=await d.json();if(bootstrap.feedback_draft_recovery_enabled!==true||detail.feedback_context?.can_feedback!==true||detail.ticket?.status!=='CLOSED')throw Error('CURRENT_MEMBER_FEEDBACK_AUTHORITY_REQUIRED');return {principal:bootstrap.recovery_scope,requestRef:detail.request_ref,ticketNo:detail.ticket.ticket_no,completedRoundNo:detail.feedback_context.completed_round_no,completedRoundRef:detail.feedback_context.completed_round_ref,ticketVersion:detail.feedback_context.ticket_version};})()`) as Authority;
   assert.match(authority.principal,/^[a-f0-9]{64}$/u);assert.match(authority.requestRef,/^[A-Za-z0-9_-]{32}$/u);assert.equal(authority.requestRef,f.requestRef);assert.equal(authority.ticketVersion,f.completed.version);
   await writeFile(join(directory,'current-member-read-authority.json'),JSON.stringify(authority,null,2));
   await run({f,tab,authority,directory});
  }catch(failure){error=failure;try{if(tab){await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,attempts:globalThis.__privacyAttempts,reads:globalThis.__privacyReads,logout:globalThis.__privacyLogout})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},async()=>{await app?.stop();}],error);
 });
}
const observe=String.raw`(()=>{const original=globalThis.fetch;globalThis.__privacyAttempts=[];globalThis.__privacyReads=[];globalThis.__privacyLogout=[];globalThis.fetch=async(path,options)=>{const target=String(path);if(options?.method==='POST'&&target.endsWith('/feedback')){globalThis.__privacyAttempts.push({path:target,body:JSON.parse(options.body)});throw new TypeError('CONTROLLED_FEEDBACK_TRANSPORT_NOT_SENT');}if(options?.method!=='POST')globalThis.__privacyReads.push(target);const result=await original(path,options);if(options?.method==='POST'&&target.endsWith('/logout'))globalThis.__privacyLogout.push({path:target,status:result.status,body:await result.clone().json()});return result;};})()`;
function scopeOf(authority:Authority){return {principal:authority.principal,kind:'web-feedback',id:authority.requestRef,purpose:'reporter-feedback'} as const;}
function snapshotExpression(scope:ReturnType<typeof scopeOf>){return `new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onupgradeneeded=()=>request.transaction.abort();request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),draft=tx.objectStore('drafts').get(${JSON.stringify(JSON.stringify([scope.principal,scope.kind,scope.id,scope.purpose]))}),operation=tx.objectStore('operations').get(${JSON.stringify(JSON.stringify([scope.principal,scope.kind,scope.id,scope.purpose]))});tx.oncomplete=()=>{db.close();const r=draft.result,o=operation.result;resolve({record:r?{scope:r.scope,principal:r.principal,kind:r.kind,id:r.id,purpose:r.purpose,firstSavedAt:r.firstSavedAt,expiresAt:r.expiresAt,revision:r.revision,cipherBytes:r.ciphertext.byteLength,nativeCryptoKey:r.key instanceof CryptoKey,extractable:r.key.extractable,algorithm:r.key.algorithm}:null,operation:o??null});};tx.onabort=()=>{db.close();reject(tx.error);};};})`;}
async function prepareUnknown(tab:Browser,f:FeedbackFixture){
 await tab.evaluate(observe);await tab.evaluate("document.querySelector('[data-action=submit-feedback]').click()");
 await tab.waitFor("globalThis.__privacyAttempts.length===1&&document.querySelector('[data-feedback-state]')?.textContent.includes('结果未知')");
 const original=await tab.evaluate('globalThis.__privacyAttempts[0]') as PendingObservation;
 assert.equal(original.path,f.path+'/feedback');assert.match(original.body.client_command_id,/^[0-9a-f-]{36}$/u);assert.equal(original.body.expected_ticket_version,f.completed.version);
 return original;
}

test('Member principal64/request32 journal keeps its first 24h expiry across resave and removes only sensitive data at expiry',{timeout:240_000},async()=>{
 await withMemberStoreBrowser(async({f,tab,authority,directory})=>{
  const scope=scopeOf(authority),original=await prepareUnknown(tab,f);
  await writeFile(join(directory,'original-not-sent-feedback.json'),JSON.stringify(original,null,2));
  const first=await tab.evaluate(snapshotExpression(scope)) as {record:{firstSavedAt:number;expiresAt:number;revision:string;nativeCryptoKey:boolean;extractable:boolean;algorithm:{name:string;length:number};kind:string;principal:string;id:string;purpose:string}|null;operation:{commandId:string;createdAt:number}|null};
  assert.ok(first.record&&first.operation);assert.equal(first.record.kind,'web-feedback');assert.equal(first.record.principal,authority.principal);assert.equal(first.record.id,authority.requestRef);assert.equal(first.record.purpose,'reporter-feedback');assert.equal(first.record.expiresAt-first.record.firstSavedAt,86_400_000);assert.equal(first.operation.commandId,original.body.client_command_id);assert.equal(first.record.nativeCryptoKey,true);assert.equal(first.record.extractable,false);assert.deepEqual(first.record.algorithm,{name:'AES-GCM',length:256});
  // Store-specific continuation uses the actual served module and native CryptoKey, never a stub.
  await tab.evaluate(`(async()=>{const module=await import('/wecom/yixiaoxiu/feedback-recovery.js');const copy=await module.openDraft(${JSON.stringify(scope)});if(copy.text===null||copy.handle.operation?.commandId!==${JSON.stringify(original.body.client_command_id)})throw Error('ORIGINAL_MEMBER_COPY_REQUIRED');globalThis.__privacyRealNow=Date.now;Date.now=()=>${first.record.firstSavedAt+3_600_000};await module.saveDraft(copy.handle,copy.text,{commandId:${JSON.stringify(original.body.client_command_id)}});})()`);
  const second=await tab.evaluate(snapshotExpression(scope)) as typeof first;assert.ok(second.record&&second.operation);
  assert.equal(second.record.firstSavedAt,first.record.firstSavedAt);assert.equal(second.record.expiresAt,first.record.expiresAt,'a new encrypted revision cannot renew the first-save 24h deadline');assert.notEqual(second.record.revision,first.record.revision);assert.equal(second.operation.commandId,first.operation.commandId);assert.equal(second.operation.createdAt,first.operation.createdAt);
  await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:`${observe};Date.now=()=>${first.record.expiresAt+1};`});
  const previous=await tab.evaluate('performance.timeOrigin');await tab.command('Page.reload');await tab.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
  await tab.waitFor("Boolean(document.querySelector('[data-action=check-feedback-command]'))&&document.querySelector('[data-feedback-state]')?.textContent.includes('原反馈')");
  const expired=await tab.evaluate(snapshotExpression(scope)) as typeof first;assert.equal(expired.record,null);assert.equal(expired.operation?.commandId,original.body.client_command_id);
  assert.equal(await tab.evaluate('globalThis.__privacyAttempts.length'),0,'Member expiry and restoration never create a fresh feedback UUID/POST');
  assert.equal(await tab.evaluate(`globalThis.__privacyReads.some(path=>path.startsWith(${JSON.stringify(f.path+'/feedback/commands/')}))`),false,'expiry does not automatically acknowledge the operation');
  assert.equal(await tab.evaluate("document.querySelector('[data-action=submit-feedback]')?.disabled"),true);
  await tab.evaluate("document.querySelector('[data-action=check-feedback-command]').click()");await tab.waitFor("document.querySelector('[data-feedback-state]')?.textContent.includes('结果未知')");
  assert.equal(await tab.evaluate(`globalThis.__privacyReads.includes(${JSON.stringify(f.path+'/feedback/commands/'+original.body.client_command_id)})`),true);
  const retained=await tab.evaluate(snapshotExpression(scope)) as typeof first;assert.equal(retained.record,null);assert.equal(retained.operation?.commandId,original.body.client_command_id);
  const actual=await tab.evaluate(`fetch(${JSON.stringify(f.path+'/feedback/commands/'+original.body.client_command_id)}).then(async response=>({status:response.status,body:await response.json()}))`) as {status:number;body:{state:string;client_command_id:string}};
  assert.equal(actual.status,200);assert.equal(actual.body.state,'UNKNOWN');assert.equal(actual.body.client_command_id,original.body.client_command_id,'the real absent receipt is UNKNOWN, never a fake service success');
  await writeFile(join(directory,'first-resave-expiry-and-unknown.json'),JSON.stringify({first,second,expired,retained,actual},null,2));
 });
});

test('Member corrupted sensitive copy retains its UUID while account/request/purpose scopes and real logout remain distinct',{timeout:240_000},async()=>{
 await withMemberStoreBrowser(async({f,tab,authority,directory})=>{
  const scope=scopeOf(authority),original=await prepareUnknown(tab,f);await writeFile(join(directory,'original-not-sent-feedback.json'),JSON.stringify(original,null,2));
  const initial=await tab.evaluate(snapshotExpression(scope)) as {record:{nativeCryptoKey:boolean;extractable:boolean}|null;operation:{commandId:string}|null};assert.ok(initial.record&&initial.operation);assert.equal(initial.record.nativeCryptoKey,true);assert.equal(initial.record.extractable,false);assert.equal(initial.operation.commandId,original.body.client_command_id);
  // Decoys exercise only the store's new tuple representation. They do not assert B/object business authority.
  const controls=await tab.evaluate(`(async()=>{const module=await import('/wecom/yixiaoxiu/feedback-recovery.js'),a=${JSON.stringify(scope)},bPrincipal=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''),otherRequest=crypto.randomUUID().replaceAll('-','');const controls=[{scope:{...a,id:otherRequest},text:'A_OTHER_REQUEST_STORE_CONTROL'},{scope:{...a,principal:bPrincipal},text:'B64_STORE_CONTROL'},{scope:{...a,purpose:'different-purpose'},text:'A_OTHER_PURPOSE_STORE_CONTROL'}];for(const control of controls){const copy=await module.openDraft(control.scope);control.commandId=crypto.randomUUID();await module.saveDraft(copy.handle,control.text,{commandId:control.commandId});}const isolated=[];for(const control of controls){const copy=await module.openDraft(control.scope);isolated.push({scope:control.scope,text:copy.text,commandId:copy.handle.operation?.commandId});}return {controls,isolated};})()`) as {controls:{scope:{principal:string;kind:string;id:string;purpose:string};text:string;commandId:string}[];isolated:{scope:{principal:string;kind:string;id:string;purpose:string};text:string;commandId:string}[]};
  assert.equal(controls.controls.length,3);for(const [index,control] of controls.controls.entries()){const actual=controls.isolated[index];assert.ok(actual);assert.deepEqual(actual.scope,control.scope);assert.equal(actual.text,control.text);assert.equal(actual.commandId,control.commandId);assert.notEqual(actual.commandId,original.body.client_command_id);}
  assert.notEqual(controls.controls[1]?.scope.principal,authority.principal);assert.match(controls.controls[1]?.scope.principal??'',/^[a-f0-9]{64}$/u);assert.notEqual(controls.controls[0]?.scope.id,authority.requestRef);assert.match(controls.controls[0]?.scope.id??'',/^[A-Za-z0-9_-]{32}$/u);
  // Corrupt just A's native ciphertext; preserve metadata and its actual non-extractable CryptoKey.
  await tab.evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),read=store.get(${JSON.stringify(JSON.stringify([scope.principal,scope.kind,scope.id,scope.purpose]))});read.onsuccess=()=>{const row=read.result;if(!row)throw Error('ORIGINAL_SENSITIVE_ROW_REQUIRED');const bytes=new Uint8Array(row.ciphertext);bytes[0]^=1;row.ciphertext=bytes.buffer;store.put(row);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};})`);
  await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:observe});const previous=await tab.evaluate('performance.timeOrigin');await tab.command('Page.reload');await tab.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
  await tab.waitFor("Boolean(document.querySelector('[data-action=check-feedback-command]'))&&document.querySelector('[data-feedback-state]')?.textContent.includes('原反馈')");
  const corrupted=await tab.evaluate(snapshotExpression(scope)) as {record:null;operation:{commandId:string}|null};assert.equal(corrupted.record,null);assert.equal(corrupted.operation?.commandId,original.body.client_command_id);
  assert.equal(await tab.evaluate('globalThis.__privacyAttempts.length'),0);assert.equal(await tab.evaluate("document.querySelector('[data-action=submit-feedback]')?.disabled"),true);
  assert.equal(await tab.evaluate(`globalThis.__privacyReads.some(path=>path.startsWith(${JSON.stringify(f.path+'/feedback/commands/')}))`),false);
  await tab.evaluate("document.querySelector('[data-action=check-feedback-command]').click()");await tab.waitFor("document.querySelector('[data-feedback-state]')?.textContent.includes('结果未知')");
  const stillUnknown=await tab.evaluate(snapshotExpression(scope)) as typeof corrupted;assert.equal(stillUnknown.operation?.commandId,original.body.client_command_id);
  assert.equal(await tab.evaluate(`globalThis.__privacyReads.includes(${JSON.stringify(f.path+'/feedback/commands/'+original.body.client_command_id)})`),true);
  // Actual Member logout clears all A reporter-feedback scopes, while unrelated B64/purpose controls stay.
  await tab.evaluate("document.querySelector('#logout').click()");await tab.waitFor("document.querySelector('#logged-out-view')?.hidden===false&&globalThis.__privacyLogout.length===1");
  const logout=await tab.evaluate('globalThis.__privacyLogout[0]') as {status:number;body:{logged_out:boolean}};assert.equal(logout.status,200);assert.equal(logout.body.logged_out,true);
  await tab.waitFor("document.querySelector('#app-status')?.textContent==='已退出当前会话。'");
  const rows=await tab.evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({draftScopes:drafts.result.map(row=>row.scope).sort(),operationScopes:operations.result.map(row=>row.scope).sort(),operationIds:operations.result.map(row=>row.commandId).sort()});};tx.onabort=()=>{db.close();reject(tx.error);};};})") as {draftScopes:string[];operationScopes:string[];operationIds:string[]};
  const retained=controls.controls.slice(1),retainedKeys=retained.map(control=>JSON.stringify([control.scope.principal,control.scope.kind,control.scope.id,control.scope.purpose])).sort();
  assert.deepEqual(rows.draftScopes,retainedKeys);assert.deepEqual(rows.operationScopes,retainedKeys);assert.deepEqual(rows.operationIds,retained.map(control=>control.commandId).sort());
  const invalid=await tab.evaluate("fetch('/api/yixiaoxiu/bootstrap').then(response=>response.status)");assert.equal(invalid,401,'the real Member session is revoked, not just cosmetically hidden');
  assert.equal(await tab.evaluate('globalThis.__privacyAttempts.length'),0);
  await writeFile(join(directory,'corrupt-tuple-isolation-and-real-logout.json'),JSON.stringify({controls,corrupted,stillUnknown,logout,rows},null,2));
 });
});
