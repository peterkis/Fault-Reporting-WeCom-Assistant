import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as nativeRequest} from 'node:http';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {renderEmbeddedLogin,embeddedLoginHeaders,serveEmbeddedLoginAsset} from '../app/server/src/workbench-embedded-login.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {loginGpuFaultModes,loginGpuFaultScript,readLoginGpuFaultSnapshot,assertLoginGpuFaultReleased,type LoginGpuFaultSnapshot} from './helpers/desktop-login-gpu-fault-fixture.mjs';

test('compiled login prepares once under the native cover, presents the same iframe and exposes initializer/compatibility recovery',{timeout:90_000},async()=>{
 let origin='',generation=0;
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){
   generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.preparation-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;
  }
  response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><title>合成准备态测试起点</title>');
 })().catch(()=>{response.writeHead(500);response.end('SYNTHETIC_LOGIN_FIXTURE_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true});assert.ok(browser);
  await browser.command('Network.enable');await browser.command('Network.setBlockedURLs',{urls:['https://login.work.weixin.qq.com/*']});
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`
   Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});
   window.__preparedCalls=[];window.__present=null;
   const mode=sessionStorage.getItem('startup-test-mode')||'held';
   window.workbenchLogin={version:1,getAppVersion:async()=>'0.1.16-synthetic',quit:async()=>{},startup:{version:1,
    prepared:async value=>{window.__preparedCalls.push(value);if(mode==='rejected')throw Error('SYNTHETIC_BRIDGE_REJECTED');if(mode==='timeout')return new Promise(()=>{});return {presented:false};},
    onPresented:callback=>{window.__present=callback;return()=>{window.__present=null;};}
   }};
   if(mode==='initializer-failed'){const original=document.createElement.bind(document);document.createElement=function(name,...args){if(String(name).toLowerCase()==='iframe')throw Error('SYNTHETIC_SDK_INITIALIZATION_FAILURE');return original(name,...args);};}
  `});
  await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  await browser.waitFor('document.body?.dataset.loginScene==="prepared"&&document.querySelector("#wecom-panel iframe")');
  assert.deepEqual(await browser.evaluate('window.__preparedCalls'),[{version:1,panel:'created',backdrop:'fallback'}],'prepared describes only observable local scene and SDK creation');
  assert.equal(await browser.evaluate('(()=>{const shell=document.getElementById("desktop-login");return shell.inert&&document.querySelector(".login-options").inert&&document.querySelector(".lanyard")?.dataset.openingReady!=="true"&&getComputedStyle(document.querySelector(".login-response")).animationPlayState==="paused"&&getComputedStyle(document.querySelector(".login-preparing")).display==="none";})()'),true,'the prepared scene has no second spinner or early entrance and remains inert');
  // Cross the acknowledgement deadline after an explicit accepted-but-not-presented
  // response, as when the native first playback is paused by a hidden window.
  await new Promise(resolve=>setTimeout(resolve,8200));
  assert.equal(await browser.evaluate('document.body.dataset.loginScene'),'prepared','an acknowledged native wait never starts the entrance on a wall-clock deadline');
  await browser.evaluate('window.__preparedIframe=document.querySelector("#wecom-panel iframe");window.__present();window.__present()');
  await browser.waitFor('document.body?.dataset.loginScene==="ready"&&document.querySelector(".lanyard")?.dataset.openingReady==="true"');
  assert.equal(await browser.evaluate('window.__preparedIframe===document.querySelector("#wecom-panel iframe")&&!document.getElementById("desktop-login").inert'),true,'presentation preserves the live SDK iframe and restores interactions');
  assert.equal(await browser.evaluate('window.__preparedCalls.length'),1,'duplicate presentation never re-reports or remounts the scene');
  for(const mode of ['rejected','timeout','initializer-failed'] as const){
   const previous=Number(await browser.evaluate('performance.timeOrigin'));await browser.evaluate('sessionStorage.setItem("startup-test-mode",'+JSON.stringify(mode)+')');await browser.command('Page.reload');
   await browser.waitFor('performance.timeOrigin!=='+previous+'&&document.body?.dataset.loginScene==='+JSON.stringify(mode==='initializer-failed'?'prepared':'ready'));
   if(mode==='initializer-failed'){
    assert.deepEqual(await browser.evaluate('window.__preparedCalls'),[{version:1,panel:'failed',backdrop:'fallback'}]);
    await browser.evaluate('window.__present()');await browser.waitFor('document.body.dataset.loginScene==="ready"');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("#wecom-panel .login-panel-failure"))&&document.querySelectorAll("#wecom-panel iframe").length===0&&document.getElementById("login-status").textContent.includes("未能加载")'),true,'an SDK initializer exception presents a reason inside the card');
    assert.equal(await browser.evaluate('(()=>{const button=document.getElementById("retry-login"),r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button;})()'),true,'direct recovery remains clickable outside the projected card');
   }else assert.equal(await browser.evaluate('document.body.dataset.startupCompatibility'),'bridge-'+(mode==='timeout'?'timeout':'rejected'),'a missing or rejected bridge acknowledgement has a bounded compatibility fallback');
  }
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});

// These faults exercise the compiled public login scene and actual WebGL. The
// provider stays blocked: an observable panel is never evidence of a scannable QR.
for(const mode of loginGpuFaultModes)test('compiled login GPU preparation '+mode,{timeout:90_000},async()=>{
 let origin='',generation=0,fixtureFailure:unknown;
 const proofs:LoginGpuFaultSnapshot[]=[];
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);
  if(url.pathname==='/gpu-proof'&&request.method==='POST'){
   const chunks:Buffer[]=[];let size=0;
   for await(const part of request){const chunk:unknown=part;assert.ok(Buffer.isBuffer(chunk));size+=chunk.length;assert.ok(size<16_000);chunks.push(chunk);}
   const value:unknown=JSON.parse(Buffer.concat(chunks).toString());proofs.push(readLoginGpuFaultSnapshot(value));response.writeHead(204);response.end();return;
  }
  if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){
   generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());
   response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.gpu-fault-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;
  }
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Synthetic GPU preparation test</title>');
 })().catch(error=>{fixtureFailure??=error;if(!response.headersSent)response.writeHead(500);response.end('SYNTHETIC_LOGIN_GPU_FIXTURE_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true});assert.ok(browser);
  await browser.command('Network.enable');await browser.command('Network.setBlockedURLs',{urls:['https://login.work.weixin.qq.com/*']});
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:loginGpuFaultScript(mode)});
  await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  if(mode==='abort'){
   await browser.waitFor('window.__loginGpuFault?.completionQueries>=2&&window.__loginGpuFault.framebuffersCreated>=2');
   const before=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   assert.equal(before.khrAvailable,true,'async cancellation must reach the actual KHR capability');assert.equal(before.iframeCreates,0);assert.equal(before.preparedCalls.length,0);
   // Observe cleanup in the live document, then independently navigate to verify
   // a trusted pagehide and idempotent disposal. Neither action reports prepared.
   await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));");
   const after=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));await delay(200);
   const settled=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   assert.equal(after.pendingPollTimers,0);assert.equal(settled.completionQueries,after.completionQueries,'aborted polling never resumes');
   assertLoginGpuFaultReleased(settled);assert.equal(settled.iframeCreates,0);assert.equal(settled.preparedCalls.length,0);
   await browser.command('Page.navigate',{url:origin+'/done'});await browser.waitFor('location.pathname==="/done"');
   for(let i=0;i<20&&!proofs.some(value=>value.trustedPagehide);i++)await delay(25);
   assert.ok(proofs.some(value=>value.trustedPagehide&&value.targetFramebuffersLive===0&&value.pendingPollTimers===0),'actual navigation confirms the cancelled scene stayed disposed');
   console.log('LOGIN_GPU_PREPARATION_FAULT',JSON.stringify({mode,before,after,settled,proofs}));
  }else{
   await browser.waitFor('document.body?.dataset.loginScene==="prepared"&&document.querySelector("#wecom-panel iframe")');
   const prepared=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   if(mode==='no-khr'){
    assert.ok(prepared.khrRequests>0);assert.equal(prepared.completionQueries,0);assert.ok(prepared.draws>0,'without KHR the original synchronous path still draws actual GL');
    assert.equal(prepared.view,'lanyard');assert.equal(generation,1);
   }else{
    assert.equal(prepared.view,'flat');assert.equal(generation,2,'a preparation fault recovers with a fresh complete login intent');
    for(let i=0;i<30&&!proofs.length;i++)await delay(25);
    const prior=proofs.find(value=>value.framebuffersCreated>0);assert.ok(prior,'the disposed GPU document must supply its cleanup receipt');
    assert.equal(prior.khrAvailable,true,'this fault must reach asynchronous preparation, not silently use an unsupported path');
    assert.equal(prior.iframeCreates,0,'failed GL preparation must not initialize the provider iframe');assert.equal(prior.preparedCalls.length,0,'compile completion or failure is not front-ready');
    assertLoginGpuFaultReleased(prior);
    if(mode==='context-loss'){assert.equal(prior.lossRequested,true);assert.ok(prior.contextLostEvents>0);assert.equal(prepared.fallback,'context-lost');}
    if(mode==='shader-link'){assert.equal(prior.badShaderInjected,true);assert.equal(prepared.fallback,'webgl-unavailable');}
    if(mode==='timeout'){
     assert.ok(prior.elapsedMs>=15_000,'the existing real 15-second scene deadline must not be shortened');
     assert.equal(prepared.fallback,'startup-timeout');
    }
   }
   assert.equal(prepared.iframeCreates,1);assert.equal(prepared.iframeCount,1);assert.equal(prepared.preparedCalls.length,1);
   await browser.evaluate('window.__loginGpuFaultIframe=document.querySelector("#wecom-panel iframe");window.__loginGpuFault.present();window.__loginGpuFault.present();');
   await browser.waitFor('document.body.dataset.loginScene==="ready"');
   const presented=readLoginGpuFaultSnapshot(await browser.evaluate('({...window.__loginGpuFault.snapshot(),sameIframe:window.__loginGpuFaultIframe===document.querySelector("#wecom-panel iframe"),retryEnabled:!document.getElementById("retry-login").disabled})'));
   assert.equal(presented.sameIframe,true,'duplicate presentation retains the one live provider iframe');assert.equal(presented.iframeCreates,1);assert.equal(presented.iframeCount,1);assert.equal(presented.preparedCalls.length,1);assert.equal(presented.retryEnabled,true,'recovered login remains actionable');
   console.log('LOGIN_GPU_PREPARATION_FAULT',JSON.stringify({mode,generation,prepared,presented,proofs}));
  }
  if(fixtureFailure)throw fixtureFailure;
 }catch(error){
  failure=error;let snapshot:unknown=null;try{snapshot=await browser?.evaluate('window.__loginGpuFault?.snapshot?.()??null');}catch{/* The failed document may already have navigated. */}
  console.log('LOGIN_GPU_PREPARATION_FAULT_FAILURE',JSON.stringify({mode,generation,proofs,snapshot}));
 }finally{
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);
 }
});

test('compiled embedded login keeps one iframe during badge interaction and renews on view or scale fallback',{timeout:120_000},async()=>{
 let generation=0,origin='';
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);
  if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){
   generation++;const now=Date.now();
   const html=await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.synthetic-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin});
   response.writeHead(200,embeddedLoginHeaders());response.end(html);return;
  }
  response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><title>合成登录测试起点</title>');
 })().catch(()=>{response.writeHead(500);response.end('SYNTHETIC_LOGIN_FIXTURE_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  const shell=await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.encoding-check',issuedEpochMs:0,expiresEpochMs:300_000,publicOrigin:origin});
  const script=/<script type="module" src="([^"]+)"/u.exec(shell)?.[1];assert.ok(script);
  const raw=(file:string,encoding?:string,method='GET')=>new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:Buffer}>((resolve,reject)=>{
   const request=nativeRequest(origin+file,{method,headers:encoding===undefined?{}:{'accept-encoding':encoding}},response=>{const chunks:Buffer[]=[];response.on('data',(part:Buffer)=>chunks.push(part));response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode??0,headers:response.headers,body:Buffer.concat(chunks)}));});request.once('error',reject);request.end();
  });
  const identity=await raw(script);assert.equal(identity.status,200);assert.equal(identity.headers['content-encoding'],undefined);
  for(const [header,expected]of [['br,gzip','br'],['gzip','gzip'],['gzip;q=1,br;q=0.5','gzip'],['BR;q=0.7,gzip;q=0.8,identity;q=0','gzip'],['br;q=0,gzip;q=0','identity'],['*;q=0.5,identity;q=0','br']] as const){
   const response=await raw(script,header);assert.equal(response.status,200);assert.equal(response.headers['content-encoding'],expected==='identity'?undefined:expected);assert.equal(response.headers.vary,'Accept-Encoding');assert.equal(response.headers['content-length'],String(response.body.length));assert.equal(response.headers['cache-control'],'public, max-age=31536000, immutable');
   const decoded=expected==='br'?brotliDecompressSync(response.body):expected==='gzip'?gunzipSync(response.body):response.body;assert.deepEqual(decoded,identity.body,'all negotiated representations decode to the exact same module');
   const head=await raw(script,header,'HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],response.headers['content-length']);assert.equal(head.headers['content-encoding'],response.headers['content-encoding']);
  }
  for(const header of ['*;q=0','identity;q=0,br;q=0,gzip;q=0','identity;q=0,gzip;q=2,br;q=0'])assert.equal((await raw(script,header)).status,406);
  for(const suffix of ['.gz','.br','?raw=1'])assert.equal((await raw(script+suffix,'br,gzip')).status,400,'encoding sidecars and queries never become new public paths');
  assert.equal((await raw('/workbench/desktop/assets/unmanifested.js','br,gzip')).status,404);
  const styles=[...shell.matchAll(/href="([^"<>]+\.css)"/gu)].map(match=>match[1]);assert.ok(styles.length);
  const fontPaths=new Set<string>();
  for(const style of styles){assert.ok(style);const response=await raw(style);assert.equal(response.status,200);for(const match of response.body.toString().matchAll(/url\(["']?(\/workbench\/desktop\/assets\/[^"')]+\.woff2)["']?\)/gu)){assert.ok(match[1]);fontPaths.add(match[1]);}assert.equal(/url\(["']?data:font/iu.test(response.body.toString()),false);}
  assert.equal(fontPaths.size,99,'F1 login uses the same local unicode-range shards');
  const fontPath=[...fontPaths][0];assert.ok(fontPath);const font=await raw(fontPath,'br,gzip');assert.equal(font.status,200);assert.equal(font.headers['content-type'],'font/woff2');assert.equal(font.headers['content-encoding'],undefined);assert.equal(font.body.subarray(0,4).toString(),'wOF2');
  const fontHead=await raw(fontPath,'br,gzip','HEAD');assert.equal(fontHead.status,200);assert.equal(fontHead.body.length,0);assert.equal(fontHead.headers['content-length'],String(font.body.length));
  assert.equal((await raw(fontPath,'identity;q=0,br,gzip')).status,406);assert.equal((await raw('/workbench/desktop/assets/inter-latin-wght-normal-unmanifested.woff2')).status,404);
  assert.equal((await raw(fontPath+'?raw=1')).status,400);assert.equal((await raw(fontPath+'.br')).status,400);
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true});assert.ok(browser);
  const loginBrowser=browser;
  const waitScene=()=>loginBrowser.waitFor('document.body?.dataset.loginScene==="ready"');
  const clickLogin=async(selector:string)=>{
   await waitScene();
   const target=await loginBrowser.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()') as {x:number;y:number;width:number;height:number}|null;
   assert.ok(target&&target.width>0&&target.height>0,'login control must be visible before clicking: '+selector);
   for(const type of ['mousePressed','mouseReleased'])await loginBrowser.command('Input.dispatchMouseEvent',{type,x:target.x,y:target.y,button:'left',clickCount:1});
  };
  await browser.command('Network.enable');
  // No synthetic credentials or QR requests leave this isolated browser.
  await browser.command('Network.setBlockedURLs',{urls:['https://login.work.weixin.qq.com/*']});
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const loginHostScript=await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__quitRequests=0;window.__paintedVersions=[];window.workbenchLogin={version:1,getAppVersion:async()=>"0.1.10-synthetic",quit:async()=>{window.__quitRequests++}};const originalFillText=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(String(text).startsWith("v0.1."))window.__paintedVersions.push(String(text));return originalFillText.call(this,text,...args);};'}) as {identifier:string};
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__backgroundSubmits=0;if(window.GPUQueue){const submit=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...args){window.__backgroundSubmits++;return submit.apply(this,args);};}'});
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__preparingLoader=null;window.__sceneAppearance=null;const sceneObserver=new MutationObserver(()=>{const e=document.querySelector(".login-preparing .loader");if(!window.__preparingLoader&&e&&document.body?.dataset.loginScene==="loading"){const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(s.animationName==="l20-1, l20-2")window.__preparingLoader={width:e.offsetWidth,height:e.offsetHeight,centered:Math.abs(r.x+r.width/2-innerWidth/2)<1&&Math.abs(r.y+r.height/2-innerHeight/2)<1,border:s.borderTopWidth,color:s.borderTopColor,duration:s.animationDuration,animation:s.animationName,direction:s.animationDirection,timing:s.animationTimingFunction,label:e.parentElement.getAttribute("aria-label"),text:e.textContent};}if(window.__sceneAppearance||document.body?.dataset.loginScene!=="ready")return;window.__sceneAppearance={mode:document.body.dataset.backdrop,visibility:[".login-copy","#login-backdrop",".lanyard-front",".login-footer"].map(s=>{const e=document.querySelector(s);return e?getComputedStyle(e).visibility:null})};});sceneObserver.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:["data-login-scene"]});'});
  await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  await browser.waitFor('document.querySelector(".lanyard-front #wecom-panel iframe")&&document.querySelector("#desktop-login")?.dataset.view==="lanyard"');
  await waitScene();
  assert.equal(generation,1);assert.equal(await browser.evaluate('document.querySelectorAll("#wecom-panel iframe").length'),1);
  assert.deepEqual(await browser.evaluate('window.__preparingLoader'),{width:50,height:50,centered:true,border:'8px',color:'rgb(81, 75, 130)',duration:'0.8s, 1.6s',animation:'l20-1, l20-2',direction:'alternate, normal',timing:'linear, linear',label:'Loading login page',text:''},'old clients retain the remote preparation spinner until the scene can appear');
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".login-preparing")).display'),'none','the loader retires when the complete login scene appears');
  assert.equal(await browser.evaluate('(()=>{const e=document.getElementById("login-backdrop"),r=e.getBoundingClientRect();return e.inert&&e.getAttribute("aria-hidden")==="true"&&getComputedStyle(e).pointerEvents==="none"&&r.width>=innerWidth&&r.height>=innerHeight;})()'),true,'the hero covers the viewport without intercepting login controls');
  assert.deepEqual(await browser.evaluate('window.__sceneAppearance.visibility'),['visible','visible','visible','visible'],'title, background, card and footer first appear in one scene');
  assert.notEqual(await browser.evaluate('window.__sceneAppearance.mode'),'pending');
  assert.equal(await browser.evaluate('(()=>{const text=document.getElementById("login-gesture"),host=text?.closest(".lanyard-hint"),panel=document.querySelector(".lanyard-front"),r=document.createRange();if(!text||!host||!panel||!text.closest(".lanyard-hint-layer"))return false;r.selectNodeContents(text);const t=r.getBoundingClientRect(),h=host.getBoundingClientRect(),p=panel.getBoundingClientRect();return document.querySelectorAll("#login-gesture").length===1&&!document.querySelector(".login-content>.login-gesture")&&Math.abs(t.x+t.width/2-h.x-h.width/2)<1.5&&Math.abs(t.y+t.height/2-h.y-h.height/2)<1.5&&Math.abs(h.x+h.width/2-p.x-p.width/2)<1.5&&Math.abs(h.y-p.bottom)<1.5&&h.height>0&&h.height<p.height*.2&&document.querySelector("#wecom-panel").clientWidth===320&&document.querySelector("#wecom-panel").clientHeight===380;})()'),true,'the caption is centered in the bottom card border, below the unchanged full login panel');
  const shine=await browser.evaluate('(()=>{const text=document.getElementById("login-gesture"),animation=text.getAnimations().find(a=>a.animationName==="login-gesture-shine");if(!animation)return null;animation.pause();const positions=[0,900,1800,2700].map(time=>{animation.currentTime=time;return getComputedStyle(text).backgroundPositionX});animation.play();return {positions,duration:getComputedStyle(text).animationDuration,pointerEvents:getComputedStyle(text).pointerEvents};})()');
  assert.deepEqual(shine,{positions:['0px','90px','180px','180px'],duration:'3s',pointerEvents:'none'},'the reference shine sweeps during the first 60 percent and holds without intercepting drag input');
  if(await browser.evaluate('!!navigator.gpu')){
    await waitScene();
    if(await browser.evaluate('document.querySelector("[data-blob-state]")?.dataset.blobState==="ready"')){
      const frequency=await browser.evaluate('new Promise(resolve=>{const before=window.__backgroundSubmits,start=performance.now();setTimeout(()=>resolve((window.__backgroundSubmits-before)*1000/(performance.now()-start)),2200)})') as number;
      assert.ok(frequency>=20&&frequency<=35,'only the background renders near 30fps: '+frequency);
      assert.equal(await browser.evaluate('(()=>{const c=document.querySelector(".login-blob");return c.width*c.height<=550000&&getComputedStyle(c).transitionDuration==="0s"})()'),true,'full-screen display uses the 550k render budget without a late fade');
      await browser.evaluate('window.__blobPanel=document.querySelector("#wecom-panel iframe");Object.defineProperty(navigator,"onLine",{configurable:true,value:false});window.dispatchEvent(new Event("offline"))');
      await browser.waitFor('document.querySelector("[data-blob-state]")?.dataset.blobState==="paused"');
      assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("[data-blob-state]")).animationPlayState'),'paused','offline pauses the breathing motion while retaining the last frame');
      await browser.evaluate('delete navigator.onLine;window.dispatchEvent(new Event("online"))');
      await browser.waitFor('document.querySelector("[data-blob-state]")?.dataset.blobState==="ready"');
      assert.equal(await browser.evaluate('window.__blobPanel===document.querySelector("#wecom-panel iframe")'),true,'pausing/resuming the background never replaces the login attempt');
    }
  }
  assert.equal(await browser.evaluate('typeof window.workbenchDesktop+":"+typeof require'),'undefined:undefined');
  await browser.waitFor('window.__paintedVersions.includes("v0.1.10-synthetic")');
  assert.equal(await browser.evaluate('document.getElementById("desktop-login").dataset.appVersion'),'0.1.10-synthetic','the back label comes from the host rather than a hard-coded release');
  assert.equal(await browser.evaluate('document.querySelector(".login-description,.login-eyebrow")===null'),true,'login removes redundant surrounding copy');
  assert.equal(await browser.evaluate('(()=>{const line=document.querySelector(".login-heading-line");const a=document.createRange(),b=document.createRange();a.selectNodeContents(line.children[0]);b.selectNodeContents(line.children[1]);return Math.abs(a.getBoundingClientRect().y-b.getBoundingClientRect().y)<0.5;})()'),true,'plain and highlighted headline glyphs share the same vertical position');
  assert.equal(await browser.evaluate('(()=>{const heading=document.querySelector(".login-copy h1"),line=document.querySelector(".login-heading-line"),a=document.createRange(),b=document.createRange();a.selectNode(heading.firstChild);b.selectNodeContents(line.children[0]);const start=b.getBoundingClientRect(),next=line.children[1].getBoundingClientRect();return start.x-a.getBoundingClientRect().x>=parseFloat(getComputedStyle(heading).fontSize)*1.4&&next.x-start.right>=5;})()'),true,'the second line is offset and has breathing room before the capsule');
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".login-response"),"::before").animationDuration'),'24s','reduced motion slows the color-only dot cycle');
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".login-response")).animationDuration'),'24s','the reduced-motion capsule uses the same slower cycle');
  const reducedPalette=await browser.evaluate('(()=>{const capsule=document.querySelector(".login-response"),animations=document.getAnimations();for(const animation of animations)animation.pause();const samples=[0,6000,12000,18000,24000].map(time=>{for(const animation of animations)animation.currentTime=time;return {capsule:getComputedStyle(capsule).backgroundColor,dot:getComputedStyle(capsule,"::before").backgroundColor};});for(const animation of animations)animation.play();return samples;})()') as {capsule:string;dot:string}[];
  assert.equal(new Set(reducedPalette.slice(0,4).map(stage=>stage.capsule)).size,4,'reduced motion preserves four gentle capsule colors');
  assert.equal(new Set(reducedPalette.slice(0,4).map(stage=>stage.dot)).size,4,'reduced motion preserves the paired dot colors');
  assert.deepEqual(reducedPalette[4],reducedPalette[0]);
  await browser.waitFor('Boolean(document.querySelector("#login-more-icon svg.lucide-ellipsis"))');
  assert.equal(await browser.evaluate('document.getElementById("login-options-menu").matches(":popover-open")'),false);
  await clickLogin('#login-more');await browser.waitFor('document.getElementById("login-options-menu").matches(":popover-open")');
  assert.equal(await browser.evaluate('(()=>{const b=document.getElementById("restart-login"),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()'),true,'fallback actions remain clickable in the popover');
  for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await browser.waitFor('!document.getElementById("login-options-menu").matches(":popover-open")');
  await clickLogin('#login-more');await browser.waitFor('document.getElementById("login-options-menu").matches(":popover-open")');
  await clickLogin('#quit-desktop');assert.equal(await browser.evaluate('window.__quitRequests'),1,'the bottom menu action invokes the dedicated application quit capability');
  await browser.waitFor('!document.getElementById("login-options-menu").matches(":popover-open")');
  await browser.evaluate('window.__originalPanel=document.querySelector("#wecom-panel iframe");window.__originalHint=document.getElementById("login-gesture")');
  const point=await browser.evaluate('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()') as {x:number;y:number};
  const oldSlotLeft=Number(await browser.evaluate('document.getElementById("lanyard-stage").getBoundingClientRect().left'));
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-360,y:point.y,button:'left',buttons:1});
  await browser.waitFor('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return r.x+r.width/2<'+(oldSlotLeft-35)+';})()');
  assert.equal(await browser.evaluate('(()=>{const p=document.querySelector(".lanyard-front").getBoundingClientRect(),c=document.querySelector(".lanyard-canvas").getBoundingClientRect(),d=document.querySelector(".lanyard-css3d").getBoundingClientRect();return c.x<=p.x&&c.y<=p.y&&c.right>=p.right&&c.bottom>=p.bottom&&d.x<=p.x&&d.y<=p.y&&d.right>=p.right&&d.bottom>=p.bottom;})()'),true,'both drawing surfaces must cover the card beyond its original layout slot');
  assert.equal(await browser.evaluate('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.className;})()'),'lanyard-interaction','dragged badge stays above adjacent copy');
  assert.equal(await browser.evaluate('document.elementFromPoint(10,10)?.className.includes("lanyard")'),false,'empty viewport space passes input through');
  assert.equal(await browser.evaluate('(()=>{const b=document.getElementById("login-more"),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===b;})()'),true,'full viewport drawing must not cover the more button');
  assert.equal(await browser.evaluate('window.__originalPanel===document.querySelector("#wecom-panel iframe")'),true);assert.equal(generation,1);
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-360,y:point.y,button:'left',clickCount:1});
  await browser.waitFor('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return Math.abs(r.x+r.width/2-'+point.x+')<8;})()');
  const flipPoint=await browser.evaluate('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()') as {x:number;y:number};
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',...flipPoint,button:'left',clickCount:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',...flipPoint,button:'left',clickCount:1});
  await browser.waitFor('document.querySelector(".lanyard-front")?.getAttribute("aria-hidden")==="true"');
  assert.equal(await browser.evaluate('document.querySelector(".lanyard-hint").getAttribute("aria-hidden")'), 'true','the front caption disappears on the back side');
  assert.equal(await browser.evaluate('window.__originalHint===document.getElementById("login-gesture")'),true,'dragging and flipping preserve the same caption element');
  assert.equal(await browser.evaluate('window.__originalPanel===document.querySelector("#wecom-panel iframe")'),true,'flipping preserves the same live iframe');assert.equal(generation,1);
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+70,y:point.y+35,button:'left',buttons:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+70,y:point.y+35,button:'left',clickCount:1});
  assert.equal(await browser.evaluate('window.__originalPanel===document.querySelector("#wecom-panel iframe")'),true,'dragging does not renew or reparent the iframe');assert.equal(generation,1);
  assert.equal(await browser.evaluate('(()=>{const gl=document.querySelector(".lanyard-canvas").getContext("webgl2"),ext=gl?.getExtension("WEBGL_lose_context");if(!ext)return false;ext.loseContext();return true;})()'),true);
  await browser.waitFor('document.querySelector("#desktop-login")?.dataset.view==="flat"&&Boolean(document.querySelector(".login-panel-parking iframe"))');
  assert.equal(generation,2,'context loss renews one complete attempt');
  assert.equal(await browser.evaluate('document.getElementById("desktop-login").dataset.fallbackReason'),'context-lost');
  assert.notEqual(await browser.evaluate('sessionStorage.getItem("workbench-login-view-v2")'),'flat','automatic fallback does not become a user preference');
  await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'flat login remains usable at narrow width');
  assert.equal(await browser.evaluate('document.querySelector("#wecom-panel").getBoundingClientRect().width'),320,'flat panel keeps its native width');
  await clickLogin('#login-more');await browser.waitFor('document.getElementById("login-options-menu").matches(":popover-open")');await clickLogin('#switch-login-view');
  await browser.waitFor('document.querySelector(".lanyard-front iframe")&&document.querySelector("#desktop-login")?.dataset.view==="lanyard"');assert.equal(generation,3);
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1.25,mobile:false});
  await browser.waitFor('document.querySelector("#desktop-login")?.dataset.view==="flat"&&Boolean(document.querySelector(".login-panel-parking iframe"))');assert.equal(generation,4);
  assert.equal(await browser.evaluate('document.getElementById("switch-login-view").hidden'),true);
  const previousLoginOrigin=await browser.evaluate('performance.timeOrigin');
  await browser.evaluate('window.dispatchEvent(new Event("workbench-login-expired"));window.dispatchEvent(new Event("workbench-login-expired"))');
  await browser.waitFor('Boolean(document.querySelector(".login-panel-parking iframe"))&&performance.timeOrigin>'+Number(previousLoginOrigin));
  assert.equal(generation,5,'overlapping resume checks renew only once');
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await browser.evaluate('sessionStorage.removeItem("workbench-login-view-v2")');
  // Install before navigation and measure the original window from actual presentation.
  // The cold replay blocks only the first real physics callback, not the measured motion.
  for(const coldFrame of [false,true]){
    const coldHook=coldFrame?await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__coldFrameInjected=false;window.__coldFrameOriginalRAF=window.requestAnimationFrame;window.requestAnimationFrame=callback=>window.__coldFrameOriginalRAF.call(window,now=>{if(!window.__coldFrameInjected&&document.body?.dataset.loginScene==="ready"&&String(callback).includes("1/240")&&String(callback).includes("2600")){window.__coldFrameInjected=true;const end=performance.now()+2700;while(performance.now()<end){}}callback(now);});'}) as {identifier:string}:null;
    const introSampler=await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__introMotion=new Promise(resolve=>{let start=null,panel=null;const samples=[];const sample=now=>{const face=document.querySelector(".lanyard-front");if(start===null&&document.body?.dataset.loginScene==="ready"&&document.querySelector(".lanyard")?.dataset.openingReady==="true"&&face?.querySelector("iframe")){start=now;panel=face.querySelector("iframe");}if(start!==null){const r=face.getBoundingClientRect();samples.push({t:now-start,x:r.x+r.width/2});if(now-start>=3600){const early=samples.filter(p=>p.t<2600).map(p=>p.x),late=samples.filter(p=>p.t>=3000).map(p=>p.x);resolve({range:Math.max(...early)-Math.min(...early),lateRange:Math.max(...late)-Math.min(...late),samePanel:panel===document.querySelector(".lanyard-front iframe"),reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches,samples:samples.length,largestGap:Math.max(0,...samples.slice(1).map((p,i)=>p.t-samples[i].t)),backdrop:document.body.dataset.backdrop,backdropReason:document.body.dataset.backdropReason??null,visibility:document.visibilityState});return;}}requestAnimationFrame(sample);};requestAnimationFrame(sample);});'}) as {identifier:string};
    const previousMotionOrigin=await browser.evaluate('performance.timeOrigin');
    await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
    await browser.waitFor('performance.timeOrigin!=='+Number(previousMotionOrigin)+'&&Boolean(document.querySelector(".lanyard-front iframe"))');
    await waitScene();
    await browser.waitFor('document.querySelector(".lanyard")?.dataset.openingReady==="true"');
    const introMotion=await browser.evaluate('window.__introMotion') as {range:number;lateRange:number;samePanel:boolean;reducedMotion:boolean;samples:number;largestGap:number;backdrop:string;backdropReason:string|null;visibility:string};
    await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:introSampler.identifier});
    if(coldHook){assert.equal(await browser.evaluate('window.__coldFrameInjected'),true,'the replay must exercise the real physics frame');await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:coldHook.identifier});await browser.evaluate('window.requestAnimationFrame=window.__coldFrameOriginalRAF');}
    console.log('LOGIN_OPENING_METRICS',JSON.stringify({coldFrame,...introMotion}));
    assert.equal(introMotion.reducedMotion,false,'the physical opening is measured with full motion');
    assert.ok(introMotion.range>=6,'the initial physical swing is visible: '+JSON.stringify(introMotion));
    assert.ok(introMotion.lateRange<1,'the one-shot swing settles after about three seconds: '+JSON.stringify(introMotion));
    assert.equal(introMotion.samePanel,true,'the intro preserves the mounted QR iframe');
  }
  if(await browser.evaluate('!!navigator.gpu')){
    await waitScene();
    assert.equal(await browser.evaluate('document.querySelectorAll("#wecom-panel iframe").length'),1,'full-motion opening must start the background without renewing the QR attempt');
    await browser.command('Page.reload');await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
    await waitScene();
    const early=await browser.evaluate('(()=>{window.__interruptedPanel=document.querySelector("#wecom-panel iframe");const r=document.querySelector(".lanyard-front").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()') as {x:number;y:number};
    for(const type of ['mousePressed','mouseReleased'])await browser.command('Input.dispatchMouseEvent',{type,x:early.x,y:early.y,button:'left',clickCount:1});
    await waitScene();
    assert.equal(await browser.evaluate('window.__interruptedPanel===document.querySelector("#wecom-panel iframe")'),true,'interrupting the opening still starts decoration and retains the same QR');
  }
  const paletteCycle=await browser.evaluate('(()=>{const capsule=document.querySelector(".login-response"),animations=document.getAnimations();for(const animation of animations)animation.pause();const samples=[0,3000,6000,9000,12000].map(time=>{for(const animation of animations)animation.currentTime=time;return {capsule:getComputedStyle(capsule).backgroundColor,dot:getComputedStyle(capsule,"::before").backgroundColor};});for(const animation of animations)animation.play();return samples;})()') as {capsule:string;dot:string}[];
  assert.equal(new Set(paletteCycle.slice(0,4).map(stage=>stage.capsule)).size,4,'the capsule visibly changes through four color stages');
  assert.equal(new Set(paletteCycle.slice(0,4).map(stage=>stage.dot)).size,4,'the dot changes on the same four stages');
  assert.deepEqual(paletteCycle[4],paletteCycle[0],'both colors return together to the first stage');
  await browser.evaluate('document.querySelector(".lanyard-canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()');
  await browser.waitFor('document.getElementById("desktop-login")?.dataset.view==="flat"&&Boolean(document.querySelector(".login-panel-parking iframe"))');
  await browser.command('Page.reload');
  await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
  assert.equal(await browser.evaluate('document.getElementById("desktop-login").dataset.view'),'lanyard','the next complete attempt retries the badge after a temporary failure');
  await clickLogin('#login-more');await browser.waitFor('document.getElementById("login-options-menu").matches(":popover-open")');await clickLogin('#switch-login-view');
  await browser.waitFor('document.getElementById("desktop-login")?.dataset.view==="flat"&&Boolean(document.querySelector(".login-panel-parking iframe"))');
  await browser.command('Page.reload');
  await browser.waitFor('document.getElementById("desktop-login")?.dataset.view==="flat"&&Boolean(document.querySelector(".login-panel-parking iframe"))');
  assert.equal(await browser.evaluate('sessionStorage.getItem("workbench-login-view-v2")'),'flat','explicit flat selection survives a complete refresh');
  await browser.evaluate('sessionStorage.removeItem("workbench-login-view-v2");sessionStorage.setItem("workbench-login-view","flat")');
  await browser.command('Page.reload');
  await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
  assert.equal(await browser.evaluate('sessionStorage.getItem("workbench-login-view")'),null,'the ambiguous legacy fallback preference is cleared once');
  if(await browser.evaluate('!!navigator.gpu')){
    const delayed=await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'if(navigator.gpu){const adapter=navigator.gpu.requestAdapter.bind(navigator.gpu);navigator.gpu.requestAdapter=(...args)=>new Promise(resolve=>setTimeout(()=>resolve(adapter(...args)),12000));}'}) as {identifier:string};
    await browser.command('Page.reload');await waitScene();
    assert.equal(await browser.evaluate('document.body.dataset.backdrop'),'fallback','a slow GPU yields one coherent fallback scene within the startup bound');
    await browser.evaluate('window.__fallbackPanel=document.querySelector("#wecom-panel iframe")');
    await new Promise(resolve=>setTimeout(resolve,5500));
    assert.equal(await browser.evaluate('document.body.dataset.backdrop'),'fallback','a late GPU never fades a second background into the visible scene');
    assert.equal(await browser.evaluate('window.__fallbackPanel===document.querySelector("#wecom-panel iframe")'),true);
    await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:delayed.identifier});
  }
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__hiddenStartup=true;Object.defineProperty(document,"hidden",{get:()=>window.__hiddenStartup});Object.defineProperty(document,"visibilityState",{get:()=>window.__hiddenStartup?"hidden":"visible"});const realRaf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>window.__hiddenStartup?0:realRaf(fn);'});
  await browser.command('Page.reload');
  await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
  await browser.evaluate('window.__hiddenPanel=document.querySelector(".lanyard-front iframe")');
  const hiddenGeneration=generation;
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".login-response"),"::before").animationPlayState'),'paused');
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".login-response")).animationPlayState'),'paused');
  // Pass the actual startup deadline with rAF unavailable. The document must not fall back.
  await new Promise(resolve=>setTimeout(resolve,16_000));
  assert.equal(generation,hiddenGeneration,'background initialization does not trigger the startup timeout');
  assert.equal(await browser.evaluate('document.getElementById("desktop-login").dataset.view'),'lanyard');
  await browser.evaluate('window.__hiddenStartup=false;document.dispatchEvent(new Event("visibilitychange"))');
  await browser.waitFor('document.getElementById("desktop-login").dataset.pageHidden==="false"');
  assert.equal(await browser.evaluate('window.__hiddenPanel===document.querySelector(".lanyard-front iframe")'),true,'returning to the page keeps the mounted official panel');
  await waitScene();
  await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:loginHostScript.identifier});await browser.command('Page.reload');
  await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
  assert.equal(await browser.evaluate('document.getElementById("quit-desktop").hidden'),true,'a plain browser does not display an unusable native quit action');
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"gpu",{configurable:true,value:undefined})'});
  await browser.command('Page.reload');await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
  assert.equal(await browser.evaluate('document.getElementById("login-backdrop").childElementCount'),0,'missing WebGPU leaves the static background while the QR panel remains usable');
  assert.equal(await browser.evaluate('performance.getEntriesByType("resource").some(e=>e.name.includes("LoginBackdrop-"))'),false,'unsupported GPUs do not download the optional shader engine');
 }catch(error){failure=error;if(browser)console.log('EMBEDDED_LOGIN_UI_DIAGNOSTIC',JSON.stringify(await browser.evaluate('({view:document.getElementById("desktop-login")?.dataset.view,frames:document.querySelectorAll("#wecom-panel iframe").length,canvas:document.querySelectorAll(".lanyard-canvas").length,status:document.getElementById("login-status")?.textContent})')));}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});
