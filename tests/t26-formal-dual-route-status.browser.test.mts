import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {withT26Fixture,t26Group,t26Deliveries,t26Sender,t26Object} from './helpers/t26-group-notification-fixture.mjs';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const region='[role="region"][aria-label="报修人通知送达"]';
const instrument=`(()=>{const original=globalThis.fetch;globalThis.__t26Reads=[];globalThis.__t26Writes=[];globalThis.__t26Boot=[];globalThis.fetch=async(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();if(method!=='GET')globalThis.__t26Writes.push({path,method});const response=await original(input,options);if(method==='GET'&&path.endsWith('/deliveries'))globalThis.__t26Reads.push({path,status:response.status,body:await response.clone().json()});if(method==='GET'&&path==='/api/lifecycle/bootstrap')globalThis.__t26Boot.push({status:response.status,body:await response.clone().json()});return response;};})()`;
async function load(browser:Browser){await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'&&Boolean(document.querySelector('#detail-title'))`);}
async function screenshot(browser:Browser,directory:string,name:string){const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name+'.png');await writeFile(file,bytes);return {file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};}
const refresh=`(()=>{const r=document.querySelector(${JSON.stringify(region)}),b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新读取通知');if(!b)throw Error('T26_REAL_REQUERY_REQUIRED');b.click();})()`;

test('the actual formal bundle displays both independent routes and explicit UNKNOWN, evicts lost read authority and hides disabled round capability',{timeout:240000},async()=>{
 const directory=join(tmpdir(),'t26-formal-pc-'+randomUUID());await mkdir(directory);
 await withT26Fixture(async context=>{
  const tag='t26-pc',{id,http,started}=await t26Group(context,tag),initial=await t26Deliveries(http,id),group=initial.find(r=>r.destination_type==='GROUP'),person=initial.find(r=>r.destination_type==='PERSON');assert.ok(group&&person);
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:t26Sender(context,tag,{fetchImpl:async()=>new Response('{"errcode":45009}')})});await worker.deliver({deliveryId:String(group.delivery_id)});await worker.deliver({deliveryId:String(person.delivery_id)});
  assert.equal((await http.post(id,'complete',http.command(started))).status,200);await context.runtime.roundNotifications.runOnce();const actual=await t26Deliveries(http,id);assert.equal(actual.length,4);
  const cookie=context.browserCookies[2];assert.ok(cookie&&typeof cookie.url==='string');let browser:Browser|undefined,error:unknown;
  try{
   browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);await load(browser);await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.querySelectorAll('li').length===4`);
   const visible=await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).innerText`);assert.equal(typeof visible,'string');for(const label of ['首次责任','工作人员完工','处理轮次 1','原报修人单聊','群聊','待核对','已发送','待发送'])assert.ok(String(visible).includes(label));for(const marker of ['INTERNAL_T11_CANARY','T26_PRIVATE','user-test','bot-test'])assert.equal(String(visible).includes(marker),false);
   const read=t26Object(await browser.evaluate('globalThis.__t26Reads.at(-1)'));assert.equal(read.path,'/api/tickets/'+id+'/deliveries');assert.equal(read.status,200);assert.deepEqual(t26Object(read.body).items,actual);assert.equal(t26Object(t26Object(await browser.evaluate('globalThis.__t26Boot.at(-1)')).body).ticket_round_notifications_enabled,true);
   const resources=await browser.evaluate(`performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.includes('/workbench/app/assets/')&&n.endsWith('.js'))`);assert.ok(Array.isArray(resources)&&resources.length>0,'served formal compiled JavaScript must be observed');const positive=await screenshot(browser,directory,'dual-routes-unknown');
   const count=await browser.evaluate('globalThis.__t26Reads.length');assert.equal(typeof count,'number');await browser.evaluate(refresh);await browser.waitFor(`globalThis.__t26Reads.length>${count}`);assert.deepEqual(t26Object(t26Object(await browser.evaluate('globalThis.__t26Reads.at(-1)')).body).items,actual);
   const reader=context.principals[1]?.id;assert.ok(reader);const principal=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[reader])).rows[0];assert.ok(principal);await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:[]});
   const beforeDenied=await browser.evaluate('globalThis.__t26Reads.length');await browser.evaluate(refresh);await browser.waitFor(`globalThis.__t26Reads.length>${beforeDenied}&&[401,403,404].includes(globalThis.__t26Reads.at(-1).status)`);await browser.waitFor(`!document.querySelector(${JSON.stringify(region)})?.querySelector('li')`);const denied=await screenshot(browser,directory,'current-authority-denied');assert.deepEqual(await browser.evaluate('globalThis.__t26Writes'),[]);assert.deepEqual(await t26Deliveries(http,id),actual);assert.equal((await http.detail(id)).status,'CLOSED');
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T26_FORMAL_DUAL_ROUTES_UNKNOWN_CURRENT_AUTH',formal_assets:resources,screenshots:[positive,denied]}));
  }catch(failure){error=failure;try{if(browser){await screenshot(browser,directory,'failure');await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,reads:globalThis.__t26Reads,writes:globalThis.__t26Writes})')));}}catch(evidenceError){error=new AggregateError([failure,evidenceError],'T26_BROWSER_FAILURE_EVIDENCE');}console.log('T26_BROWSER_FAILURE '+JSON.stringify({directory}));}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
 });
 // A fresh sequential real group source with the existing capability explicitly off.
 await withT24Fixture(async context=>{
  const intake=await seedPersistedIntake({pool:context.pool,text:'T26_OFF_GROUP_SOURCE',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag:'t26-pc-off'}),ticket=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t26-off'});assert.ok(ticket.ticket);const http=await t11Http(context);await http.start(ticket.ticket.id);const cookie=context.browserCookies[2];assert.ok(cookie&&typeof cookie.url==='string');let browser:Browser|undefined,error:unknown;
  try{browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticket.ticket.id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);await load(browser);await browser.waitFor('globalThis.__t26Boot.length>0');assert.equal(t26Object(t26Object(await browser.evaluate('globalThis.__t26Boot.at(-1)')).body).ticket_round_notifications_enabled,false);assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(region)}))`),false);assert.deepEqual(await browser.evaluate('globalThis.__t26Reads'),[]);assert.deepEqual(await browser.evaluate('globalThis.__t26Writes'),[]);console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T26_FORMAL_GROUP_CAPABILITY_OFF',screenshots:[await screenshot(browser,directory,'capability-off')]}));}
  catch(failure){error=failure;try{if(browser)await screenshot(browser,directory,'disabled-failure');}catch(evidenceError){error=new AggregateError([failure,evidenceError],'T26_DISABLED_BROWSER_EVIDENCE');}console.log('T26_BROWSER_FAILURE '+JSON.stringify({directory}));}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
 },{manualRoundConsumption:true,roundNotificationsOff:true});
});
