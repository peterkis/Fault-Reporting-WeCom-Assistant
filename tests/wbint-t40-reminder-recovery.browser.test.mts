import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT40ReminderRiskFixture,object,text} from './helpers/t40-reminder-risk-fixture.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
// Observers forward native Web Locks, Web Audio, fetch and timers. Controlled visibility/Date sensors are labeled, never hardware evidence.
const observer=`(()=>{
  const m=globalThis.__t40Risk={reads:[],acquired:0,released:0,acquireReads:[],starts:0,closedAudio:0,clusters:0,cancelledClusters:0,posts:0,offset:0,visible:document.visibilityState};
  const now=Date.now;Date.now=()=>now()+m.offset;
  globalThis.__t40Visibility=value=>{m.visible=value;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>m.visible});document.dispatchEvent(new Event('visibilitychange'));};
  const fetch=globalThis.fetch;globalThis.fetch=async function(input,options){
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&method==='POST')m.posts++;
    if(url.origin===location.origin&&url.pathname==='/api/workbench/reminders')m.reads.push({baseline:!url.searchParams.has('after_event_id')});
    return Reflect.apply(fetch,this,[input,options]);
  };
  if(navigator.locks){const request=navigator.locks.request.bind(navigator.locks);navigator.locks.request=function(name,options,callback){
    if(!String(name).startsWith('wbint-reminders-'))return request(name,options,callback);
    return request(name,options,async lock=>{if(lock){m.acquired++;m.acquireReads.push(m.reads.length);}try{return await callback(lock);}finally{if(lock)m.released++;}});
  };}
  for(const [owner,key] of [[globalThis.AudioContext?.prototype,'close'],[globalThis.AudioScheduledSourceNode?.prototype,'start']]){
    const original=owner?.[key];if(typeof original!=='function')continue;owner[key]=function(...args){if(key==='close')m.closedAudio++;else m.starts++;return Reflect.apply(original,this,args);};
  }
  const timers=new Set(),timeout=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
  window.setTimeout=function(callback,ms,...args){const id=timeout(callback,ms,...args);if(ms===750){timers.add(id);m.clusters++;}return id;};
  window.clearTimeout=function(id){if(timers.delete(id))m.cancelledClusters++;return clear(id);};
})()`;
async function evaluate(browser:Browser,expression:string,sessionId:string|null=null):Promise<unknown>{
  if(sessionId===null)return browser.evaluate(expression);
  const response=object(await browser.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId));
  assert.equal(response.exceptionDetails,undefined,JSON.stringify(response.exceptionDetails));return object(response.result).value;
}
async function wait(browser:Browser,expression:string,sessionId:string){
  const until=performance.now()+30_000;while(performance.now()<until){if(await evaluate(browser,expression,sessionId))return;await delay(25);}throw Error('T40_PEER_CONDITION_TIMEOUT: '+expression);
}
async function click(browser:Browser,selector:string,sessionId:string|null=null){
  const box=object(await evaluate(browser,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('T40_CLICK_TARGET_MISSING');const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,sessionId));
  assert.equal(typeof box.x,'number');assert.equal(typeof box.y,'number');
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1},sessionId);
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x,y:box.y,button:'left',clickCount:1},sessionId);
}
async function launch(f:{origin:string;browserCookie:{name:string;value:string;url:string}},path='/workbench/app/'){
  const browser=await launchSystemBrowser({url:f.origin+'/api/lifecycle/bootstrap',width:1280,height:900,cookies:[f.browserCookie]});assert.ok(browser);
  try{await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observer+';__t40Visibility("visible");'});await browser.command('Page.navigate',{url:f.origin+path});
    await browser.waitFor('Boolean(document.querySelector(\'[data-realtime-status="live"]\')&&document.querySelector(\'[data-reminders-ready="true"]\'))');return browser;
  }catch(error){await browser.close();throw error;}
}
async function close(browser:Browser|undefined,primary:unknown){await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}

test('T40 hidden leader cancels its pending cluster, a real queued document takes over, recovery rebaselines and empty refresh expires old visuals',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  let browser:Browser|undefined,peerId:string|undefined,primary:unknown;
  try{
    browser=await launch(f);await click(browser,'button[aria-label="提醒偏好"]');
    await browser.waitFor('Boolean(document.querySelector(\'[role="dialog"][aria-label="本浏览器提醒偏好"][open]\'))');
    await click(browser,'input[aria-label="开启声音提醒"]');await click(browser,'button[aria-label="关闭提醒偏好"]');
    await browser.waitFor('globalThis.__t40Risk.acquired===1&&globalThis.__t40Risk.reads.slice(globalThis.__t40Risk.acquireReads[0]).some(x=>x.baseline)');
    peerId=text(object(await browser.command('Target.createTarget',{url:'about:blank'})).targetId);
    const peerSession=text(object(await browser.command('Target.attachToTarget',{targetId:peerId,flatten:true})).sessionId);
    await browser.command('Page.enable',{},peerSession);await browser.command('Runtime.enable',{},peerSession);
    await browser.command('Emulation.setDeviceMetricsOverride',{width:600,height:700,deviceScaleFactor:1,mobile:false},peerSession);
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observer+';__t40Visibility("visible");'},peerSession);
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'},peerSession);
    await wait(browser,'Boolean(document.querySelector(\'[data-reminders-ready="true"]\')&&globalThis.__t40Risk)',peerSession);
    await click(browser,'button[aria-label="提醒偏好"]',peerSession);await click(browser,'input[aria-label="开启声音提醒"]',peerSession);await click(browser,'button[aria-label="关闭提醒偏好"]',peerSession);
    await wait(browser,'Boolean(document.querySelector(\'input[aria-label="开启声音提醒"]\').checked)',peerSession);
    await browser.waitFor('(async()=>{const state=await navigator.locks.query();return state.held.filter(x=>x.name.startsWith("wbint-reminders-")).length===1&&state.pending.filter(x=>x.name.startsWith("wbint-reminders-")).length===1;})()');
    const waiting=object(await browser.evaluate('(async()=>{const state=await navigator.locks.query();return {held:state.held.filter(x=>x.name.startsWith("wbint-reminders-")).length,pending:state.pending.filter(x=>x.name.startsWith("wbint-reminders-")).length};})()'));
    assert.equal(waiting.held,1);assert.equal(waiting.pending,1,'one native queued request must survive an unavailable leader lock');
    assert.equal(await evaluate(browser,'__t40Risk.acquired',peerSession),0);
    await browser.evaluate('globalThis.__t40BeforeCluster=globalThis.__t40Risk.clusters');
    assert.deepEqual(await f.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
    await browser.waitFor('globalThis.__t40Risk.clusters>globalThis.__t40BeforeCluster');
    const starts=await browser.evaluate('globalThis.__t40Risk.starts');await browser.evaluate('globalThis.__t40Visibility("hidden")');
    await browser.waitFor('globalThis.__t40Risk.released===1');
    await wait(browser,'__t40Risk.acquired===1&&__t40Risk.reads.slice(__t40Risk.acquireReads[0]).some(x=>x.baseline)',peerSession);
    await delay(900);assert.equal(await browser.evaluate('globalThis.__t40Risk.starts'),starts,'hidden cluster cannot invoke a late oscillator start');
    assert.ok(Number(await browser.evaluate('globalThis.__t40Risk.closedAudio'))>0);assert.ok(Number(await browser.evaluate('globalThis.__t40Risk.cancelledClusters'))>0);
    await f.nextDue();const reads=Number(await browser.evaluate('globalThis.__t40Risk.reads.length'));
    await browser.evaluate('globalThis.__t40Visibility("visible")');
    await browser.waitFor(`globalThis.__t40Risk.reads.length>${reads}`);assert.equal(await browser.evaluate(`globalThis.__t40Risk.reads[${reads}].baseline`),true,'visible recovery starts at a new baseline before any backlog eligibility');
    await browser.command('Target.closeTarget',{targetId:peerId});peerId=undefined;
    await browser.waitFor('globalThis.__t40Risk.acquired===2&&globalThis.__t40Risk.reads.slice(globalThis.__t40Risk.acquireReads[1]).some(x=>x.baseline)');
    await f.nextDue();await browser.waitFor('Boolean(document.querySelector("[data-reminder-id]"))');
    const before=await f.currentFacts();await browser.evaluate('globalThis.__t40Risk.offset=601000');
    await browser.waitFor('document.querySelectorAll("[data-reminder-id]").length===0');assert.equal(await browser.evaluate('document.querySelector("[data-realtime-status]").dataset.realtimeStatus'),'live');assert.deepEqual(await f.currentFacts(),before,'expiry only prunes visual hints');
    assert.equal(await browser.evaluate('globalThis.__t40Risk.posts'),0);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots:[],coordination:'NATIVE_WEB_LOCKS_TWO_ACTUAL_TABS_SAME_PROFILE',visibility_and_browser_clock:'CONTROLLED_TEST_SENSORS',audio_and_os_delivery:'NOT_PROVEN'}));
  }catch(error){primary=error;}finally{await closeBrowserTestResources([async()=>{if(browser&&peerId)await browser.command('Target.closeTarget',{targetId:peerId});},async()=>close(browser,undefined)],primary);}
}));
test('T40 empty current increment removes an unopened reminder after real READ loss with unchanged principal scope',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  let browser:Browser|undefined,primary:unknown;
  try{
    browser=await launch(f);const url=await browser.evaluate('location.href');assert.deepEqual(await f.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
    await browser.waitFor('Boolean(document.querySelector("[data-reminder-id]"))');await f.revokeReadWithoutScopeChange();
    await browser.waitFor('document.querySelectorAll("[data-reminder-id]").length===0');assert.equal(await browser.evaluate('location.href'),url);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);assert.equal(await browser.evaluate('globalThis.__t40Risk.posts'),0);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots:[],revocation:'REAL_ASSIGNMENT_TRANSFER_SAME_PRINCIPAL_SCOPE',automatic_posts:0}));
  }catch(error){primary=error;}finally{await close(browser,primary);}
}));
test('T40 auxiliary reminder 503 and a slow real response leave healthy business refresh and explicit follow submission available',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  let browser:Browser|undefined,primary:unknown,mode:'healthy'|'503'|'hold'='healthy',failures=0;const releases:(()=>void)[]=[];
  f.runtime.server.on('request',(request,response)=>{
    if(request.method!=='GET'||!(request.url??'').startsWith('/api/workbench/reminders')||mode==='healthy')return;
    const fault=mode,head=response.writeHead.bind(response),end=response.end;
    response.writeHead=((...args:Parameters<typeof head>)=>{if(fault==='503'){args[0]=503;failures++;}return head(...args);}) as typeof response.writeHead;
    response.end=function(...args:unknown[]){if(fault==='hold'){releases.push(()=>{Reflect.apply(end,response,args);});return response;}
      Reflect.apply(end,response,['{"error":{"code":"T40_CONTROLLED_AUXILIARY_OUTAGE"}}']);return response;};
  });
  try{
    browser=await launch(f,'/workbench/app/items/ticket/'+f.ticketId+'?detail=page');
    const button='button[data-action="toggle-item-follow"]';await browser.waitFor('document.querySelector(\''+button+'\')?.disabled===false');mode='503';
    for(let attempt=0;attempt<400&&failures===0;attempt++)await delay(25);assert.ok(failures>0,'original auxiliary route must actually return HTTP 503');
    await browser.waitFor('document.body.innerText.includes("提醒暂未更新")');await delay(6000);
    assert.equal(await browser.evaluate('document.querySelector("[data-realtime-status]").dataset.realtimeStatus'),'live');
    await click(browser,button);await browser.waitFor('document.querySelector(\''+button+'\')?.getAttribute("aria-pressed")==="true"');
    assert.equal(object(object((await f.http.get('/api/workbench/items/ticket/'+f.ticketId)).value.item).attention).following,true);
    mode='hold';for(let attempt=0;attempt<400&&releases.length===0;attempt++)await delay(25);assert.ok(releases.length>0);await delay(6500);
    assert.equal(await browser.evaluate('document.querySelector("[data-realtime-status]").dataset.realtimeStatus'),'live');
    assert.equal(await browser.evaluate('document.querySelector(\''+button+'\').disabled'),false);
    mode='healthy';for(const release of releases.splice(0))release();
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots:[],auxiliary_faults:'REAL_ROUTE_HTTP_503_AND_DELAYED_BODY',business_follow:'EXPLICIT_REAL_COMMITTED_COMMAND',new_production_polls:0}));
  }catch(error){primary=error;}finally{mode='healthy';for(const release of releases.splice(0))release();await close(browser,primary);}
}));
