import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {withT37Fixture,object,text} from './helpers/t37-follow-up-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const region='[role="region"][aria-label="共享下次跟进时间"]',due='2030-01-02 09:30:00';
async function recoveryPath(){const manifest=object(JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')));return '/workbench/app/'+text(object(manifest['src/feedback-recovery.ts']).file);}

for(const lost of [false,true])test('ALL43 shared SET conflict preserves input after '+(lost?'FAILED acknowledgement':'real POST409'),{timeout:180000},async()=>{
 await withT37Fixture(async f=>{
  const http=await f.http(0),id=await f.createTicket(),path='/api/tickets/'+id,schedule=path+'/follow-up-schedule',current=await http.get(path);assert.equal(current.status,200);
  const assigned=await http.post(path+'/assign',{client_command_id:randomUUID(),expected_version:current.value.version,reason_code:'WORKBENCH_ASSIGN',target_principal_id:f.handler,resolver_team_id:current.value.resolver_team_id,communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));
  const cookie=f.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie&&typeof cookie.url==='string');let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('草稿仅在当前浏览器')`);
   await browser.evaluate(`(()=>{const send=fetch;globalThis.__all43Writes=[];globalThis.__all43Held=false;globalThis.fetch=async(input,options)=>{const target=new URL(input instanceof Request?input.url:String(input),location.href).pathname;if(options?.method==='POST'&&target===${JSON.stringify(schedule)}){const command=JSON.parse(options.body);globalThis.__all43Held=true;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('ALL43_OWN_PREPOST_TIMEOUT')),30000);globalThis.__all43Release=()=>{clearTimeout(timer);resolve();};});const response=await send(input,options);globalThis.__all43Writes.push({command,status:response.status,body:await response.clone().json()});if(${lost})throw new TypeError('ALL43_CONTROLLED_REFUSAL_RESPONSE_LOSS');return response;}return send(input,options);};})()`);
   await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(region+' input[name="due_at"]')});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(due)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   const button=`[...document.querySelector(${JSON.stringify(region)}).querySelectorAll('button')].find(b=>b.textContent.trim()==='设置共享时间')`;
   await browser.waitFor(`Boolean(${button})&&!(${button}).disabled`);await browser.evaluate(`(${button}).click()`);await browser.waitFor('globalThis.__all43Held');
   const before=await http.get(schedule);assert.equal(before.status,200);const changed=await http.post(schedule,{client_command_id:randomUUID(),expected_version:before.value.ticket_version,expected_schedule_version:before.value.schedule_version,reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2030-01-03 10:00:00'});assert.equal(changed.status,200,JSON.stringify(changed.value));const afterOther=(await http.get(schedule)).value;
   await browser.evaluate('globalThis.__all43Release()');await browser.waitFor('globalThis.__all43Writes.length===1&&globalThis.__all43Writes[0].status===409');
   if(lost){
    const check=`[...document.querySelector(${JSON.stringify(region)}).querySelectorAll('button')].find(b=>b.textContent.includes('只读核对原操作'))`;
    await browser.waitFor(`Boolean(${check})&&!(${check}).disabled`);await browser.evaluate(`(${check}).click()`);
    await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('已核对原操作被拒绝')`);
   }else await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('安排或工单已变化')`);
   assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(region+' input[name="due_at"]')})?.value`),due,'a known refusal cannot erase the original user time');
   const scope={principal:f.handler,kind:'ticket',id,purpose:'shared-follow-up-schedule'},module=await recoveryPath();
   await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('已保存恢复副本')`);
   const copy=object(await browser.evaluate(`(async()=>{const store=await import(${JSON.stringify(module)}),saved=await store.openDraft(${JSON.stringify(scope)});return {text:saved.text,commandId:saved.handle.operation?.commandId??null};})()`));assert.equal(object(JSON.parse(text(copy.text))).value,due);assert.equal(copy.commandId,null,'the failed UUID has been explicitly settled, not replayed');
   const writes=await browser.evaluate('globalThis.__all43Writes');assert.ok(Array.isArray(writes)&&writes.length===1);const original=object(object(writes[0]).command);assert.equal(original.expected_version,before.value.ticket_version);assert.equal(original.expected_schedule_version,before.value.schedule_version);assert.equal(original.due_at,due);
   const submittingActor=await f.http(1);assert.equal((await submittingActor.get(schedule+'/commands/'+text(original.client_command_id))).value.state,'FAILED');assert.deepEqual((await http.get(schedule)).value,afterOther,'the refused old command cannot alter the other actor arrangement');
   console.log('ALL43_FOLLOW_UP_REJECTION '+JSON.stringify({lost_response:lost,post:409,original_command:original,input_preserved:true,encrypted_copy:true,no_automatic_resubmit:true}));
  }catch(error){primary=error;}
  await closeBrowserTestResources([async()=>{if(browser)try{await browser.evaluate('globalThis.__all43Release?.()');}catch{/* closing remains mandatory after a diagnostic channel failure */}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);
 },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true});
});
