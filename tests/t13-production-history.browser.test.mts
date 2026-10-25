import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Server,IncomingMessage,ServerResponse} from 'node:http';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {acceptedSetup,acceptedOptions,http,rows,text,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
interface Fixture extends T07Fixture {browserCookies:{name:string;value:string;url:string}[];runtime:T07Fixture['runtime']&{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>}}}

test('formal production detail reads the recorded first and coupled transfer through one independent safe history section without a business POST',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const s=await acceptedSetup(f);
  const actor=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['ADMIN'],resolverTeamIds:['PILOT_IT','T07_NETWORK']});assert.equal(actor.id,s.actor.id);
  const colleague=await http(f,2),related=await colleague.get(s.path+'/related-conversations'),selected=rows(related.value.items)[0];assert.ok(selected);
  const transferred=await colleague.post(s.path+'/takeover-and-start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T13_BROWSER_CHAIN',resolver_team_id:'T07_NETWORK',communication_choice:'TAKE_SELECTED',sessions:[{session_id:text(selected.session_id),expected_row_version:Number(text(selected.session_row_version))}]});assert.equal(transferred.status,200);
  const expected=await s.a.get(s.path+'/assignment-history');assert.equal(expected.status,200);assert.equal(rows(expected.value.items).length,2);
  const cookie=f.browserCookies[0];assert.ok(cookie);
  const requests:{method:string;path:string;status:number|null}[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{const path=new URL(request.url??'/',f.origin).pathname;if(!path.startsWith('/api/'))return;const fact={method:request.method??'',path,status:null as number|null};requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});};
  f.runtime.server.on('request',observe);
  const directory=join(tmpdir(),'ss010-ui-'+randomUUID()),diagnosticDirectory=join(tmpdir(),'t13-diag-'+randomUUID());await mkdir(directory);await mkdir(diagnosticDirectory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,primary:unknown;
  const capture=async(_label:string)=>{assert.ok(browser);const bytes=Buffer.from(text(await browser.screenshot()),'base64'),file=join(directory,randomUUID()+'.png');await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+s.first.ticket.id,width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
   assert.equal(await browser.evaluate("Boolean(document.querySelector('[aria-label=\"接单与交接链\"]'))"),true,'the actual production bundle must mount the safe history consumer');
   await browser.waitFor("document.querySelectorAll('[data-assignment-history-row]').length===2");
   const displayed=text(await browser.evaluate("document.querySelector('[aria-label=\"接单与交接链\"]').innerText"));
   assert.ok(displayed.includes('林舟')&&displayed.includes('陈悦')&&displayed.includes('Pilot 信息保障组')&&displayed.includes('合成网络处理组'));
   assert.ok(displayed.includes('首次接单')&&displayed.includes('责任变化')&&displayed.includes('处理轮次 1')&&displayed.includes('沟通交接'));
   assert.ok(displayed.includes('已加载 2 条责任记录'));
   assert.ok(!displayed.includes('web01-synthetic')&&!displayed.includes('仅供内部的合成处理记录'));
   assert.ok(requests.some(row=>row.method==='GET'&&row.path===s.path+'/assignment-history'&&row.status===200));assert.equal(requests.filter(row=>row.method==='POST').length,0);
   await capture('recorded-chain-1280.png');
   await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));await capture('recorded-chain-390.png');
  }catch(error){primary=error;}
  await closeBrowserTestResources([async()=>{if(primary&&browser){await capture('failure.png');await writeFile(join(diagnosticDirectory,'failure.json'),JSON.stringify({requests,page:await browser.evaluate('({text:document.body.innerText,path:location.pathname})')}));}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{f.runtime.server.removeListener('request',observe);assert.equal((await f.runtime.observability.metrics()).sse_clients,0);},async()=>{const receipt=join(diagnosticDirectory,'receipt.json');await writeFile(receipt,JSON.stringify({formal_production_bundle:true,real_http_pg:true,requests,screenshots,primary:primary instanceof Error?primary.message:null}));console.log('SS010_BROWSER '+JSON.stringify({task:'WBINT-T13',file:receipt.replaceAll('\\','/'),screenshots}));}],primary);
 },{...acceptedOptions,workbenchAssignmentHistoryEnabled:true});
});