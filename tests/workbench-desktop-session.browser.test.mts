import {clickWorkbenchControl,openWorkbenchUserMenu,openWorkbenchSettings} from './helpers/heroui-workbench-controls.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createServer,request as nativeRequest} from 'node:http';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {renderEmbeddedLogin,embeddedLoginHeaders,serveEmbeddedLoginAsset} from '../app/server/src/workbench-embedded-login.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

const draftCounts=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),a=tx.objectStore('drafts').count(),b=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:a.result,operations:b.result});};};})`;

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
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900});assert.ok(browser);
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
  assert.deepEqual(await browser.evaluate('window.__preparingLoader'),{width:50,height:50,centered:true,border:'8px',color:'rgb(81, 75, 130)',duration:'0.8s, 1.6s',animation:'l20-1, l20-2',direction:'alternate, normal',timing:'linear, linear',label:'Loading login page',text:''},'remote preparation matches the native user-supplied spinner');
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
  await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  await browser.waitFor('Boolean(document.querySelector(".lanyard-front iframe"))');
  await waitScene();
  const introMotion=await browser.evaluate('new Promise(resolve=>{const panel=document.querySelector(".lanyard-front iframe"),face=document.querySelector(".lanyard-front"),samples=[],start=performance.now();const sample=now=>{const r=face.getBoundingClientRect();samples.push({t:now-start,x:r.x+r.width/2});if(now-start<3600){requestAnimationFrame(sample);return;}const early=samples.filter(p=>p.t<2600).map(p=>p.x),late=samples.filter(p=>p.t>=3000).map(p=>p.x);resolve({range:Math.max(...early)-Math.min(...early),lateRange:Math.max(...late)-Math.min(...late),samePanel:panel===document.querySelector(".lanyard-front iframe")});};requestAnimationFrame(sample);})') as {range:number;lateRange:number;samePanel:boolean};
  assert.ok(introMotion.range>=6,'the initial physical swing is visible: '+JSON.stringify(introMotion));
  assert.ok(introMotion.lateRange<1,'the one-shot swing settles after about three seconds: '+JSON.stringify(introMotion));
  assert.equal(introMotion.samePanel,true,'the intro preserves the mounted QR iframe');
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
const bridge=`(()=>{window.__loginRequests=0;window.__desktopContext=null;window.workbenchDesktop={version:1,getState:async()=>({version:1,visible:true,focused:true,locked:false,suspended:false,remindersEnabled:false,revision:0}),onState:()=>()=>{},updateContext:async value=>{window.__desktopContext=value;},setReminders:async()=>false,showReminder:async()=>false,clearReminders:async()=>{},onReminderClick:()=>()=>{},requestLogin:async()=>{window.__loginRequests++;const counts=(await indexedDB.databases()).some(row=>row.name==='wecom-workbench-drafts-v1')?await (${draftCounts}):{drafts:0,operations:0};const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);sessionStorage.setItem('synthetic-login-proof',JSON.stringify({calls:window.__loginRequests,counts,blocked:event.defaultPrevented,context:window.__desktopContext,oldTextVisible:document.body.innerText.includes('PRIVATE_AUTH_DRAFT')}));location.replace('/workbench/desktop');}};})()`;

for(const mode of ['initial-401','draft-401','cleanup-failure','permission-403','service-503','ordinary-browser'] as const)test('desktop automatic QR login respects '+mode,{timeout:90_000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture)=>{
  const target=f.tickets[5],cookie=f.browserCookies[0];assert.ok(target&&cookie?.url);
  const original=f.runtime.server.listeners('request');let qrRequests=0,posts=0;
  f.runtime.server.removeAllListeners('request');
  f.runtime.server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
   if(request.method==='POST')posts++;
   if(request.url==='/workbench/desktop'){qrRequests++;response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><h1>合成企业微信二维码登录</h1>');return;}
   if(request.url==='/api/lifecycle/bootstrap'&&['initial-401','permission-403','service-503'].includes(mode)){
    const status=mode==='initial-401'?401:mode==='permission-403'?403:503;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:{code:status===401?'P2_016_AUTH_REQUIRED':status===403?'P2_016_FORBIDDEN':'P2_016_ACTION_FAILED',retryable:false}}));return;
   }
   for(const listener of original)Reflect.apply(listener,f.runtime.server,[request,response]);
  });
  let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.command('Page.enable');if(mode!=='ordinary-browser')await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:bridge});
   const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id});
   await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
   if(mode==='permission-403'||mode==='service-503'){
    await browser.waitFor(mode==='permission-403'?"document.body.innerText.includes('没有查看权限')":"document.body.innerText.includes('503')");
    assert.equal(qrRequests,0);assert.equal(await browser.evaluate('window.__loginRequests'),0);assert.equal(posts,0);return;
   }
   if(mode!=='initial-401'){
    await browser.waitFor("Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.board'))");
    if(mode==='draft-401'||mode==='cleanup-failure'){
     await browser.waitFor("document.querySelector('#internal-note')?.disabled===false");
     await browser.evaluate("(()=>{const input=document.querySelector('#internal-note');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'PRIVATE_AUTH_DRAFT：仅合成未提交输入');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
     await browser.waitFor("document.body.innerText.includes('已保存恢复副本')");assert.equal((await browser.evaluate(draftCounts) as {drafts:number}).drafts,1);
     if(mode==='cleanup-failure')await browser.evaluate("(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(this.name==='wecom-workbench-drafts-v1'&&mode==='readwrite')throw new DOMException('SYNTHETIC_STORAGE_UNAVAILABLE','InvalidStateError');return original.call(this,stores,mode,...rest);};})()");
    }
    await browser.waitFor("[...document.querySelectorAll('.ticket-notes button')].some(button=>button.textContent==='重新读取工单动作'&&!button.disabled)");
    await browser.command('Network.clearBrowserCookies');assert.equal((await fetch(f.origin+'/api/lifecycle/bootstrap')).status,401);
    // Another in-flight read can already have closed the view after cookie loss.
    await browser.evaluate("[...document.querySelectorAll('.ticket-notes button')].find(button=>button.textContent==='重新读取工单动作')?.click()");
    if(mode==='ordinary-browser'){await browser.waitFor("document.body.innerText.includes('会话已失效')");assert.equal(qrRequests,0);return;}
    if(mode==='cleanup-failure'){await browser.waitFor("document.body.innerText.includes('清理尚未确认')");assert.equal(qrRequests,0);assert.equal(await browser.evaluate('window.__loginRequests'),0);assert.equal(posts,0);return;}
   }
   await browser.waitFor("location.pathname==='/workbench/desktop'&&document.body.innerText.includes('合成企业微信二维码登录')");
   const proof=await browser.evaluate("JSON.parse(sessionStorage.getItem('synthetic-login-proof'))") as {calls:number;counts:{drafts:number;operations:number};blocked:boolean;oldTextVisible:boolean;context:{epoch:null;blocked:boolean;live:boolean;remindersAvailable:boolean}};
   assert.equal(qrRequests,1);assert.equal(proof.calls,1);assert.deepEqual(proof.counts,{drafts:0,operations:0});assert.equal(proof.blocked,false);assert.equal(proof.oldTextVisible,false);assert.deepEqual(proof.context,{epoch:null,blocked:false,live:false,remindersAvailable:false});assert.equal(posts,0,'authentication recovery must never replay a business POST');
  }catch(error){failure=error;if(browser)console.log('DESKTOP_AUTH_FAILURE',JSON.stringify({mode,state:await browser.evaluate('({text:document.body.innerText.slice(-700),calls:window.__loginRequests,path:location.pathname})')}));}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
 },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});


for(const mode of ['browser','desktop','logout-unknown','logout-cleanup-failure'] as const)test('user menu, local preferences and direct logout login: '+mode,{timeout:120_000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture&{certificateSpki:string})=>{
  const original=f.runtime.server.listeners('request');let qr=0,logoutPosts=0,reminderReads=0;
  f.runtime.server.removeAllListeners('request');f.runtime.server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
   if(request.url?.startsWith('/api/workbench/reminders'))reminderReads++;
   if(request.method==='POST'&&request.url==='/workbench/logout'){
    logoutPosts++;if(mode==='logout-unknown'){response.writeHead(503,{'content-type':'application/json'});response.end(JSON.stringify({error:{code:'WORKBENCH_UNAVAILABLE',retryable:true}}));return;}
   }
   if(request.url==='/workbench/desktop'){qr++;response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><h1>合成企业微信二维码登录</h1>');return;}
   for(const listener of original)Reflect.apply(listener,f.runtime.server,[request,response]);
  });
  const cookie=f.browserCookies[0];assert.ok(cookie?.url);let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,error:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,certificateSpki:f.certificateSpki,cookies:f.browserCookies.map(value=>{assert.ok(value.url);return {...value,url:value.url};})});assert.ok(browser);
   await browser.command('Page.enable');if(mode==='desktop'){
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:bridge});await browser.command('Page.reload');
   }
   await browser.waitFor('Boolean(document.querySelector("[data-action=open-user-menu]"))&&Boolean(document.querySelector(".board"))');
   assert.equal(await browser.evaluate('document.querySelector(".topbar [data-action=logout-workbench]")!==null||document.querySelector(".sidebar [data-action=open-settings]")!==null'),false,'secondary actions are inside the account menu');
   if(mode==='browser'){
    await openWorkbenchSettings(browser);await browser.waitFor('document.querySelector(".workbench-settings")?.contains(document.activeElement)');
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll(".workbench-settings input[role=switch]")].map(node=>node.disabled)'),[false,false]);
    assert.equal(await browser.evaluate('document.body.innerText.includes("尚未启用提醒功能")'),false);
    await clickWorkbenchControl(browser,'input[aria-label="开启声音提醒"]');
    await browser.command('Browser.setPermission',{permission:{name:'notifications'},setting:'granted',origin:f.origin});
    await clickWorkbenchControl(browser,'input[aria-label="开启桌面通知"]');
    await browser.waitFor(`document.querySelector('input[aria-label="开启桌面通知"]').checked`);
    assert.deepEqual(await browser.evaluate('JSON.parse(localStorage.getItem("wbint-reminder-preferences-v1"))'),{schema_version:1,sound_enabled:true,desktop_enabled:true});
    assert.equal(reminderReads,0,'local preferences do not invent a disabled server feed');
    await clickWorkbenchControl(browser,'button[aria-label="关闭设置"]');
    await browser.waitFor('document.activeElement?.dataset.action==="open-user-menu"');
    const directory=join(tmpdir(),'user-menu-'+randomUUID());await mkdir(directory,{recursive:true});
    for(const width of [1280,390]){
     await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
     await openWorkbenchUserMenu(browser);
     assert.equal(await browser.evaluate('(()=>{const r=document.querySelector("[role=menu][aria-label=用户操作]").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()'),true);
     await writeFile(join(directory,'menu-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
     // The dismiss layer intentionally covers the page; click the observed blank margin through it.
     const outside:unknown=await browser.evaluate('(()=>{const r=document.querySelector("[role=menu][aria-label=用户操作]").getBoundingClientRect(),x=8,y=innerHeight/2;return {x,y,outside:x<r.left||x>r.right||y<r.top||y>r.bottom};})()');
     assert.ok(outside&&typeof outside==='object'&&'x' in outside&&'y' in outside&&'outside' in outside&&outside.outside===true&&typeof outside.x==='number'&&typeof outside.y==='number');
     await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:outside.x,y:outside.y});
     await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:outside.x,y:outside.y});
     await browser.waitFor('!document.querySelector("[role=menu][aria-label=用户操作]")');
     assert.equal(await browser.evaluate('getComputedStyle([...document.querySelectorAll("[data-action=open-user-menu]")].find(node=>node.checkVisibility())).outlineStyle'),'none','pointer dismissal must not leave an account outline');
     assert.equal(await browser.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--focus").trim()'),'transparent','HeroUI portal and control rings share the app policy');
     await writeFile(join(directory,'account-closed-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
     await openWorkbenchUserMenu(browser);
     await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
     await browser.waitFor('!document.querySelector("[role=menu][aria-label=用户操作]")');
    }
    console.log('USER_MENU_VISUAL '+JSON.stringify({directory,widths:[1280,390],local_preferences_with_feed_disabled:true}));
   }
   if(mode==='logout-cleanup-failure'){
    const ticket=f.tickets[5];assert.ok(ticket);await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page'});
    await browser.waitFor('document.querySelector("#internal-note")?.disabled===false');
    await browser.evaluate(`(()=>{const e=document.querySelector('#internal-note');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'SYNTHETIC_MENU_DRAFT');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await browser.waitFor('document.body.innerText.includes("已保存恢复副本")');
    await browser.evaluate(`(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){if(this.name==='wecom-workbench-drafts-v1'&&mode==='readwrite')throw Error('SYNTHETIC_CLEANUP_REFUSED');return original.call(this,stores,mode,...args);};})()`);
   }
   await openWorkbenchUserMenu(browser);await clickWorkbenchControl(browser,'[data-action="logout-workbench"]');
   if(mode==='logout-unknown'||mode==='logout-cleanup-failure'){
    await browser.waitFor(mode==='logout-unknown'?'document.body.innerText.includes("尚未确认")':'document.body.innerText.includes("清理尚未确认")');assert.equal(qr,0);
   }else{
    await browser.waitFor('location.pathname==="/workbench/desktop"&&document.body.innerText.includes("合成企业微信二维码登录")');assert.equal(qr,1);
    if(mode==='desktop'){const proof=await browser.evaluate('JSON.parse(sessionStorage.getItem("synthetic-login-proof"))') as {calls:number;blocked:boolean;counts:{drafts:number;operations:number}};assert.equal(proof.calls,1);assert.equal(proof.blocked,false);assert.deepEqual(proof.counts,{drafts:0,operations:0});}
   }
   assert.equal(logoutPosts,1);
  }catch(e){error=e;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();}],error);}
 },{realWorkbenchAuthentication:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
