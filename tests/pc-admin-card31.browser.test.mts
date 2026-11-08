import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import type {WorkbenchOnlineView} from '../contracts/workbench_activity_contracts.js';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{server:import('node:http').Server}}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** A colleague's open workbench page: one real SSE stream (O1), plus optional presence leases. */
function colleague(origin:string,cookie:string){
 let stream:AbortController|null=null,csrf='';const browsers=new Map<string,string>(),held=new Map<string,'VIEWING'|'EDITING'>();
 const ready=async()=>{if(!csrf)csrf=String(object(await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}})).json()).csrf_token);};
 const renew=async(id:string,mode:'VIEWING'|'EDITING')=>{await ready();let browser=browsers.get(id);if(!browser){browser=randomUUID();browsers.set(id,browser);}
  const response=await fetch(origin+'/api/workbench/activity',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({schema_version:1,browser_id:browser,action:'RENEW',target:{kind:'ticket',id},visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null})});assert.equal(response.status,200,await response.text());};
 const timer=setInterval(()=>{for(const [id,mode] of held)void renew(id,mode).catch(()=>{});},4000);
 return {
  async connect(){const controller=new AbortController();stream=controller;const response=await fetch(origin+'/api/realtime/events?scope=workbench',{headers:{cookie,accept:'text/event-stream'},signal:controller.signal});assert.equal(response.status,200);const reader=response.body?.getReader();void (async()=>{try{while(reader&&!(await reader.read()).done){/* keep the stream open */}}catch{/* closed */}})();},
  disconnect(){stream?.abort();stream=null;},
  async hold(id:string,mode:'VIEWING'|'EDITING'){held.set(id,mode);await renew(id,mode);},
  stop(){clearInterval(timer);stream?.abort();},
 };
}

test('Card 31 sidebar online colleagues: SSE-based online set, status priority, grace, popover, collapsed state and F4 measurements',{timeout:420000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=process.env.CARD31_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card31-'));await mkdir(directory,{recursive:true});
 const [own,chenCookie,zhouCookie,shenCookie]=f.cookies;assert.ok(own&&chenCookie&&zhouCookie&&shenCookie);
 const chen=colleague(f.origin,chenCookie),zhou=colleague(f.origin,zhouCookie),shen=colleague(f.origin,shenCookie);
 const editTarget=f.tickets[5]?.ticket.id,viewTarget=f.tickets[0]?.ticket.id;assert.ok(editTarget&&viewTarget);
 const requests:{path:string;at:number}[]=[],metrics:Record<string,unknown>={},screenshots:unknown[]=[];
 const observe=(request:import('node:http').IncomingMessage)=>{const path=request.url??'';if(path==='/api/workbench/online'||path==='/api/workbench/activity/batch-view')requests.push({path,at:Date.now()});};f.runtime.server.on('request',observe);
 const onlineNow=async()=>(await (await fetch(f.origin+'/api/workbench/online',{headers:{cookie:own}})).json()) as WorkbenchOnlineView;
 let browser:Browser|undefined,failure:unknown;
 try{
  const actor=f.browserCookies[0];assert.ok(actor);
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[actor]});assert.ok(browser);const b=browser;
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{window.__hints=0;const E=window.EventSource;window.EventSource=function(...a){const es=new E(...a);es.addEventListener('workbench.activity.changed',()=>{window.__hints++;});return es;};window.EventSource.prototype=E.prototype;Object.assign(window.EventSource,{CONNECTING:0,OPEN:1,CLOSED:2});})()"});
  await b.command('Page.reload');
  const live="document.querySelector('[data-realtime-status=live]')!==null";
  const capture=async(name:string)=>{await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name+'.png'),bytes);screenshots.push({file:name+'.png',sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});};
  // Nobody else online: 「在线同事 暂无」, not clickable; the requester is never listed.
  await b.waitFor(live+"&&document.querySelector('[data-online-colleagues] .ds-online-none')?.textContent==='暂无'");
  assert.equal(await b.evaluate("document.querySelector('[data-online-colleagues] button')"),null);assert.deepEqual(await onlineNow(),{schema_version:1,people:[],total:0});
  await capture('sidebar-empty');
  // Three colleagues open the workbench; one edits and one views: editing → viewing → online, by name.
  await chen.connect();await zhou.connect();await shen.connect();
  await chen.hold(editTarget,'EDITING');await zhou.hold(viewTarget,'VIEWING');
  await b.waitFor("document.querySelector('[data-online-colleagues] .ds-online-count')?.textContent==='3'");
  metrics.row=object(await b.evaluate("(()=>{const r=document.querySelector('[data-online-colleagues] button'),s=r.querySelector('.ds-presence-stack');return {label:r.getAttribute('aria-label'),avatars:s.querySelectorAll('.ds-presence-stack-person').length,dots:s.querySelectorAll('.ds-presence-stack-dot').length,avatar:s.querySelector('.ds-avatar').getBoundingClientRect().width,overlap:Math.round(s.children[0].getBoundingClientRect().right-s.children[1].getBoundingClientRect().left),dot:s.querySelector('.ds-presence-stack-dot').getBoundingClientRect().width,font:getComputedStyle(r.querySelector('.ds-online-title')).fontSize,aboveAccount:r.closest('.sidebar-bottom')!==null&&r.closest('[data-online-colleagues]').nextElementSibling!==null};})()"));
  assert.deepEqual(metrics.row,{label:'在线同事 3 人',avatars:3,dots:3,avatar:20,overlap:5,dot:7,font:'12px',aboveAccount:true});
  assert.deepEqual((await onlineNow()).people,[{display_name:'陈悦',status:'EDITING'},{display_name:'周宁',status:'VIEWING'},{display_name:'沈然',status:'ONLINE'}]);
  await capture('sidebar-online');
  // Popover: opens with Enter, lists status colours, Esc closes and returns focus.
  await b.evaluate("document.querySelector('[data-online-colleagues] button').focus()");
  for(const type of ['keyDown','keyUp'] as const)await b.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',...(type==='keyDown'?{text:'\r'}:{})});
  await b.waitFor("document.querySelector('.ds-online-panel')!==null");
  metrics.panel=object(await b.evaluate("(()=>{const p=document.querySelector('.ds-online-panel'),s=getComputedStyle(p);return {width:p.getBoundingClientRect().width,radius:s.borderRadius,padding:s.paddingTop,title:p.querySelector('.ds-online-panel-title').textContent,rows:[...p.querySelectorAll('.ds-online-person')].map(n=>({name:n.querySelector('.ds-online-name').textContent,status:n.querySelector('.ds-online-status').textContent,height:n.getBoundingClientRect().height})),note:p.querySelector('.ds-online-note').textContent,above:p.getBoundingClientRect().bottom<=document.querySelector('[data-online-colleagues] button').getBoundingClientRect().top};})()"));
  assert.deepEqual(metrics.panel,{width:260,radius:'10px',padding:'6px',title:'在线同事 · 3',rows:[{name:'陈悦',status:'正在编辑',height:36},{name:'周宁',status:'正在查看工单',height:36},{name:'沈然',status:'在线',height:36}],note:'只显示同团队、当前打开工作台的同事',above:true});
  assert.ok(!(await b.evaluate("document.querySelector('.ds-online-panel').textContent")as string).includes('IT-'),'never names a ticket');
  await capture('sidebar-popover');
  for(const type of ['keyDown','keyUp'] as const)await b.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape'});
  await b.waitFor("document.querySelector('.ds-online-panel')===null&&document.activeElement===document.querySelector('[data-online-colleagues] button')");
  // S4: a reload (stream closed and reopened within 3 s) keeps the online set and sends no hint.
  await delay(2500);const hintsBefore=Number(await b.evaluate('window.__hints'));
  shen.disconnect();await delay(1500);assert.equal((await onlineNow()).total,3,'within the grace period');await shen.connect();await delay(2500);
  metrics.reload={total:(await onlineNow()).total,hints:Number(await b.evaluate('window.__hints'))-hintsBefore};
  assert.deepEqual(metrics.reload,{total:3,hints:0});
  // F4 render: an online-count change renders no board card.
  await b.evaluate(`window.__touched=new Set();window.__cardObserver=new MutationObserver(list=>{for(const m of list){const n=m.target.nodeType===1?m.target:m.target.parentElement;const c=n&&n.closest?n.closest('.ticket-card'):null;if(c)window.__touched.add(c.dataset.itemId);}});window.__cardObserver.observe(document.querySelector('.board'),{subtree:true,childList:true,attributes:true,characterData:true});0`);
  // S4: closing every stream removes the account only after 15 s, judged on read.
  const leftAt=Date.now();shen.disconnect();
  await delay(10000);assert.equal((await onlineNow()).total,3,'still online at 10 s');
  await delay(Math.max(0,16000-(Date.now()-leftAt)));const after=await onlineNow();assert.equal(after.total,2,'gone after 15 s');
  metrics.grace={presentAt10s:true,goneAt16s:after.total===2};
  await b.waitFor("document.querySelector('[data-online-colleagues] .ds-online-count')?.textContent==='2'");
  await b.evaluate('window.__cardObserver.disconnect()');metrics.renderOnOnlineChange=await b.evaluate('[...window.__touched]');
  assert.deepEqual(metrics.renderOnOnlineChange,[],'online changes never re-render board cards');
  // F4 network: 30 hints within 60 s → online reads ≤ 30, each sent with a batch read.
  const from=requests.length;
  for(let index=0;index<30;index++){await chen.hold(editTarget,index%2?'EDITING':'VIEWING');await delay(1000);await shen.connect();await delay(500);shen.disconnect();await delay(500);}
  await delay(2500);
  const burst=requests.slice(from),online=burst.filter(row=>row.path==='/api/workbench/online'),batch=burst.filter(row=>row.path==='/api/workbench/activity/batch-view');
  metrics.network={seconds:60,onlineReads:online.length,batchReads:batch.length,unpaired:online.filter(row=>!batch.some(other=>Math.abs(other.at-row.at)<100)).length};
  assert.ok(online.length>0&&online.length<=30,JSON.stringify(metrics.network));assert.equal(object(metrics.network).unpaired,0,'every online read leaves with a batch read');
  // Collapsed sidebar: icon + count badge with a title.
  await clickWorkbenchControl(b,'button[aria-label="收起侧栏"]');
  await b.waitFor("document.querySelector('.ds-online-collapsed')!==null");
  metrics.collapsed=object(await b.evaluate("(()=>{const c=document.querySelector('.ds-online-collapsed');return {title:c.getAttribute('title'),badge:c.querySelector('.ds-online-badge')?.textContent,font:getComputedStyle(c.querySelector('.ds-online-badge')).fontSize};})()"));
  assert.equal(object(metrics.collapsed).font,'11px');assert.match(String(object(metrics.collapsed).title),/^在线同事 \d+ 人$/u);
  await capture('sidebar-collapsed');
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_WITH_REAL_SSE_STREAMS',platform:process.platform,metrics,screenshots},null,2)),()=>{for(const one of [chen,zhou,shen])one.stop();f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,workbenchInternalNotesEnabled:true,presencePeerSessions:true}));
