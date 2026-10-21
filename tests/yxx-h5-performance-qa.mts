import assert from 'node:assert/strict';
import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

interface Browser {
  command(method:string,parameters?:Record<string,unknown>):Promise<unknown>;
  evaluate(expression:string):Promise<unknown>;
  waitFor(expression:string,options?:{timeoutMs:number}):Promise<unknown>;
  screenshot():Promise<string>;
}
interface QaOptions {
  browser:Browser;origin:string;requestRef:string;outputRoot:string;
  armReadFailureAfterUrge():void;
  clearReadFailure():void;
  media?:{requestRef:string;voiceRef:string;videoRef:string;images:string[];voiceBytes:number;videoBytes:number};
  cookies:{owner:{name:string;value:string}[];empty:{name:string;value:string}[]};
  network():MediaRequest[];
  clearNetwork():void;
}
interface MediaRequest {path:string;variant:string|null;status:number;start_ms:number;end_ms:number;decoded_bytes:number;encoded_bytes:number;date:string;request_range:string|null;content_range:string|null;content_length:number|null;failure_code:string|null}
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
async function pointer(browser:Browser,expression:string):Promise<void>{
  await browser.waitFor(`(()=>{const page=document.querySelector('[data-h5-checking]');if(page&&(page.dataset.h5Checking!=='false'||page.dataset.h5WriteReady!=='true'))return false;const element=${expression};if(!element||element.disabled)return false;const bounds=element.getBoundingClientRect();return bounds.width>0&&bounds.height>0;})()`,{timeoutMs:45000});
  const bounds=record(await browser.evaluate(`(()=>{const element=${expression};if(!element)throw new Error('H5_QA_VISIBLE_ACTION_REQUIRED');element.scrollIntoView({block:'center',behavior:'instant'});const r=element.getBoundingClientRect();if(!r.width||!r.height||element.disabled)throw new Error('H5_QA_ACTION_UNAVAILABLE');return{x:r.x+r.width/2,y:r.y+r.height/2};})()`));
  for(const type of ['mousePressed','mouseReleased'])await browser.command('Input.dispatchMouseEvent',{type,x:bounds.x,y:bounds.y,button:'left',clickCount:1});
}
async function closeDialog(browser:Browser):Promise<void>{
  for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await browser.waitFor(`!document.querySelector('[role=dialog]')`,{timeoutMs:15000});
}
async function inputText(browser:Browser,text:string):Promise<void>{
  await pointer(browser,`document.querySelector('#fault-description')`);
  for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  if(text)await browser.command('Input.insertText',{text});else for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
  await browser.waitFor(`document.querySelector('#fault-description').value===${JSON.stringify(text)}`,{timeoutMs:15000});
}
async function additionalScenarios(options:QaOptions,directory:string,results:Record<string,unknown>[]):Promise<void>{
  const {browser,origin}=options;
  try{
    await direct(options,'report');
    for(const [language,text] of [['zh','打印设备故障，请及时处理。'.repeat(90)],['en','Long report description and detailed reproducible observation. '.repeat(22)]]){
      assert.ok(text&&language);await inputText(browser,text);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await writeFile(path.join(directory,'long-description-'+language+'.png'),Buffer.from(await browser.screenshot(),'base64'));
      results.push({scenario:'long-description',language,status:'PASS',characters:text.length,overflow:false});
    }
    const draft=await browser.evaluate(`document.querySelector('#fault-description').value`);assert.equal(typeof draft,'string');
    // Finish one observable focus-recheck cycle before changing connectivity; a prior input focus may already have queued a refresh.
    await browser.waitFor(`!!document.querySelector('[data-h5-ready="report"][data-h5-write-ready="true"][data-h5-checking="false"]')`,{timeoutMs:30000});
    await browser.evaluate(`window.dispatchEvent(new Event('focus'))`);
    await browser.waitFor(`!!document.querySelector('[data-h5-checking="true"]')`,{timeoutMs:15000});
    await browser.waitFor(`!!document.querySelector('[data-h5-ready="report"][data-h5-write-ready="true"][data-h5-checking="false"]')`,{timeoutMs:30000});
    const settledDeadline=performance.now()+30000;
    while(options.network().some(item=>item.path.startsWith('/api/')&&item.end_ms===0)){assert.ok(performance.now()<settledDeadline,'the prior API requests must finish before the offline scenario');await delay(20);}
    options.clearNetwork();await browser.command('Network.emulateNetworkConditions',{offline:true,latency:150,downloadThroughput:0,uploadThroughput:0,connectionType:'none'});
    await browser.evaluate(`window.dispatchEvent(new Event('focus'))`);
    await browser.waitFor(`!!document.querySelector('[data-h5-write-ready="false"]')&&document.querySelector('#fault-description').disabled&&!!document.querySelector('.session-warning')`,{timeoutMs:20000});
    assert.equal(await browser.evaluate(`document.querySelector('#fault-description').value`),draft);
    assert.ok(options.network().some(item=>item.path==='/api/yixiaoxiu/h5/entry'&&item.failure_code==='net::ERR_INTERNET_DISCONNECTED'),'the actual CDP connection must reject the protected entry fetch while offline');
    await browser.command('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:4_000_000/8,uploadThroughput:1_000_000/8,connectionType:'cellular4g'});
    await browser.evaluate(`window.dispatchEvent(new Event('online'))`);
    await browser.waitFor(`!!document.querySelector('[data-h5-ready="report"][data-h5-write-ready="true"][data-h5-checking="false"]')&&!document.querySelector('#fault-description').disabled`,{timeoutMs:30000});
    assert.equal(await browser.evaluate(`document.querySelector('#fault-description').value`),draft);
    results.push({scenario:'real-cdp-offline-online-draft',status:'PASS',characters:String(draft).length,offline_write_disabled:true,draft_preserved:true,actual_entry_requests:options.network().filter(item=>item.path==='/api/yixiaoxiu/h5/entry').map(item=>({status:item.status,ended:item.end_ms>0,network_error:item.failure_code}))});
    await writeFile(path.join(directory,'offline-online-draft.png'),Buffer.from(await browser.screenshot(),'base64'));await inputText(browser,'');
  }catch(error){results.push({scenario:'long-offline-draft',status:'FAIL',reason:error instanceof Error?error.message:'DRAFT_FAILED'});}
  finally{await browser.command('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:4_000_000/8,uploadThroughput:1_000_000/8,connectionType:'cellular4g'});}
  try{
    await browser.command('Network.setCookies',{cookies:options.cookies.empty.map(cookie=>({...cookie,url:origin+'/',secure:true,httpOnly:true,sameSite:'Lax'}))});
    for(const view of ['home','reports']){options.clearNetwork();await direct(options,view);assert.equal(await browser.evaluate(`document.querySelectorAll('.report-card').length`),0);assert.equal(await browser.evaluate(`!!document.querySelector('.empty-reports')`),true);assert.ok(options.network().some(item=>item.path==='/api/yixiaoxiu/h5/entry'&&item.status===200));await writeFile(path.join(directory,'empty-'+view+'.png'),Buffer.from(await browser.screenshot(),'base64'));results.push({scenario:'real-empty-member',view,status:'PASS',report_cards:0,fixture:'Different authenticated synthetic member with no owned facts; no fact mutation or DTO replacement'});}
  }catch(error){results.push({scenario:'real-empty-member',status:'FAIL',reason:error instanceof Error?error.message:'EMPTY_FAILED'});}
  finally{await browser.command('Network.setCookies',{cookies:options.cookies.owner.map(cookie=>({...cookie,url:origin+'/',secure:true,httpOnly:true,sameSite:'Lax'}))});}
}
async function direct(options:QaOptions,view:string,ref=options.requestRef):Promise<void>{
  const {browser,origin}=options,route=view==='home'?'':view==='request'?'requests/'+ref:view;
  await browser.command('Page.navigate',{url:origin+'/wecom/yixiaoxiu/#/'+route});
  const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload',{ignoreCache:false});
  await browser.waitFor(`performance.timeOrigin!==${Number(previous)}&&!!document.querySelector('[data-h5-ready="${view}"][data-h5-checking="false"]')${view==='request'?`&&document.querySelector('[data-h5-ready="request"]').dataset.requestRef===${JSON.stringify(ref)}`:''}`,{timeoutMs:45000});
  await browser.evaluate('document.fonts.ready');
}
async function legacyRoutes(options:QaOptions,directory:string,results:Record<string,unknown>[]):Promise<void>{
  const {browser,origin,requestRef}=options;
  for(const scenario of [
    {name:'legacy-detail',document:'/reports/'+requestRef,view:'request',hash:'#/requests/'+requestRef},
    {name:'legacy-new',document:'/reports/new',view:'report',hash:'#/report'},
    {name:'legacy-list',document:'/reports',view:'reports',hash:'#/reports'},
    {name:'legacy-explicit-hash',document:'/reports/'+requestRef+'#/reports',view:'reports',hash:'#/reports'},
  ]){
    try{
      await browser.command('Network.setExtraHTTPHeaders',{headers:{'x-h5-performance-id':'qa-'+scenario.name}});
      const previous=await browser.evaluate('performance.timeOrigin');
      await browser.command('Page.navigate',{url:origin+'/wecom/yixiaoxiu'+scenario.document});
      await browser.waitFor(`performance.timeOrigin!==${Number(previous)}&&!!document.querySelector('[data-h5-ready="${scenario.view}"][data-h5-checking="false"]')${scenario.view==='request'?`&&document.querySelector('[data-h5-ready="request"]').dataset.requestRef===${JSON.stringify(requestRef)}`:''}`,{timeoutMs:45000});
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const state=record(await browser.evaluate(`({hash:location.hash,view:document.querySelector('[data-h5-ready]')?.dataset.h5Ready,request_ref:document.querySelector('[data-h5-ready]')?.dataset.requestRef??null,entry_views:performance.getEntriesByType('resource').map(item=>new URL(item.name)).filter(url=>url.pathname==='/api/yixiaoxiu/h5/entry').map(url=>url.searchParams.get('view')),errors:window.__h5Performance?.errors??[]})`));
      assert.equal(state.hash,scenario.hash);assert.equal(state.view,scenario.view);assert.deepEqual(state.errors,[]);
      assert.ok(Array.isArray(state.entry_views)&&state.entry_views.length>0,'the direct document must complete a real entry request');
      assert.deepEqual([...new Set(state.entry_views)],[scenario.view],'the hash router must not replace the requested entry with a second home entry');
      if(scenario.view==='request')assert.equal(state.request_ref,requestRef);
      results.push({scenario:scenario.name,status:'PASS',...state});
      await writeFile(path.join(directory,scenario.name+'.png'),Buffer.from(await browser.screenshot(),'base64'));
      if(scenario.name==='legacy-detail'){
        await pointer(browser,`document.querySelector('.detail-header-main button')`);
        await browser.waitFor(`!!document.querySelector('[data-h5-ready="reports"][data-h5-checking="false"]')`,{timeoutMs:20000});
        await browser.evaluate('window.history.back()');
        await browser.waitFor(`!!document.querySelector('[data-h5-ready="request"][data-h5-checking="false"]')&&document.querySelector('[data-h5-ready="request"]').dataset.requestRef===${JSON.stringify(requestRef)}`,{timeoutMs:20000});
        await browser.evaluate('window.history.forward()');
        await browser.waitFor(`!!document.querySelector('[data-h5-ready="reports"][data-h5-checking="false"]')`,{timeoutMs:20000});
        results.push({scenario:'legacy-history-back-forward',status:'PASS'});
      }
    }catch(error){results.push({scenario:scenario.name,status:'FAIL',reason:error instanceof Error?error.message:'LEGACY_ROUTE_FAILED'});await writeFile(path.join(directory,scenario.name+'-failure.png'),Buffer.from(await browser.screenshot(),'base64')).catch(()=>{});}
  }
}
async function searchBoundary(options:QaOptions,directory:string,results:Record<string,unknown>[]):Promise<void>{
  const {browser}=options,text='x'.repeat(101),accepted=text.slice(0,100);
  try{
    await direct(options,'reports');await pointer(browser,`document.querySelector('#report-search')`);
    await browser.command('Input.insertText',{text});
    assert.equal(await browser.evaluate(`document.querySelector('#report-search').value`),accepted,'the real input must reject the 101st character before submitting');
    options.clearNetwork();await pointer(browser,`document.querySelector('.search-row button[type="submit"]')`);
    await browser.waitFor(`!!document.querySelector('[data-h5-ready="reports"][data-h5-checking="false"]')&&new URL(location.hash.slice(1),location.origin).searchParams.get('search')===${JSON.stringify(accepted)}&&performance.getEntriesByType('resource').some(item=>{const url=new URL(item.name);return url.pathname==='/api/yixiaoxiu/h5/entry'&&url.searchParams.get('search')===${JSON.stringify(accepted)};})`,{timeoutMs:30000});
    const reads=options.network().filter(item=>item.path==='/api/yixiaoxiu/h5/entry');assert.ok(reads.length>0);assert.ok(reads.every(item=>item.status===200&&item.end_ms>0));
    assert.equal(await browser.evaluate(`document.querySelector('#report-search').value`),accepted);
    results.push({scenario:'search-api-length-boundary',status:'PASS',attempted_characters:101,accepted_characters:100,entry_statuses:reads.map(item=>item.status)});
    await writeFile(path.join(directory,'search-api-length-boundary.png'),Buffer.from(await browser.screenshot(),'base64'));
  }catch(error){results.push({scenario:'search-api-length-boundary',status:'FAIL',reason:error instanceof Error?error.message:'SEARCH_BOUNDARY_FAILED'});}
}
function receivedBytes(reads:readonly MediaRequest[],total:number):number{
  const intervals=reads.filter(item=>item.status===200||item.status===206).map(item=>{
    const start=item.content_range?/^bytes (\d+)-\d+\/\d+$/u.exec(item.content_range):null;
    return {start:start?Number(start[1]):0,end:Math.min(total,(start?Number(start[1]):0)+item.decoded_bytes)};
  }).filter(item=>item.end>item.start).sort((left,right)=>left.start-right.start);
  let bytes=0,end=0;
  for(const interval of intervals){bytes+=Math.max(0,interval.end-Math.max(end,interval.start));end=Math.max(end,interval.end);}
  return bytes;
}
async function progressive(options:QaOptions,directory:string,kind:'video'|'audio',ref:string,total:number):Promise<Record<string,unknown>>{
  const {browser}=options;
  try{
    await browser.command('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1_600_000/8,uploadThroughput:1_000_000/8,connectionType:'cellular4g'});
    options.clearNetwork();
    await browser.evaluate(`(()=>{
      const kind=${JSON.stringify(kind)},state={kind,event:null,errors:[]};window.__h5MediaProbe=state;
      const capture=(type,element)=>{if(element.localName!==kind||state.event)return;state.event={type,epoch_ms:performance.timeOrigin+performance.now(),source:element.currentSrc,ready_state:element.readyState,current_time:element.currentTime};};
      const observe=()=>{for(const element of document.querySelectorAll(kind)){element.muted=true;if(kind==='video'&&!element.dataset.h5Probe){element.dataset.h5Probe='true';if(typeof element.requestVideoFrameCallback==='function')element.requestVideoFrameCallback(()=>capture('requestVideoFrameCallback',element));}}};
      document.addEventListener('loadeddata',event=>{const element=event.target;if(element instanceof HTMLVideoElement&&typeof element.requestVideoFrameCallback!=='function')capture('loadeddata',element);},true);
      document.addEventListener('playing',event=>{const element=event.target;if(kind==='audio'&&element instanceof HTMLAudioElement)capture('playing',element);},true);
      document.addEventListener('error',event=>{const element=event.target;if(element instanceof HTMLMediaElement&&element.localName===kind)state.errors.push({code:element.error?.code??0,epoch_ms:performance.timeOrigin+performance.now()});},true);
      new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});observe();
    })()`);
    await pointer(browser,kind==='video'?`document.querySelector('.material-av button')`:`document.querySelector('.voice-play-button')`);
    await browser.waitFor(`!!window.__h5MediaProbe.event||window.__h5MediaProbe.errors.length>0`,{timeoutMs:45000});
    const state=record(await browser.evaluate('window.__h5MediaProbe'));assert.deepEqual(state.errors,[],'native media decode must succeed');
    const event=record(state.event);assert.equal(new URL(String(event.source)).origin,options.origin,'native playback must read the private same-origin URL');
    const select=()=>options.network().filter(item=>item.path.endsWith('/'+ref)&&item.variant==='PLAYABLE');
    const atEvent=select().map(item=>({...item})),bytesAtEvent=receivedBytes(atEvent,total);
    assert.ok(atEvent.some(item=>item.status===200||item.status===206),'a real protected playback response must start');
    assert.ok(bytesAtEvent>0&&bytesAtEvent<total,'first native media presentation must precede receiving the complete representation');
    const deadline=performance.now()+45000;
    while(performance.now()<deadline){const reads=select();if(receivedBytes(reads,total)>=total&&reads.every(item=>item.end_ms>0))break;await delay(100);}
    const reads=select().map(item=>({...item}));assert.equal(receivedBytes(reads,total),total,'the same playback must eventually receive the complete representation');
    assert.ok(reads.every(item=>item.end_ms>0),'the playback network completion must be observed');
    const completedEpoch=Math.max(...reads.map(item=>Date.parse(item.date)+item.end_ms-item.start_ms));
    assert.ok(Number(event.epoch_ms)<completedEpoch,'the real media event must precede final network completion');
    await writeFile(path.join(directory,'progressive-'+kind+'.png'),Buffer.from(await browser.screenshot(),'base64'));
    return {status:'PASS',kind,downlink_bps:1_600_000,event,representation_bytes:total,bytes_at_event:bytesAtEvent,network_completion_epoch_ms:completedEpoch,lead_before_completion_ms:completedEpoch-Number(event.epoch_ms),at_event:atEvent,requests:reads};
  }catch(error){
    const state=await browser.evaluate('window.__h5MediaProbe').catch(()=>null);
    await writeFile(path.join(directory,'progressive-'+kind+'-failure.png'),Buffer.from(await browser.screenshot(),'base64')).catch(()=>{});
    return {status:'FAIL',kind,reason:error instanceof Error?error.message:'H5_PROGRESSIVE_NATIVE_FAILED',state,representation_bytes:total,requests:options.network().filter(item=>item.path.endsWith('/'+ref))};
  }finally{
    await browser.evaluate(`for(const element of document.querySelectorAll('video,audio')){element.pause();element.removeAttribute('src');element.load();}`).catch(()=>{});
  }
}
export async function runH5BrowserQa(options:QaOptions):Promise<Record<string,unknown>>{
  const {browser,outputRoot}=options,directory=path.join(outputRoot,'browser-qa');await mkdir(directory,{recursive:false});
  const results:Record<string,unknown>[]=[],profiles=[
    {name:'zh-light',language:'zh_CN',lang:'zh-CN',theme:'light',width:390},
    {name:'zh-dark',language:'zh_CN',lang:'zh-CN',theme:'dark',width:390},
    {name:'en-light',language:'en_US',lang:'en',theme:'light',width:390},
    {name:'en-dark',language:'en_US',lang:'en',theme:'dark',width:390},
    {name:'zh-tw-dark-320',language:'zh_TW',lang:'zh-CN',theme:'dark',width:320},
    {name:'ja-light-320',language:'ja',lang:'en',theme:'light',width:320},
  ];
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__h5QaPaints=[];new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__h5QaPaints.push({name:entry.name,theme:document.documentElement.dataset.theme,lang:document.documentElement.lang,background:getComputedStyle(document.body).backgroundColor})}).observe({type:'paint',buffered:true});`});
  for(const profile of profiles){
    await browser.command('Emulation.setDeviceMetricsOverride',{width:profile.width,height:844,deviceScaleFactor:1,mobile:true});
    await browser.command('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 Android wxwork/4.1 Language/'+profile.language+' ColorScheme/'+(profile.theme==='dark'?'Dark':'Light')});
    await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:profile.theme==='dark'?'light':'dark'}]});
    await browser.command('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:(profile.width===320?1_600_000:4_000_000)/8,uploadThroughput:1_000_000/8,connectionType:'cellular4g'});
    for(const view of ['home','report','reports','request','department']){
      await browser.command('Network.setExtraHTTPHeaders',{headers:{'x-h5-performance-id':'qa-'+profile.name+'-'+view}});await direct(options,view);
      const state=record(await browser.evaluate(`({lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth,paints:window.__h5QaPaints,errors:window.__h5Performance?.errors??[],checking:document.querySelector('[data-h5-ready]').dataset.h5Checking})`));
      assert.equal(state.lang,profile.lang);assert.equal(state.theme,profile.theme);assert.equal(state.overflow,false);assert.deepEqual(state.errors,[]);assert.equal(state.checking,'false');
      assert.ok(Array.isArray(state.paints)&&state.paints.length>0,'real paint evidence is required');for(const paint of state.paints){const value=record(paint);assert.equal(value.theme,profile.theme);assert.equal(value.lang,profile.lang);}
      await writeFile(path.join(directory,profile.name+'-'+view+'.png'),Buffer.from(await browser.screenshot(),'base64'));
      if(view==='home'||view==='request'){
        await pointer(browser,view==='home'?`document.querySelector('.support-button')`:`document.querySelector('[data-h5-action="supplement"]')`);
        await browser.waitFor(`!!document.querySelector('[role=dialog]')`,{timeoutMs:15000});await closeDialog(browser);
      }
      const result={profile:profile.name,view,status:'PASS',...state};results.push(result);await appendFile(path.join(directory,'cases.jsonl'),JSON.stringify(result)+'\n');
    }
  }
  await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.command('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 Android wxwork/4.1 Language/zh_CN ColorScheme/Light'});
  await legacyRoutes(options,directory,results);
  await searchBoundary(options,directory,results);
  await direct(options,'home');
  await pointer(browser,`document.querySelector('.bottom-nav a[href="#/reports"]')`);await browser.waitFor(`!!document.querySelector('[data-h5-ready="reports"][data-h5-checking="false"]')`,{timeoutMs:20000});
  await pointer(browser,`document.querySelector('.bottom-nav a[href="#/"]')`);await browser.waitFor(`!!document.querySelector('[data-h5-ready="home"][data-h5-checking="false"]')`,{timeoutMs:20000});
  await direct(options,'request');await pointer(browser,`document.querySelector('.detail-header-main button')`);await browser.waitFor(`!!document.querySelector('[data-h5-ready="reports"][data-h5-checking="false"]')`,{timeoutMs:20000});
  results.push({scenario:'navigation-and-return',status:'PASS'});
  await direct(options,'home');options.clearNetwork();
  await browser.command('Network.setExtraHTTPHeaders',{headers:{'x-h5-performance-id':'qa-refresh-event-burst'}});
  await browser.evaluate(`(()=>{document.dispatchEvent(new Event('visibilitychange'));for(const name of ['pageshow','focus','online'])window.dispatchEvent(new Event(name));})()`);
  await browser.waitFor(`!!document.querySelector('[data-h5-checking="true"]')`,{timeoutMs:15000});
  assert.equal(await browser.evaluate(`document.querySelector('[data-h5-checking="true"]').dataset.h5WriteReady`),'false');
  await browser.waitFor(`!!document.querySelector('[data-h5-ready="home"][data-h5-checking="false"]')`,{timeoutMs:20000});
  const refreshReads=options.network().filter(item=>item.path==='/api/yixiaoxiu/h5/entry');
  assert.equal(refreshReads.length,1,'the production runtime must coalesce four same-turn recovery events into one real entry fetch');assert.equal(refreshReads[0]?.status,200);
  results.push({scenario:'recovery-event-burst',status:'PASS',trigger:'DOM synthetic visibilitychange/pageshow/focus/online events drive the real production runtime',entry_requests:refreshReads.length,requests:refreshReads});
  await additionalScenarios(options,directory,results);
  let media:Record<string,unknown>={status:'NOT_RUN',reason:'A bound media fixture was not supplied'};
  if(options.media){
    options.clearNetwork();await direct(options,'request',options.media.requestRef);
    await pointer(browser,`document.querySelector('[data-h5-action="supplement"]')`);await browser.waitFor(`!!document.querySelector('[role=dialog]')`,{timeoutMs:15000});await closeDialog(browser);
    await browser.evaluate(`document.querySelector('.material-image')?.scrollIntoView({block:'center',behavior:'instant'})`);
    await browser.waitFor(`[...document.querySelectorAll('.material-image img')].some(image=>image.complete&&image.naturalWidth>0)`,{timeoutMs:20000});
    const reads=options.network().filter(item=>item.path.includes('/media/'));
    assert.ok(reads.some(item=>item.variant==='THUMBNAIL'&&item.status===200),'a real encrypted thumbnail must have been read');
    assert.equal(reads.some(item=>item.variant==='ORIGINAL'),false);
    assert.equal(reads.some(item=>item.path.endsWith('/'+options.media?.voiceRef)||item.path.endsWith('/'+options.media?.videoRef)),false);
    await writeFile(path.join(directory,'bound-media-private-previews.png'),Buffer.from(await browser.screenshot(),'base64'));
    const video=await progressive(options,directory,'video',options.media.videoRef,options.media.videoBytes);
    const audio=await progressive(options,directory,'audio',options.media.voiceRef,options.media.voiceBytes);
    media={status:video.status==='PASS'&&audio.status==='PASS'?'PASS':'FAIL',images:options.media.images.length,voice:1,video:1,reads,original_auto_reads:0,audio_video_auto_reads:0,progressive_first_frame:{video,audio,scope:'Browser receives real protected media over the throttled client connection. The existing TLS test proxy buffers upstream output; backend backpressure and output leases are tested separately.'}};
  }
  try{
  await direct(options,'request');assert.equal(await browser.evaluate(`!!document.querySelector('[data-h5-action="supplement"]')`),true);options.armReadFailureAfterUrge();
  await pointer(browser,`document.querySelector('[data-h5-action="urge"]')`);
  await browser.waitFor(`document.body.textContent.includes('已提交，页面同步失败')&&!document.body.textContent.includes('提交结果暂未确认')`,{timeoutMs:30000});
  assert.equal(await browser.evaluate(`document.querySelector('[data-h5-action="supplement"]').disabled`),true,'the current request stays write-locked until its new version is synchronized');
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-h5-write-ready="false"]')&&document.querySelector('[data-h5-action="urge"]').disabled`),true);
  await writeFile(path.join(directory,'committed-read-failure.png'),Buffer.from(await browser.screenshot(),'base64'));
  results.push({scenario:'real-urge-committed-read-failure',status:'PASS',unknown_notice:false,request_write_locked:true});
  }catch(error){results.push({scenario:'real-urge-committed-read-failure',status:'FAIL',reason:error instanceof Error?error.message:'URGE_FAILED',observed_unknown:await browser.evaluate(`document.body.textContent.includes('提交结果暂未确认')`)});await writeFile(path.join(directory,'urge-failure.png'),Buffer.from(await browser.screenshot(),'base64'));}finally{options.clearReadFailure();}
  const result={schema_version:1,mode:'SYNTHETIC_COMPILED_REAL_HTTP',results,media,real_wecom_devices:'NOT_RUN'};
  await writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2)+'\n');assert.ok(results.every(item=>item.status==='PASS')&&media.status==='PASS','H5_BROWSER_QA_REQUIRED_SCENARIOS_FAILED');return result;
}
