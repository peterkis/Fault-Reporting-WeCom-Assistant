import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,platform,release} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {withT43Fixture,text,version} from './helpers/t43-full-service-fixture.mjs';
import {start,complete,get,post,close} from './helpers/t43-service-actions.mjs';
import type {Browser} from './helpers/t43-service-actions.mjs';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl,chooseWorkbenchSelect} from './helpers/heroui-workbench-controls.mjs';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';

// Direct risks: delayed first paint, layout replacement, retained authorized data, diagnostics privacy,
// one connection scheduler, and the existing permission / UNKNOWN owners. No real external sends.
const fakeEndpoint=`(()=>{
 const config=JSON.parse(sessionStorage.getItem('card35a')||'{}');window.__card35a=config;
 const real=window.fetch.bind(window),captured=JSON.parse(sessionStorage.getItem('card35aResponses')||'{}'),batches=new Map();window.__stateTimes=[];window.__controlledReads=[];window.__busySeen=false;window.__busyNodes=[];let start=null;
 const observe=()=>{const busy=Boolean(document.querySelector('[aria-busy="true"]'));window.__busySeen||=busy;if(busy)window.__busyNodes.push([...document.querySelectorAll('[aria-busy=\"true\"]')].map(node=>node.className));const has=Boolean(document.querySelector('[data-skeleton]'));if(has&&start===null)start=performance.now();if(!has&&start!==null){window.__stateTimes.push(performance.now()-start);start=null;}};
 new MutationObserver(observe).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy']});
 window.fetch=async(input,init)=>{
  const path=String(input),cfg=window.__card35a,began=performance.now();
  const column=path.startsWith('/api/workbench/board?')?new URL(path,location.origin).searchParams.get('column'):null;
  const detail=/^\\/api\\/workbench\\/items\\/(ticket|review|intake)\\/[^/?]+\\?/.test(path),boot=path==='/api/lifecycle/bootstrap';
  const delay=boot?cfg.bootstrapDelay:column?cfg.boardDelay?.[column]:detail?cfg.detailDelay:0;
  let response;
  if(delay){
   const key=boot?'bootstrap':column?'board:'+column+':'+new URL(path,location.origin).searchParams.get('range'):new URL(path,location.origin).pathname,stored=captured[key];if(!stored)throw Error('CARD35A_CAPTURE_REQUIRED '+key);
   // Release a concurrent batch in one task, before rendering the first result can delay another timer.
   await new Promise((resolve,reject)=>{
    const signal=init?.signal;if(signal?.aborted){reject(new DOMException('aborted','AbortError'));return;}
    let batch=batches.get(delay);if(!batch){batch={entries:new Set(),timer:null};batches.set(delay,batch);}
    const entry={finish:()=>{signal?.removeEventListener('abort',abort);resolve();}},abort=()=>{batch.entries.delete(entry);signal?.removeEventListener('abort',abort);if(!batch.entries.size){clearTimeout(batch.timer);batches.delete(delay);}reject(new DOMException('aborted','AbortError'));};
    batch.entries.add(entry);signal?.addEventListener('abort',abort,{once:true});clearTimeout(batch.timer);batch.timer=setTimeout(()=>{batches.delete(delay);for(const item of batch.entries)item.finish();},delay);
   });
   response=new Response(stored.body,{status:stored.status,headers:{'content-type':'application/json'}});window.__controlledReads.push({key,target:delay,elapsed:performance.now()-began});
  }else response=await real(input,init);
  if(boot&&cfg.hideNotes){const body=await response.clone().json();body.internal_notes_enabled=false;return new Response(JSON.stringify(body),{status:200,headers:response.headers});}
  if(detail&&cfg.detailForbidden)return new Response('{"error":{"code":"AUTHORIZATION_REJECTED"}}',{status:403,headers:{'content-type':'application/json'}});
  if(boot&&cfg.bootstrapFail||column&&cfg.failColumn===column||detail&&cfg.detailFail)return new Response(JSON.stringify({error:{code:'CARD35A_SYNTHETIC_READ_FAILED',retryable:true}}),{status:503,headers:{'content-type':'application/json','x-request-id':'card35a-request-synthetic'}});
  if(detail&&cfg.emptyDetail){const body=await response.clone().json();body.records=[];body.description=null;body.next_cursor=null;return new Response(JSON.stringify(body),{status:200,headers:response.headers});}
  if(column==='pending'&&cfg.pendingKind){const body=await response.clone().json();body.items=body.items.filter(item=>cfg.pendingKind==='ticket'?item.kind==='ticket':item.kind!=='ticket');body.next_cursor=null;return new Response(JSON.stringify(body),{status:200,headers:response.headers});}
  if(column&&(cfg.emptyAll||cfg.emptyPending&&column==='pending')){const body=await response.clone().json();body.items=[];body.next_cursor=null;if(body.group_counts)body.group_counts={completed:0,dismissed:0};return new Response(JSON.stringify(body),{status:200,headers:response.headers});}
  return response;
 };
})();`;
interface Fixture {origin:string;browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[]}
type Box={x:number;y:number;width:number;height:number};
async function box(b:Browser,selector:string):Promise<Box>{await waitForAnimationsSettled(b);return await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`) as Box;}
function sameBox(a:Box,b:Box,label:string){for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(a[key]-b[key])<=1,label+' '+key+' '+JSON.stringify({a,b}));}
async function evidence(){const directory=process.env.CARD35A_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card35a-'));await mkdir(directory,{recursive:true});return directory;}
async function shot(b:Browser,directory:string,name:string){await b.evaluate('document.fonts.ready');await waitForAnimationsSettled(b);const bytes=Buffer.from(await b.screenshot(),'base64');assert.equal(bytes.readUInt32BE(16),1440);await writeFile(join(directory,name),bytes);return {file:name,width:1440,height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};}

// Each matrix run applies the requested CDP rate before the document used by any assertions.
const cpuRate=Number(process.env.CARD35A_CPU_RATE??'1');
async function launchStateBrowser(options:Parameters<typeof launchSystemBrowser>[0]){
 assert.ok(Number.isFinite(cpuRate)&&cpuRate>=1);
 const browser=await launchSystemBrowser(options);if(!browser)return browser;
 try{
  await browser.command('Emulation.setCPUThrottlingRate',{rate:cpuRate});
  console.log('CARD35A_CPU '+JSON.stringify({rate:cpuRate}));
  const origin=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'`);
  return browser;
 }catch(error){await browser.close();throw error;}
}

test('Card 35A PR192: locally filtered board and list keep next-page controls until every query is exhausted',{timeout:60000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=await evidence(),metrics:unknown[]=[];let browser:Browser|undefined,error:unknown;
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);
  browser=await launchStateBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[cookie]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   const real=fetch;window.__paginationReads=[];const config=JSON.parse(sessionStorage.getItem('card35a-pagination')||'{}');window.__paginationConfig=config;
   window.fetch=async(input,init)=>{
    const url=new URL(String(input),location.origin),board=url.pathname==='/api/workbench/board';
    const next=board&&url.searchParams.get('cursor')==='card35a-synthetic-page-2';if(next)url.searchParams.delete('cursor');
    const response=await real(next?url.pathname+url.search:input,init);if(!board||!response.ok)return response;
    const body=await response.json(),column=url.searchParams.get('column');window.__paginationReads.push({column,next});
    if(column==='active'){
     const first=body.items.find(item=>item.service),second=body.items.find(item=>item.id!==first?.id);if(!first||!second)throw Error('SYNTHETIC_ACTIVE_FIXTURE_REQUIRED');
     body.items=next?[{...second,service:null}]:[first];body.next_cursor=!next&&!config.exhausted?'card35a-synthetic-page-2':null;
    }else {body.items=[];body.next_cursor=null;if(body.group_counts)body.group_counts={completed:0,dismissed:0};}
    return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});
   };
  })();`});
  for(const view of ['board','list'])for(const exhausted of [false,true]){
   const nonce=randomUUID();await b.evaluate(`sessionStorage.setItem('card35a-pagination',${JSON.stringify(JSON.stringify({nonce,exhausted}))})`);
   await b.command('Page.navigate',{url:f.origin+'/workbench/app/?range=all&view='+view});
   const card=view==='board'?'.board-column.active .ticket-card[data-item-id]':'#list-active .ds-work-row[data-item-id]';
   await b.waitFor('window.__paginationConfig?.nonce==='+JSON.stringify(nonce)+`&&Boolean(document.querySelector(${JSON.stringify(card)}))&&!document.querySelector('[data-skeleton]')`);
   await chooseWorkbenchSelect(b,'[data-field-label="类别"]','unclassified');
   await b.waitFor("document.querySelector('[data-field-label=类别]')?.closest('.ds-filter-chip')?.dataset.filterActive==='true'");
   const empty="document.querySelector('.ds-empty-state[data-empty-variant=filtered]')";
   if(exhausted){
    await b.waitFor('Boolean('+empty+')');assert.equal(await b.evaluate("Boolean(document.querySelector('.load-more'))"),false);
    await clickWorkbenchControl(b,'.ds-empty-state button');await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))`);
   }else {
    assert.equal(await b.evaluate('Boolean('+empty+')'),false,view+': an unloaded next page must not be hidden by the board-wide filtered empty state');
    const more=view==='board'?'.board-column.active .load-more':'#list-active .load-more';
    assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(more)})?.checkVisibility()`),true,view+': next-page control remains usable when no loaded item matches');
    assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(view==='board'?'.board-column.active .ds-empty-state':'#list-active .ds-empty-state')})?.dataset.size`),'compact');
    await shot(b,directory,'filtered-pagination-'+view+'.png');
    await clickWorkbenchControl(b,more);await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))&&!document.querySelector(${JSON.stringify(more)})`);
    assert.equal(await b.evaluate('window.__paginationReads.filter(row=>row.next).length'),1,'the next page is fetched only once');
   }
   metrics.push({view,exhausted,nextPageReachable:!exhausted});
  }
 }catch(caught){error=caught;throw caught;}finally{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});await writeFile(join(directory,'receipt-35a-pagination.json'),JSON.stringify({status:error?'FAIL':'PASS',metrics,error:error instanceof Error?error.message:null},null,2));}
},{precisionV212:true,syntheticServiceCodes:true,workbenchFollowEnabled:true}));

test('Card 35A PR192: empty handled column retains the completed drop zone and opens the existing form without a POST',{timeout:60000},()=>withT11Fixture(async f=>{
 const directory=await evidence(),target=f.tickets[0],cookie=f.browserCookies[0];assert.ok(target&&cookie);
 await f.pool.query("UPDATE pilot_ticket.ticket SET title=title||'（合成）'");
 const http=await t11Http(f);await http.start(target.ticket.id);const before=await http.detail(target.ticket.id);
 const posts:string[]=[],observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(request.url??'');};f.runtime.server.on('request',observe);
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launchStateBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelectorAll('.column-cards').length===3&&!document.querySelector('[data-skeleton]')");
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const real=fetch;window.fetch=async(input,init)=>{const response=await real(input,init);if(String(input).startsWith('/api/workbench/board?')&&new URL(String(input),location.origin).searchParams.get('column')==='handled'&&response.ok){const body=await response.json();body.items=[];body.next_cursor=null;body.group_counts={completed:0,dismissed:0};return new Response(JSON.stringify(body),{status:200,headers:response.headers});}return response;};})();`});
  const time=await b.evaluate('performance.timeOrigin');await b.command('Page.reload');await b.waitFor(`performance.timeOrigin!==${time}&&document.querySelectorAll('.column-cards').length===3&&!document.querySelector('[data-skeleton]')`);
  const card='.board-column.active .ticket-card[data-item-id="'+target.ticket.id+'"]';
  if(!await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`))await clickWorkbenchControl(b,'.board-column.active [data-action=expand-column]');
  const handle=card+' [data-action=board-drag-handle]',zone='.board-column.handled [data-board-drop-column=handled] .ds-completed-drop-zone';
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(handle)}))`);
  assert.equal(await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(zone)}))`),true,'empty handled column retains the original completed drop target');
  assert.equal(await b.evaluate("Boolean(document.querySelector('[data-board-group=已关闭]')?.closest('[data-board-drop-column=handled]'))"),false,'dismissed group stays outside the completion target');
  const a=await box(b,handle),z=await box(b,zone),x=a.x+a.width/2,y=a.y+a.height/2,toX=z.x+z.width/2,toY=z.y+z.height/2;
  await shot(b,directory,'empty-handled-drop-target.png');
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await b.command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+8,y,button:'left',buttons:1});await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(card+' .board-action-card.is-dragging')}))`);
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:toX,y:toY,button:'left',buttons:1});await b.waitFor("Boolean(document.querySelector('[data-board-drop-column=handled].is-drop-target'))");
  await b.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:toX,y:toY,button:'left',clickCount:1});await b.waitFor("document.querySelector('.ticket-completion')?.checkVisibility()===true");
  assert.deepEqual(posts,[],'opening the completion form must not issue a business POST');assert.equal((await http.detail(target.ticket.id)).version,before.version);
  await shot(b,directory,'empty-handled-completion-form.png');
 }catch(caught){error=caught;throw caught;}finally{f.runtime.server.off('request',observe);await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});await writeFile(join(directory,'receipt-35a-empty-handled-drop.json'),JSON.stringify({status:error?'FAIL':'PASS',posts,error:error instanceof Error?error.message:null},null,2));}
},{boardActionsEnabled:true}));

test('Card 35A A4.1-5,8: controllable 80/400/9000ms reads, zero-shift headers, refresh, empty sizes and private diagnostics',{timeout:240000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=await evidence(),screenshots:unknown[]=[],metrics:Record<string,unknown>={};let browser:Browser|undefined,error:unknown;
 try{
  const cookie=f.browserCookies[0],own=f.tickets[1];assert.ok(cookie&&own);
  browser=await launchStateBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[cookie]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  assert.equal(await b.evaluate("document.querySelector('.topbar [data-realtime-status=disabled]')?.checkVisibility()"),true,'normal manual-refresh indicator stays visible');
  const capturedCount=await b.evaluate(`(async()=>{
   const captured={},save=async(key,path)=>{const response=await fetch(path);if(!response.ok)throw Error('CARD35A_CAPTURE_FAILED');const body=await response.text();captured[key]={status:response.status,body};return JSON.parse(body);};
   await save('bootstrap','/api/lifecycle/bootstrap');const items=[];
   for(const column of ['pending','active','handled'])for(const range of ['all','recent']){const page=await save('board:'+column+':'+range,'/api/workbench/board?'+new URLSearchParams({column,range,limit:'50'}));if(range==='all')items.push(...page.items);}
   for(const item of items){const path='/api/workbench/items/'+item.kind+'/'+item.id;await save(path,path+'?limit=50');}
   sessionStorage.setItem('card35aResponses',JSON.stringify(captured));return Object.keys(captured).length;
  })()`);assert.ok(Number(capturedCount)>4,'timed reads use fixture responses captured before the measured navigation');
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:fakeEndpoint});
  const navigate=async(config:Record<string,unknown>,path='/workbench/app/?range=all')=>{const nonce=randomUUID();await b.evaluate(`sessionStorage.setItem('card35a',${JSON.stringify(JSON.stringify({...config,nonce}))})`);await b.command('Page.navigate',{url:f.origin+path});await b.waitFor('window.__card35a?.nonce==='+JSON.stringify(nonce));};
  const loaded="document.querySelectorAll('.board .column-cards').length===3&&document.querySelectorAll('.board .ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')";
  // Mount the code/layout first, then request a genuinely uncached query key. Cold module work is not response time.
  await navigate({});await b.waitFor(loaded);await waitForAnimationsSettled(b);
  await b.evaluate("window.__card35a.boardDelay={pending:80,active:80,handled:80};window.__controlledReads=[];window.__stateTimes=[];window.__busyNodes=[];window.__busySeen=false");
  // Browser navigation changes the query key without a filter form's independent submission-busy state.
  await b.evaluate("history.pushState(history.state,'','?range=recent');dispatchEvent(new PopStateEvent('popstate',{state:history.state}))");await b.waitFor("new URLSearchParams(location.search).get('range')==='recent'&&window.__controlledReads.length===3&&"+loaded);
  const fastReads=await b.evaluate('window.__controlledReads') as {target:number;elapsed:number}[];assert.equal(fastReads.length,3);assert.ok(fastReads.every(read=>read.target===80&&read.elapsed>=80&&read.elapsed<150),'the complete synthetic reads finish before the loading threshold '+JSON.stringify(fastReads));metrics.fastReads=fastReads;metrics.cpuRate=cpuRate;
  assert.equal(await b.evaluate('window.__busySeen'),false,'80ms never sets busy or renders a skeleton');assert.deepEqual(await b.evaluate('window.__stateTimes'),[]);
  await navigate({bootstrapDelay:400});await b.waitFor("Boolean(document.querySelector('[data-startup] [data-skeleton]'))");await b.waitFor(loaded);
  await navigate({boardDelay:{active:400}});await b.waitFor("Boolean(document.querySelector('.board .active [data-skeleton]'))");
  const heading=await box(b,'.board .board-column.active>.column-heading'),first=await box(b,'.board .active .ds-ticket-skeleton');
  await b.waitFor(loaded);sameBox(heading,await box(b,'.board .board-column.active>.column-heading'),'board heading');assert.ok(Math.abs(first.y-(await box(b,'.board .active .ticket-card')).y)<=1,'first card top');
  const durations=await b.evaluate('window.__stateTimes') as number[];assert.ok(durations.length&&durations.every(ms=>ms>=300),'shown skeleton lasts at least 300ms '+JSON.stringify(durations));metrics.timing=durations;metrics.mediumReads=await b.evaluate('window.__controlledReads');
  const subgroupGeometry:Record<string,unknown>[]=[];
  for(const column of ['pending','handled']){
   await navigate({boardDelay:{[column]:1400}});await b.waitFor("Boolean(document.querySelector('.board ."+column+" [data-skeleton]'))");
   const beforeHead=await box(b,'.board .'+column+'>.column-heading'),beforeCard=await box(b,'.board .'+column+' .ds-ticket-skeleton');
   await b.waitFor(loaded);const afterHead=await box(b,'.board .'+column+'>.column-heading'),afterCard=await box(b,'.board .'+column+' .ticket-card[data-item-id]');sameBox(beforeHead,afterHead,column+' board heading');assert.ok(Math.abs(beforeCard.y-afterCard.y)<=1,column+' first grouped card top '+JSON.stringify({beforeCard,afterCard}));
   subgroupGeometry.push({view:'board',column,before:beforeCard.y,after:afterCard.y,delta:afterCard.y-beforeCard.y});
  }
  metrics.subgroupGeometry=subgroupGeometry;
  await navigate({boardDelay:{pending:9000,active:9000,handled:9000}});await b.waitFor("Boolean(document.querySelector('.board .active [data-skeleton]'))");screenshots.push(await shot(b,directory,'board-loading.png'));
  assert.equal(await b.evaluate("document.querySelector('[data-loading-status]')?.getAttribute('role')"),'status');assert.equal(await b.evaluate("document.querySelector('[data-loading-status]')?.getAttribute('aria-busy')"),'true');
  await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('[data-skeleton]')).animationName"),'none','reduced motion is static');
  await b.waitFor("document.body.innerText.includes('比平时慢，仍在读取…')");assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-loading-slow button')].some(button=>button.textContent==='重试')"),true);
  await b.waitFor(loaded);
  await navigate({boardDelay:{pending:1000,active:1000,handled:1000}},'/workbench/app/?view=list&range=all');await b.waitFor("document.querySelectorAll('.ds-work-skeleton-row').length===5");assert.equal(await b.evaluate("document.querySelectorAll('.ds-work-skeleton-row').length"),5,'the entire grouped table shares exactly five skeleton rows');const allLoadingHead=await box(b,'.work-table thead');screenshots.push(await shot(b,directory,'list-loading.png'));await b.waitFor("document.querySelectorAll('.ds-work-row[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");const allLoadedHead=await box(b,'.work-table thead');metrics.initialListHeader={before:allLoadingHead,after:allLoadedHead};sameBox(allLoadingHead,allLoadedHead,'all-loading table head including scrollbar space');
  await navigate({boardDelay:{active:9000}},'/workbench/app/?view=list&range=all');await b.waitFor("Boolean(document.querySelector('#list-active [data-skeleton]'))&&['pending','handled'].every(column=>document.querySelectorAll('#list-'+column+' .ds-work-row[data-item-id]').length>0)");
  const tableHead=await box(b,'.work-table thead'),row=await box(b,'#list-active .ds-work-skeleton-row');
  await b.waitFor("document.querySelectorAll('.ds-work-row[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");sameBox(tableHead,await box(b,'.work-table thead'),'table head');assert.ok(Math.abs(row.y-(await box(b,'.ds-work-row[data-column=active]')).y)<=1,'first list row top');
  for(const column of ['pending','handled']){
   await navigate({boardDelay:{[column]:1400}},'/workbench/app/?view=list&range=all');await b.waitFor("Boolean(document.querySelector('#list-"+column+" [data-skeleton]'))&&"+JSON.stringify(['pending','active','handled'].filter(value=>value!==column))+".every(other=>document.querySelectorAll('#list-'+other+' .ds-work-row[data-item-id]').length>0)");
   const beforeHead=await box(b,'.work-table thead'),beforeStage=await box(b,'#list-'+column+' .ds-list-stage'),beforeRow=await box(b,'#list-'+column+' .ds-work-skeleton-row');
   await b.waitFor("document.querySelectorAll('.ds-work-row[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");const afterRow=await box(b,'#list-'+column+' .ds-work-row[data-item-id]');sameBox(beforeHead,await box(b,'.work-table thead'),column+' table heading');sameBox(beforeStage,await box(b,'#list-'+column+' .ds-list-stage'),column+' table stage');assert.ok(Math.abs(beforeRow.y-afterRow.y)<=1,column+' first grouped list row top '+JSON.stringify({beforeRow,afterRow}));
   subgroupGeometry.push({view:'list',column,before:beforeRow.y,after:afterRow.y,delta:afterRow.y-beforeRow.y});
  }
  await navigate({detailDelay:9000});await b.waitFor(loaded);await clickWorkbenchControl(b,'.ticket-card[data-item-id="'+own.ticket.id+'"] a.card-open');await b.waitFor("Boolean(document.querySelector('.ds-detail-skeleton'))");
  assert.equal(await b.evaluate("document.querySelector('.detail-breadcrumb')?.textContent.includes('读取中')"),false,'clicked number is immediate');assert.equal(await b.evaluate("document.querySelector('.ds-detail-skeleton h2')?.textContent.includes('（合成）')"),true,'clicked title is immediate');
  const toolbar=await box(b,'.detail-navigation'),hero=await box(b,'.ds-detail-skeleton .ds-detail-hero');screenshots.push(await shot(b,directory,'drawer-loading.png'));
  await b.waitFor("Boolean(document.querySelector('.ds-detail-view'))&&!document.querySelector('[data-skeleton]')");sameBox(toolbar,await box(b,'.detail-navigation'),'detail toolbar');assert.ok(Math.abs(hero.y-(await box(b,'.ds-detail-view .ds-detail-hero')).y)<=1,'drawer first block top');
  // No empty standalone sections in a fresh synthetic ticket.
  assert.equal(await b.evaluate("Boolean(document.querySelector('.ds-detail-view .ds-empty-state'))"),false,'empty drawer sections are absent');
  await b.evaluate("window.__card35a.detailDelay=500");await b.evaluate("document.querySelector('.detail-next')?.click()");await b.waitFor("!document.querySelector('.ds-detail-skeleton')");
  await navigate({});await b.waitFor(loaded);await b.evaluate("window.__card35a.boardDelay={pending:1000,active:1000,handled:1000}");await clickWorkbenchControl(b,'.ds-board-page-header button[aria-label="刷新"]');
  await b.waitFor("Boolean(document.querySelector('.board [data-refreshing]'))");assert.equal(await b.evaluate("Boolean(document.querySelector('.board [data-skeleton]'))"),false,'refresh retains cards');screenshots.push(await shot(b,directory,'board-refreshing.png'));await b.waitFor("!document.querySelector('.board [data-refreshing]')");
  await b.evaluate("window.__card35a.boardDelay={};window.__card35a.failColumn='active'");const oldCount=await b.evaluate("document.querySelectorAll('.active .ticket-card[data-item-id]').length");await clickWorkbenchControl(b,'.ds-board-page-header button[aria-label="刷新"]');
  await b.waitFor("Boolean(document.querySelector('.active .ds-stale-retry'))");assert.equal(await b.evaluate("document.querySelectorAll('.active .ticket-card[data-item-id]').length"),oldCount);assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.active .ds-state-content')).opacity"),'0.6');assert.equal(await b.evaluate("document.querySelector('.board').innerText.includes('读取未完成')"),false,'the header retry replaces scattered board error text');screenshots.push(await shot(b,directory,'board-stale-retry.png'));
  await b.evaluate("window.__card35a.failColumn=null");await clickWorkbenchControl(b,'.active .ds-stale-retry button');await b.waitFor("!document.querySelector('.active .ds-stale-retry')");
  await navigate({failColumn:'active'});await b.waitFor("Boolean(document.querySelector('.active [data-error-size=block]'))");await b.evaluate("window.__card35a.failColumn=null");await clickWorkbenchControl(b,'.active [data-error-size=block] button');await b.waitFor(loaded);
  await navigate({},'/workbench/app/?range=all&search=1&q='+encodeURIComponent('没有这个问题35A（合成）'));await b.waitFor("Boolean(document.querySelector('[data-empty-variant=filtered]'))");assert.equal(await b.evaluate("document.querySelectorAll('[data-empty-variant=filtered]').length"),1);assert.equal(await b.evaluate("document.querySelector('[data-empty-variant=filtered]')?.dataset.size"),'page');screenshots.push(await shot(b,directory,'board-empty-filtered.png'));await clickWorkbenchControl(b,'[data-empty-variant=filtered] button');await b.waitFor(loaded);
  await navigate({},'/workbench/app/?range=all&search=1&q='+encodeURIComponent('护士站'));await b.waitFor("document.querySelectorAll('.board .ticket-card[data-item-id]').length>0&&!document.querySelector('[data-skeleton]')");assert.equal(await b.evaluate("document.querySelector('.board .pending .ds-empty-state')?.dataset.tone"),'neutral','a search that excludes pending tickets never claims the intake was cleared');
  await navigate({emptyAll:true});await b.waitFor("Boolean(document.querySelector('.pending .ds-empty-state'))");assert.equal(await b.evaluate("document.querySelector('.active .ds-empty-state')?.dataset.size"),'compact');screenshots.push(await shot(b,directory,'intake-cleared.png'));
  await navigate({emptyAll:true},'/workbench/app/?view=list&range=all');await b.waitFor("Boolean(document.querySelector('#list-pending .ds-empty-state'))");assert.equal(await b.evaluate("document.querySelector('#list-pending .ds-empty-state')?.dataset.size"),'block');
  await navigate({bootstrapFail:true});await b.waitFor("Boolean(document.querySelector('[data-error-size=page]'))");screenshots.push(await shot(b,directory,'workbench-error-page.png'));
  await b.command('Browser.grantPermissions',{origin:f.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});await clickWorkbenchControl(b,'.ds-error-actions button:last-child');await b.waitFor("document.body.innerText.includes('已复制诊断信息')");
  const copied=text(await b.evaluate('navigator.clipboard.readText()'));assert.match(copied,/card35a-request-synthetic/u);assert.match(copied,/"time": "\d{4}-\d\d-\d\dT/u);assert.match(copied,/CARD35A_SYNTHETIC_READ_FAILED/u);assert.equal(JSON.parse(copied).requestIdSource,'response');
  const visible=text(await b.evaluate('document.body.innerText'));assert.ok(!visible.includes('card35a-request-synthetic')&&!visible.includes('CARD35A_SYNTHETIC_READ_FAILED')&&!visible.includes(JSON.parse(copied).time),'diagnostics are never visible');
  await b.evaluate("window.__card35a.bootstrapFail=false");await clickWorkbenchControl(b,'.ds-error-actions button:first-child');await b.waitFor(loaded);
  await navigate({},'/workbench/app/?view=list&range=all');await b.waitFor("document.querySelectorAll('.ds-work-row[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");await b.evaluate("window.__card35a.boardDelay={active:1000}");await clickWorkbenchControl(b,'.ds-board-page-header button[aria-label="刷新"]');await b.waitFor("Boolean(document.querySelector('.ds-state-region[data-refreshing]'))");assert.equal(await b.evaluate("Boolean(document.querySelector('.ds-work-table [data-skeleton]'))"),false,'list refresh has no skeleton');await b.waitFor("!document.querySelector('[data-refreshing]')");
  const activityHeader=await box(b,'.ds-work-table thead th:last-child');assert.ok(Math.abs(activityHeader.width-92)<=1,'the activity column retains the main 92px width');
  await b.evaluate("window.__card35a.boardDelay={};window.__card35a.failColumn='active'");await clickWorkbenchControl(b,'.ds-board-page-header button[aria-label="刷新"]');await b.waitFor("Boolean(document.querySelector('.ds-work-table .ds-stale-retry'))");
  sameBox(activityHeader,await box(b,'.ds-work-table thead th:last-child'),'activity header does not grow for the retry marker');
  assert.equal(await b.evaluate("document.querySelector('.ds-work-table').innerText.includes('读取未完成')"),false,'the table header owns its refresh error');
  const retryRect=await box(b,'.ds-work-table .ds-stale-retry button'),tableRect=await box(b,'.ds-work-table-wrap');assert.ok(retryRect.x>=tableRect.x&&retryRect.x+retryRect.width<=tableRect.x+tableRect.width,'table header retry stays inside its scroller');assert.equal(await b.evaluate("(()=>{const button=document.querySelector('.ds-work-table .ds-stale-retry button'),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),true,'the table retry is not clipped or overlapped');await b.evaluate('window.__card35a.failColumn=null');await clickWorkbenchControl(b,'.ds-work-table .ds-stale-retry button');await b.waitFor("!document.querySelector('.ds-work-table .ds-stale-retry')");
  await navigate({detailDelay:9000},'/workbench/app/items/ticket/'+own.ticket.id+'?detail=page&range=all');await b.waitFor("Boolean(document.querySelector('.detail-page .ds-detail-skeleton'))");const pageToolbar=await box(b,'.detail-page .detail-navigation'),pageBody=await box(b,'.detail-page .ds-detail-skeleton');await b.waitFor("Boolean(document.querySelector('.detail-page .ds-detail-view'))&&!document.querySelector('[data-skeleton]')");sameBox(pageToolbar,await box(b,'.detail-page .detail-navigation'),'full-page toolbar');const readBody=await box(b,'.detail-page .ds-detail-view>.detail-body');assert.ok(Math.abs(pageBody.x-readBody.x)<=1&&Math.abs(pageBody.width-readBody.width)<=1&&Math.abs(pageBody.y-readBody.y)<=1,'full-page skeleton uses the real reading column');
  await b.evaluate("window.__manualOnline=false;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__manualOnline});dispatchEvent(new Event('offline'))");await b.waitFor("Boolean(document.querySelector('[data-connection=offline]'))");const offlineToolbar=await box(b,'.detail-page .detail-navigation');assert.equal(offlineToolbar.y-pageToolbar.y,32,'manual-mode full-page content shifts exactly 32px');const footer=await box(b,'.ds-detail-footer');assert.ok(footer.y+footer.height<=1001,'connection space never pushes the full-page composer outside the viewport');await b.evaluate("window.__manualOnline=true;dispatchEvent(new Event('online'))");await b.waitFor("Boolean(document.querySelector('[data-connection=recovered]'))");await b.waitFor("!document.querySelector('.ds-connection-slot[data-open]')");sameBox(pageToolbar,await box(b,'.detail-page .detail-navigation'),'manual-mode connection collapse');
  await navigate({hideNotes:true},'/workbench/app/items/ticket/'+own.ticket.id);await b.waitFor("Boolean(document.querySelector('.ds-detail-view'))&&!document.querySelector('[data-skeleton]')");assert.equal(await b.evaluate("document.querySelector('.ds-detail-footer').children.length"),0,'disabled note feature keeps the original empty footer');assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.ds-detail-footer')).display"),'none','an empty wrapper must not add a blank footer');
  await navigate({emptyDetail:true},'/workbench/app/items/ticket/'+own.ticket.id);await b.waitFor("Boolean(document.querySelector('.ds-detail-view'))&&!document.querySelector('[data-skeleton]')");assert.equal(await b.evaluate("Boolean(document.querySelector('.detail-main'))"),false,'the empty activity section is absent from DOM');
  await navigate({detailFail:true},'/workbench/app/items/ticket/'+own.ticket.id);await b.waitFor("Boolean(document.querySelector('.ds-detail [data-error-size=page]'))");assert.equal(await b.evaluate("document.querySelector('button[aria-label=关闭详情]')?.checkVisibility()"),true,'page failure keeps close');await clickWorkbenchControl(b,'button[aria-label=关闭详情]');await b.waitFor(loaded);
  metrics.browser=await b.command('Browser.getVersion');
 }catch(caught){error=caught;if(browser)metrics.failure=await browser.evaluate("({text:document.body.innerText,route:location.pathname,busy:window.__busyNodes,times:window.__stateTimes})").catch(()=>null);}finally{await writeFile(join(directory,'receipt-35a-states.json'),JSON.stringify({status:error?'FAIL':'PASS',platform:platform(),release:release(),metrics,screenshots,error:error instanceof Error?error.message:null},null,2));await close(browser,error);}
},{precisionV212:true,syntheticServiceCodes:true,workbenchSearchEnabled:true,workbenchFollowEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true}));

const realtimeSeam=`(()=>{
 const Original=EventSource;window.__streams=[];window.EventSource=class extends Original{constructor(...args){super(...args);window.__streams.push(this);}};
 const real=fetch.bind(window);window.__failReads=false;window.__deniedContext=false;window.__dropNote=false;window.__retryReads=[];window.__failBoards=false;window.__attachmentReleases=new Set();window.__columnDelays=JSON.parse(sessionStorage.getItem('card35aReviewDelays')||'{}');
 window.fetch=async(input,init)=>{const path=String(input),column=path.startsWith('/api/workbench/board?')?new URL(path,location.origin).searchParams.get('column'):null;if(window.__failBoards&&column)return new Response('{"error":{"code":"CARD35A_SYNTHETIC_READ_FAILED"}}',{status:503,headers:{'content-type':'application/json'}});if(window.__failReads&&path==='/api/lifecycle/bootstrap'){window.__retryReads.push(performance.now());throw new TypeError('synthetic disconnected read');}
 if(window.__deniedContext&&(/^\\/api\\/tickets\\/[0-9a-f-]+$/.test(path)||/^\\/api\\/workbench\\/items\\/ticket\\/[0-9a-f-]+(?:[?]|$)/.test(path)))return new Response('{"error":{"code":"AUTHORIZATION_REJECTED"}}',{status:403,headers:{'content-type':'application/json'}});
 const response=await real(input,init);if(column&&window.__columnDelays[column])await new Promise(resolve=>setTimeout(resolve,window.__columnDelays[column]));
 if(window.__holdAttachments&&path.endsWith('/attachments'))await new Promise((resolve,reject)=>{const signal=init?.signal,release=()=>{signal?.removeEventListener('abort',abort);window.__attachmentReleases.delete(release);resolve();},abort=()=>{window.__attachmentReleases.delete(release);reject(new DOMException('aborted','AbortError'));};if(signal?.aborted){abort();return;}window.__attachmentReleases.add(release);signal?.addEventListener('abort',abort,{once:true});});
 if(window.__detailDelay&&/^\\/api\\/workbench\\/items\\/(ticket|review|intake)\\/[^/?]+[?]/.test(path)){const began=performance.now();await new Promise(resolve=>setTimeout(resolve,window.__detailDelay));window.__detailRefreshElapsed=performance.now()-began;}
 if(window.__dropNote&&init?.method==='POST'&&path.endsWith('/internal-notes'))throw new TypeError('synthetic unconfirmed response');return response;};
})();`;

test('Card 35A A4.6-8: five original read-only scenarios, focusable disabled tooltip, SSE collapse and bounded connection recovery',{timeout:240000},()=>withT43Fixture(async f=>{
 const directory=await evidence(),screenshots:unknown[]=[],metrics:Record<string,unknown>={},scratchDirs:string[]=[];let browser:Browser|undefined,error:unknown;
 const admin=f.staff[0],handler=f.staff[1],target=f.principals[1],adminCookie=f.browserCookies[0],handlerCookie=f.browserCookies[1];assert.ok(admin&&handler&&target&&adminCookie&&handlerCookie);
 const assigned=await start(f,await f.manualReport('35A 他人接手与转交（合成）')),own=await start(f,await f.manualReport('35A 上次操作确认（合成）'));
 const completed=await complete(admin,await start(f,await f.manualReport('35A 已完成（合成）')),'35A 内部过程（合成）');
 const dismissed=await start(f,await f.manualReport('35A 已关闭（合成）'));
 await post(admin,'/api/tickets/'+text(dismissed.id)+'/dismiss',{client_command_id:randomUUID(),expected_version:version(dismissed.version),reason_code:'FALSE_REPORT_OR_TEST',note:'35A 确认测试报修（合成）'});await f.project();
 try{
  browser=await launchStateBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[handlerCookie],certificateSpki:f.certificateSpki});assert.ok(browser);const b=browser;
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:realtimeSeam});
  const completedPreference='pc-admin:processed-group:'+target+':completed',dismissedPreference='pc-admin:processed-group:'+target+':dismissed';
  await b.evaluate(`sessionStorage.setItem(${JSON.stringify(completedPreference)},'false');sessionStorage.setItem(${JSON.stringify(dismissedPreference)},'true');sessionStorage.setItem('card35aReviewDelays',JSON.stringify({handled:1400}))`);await b.command('Page.reload');
  await b.waitFor("window.__columnDelays?.handled===1400&&Boolean(document.querySelector('.board .handled [data-skeleton]'))");
  const handledHead=await box(b,'.board .handled>.column-heading'),closedSkeleton=await box(b,'.board .handled .ds-ticket-skeleton');
  await b.waitFor("Boolean(document.querySelector('.board .handled [data-board-group=已关闭] .ticket-card'))&&!document.querySelector('[data-skeleton]')");const closedCard=await box(b,'.board .handled [data-board-group=已关闭] .ticket-card');sameBox(handledHead,await box(b,'.board .handled>.column-heading'),'folded handled board heading');assert.ok(Math.abs(closedSkeleton.y-closedCard.y)<=1,'closed first card respects the existing completed-group folding');assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.board .handled .ds-board-group-count')].map(n=>n.textContent)"),['1','1']);
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?view=list&range=all'});await b.waitFor("window.__columnDelays?.handled===1400&&Boolean(document.querySelector('#list-handled [data-skeleton]'))&&Boolean(document.querySelector('#list-active .ds-work-row[data-item-id]'))");
  const handledStage=await box(b,'#list-handled .ds-list-stage'),closedRowSkeleton=await box(b,'#list-handled .ds-work-skeleton-row');
  await b.waitFor("Boolean(document.querySelector('#list-handled .ds-work-row[data-closure-kind=DISMISSED]'))&&!document.querySelector('[data-skeleton]')");const closedRow=await box(b,'#list-handled .ds-work-row[data-closure-kind=DISMISSED]');sameBox(handledStage,await box(b,'#list-handled .ds-list-stage'),'folded handled table heading');assert.ok(Math.abs(closedRowSkeleton.y-closedRow.y)<=1,'closed first row respects the existing completed-group folding');
  metrics.closedSubgroupGeometry={board:{before:closedSkeleton.y,after:closedCard.y,delta:closedCard.y-closedSkeleton.y},list:{before:closedRowSkeleton.y,after:closedRow.y,delta:closedRow.y-closedRowSkeleton.y}};
  await b.evaluate(`sessionStorage.removeItem(${JSON.stringify(completedPreference)});sessionStorage.removeItem(${JSON.stringify(dismissedPreference)});sessionStorage.removeItem('card35aReviewDelays')`);await b.command('Page.navigate',{url:f.origin+'/workbench/app/?range=all'});

  await b.waitFor("Boolean(document.querySelector('[data-realtime-status=live]'))&&document.querySelectorAll('.ticket-card[data-item-id]').length>=3&&!document.querySelector('[data-skeleton]')");
  await clickWorkbenchControl(b,'.ticket-card[data-item-id="'+text(assigned.id)+'"] a.card-open');
  await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=assigned]'))");assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar').length"),1);assert.match(text(await b.evaluate("document.querySelector('.ds-read-only-bar').innerText")),/已接手这张工单/u);assert.equal(await b.evaluate("document.querySelector('.ds-read-only-badge')?.textContent"),'只读');
  await b.waitFor("Boolean(document.querySelector('.ds-read-only-bar [data-step-action=takeover]'))");assert.equal(await b.evaluate("document.querySelectorAll('[data-step-action=takeover]').length"),1,'the original available takeover entry appears once in the bar');
  const followUpBorders=await b.evaluate("(()=>{const region=document.querySelector('.shared-follow-up'),container=region.closest('.ds-step-workflow');return {innerTop:getComputedStyle(region).borderTopWidth,innerBottom:getComputedStyle(region).borderBottomWidth,outerBottom:getComputedStyle(container).borderBottomWidth,emptyDividers:container.querySelectorAll(':scope>hr,:scope>section:empty,:scope>div:empty').length};})()");assert.deepEqual(followUpBorders,{innerTop:'0px',innerBottom:'0px',outerBottom:'1px',emptyDividers:0},'nonempty shared follow-up has one divider, without an empty band between nested hairlines');metrics.followUpBorders=followUpBorders;
  screenshots.push(await shot(b,directory,'drawer-readonly-assigned.png'));
  const disabled='.ds-next-step [data-readonly-disabled] button';await b.evaluate(`document.querySelector(${JSON.stringify(disabled)}).focus()`);
  await b.waitFor("document.querySelector('.ds-next-step [data-tooltip-open=true] [role=tooltip]')!==null");await waitForAnimationsSettled(b,'.ds-next-step');
  assert.equal(await b.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(disabled)})`),true);assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(disabled)}).disabled`),false);assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(disabled)}).getAttribute('aria-disabled')`),'true');assert.equal(await b.evaluate("document.querySelector('.ds-next-step [role=tooltip]')?.checkVisibility()"),true);screenshots.push(await shot(b,directory,'readonly-disabled-tooltip.png'));
  await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});assert.equal(await b.evaluate("Boolean(document.querySelector('[data-readonly-reason=assigned]'))"),true,'disabled activation submits nothing');
  await b.command('Browser.grantPermissions',{origin:f.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});await clickWorkbenchControl(b,'button[aria-label=复制编号]');assert.equal(await b.evaluate('navigator.clipboard.readText()'),assigned.ticket_no);
  await b.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.disabled===false");await clickWorkbenchControl(b,'[data-action=toggle-item-follow]');await b.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.getAttribute('aria-pressed')==='true'");
  const canNext=await b.evaluate("document.querySelector('.detail-next')?.disabled===false");assert.equal(canNext,true,'next remains usable');await clickWorkbenchControl(b,'.detail-next');await b.waitFor("!document.querySelector('.detail-breadcrumb')?.textContent.includes("+JSON.stringify(text(assigned.ticket_no))+")&&Boolean(document.querySelector('.ds-detail-view'))&&!document.querySelector('.ds-detail [data-skeleton]')&&document.querySelector('.detail-previous')?.disabled===false");
  await b.evaluate('window.__holdAttachments=true');await clickWorkbenchControl(b,'.detail-previous');await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=assigned]'))&&window.__attachmentReleases.size>0&&Boolean(document.querySelector('.attachment-section [data-skeleton]'))");
  assert.equal(await b.evaluate("Boolean(document.querySelector('.detail-body'))&&!document.querySelector('.ds-detail-skeleton')"),true,'a deliberately slow initial attachment read is local, while the loaded drawer body stays mounted');
  await b.evaluate('window.__holdAttachments=false;[...window.__attachmentReleases].forEach(release=>release())');
  await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=assigned]'))&&window.__attachmentReleases.size===0&&!document.querySelector('.ds-detail [data-skeleton]')");await waitForAnimationsSettled(b);
  await b.evaluate(`(()=>{
   window.__documentToken='same-document-35a';window.__detailDelay=1000;window.__detailRefreshElapsed=0;
   const body=document.querySelector('.detail-body'),view=document.querySelector('.ds-detail-view');window.__refreshViolations=[];window.__refreshSamples=0;window.__watchRefresh=true;
   const sample=()=>{if(!window.__watchRefresh)return;window.__refreshSamples++;if(!body.isConnected||document.querySelector('.detail-body')!==body||document.querySelector('.ds-detail-view')!==view)window.__refreshViolations.push('body replaced');if(document.querySelector('.ds-detail [data-skeleton]'))window.__refreshViolations.push('skeleton appeared');if(body.dataset.refreshing&&Number(getComputedStyle(body.querySelector('.ds-state-content')).opacity)!==0.6)window.__refreshViolations.push('refresh opacity');};
   const observer=new MutationObserver(sample);observer.observe(document.querySelector('.ds-detail'),{childList:true,subtree:true,attributes:true,attributeFilter:['data-refreshing']});const frame=()=>{sample();if(window.__watchRefresh)requestAnimationFrame(frame);};requestAnimationFrame(frame);window.__stopRefreshWatch=()=>{sample();window.__watchRefresh=false;observer.disconnect();};
  })()`);
  await post(admin,'/api/tickets/'+text(assigned.id)+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version((await get(admin,'/api/tickets/'+text(assigned.id))).version),reason_code:'CARD35A_SYNTHETIC',target_principal_id:target,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});await f.project();
  await b.waitFor("Boolean(document.querySelector('.detail-body[data-refreshing]'))");assert.equal(await b.evaluate("Boolean(document.querySelector('.ds-detail [data-skeleton]'))"),false,'SSE refresh retains the drawer body');
  await b.waitFor("!document.querySelector('.ds-read-only-bar')&&Boolean(document.querySelector('.detail-heading'))&&!document.querySelector('.detail-body[data-refreshing]')&&window.__detailRefreshElapsed>=1000");assert.equal(await b.evaluate('window.__documentToken'),'same-document-35a','SSE-driven re-read collapses the reason without navigation');
  await b.evaluate('window.__stopRefreshWatch();window.__detailDelay=0');metrics.sseRefresh=await b.evaluate('({samples:window.__refreshSamples,elapsed:window.__detailRefreshElapsed,violations:window.__refreshViolations})');metrics.cpuRate=cpuRate;
  assert.deepEqual(await b.evaluate('window.__refreshViolations'),[],'the same drawer body stays mounted at 60% opacity without any skeleton throughout the slow SSE refresh');assert.ok(Number(await b.evaluate('window.__refreshSamples'))>1);
  await clickWorkbenchControl(b,'button[aria-label=关闭详情]');await b.waitFor("!document.querySelector('.detail-navigation')");
  await b.waitFor("document.querySelector('.app')?.dataset.realtimeStatus==='live'");const mainBefore=await box(b,'.workspace'),top=await box(b,'.topbar');
  assert.equal(await b.evaluate("document.querySelector('.topbar [data-realtime-status=live]')?.checkVisibility()"),true,'normal live indicator stays visible');
  await b.evaluate('window.__failBoards=true');await clickWorkbenchControl(b,'.ds-board-page-header button[aria-label=刷新]');await b.waitFor("Boolean(document.querySelector('.active .ds-stale-retry'))&&Boolean(document.querySelector('.handled .ds-stale-retry'))");
  await b.evaluate("window.__online=false;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__online});dispatchEvent(new Event('offline'))");await b.waitFor("Boolean(document.querySelector('[data-connection=offline]'))");
  assert.equal(await b.evaluate("document.querySelectorAll('.topbar [data-realtime-status]').length"),1,'existing realtime selectors remain mounted');assert.equal(await b.evaluate("document.querySelector('.topbar [data-realtime-status]')?.checkVisibility()"),false,'the connection bar is the sole persistent offline message');assert.equal(await b.evaluate("document.querySelector('.board').innerText.includes('读取未完成')"),false,'no scattered refresh-failure line remains under the cards');
  const mainDown=await box(b,'.workspace'),bar=await box(b,'.ds-connection-bar');assert.equal(mainDown.y-mainBefore.y,32);assert.equal(bar.height,32);assert.ok(bar.y>=top.y+top.height-1&&bar.y+bar.height<=mainDown.y,'connection strip occupies space below topbar');screenshots.push(await shot(b,directory,'connection-offline.png'));
  await b.evaluate("window.__failBoards=false;window.__online=true;dispatchEvent(new Event('online'))");await b.waitFor("Boolean(document.querySelector('[data-connection=recovered]'))");const recovery=Date.now();await b.waitFor("!document.querySelector('.ds-connection-slot[data-open]')");assert.ok(Date.now()-recovery>=1800,'recovered remains for two seconds');sameBox(mainBefore,await box(b,'.workspace'),'connection collapse');
  await b.waitFor("document.querySelector('.app')?.dataset.realtimeStatus==='live'");assert.equal(await b.evaluate("document.querySelector('.topbar [data-realtime-status=live]')?.checkVisibility()"),true,'normal live label returns with recovery');
  // The original SSE error first checks GET; that failed read starts three retries at 1s/3s/8s.
  await b.evaluate("window.__failReads=true;window.__retryReads=[];window.__streams.at(-1).dispatchEvent(new Event('error'))");await b.waitFor('window.__retryReads.length===4',{timeoutMs:20000});
  const attempts=await b.evaluate('window.__retryReads') as number[];assert.ok((attempts[1]??0)-(attempts[0]??0)>=900);assert.ok((attempts[2]??0)-(attempts[1]??0)>=2900);assert.ok((attempts[3]??0)-(attempts[2]??0)>=7900);metrics.retries={initialFailedRead:attempts[0],retryReads:attempts.slice(1),intervals:attempts.slice(1).map((value,index)=>value-(attempts[index]??0))};
  await b.waitFor("Boolean(document.querySelector('[data-connection=stale]'))",{timeoutMs:65000});assert.equal(await b.evaluate('window.__retryReads.length'),4,'one failed read plus three retries; automatic retries then stop');assert.equal(await b.evaluate("document.querySelector('.topbar [data-realtime-status]')?.checkVisibility()"),false,'stale messaging is also unique');screenshots.push(await shot(b,directory,'connection-stale.png'));
  await b.evaluate('window.__failReads=false');await clickWorkbenchControl(b,'[data-connection=stale] button');await b.waitFor("Boolean(document.querySelector('[data-connection=recovered]'))");await b.waitFor("!document.querySelector('.ds-connection-slot[data-open]')");
  await b.command('Network.setCookies',{cookies:[adminCookie]});
  const open=async(id:string)=>{await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id+'?range=all'});await b.waitFor("Boolean(document.querySelector('.ds-detail-view'))&&!document.querySelector('[data-skeleton]')");};
  await open(text(completed.id));await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=completed]'))");assert.match(text(await b.evaluate("document.querySelector('.ds-read-only-bar').innerText")),/已完成 · 如需继续处理，先重开/u);assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar').length"),1);assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-read-only-bar button')].some(button=>button.textContent.includes('重开'))"),true,'original permitted reopen action is in the bar');screenshots.push(await shot(b,directory,'drawer-readonly-completed.png'));
  await open(text(dismissed.id));await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=dismissed]'))");assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar').length"),1);assert.match(text(await b.evaluate("document.querySelector('.ds-read-only-bar').innerText")),/已关闭 · 如需继续处理，先恢复/u);assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar button').length"),0,'no duplicate restore');assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-next-step button')].filter(button=>button.textContent==='恢复').length"),1);screenshots.push(await shot(b,directory,'drawer-readonly-dismissed.png'));
  await open(text(own.id));await b.evaluate('window.__deniedContext=true');await b.evaluate("[...document.querySelectorAll('.ds-note-actions button')].find(button=>button.textContent.includes('刷新可用操作'))?.click()");
  // Keep the controlled denial consistent for the context and detail re-reads; a permitted 200 must not replace this scenario.
  // The original 403 path removes sensitive detail. The neutral bar does not retain a revoked body.
  await b.waitFor("Boolean(document.querySelector('.ds-detail [data-error-size=page]'))&&!document.querySelector('.ds-detail-view')");assert.equal(await b.evaluate("document.querySelectorAll('.ds-detail .detail-heading,.ds-detail .ds-detail-footer,.ds-detail .detail-assignment-dialog').length"),0,'the original draft-revocation 404 normalization cannot retain sensitive body or editors');
  await open(text(own.id));await b.waitFor("Boolean(document.querySelector('.ds-detail-footer textarea:not([readonly])'))");await clickWorkbenchControl(b,'.ds-detail-footer textarea:not([readonly])');await b.command('Input.insertText',{text:'35A 保留原操作以核对（合成）'});await b.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿已保存')");
  await b.evaluate('window.__dropNote=true');await clickWorkbenchControl(b,'[data-action=save-internal-note]');await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=pending]'))");assert.match(text(await b.evaluate("document.querySelector('.ds-read-only-bar').innerText")),/暂时只能查看 · 上次操作的结果还在确认/u);assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar').length"),1);assert.equal(await b.evaluate("document.querySelector('[data-action=save-internal-note]')?.getAttribute('aria-disabled')"),'true');screenshots.push(await shot(b,directory,'drawer-readonly-pending.png'));
  // The original valid note only offers same-operation replay. Do not invent a read-only receipt action under another label.
  assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar button').length"),0,'pending note without an original read-only check does not get a fabricated action');
  await b.evaluate('window.__dropNote=false');await clickWorkbenchControl(b,'[data-action=check-internal-note]');await b.waitFor("!document.querySelector('[data-readonly-reason=pending]')");metrics.browser=await b.command('Browser.getVersion');
  // Export artboard 07 through Chrome. These are reference screenshots, not generated visual baselines.
  const sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
  const packed=await readFile(resolve(sourceRoot,'docs/ui/prototype/医小修 PC 管理端 v2.2.7 设计原型.html'),'utf8');
  const manifest=/<script type="__bundler\/manifest">\s*([\s\S]*?)<\/script>/u.exec(packed)?.[1];assert.ok(manifest);
  const assets=JSON.parse(manifest) as Record<string,{data:string}>;const asset=assets['d52d8f8a-c915-441e-9f6c-93e1ad62c37c'];assert.ok(asset);
  const nested=gunzipSync(Buffer.from(asset.data,'base64')).toString('utf8');const template=/<script type="__bundler\/template">\s*([\s\S]*?)<\/script>/u.exec(nested)?.[1];assert.ok(template);
  const scratch=await mkdtemp(join(tmpdir(),'card35a-artboard-')),html=join(scratch,'artboard.html');scratchDirs.push(scratch);
  let artboard=JSON.parse(template) as string;
  const embedded=/<script type="__bundler\/manifest">\s*([\s\S]*?)<\/script>/u.exec(nested)?.[1];assert.ok(embedded);
  const fonts=JSON.parse(embedded) as Record<string,{mime:string;data:string;compressed:boolean}>;
  for(const [id,font] of Object.entries(fonts))if(font.mime==='font/woff2'){const bytes=font.compressed?gunzipSync(Buffer.from(font.data,'base64')):Buffer.from(font.data,'base64');artboard=artboard.replaceAll(id,'data:font/woff2;base64,'+bytes.toString('base64'));}
  await writeFile(html,artboard);
  await b.command('Network.enable');await b.command('Network.setBlockedURLs',{urls:['https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
  metrics.referenceFonts='Saved Inter assets; system Chinese fallback. External Google fonts are blocked for an offline reference export.';
  await b.command('Page.navigate',{url:pathToFileURL(html).href});await b.waitFor("document.body?.innerText.includes('只读条固定在工具栏下方')");await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:2150,deviceScaleFactor:1,mobile:false});screenshots.push(await shot(b,directory,'artboard-07.png'));
  const sections=await b.evaluate("[...document.querySelectorAll('h2')].filter(node=>['加载','空','错误','只读'].includes(node.textContent.trim())).map(node=>({name:node.textContent.trim(),top:node.getBoundingClientRect().top+scrollY}))") as {name:string;top:number}[];
  assert.equal(sections.length,4,'all four original artboard sections are exported');
  for(const [index,section] of sections.entries()){
    const y=Math.max(0,section.top-12),next=sections[index+1]?.top??2150,height=Math.min(2150-y,next-y-12);
    const capture=await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y,width:1440,height,scale:1}}) as {data:string};
    const name='artboard-07-'+['loading','empty','error','readonly'][index]+'.png';await writeFile(join(directory,name),Buffer.from(capture.data,'base64'));
  }
 }catch(caught){error=caught;if(browser)metrics.failure=await browser.evaluate("({text:document.body.innerText,route:location.pathname,busy:window.__busyNodes,times:window.__stateTimes})").catch(()=>null);}finally{await writeFile(join(directory,'receipt-35a-readonly-connection.json'),JSON.stringify({status:error?'FAIL':'PASS',platform:platform(),release:release(),metrics,screenshots,error:error instanceof Error?error.message:null},null,2));await close(browser,error);for(const scratch of scratchDirs)await rm(scratch,{recursive:true});}
}));

test('Card 35A A4.7: an initial explicit read denial shows the unique permission bar without retaining content',{timeout:60000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=await evidence();let browser:Browser|undefined,error:unknown;
 try{
  const cookie=f.browserCookies[0],item=f.tickets[0];assert.ok(cookie&&item);
  browser=await launchStateBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,cookies:[cookie]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:fakeEndpoint});await b.evaluate("sessionStorage.setItem('card35a',JSON.stringify({detailForbidden:true}))");
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+item.ticket.id});
  await b.waitFor("Boolean(document.querySelector('[data-readonly-reason=permission]'))&&Boolean(document.querySelector('[data-error-size=page]'))&&!document.querySelector('[data-skeleton]')");
  assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar').length"),1);assert.equal(await b.evaluate("document.querySelectorAll('.ds-read-only-bar button').length"),0);
  assert.match(text(await b.evaluate("document.querySelector('.ds-read-only-bar').innerText")),/只能查看 · 你的账号没有处理这类工单的权限/u);
  assert.equal(await b.evaluate("document.querySelector('.ds-read-only-badge')?.textContent"),'只读');assert.equal(await b.evaluate("Boolean(document.querySelector('.ds-detail-view'))"),false);
  const screenshot=await shot(b,directory,'drawer-readonly-permission.png');await writeFile(join(directory,'receipt-35a-permission.json'),JSON.stringify({status:'PASS',screenshot},null,2));
 }catch(caught){error=caught;await writeFile(join(directory,'receipt-35a-permission.json'),JSON.stringify({status:'FAIL',error:String(caught)},null,2));}finally{await close(browser,error);}
},{precisionV212:true}));

test('Card 35A option A: unavailable live stream keeps healthy reads on the 5s cadence beyond 12s without a connection bar',{timeout:60000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=await evidence();let browser:Browser|undefined,error:unknown;const metrics:Record<string,unknown>={};
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);
  browser=await launchStateBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[cookie]});assert.ok(browser);const b=browser;
  await b.waitFor("document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   window.__liveOnlyUnavailable=true;window.__bootstrapTimes=[];window.__healthyBoardReads=[];window.__connectionNoticeSeen=false;window.__sourceAttempts=0;
   const Original=EventSource;window.EventSource=class extends Original{constructor(...args){super(...args);window.__sourceAttempts++;}};
   new MutationObserver(()=>{if(document.querySelector('.ds-connection-slot[data-open]'))window.__connectionNoticeSeen=true;}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-open']});
   const real=fetch.bind(window);window.fetch=async(input,init)=>{const path=String(input);if(path==='/api/lifecycle/bootstrap')window.__bootstrapTimes.push(performance.now());const response=await real(input,init);if(path.startsWith('/api/workbench/board?'))window.__healthyBoardReads.push({time:performance.now(),status:response.status});if(path==='/api/lifecycle/bootstrap'&&window.__liveOnlyUnavailable){const body=await response.clone().json();body.realtime_sse_available=false;return new Response(JSON.stringify(body),{status:200,headers:response.headers});}return response;};
  })()`});await b.command('Page.reload');
  await b.waitFor("window.__liveOnlyUnavailable&&document.querySelector('.app')?.dataset.realtimeStatus==='polling'&&document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  assert.equal(await b.evaluate("document.querySelector('.topbar [data-realtime-status=polling]')?.checkVisibility()"),true,'main polling label stays visible');assert.match(text(await b.evaluate("document.querySelector('.topbar [data-realtime-status=polling]')?.textContent")),/实时暂不可用，定时重读/u);assert.equal(await b.evaluate('window.__connectionNoticeSeen'),false,'live-only unavailability never announces a disconnected network');
  await b.waitFor('window.__bootstrapTimes.length>=4&&window.__healthyBoardReads.length>=12',{timeoutMs:22000});
  const times=await b.evaluate('window.__bootstrapTimes') as number[];assert.equal(times.length,4,'one initial bootstrap and three coalesced 5s refreshes');assert.ok((times[3]??0)-(times[0]??0)>=15000,'healthy reads continue after the 12s failure budget');
  const intervals=times.slice(1).map((time,index)=>time-(times[index]??0));assert.ok(intervals.every(value=>value>=5000),'the existing 5s cadence is retained '+JSON.stringify(intervals));
  assert.equal(await b.evaluate('window.__healthyBoardReads.every(row=>row.status===200)'),true);assert.equal(await b.evaluate('window.__sourceAttempts'),0,'server-declared unavailability does not create another transport');assert.equal(await b.evaluate('window.__connectionNoticeSeen'),false);assert.equal(await b.evaluate("Boolean(document.querySelector('.ds-connection-slot[data-open]'))"),false);
  metrics.bootstrapTimes=times;metrics.intervals=intervals;metrics.boardReads=await b.evaluate('window.__healthyBoardReads');metrics.pollingScreenshot=await shot(b,directory,'connection-polling-healthy.png');
  await b.evaluate('window.__liveOnlyUnavailable=false');await b.waitFor("document.querySelector('.app')?.dataset.realtimeStatus==='live'",{timeoutMs:12000});assert.equal(await b.evaluate('window.__sourceAttempts'),1,'a fresh read admits the existing live transport when it becomes available');assert.equal(await b.evaluate('window.__connectionNoticeSeen'),false,'returning to live after healthy polling is not network recovery');metrics.browser=await b.command('Browser.getVersion');
 }catch(caught){error=caught;if(browser)metrics.failure=await browser.evaluate('({text:document.body.innerText,times:window.__bootstrapTimes,reads:window.__healthyBoardReads,notice:window.__connectionNoticeSeen})').catch(()=>null);}finally{await writeFile(join(directory,'receipt-35a-healthy-polling.json'),JSON.stringify({status:error?'FAIL':'PASS',metrics,error:error instanceof Error?error.message:null},null,2));await close(browser,error);}
},{precisionV212:true,syntheticServiceCodes:true,workbenchFollowEnabled:true,workbenchRealtimeEnabled:true}));

test('Card 35A backoff hints invalidate an open search through recovery without an extra read or automatic search restart',{timeout:60000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=await evidence(),metrics:Record<string,unknown>={};let browser:Browser|undefined,error:unknown;
 try{
  const cookie=f.browserCookies[0],ticket=f.tickets[0];assert.ok(cookie&&ticket);
  browser=await launchStateBrowser({url:f.origin+'/health',width:1440,height:1000,cookies:[cookie]});assert.ok(browser);const b=browser;
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   const Native=EventSource,real=fetch.bind(window);window.__backoffStreams=[];window.__failCore=false;window.__coreReads=[];window.__searchReads=0;window.__businessPosts=0;window.__emptySearch=false;
   window.EventSource=class extends Native{constructor(...args){super(...args);window.__backoffStreams.push(this);}};
   window.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);
    if(url.pathname==='/api/workbench/search')window.__searchReads++;
    if(init?.method==='POST'&&url.pathname.startsWith('/api/tickets/'))window.__businessPosts++;
    if(url.pathname==='/api/lifecycle/bootstrap'){window.__coreReads.push({at:performance.now(),failed:window.__failCore});if(window.__failCore)throw new TypeError('35A synthetic read failure');}
    const response=await real(input,init);if(window.__emptySearch&&url.pathname==='/api/workbench/search'&&response.ok){const body=await response.json();return Response.json({...body,items:[],next_cursor:null});}return response;
   };
  })()`});
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?range=all'});
  await b.waitFor("document.querySelector('.app')?.dataset.realtimeStatus==='live'&&document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  await b.evaluate("document.querySelector('form[aria-label=\"搜索全部获权事项\"]').requestSubmit()");
  await b.waitFor("new URLSearchParams(location.search).get('search')==='1'&&window.__searchReads===1&&Boolean(document.querySelector('.workbench-search [data-action=leave-workbench-search]'))&&document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  const searchReads=await b.evaluate('window.__searchReads');assert.equal(searchReads,1);
  await b.evaluate("window.__coreReads=[];window.__failCore=true;window.__backoffStreams.at(-1).dispatchEvent(new Event('error'))");
  await b.waitFor("window.__coreReads.length===1&&document.querySelector('.app')?.dataset.realtimeStatus==='offline'");
  assert.equal(await b.evaluate('window.__backoffStreams.at(-1).readyState'),1,'REST failed while the existing native stream remains connected');
  const data=JSON.stringify({event_id:'9007199254740993',event_type:'ticket.updated',aggregate_type:'TICKET',aggregate_id:ticket.ticket.id,aggregate_version:'3',visibility_scope:'WORKBENCH',payload:{note:'35A 退避提示（合成）'},occurred_at:'2026-11-18 12:00:00',created_at:'2026-11-18 12:00:00'});
  await b.evaluate(`window.__backoffStreams.at(-1).dispatchEvent(new MessageEvent('ticket.updated',{data:${JSON.stringify(data)}}))`);
  const notice="document.querySelector('[data-search-refresh-required]')?.textContent.includes('事项资料已变化，请重新提交搜索或点击刷新。')";
  await b.waitFor(notice);assert.equal(await b.evaluate('window.__coreReads.length'),1,'the backoff hint does not trigger an immediate business read');
  assert.equal(await b.evaluate("document.querySelector('[data-search-state=error]')?.getAttribute('role')"),'alert');
  assert.equal(await b.evaluate("document.querySelector('[data-search-state=error]')?.textContent"),'查询未完成，请重新读取。搜索输入仍保留。','the main search error copy and alert semantics are preserved');
  assert.equal(await b.evaluate("document.querySelectorAll('.ticket-card[data-item-id]').length"),0,'an invalidated search cannot retain pre-event cards');
  await b.evaluate('window.__failCore=false');await b.waitFor("document.querySelector('.app')?.dataset.realtimeStatus==='live'");
  const reads=await b.evaluate('window.__coreReads') as {at:number;failed:boolean}[];assert.equal(reads.length,2);assert.equal(reads[0]?.failed,true);assert.equal(reads[1]?.failed,false);assert.ok((reads[1]?.at??0)-(reads[0]?.at??0)>=1000,'recovery waits for the admitted one-second retry');metrics.reads=reads;
  assert.equal(await b.evaluate(notice),true,'the refresh-required notice survives successful recovery');assert.equal(await b.evaluate('window.__searchReads'),searchReads,'recovery must not silently restart a search');
  metrics.screenshot=await shot(b,directory,'search-backoff-refresh-required.png');metrics.cpuRate=cpuRate;
  await clickWorkbenchControl(b,'.ds-board-page-header button[aria-label=刷新]');
  await b.waitFor("!document.querySelector('[data-search-state=error]')&&document.querySelectorAll('.ticket-card[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  assert.equal(await b.evaluate('window.__searchReads'),Number(searchReads)+1,'only the explicit user refresh restarts search');assert.equal(await b.evaluate('window.__businessPosts'),0);assert.equal(await b.evaluate('window.__backoffStreams.length'),1);
  await b.evaluate("window.__emptySearch=true;history.pushState(history.state,'','?search=1&view=list&range=custom&scope=related&handled_from=2026-11-18&handled_to=2026-11-18&q='+encodeURIComponent('35A 空态（合成）'));dispatchEvent(new PopStateEvent('popstate',{state:history.state}))");
  const emptyReady="Boolean(document.querySelector('[data-search-state=empty]'))&&document.querySelectorAll('.ds-work-table thead').length===1&&[...document.querySelectorAll('.ds-list-empty')].filter(n=>n.checkVisibility()).length===3&&!document.querySelector('[data-skeleton]')";
  await b.waitFor(emptyReady);assert.equal(await b.evaluate("document.querySelector('[data-search-state=empty] h2')?.textContent"),'当前没有符合这些条件的可见事项。');
  assert.equal(await b.evaluate("document.querySelector('[data-search-state=empty]')?.getAttribute('role')"),'status');assert.equal(await b.evaluate("document.querySelector('[data-search-state=empty]')?.dataset.size"),'page');
  metrics.filteredEmpty=await shot(b,directory,'search-empty-filtered.png');
  await b.evaluate('window.__emptySearch=false');await clickWorkbenchControl(b,'[data-search-state=empty] button');
  await b.waitFor("!new URLSearchParams(location.search).has('search')&&document.querySelectorAll('.ds-work-row[data-item-id]').length>3&&!document.querySelector('[data-skeleton]')");
  assert.deepEqual(await b.evaluate("[...new URLSearchParams(location.search)].sort()"),[['range','all'],['scope','team'],['view','list']],'clear search removes criteria and custom dates, resets range/scope, and retains only the chosen view');
  await b.evaluate("window.__emptySearch=true;history.pushState(history.state,'','?search=1&view=list&range=all&scope=team');dispatchEvent(new PopStateEvent('popstate',{state:history.state}))");
  await b.waitFor(emptyReady);assert.equal(await b.evaluate("document.querySelector('[data-search-state=empty] h2')?.textContent"),'当前没有可见的事项。');assert.equal(await b.evaluate("document.querySelectorAll('[data-search-state=empty] button').length"),0,'unfiltered search keeps main behaviour without a misleading clear action');
  metrics.unfilteredEmpty=await shot(b,directory,'search-empty-unfiltered.png');assert.equal(await b.evaluate('window.__businessPosts'),0);
 }catch(caught){error=caught;if(browser)metrics.failure=await browser.evaluate('({text:document.body.innerText,reads:window.__coreReads,searchReads:window.__searchReads,status:document.querySelector(".app")?.dataset.realtimeStatus})').catch(()=>null);}
 finally{await writeFile(join(directory,'receipt-35a-backoff-search.json'),JSON.stringify({status:error?'FAIL':'PASS',metrics,error:error instanceof Error?error.message:null},null,2));await close(browser,error);}
},{precisionV212:true,syntheticServiceCodes:true,workbenchFollowEnabled:true,workbenchRealtimeEnabled:true,workbenchSearchEnabled:true,manualProjection:true}));

test('Card 35A connection scheduler uses one timer, exactly three retries, manual restart and denial disposal',async()=>{
 const {createWorkbenchRealtimeClient}=await import('../app/pc-admin/src/realtime/workbench-realtime-client.mjs');
 const timers=new Map<number,{callback:()=>void;delay:number}>();let serial=0,now=0,reads=0,denied=false;
 const reports:{status:string;retryCount?:number;disconnectedAt?:number|null}[]=[];
 const capability={realtime_sse_enabled:true,realtime_sse_available:false,sse_endpoint:'/api/realtime/events?scope=workbench' as const,polling_interval_ms:5000,expires_epoch_ms:'1800000000000',authorization_revision:null};
 const client=createWorkbenchRealtimeClient({capability,retryDelays:[1000,3000,8000],connect:()=>{throw Error('no stream while unavailable');},refresh:async()=>{reads++;throw Error(denied?'denied':'offline');},authorizationDenied:error=>error instanceof Error&&error.message==='denied',report:state=>reports.push(state),now:()=>now,schedule:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});assert.ok(timers.size<=1,'one transport timer');return id;},cancel:handle=>timers.delete(handle as number)});
 try{
  client.refresh();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);
  for(const delay of [1000,3000,8000]){assert.equal(timers.size,1);const [id,timer]=[...timers][0]??[];assert.ok(id!==undefined&&timer);assert.equal(timer.delay,delay);timers.delete(id);now+=delay;timer.callback();await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(reads,4);assert.equal(timers.size,0);assert.equal(reports.at(-1)?.retryCount,3);
  denied=true;client.refresh();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,5);assert.equal(reports.at(-1)?.status,'auth-blocked');assert.equal(timers.size,0);
 }finally{client.dispose();assert.equal(timers.size,0);}
});

test('Card 35A native reconnect events cannot reset or bypass the bounded read budget',async()=>{
 const {createWorkbenchRealtimeClient}=await import('../app/pc-admin/src/realtime/workbench-realtime-client.mjs');
 const timers=new Map<number,{callback:()=>void;delay:number}>(),listeners=new Map<string,()=>void>();let serial=0,now=0,reads=0,closes=0;
 const capability={realtime_sse_enabled:true,realtime_sse_available:true,sse_endpoint:'/api/realtime/events?scope=workbench' as const,polling_interval_ms:5000,expires_epoch_ms:'1800000000000',authorization_revision:null};
 const client=createWorkbenchRealtimeClient({capability,retryDelays:[1000,3000,8000],connect:()=>({state:()=>0,close:()=>{closes++;},listen:(name,callback)=>{listeners.set(name,()=>callback({data:''}));return()=>{listeners.delete(name);};}}),refresh:async()=>{reads++;throw Error('synthetic disconnected read');},authorizationDenied:()=>false,report:()=>{},now:()=>now,schedule:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});assert.ok(timers.size<=1);return id;},cancel:handle=>timers.delete(handle as number)});
 try{
  listeners.get('error')?.();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1,'the original immediate GET failure starts the retry budget');
  for(const delay of [1000,3000,8000]){
   const [id,timer]=[...timers][0]??[];assert.ok(id!==undefined&&timer);assert.equal(timer.delay,delay);const previousReads:number=reads;
   listeners.get('error')?.();listeners.get('open')?.();listeners.get('error')?.();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(reads,previousReads,'native events wait for the admitted retry');assert.equal([...timers][0]?.[0],id,'native events preserve the original deadline');
   timers.delete(id);now+=delay;timer.callback();await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(reads,4);assert.equal(timers.size,0);assert.equal(closes,1,'close the reconnecting source when the read budget is exhausted');
 }finally{client.dispose();assert.equal(timers.size,0);}
});

test('Card 35A option A: one scheduler polls successful reads for 65s under unavailable or CLOSED live transport, and clears a previous read failure',async()=>{
 const {createWorkbenchRealtimeClient}=await import('../app/pc-admin/src/realtime/workbench-realtime-client.mjs');
 const cases:Record<string,unknown>[]=[];
 for(const scenario of ['server-unavailable','terminal-closed','read-recovered','read-timeout-recovered']){
  const timers=new Map<unknown,{callback:()=>void;delay:number}>(),streams:{emit:(name:string)=>void}[]=[],signals:AbortSignal[]=[];let serial=0,now=0,reads=0,failed=scenario==='read-recovered',available=scenario==='terminal-closed',admit=false;
  let last:{status:string;lastReadAt:number|null;retryCount?:number;disconnectedAt?:number|null}|undefined;
  const capability={realtime_sse_enabled:true,realtime_sse_available:available,sse_endpoint:'/api/realtime/events?scope=workbench' as const,polling_interval_ms:5000,expires_epoch_ms:'1800000000000',authorization_revision:null};
  const client=createWorkbenchRealtimeClient({capability,retryDelays:[1000,3000,8000],connect:()=>{const listeners=new Map<string,()=>void>();let state=admit?1:2;streams.push({emit:name=>listeners.get(name)?.()});return {state:()=>state,close:()=>{state=2;listeners.clear();},listen:(name,listener)=>{listeners.set(name,()=>listener({data:''}));return()=>{listeners.delete(name);};}};},refresh:async signal=>{signals.push(signal);reads++;if(scenario==='read-timeout-recovered'&&reads===1)return new Promise<{available:boolean}>(()=>{});if(failed)throw Error('synthetic failed authorized read');return {available};},authorizationDenied:()=>false,report:value=>{last=value;},now:()=>now,schedule:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});assert.ok(timers.size<=1,'one timer also owns the read deadline');return id;},cancel:handle=>timers.delete(handle)});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const advance=async(delay:number)=>{assert.equal(timers.size,1);const entry=[...timers][0];assert.ok(entry);const [id,timer]=entry;assert.equal(timer.delay,delay);timers.delete(id);now+=delay;timer.callback();await flush();};
  try{
   if(scenario==='terminal-closed'){streams.at(-1)?.emit('error');await flush();assert.equal(reads,1,'main immediately verifies GET after a terminal stream error');}
   if(scenario==='read-timeout-recovered'){client.refresh();await flush();await advance(5000);assert.equal(signals[0]?.aborted,true,'the original read deadline aborts a timed-out cycle');assert.equal(last?.status,'offline');assert.equal([...timers.values()][0]?.delay,1000,'only an actual read timeout starts the 1s retry');await advance(1000);assert.equal(last?.disconnectedAt,null);}
   if(failed){client.refresh();await flush();assert.equal(last?.status,'offline');failed=false;await advance(1000);assert.equal(last?.retryCount,0,'a successful read clears the budget even when live remains unavailable');}
   for(let i=0;i<13;i++){
    await advance(5000);if(scenario==='terminal-closed'){const before=streams.length;streams.at(-1)?.emit('error');await flush();assert.equal(streams.length,before,'terminal source callbacks cannot create an immediate reconnect loop');}
    assert.equal(last?.status,'polling');assert.equal(last?.retryCount,0);assert.equal(last?.disconnectedAt,null);
   }
   assert.ok(now>=65000);assert.ok(reads>=13);assert.equal([...timers.values()][0]?.delay,5000);cases.push({scenario,elapsed:now,reads,nextDelay:5000,retryCount:last?.retryCount,disconnectedAt:last?.disconnectedAt});
   available=true;admit=true;await advance(5000);streams.at(-1)?.emit('open');await flush();assert.equal(last?.status,'live','the original transport returns to live after an admitted read');
  }finally{client.dispose();assert.equal(timers.size,0);}
 }
 await writeFile(join(await evidence(),'receipt-35a-healthy-polling-unit.json'),JSON.stringify({status:'PASS',cases},null,2));
});
