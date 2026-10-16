// Registered current production-bundle risk tracer; external first draft is retained.
// Uses production DOM/bundle, real HTTP/isolated PG and synthetic OAuth only.
// Transport and client-clock barriers below are external browser boundaries.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import {withT21DraftFixture,t21Config,t21Mapping} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import type {T21DraftFixture} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {secret} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import type {WeComOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxBrowserFixture,yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Peer=Awaited<ReturnType<typeof yxxTab>>;
type Surface=Pick<Browser,'evaluate'|'waitFor'|'command'>;
interface Wire {method:string;path:string;status:number|null;commandId:string|null;body:unknown}
interface Storage {exists:boolean;drafts:Record<string,unknown>[];operations:Record<string,unknown>[]}
const submit="document.querySelector('[data-action=submit-bot-feedback]')";
const check="document.querySelector('[data-action=check-bot-feedback-command]')";
const status="document.querySelector('#bot-feedback-panel [data-feedback-state]')";
const enabled=`${submit}?.disabled===false&&document.querySelector('#ticket')?.hidden===false`;
const checkable=`${check}?.disabled===false&&document.querySelector('#bot-feedback-panel')?.hidden===false`;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function records(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function wires(value:unknown):Wire[]{return records(value).map(row=>{assert.ok(typeof row.method==='string'&&typeof row.path==='string'&&(row.status===null||typeof row.status==='number')&&(row.commandId===null||typeof row.commandId==='string'));return {method:row.method,path:row.path,status:row.status,commandId:row.commandId,body:row.body};});}
function failure(value:unknown):unknown{return value instanceof Error?{name:value.name,message:value.message,stack:value.stack,...(value instanceof AggregateError?{errors:value.errors.map(failure)}:{})}:String(value);}

// No substitute business response. Drop means no native fetch is called for the
// feedback POST; hold releases the original native fetch with its original signal.
function transport(mode:'drop'|'hold') {return `(()=>{const send=globalThis.fetch;globalThis.__t21Wire=[];globalThis.__t21PostReleased=false;globalThis.__t21PostSettled=false;globalThis.__t21HeldSignalAborted=false;
 if(${JSON.stringify(mode==='hold')}){
  const descriptor=Object.getOwnPropertyDescriptor(BroadcastChannel.prototype,'onmessage');if(!descriptor?.set||!descriptor.configurable)throw Error('T21_NATIVE_CALLBACK_GATE_UNAVAILABLE');const handlers=new Map(),queued=[];let delay=false,observer,status;
  globalThis.__t21RealLogoutStatus=null;globalThis.__t21LogoutGate=null;
  Object.defineProperty(BroadcastChannel.prototype,'onmessage',{configurable:descriptor.configurable,enumerable:descriptor.enumerable,get(){return handlers.get(this)??null;},set(handler){handlers.set(this,handler);descriptor.set.call(this,typeof handler==='function'?function(event){if(delay&&this.name==='yixiaoxiu-auth'&&['revalidate','bot-feedback-logout'].includes(event.data)){if(queued.length>=16)throw Error('T21_NATIVE_CALLBACK_GATE_OVERFLOW');queued.push({handler,channel:this,event});globalThis.__t21LogoutGate.queued.push({kind:event.data,trusted:event.isTrusted,at:performance.now()});maybeRelease();return;}return handler.call(this,event);}:handler);}});
  const release=()=>{delay=false;for(const next of queued.splice(0)){globalThis.__t21LogoutGate.released.push({kind:next.event.data,trusted:next.event.isTrusted,at:performance.now()});next.handler.call(next.channel,next.event);}};
  const maybeRelease=()=>{if(!delay||globalThis.__t21RealLogoutStatus!==200||status?.textContent!=='已退出访问。'||!queued.some(next=>next.event.data==='bot-feedback-logout'))return;observer.disconnect();Object.assign(globalThis.__t21LogoutGate,{real_status:200,success_dom:true,success_at:performance.now()});release();Object.assign(globalThis.__t21LogoutGate,{after_release:status.textContent,completed:true});};
  globalThis.__t21ArmLogoutCallbackGate=()=>{status=document.querySelector('#status');if(!status)throw Error('T21_LOGOUT_STATUS_REQUIRED');delay=true;globalThis.__t21LogoutGate={timeOrigin:performance.timeOrigin,queued:[],released:[],real_status:null,success_dom:false,after_release:null,completed:false};observer=new MutationObserver(maybeRelease);observer.observe(status,{childList:true,subtree:true,characterData:true});};
  globalThis.__t21StopLogoutCallbackGate=()=>{observer?.disconnect();release();for(const [channel,handler]of handlers)descriptor.set.call(channel,handler);Object.defineProperty(BroadcastChannel.prototype,'onmessage',descriptor);};
 }
 globalThis.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname,method=init?.method??'GET';
  if(method==='POST'&&/^\\/api\\/reporter\\/tickets\\/[A-Za-z0-9_-]{32}\\/feedback$/.test(path)){
   const command=JSON.parse(init.body),row={method,path,status:null,commandId:command.client_command_id,body:null};globalThis.__t21Wire.push(row);
   ${mode==='drop'?"throw new TypeError('SYNTHETIC_REQUEST_NEVER_REACHED_SERVER');":"await new Promise(resolve=>{globalThis.__t21ReleasePost=resolve;});globalThis.__t21PostReleased=true;globalThis.__t21HeldSignalAborted=init.signal?.aborted===true;"}
   try{const response=await send(input,init);row.status=response.status;return response;}finally{globalThis.__t21PostSettled=true;}
  }
  const response=await send(input,init);if(path==='/api/reporter/logout')globalThis.__t21RealLogoutStatus=response.status;if(/\\/feedback\\/commands\\//.test(path))globalThis.__t21Wire.push({method,path,status:response.status,commandId:path.split('/').at(-1),body:await response.clone().json()});return response;
 };})()`;}

// Read-only metadata inspection. It first enumerates databases, so an observer
// cannot create the very database whose default absence is being asserted.
function storage(publicRef:string){return `(async()=>{const databases=await indexedDB.databases();if(!databases.some(row=>row.name==='wecom-workbench-drafts-v1'))return {exists:false,drafts:[],operations:[]};
 return new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onupgradeneeded=()=>open.transaction.abort();open.onerror=()=>reject(open.error);open.onsuccess=()=>{
  const db=open.result,tx=db.transaction(['drafts','operations'],'readonly'),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();
  tx.onabort=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();const select=row=>row.id===${JSON.stringify(publicRef)}&&row.purpose==='bot-reporter-feedback';resolve({exists:true,
   drafts:drafts.result.filter(select).map(row=>({principal:row.principal,id:row.id,purpose:row.purpose,revision:row.revision,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,ciphertextBytes:row.ciphertext.byteLength,keyExtractable:row.key.extractable})),
   operations:operations.result.filter(select).map(row=>({principal:row.principal,id:row.id,purpose:row.purpose,commandId:row.commandId}))});};};});})()`;}
async function snapshot(surface:Surface,publicRef:string):Promise<Storage>{const value=object(await surface.evaluate(storage(publicRef)));assert.equal(typeof value.exists,'boolean');return {exists:value.exists===true,drafts:records(value.drafts),operations:records(value.operations)};}
async function reload(surface:Surface){const previous=await surface.evaluate('performance.timeOrigin');assert.equal(typeof previous,'number');await surface.command('Page.reload');await surface.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
async function focusReady(surface:Surface){const hidden=await surface.evaluate('document.hidden');assert.equal(typeof hidden,'boolean');if(hidden)await surface.evaluate(`(()=>{globalThis.__t21FocusReady=false;const observer=new MutationObserver(()=>{if(${submit}?.disabled===false){globalThis.__t21FocusReady=true;observer.disconnect();}});observer.observe(document.querySelector('#bot-feedback-panel'),{childList:true,subtree:true});})()`);await surface.command('Page.bringToFront');await surface.waitFor(`${hidden?'globalThis.__t21FocusReady===true&&':''}${enabled}&&document.hidden===false`);}
async function scope(surface:Surface){const value=object(await surface.evaluate("fetch('/api/reporter/feedback/recovery',{credentials:'same-origin',cache:'no-store'}).then(async response=>({status:response.status,body:await response.json()}))"));assert.equal(value.status,200);const body=object(value.body);assert.equal(body.schema_version,1);assert.equal(typeof body.raw_enabled,'boolean');assert.equal(typeof body.recovery_scope,'string');assert.match(String(body.recovery_scope),/^[a-f0-9]{64}$/u);return String(body.recovery_scope);}
async function unknown(surface:Surface,path:string,commandId:string){await surface.waitFor(checkable);await surface.evaluate(`${check}.click()`);await surface.waitFor(`${status}?.textContent.includes('尚无可确认终态')&&${check}?.disabled===false`);const observed=wires(await surface.evaluate('globalThis.__t21Wire'));const receipt=observed.find(row=>row.method==='GET'&&row.path===path+'/feedback/commands/'+commandId);assert.ok(receipt,'the public control must GET the exact original UUID');assert.equal(receipt.status,200);assert.deepEqual(receipt.body,{client_command_id:commandId,public_ref:path.split('/').at(-1),state:'UNKNOWN'});}
async function original(surface:Surface){const rows=wires(await surface.evaluate('globalThis.__t21Wire')),post=rows.find(row=>row.method==='POST');assert.ok(post);assert.equal(typeof post.commandId,'string');assert.match(String(post.commandId),uuid);return String(post.commandId);}
const holdEncryption=`(()=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle),held=[];globalThis.__t21EncryptionHeld=0;
 crypto.subtle.encrypt=(...args)=>new Promise((resolve,reject)=>{globalThis.__t21EncryptionHeld++;held.push(()=>encrypt(...args).then(resolve,reject));});
 globalThis.__t21ReleaseEncryption=()=>{crypto.subtle.encrypt=encrypt;for(const send of held.splice(0))send();};})()`;

interface Run {f:T21DraftFixture;fixture:NonNullable<Awaited<ReturnType<typeof createYxxBrowserFixture>>>;browser:Browser;peers:Peer[];serverWire:{method:string;path:string;status:number|null}[];directory:string;page:string}
async function withBrowser(raw:boolean|undefined,mode:'drop'|'hold',run:(value:Run)=>Promise<void>){
 assert.match(fileURLToPath(import.meta.url).replaceAll('\\','/'),/\/\.build\/runtime\/tests\/t21-bot-feedback-current-risks\.browser\.test\.mjs$/u);
 if(process.platform==='win32')assert.match(resolve(tmpdir()),/^D:[\\/]/iu);
 await withT21DraftFixture(async f=>{
  const mapping=await t21Mapping(),directory=join(tmpdir(),'t21-browser-current-risks-'+randomUUID());await mkdir(directory);
  let fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,browser:Browser|undefined,app:{server:Server;stop():Promise<void>}|undefined,primary:unknown;
  const peers:Peer[]=[],serverWire:{method:string;path:string;status:number|null}[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{const path=new URL(request.url??'/','http://127.0.0.1').pathname;if(path!==f.path+'/feedback'&&!path.startsWith(f.path+'/feedback/commands/'))return;const row={method:request.method??'',path,status:null as number|null};serverWire.push(row);response.once('finish',()=>{row.status=response.statusCode;});};
  try{
   fixture=await createYxxBrowserFixture({pool:f.context.pool,createApp:({oauth,origin:publicOrigin}:{oauth:WeComOAuth;origin:string})=>{
    const runtime=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,oauth,publicOrigin,reporterMemberEntry:t21Config,identityMapping:mapping,reporterHmacSecret:secret,botReporterFeedbackEnabled:true,botReporterFeedbackDraftRecoveryEnabled:raw??false,
     yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},pollMilliseconds:100}});
    app=runtime;runtime.server.on('request',observe);return runtime.server;
   }});
   assert.ok(fixture);fixture.setMember('open-a');browser=await fixture.launch({path:'/synthetic-start',width:390,height:844});assert.ok(browser);
   const page=fixture.origin+'/wecom/yixiaoxiu/tickets/'+f.publicRef;
   await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:transport(mode)});await browser.command('Page.navigate',{url:page});await browser.waitFor(enabled);
   assert.equal(await browser.evaluate("Boolean(document.querySelector('script[type=module][src=\"/reporter/bot-feedback.js\"]'))"),true,'execute the staged production Bot bundle');
   await run({f,fixture,browser,peers,serverWire,directory,page});
  }catch(error){primary=error;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(failure(error)));if(browser){const gate=await browser.evaluate('globalThis.__t21LogoutGate??null');if(gate)console.log('T21_LOGOUT_GATE '+JSON.stringify(gate));}}catch(diagnosticFailure){primary=new AggregateError([primary,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([
   async()=>{if(browser){await writeFile(join(directory,'public-server-wire.json'),JSON.stringify(serverWire));const png=Buffer.from(await browser.screenshot(),'base64');await writeFile(join(directory,'final-or-failure.png'),png);const receiptDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());await mkdir(receiptDirectory);const file=join(receiptDirectory,randomUUID()+'.png');await writeFile(file,png);console.log('SS010_BROWSER '+JSON.stringify({screenshots:[{file,width:png.readUInt32BE(16),height:png.readUInt32BE(20),sha256:createHash('sha256').update(png).digest('hex')}]}));}},
   async()=>{for(const peer of peers)await peer.evaluate('globalThis.__t21ReleaseEncryption?.();globalThis.__t21ReleasePost?.()');if(browser)await browser.evaluate('globalThis.__t21ReleaseEncryption?.();globalThis.__t21ReleasePost?.()');},
   async()=>{for(const peer of peers)await peer.evaluate('globalThis.__t21StopLogoutCallbackGate?.()');if(browser)await browser.evaluate('globalThis.__t21StopLogoutCallbackGate?.()');},
   async()=>{for(const peer of peers)await peer.close();},
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
   async()=>{app?.server.off('request',observe);await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},
   async()=>{await app?.stop();await writeFile(join(directory,'terminal-resources.json'),JSON.stringify({browser:browser?.ownedResourceState()??null,fixture:fixture?.ownedResourceState()??null,memberListening:app?.server.listening??false}));},
  ],primary);
  await f.verifyStaff(async staff=>{const current=await staff.detail(f.ticketId);assert.equal(current.status,'CLOSED');assert.equal(current.version,f.completed.version);assert.deepEqual(current.handling_cycle,f.completed.handling_cycle);});
 });
}

test('Bot raw recovery default off creates no IndexedDB; a request absent from the server remains its original UUID UNKNOWN and refresh never POSTs',async()=>{
 await withBrowser(undefined,'drop',async({f,browser,serverWire})=>{
  assert.deepEqual(await snapshot(browser,f.publicRef),{exists:false,drafts:[],operations:[]});
  await browser.evaluate(`${submit}.click()`);await browser.waitFor(`${status}?.textContent.includes('结果未知')&&${check}?.disabled===false`);
  const id=await original(browser);assert.equal(wires(await browser.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,1);assert.equal(serverWire.filter(row=>row.method==='POST').length,0,'the original request never reached the real server');
  await unknown(browser,f.path,id);await browser.evaluate("document.querySelector('#refresh').click()");await browser.waitFor(checkable);await unknown(browser,f.path,id);
  assert.equal(wires(await browser.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,1,'refresh cannot retry the original command or manufacture another UUID');
  assert.deepEqual(await snapshot(browser,f.publicRef),{exists:false,drafts:[],operations:[]});
  await reload(browser);await browser.waitFor(enabled);
  assert.equal(wires(await browser.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,0,'reload also cannot POST');assert.deepEqual(await snapshot(browser,f.publicRef),{exists:false,drafts:[],operations:[]});
  assert.equal(serverWire.filter(row=>row.method==='POST').length,0);
 });
});

test('Bot raw recovery expires at 24h and restores only current-member READ; genuine same-profile competing tabs and logout keep opaque operations without POST or cross-member exposure',async()=>{
 // Two bounded arrangements in one riskgroup: expiry/current READ, then native
 // same-profile competition/logout. Each arrangement owns and closes one PG.
 await withBrowser(true,'drop',async({f,fixture,browser,serverWire,page})=>{
  const principal=await scope(browser);await browser.evaluate(`${submit}.click()`);await browser.waitFor(`${status}?.textContent.includes('结果未知')&&${check}?.disabled===false`);
  const id=await original(browser),saved=await snapshot(browser,f.publicRef);assert.equal(saved.drafts.length,1);assert.equal(saved.operations.length,1);const draft=saved.drafts[0];assert.ok(draft);assert.equal(draft.principal,principal);assert.equal(draft.keyExtractable,false);assert.equal(typeof draft.expiresAt,'number');assert.equal(typeof draft.firstSavedAt,'number');assert.equal(Number(draft.expiresAt)-Number(draft.firstSavedAt),86_400_000);assert.equal(saved.operations[0]?.commandId,id);
  // Client Date only; no server/auth clock, storage-row mutation or private import.
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`Date.now=()=>${Number(draft.expiresAt)+1};`});await reload(browser);await browser.waitFor(checkable);
  const expired=await snapshot(browser,f.publicRef);assert.deepEqual(expired.drafts,[]);assert.equal(expired.operations.length,1);assert.equal(expired.operations[0]?.commandId,id);await unknown(browser,f.path,id);
  await browser.evaluate("document.querySelector('#logout').click()");await browser.waitFor("document.querySelector('#status')?.textContent.includes('已退出访问')");fixture.setMember('open-a');await browser.command('Page.navigate',{url:page});await browser.waitFor(checkable);assert.equal(await scope(browser),principal,'reauth must recover the same currently authorized member scope');await unknown(browser,f.path,id);
  assert.deepEqual((await snapshot(browser,f.publicRef)).drafts,[]);assert.equal((await snapshot(browser,f.publicRef)).operations[0]?.commandId,id);
  await browser.evaluate("document.querySelector('#logout').click()");await browser.waitFor("document.querySelector('#status')?.textContent.includes('已退出访问')");fixture.setMember('open-b');await browser.command('Page.navigate',{url:page});await browser.waitFor("document.querySelector('#status')?.textContent.includes('无权查看')");assert.notEqual(await scope(browser),principal);
  assert.equal(await browser.evaluate("document.querySelector('#ticket')?.hidden"),true);assert.equal(await browser.evaluate(`Boolean(${check})&&(${check}).getClientRects().length>0`),false);
  const denied=object(await browser.evaluate(`fetch(${JSON.stringify(f.path+'/feedback/commands/'+id)},{credentials:'same-origin',cache:'no-store'}).then(async response=>({status:response.status,body:await response.json()}))`));assert.equal(denied.status,404);assert.doesNotMatch(JSON.stringify(denied.body),new RegExp(id+'|INTERNAL_T11_CANARY|user-test|bot-test','u'));
  assert.equal(wires(await browser.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,0);assert.equal(serverWire.filter(row=>row.method==='POST').length,0);
 });
 await withBrowser(true,'hold',async({f,fixture,browser,peers,serverWire,page})=>{
  const principal=await scope(browser),peer=await yxxTab(browser,'about:blank');peers.push(peer);await peer.command('Page.enable');await peer.command('Page.addScriptToEvaluateOnNewDocument',{source:transport('hold')});await peer.command('Page.navigate',{url:page});await peer.waitFor(enabled);assert.equal(await scope(peer),principal);
  // Refresh the first target before starting either intent. Never navigate the
  // peer after the first intent: its auth broadcast would invalidate that actor.
  await browser.command('Page.bringToFront');await reload(browser);await browser.waitFor(enabled);await browser.evaluate(holdEncryption);await browser.evaluate(`${submit}.click()`);await browser.waitFor('globalThis.__t21EncryptionHeld===1');
  // Observe the real final visibility/load render at the public DOM boundary.
  await focusReady(peer);await peer.evaluate(holdEncryption);await peer.evaluate(`${submit}.click()`);await peer.waitFor('globalThis.__t21EncryptionHeld===1');
  await browser.evaluate('globalThis.__t21ReleaseEncryption()');await browser.waitFor("typeof globalThis.__t21ReleasePost==='function'");const id=await original(browser),saved=await snapshot(browser,f.publicRef);assert.equal(saved.drafts.length,1);assert.equal(saved.operations[0]?.commandId,id);
  await peer.evaluate('globalThis.__t21ReleaseEncryption()');await peer.waitFor(`${status}?.textContent.includes('结果未知')&&${check}?.disabled===false`);assert.equal(wires(await peer.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,0,'the stale blank handle cannot send a competing new intent');
  await peer.evaluate(`${check}.click()`);await peer.waitFor(`${status}?.textContent.includes('尚无可确认终态')&&${check}?.disabled===false`);const peerReceipt=wires(await peer.evaluate('globalThis.__t21Wire')).find(row=>row.method==='GET'&&row.path.startsWith(f.path+'/feedback/commands/'));assert.ok(peerReceipt);assert.equal(peerReceipt.status,200);assert.equal(typeof peerReceipt.commandId,'string');assert.match(String(peerReceipt.commandId),uuid);assert.notEqual(peerReceipt.commandId,id,'both real tabs began distinct new intents');assert.equal(object(peerReceipt.body).state,'UNKNOWN');
  // Release only already received native callbacks after the real logout and success DOM.
  await browser.evaluate('globalThis.__t21ArmLogoutCallbackGate()');await browser.command('Page.bringToFront');await browser.evaluate("document.querySelector('#logout').click()");await browser.waitFor("document.querySelector('#status')?.textContent.includes('已退出访问')&&globalThis.__t21LogoutGate?.completed===true");
  const gate=object(await browser.evaluate('globalThis.__t21LogoutGate'));assert.equal(gate.real_status,200);assert.equal(gate.success_dom,true);assert.equal(gate.after_release,'已退出访问。');assert.equal(gate.timeOrigin,await browser.evaluate('performance.timeOrigin'));const queued=records(gate.queued),released=records(gate.released);assert.ok(queued.some(event=>event.kind==='bot-feedback-logout'));assert.equal(released.length,queued.length);assert.ok([...queued,...released].every(event=>event.trusted===true&&['revalidate','bot-feedback-logout'].includes(String(event.kind))));console.log('T21_LOGOUT_GATE '+JSON.stringify(gate));
  await peer.waitFor("document.querySelector('#bot-feedback-panel')?.hidden===true");
  const cleared=await snapshot(browser,f.publicRef);assert.deepEqual(cleared.drafts,[]);assert.equal(cleared.operations.length,1);assert.equal(cleared.operations[0]?.commandId,id);assert.deepEqual(await snapshot(peer,f.publicRef),cleared,'native BroadcastChannel cleanup reaches the real peer tab');
  await browser.evaluate('globalThis.__t21ReleasePost()');await browser.waitFor('globalThis.__t21PostReleased===true&&globalThis.__t21PostSettled===true');assert.equal(await browser.evaluate('globalThis.__t21HeldSignalAborted'),true);assert.equal(serverWire.filter(row=>row.method==='POST').length,0,'logout aborts the original signal before a held request can reach the server');
  fixture.setMember('open-a');await browser.command('Page.navigate',{url:page});await browser.waitFor(checkable);assert.equal(await scope(browser),principal);await unknown(browser,f.path,id);
  await peer.command('Page.bringToFront');await reload(peer);await peer.waitFor(checkable);await unknown(peer,f.path,id);assert.deepEqual((await snapshot(peer,f.publicRef)).drafts,[]);assert.equal((await snapshot(peer,f.publicRef)).operations[0]?.commandId,id);
  assert.equal(wires(await browser.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,0);assert.equal(wires(await peer.evaluate('globalThis.__t21Wire')).filter(row=>row.method==='POST').length,0);assert.equal(serverWire.filter(row=>row.method==='POST').length,0);
 });
});
