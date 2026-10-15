import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT40ReminderRiskFixture,object,text,type T40ReminderRiskFixture} from './helpers/t40-reminder-risk-fixture.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const key='wbint-reminder-preferences-v1';
// Native browser APIs are forwarded. Visibility is a labeled controlled sensor;
// only the explicit refusal case rejects AudioContext.resume, never fabricates success.
const observe=`(()=>{
  const m=globalThis.__t40Preferences={starts:0,resumes:0,refusals:0,permissionRequests:0,notifications:0,posts:0,reads:[],bootstraps:[],acquired:0,released:0,acquireReads:[],refuse:false};
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
  const fetch=globalThis.fetch;globalThis.fetch=async function(input,options){
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&method==='POST')m.posts++;
    const response=await Reflect.apply(fetch,this,[input,options]);
    if(url.origin===location.origin&&response.ok&&(url.pathname==='/api/workbench/reminders'||url.pathname==='/api/lifecycle/bootstrap')){
      const value=await response.clone().json();if(url.pathname.endsWith('/reminders'))m.reads.push({baseline:!url.searchParams.has('after_event_id'),asof:value.as_of_event_id,ids:value.items.map(x=>x.reminder_id),itemIds:value.items.map(x=>x.canonical_item.id)});
      else m.bootstraps.push(value.principal_id);
    }return response;
  };
  const resume=AudioContext.prototype.resume;AudioContext.prototype.resume=function(...args){m.resumes++;if(m.refuse){m.refusals++;return Promise.reject(new DOMException('T40_CONTROLLED_BROWSER_AUDIO_REFUSAL','NotAllowedError'));}return Reflect.apply(resume,this,args);};
  const start=AudioScheduledSourceNode.prototype.start;AudioScheduledSourceNode.prototype.start=function(...args){m.starts++;return Reflect.apply(start,this,args);};
  if(typeof Notification==='function'){
    const permission=Notification.requestPermission;Notification.requestPermission=function(...args){m.permissionRequests++;return Reflect.apply(permission,this,args);};
    globalThis.Notification=new Proxy(Notification,{construct(target,args,newTarget){m.notifications++;return Reflect.construct(target,args,newTarget);}});
  }
  const request=navigator.locks.request.bind(navigator.locks);navigator.locks.request=function(name,options,callback){
    if(!String(name).startsWith('wbint-reminders-'))return request(name,options,callback);
    return request(name,options,async lock=>{if(lock){m.acquired++;m.acquireReads.push(m.reads.length);}try{return await callback(lock);}finally{if(lock)m.released++;}});
  };
})()`;
function port(browser:Browser,sessionId:string|null=null){
  const command=(method:string,parameters:Record<string,unknown>={})=>browser.command(method,parameters,sessionId);
  const evaluate=async(expression:string):Promise<unknown>=>{
    const response=object(await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}));
    assert.equal(response.exceptionDetails,undefined,JSON.stringify(response.exceptionDetails));return object(response.result).value;
  };
  const wait=async(expression:string)=>{const until=performance.now()+30_000;while(performance.now()<until){if(await evaluate(expression))return;await delay(25);}throw Error('T40_BROWSER_CONDITION_TIMEOUT: '+expression);};
  const click=async(selector:string)=>{
    const point=object(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('T40_NATIVE_CLICK_TARGET_MISSING');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`));
    assert.equal(typeof point.x,'number');assert.equal(typeof point.y,'number');
    for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
  };
  const ready=()=>wait('Boolean(document.querySelector(\'[data-realtime-status="live"]\')&&document.querySelector(\'[data-reminders-ready="true"]\'))');
  const install=async(origin:string)=>{await command('Page.enable');await command('Runtime.enable');await command('Page.addScriptToEvaluateOnNewDocument',{source:observe});await command('Page.navigate',{url:origin+'/workbench/app/'});await ready();};
  const baselineAfterLeader=()=>wait('globalThis.__t40Preferences.acquired>0&&globalThis.__t40Preferences.reads.slice(globalThis.__t40Preferences.acquireReads.at(-1)).some(x=>x.baseline)');
  return {command,evaluate,wait,click,ready,install,baselineAfterLeader};
}
async function launch(f:T40ReminderRiskFixture){const browser=await launchSystemBrowser({url:f.origin+'/api/lifecycle/bootstrap',width:1280,height:900,cookies:[f.browserCookie]});assert.ok(browser);return browser;}
async function close(browser:Browser|undefined,primary:unknown){await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}

test('T40 native user audition, audio refusal, chosen notification permissions, bounded settings and actual account change preserve visual work',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  let browser:Browser|undefined,primary:unknown;
  try{
    browser=await launch(f);const p=port(browser);await p.install(f.origin);await p.click('button[aria-label="提醒偏好"]');
    assert.equal(await p.evaluate('document.querySelector(\'input[aria-label="开启声音提醒"]\').checked'),false);
    assert.equal(await p.evaluate('document.querySelector(\'input[aria-label="开启桌面通知"]\').checked'),false);
    assert.deepEqual(await p.evaluate('({starts:__t40Preferences.starts,permission:__t40Preferences.permissionRequests,notifications:__t40Preferences.notifications})'),{starts:0,permission:0,notifications:0});
    await p.click('dialog[aria-label="本浏览器提醒偏好"] button:not([aria-label])');
    await p.wait('__t40Preferences.starts===1');
    await p.click('input[aria-label="开启声音提醒"]');await p.wait('__t40Preferences.starts===2');await p.baselineAfterLeader();
    await p.click('button[aria-label="关闭提醒偏好"]');await p.evaluate('__t40Preferences.refuse=true');
    assert.deepEqual(await f.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
    await p.wait('__t40Preferences.refusals>0&&document.querySelector("[data-reminder-id]")&&document.body.innerText.includes("声音暂不可用，视觉提醒继续。")');
    assert.equal(await p.evaluate('__t40Preferences.starts'),2);
    await p.evaluate('__t40Preferences.refuse=false');
    await p.command('Browser.setPermission',{permission:{name:'notifications'},setting:'denied',origin:f.origin});
    await p.click('button[aria-label="提醒偏好"]');await p.click('input[aria-label="开启桌面通知"]');
    await p.wait('__t40Preferences.permissionRequests===1&&document.body.innerText.includes("桌面通知未开启")');
    assert.equal(await p.evaluate('document.querySelector(\'input[aria-label="开启桌面通知"]\').checked'),false);
    assert.equal(await p.evaluate('__t40Preferences.notifications'),0);
    await p.command('Browser.setPermission',{permission:{name:'notifications'},setting:'granted',origin:f.origin});
    await p.click('input[aria-label="开启桌面通知"]');await p.wait('document.querySelector(\'input[aria-label="开启桌面通知"]\').checked&&__t40Preferences.permissionRequests===2&&__t40Preferences.acquired>=2');
    await p.click('button[aria-label="关闭提醒偏好"]');await p.baselineAfterLeader();await f.nextDue();
    await p.wait('__t40Preferences.notifications===1&&document.querySelectorAll("[data-reminder-id]").length>=2');
    const preferences=text(await p.evaluate('localStorage.getItem('+JSON.stringify(key)+')'));assert.ok(Buffer.byteLength(preferences)<=128);
    assert.deepEqual(JSON.parse(preferences),{schema_version:1,sound_enabled:true,desktop_enabled:true});
    const starts=await p.evaluate('__t40Preferences.starts'),url=await p.evaluate('location.href'),facts=await f.currentFacts();
    await p.command('Network.deleteCookies',{name:f.browserCookie.name,url:f.origin});await p.command('Network.setCookies',{cookies:[f.otherBrowserCookie]});
    await p.wait('__t40Preferences.bootstraps.includes('+JSON.stringify(f.otherHandler)+')&&document.querySelectorAll("[data-reminder-id]").length===0');await p.ready();
    await p.click('button[aria-label="提醒偏好"]');assert.equal(await p.evaluate('document.querySelector(\'input[aria-label="开启声音提醒"]\').checked'),false);
    assert.equal(await p.evaluate('document.querySelector(\'input[aria-label="开启桌面通知"]\').checked'),false);assert.equal(await p.evaluate('__t40Preferences.starts'),starts);
    assert.equal(await p.evaluate('location.href'),url);assert.equal(await p.evaluate('__t40Preferences.posts'),0);assert.deepEqual(await f.currentFacts(),facts);
    assert.equal(await p.evaluate('localStorage.getItem('+JSON.stringify(key)+')'),null);
    await p.command('Page.reload');await p.ready();await delay(1000);
    assert.deepEqual(await p.evaluate('({starts:__t40Preferences.starts,permission:__t40Preferences.permissionRequests,notifications:__t40Preferences.notifications})'),{starts:0,permission:0,notifications:0});
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots:[],audio:'NATIVE_USER_GESTURE_AUDIO_API_WITH_EXPLICIT_CONTROLLED_REFUSAL',notification_permission:'NATIVE_CDP_BROWSER_PERMISSION_ENGINE_DENIED_THEN_GRANTED_USER_CHOICES',account_change:'ORIGINAL_COOKIE_STORE_AND_CURRENT_BOOTSTRAP',physical_sound_and_os_delivery:'NOT_RUN_NOT_PROVEN',automatic_posts:0}));
  }catch(error){primary=error;if(browser)console.log('T40_PREFERENCES_FAILURE_OBSERVER '+JSON.stringify(await browser.evaluate('globalThis.__t40Preferences').catch(()=>null)));}finally{await close(browser,primary);}
}));

test('T40 two actual browser tabs share one native leader, merge a short event cluster and never replay the same real reminders',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  let browser:Browser|undefined,peerId:string|undefined,primary:unknown;const resumes:string[]=[],documents:ReturnType<typeof port>[]=[];
  f.runtime.server.on('request',request=>{if(request.method==='GET'&&(request.url??'').startsWith('/api/realtime/events'))resumes.push(String(request.headers['last-event-id']??''));});
  try{
    await f.setTeams(['PILOT_IT']);browser=await launch(f);const main=port(browser);documents.push(main);await main.install(f.origin);
    const created=object(await main.command('Target.createTarget',{url:'about:blank'}));peerId=text(created.targetId);
    const attached=object(await main.command('Target.attachToTarget',{targetId:peerId,flatten:true}));const peer=port(browser,text(attached.sessionId));documents.push(peer);await peer.install(f.origin);
    assert.equal((await f.runtime.observability.metrics()).sse_clients,2);
    for(const p of [main,peer]){await p.click('button[aria-label="提醒偏好"]');await p.click('input[aria-label="开启声音提醒"]');await p.click('button[aria-label="关闭提醒偏好"]');}
    await main.wait('(async()=>{const s=await navigator.locks.query();return s.held.filter(x=>x.name.startsWith("wbint-reminders-")).length===1&&s.pending.filter(x=>x.name.startsWith("wbint-reminders-")).length===1;})()');
    await main.baselineAfterLeader();const before=Number(await main.evaluate('__t40Preferences.starts'))+Number(await peer.evaluate('__t40Preferences.starts'));
    const serverBaseline=await f.http.get('/api/workbench/reminders');assert.equal(serverBaseline.status,200);
    const first=await f.createTeamReport(),second=await f.createTeamReport();
    const serverNew=await f.http.get('/api/workbench/reminders?'+new URLSearchParams({after_event_id:text(serverBaseline.value.as_of_event_id),baseline_token:text(serverBaseline.value.baseline_token)}));assert.equal(serverNew.status,200);
    assert.ok(Array.isArray(serverNew.value.items));for(const id of [first,second])assert.ok(serverNew.value.items.map(object).some(x=>object(x.canonical_item).id===id),'the same current principal must actually read each original new report');
    const both=`(()=>{const seen=new Set(__t40Preferences.reads.flatMap(x=>x.itemIds));return seen.has(${JSON.stringify(first)})&&seen.has(${JSON.stringify(second)});})()`;
    await main.wait(both);await peer.wait(both);await delay(1100);
    assert.equal(Number(await main.evaluate('__t40Preferences.starts'))+Number(await peer.evaluate('__t40Preferences.starts'))-before,1,'the same two original events in two real tabs yield one merged native tone');
    const ids=await main.evaluate('Array.from(new Set(__t40Preferences.reads.flatMap(x=>x.ids)))');assert.deepEqual(await peer.evaluate('Array.from(new Set(__t40Preferences.reads.flatMap(x=>x.ids)))'),ids);
    await f.publishPendingReports();await delay(2500);
    assert.equal(Number(await main.evaluate('__t40Preferences.starts'))+Number(await peer.evaluate('__t40Preferences.starts'))-before,1);
    const mainBaselines=Number(await main.evaluate('__t40Preferences.reads.filter(x=>x.baseline).length')),peerBaselines=Number(await peer.evaluate('__t40Preferences.reads.filter(x=>x.baseline).length'));
    // Existing T39 native CDP network seam keeps both documents offline until the original event has committed.
    const network={latency:0,downloadThroughput:-1,uploadThroughput:-1};
    for(const p of [main,peer]){await p.command('Network.enable');await p.command('Network.emulateNetworkConditions',{offline:true,...network});}
    f.runtime.disconnectRealtimePrincipal(1);
    for(const p of [main,peer])await p.wait('document.querySelector("[data-realtime-status]").dataset.realtimeStatus!=="live"');
    const duringReconnect=await f.createTeamReport();
    const committed=(await f.pool.query<{event_id:string}>(`SELECT e.event_id::text FROM pilot_ticket.ticket t
      JOIN intake.service_intake i ON i.id=t.source_intake_id JOIN conversation.session s ON s.service_intake_id=i.id
      JOIN conversation.item ci ON ci.session_id=s.id AND ci.source_type='CHANNEL_MESSAGE' AND ci.source_id=i.primary_message_id::text
      JOIN conversation.realtime_event e ON e.source_type='CONVERSATION_ITEM' AND e.source_id=ci.id::text AND e.event_type='conversation.item.created'
      WHERE t.id=$1::uuid ORDER BY e.event_id LIMIT 1`,[duringReconnect])).rows[0];assert.ok(committed);
    for(const p of [main,peer])await p.command('Network.emulateNetworkConditions',{offline:false,...network});
    await main.ready();await peer.ready();
    await main.wait('__t40Preferences.reads.filter(x=>x.baseline).length>'+mainBaselines+'&&__t40Preferences.reads.some(x=>x.baseline&&BigInt(x.asof)>=BigInt('+JSON.stringify(committed.event_id)+'))');
    await peer.wait('__t40Preferences.reads.filter(x=>x.baseline).length>'+peerBaselines+'&&__t40Preferences.reads.some(x=>x.baseline&&BigInt(x.asof)>=BigInt('+JSON.stringify(committed.event_id)+'))');await delay(1100);
    assert.ok(resumes.length>=4,'each actual tab must establish a new original SSE after its controlled network recovery');
    assert.equal(Number(await main.evaluate('__t40Preferences.starts'))+Number(await peer.evaluate('__t40Preferences.starts'))-before,1,'events committed while disconnected are history at the new baseline');
    for(const p of [main,peer])assert.equal(await p.evaluate('__t40Preferences.reads.some(x=>x.itemIds.includes('+JSON.stringify(duringReconnect)+'))'),false);
    assert.equal(await main.evaluate('__t40Preferences.posts'),0);assert.equal(await peer.evaluate('__t40Preferences.posts'),0);
    assert.equal(await main.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);assert.equal(await peer.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots:[],coordination:'TWO_ACTUAL_CHROME_TARGETS_SAME_PROFILE_NATIVE_WEB_LOCKS_BROADCAST_CHANNEL',visibility:'CONTROLLED_VISIBLE_SENSOR_IN_BOTH_REAL_TABS',same_real_events_in_both_tabs:true,native_merged_tones:1,reconnect:'CONTROLLED_NATIVE_NETWORK_OFFLINE_UNTIL_ORIGINAL_COMMIT_THEN_NEW_SSE_AND_BASELINE_WATERMARKS',automatic_posts:0,physical_sound:'NOT_RUN_NOT_PROVEN'}));
  }catch(error){primary=error;for(let index=0;index<documents.length;index++)console.log('T40_ACTUAL_TAB_FAILURE_OBSERVER '+JSON.stringify({index,state:await documents[index]?.evaluate('globalThis.__t40Preferences').catch(()=>null)}));}finally{await closeBrowserTestResources([async()=>{if(browser&&peerId)await browser.command('Target.closeTarget',{targetId:peerId});},async()=>close(browser,undefined)],primary);}
}));
