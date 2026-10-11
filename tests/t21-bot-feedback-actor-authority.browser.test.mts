// Registered current production-bundle risk tracer; external first draft is retained.
// Two exact Spec gaps; preserve the original seven and existing riskgroup file.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import type {IncomingMessage,Server,ServerResponse} from 'node:http';
import type {WeComOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {textHashP2016,transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {withT21DraftFixture,t21Config,t21Mapping} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import type {T21DraftFixture} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {secret} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxBrowserFixture,yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Peer=Awaited<ReturnType<typeof yxxTab>>;
type Surface=Pick<Browser,'evaluate'|'waitFor'|'command'>;
interface Ticket {id:string;ref:string;path:string;version:number}
interface ActorCopies {drafts:Record<string,unknown>[];operations:Record<string,unknown>[]}
interface ServerWire {method:string;path:string;status:number|null}
const submit="document.querySelector('[data-action=submit-bot-feedback]')";
const check="document.querySelector('[data-action=check-bot-feedback-command]')";
const state="document.querySelector('#bot-feedback-panel [data-feedback-state]')";
const enabled=`${submit}?.disabled===false&&document.querySelector('#ticket')?.hidden===false&&document.hidden===false`;
const checkable=`${check}?.disabled===false&&document.querySelector('#bot-feedback-panel')?.hidden===false&&document.hidden===false`;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function failure(value:unknown):unknown{return value instanceof Error?{name:value.name,message:value.message,stack:value.stack,...(value instanceof AggregateError?{errors:value.errors.map(failure)}:{})}:String(value);}

// The original POST does not reach native fetch. Every observed GET below is a
// real request; no response, DOM control, command receipt or invalidation is faked.
const transport=`(()=>{const send=fetch;globalThis.__t21Wire=[];globalThis.__t21Attempts=[];
 globalThis.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname,method=init?.method??'GET';
  if(method==='POST'&&/^\\/api\\/reporter\\/tickets\\/[A-Za-z0-9_-]{32}\\/feedback$/.test(path)){const command=JSON.parse(init.body);globalThis.__t21Attempts.push({path,commandId:command.client_command_id});throw new TypeError('SYNTHETIC_REQUEST_NEVER_REACHED_SERVER');}
  const response=await send(input,init);if(path.startsWith('/api/'))globalThis.__t21Wire.push({path,method,status:response.status});return response;
 };})()`;
function actorCopies(principal:string){return `(async()=>{if(!(await indexedDB.databases()).some(row=>row.name==='wecom-workbench-drafts-v1'))return {drafts:[],operations:[]};
 return new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onupgradeneeded=()=>request.transaction.abort();request.onerror=()=>reject(request.error);request.onsuccess=()=>{
  const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();
  tx.onabort=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();const own=row=>row.principal===${JSON.stringify(principal)}&&row.kind==='web-feedback'&&row.purpose==='bot-reporter-feedback';resolve({
   drafts:drafts.result.filter(own).map(row=>({principal:row.principal,id:row.id,revision:row.revision,ciphertextBytes:row.ciphertext.byteLength,keyExtractable:row.key.extractable})),
   operations:operations.result.filter(own).map(row=>({principal:row.principal,id:row.id,commandId:row.commandId}))});};};});})()`;}
async function copies(surface:Surface,principal:string):Promise<ActorCopies>{const value=object(await surface.evaluate(actorCopies(principal)));return {drafts:rows(value.drafts),operations:rows(value.operations)};}
async function read(surface:Surface,path:string){return object(await surface.evaluate(`fetch(${JSON.stringify(path)},{credentials:'same-origin',cache:'no-store'}).then(async response=>{const body=await response.json();return {status:response.status,body:${path==='/api/yixiaoxiu/bootstrap'?"response.ok?{authenticated:body.authenticated,identity_mode:body.identity_mode,recovery_scope:body.recovery_scope,feedback_draft_recovery_enabled:body.feedback_draft_recovery_enabled}:body":path==='/api/reporter/feedback/bootstrap'?"response.ok?{schema_version:body.schema_version,write_enabled:body.write_enabled,csrf_shape:typeof body.csrf_token==='string'&&/^[a-f0-9]{64}$/.test(body.csrf_token)}:body":"body"}};})`));}
async function principal(surface:Surface){const current=await read(surface,'/api/reporter/feedback/recovery');assert.equal(current.status,200);const body=object(current.body);assert.equal(body.schema_version,1);assert.equal(typeof body.raw_enabled,'boolean');assert.equal(typeof body.recovery_scope,'string');assert.match(String(body.recovery_scope),/^[a-f0-9]{64}$/u);return String(body.recovery_scope);}
async function begin(surface:Surface,ticket:Ticket){await surface.waitFor(enabled);await surface.evaluate(`${submit}.click()`);await surface.waitFor(`${state}?.textContent.includes('结果未知')&&${check}?.disabled===false`);const attempts=rows(await surface.evaluate('globalThis.__t21Attempts'));assert.equal(attempts.length,1);const attempt=attempts[0];assert.ok(attempt);assert.equal(attempt.path,ticket.path+'/feedback');assert.equal(typeof attempt.commandId,'string');assert.match(String(attempt.commandId),uuid);return String(attempt.commandId);}
async function result(surface:Surface,ticket:Ticket,id:string){await surface.waitFor(checkable);await surface.evaluate(`${check}.click()`);await surface.waitFor(`${state}?.textContent.includes('尚无可确认终态')&&${check}?.disabled===false`);const wire=rows(await surface.evaluate('globalThis.__t21Wire'));assert.ok(wire.some(row=>row.method==='GET'&&row.path===ticket.path+'/feedback/commands/'+id&&row.status===200),'real UI must GET the exact original purpose/object/UUID');}
async function ownReadBeforeRestore(surface:Surface,ticket:Ticket){const wire=rows(await surface.evaluate('globalThis.__t21Wire'));assert.ok(wire.some(row=>row.method==='GET'&&row.path===ticket.path&&row.status===200),'this newly loaded production document must first complete current own Bot detail READ before exposing its original operation');}
const view="({path:location.pathname,hidden:document.hidden,ticketHidden:document.querySelector('#ticket')?.hidden,panelHidden:document.querySelector('#bot-feedback-panel')?.hidden,checkVisible:Boolean(document.querySelector('[data-action=check-bot-feedback-command]'))&&document.querySelector('[data-action=check-bot-feedback-command]').getClientRects().length>0,state:document.querySelector('#bot-feedback-panel [data-feedback-state]')?.textContent??'',attempts:globalThis.__t21Attempts??[],wire:globalThis.__t21Wire??[]})";

interface Tracer {f:T21DraftFixture;original:Ticket;second:Ticket|null;fixture:NonNullable<Awaited<ReturnType<typeof createYxxBrowserFixture>>>;browser:Browser;peers:Peer[];directory:string;serverWire:ServerWire[];setMyReports(value:boolean):void;page(ticket:Ticket):string}
async function withTracer(twoTickets:boolean,run:(value:Tracer)=>Promise<void>){
 assert.match(fileURLToPath(import.meta.url).replaceAll('\\','/'),/\/\.build\/runtime\/tests\/t21-bot-feedback-actor-authority\.browser\.test\.mjs$/u);assert.match(resolve(tmpdir()),/^D:[\\/]/iu);
 await withT21DraftFixture(async f=>{
  const original:Ticket={id:f.ticketId,ref:f.publicRef,path:f.path,version:f.completed.version};let second:Ticket|null=null;
  if(twoTickets){
   // Existing public fixture API; sequential real Core and T11 HTTP commands.
   // It owns the same PG and closes its staff runtime before browser App starts.
   second=await f.verifyStaff(async staff=>{
    const intake=await seedPersistedIntake({pool:f.context.pool,text:'第二个合成 Bot 本人工单打印故障。',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
    const created=await createPilotTicketCore({pool:f.context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t21-actor-other-bot-ticket'});assert.ok(created.ticket);
    const id=created.ticket.id,active=await staff.start(id);assert.equal((await staff.post(id,'complete',staff.command(active))).status,200);const completed=await staff.detail(id);assert.equal(completed.status,'CLOSED');assert.ok(completed.handling_cycle?.staff_completion_event_id);
    const binding=await transactionP2016(f.context.pool,transaction=>f.access.ensurePublicRefInTransaction({transaction,ticketId:id,reporterBindingHash:textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','user-test']))}));
    return {id,ref:binding.public_ref,path:'/api/reporter/tickets/'+binding.public_ref,version:completed.version};
   });assert.notEqual(second.ref,original.ref);
  }
  const mapping=await t21Mapping(),directory=join(tmpdir(),'t21-actor-authority-'+randomUUID());await mkdir(directory);let myReports=true;
  function makeApp(oauth:WeComOAuth,publicOrigin:string){return createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,oauth,publicOrigin,reporterMemberEntry:t21Config,identityMapping:mapping,reporterHmacSecret:secret,botReporterFeedbackEnabled:true,botReporterFeedbackDraftRecoveryEnabled:true,
   yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:myReports},pollMilliseconds:100}});}
  const managed:ReturnType<typeof makeApp>[]=[],peers:Peer[]=[],serverWire:ServerWire[]=[];let fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,browser:Browser|undefined,primary:unknown;
  const observe=(request:IncomingMessage,response:ServerResponse)=>{const path=new URL(request.url??'/','http://127.0.0.1').pathname;if(!path.startsWith('/api/reporter')&&path!=='/api/yixiaoxiu/bootstrap')return;const row={method:request.method??'',path,status:null as number|null};serverWire.push(row);response.once('finish',()=>{row.status=response.statusCode;});};
  try{
   fixture=await createYxxBrowserFixture({pool:f.context.pool,createApp:({oauth,origin}:{oauth:WeComOAuth;origin:string})=>{const runtime=makeApp(oauth,origin);managed.push(runtime);runtime.server.on('request',observe);return runtime.server;},
    // Existing fixture replacement hook: closes old profile, OAuth and extension
    // before restart creates a fresh same-origin synthetic App/session.
    stopApp:async(server:Server)=>{const runtime=managed.find(candidate=>candidate.server===server);assert.ok(runtime);await runtime.stop();assert.equal(server.listening,false);}});
   assert.ok(fixture);fixture.setMember('open-a');browser=await fixture.launch({path:'/synthetic-start',width:390,height:844});assert.ok(browser);
   assert.ok(fixture);const browserOrigin=fixture.origin,page=(ticket:Ticket)=>browserOrigin+'/wecom/yixiaoxiu/tickets/'+ticket.ref;
   await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:transport});await browser.command('Page.navigate',{url:page(original)});await browser.waitFor(enabled);
   assert.equal(await browser.evaluate("Boolean(document.querySelector('script[type=module][src=\"/reporter/bot-feedback.js\"]'))"),true);
   await run({f,original,second,fixture,browser,peers,directory,serverWire,setMyReports:value=>{myReports=value;},page});
  }catch(error){primary=error;await writeFile(join(directory,'primary-error.json'),JSON.stringify(failure(error)));}
  await closeBrowserTestResources([
   async()=>{if(browser){await writeFile(join(directory,'terminal-view.json'),JSON.stringify(await browser.evaluate(view)));const png=Buffer.from(await browser.screenshot(),'base64');await writeFile(join(directory,'final-or-failure.png'),png);const receiptDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());await mkdir(receiptDirectory);const file=join(receiptDirectory,randomUUID()+'.png');await writeFile(file,png);console.log('SS010_BROWSER '+JSON.stringify({screenshots:[{file,width:png.readUInt32BE(16),height:png.readUInt32BE(20),sha256:createHash('sha256').update(png).digest('hex')}]}));}await writeFile(join(directory,'server-wire.json'),JSON.stringify(serverWire));},
   async()=>{if(browser)await browser.evaluate('globalThis.__t21CloseObservers?.()');for(const peer of peers)await peer.evaluate('globalThis.__t21CloseObservers?.()');},
   async()=>{for(const peer of peers)await peer.close();},
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
   async()=>{await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},
   async()=>{for(const runtime of managed){runtime.server.off('request',observe);await runtime.stop();assert.equal(runtime.server.listening,false);}await writeFile(join(directory,'terminal-resources.json'),JSON.stringify({browser:browser?.ownedResourceState()??null,fixture:fixture?.ownedResourceState()??null,managedListening:managed.map(runtime=>runtime.server.listening)}));},
  ],primary);
 });
}

test('Bot original UNKNOWN recovery remains current READ when a same-origin restart disables MY_REPORTS and the unrelated Web bootstrap is truly 403',async()=>{
 await withTracer(false,async({original,fixture,browser,directory,serverWire,setMyReports,page})=>{
  const actor=await principal(browser),id=await begin(browser,original),saved=await copies(browser,actor);assert.equal(saved.drafts.length,1);assert.equal(saved.operations.length,1);assert.equal(saved.operations[0]?.commandId,id);assert.equal(saved.drafts[0]?.keyExtractable,false);assert.equal(serverWire.filter(row=>row.method==='POST'&&row.path===original.path+'/feedback').length,0);
  setMyReports(false);await fixture.restart();fixture.setMember('open-a');await browser.command('Page.navigate',{url:page(original)});await browser.waitFor("document.querySelector('#ticket')?.hidden===false&&document.readyState==='complete'");
  const detail=await read(browser,original.path),receipt=await read(browser,original.path+'/feedback/commands/'+id),bot=await read(browser,'/api/reporter/feedback/bootstrap'),web=await read(browser,'/api/yixiaoxiu/bootstrap');
  assert.equal(detail.status,200);assert.equal(object(detail.body).public_ref,original.ref);assert.equal(object(object(detail.body).feedback_context).can_feedback,false);assert.equal(bot.status,200);assert.equal(object(bot.body).write_enabled,false);
  assert.equal(receipt.status,200);assert.deepEqual(receipt.body,{client_command_id:id,public_ref:original.ref,state:'UNKNOWN'});assert.equal(web.status,403,'existing Web read capability is really disabled; it cannot veto Bot own READ');
  // Current source reaches the explicit permission-error branch; fixed source
  // reaches its recovered check control. Neither outcome is a test-owned state.
  await browser.waitFor(`${checkable}||${state}?.textContent.includes('当前访问权限需重新核验')`);
  await writeFile(join(directory,'my-reports-disabled-before-ui-assert.json'),JSON.stringify({actor,original:id,detailStatus:detail.status,receipt,bot,web,view:await browser.evaluate(view),copies:await copies(browser,actor),serverWire}));
  assert.equal(await browser.evaluate(`Boolean(${check})&&(${check}).getClientRects().length>0&&(${check}).disabled===false`),true,'independent Bot current READ must restore the original opaque operation even when MY_REPORTS=false');
  await ownReadBeforeRestore(browser,original);await result(browser,original,id);assert.deepEqual((await copies(browser,actor)).drafts,[],'no current new-write authority retains the sensitive command copy');assert.equal((await copies(browser,actor)).operations[0]?.commandId,id);
  assert.equal(rows(await browser.evaluate('globalThis.__t21Attempts')).length,0);assert.equal(serverWire.filter(row=>row.method==='POST'&&row.path===original.path+'/feedback').length,0);
 });
});

test('logout from another own Bot Ticket clears all same-actor sensitive copies while a genuine hidden tab retains only original UUIDs and requires fresh own READ',async()=>{
 await withTracer(true,async({original,second,fixture,browser,peers,directory,serverWire,page})=>{
  assert.ok(second);const actor=await principal(browser),firstId=await begin(browser,original);
  const peer=await yxxTab(browser,'about:blank');peers.push(peer);await peer.command('Page.enable');await peer.command('Page.addScriptToEvaluateOnNewDocument',{source:transport});await peer.command('Page.navigate',{url:page(second)});await peer.command('Page.bringToFront');await peer.waitFor(enabled);assert.equal(await principal(peer),actor);const secondId=await begin(peer,second);assert.notEqual(secondId,firstId);
  await browser.waitFor('document.hidden===true');const before=await copies(peer,actor);assert.equal(before.drafts.length,2);assert.equal(before.operations.length,2);assert.deepEqual(before.operations.map(row=>row.commandId).sort(),[firstId,secondId].sort());
  // Observe genuine production broadcasts only. No manufactured invalidation.
  await browser.evaluate(`(()=>{globalThis.__t21AuthEvents=0;globalThis.__t21ActorLogouts=0;const auth=new BroadcastChannel('yixiaoxiu-auth'),drafts=new BroadcastChannel('wecom-workbench-drafts-v1');auth.onmessage=()=>globalThis.__t21AuthEvents++;drafts.onmessage=event=>{if(event.data?.principal===${JSON.stringify(actor)}&&event.data.reason==='logout')globalThis.__t21ActorLogouts++;};globalThis.__t21CloseObservers=()=>{auth.close();drafts.close();};})()`);
  await peer.evaluate("document.querySelector('#logout').click()");await peer.waitFor("document.querySelector('#status')?.textContent.includes('已退出访问')");await browser.waitFor('document.hidden===true&&globalThis.__t21AuthEvents>0&&globalThis.__t21ActorLogouts>0');
  const deniedDetail=await read(browser,original.path),deniedReceipt=await read(browser,original.path+'/feedback/commands/'+firstId);assert.equal(deniedDetail.status,401);assert.equal(deniedReceipt.status,401,'the hidden old actor has no current own READ authority');
  const after=await copies(peer,actor);await writeFile(join(directory,'hidden-other-object-logout-before-cleanup-assert.json'),JSON.stringify({actor,firstId,secondId,before,after,deniedDetail,deniedReceipt,hiddenView:await browser.evaluate(view),logoutView:await peer.evaluate(view),serverWire}));
  assert.deepEqual(after.drafts,[],'logging out the actor must remove ciphertext/key copies for every Bot object, including the hidden other Ticket');
  assert.deepEqual(after.operations.map(row=>row.commandId).sort(),[firstId,secondId].sort(),'logout clears sensitive copies and preserves unresolved opaque UUID metadata');assert.deepEqual(await copies(browser,actor),after);
  fixture.setMember('open-a');await peer.command('Page.navigate',{url:page(second)});await peer.waitFor(checkable);await ownReadBeforeRestore(peer,second);assert.equal(await principal(peer),actor);assert.equal((await read(peer,second.path)).status,200);await result(peer,second,secondId);
  await browser.command('Page.bringToFront');await browser.command('Page.navigate',{url:page(original)});await browser.waitFor(checkable);await ownReadBeforeRestore(browser,original);assert.equal((await read(browser,original.path)).status,200);await result(browser,original,firstId);
  assert.deepEqual((await copies(browser,actor)).drafts,[]);assert.equal(rows(await browser.evaluate('globalThis.__t21Attempts')).length,0);assert.equal(rows(await peer.evaluate('globalThis.__t21Attempts')).length,0);assert.equal(serverWire.filter(row=>row.method==='POST'&&row.path.endsWith('/feedback')).length,0);
 });
});
