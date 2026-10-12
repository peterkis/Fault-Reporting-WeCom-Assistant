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

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const region='dialog.detail-dialog[open] [role="region"][aria-label="共享下次跟进时间"]',due='2030-01-02 09:30:00';
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
async function drain(fixture:T37Fixture){const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;for(let index=0;index<bound;index++){const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;}assert.fail('actual projection did not settle');}
function errorFacts(error:unknown):unknown{return error instanceof Error?{name:error.name,message:error.message,stack:error.stack,...(error instanceof AggregateError?{errors:error.errors.map(errorFacts)}:{})}:String(error);}
async function publicStorePath(){const manifest=object(JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8'))),file=text(object(manifest['src/feedback-recovery.ts']).file),inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));assert.match(file,/^assets\/[A-Za-z0-9_-]+\.js$/u);assert.ok(Array.isArray(inventory)&&inventory.includes(file));return '/workbench/app/'+file;}

test('a real follow-up maintenance POST403 confirms current Ticket READ before scoped recovery cleanup, without a Ticket-wide revoked broadcast',{timeout:240000},async()=>{
 await withT37Fixture(async fixture=>{
  const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,schedulePath=path+'/follow-up-schedule';
  const queued=await current(dispatcher,path),assigned=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));await drain(fixture);
  const initial=await current(handler,path);assert.equal(initial.assignee_id,fixture.handler);assert.deepEqual((await current(handler,schedulePath)).allowed_actions,['SET']);
  const cookie=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_REAL_HANDLER_COOKIE_REQUIRED');
  const scope={principal:fixture.handler,kind:'ticket',id:ticketId,purpose:'shared-follow-up-schedule'},directory=join(tmpdir(),'t37-post-refusal-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('草稿仅在当前浏览器')&&Boolean(document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}))`);
   const modulePath=await publicStorePath();
   // Observe the production store's actual synchronous invalidations. No synthetic invalidation is sent.
   await browser.evaluate(`(async()=>{globalThis.__t37RefusalStore=await import(${JSON.stringify(modulePath)});globalThis.__t37RefusalEvents=[];globalThis.__t37RefusalUnsubscribe=globalThis.__t37RefusalStore.subscribeDrafts(event=>globalThis.__t37RefusalEvents.push(event));})()`);
   // This gate runs after draft.prepare has completed and before the first real POST reaches fetch.
   await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t37RefusalReads=[];globalThis.__t37RefusalPost=null;globalThis.__t37RefusalHeld=false;globalThis.__t37CancelPost=()=>{};globalThis.__t37RestoreFetch=()=>{globalThis.fetch=original;};
    globalThis.fetch=async(input,options)=>{const target=new URL(input instanceof Request?input.url:String(input),location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
     if(method==='POST'&&target===${JSON.stringify(schedulePath)}){const command=JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}'));globalThis.__t37RefusalPost={command,status:null,body:null};globalThis.__t37RefusalHeld=true;const signal=options?.signal??(input instanceof Request?input.signal:null);
      await new Promise((resolve,reject)=>{let finished=false;const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',aborted);globalThis.__t37RefusalHeld=false;error?reject(error):resolve();},aborted=()=>finish(new DOMException('Consumer aborted unsent POST','AbortError')),timer=setTimeout(()=>finish(Error('T37_PREPOST_GATE_TIMEOUT')),45_000);globalThis.__t37ReleasePost=()=>finish();globalThis.__t37CancelPost=aborted;signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});
     }
     const response=await original(input,options);
     if(method==='POST'&&target===${JSON.stringify(schedulePath)}){globalThis.__t37RefusalPost.status=response.status;globalThis.__t37RefusalPost.body=await response.clone().json();}
     if(method==='GET'&&target===${JSON.stringify(path)})globalThis.__t37RefusalReads.push({status:response.status,afterPost403:globalThis.__t37RefusalPost?.status===403,body:await response.clone().json()});
     return response;};})()`);
   await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(region+' input[name="due_at"]')});if(!(input instanceof HTMLInputElement)||input.disabled)throw Error('T37_REAL_INPUT_REQUIRED');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_REAL_INPUT_SETTER_REQUIRED');setter.call(input,${JSON.stringify(due)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   const setButton=`[...(document.querySelector(${JSON.stringify(region)})?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()==='设置共享时间')`;
   await browser.waitFor(`Boolean(${setButton})&&!(${setButton}).disabled`);await browser.evaluate(`(${setButton}).click()`);await browser.waitFor('globalThis.__t37RefusalHeld===true');
   const prepared=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));
   const pending=object(await browser.evaluate('globalThis.__t37RefusalPost'));assert.equal(pending.status,null);assert.ok(prepared.revision);assert.equal(prepared.commandId,object(pending.command).client_command_id);
   assert.equal((await current(handler,schedulePath)).active,null,'the held browser command has not reached the server');
   const now=await current(dispatcher,path),transfer=await dispatcher.post(path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(now.version),reason_code:'WORKBENCH_TRANSFER',target_principal_id:fixture.otherHandler,resolver_team_id:text(now.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(transfer.status,200,JSON.stringify(transfer.value));
   const retained=await current(handler,path);assert.equal(retained.assignee_id,fixture.otherHandler);assert.deepEqual((await current(handler,schedulePath)).allowed_actions,[]);
   // The same handler still has team READ. Do not claim its old assignee-only add-note write capability survives.
   assert.ok(!rows((await current(handler,path+'/related-conversations?limit=20')).items).some(row=>row.conversation_principal_id===fixture.handler&&row.assignment_status==='ASSIGNED'));
   await browser.evaluate('globalThis.__t37ReleasePost()');await browser.waitFor('globalThis.__t37RefusalPost.status===403');
   await browser.waitFor(`globalThis.__t37RefusalEvents.some(event=>event.principal===${JSON.stringify(fixture.handler)}&&event.id===${JSON.stringify(ticketId)}&&['settled','revoked'].includes(event.reason))`);
   const events=rows(await browser.evaluate('globalThis.__t37RefusalEvents'));
   assert.equal(events.some(event=>event.reason==='revoked'&&event.principal===fixture.handler&&(event.id===undefined||event.id===ticketId)),false,'T37_MAINTENANCE_403_MUST_NOT_REVOKE_TICKET_READ_OR_OTHER_PURPOSES');
   assert.ok(events.some(event=>event.reason==='settled'&&event.purpose==='shared-follow-up-schedule'&&event.id===ticketId));
   await browser.waitFor('globalThis.__t37RefusalReads.some(read=>read.afterPost403&&read.status===200)');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open] #detail-title"))'),true);
   const post=object(await browser.evaluate('globalThis.__t37RefusalPost'));assert.equal(post.status,403);assert.match(text(object(object(post.body).error).code),/FORBIDDEN/u);
   const settled=object(await browser.evaluate(`(async()=>{const copy=await globalThis.__t37RefusalStore.openDraft(${JSON.stringify(scope)},{restore:false});return {revision:copy.handle.record?.revision??null,commandId:copy.handle.operation?.commandId??null};})()`));assert.deepEqual(settled,{revision:null,commandId:null});
   const receipt=await current(handler,schedulePath+'/commands/'+text(prepared.commandId));assert.equal(receipt.state,'FAILED');assert.deepEqual(await current(handler,path),retained);assert.equal((await current(handler,schedulePath)).active,null);
   await writeFile(join(directory,'refusal-facts.json'),JSON.stringify({prepared,post,events,reads:await browser.evaluate('globalThis.__t37RefusalReads'),settled,receipt},null,2));
   const pixels=Buffer.from(await browser.screenshot(),'base64'),shots=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(shots);const file=join(shots,'new-detail-1920.png');await writeFile(file,pixels);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T37_STALE_MAINTENANCE_POST403_CURRENT_READ_RETAINED',evidence_directory:directory,screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
  }catch(error){primary=error;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(error),null,2));if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`({text:document.querySelector(${JSON.stringify(region)})?.innerText??'',post:globalThis.__t37RefusalPost,reads:globalThis.__t37RefusalReads,events:globalThis.__t37RefusalEvents})`)));}}catch(evidenceError){primary=new AggregateError([error,evidenceError],'T37_POST_REFUSAL_EVIDENCE');}console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory}));}
  await closeBrowserTestResources([async()=>{if(browser)await browser.evaluate('globalThis.__t37CancelPost?.();globalThis.__t37RestoreFetch?.();globalThis.__t37RefusalUnsubscribe?.();');},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);
 },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true});
});
