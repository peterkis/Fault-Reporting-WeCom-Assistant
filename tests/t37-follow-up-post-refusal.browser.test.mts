// STAGED_RUNTIME / first stale-view POST403 browser execution pending.
// No claim that a transferred-away HANDLER retains internal-note write permission.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createP2016Runtime,type P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const region='dialog.detail-dialog[open] [role="region"][aria-label="共享下次跟进时间"]',due='2030-01-02 09:30:00';
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
async function drain(fixture:T37Fixture){const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;for(let index=0;index<bound;index++){const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;}assert.fail('actual projection did not settle');}
function errorFacts(error:unknown):unknown{return error instanceof Error?{name:error.name,message:error.message,stack:error.stack,...(error instanceof AggregateError?{errors:error.errors.map(errorFacts)}:{})}:String(error);}
async function publicStorePath(){const manifest=object(JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8'))),file=text(object(manifest['src/feedback-recovery.ts']).file),inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));assert.match(file,/^assets\/[A-Za-z0-9_-]+\.js$/u);assert.ok(Array.isArray(inventory)&&inventory.includes(file));return '/workbench/app/'+file;}

for(const mode of ['direct','lost','disabled','temporary','csrf'])test(mode==='direct'?'a real follow-up maintenance POST403 confirms current Ticket READ before scoped recovery cleanup, without a Ticket-wide revoked broadcast':mode==='lost'?'a lost real follow-up maintenance POST403 settles its original FAILED UUID after current maintenance authority is lost':mode==='disabled'?'a failed follow-up acknowledgement settles after the real view is disabled with cached bootstrap flags':mode==='temporary'?'a temporary follow-up view failure preserves the original failed operation until an explicit retry':'a real follow-up transport CSRF403 preserves its original draft and UNKNOWN UUID while maintenance and Ticket READ survive',{timeout:240000},async()=>{
 const loseResponse=mode!=='direct'&&mode!=='csrf';
 await withT37Fixture(async fixture=>{
  const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,schedulePath=path+'/follow-up-schedule';
  const queued=await current(dispatcher,path),assigned=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));await drain(fixture);
  const initial=await current(handler,path);assert.equal(initial.assignee_id,fixture.handler);assert.deepEqual((await current(handler,schedulePath)).allowed_actions,['SET']);
  const cookie=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_REAL_HANDLER_COOKIE_REQUIRED');
  const scope={principal:fixture.handler,kind:'ticket',id:ticketId,purpose:'shared-follow-up-schedule'},directory=join(tmpdir(),'t37-post-refusal-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown,replacement:P2016EnabledRuntime|undefined;
  try{
   browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('草稿仅在当前浏览器')&&Boolean(document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}))`);
   const modulePath=await publicStorePath();
   // Observe the production store's actual synchronous invalidations. No synthetic invalidation is sent.
   await browser.evaluate(`(async()=>{globalThis.__t37RefusalStore=await import(${JSON.stringify(modulePath)});globalThis.__t37RefusalEvents=[];globalThis.__t37RefusalUnsubscribe=globalThis.__t37RefusalStore.subscribeDrafts(event=>globalThis.__t37RefusalEvents.push(event));})()`);
   // This gate runs after draft.prepare has completed and before the first real POST reaches fetch.
   await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t37RefusalReads=[];globalThis.__t37RefusalAcks=[];globalThis.__t37RefusalViews=[];globalThis.__t37RefusalPostCount=0;globalThis.__t37RefusalPost=null;globalThis.__t37RefusalHeld=false;globalThis.__t37CancelPost=()=>{};globalThis.__t37RestoreFetch=()=>{globalThis.fetch=original;};globalThis.__t37HoldBootstrap=false;globalThis.__t37BootstrapReleases=[];globalThis.__t37ResumeBootstrap=()=>{globalThis.__t37HoldBootstrap=false;for(const release of globalThis.__t37BootstrapReleases.splice(0))release();};
    globalThis.fetch=async(input,options)=>{const target=new URL(input instanceof Request?input.url:String(input),location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
     if(method==='POST'&&target===${JSON.stringify(schedulePath)}){globalThis.__t37RefusalPostCount++;const command=JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}'));globalThis.__t37RefusalPost={command,status:null,body:null};globalThis.__t37RefusalHeld=true;const signal=options?.signal??(input instanceof Request?input.signal:null);
      await new Promise((resolve,reject)=>{let finished=false;const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',aborted);globalThis.__t37RefusalHeld=false;error?reject(error):resolve();},aborted=()=>finish(new DOMException('Consumer aborted unsent POST','AbortError')),timer=setTimeout(()=>finish(Error('T37_PREPOST_GATE_TIMEOUT')),45_000);globalThis.__t37ReleasePost=()=>finish();globalThis.__t37CancelPost=aborted;signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});
     }
     let requestOptions=options;if(${JSON.stringify(mode==='csrf')}&&method==='POST'&&target===${JSON.stringify(schedulePath)}){const headers=new Headers(options?.headers??(input instanceof Request?input.headers:undefined));headers.set('x-csrf-token','T37_ACTUAL_INVALID_CSRF');requestOptions={...options,headers};}
     const response=await original(input,requestOptions);
     if(method==='GET'&&target==='/api/lifecycle/bootstrap'&&globalThis.__t37HoldBootstrap)await new Promise(resolve=>globalThis.__t37BootstrapReleases.push(resolve));
     if(method==='POST'&&target===${JSON.stringify(schedulePath)}){globalThis.__t37RefusalPost.status=response.status;globalThis.__t37RefusalPost.body=await response.clone().json();if(${JSON.stringify(loseResponse)}&&response.status===403)throw new TypeError('T37_ACTUAL_POST403_RESPONSE_LOST');}
     if(method==='GET'&&target.startsWith(${JSON.stringify(schedulePath+'/commands/')})){const receipt=await response.clone().json();globalThis.__t37RefusalAcks.push({commandId:target.slice(target.lastIndexOf('/')+1),status:response.status,state:receipt.state});}
     if(method==='GET'&&target===${JSON.stringify(schedulePath)}){const view=await response.clone().json();globalThis.__t37RefusalViews.push({status:response.status,code:view.error?.code??null});}
     if(method==='GET'&&target===${JSON.stringify(path)})globalThis.__t37RefusalReads.push({status:response.status,afterPost403:globalThis.__t37RefusalPost?.status===403,body:await response.clone().json()});
     return response;};})()`);
   await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(region+' input[name="due_at"]')});if(!(input instanceof HTMLInputElement)||input.disabled)throw Error('T37_REAL_INPUT_REQUIRED');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_REAL_INPUT_SETTER_REQUIRED');setter.call(input,${JSON.stringify(due)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   const setButton=`[...(document.querySelector(${JSON.stringify(region)})?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()==='设置共享时间')`;
   await browser.waitFor(`Boolean(${setButton})&&!(${setButton}).disabled`);await browser.evaluate(`(${setButton}).click()`);await browser.waitFor('globalThis.__t37RefusalHeld===true');
   const prepared=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));
   const pending=object(await browser.evaluate('globalThis.__t37RefusalPost'));assert.equal(pending.status,null);assert.ok(prepared.revision);assert.equal(prepared.commandId,object(pending.command).client_command_id);
   assert.equal((await current(handler,schedulePath)).active,null,'the held browser command has not reached the server');
   if(mode==='csrf'){
    await browser.evaluate('globalThis.__t37ReleasePost()');await browser.waitFor("globalThis.__t37RefusalPost.status===403&&globalThis.__t37RefusalReads.some(read=>read.afterPost403&&read.status===200)");
    await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('操作被拒绝')||document.querySelector(${JSON.stringify(region)})?.innerText.includes('原操作仍保留')`);
    const post=object(await browser.evaluate('globalThis.__t37RefusalPost')),retainedCopy=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));
    const ledgerCount=Number((await fixture.pool.query<{count:string}>('SELECT count(*)::text AS count FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND client_command_id=$2::uuid',[ticketId,prepared.commandId])).rows[0]?.count),view=await current(handler,schedulePath),receipt=await current(handler,schedulePath+'/commands/'+text(prepared.commandId));
    await writeFile(join(directory,'csrf-facts.json'),JSON.stringify({prepared,post,ledgerCount,view,receipt,retainedCopy,events:await browser.evaluate('globalThis.__t37RefusalEvents'),reads:await browser.evaluate('globalThis.__t37RefusalReads')},null,2));
    assert.equal(post.status,403);assert.equal(object(object(post.body).error).code,'WORKBENCH_CSRF_INVALID');assert.equal(object(post.command).client_command_id,prepared.commandId);assert.equal(ledgerCount,0);assert.equal(receipt.state,'UNKNOWN');assert.deepEqual(view.allowed_actions,['SET']);assert.deepEqual(await current(handler,path),initial);
    assert.deepEqual(retainedCopy,{revision:prepared.revision,commandId:prepared.commandId},'transport rejection cannot settle an original operation that never reached the ledger');
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(region+' input[name="due_at"]')})?.value`),due);assert.equal(await browser.evaluate('globalThis.__t37RefusalEvents.some(event=>["settled","revoked"].includes(event.reason))'),false);
    const checkButton=`[...(document.querySelector(${JSON.stringify(region)})?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()==='只读核对原操作')`;
    await browser.waitFor(`Boolean(${checkButton})&&!(${checkButton}).disabled`);await browser.evaluate(`(${checkButton}).click()`);await browser.waitFor(`globalThis.__t37RefusalAcks.some(ack=>ack.commandId===${JSON.stringify(prepared.commandId)}&&ack.status===200&&ack.state==='UNKNOWN')`);
    const afterRead=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));assert.deepEqual(afterRead,retainedCopy);assert.equal(await browser.evaluate('globalThis.__t37RefusalPostCount'),1);
   }else{
   const now=await current(dispatcher,path),transfer=await dispatcher.post(path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(now.version),reason_code:'WORKBENCH_TRANSFER',target_principal_id:fixture.otherHandler,resolver_team_id:text(now.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(transfer.status,200,JSON.stringify(transfer.value));
   const retained=await current(handler,path);assert.equal(retained.assignee_id,fixture.otherHandler);assert.deepEqual((await current(handler,schedulePath)).allowed_actions,[]);
   // The same handler still has team READ. Do not claim its old assignee-only add-note write capability survives.
   assert.ok(!rows((await current(handler,path+'/related-conversations?limit=20')).items).some(row=>row.conversation_principal_id===fixture.handler&&row.assignment_status==='ASSIGNED'));
   await browser.evaluate('globalThis.__t37ReleasePost()');await browser.waitFor('globalThis.__t37RefusalPost.status===403');
   if(loseResponse){
    await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('结果未知')`);
    const unresolved=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {commandId:copy.handle.operation?.commandId??null};})()`));assert.equal(unresolved.commandId,prepared.commandId);
    if(mode==='disabled'){
     const document=await browser.evaluate('performance.timeOrigin'),authentication=fixture.runtime.authenticate;assert.equal(authentication.close,undefined);
     await browser.evaluate('globalThis.__t37HoldBootstrap=true');await fixture.runtime.stop();assert.equal(fixture.runtime.server.listening,false);
     const next=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:Number(new URL(fixture.origin).port),
      principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],workbenchAuthentication:authentication,gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,ticketAssignmentEnabled:true,workbenchFollowUpSchedulesEnabled:false,workbenchDraftRecoveryEnabled:true});
     if('disabled' in next)throw Error('T37_DISABLED_VIEW_HOST_REQUIRED');replacement=next;assert.equal(replacement.authenticate,authentication);
     await listenConversationWorkbenchServer(replacement.server,{port:Number(new URL(fixture.origin).port)});assert.equal(await browser.evaluate('performance.timeOrigin'),document);
     const retainedCopy=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));assert.deepEqual(retainedCopy,{revision:prepared.revision,commandId:prepared.commandId});
    }
    const checkButton=`[...(document.querySelector(${JSON.stringify(region)})?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()==='只读核对原操作')`;
    const check=async()=>{assert.ok(browser);await browser.waitFor(`Boolean(${checkButton})&&!(${checkButton}).disabled`);await browser.evaluate(`(${checkButton}).click()`);await browser.waitFor(`globalThis.__t37RefusalAcks.some(ack=>ack.commandId===${JSON.stringify(prepared.commandId)}&&ack.status===200&&ack.state==='FAILED')`);};
    if(mode==='temporary'){
     const constraint=()=>fixture.pool.query<{definition:string}>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pilot_ticket.follow_up_schedule'::regclass AND conname='follow_up_current_time_pair'"),definition=text((await constraint()).rows[0]?.definition);assert.ok(definition.startsWith('CHECK '));let dropped=false,faultError:unknown;
     try{
      await fixture.pool.query('ALTER TABLE pilot_ticket.follow_up_schedule DROP CONSTRAINT follow_up_current_time_pair');dropped=true;await check();
      await browser.waitFor("globalThis.__t37RefusalViews.some(view=>view.status===503&&view.code==='P2_016_FOLLOW_UP_UNAVAILABLE')");
      await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('只读核对尚未完成')`);
      const retainedCopy=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));assert.deepEqual(retainedCopy,{revision:prepared.revision,commandId:prepared.commandId});
     }catch(error){faultError=error;}finally{await closeBrowserTestResources([async()=>{if(dropped)await fixture.pool.query('ALTER TABLE pilot_ticket.follow_up_schedule ADD CONSTRAINT follow_up_current_time_pair '+definition);assert.equal(text((await constraint()).rows[0]?.definition),definition);}],faultError);}
    }
    await check();
    if(mode==='disabled')await browser.waitFor("globalThis.__t37RefusalViews.some(view=>view.status===503&&view.code==='P2_016_DISABLED')");
   }
   await browser.waitFor(`globalThis.__t37RefusalEvents.some(event=>event.principal===${JSON.stringify(fixture.handler)}&&event.id===${JSON.stringify(ticketId)}&&['settled','revoked'].includes(event.reason))`);
   const events=rows(await browser.evaluate('globalThis.__t37RefusalEvents'));
   assert.equal(events.some(event=>event.reason==='revoked'&&event.principal===fixture.handler&&(event.id===undefined||event.id===ticketId)),false,'T37_MAINTENANCE_403_MUST_NOT_REVOKE_TICKET_READ_OR_OTHER_PURPOSES');
   assert.ok(events.some(event=>event.reason==='settled'&&event.purpose==='shared-follow-up-schedule'&&event.id===ticketId));
   await browser.waitFor('globalThis.__t37RefusalReads.some(read=>read.afterPost403&&read.status===200)');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open] #detail-title"))'),true);
   const post=object(await browser.evaluate('globalThis.__t37RefusalPost'));assert.equal(post.status,403);assert.match(text(object(object(post.body).error).code),/FORBIDDEN/u);
   assert.equal(object(post.command).client_command_id,prepared.commandId);assert.equal(await browser.evaluate('globalThis.__t37RefusalPostCount'),1,'refusal recovery must not issue a second POST or replace the original UUID');
   if(loseResponse){const acks=rows(await browser.evaluate('globalThis.__t37RefusalAcks'));assert.ok(acks.length>0&&acks.every(ack=>ack.commandId===prepared.commandId&&ack.status===200&&ack.state==='FAILED'));if(mode==='temporary')assert.equal(acks.length,2,'only explicit reads of the same FAILED UUID may retry the temporary view failure');}
   const settled=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));assert.deepEqual(settled,{revision:null,commandId:null});
   const receipt=await current(handler,schedulePath+'/commands/'+text(prepared.commandId));assert.equal(receipt.state,'FAILED');assert.deepEqual(await current(handler,path),retained);
   if(mode==='disabled'){const disabledView=await handler.get(schedulePath);assert.equal(disabledView.status,503);assert.equal(object(disabledView.value.error).code,'P2_016_DISABLED');assert.equal((await fixture.pool.query('SELECT 1 FROM pilot_ticket.follow_up_schedule WHERE ticket_id=$1::uuid',[ticketId])).rowCount,0);}else assert.equal((await current(handler,schedulePath)).active,null);
   await writeFile(join(directory,'refusal-facts.json'),JSON.stringify({mode,prepared,post,events,reads:await browser.evaluate('globalThis.__t37RefusalReads'),acks:await browser.evaluate('globalThis.__t37RefusalAcks'),views:await browser.evaluate('globalThis.__t37RefusalViews'),response_loss:loseResponse,settled,receipt},null,2));
   }
   const pixels=Buffer.from(await browser.screenshot(),'base64'),shots=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(shots);const file=join(shots,'new-detail-1920.png');await writeFile(file,pixels);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:mode==='csrf'?'T37_TRANSPORT_CSRF403_CURRENT_AUTHORITY_RETAINED':'T37_STALE_MAINTENANCE_POST403_CURRENT_READ_RETAINED',evidence_directory:directory,screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
  }catch(error){primary=error;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(error),null,2));if(browser){
   const pixels=Buffer.from(await browser.screenshot(),'base64');await writeFile(join(directory,'failure.png'),pixels);
   const shots=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(shots);const file=join(shots,'new-detail-1920.png');await writeFile(file,pixels);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scenario:'T37_POST_REFUSAL_FAILURE',response_loss:loseResponse,screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
   await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`({text:document.querySelector(${JSON.stringify(region)})?.innerText??'',post:globalThis.__t37RefusalPost,reads:globalThis.__t37RefusalReads,acks:globalThis.__t37RefusalAcks,views:globalThis.__t37RefusalViews,events:globalThis.__t37RefusalEvents})`)));
  }}catch(evidenceError){primary=new AggregateError([error,evidenceError],'T37_POST_REFUSAL_EVIDENCE');}console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory}));}
  await closeBrowserTestResources([async()=>{if(browser)await browser.evaluate('globalThis.__t37CancelPost?.();globalThis.__t37ResumeBootstrap?.();globalThis.__t37RestoreFetch?.();globalThis.__t37RefusalUnsubscribe?.();');},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(replacement){const closing=replacement;await closing.stop();assert.equal(closing.server.listening,false);assert.equal((await closing.observability.metrics()).sse_clients,0);assert.equal(await new Promise<number>((resolve,reject)=>closing.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);}}],primary);
 },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true});
});
