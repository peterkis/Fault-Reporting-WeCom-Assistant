import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const region='[role="region"][aria-label="报修人通知送达"]';
const instrument=`(()=>{const original=fetch;globalThis.__t25Reads=[];globalThis.__t25Writes=[];globalThis.fetch=async(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();if(method!=='GET')globalThis.__t25Writes.push({path,method});const response=await original(input,options);if(method==='GET'&&path.endsWith('/deliveries'))globalThis.__t25Reads.push({path,status:response.status,body:await response.clone().json()});return response;};})()`;
const rendered=`(()=>{const r=document.querySelector(${JSON.stringify(region)});return r?.innerText.includes('首次责任')&&r.innerText.includes('工作人员完工')&&r.innerText.includes('医小修应用')&&(r.innerText.match(/待发送/g)??[]).length===2;})()`;
const requery=`(()=>{const r=document.querySelector(${JSON.stringify(region)}),b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新读取通知');if(!b)throw Error('T25_REAL_REQUERY_REQUIRED');b.click();})()`;
async function screenshot(browser:Browser,directory:string,name:string){const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name+'.png');await writeFile(file,pixels);return {file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};}

test('the formal compiled PC presents actual original App round deliveries and clears their display on current Ticket loss',{timeout:240000},async()=>{
 const directory=join(tmpdir(),'t25-formal-app-'+randomUUID());await mkdir(directory);
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context),reader=await t11Http(context,2);await source.round.runOnce();assert.equal((await source.http.post(source.ticketId,'complete',source.http.command(source.started))).status,200);await source.round.runOnce();const completed=await source.http.detail(source.ticketId),actual=await t25Deliveries(reader,source.ticketId);
  assert.deepEqual(actual.map(row=>({route:row.route_kind,node:row.node,status:row.status,type:row.destination_type,cycle:row.cycle_no})).sort((a,b)=>String(a.node).localeCompare(String(b.node))),[
   {route:'YIXIAOXIU_APP',node:'FIRST_RESPONSIBILITY',status:'PENDING',type:'PERSON',cycle:1},{route:'YIXIAOXIU_APP',node:'STAFF_COMPLETED',status:'PENDING',type:'PERSON',cycle:1}]);
  const cookie=context.browserCookies[2];assert.ok(cookie);assert.ok(typeof cookie.url==='string');let browser:Browser|undefined,error:unknown;
  try{
   browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+source.ticketId,width:1440,height:1000,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'&&Boolean(document.querySelector('#detail-title'))`);
   await browser.waitFor("globalThis.__t25Reads.some(x=>x.status===200)");console.log('T25_FORMAL_TRACE AUTHORIZED_REAL_DELIVERIES_200');await browser.waitFor(rendered);
   const visible=await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).innerText`) as string;assert.equal(visible.includes('原报修人单聊'),false);assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).querySelectorAll('li').length`),2);
   for(const privateValue of [source.memberId,source.scope.scopeHash,source.authority.channelAccountId,source.authority.mappingProofRef,'INTERNAL_T11_CANARY'])assert.equal(visible.includes(privateValue),false);
   const reads=await browser.evaluate('globalThis.__t25Reads') as {path:string;status:number;body:{items:Record<string,unknown>[]}}[];assert.deepEqual(reads.at(-1)?.body.items,actual);await browser.evaluate(requery);await browser.waitFor(`globalThis.__t25Reads.length>${reads.length}`);await browser.waitFor(rendered);await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).scrollIntoView({block:'center'})`);const positive=await screenshot(browser,directory,'application-rounds');
   const readerId=context.principals[1]?.id;assert.ok(readerId);const principal=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[readerId])).rows[0];assert.ok(principal);await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:[]});
   const count=await browser.evaluate('globalThis.__t25Reads.length') as number;await browser.evaluate(requery);await browser.waitFor(`globalThis.__t25Reads.length>${count}&&[401,403,404].includes(globalThis.__t25Reads.at(-1).status)`);await browser.waitFor(`!document.querySelector(${JSON.stringify(region)})?.querySelector('li')`);const negative=await screenshot(browser,directory,'current-ticket-denied');
   assert.deepEqual(await browser.evaluate('globalThis.__t25Writes'),[]);assert.deepEqual(await source.http.detail(source.ticketId),completed);console.log('T25_BROWSER_SUCCESS '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T25_FORMAL_APP_ROUTE_CURRENT_LOSS',screenshots:[positive,negative]}));
  }catch(failure){error=failure;try{if(browser){await screenshot(browser,directory,'failure');await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,reads:globalThis.__t25Reads,writes:globalThis.__t25Writes})')));}}catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T25_FORMAL_FAILURE_EVIDENCE');}console.log('T25_BROWSER_FAILURE '+JSON.stringify({directory}));}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
 },{manualRoundConsumption:true});
});
