import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {setTimeout as delay,setImmediate as nextTurn} from 'node:timers/promises';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {createNeutralProviderFixture} from './helpers/desktop-login-backdrop-pipeline-fixture.mjs';
import {renderEmbeddedLogin,embeddedLoginHeaders,serveEmbeddedLoginAsset} from '../app/server/src/workbench-embedded-login.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {loginGpuFaultModes,loginGpuFaultScript,readLoginGpuFaultSnapshot,assertLoginGpuFaultReleased,loginEnvironmentFaultModes,loginEnvironmentFaultScript,readLoginEnvironmentFaultSnapshot,type LoginEnvironmentFaultSnapshot,type LoginGpuFaultSnapshot} from './helpers/desktop-login-gpu-fault-fixture.mjs';

// Keep independent native GPU/asset faults within the unchanged per-entry budget.
// Every browser retains its own serial lifetime and original case deadline.
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
   await browser.waitFor('window.__loginGpuFault?.completionQueries>=2&&window.__loginGpuFault.environmentDigestSettled===2');
   const before=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   assert.equal(before.khrAvailable,true,'async cancellation must reach the actual KHR capability');assert.equal(before.environmentObjectsCreated,1);assert.equal(before.environmentObjectsDisposed,0);assert.equal(before.environmentCpuBytes,6291456);assert.equal(before.environmentCpuHalfWords,3145728);assert.equal(before.environmentUploads,0,'compile-only has not used a native environment texture yet');assert.equal(before.iframeCreates,0);assert.equal(before.preparedCalls.length,0);
   // Observe cleanup in the live document, then independently navigate to verify
   // a trusted pagehide and idempotent disposal. Neither action reports prepared.
   await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));");
   const after=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));await delay(200);
   const settled=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   assert.equal(after.pendingPollTimers,0);assert.equal(settled.completionQueries,after.completionQueries,'aborted polling never resumes');
   assertLoginGpuFaultReleased(settled);assert.equal(settled.iframeCreates,0);assert.equal(settled.preparedCalls.length,0);
   await browser.command('Page.navigate',{url:origin+'/done'});await browser.waitFor('location.pathname==="/done"');
   for(let i=0;i<20&&!proofs.some(value=>value.trustedPagehide);i++)await delay(25);
   assert.ok(proofs.some(value=>value.trustedPagehide&&value.prototypeRestored&&value.environmentObjectsDisposed===1&&value.environmentCpuBytes===0&&value.managedTexturesLive===0&&value.targetFramebuffersLive===0&&value.pendingPollTimers===0),'actual navigation confirms the cancelled scene stayed disposed');
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

// Asset faults are independent of the original five shader/lifecycle modes.
// The provider is still blocked; these assertions say nothing about QR rendering.
for(const mode of loginEnvironmentFaultModes)test('compiled login environment asset '+mode,{timeout:90_000},async()=>{
 const inventory:unknown=JSON.parse(await readFile(new URL('../web/desktop-login/asset-inventory.json',import.meta.url),'utf8'));assert.ok(Array.isArray(inventory));
 const environments=inventory.filter((value:unknown):value is string=>typeof value==='string'&&/^assets\/login-environment-v1-[A-Za-z0-9_-]+\.pmrem$/u.test(value));assert.equal(environments.length,1);const environmentFile=environments[0];assert.ok(environmentFile);
 const payload=await readFile(new URL('../web/desktop-login/'+environmentFile,import.meta.url));assert.equal(payload.length,880178);
 const assetPath='/workbench/desktop/'+environmentFile;
 let origin='',generation=0,assetRequests=0,cancelledResponses=0,fixtureFailure:unknown;const proofs:LoginGpuFaultSnapshot[]=[],environmentProofs:LoginEnvironmentFaultSnapshot[]=[];
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);
  if(['/gpu-proof','/environment-proof'].includes(url.pathname)&&request.method==='POST'){
   const chunks:Buffer[]=[];let bytes=0;for await(const part of request){const chunk:unknown=part;assert.ok(Buffer.isBuffer(chunk));bytes+=chunk.length;assert.ok(bytes<16_000);chunks.push(chunk);}const value:unknown=JSON.parse(Buffer.concat(chunks).toString());
   if(url.pathname==='/gpu-proof')proofs.push(readLoginGpuFaultSnapshot(value));else environmentProofs.push(readLoginEnvironmentFaultSnapshot(value));response.writeHead(204);response.end();return;
  }
  if(url.pathname===assetPath){
   assetRequests++;
   if(mode==='missing'){response.writeHead(404,{'content-type':'text/plain'});response.end('SYNTHETIC_ENVIRONMENT_MISSING');return;}
   if(mode==='mime'){response.writeHead(200,{'content-type':'text/plain','content-length':String(payload.length)});response.end(payload);return;}
   if(mode==='encoding'){response.writeHead(200,{'content-type':'application/octet-stream','content-encoding':'gzip','content-length':String(payload.length)});response.end(payload);return;}
   if(mode==='corrupt'){const corrupt=Buffer.from(payload),index=Math.floor(corrupt.length/2),byte=corrupt[index];assert.equal(typeof byte,'number');corrupt[index]=(byte??0)^1;response.writeHead(200,{'content-type':'application/octet-stream','content-length':String(corrupt.length)});response.end(corrupt);return;}
   if(mode==='truncated'){response.writeHead(200,{'content-type':'application/octet-stream','content-length':String(payload.length-8)});response.end(payload.subarray(0,-8));return;}
   if(mode==='compressed-overflow'){response.writeHead(200,{'content-type':'application/octet-stream'});response.end(Buffer.concat([payload,Buffer.from([0]) ]));return;}
   if(mode==='abort-read'){response.once('close',()=>{if(!response.writableFinished)cancelledResponses++;});response.writeHead(200,{'content-type':'application/octet-stream','content-length':String(payload.length)});response.write(payload.subarray(0,128));return;}
  }
  if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.environment-fault-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Synthetic environment fault</title>');
 })().catch(error=>{fixtureFailure??=error;if(!response.headersSent)response.writeHead(500);response.end('SYNTHETIC_ENVIRONMENT_FAULT_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true});assert.ok(browser);
  await browser.command('Network.enable');await browser.command('Network.setBlockedURLs',{urls:['https://login.work.weixin.qq.com/*']});await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:loginEnvironmentFaultScript(mode)});await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  if(mode==='abort-read'||mode==='abort-hash'){
   await browser.waitFor(mode==='abort-read'?'window.__loginEnvironmentFault?.compressedReadBytes===128&&window.__loginEnvironmentFault.activeReads===1':'window.__loginEnvironmentFault?.rawHashNativeFinished===1&&typeof window.__loginEnvironmentFault.releaseHash==="function"');
   const before=readLoginEnvironmentFaultSnapshot(await browser.evaluate('window.__loginEnvironmentFault.snapshot()'));const beforeGpu=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   assert.equal(before.fetches,1);assert.equal(beforeGpu.environmentObjectsCreated,0);assert.equal(beforeGpu.environmentTexturesCreated,0);assert.equal(beforeGpu.iframeCreates,0);assert.equal(beforeGpu.preparedCalls.length,0);
   if(mode==='abort-hash'){assert.equal(before.rawReadBytes,6291456);assert.equal(beforeGpu.environmentDigestSettled,2);}
   await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));window.__loginEnvironmentFault.releaseHash?.()");
   await browser.waitFor('window.__loginEnvironmentFault.activeReads===0&&window.__loginEnvironmentFault.fetchAbortSignals===1&&window.__loginGpuFault.snapshot().prototypeRestored');
   const after=readLoginEnvironmentFaultSnapshot(await browser.evaluate('window.__loginEnvironmentFault.snapshot()'));await delay(100);const settled=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));
   if(mode==='abort-read')assert.ok(after.readerCancelCalls>before.readerCancelCalls,'abort cancels the actually pending HTTP stream reader');else{assert.equal(before.activeReads,0);assert.equal(after.hasReleaseHash,false);assert.equal(after.rawHashNativeFinished,1,'a late native hash completes once after disposal');}assert.equal(settled.environmentObjectsCreated,0,'late stream/hash completion after cancellation never constructs the texture');assert.equal(settled.managedTexturesLive,0);assert.equal(settled.programsCreated,0);assert.equal(settled.shadersCreated,0);assert.equal(settled.pendingPollTimers,0);assert.equal(settled.iframeCreates,0);assert.equal(settled.preparedCalls.length,0);
   if(mode==='abort-read'){for(let index=0;index<20&&cancelledResponses===0;index++)await delay(25);assert.equal(cancelledResponses,1,'the server sees the held HTTP body cancelled');}
   await browser.command('Page.navigate',{url:origin+'/done'});await browser.waitFor('location.pathname==="/done"');assert.equal(generation,1,'cancelled documents do not create a recovery intent or panel');
   console.log('LOGIN_ENVIRONMENT_ASSET_ABORT',JSON.stringify({mode,before,beforeGpu,after,settled,assetRequests,cancelledResponses}));
  }else{
   await browser.waitFor('document.body?.dataset.loginScene==="prepared"&&document.querySelector("#wecom-panel iframe")&&document.getElementById("desktop-login")?.dataset.view==="flat"');
   const prepared=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));assert.equal(generation,2,'bad environment assets recover with a fresh complete flat login intent');assert.equal(prepared.fallback,'asset-failed');assert.equal(prepared.iframeCreates,1);assert.equal(prepared.iframeCount,1);assert.equal(prepared.preparedCalls.length,1);
   for(let index=0;index<30&&(!proofs.length||!environmentProofs.length);index++)await delay(25);const prior=proofs.find(value=>value.framebuffersCreated>0);assert.ok(prior);const assetProof=environmentProofs.find(value=>value.failure!==null);assert.ok(assetProof,'the failed document supplies the exact diagnostic reason');
   const expected={missing:'http-status',mime:'mime',encoding:'content-encoding',corrupt:'compressed-integrity',truncated:'compressed-length','compressed-overflow':'compressed-length','decompression-failed':'decompression-failed','raw-overflow':'raw-length','raw-integrity':'raw-integrity','no-decompression':'decompression-unavailable','no-hash':'hash-unavailable'}[mode];assert.equal(assetProof.failure,expected,'the failed document reports the exact closed environment diagnostic');
   assert.equal(prior.environmentObjectsCreated,0);assert.equal(prior.environmentCpuBytes,0);assert.equal(prior.environmentTexturesCreated,0);assert.equal(prior.managedTexturesLive,0);assert.equal(prior.programsCreated,0);assert.equal(prior.shadersCreated,0);assert.equal(prior.pendingPollTimers,0);assert.equal(prior.targetFramebuffersCreated,0);assert.equal(prior.scratchFramebuffersCreated,3);assert.equal(prior.iframeCreates,0);assert.equal(prior.preparedCalls.length,0);assert.equal(prior.prototypeRestored,true);
   assert.equal(assetProof.fetches,mode==='no-decompression'?0:1);assert.equal(assetRequests,mode==='no-decompression'?0:1);
   if(mode==='corrupt'){assert.equal(assetProof.decompressors,0);assert.equal(assetProof.rawReadBytes,0,'the compressed integrity guard rejects corruption before a decoder starts');}
   if(mode==='compressed-overflow')assert.equal(assetProof.compressedReadBytes,880179,'streamed input exceeds the fixed bound without relying on a content-length header');
   if(mode==='raw-overflow'){assert.equal(assetProof.decompressors,1);assert.equal(assetProof.rawReadBytes,6291457,'the actual native decoded stream plus injected byte reaches the fixed-size output guard');assert.equal(assetProof.rawHashStarted,0);}
   if(mode==='raw-integrity'){assert.equal(assetProof.decompressors,1);assert.equal(assetProof.rawReadBytes,6291456);assert.equal(assetProof.rawHashNativeFinished,1);}
   await browser.evaluate('window.__loginGpuFaultIframe=document.querySelector("#wecom-panel iframe");window.__loginGpuFault.present();window.__loginGpuFault.present()');await browser.waitFor('document.body.dataset.loginScene==="ready"');const presented=readLoginGpuFaultSnapshot(await browser.evaluate('({...window.__loginGpuFault.snapshot(),sameIframe:window.__loginGpuFaultIframe===document.querySelector("#wecom-panel iframe"),retryEnabled:!document.getElementById("retry-login").disabled})'));assert.equal(presented.sameIframe,true);assert.equal(presented.iframeCreates,1);assert.equal(presented.iframeCount,1);assert.equal(presented.preparedCalls.length,1);assert.equal(presented.retryEnabled,true);
   await browser.waitFor('(()=>{const status=document.getElementById("login-status"),button=document.getElementById("retry-login"),link=document.querySelector(".login-panel-recovery a");if(!status||!button||!link)return false;const s=getComputedStyle(status),r=status.getBoundingClientRect(),b=button.getBoundingClientRect(),l=link.getBoundingClientRect();return status.textContent.includes("工牌画面未能加载，已切换平面扫码")&&s.display!=="none"&&s.visibility==="visible"&&r.width>0&&r.height>0&&!status.closest("[inert]")&&!button.disabled&&b.width>0&&b.height>0&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button&&link.getAttribute("href")==="/workbench/desktop"&&l.width>0&&l.height>0;})()');
   assert.equal(await browser.evaluate('document.getElementById("login-status").textContent'),'工牌画面未能加载，已切换平面扫码。如未显示二维码，请重新获取，或使用官方登录页。','asset recovery shows an accurate reason without claiming the provider QR is ready');
   console.log('LOGIN_ENVIRONMENT_ASSET_FAULT',JSON.stringify({mode,prior,assetProof,prepared,presented,assetRequests}));
  }
  if(fixtureFailure)throw fixtureFailure;
 }catch(error){failure=error;let current:unknown=null;try{current=await browser?.evaluate('({gpu:window.__loginGpuFault?.snapshot(),asset:window.__loginEnvironmentFault?.snapshot()})');}catch{}console.log('LOGIN_ENVIRONMENT_ASSET_FAULT_FAILURE',JSON.stringify({mode,generation,proofs,environmentProofs,assetRequests,current}));}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});

test('compiled login releases the exact first-used environment texture and its CPU pixels without replacing the presented iframe',{timeout:90_000},async()=>{
 let origin='',generation=0,fixtureFailure:unknown;const proofs:LoginGpuFaultSnapshot[]=[];
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);
  if(url.pathname==='/gpu-proof'&&request.method==='POST'){const chunks:Buffer[]=[];let bytes=0;for await(const part of request){const chunk:unknown=part;assert.ok(Buffer.isBuffer(chunk));bytes+=chunk.length;assert.ok(bytes<16_000);chunks.push(chunk);}proofs.push(readLoginGpuFaultSnapshot(JSON.parse(Buffer.concat(chunks).toString()) as unknown));response.writeHead(204);response.end();return;}
  if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.environment-first-use-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Synthetic environment first use</title>');
 })().catch(error=>{fixtureFailure??=error;if(!response.headersSent)response.writeHead(500);response.end('SYNTHETIC_ENVIRONMENT_FIRST_USE_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true});assert.ok(browser);
  await browser.command('Network.enable');await browser.command('Network.setBlockedURLs',{urls:['https://login.work.weixin.qq.com/*']});
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:loginGpuFaultScript('normal')});await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  await browser.waitFor('document.body?.dataset.loginScene==="prepared"&&document.querySelector("#wecom-panel iframe")');
  const before=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));assert.equal(before.view,'lanyard');assert.equal(generation,1);assert.equal(before.khrAvailable,true);assert.ok(before.completionQueries>0);assert.ok(before.draws>0);
  assert.equal(before.environmentObjectsCreated,1);assert.equal(before.environmentObjectsDisposed,0);assert.equal(before.environmentCpuBytes,6291456);assert.equal(before.environmentCpuHalfWords,3145728);assert.equal(before.environmentTexturesCreated,1);assert.equal(before.environmentTexturesLive,1);assert.equal(before.environmentUploads,1,'the exact 768x1024 HALF_FLOAT payload was uploaded by real GL');assert.equal(before.nativeEnvironmentTexturesChecked,1);assert.equal(before.nativeEnvironmentTexturesLive,1,'native GL positively validates the uploaded texture handle');assert.equal(before.targetFramebuffersCreated,0);assert.equal(before.applicationTexturesCreated,6);assert.equal(before.applicationTexturesDeleted,0);assert.equal(before.nativeApplicationTexturesLive,6);assert.equal(before.dfgTexturesCreated,1);assert.equal(before.dfgTextureBytes,1024);assert.equal(before.dfgCpuObjects,1);assert.equal(before.nativeDfgTexturesLive,1);assert.equal(before.contextDefaultTexturesCreated,4);
  await browser.evaluate('window.__loginGpuFaultIframe=document.querySelector("#wecom-panel iframe");window.__loginGpuFault.present();window.__loginGpuFault.present()');await browser.waitFor('document.body.dataset.loginScene==="ready"');
  assert.equal(await browser.evaluate('window.__loginGpuFaultIframe===document.querySelector("#wecom-panel iframe")&&window.__loginGpuFault.iframeCreates===1'),true);
  await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}))");
  await browser.waitFor('window.__loginGpuFault.snapshot().environmentObjectsDisposed===1&&window.__loginGpuFault.snapshot().prototypeRestored');
  const released=readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'));assertLoginGpuFaultReleased(released);assert.equal(released.environmentTexturesCreated,1);assert.equal(released.environmentTexturesDeleted,1);assert.equal(released.nativeEnvironmentTexturesLive,0);
  const draws=released.draws;await delay(100);assert.equal((readLoginGpuFaultSnapshot(await browser.evaluate('window.__loginGpuFault.snapshot()'))).draws,draws,'disposed animation and native texture never draw again');
  await browser.command('Page.navigate',{url:origin+'/done'});await browser.waitFor('location.pathname==="/done"');for(let index=0;index<20&&!proofs.some(value=>value.trustedPagehide);index++)await delay(25);assert.ok(proofs.some(value=>value.trustedPagehide&&value.prototypeRestored&&value.environmentTexturesDeleted===1&&value.nativeEnvironmentTexturesLive===0));
  console.log('LOGIN_ENVIRONMENT_FIRST_USE',JSON.stringify({before,released,proofs}));if(fixtureFailure)throw fixtureFailure;
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});



// Unit cases inject late CDP outcomes through the actual compiled neutral-provider fixture.
const providerRetirementModes=['retired-detached','retired-not-found','still-live','unknown'] as const;
type ProviderRetirementMode=typeof providerRetirementModes[number];
function providerDeferred(){
 let resolve:()=>void=()=>{};
 let reject:(error:unknown)=>void=()=>{};
 const promise=new Promise<void>((ok,bad)=>{resolve=ok;reject=bad;});
 return {promise,resolve,reject};
}
async function exerciseProviderRetirement(mode:ProviderRetirementMode){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address==='object');
 const connection=once(server,'connection');
 const fixture=createNeutralProviderFixture();
 const client=fixture.socketFactory('ws://127.0.0.1:'+address.port);
 const [connectionResult]=await Promise.all([connection,once(client,'open')]);
 const peer:unknown=connectionResult[0];assert.ok(peer instanceof WebSocket);
 const seedEnabled=providerDeferred(),seedFulfilled=providerDeferred(),resumeEntered=providerDeferred(),resume=providerDeferred(),barrier=providerDeferred();
 const timeout=new Error('P2_006_BROWSER_COMMAND_TIMEOUT',{cause:{method:'Runtime.runIfWaitingForDebugger',sessionKind:'attached'}});
 const missing=new Error('Session with given id not found.');
 const unknown=new Error('SYNTHETIC_ISOLATE_CHECK_UNAVAILABLE');
 let probeCount=0,resumeCount=0,seedResumeCount=0,healthSettled=false;
 let summary:Record<string,unknown>|undefined;
 const send=(method:string,params:Record<string,unknown>,sessionId?:string)=>peer.send(JSON.stringify({method,params,...(sessionId?{sessionId}:{})}));
 try{
  await fixture.install(async(method,params={},sessionId=null)=>{
   if(sessionId===null&&['Fetch.enable','Target.setAutoAttach'].includes(method))return {};
   if(method==='Fetch.enable'){
    assert.ok(typeof sessionId==='string');assert.ok(['seed','probe'].includes(sessionId));
    if(sessionId==='seed')seedEnabled.resolve();
    return {};
   }
   if(method==='Runtime.runIfWaitingForDebugger'&&sessionId==='seed'){seedResumeCount++;return {};}
   if(method==='Runtime.runIfWaitingForDebugger'&&sessionId==='probe'){
    resumeCount++;resumeEntered.resolve();return resume.promise;
   }
   if(method==='Fetch.fulfillRequest'){
    assert.equal(sessionId,'seed');assert.equal(params.responseCode,200);seedFulfilled.resolve();return {};
   }
   if(method==='Fetch.failRequest'){
    assert.equal(sessionId,'seed');assert.equal(params.requestId,'barrier');barrier.resolve();return {};
   }
   if(method==='Runtime.getIsolateId'){
    assert.equal(sessionId,'probe');probeCount++;
    if(mode==='retired-not-found')throw missing;
    if(mode==='still-live')return {id:'synthetic-isolate'};
    throw unknown;
   }
   throw Error('UNEXPECTED_SYNTHETIC_COMMAND');
  });
  send('Target.attachedToTarget',{sessionId:'seed',targetInfo:{type:'iframe'},waitingForDebugger:false});
  await seedEnabled.promise;
  send('Fetch.requestPaused',{requestId:'neutral',resourceType:'Document',request:{method:'GET',url:'https://login.work.weixin.qq.com/wwlogin/sso/login'}},'seed');
  await seedFulfilled.promise;await nextTurn();await fixture.assertHealthy();
  assert.equal(fixture.receipt().fulfilledDocuments,1);
  send('Target.attachedToTarget',{sessionId:'probe',targetInfo:{type:'iframe'},waitingForDebugger:true});
  await resumeEntered.promise;
  const health=Promise.resolve(fixture.assertHealthy());
  void health.then(()=>{healthSettled=true;},()=>{healthSettled=true;});
  await Promise.resolve();
  assert.equal(healthSettled,false,'the final health check must observe its already-pending handler');
  if(mode==='retired-detached'){
   send('Target.detachedFromTarget',{sessionId:'probe'});
   send('Fetch.requestPaused',{requestId:'barrier',resourceType:'Document',request:{method:'GET',url:'https://login.work.weixin.qq.com/not-neutral'}},'seed');
   await barrier.promise;await nextTurn();
  }
  resume.reject(timeout);
  if(mode==='retired-detached'||mode==='retired-not-found')await health;
  else await assert.rejects(health,error=>error===(mode==='still-live'?timeout:unknown));
  const receipt=fixture.receipt();
  assert.equal(receipt.fulfilledDocuments,1,'retirement never counts as a fulfilled provider document');
  assert.equal(receipt.pendingHandlers,0);
  assert.equal(resumeCount,1);
  assert.equal(seedResumeCount,0,'a non-waiting target receives zero resume commands');
  assert.equal(probeCount,mode==='retired-detached'?0:1);
  assert.equal(receipt.retiredIframeSessions,mode.startsWith('retired-')?1:0);
  assert.deepEqual(receipt.retiredOperations,mode==='retired-detached'?[{operation:'Runtime.runIfWaitingForDebugger',source:'detached-event'}]:mode==='retired-not-found'?[{operation:'Runtime.runIfWaitingForDebugger',source:'authoritative-session-not-found'}]:[]);
  summary={mode,resumeCount,seedResumeCount,probeCount,lateHealthObserved:healthSettled,fulfilledDocuments:receipt.fulfilledDocuments,retiredIframeSessions:receipt.retiredIframeSessions,retiredOperations:receipt.retiredOperations,expectedFailureObserved:!mode.startsWith('retired-')};
 }finally{
  fixture.dispose();
  resume.resolve();
  const peerClosed=peer.readyState===3?Promise.resolve():once(peer,'close');
  if(client.readyState!==3){const closed=once(client,'close');client.close();await closed;}
  await peerClosed;
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
 assert.ok(summary);
 return {...summary,clientClosed:client.readyState===3,serverClients:server.clients.size,serverClosed:true};
}

for(const mode of providerRetirementModes){
 test('unit neutral provider retirement evidence '+mode,{timeout:5000},async context=>{
  const proof=await exerciseProviderRetirement(mode);
  assert.equal(proof.clientClosed,true);
  assert.equal(proof.serverClients,0);
  context.diagnostic(JSON.stringify(proof));
 });
}
