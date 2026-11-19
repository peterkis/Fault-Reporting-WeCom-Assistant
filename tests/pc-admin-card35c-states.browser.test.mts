import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {start} from './helpers/t43-service-actions.mjs';
import {withT43Fixture} from './helpers/t43-full-service-fixture.mjs';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT22Fixture,appendT22LiveItem} from './helpers/wbint-t22-fixture.mjs';
import {conversationPost,freshCommand} from './helpers/conversation-inbox-fixture.mjs';
import type {ConversationChatEntry} from '../contracts/workbench_conversation_inbox_contracts.js';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import type {Browser} from './helpers/t43-service-actions.mjs';

// GET only, cached from this fixture's real HTTP/PG reads. No command is intercepted.
const controlled=String.raw`(()=>{
 const real=fetch,cfg=JSON.parse(sessionStorage.getItem('card35c-config')||'null');
 globalThis.__card35c={token:cfg?.token??null,reads:[],posts:[],released:false,visibleAt:null,hiddenAt:null};
 if(cfg?.label)new MutationObserver(()=>{
  const shown=[...document.querySelectorAll('[data-loading-status],.detail-loading[role=status]')].some(n=>n.getAttribute('aria-label')===cfg.label||n.textContent===cfg.label);
  if(shown&&__card35c.visibleAt===null)__card35c.visibleAt=performance.now();
  if(!shown&&__card35c.visibleAt!==null&&__card35c.hiddenAt===null)__card35c.hiddenAt=performance.now();
 }).observe(document,{childList:true,subtree:true,attributes:true});
 globalThis.__card35cRelease=()=>{__card35c.released=true;};
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),method=init.method||'GET';
  if(method==='POST')__card35c.posts.push(url.pathname);
  if(!cfg||method!=='GET'||url.pathname!==cfg.path||cfg.passthroughAfterRelease&&__card35c.released)return real(input,init);
  const began=performance.now();__card35c.reads.push({path:url.pathname,began});
  await new Promise((resolve,reject)=>{
   const signal=init.signal;let timer;
   const end=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};
   const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
   if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
   const tick=()=>{if(__card35c.released||cfg.delay!==null&&performance.now()-began>=cfg.delay)end();else timer=setTimeout(tick,10);};tick();
  });
  if(cfg.fail&&!__card35c.released)return new Response('{"error":{"code":"CARD35C_READ_FAILED","retryable":true}}',{status:503,headers:{'content-type':'application/json','x-request-id':'card35c-synthetic-request'}});
  const stored=JSON.parse(sessionStorage.getItem('card35c-response'));
  return new Response(stored.body,{status:stored.status,headers:{'content-type':'application/json'}});
 };
})();`;
const cpu=Number(process.env.CARD35C_CPU_RATE??'1'),q=JSON.stringify;
type Shot={file:string;width:number;height:number;sha256:string};
async function directory(){const dir=process.env.CARD35C_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card35c-'));await mkdir(dir,{recursive:true});return dir;}
async function shot(b:Browser,dir:string,file:string):Promise<Shot>{
 await b.evaluate('document.fonts.ready');await waitForAnimationsSettled(b);
 const bytes=Buffer.from(await b.screenshot(),'base64');assert.equal(bytes.readUInt32BE(16),1440);
 await writeFile(join(dir,file),bytes);return {file,width:1440,height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function prepare(b:Browser){assert.ok(cpu===1||cpu===4);await b.command('Emulation.setCPUThrottlingRate',{rate:cpu});await b.command('Page.addScriptToEvaluateOnNewDocument',{source:controlled});}
type Area={name:string;route:string;read:string;label:string;ready:string;error:string;activate?:string;panel?:string;view?:string;retry?:string;timing?:boolean};
async function area(b:Browser,origin:string,dir:string,a:Area,shots:Shot[]){
 const stored=await b.evaluate('fetch('+q(a.read)+').then(async r=>({status:r.status,body:await r.text()}))');
 assert.ok(stored&&typeof stored==='object'&&'status' in stored&&stored.status===200,JSON.stringify(stored));
 const path=new URL(a.read,origin).pathname;
 let serial=0;
 const config=async(delay:number|null,fail=false)=>{
  const token=a.name+':'+(++serial);
  await b.evaluate('sessionStorage.setItem("card35c-config",'+q(JSON.stringify({path,delay,fail,label:a.label,token}))+');sessionStorage.setItem("card35c-response",'+q(JSON.stringify(stored))+')');
  await b.command('Page.navigate',{url:origin+'/workbench/app/'+a.route});
  await b.waitFor('globalThis.__card35c?.token==='+q(token));
  if(a.activate){
   // This test measures read states; pointer geometry has its own existing browser coverage.
   await b.waitFor('document.querySelector('+q(a.activate)+')?.checkVisibility()===true');
   await b.evaluate('document.querySelector('+q(a.activate)+').click()');
   await b.waitFor('document.querySelector('+q(a.activate)+')?.getAttribute("aria-selected")==="true"');
   if(a.panel)await b.waitFor('document.querySelector('+q(a.panel)+')?.hidden===false');
  }
 };
 const view=async()=>{if(a.view)await b.evaluate('document.querySelector('+q(a.view)+')?.scrollIntoView({block:"center"})');};
 const loading=a.name==='forms'?'.ds-detail-footer .detail-loading[role="status"]':'[data-loading-status][aria-label="'+a.label+'"]';
 await config(null);await b.waitFor('document.querySelector('+q(loading)+')?.textContent.includes('+q(a.label)+')===true');
 assert.ok(Number(await b.evaluate('__card35c.reads.length'))>0);
 assert.equal(await b.evaluate('Boolean(document.querySelector('+q(loading)+')?.querySelector("[data-skeleton]"))'),a.name!=='forms','small form reads stay inline');
 assert.equal(await b.evaluate('Boolean(document.querySelector('+q(loading)+')?.querySelector("[data-session-read-sequence],[data-personal-read-ref]"))'),false,'a loading placeholder cannot advance personal reading facts');
 await view();
 shots.push(await shot(b,dir,a.name+'-loading-1440.png'));
 await b.evaluate('__card35cRelease()');await b.waitFor(a.ready);await b.waitFor('!document.querySelector('+q(loading)+')');
 await view();
 shots.push(await shot(b,dir,a.name+'-ready-1440.png'));
 await config(0,true);
 const errorScope=a.name==='forms'?'[data-activity-field=internal-note]':a.view??'body';
 await b.waitFor('document.querySelector('+q(errorScope)+')?.innerText.includes('+q(a.error)+')===true');
 if(a.name==='forms')assert.equal(await b.evaluate("document.querySelector('[data-activity-field=internal-note]')?.textContent.includes('服务请求失败')"),true,'the failed note read renders its original error, while independent forms may still prepare');
 else {await b.waitFor('!document.querySelector('+q(loading)+')');assert.equal(await b.evaluate('Boolean(document.querySelector('+q(loading)+'))'),false,'failed reads stop loading');}
 await view();
 shots.push(await shot(b,dir,a.name+'-error-1440.png'));
 await b.evaluate('__card35cRelease()');
 const retried=await b.evaluate('(()=>{const button='+(a.retry?'document.querySelector('+q(a.retry)+')':'[...document.querySelectorAll(".ds-error-state button")].find(b=>b.textContent==="重试")')+';if(!button)return false;button.click();return true;})()');
 if(a.name!=='forms')assert.equal(retried,true,'existing read retry is reachable');
 if(retried)await b.waitFor(a.ready);
 // Scrolling actual activity may persist its existing read position. No state presentation submits a business command.
 assert.deepEqual(await b.evaluate('__card35c.posts.filter(p=>!p.endsWith("/read-position")&&!p.includes("personal-read")&&!p.includes("activities")&&!p.includes("activity"))'),[]);
 if(a.timing){
  await config(400);await b.waitFor('__card35c.hiddenAt!==null');
  const timing=await b.evaluate('({visible:__card35c.visibleAt,hidden:__card35c.hiddenAt,began:__card35c.reads[0].began})') as {visible:number;hidden:number;began:number};
  assert.ok(timing.hidden-timing.visible>=285,JSON.stringify(timing));
  await writeFile(join(dir,a.name+'-timing.json'),JSON.stringify({cpu,timing},null,2));
 }
 await b.evaluate('sessionStorage.removeItem("card35c-config")');
}
test('Card 35C areas: loading, failure, retry, factual empty states and local settings feedback',async()=>{
 const dir=await directory(),shots:Shot[]=[];
 await withT43Fixture(async f=>{
  const active=await start(f,await f.manualReport('打印机无法出纸，请检查（35C合成）'));const ticketId=String(active.id);
  const browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,fullRaster:true,cookies:f.browserCookies.slice(0,1),certificateSpki:f.certificateSpki});assert.ok(browser);let failure:unknown;
  try{
   await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');await prepare(browser);
   for(const a of [
    {name:'conversations',route:'conversations',read:'/api/workbench/conversations?state=open&limit=50',label:'正在加载会话…',ready:'Boolean(document.querySelector(".conversation-workspace"))',error:'会话没有读出来'},
    {name:'incidents',route:'incidents/candidates',read:'/api/incident-candidates?state=CANDIDATE&limit=30',label:'正在加载公共故障候选…',ready:'document.body.innerText.includes("没有待复核的候选")',error:'候选没有读出来'},
    {name:'notifications',route:'notification-exceptions',read:'/api/notification-exceptions?domain=ALL&route=ALL&state=ALL&limit=10',label:'正在加载通知异常…',ready:'document.body.innerText.includes("当前没有通知异常")',error:'通知异常没有读出来'},
    {name:'groups',route:'settings/source-groups',read:'/api/workbench/source-groups?limit=50&q=',label:'正在加载来源群目录…',ready:'document.body.innerText.includes("本页没有可见的来源群")',error:'来源群目录没有读出来'},
    {name:'forms',route:'items/ticket/'+ticketId+'?detail=page',read:'/api/tickets/'+ticketId,label:'正在加载可用操作…',ready:'Boolean(document.querySelector("[data-activity-field=internal-note]"))',error:'服务请求失败'},
    {name:'attachments',route:'items/ticket/'+ticketId+'?detail=page',read:'/api/workbench/items/ticket/'+ticketId+'/attachments',label:'正在加载报修附件…',activate:'#detail-tab-trigger-attachments',panel:'#detail-tab-attachments',view:'.report-materials',ready:"document.querySelector('#detail-tab-attachments')?.hidden===false&&!document.querySelector('.attachment-section .media-retry')",error:'服务请求失败',retry:'.attachment-section .media-retry',timing:true},
    {name:'rounds',route:'items/ticket/'+ticketId+'?detail=page',read:'/api/tickets/'+ticketId+'/deliveries',label:'正在加载通知状态…',view:'.ticket-round-notifications',ready:'Boolean(document.querySelector(".ticket-round-notifications .notification-empty"))',error:'服务请求失败',retry:'.ticket-round-notifications .notification-refresh',timing:true}
   ])await area(browser,f.origin,dir,a,shots);
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'});await browser.waitFor('Boolean(document.querySelector("[data-action=open-user-menu]"))');
   await browser.evaluate('AudioContext.prototype.resume=()=>Promise.reject(Error("CARD35C_AUDIO_REFUSED"))');
   await clickWorkbenchControl(browser,'[data-action="open-user-menu"][data-menu-location="sidebar"]');
   await clickWorkbenchControl(browser,'[data-action="open-settings"]');await browser.waitFor('Boolean(document.querySelector(".settings-test-sound"))');
   await clickWorkbenchControl(browser,'.settings-test-sound');
   await browser.waitFor('document.querySelector(".workbench-settings .ds-inline-alert")?.textContent.includes("声音暂不可用，视觉提醒继续。")');
   shots.push(await shot(browser,dir,'settings-local-error-1440.png'));
  }catch(error){failure=error;shots.push(await shot(browser,dir,'failure-main-1440.png'));await writeFile(join(dir,'failure-main.txt'),String(await browser.evaluate('document.body.innerText')));}
  await writeFile(join(dir,'main-shots.json'),JSON.stringify({cpu,shots},null,2));
  await closeBrowserTestResources([async()=>{await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});
test('Card 35C inbox: contacts skeleton, error, fast read and slow request notice',async()=>{
 const dir=await directory(),shots:Shot[]=[];
 await withT22Fixture(async f=>{
  const browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,fullRaster:true,cookies:[{...f.browserCookie,url:f.origin}]});assert.ok(browser);let failure:unknown;
  try{
   await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');await prepare(browser);
   await area(browser,f.origin,dir,{name:'inbox',route:'conversations',read:'/api/workbench/conversation-inbox?state=open&source=all&q=&limit=30&include_waiting_since=true',label:'正在加载联系人…',ready:'Boolean(document.querySelector(".conversation-inbox-workspace"))',error:'联系人没有读出来'},shots);
   await browser.evaluate('sessionStorage.setItem("card35c-config",JSON.stringify({path:"/api/workbench/conversation-inbox",delay:80,fail:false,label:"正在加载联系人…",token:"inbox-fast"}))');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations'});
   await browser.waitFor('globalThis.__card35c?.token==="inbox-fast"');
   await browser.waitFor('__card35c.reads.length>0&&Boolean(document.querySelector("[data-contact-ref]"))');
   await browser.evaluate('new Promise(r=>setTimeout(r,600))');
   assert.equal(await browser.evaluate('Boolean(document.querySelector(\'[data-loading-status][aria-label="正在加载联系人…"]\'))'),false);
   assert.equal(await browser.evaluate('__card35c.visibleAt'),null,'80ms read never flashes a skeleton');
   await browser.evaluate('sessionStorage.setItem("card35c-config",JSON.stringify({path:"/api/workbench/conversation-inbox",delay:400,fail:false,label:"正在加载联系人…",token:"inbox-400"}))');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations'});
   await browser.waitFor('globalThis.__card35c?.token==="inbox-400"');
   await browser.waitFor('__card35c.hiddenAt!==null');
   const timing=await browser.evaluate('({visible:__card35c.visibleAt,hidden:__card35c.hiddenAt,began:__card35c.reads[0].began})') as {visible:number;hidden:number;began:number};
   assert.ok(timing.visible-timing.began>=140,JSON.stringify(timing));assert.ok(timing.hidden-timing.visible>=285,JSON.stringify(timing));
   await writeFile(join(dir,'inbox-timing.json'),JSON.stringify({cpu,timing},null,2));
   await browser.evaluate('sessionStorage.setItem("card35c-config",JSON.stringify({path:"/api/workbench/conversation-inbox",delay:null,fail:false,label:"正在加载联系人…",token:"inbox-slow"}))');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations'});
   await browser.waitFor('globalThis.__card35c?.token==="inbox-slow"');
   await browser.waitFor('document.querySelector(".ds-loading-slow")?.textContent.includes("比平时慢")');
   shots.push(await shot(browser,dir,'inbox-slow-1440.png'));await browser.evaluate('__card35cRelease()');
   await browser.waitFor('!document.querySelector(\'[data-loading-status][aria-label="正在加载联系人…"]\')');
   const session=f.sessions[0];assert.ok(session);
   await browser.evaluate('sessionStorage.removeItem("card35c-config")');
   await area(browser,f.origin,dir,{name:'chat',route:'conversations/'+session.id,read:'/api/workbench/conversations/'+session.id+'?view=chat&include_waiting_since=true',label:'正在加载会话…',ready:'Boolean(document.querySelector("[data-conversation-ready]"))',error:'会话没有打开'},shots);
  }catch(error){failure=error;shots.push(await shot(browser,dir,'failure-inbox-1440.png'));await writeFile(join(dir,'failure-inbox.txt'),String(await browser.evaluate('document.body.innerText')));}
  await writeFile(join(dir,'inbox-shots.json'),JSON.stringify({cpu,shots},null,2));
  await closeBrowserTestResources([async()=>{await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 },{inbox:true});
});

test('Card 35C delayed inbox timeline mounts at the latest message and keeps the history reader anchor',{timeout:120000},async()=>{
 await withT22Fixture(async f=>{
  const session=f.sessions[0];assert.ok(session);
  for(let index=0;index<64;index++)await appendT22LiveItem(f.pool,session.id,'合成滚动消息 '+String(index+1).padStart(2,'0'));
  assert.equal((await conversationPost(f.origin,f.cookie,session.id,'takeover',freshCommand())).status,200);
  await f.runtime.coordinator.runOnce();
  const browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,cookies:[{...f.browserCookie,url:f.origin}]});assert.ok(browser);let failure:unknown;
  try{
   await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');await prepare(browser);
   const read='/api/workbench/conversations/'+session.id+'?view=chat&include_waiting_since=true';
   const stored=await browser.evaluate('fetch('+q(read)+').then(async r=>({status:r.status,body:await r.text()}))');
   assert.ok(stored&&typeof stored==='object'&&'status' in stored&&stored.status===200);
   await browser.evaluate('sessionStorage.setItem("card35c-config",'+q(JSON.stringify({path:read.split('?')[0],delay:null,fail:false,label:'正在加载会话…',token:'chat-initial-scroll',passthroughAfterRelease:true}))+');sessionStorage.setItem("card35c-response",'+q(JSON.stringify(stored))+')');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});
   await browser.waitFor('globalThis.__card35c?.token==="chat-initial-scroll"&&__card35c.visibleAt!==null');
   assert.equal(await browser.evaluate('Boolean(document.querySelector(".inbox-timeline"))'),false,'the timeline stays unmounted while the skeleton is shown');
   // Hold the real detail response beyond both the delay and the skeleton's minimum exposure.
   await browser.waitFor('performance.now()-__card35c.visibleAt>=350');await browser.evaluate('document.fonts.ready');
   await browser.evaluate('__card35cRelease()');
   await browser.waitFor('Boolean(document.querySelector(".inbox-timeline"))&&!document.querySelector(\'[data-loading-status][aria-label="正在加载会话…"]\')');
   await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const initial=await browser.evaluate('(()=>{const n=document.querySelector(".inbox-timeline");return {top:n.scrollTop,height:n.scrollHeight,client:n.clientHeight,count:n.querySelectorAll("[data-conversation-item]").length,distance:n.scrollHeight-n.scrollTop-n.clientHeight};})()') as {top:number;height:number;client:number;count:number;distance:number};
   assert.equal(initial.count,50);assert.ok(initial.height-initial.client>200,'real loaded messages must overflow the timeline');
   assert.ok(initial.distance<48,'a delayed conversation must initially show the latest message: '+JSON.stringify(initial));
   assert.equal(await browser.evaluate('Boolean(document.querySelector(".inbox-new-messages"))'),false,'initial mounting must not report new messages');
   await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
   const anchor=await browser.evaluate('(()=>{const n=document.querySelector(".inbox-timeline");n.scrollTop=Math.min(300,(n.scrollHeight-n.clientHeight)/2);n.dispatchEvent(new Event("scroll"));const item=[...n.querySelectorAll("[data-conversation-item]")].find(i=>i.getBoundingClientRect().bottom>n.getBoundingClientRect().top);return {id:item.dataset.conversationItem,offset:item.getBoundingClientRect().top-n.getBoundingClientRect().top};})()') as {id:string;offset:number};
   const response=await fetch(f.origin+read,{headers:{cookie:f.cookie}});assert.equal(response.status,200);const current=await response.json() as ConversationChatEntry;
   const text='合成骨架结束后的实时消息';
   assert.equal((await conversationPost(f.origin,f.cookie,session.id,'internal-notes',{...freshCommand(current.session.row_version),text})).status,201);await f.runtime.coordinator.runOnce();
   await browser.waitFor('document.querySelector(".inbox-timeline")?.textContent.includes('+q(text)+')');
   const offset=await browser.evaluate('(()=>{const n=document.querySelector(".inbox-timeline"),item=document.querySelector(\'[data-conversation-item="'+anchor.id+'"]\');return item.getBoundingClientRect().top-n.getBoundingClientRect().top;})()') as number;
   assert.ok(Math.abs(offset-anchor.offset)<3,'a subsequent item preserves the history reader anchor');
   assert.equal(await browser.evaluate('Boolean(document.querySelector(".inbox-new-messages"))'),true,'the sequence at initial mount must be retained for the next item');
   await clickWorkbenchControl(browser,'.inbox-new-messages');
   await browser.waitFor('(()=>{const n=document.querySelector(".inbox-timeline");return n.scrollHeight-n.scrollTop-n.clientHeight<48&&!document.querySelector(".inbox-new-messages");})()');
   console.log('CARD35C_INITIAL_SCROLL '+JSON.stringify({cpu,initial,anchorOffsetDelta:offset-anchor.offset}));
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 },{inbox:true,realtime:true,recovery:false});
});

test('Card 35C delayed candidate detail focuses its real heading after the skeleton',{timeout:120000},async()=>{
 await withT43Fixture(async f=>{
  for(const reporter of ['synthetic-A','synthetic-B','synthetic-C'])await f.inbound('group','测试诊室断网。',reporter);
  const id=await f.correlate(),read='/api/incident-candidates/'+id;
  const browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,cookies:f.browserCookies.slice(0,1),certificateSpki:f.certificateSpki});assert.ok(browser);let failure:unknown;
  try{
   await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');await prepare(browser);
   const stored=await browser.evaluate('fetch('+q(read)+').then(async r=>({status:r.status,body:await r.text()}))');assert.ok(stored&&typeof stored==='object'&&'status' in stored&&stored.status===200);
   await browser.evaluate('sessionStorage.setItem("card35c-config",'+q(JSON.stringify({path:read,delay:null,fail:false,label:'正在加载候选详情…',token:'candidate-focus',passthroughAfterRelease:true}))+');sessionStorage.setItem("card35c-response",'+q(JSON.stringify(stored))+')');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/incidents/candidates/'+id});
   await browser.waitFor('globalThis.__card35c?.token==="candidate-focus"&&__card35c.visibleAt!==null&&performance.now()-__card35c.visibleAt>=350');
   await browser.evaluate('__card35cRelease()');await browser.waitFor('Boolean(document.getElementById('+q('candidate-heading-'+id)+'))');
   await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   assert.equal(await browser.evaluate('document.activeElement===document.getElementById('+q('candidate-heading-'+id)+')'),true,'a delayed candidate must focus the mounted heading');
   console.log('CARD35C_CANDIDATE_FOCUS '+JSON.stringify({cpu,focused:true}));
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('Card 35C attachment visibility observation follows an empty-state root remount',{timeout:120000},async()=>{
 await withDetailRestructureFixture(async f=>{
  const item=f.tickets[0],cookie=f.browserCookies[0];assert.ok(item&&cookie);const http=await t11Http(f);await http.start(item.ticket.id);
  const id=item.ticket.id,read='/api/workbench/items/ticket/'+id+'/web-report';
  const browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,cookies:[{...cookie,url:f.origin}]});assert.ok(browser);let failure:unknown;
  try{
   await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');await prepare(browser);
   await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const Native=IntersectionObserver;globalThis.__card35cAttachmentRoots=[];globalThis.IntersectionObserver=class extends Native{observe(node){super.observe(node);if(node.matches('.attachment-section.detail-attachments'))__card35cAttachmentRoots.push(node);}};})()`});
   const stored=await browser.evaluate('fetch('+q(read)+').then(async r=>({status:r.status,body:await r.text()}))');assert.ok(stored&&typeof stored==='object'&&'status' in stored&&stored.status===200);
   await browser.evaluate('sessionStorage.setItem("card35c-config",'+q(JSON.stringify({path:read,delay:null,fail:false,label:'正在加载报修附件…',token:'attachment-root',passthroughAfterRelease:true}))+');sessionStorage.setItem("card35c-response",'+q(JSON.stringify(stored))+')');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id+'?detail=page'});
   await browser.waitFor('globalThis.__card35c?.token==="attachment-root"&&__card35c.visibleAt!==null&&performance.now()-__card35c.visibleAt>=350');
   assert.ok(Number(await browser.evaluate('__card35cAttachmentRoots.length'))>0,'the initial hidden root is observed');
   await browser.evaluate('__card35cRelease()');
   await browser.waitFor('!document.querySelector(".attachment-section.detail-attachments")&&!document.querySelector(\'[data-loading-status][aria-label="正在加载报修附件…"]\')');
   await clickWorkbenchControl(browser,'[data-action=open-public-progress]');
   await browser.waitFor('Boolean(document.querySelector(".detail-progress-dialog"))');
   await browser.evaluate(`(()=>{const input=document.querySelector('.detail-progress-dialog textarea[aria-label="公开进度"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'合成附件可见性重读。');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await clickWorkbenchControl(browser,'[aria-label="确认公开进度内容"]');
   await browser.evaluate(`(()=>{const real=fetch;globalThis.__card35cAttachmentFailures=0;globalThis.fetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if((init.method||'GET')==='GET'&&url.pathname===${q(read)}){__card35cAttachmentFailures++;return Promise.resolve(new Response('{"error":{"code":"CARD35C_READ_FAILED","retryable":true}}',{status:503,headers:{'content-type':'application/json'}}));}return real(input,init);};})()`);
   // Failed preflight uses the form's existing reread and retains this component instance.
   // No command is intercepted or submitted after the failed authorization read.
   await clickWorkbenchControl(browser,'.detail-progress-dialog button[type=submit]');
   await browser.waitFor('__card35cAttachmentFailures>0&&Boolean(document.querySelector(".attachment-section.detail-attachments"))');
   await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   assert.equal(await browser.evaluate('__card35cAttachmentRoots.includes(document.querySelector(".attachment-section.detail-attachments"))'),true,'a remounted attachment root must have its own real visibility observer');
   console.log('CARD35C_ATTACHMENT_ROOT '+JSON.stringify({cpu,observed:true}));
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

