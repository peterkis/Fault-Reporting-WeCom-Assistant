import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,lstat,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer,request as nativeRequest} from 'node:http';
import {brotliCompressSync,brotliDecompressSync,gunzipSync,gzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {renderEmbeddedLogin,embeddedLoginHeaders,serveEmbeddedLoginAsset} from '../app/server/src/workbench-embedded-login.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createNeutralProviderFixture,backdropPipelineScript,readBackdropPipelineSnapshot,type BackdropPipelineSnapshot,type BackdropPipelineMode} from './helpers/desktop-login-backdrop-pipeline-fixture.mjs';
import {loginReducedManualScript,readReducedManualSnapshot,type ReducedManualSnapshot} from './helpers/desktop-login-gpu-fault-fixture.mjs';

test('compiled embedded login rejects altered binary representations and retains original resource budgets',{timeout:30_000},async context=>{
 const parent=path.resolve('.local/electron/temp');await mkdir(parent,{recursive:true});
 const cases=['valid','unknown-binary','two-environments','environment-encoding','missing-environment','length-drift','hash-drift','asset-budget','total-budget','code-budget','font-budget'] as const;
 for(const mode of cases)await context.test(mode,async()=>{
  const owned=await mkdtemp(path.join(parent,'desktop-env-assets-'));
  try{
   const moduleRoot=path.join(owned,'app/server/src'),assetRoot=path.join(owned,'web/desktop-login');await mkdir(moduleRoot,{recursive:true});await mkdir(path.join(assetRoot,'.vite'),{recursive:true});await mkdir(path.join(assetRoot,'assets'),{recursive:true});
   for(const file of ['workbench-embedded-login.mjs','static-encoding.mjs']){const source=new URL('../app/server/src/'+file,import.meta.url),destination=path.join(moduleRoot,file);await copyFile(source,destination);assert.deepEqual(await readFile(destination),await readFile(source),'the fixture executes unchanged compiled server bytes');}
   const files=new Map<string,Buffer>(),representations:{file:string;source:string;encoding:'identity'|'gzip'|'br';bytes:number;sha256:string}[]=[];
   const put=(file:string,body:Buffer,compress=false)=>{files.set(file,body);representations.push({file,source:file,encoding:'identity',bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});if(compress)for(const [encoding,suffix,value]of [['gzip','.gz',gzipSync(body)],['br','.br',brotliCompressSync(body)]] as const){files.set(file+suffix,value);representations.push({file:file+suffix,source:file,encoding,bytes:value.length,sha256:createHash('sha256').update(value).digest('hex')});}};
   const dependentImports:string[]=[];const environment='assets/login-environment-v1-Cache123.pmrem',entry={file:'assets/login-Ab123.js',isEntry:true,assets:[environment],imports:dependentImports,loginRepresentations:representations};const manifest:Record<string,unknown>={'src/login/main.ts':entry};
   put(entry.file,Buffer.from('export const fixture="SYNTHETIC_EMBEDDED_LOGIN_ASSET";'),true);put(environment,Buffer.from('SYNTHETIC_IDENTITY_GZIP_PAYLOAD'));
   const env=representations.find(item=>item.source===environment);assert.ok(env);
   if(mode==='unknown-binary'){entry.assets.push('assets/arbitrary.pmrem');put('assets/arbitrary.pmrem',Buffer.from('PRIVATE_UNSUPPORTED_BINARY'));}
   if(mode==='two-environments'){entry.assets.push('assets/login-environment-v1-Cache456.pmrem');put('assets/login-environment-v1-Cache456.pmrem',Buffer.from('SECOND_ENVIRONMENT'));}
   if(mode==='environment-encoding'){env.encoding='gzip';env.file=environment+'.gz';files.set(env.file,files.get(environment)??Buffer.alloc(0));}
   if(mode==='missing-environment')representations.splice(representations.indexOf(env),1);
   if(mode==='length-drift')files.set(environment,Buffer.concat([files.get(environment)??Buffer.alloc(0),Buffer.from([0])]));
   if(mode==='hash-drift')files.set(environment,Buffer.alloc(env.bytes,1));
   if(mode==='asset-budget')env.bytes=4*1024*1024+1;
   if(mode==='total-budget'||mode==='font-budget')for(let index=0;index<(mode==='total-budget'?9:129);index++){const file='assets/noto-sans-sc-'+index+'-wght-normal-Font'+index+'.woff2';entry.assets.push(file);put(file,Buffer.alloc(mode==='total-budget'?2*1024*1024:4,index));}
   if(mode==='code-budget')for(let index=0;index<32;index++){const key='src/extra-'+index+'.ts',file='assets/extra-'+index+'-Extra123.js';entry.imports.push(key);manifest[key]={file};put(file,Buffer.from('export const extra='+index+';'),true);}
   for(const [file,body]of files)await writeFile(path.join(assetRoot,file),body);
   await writeFile(path.join(assetRoot,'.vite/manifest.json'),JSON.stringify(manifest));await writeFile(path.join(assetRoot,'asset-inventory.json'),JSON.stringify(['.vite/manifest.json',...files.keys()]));
   const copied:typeof import('../app/server/src/workbench-embedded-login.mjs')=await import(pathToFileURL(path.join(moduleRoot,'workbench-embedded-login.mjs')).href);
   const result=()=>copied.renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.asset-inventory',issuedEpochMs:0,expiresEpochMs:300_000,publicOrigin:'https://synthetic.invalid'});
   if(mode==='valid')assert.match(await result(),/<script type="module" src="\/workbench\/desktop\/assets\/login-Ab123\.js"/u);
   else{const expected={'unknown-binary':'LOGIN_FONT_INVALID','two-environments':'LOGIN_ENVIRONMENT_LIMIT','environment-encoding':'LOGIN_REPRESENTATION_ENCODING_INVALID','missing-environment':'LOGIN_REPRESENTATIONS_INVALID','length-drift':'LOGIN_REPRESENTATION_DRIFT','hash-drift':'LOGIN_REPRESENTATION_DRIFT','asset-budget':'LOGIN_REPRESENTATION_INVALID','total-budget':'LOGIN_REPRESENTATION_DRIFT','code-budget':'LOGIN_ASSET_LIMIT','font-budget':'LOGIN_ASSET_LIMIT'}[mode];await assert.rejects(result(),{message:expected});}
  }finally{
   assert.equal(path.dirname(owned),parent);assert.match(path.basename(owned),/^desktop-env-assets-[A-Za-z0-9]+$/u);assert.equal((await lstat(owned)).isSymbolicLink(),false);assert.equal(path.dirname(await realpath(owned)),await realpath(parent));await rm(owned,{recursive:true,force:true});
  }
 });
});

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
 const legacyProvider=createNeutralProviderFixture();
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
  const artifactInventory:unknown=JSON.parse(await readFile(new URL('../web/desktop-login/asset-inventory.json',import.meta.url),'utf8'));
  assert.ok(Array.isArray(artifactInventory)&&artifactInventory.every((value:unknown)=>typeof value==='string'));
  const environmentFiles=artifactInventory.filter((value:unknown):value is string=>typeof value==='string'&&/^assets\/login-environment-v1-[A-Za-z0-9_-]+\.pmrem$/u.test(value));
  assert.equal(environmentFiles.length,1,'only one versioned environment payload belongs to the compiled login inventory');const environmentFile=environmentFiles[0];assert.ok(environmentFile);
  const environmentPath='/workbench/desktop/'+environmentFile;
  const environment=await raw(environmentPath,'br,gzip');assert.equal(environment.status,200);assert.equal(environment.headers['content-type'],'application/octet-stream');assert.equal(environment.headers['content-encoding'],undefined,'the gzip payload is HTTP identity to avoid Fetch double decoding');assert.equal(environment.body.length,880178);assert.equal(environment.headers['content-length'],String(environment.body.length));
  assert.equal(createHash('sha256').update(environment.body).digest('hex'),'dfe29d470a36a2cb171559d79437ad2ab95478d7a94a42037188c6f0005bec3b');
  const environmentRaw=gunzipSync(environment.body,{maxOutputLength:6291456});assert.equal(environmentRaw.length,6291456);assert.equal(createHash('sha256').update(environmentRaw).digest('hex'),'fd1d0fbaf0ebf04caa87c7f365de90e975372ac1fa7842c79616de3fc8e657ab');
  const environmentHead=await raw(environmentPath,'br,gzip','HEAD');assert.equal(environmentHead.status,200);assert.equal(environmentHead.body.length,0);assert.equal(environmentHead.headers['content-length'],String(environment.body.length));assert.equal(environmentHead.headers['content-encoding'],undefined);
  assert.equal((await raw(environmentPath,'identity;q=0,br,gzip')).status,406);
  for(const suffix of ['.gz','.br','?raw=1'])assert.equal((await raw(environmentPath+suffix,'br,gzip')).status,400,'binary sidecars and query variants are never public paths');
  assert.equal((await raw('/workbench/desktop/assets/login-environment-v1-unmanifested.pmrem')).status,404);assert.equal((await raw('/workbench/desktop/assets/arbitrary.pmrem')).status,400,'the new binary extension never admits arbitrary assets');
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true,socketFactory:legacyProvider.socketFactory});assert.ok(browser);
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
  await legacyProvider.install(browser.command);
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
      console.log('LOGIN_BACKGROUND_METRICS',JSON.stringify({frequency,sampleMs:2200}));
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
    const delayedOrigin=Number(await browser.evaluate('performance.timeOrigin'));
    await browser.command('Page.reload');
    await browser.waitFor('performance.timeOrigin!=='+delayedOrigin+'&&document.body?.dataset.loginScene==="ready"');
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
  legacyProvider.assertHealthy();console.log('LOGIN_LEGACY_NEUTRAL_PROVIDER',JSON.stringify({...legacyProvider.receipt(),realQr:'NOT_REAL_QR'}));
 }catch(error){failure=error;if(browser)console.log('EMBEDDED_LOGIN_UI_DIAGNOSTIC',JSON.stringify(await browser.evaluate('({view:document.getElementById("desktop-login")?.dataset.view,frames:document.querySelectorAll("#wecom-panel iframe").length,canvas:document.querySelectorAll(".lanyard-canvas").length,status:document.getElementById("login-status")?.textContent})')));}
 finally{await closeBrowserTestResources([async()=>{try{await browser?.close();}finally{legacyProvider.dispose();}if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});

// Only this owned browser selects the explicit manual reduced-motion fallback.
// Its visibility/cancel simulation is not native Windows or real QR evidence.
test('explicit reduced-motion fallback draws on demand and uses direct drag, static release, flip, hide and cancel without replacing the iframe',{timeout:90_000},async()=>{
 let origin='',generation=0;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 const observations:Record<string,ReducedManualSnapshot>={};
 const snapshot=async()=>{assert.ok(browser);return readReducedManualSnapshot(await browser.evaluate('window.__demand.snapshot()'));};
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){
   generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.reduce-demand-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;
  }
  response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><title>Reduced motion browser test</title>');
 })().catch(()=>{if(!response.headersSent)response.writeHead(500);response.end('SYNTHETIC_REDUCE_FIXTURE_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true});assert.ok(browser);
  await browser.command('Network.enable');await browser.command('Network.setBlockedURLs',{urls:['https://login.work.weixin.qq.com/*']});
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:loginReducedManualScript()});
  await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  await browser.waitFor('document.body?.dataset.loginScene==="ready"&&document.querySelector(".lanyard-front iframe")&&window.__demand.resolveVersion');
  // Drain the real presentation paint and loaded fonts, rather than waiting for
  // numerical physics convergence. The whole automatic physics count stays zero.
  await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  await browser.evaluate('window.__demandIframe=document.querySelector("#wecom-panel iframe")');
  const idleBefore=await snapshot();observations.idleBefore=idleBefore;await delay(500);const idleAfter=await snapshot();observations.idleAfter=idleAfter;
  assert.equal(idleAfter.physicsFrames,0,'reduced motion never starts automatic physics, including the whole presented interval');
  assert.equal(idleAfter.draws,idleBefore.draws,'stable props and loaded fonts do not keep drawing GL');
  const beforeLabel=await snapshot();await browser.evaluate('window.__demand.resolveVersion("0.1.18-demand")');
  await browser.waitFor('window.__demand.latePaints>0&&window.__demand.lateVersionUploads>0');
  const afterLabel=await snapshot();observations.afterLabel=afterLabel;
  assert.ok(afterLabel.draws>beforeLabel.draws,'late version texture data reaches an actual GL drawing');assert.equal(afterLabel.physicsFrames,0,'texture repaint alone never starts physics');
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const quiet=await snapshot();await delay(350);const quietEnd=await snapshot();assert.equal(quietEnd.draws,quiet.draws,'the demand repaint ends without a continuous frame loop');
  const pointValue:unknown=await browser.evaluate('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  assert.ok(pointValue&&typeof pointValue==='object'&&'x' in pointValue&&'y' in pointValue&&typeof pointValue.x==='number'&&Number.isFinite(pointValue.x)&&typeof pointValue.y==='number'&&Number.isFinite(pointValue.y));
  const point={x:pointValue.x,y:pointValue.y};
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-150,y:point.y+35,button:'left',buttons:1});
  await browser.waitFor('(()=>{const r=document.querySelector(".lanyard-front").getBoundingClientRect();return r.x+r.width/2<'+(point.x-35)+';})()');
  const drag=await snapshot();observations.drag=drag;assert.ok(drag.physicsFrames>0,'real user dragging positively proves the physics RAF hook is active');assert.ok(drag.draws>quietEnd.draws);
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-150,y:point.y+35,button:'left',clickCount:1});
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const released=await snapshot();observations.released=released;
  assert.ok(Math.abs(released.card.x-point.x)<8,'manual reduced release immediately rehangs the card');assert.equal(released.sameIframe,true);
  await delay(250);const afterRelease=await snapshot();assert.equal(afterRelease.physicsFrames,released.physicsFrames,'release ends physics without waiting for numerical convergence');assert.equal(afterRelease.draws,released.draws);
  const flipPoint=released.card;
  for(const type of ['mousePressed','mouseReleased'])await browser.command('Input.dispatchMouseEvent',{type,x:flipPoint.x,y:flipPoint.y,button:'left',clickCount:1});
  await browser.waitFor('document.querySelector(".lanyard-front")?.getAttribute("aria-hidden")==="true"');
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const flipped=await snapshot();observations.flipped=flipped;assert.equal(flipped.sameIframe,true);assert.ok(flipped.card.onScreen);await delay(200);const afterFlip=await snapshot();assert.equal(afterFlip.physicsFrames,flipped.physicsFrames);assert.equal(afterFlip.draws,flipped.draws,'tap flips once and then stays static');
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1100,height:820,deviceScaleFactor:1,mobile:false});
  await browser.waitFor('window.__demand.draws>'+afterFlip.draws);
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const resized=await snapshot();observations.resized=resized;assert.equal(resized.physicsFrames,afterFlip.physicsFrames);assert.equal(resized.backFacing,true,'static resize retains the selected back side');assert.ok(resized.card.onScreen);assert.equal(resized.sameIframe,true);
  const restPoint=resized.card;
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:restPoint.x,y:restPoint.y,button:'left',clickCount:1});await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:restPoint.x-120,y:restPoint.y+30,button:'left',buttons:1});
  await browser.waitFor('window.__demand.card().x<'+(restPoint.x-25));
  const beforeHide=await snapshot();observations.beforeHide=beforeHide;assert.ok(beforeHide.physicsFrames>resized.physicsFrames);
  await browser.evaluate('window.__demand.hidden=true;document.dispatchEvent(new Event("visibilitychange"))');
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:restPoint.x-120,y:restPoint.y+30,button:'left',clickCount:1});
  const hidden=await snapshot();observations.hidden=hidden;await delay(250);const hiddenEnd=await snapshot();assert.equal(hiddenEnd.draws,hidden.draws);assert.equal(hiddenEnd.physicsFrames,hidden.physicsFrames);
  await browser.evaluate('window.__demand.hidden=false;document.dispatchEvent(new Event("visibilitychange"))');await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const restored=await snapshot();observations.restored=restored;assert.equal(restored.physicsFrames,hiddenEnd.physicsFrames,'manual fallback restores statically instead of resuming inertia');assert.ok(restored.draws>hiddenEnd.draws);assert.equal(restored.sameIframe,true);assert.equal(restored.backFacing,true);assert.ok(restored.card.onScreen);assert.ok(Math.abs(restored.card.x-restPoint.x)<8,'hiding during drag cannot leave the card stranded off screen');
  const cancelPoint=restored.card;
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:cancelPoint.x,y:cancelPoint.y,button:'left',clickCount:1});await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:cancelPoint.x+110,y:cancelPoint.y+25,button:'left',buttons:1});await browser.waitFor('window.__demand.card().x>'+(cancelPoint.x+20));
  await browser.evaluate('document.querySelector(".lanyard-interaction").dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:window.__demand.pointerId,pointerType:"mouse",button:0}))');await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:cancelPoint.x+110,y:cancelPoint.y+25,button:'left',clickCount:1});await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const cancelled=await snapshot();observations.cancelled=cancelled;await delay(250);const cancelEnd=await snapshot();assert.equal(cancelEnd.physicsFrames,cancelled.physicsFrames);assert.equal(cancelEnd.draws,cancelled.draws);assert.equal(cancelEnd.backFacing,true);assert.equal(cancelEnd.sameIframe,true);assert.ok(cancelEnd.card.onScreen);assert.ok(Math.abs(cancelEnd.card.x-cancelPoint.x)<8);assert.equal(cancelEnd.iframeCreates,1);assert.equal(cancelEnd.iframeCount,1);assert.equal(generation,1);
  const capture:unknown=await browser.screenshot();assert.ok(typeof capture==='string');const png=Buffer.from(capture,'base64');assert.ok(png.length>=24);assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));assert.equal(png.readUInt32BE(16),1100);assert.equal(png.readUInt32BE(20),820);
  console.log('LOGIN_REDUCED_MANUAL_METRICS',JSON.stringify({observations,generation,visibility:'synthetic document visibility and pointercancel',actualQr:'NOT_RUN'}));
 }catch(error){
  failure=error;let state:unknown=null;try{state=await browser?.evaluate('window.__demand?.snapshot?.()??null');}catch{/* The failed document may have navigated. */}
  console.log('LOGIN_REDUCED_MANUAL_FAILURE',JSON.stringify({observations,generation,state}));
 }finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});

// Hold delivery only after the real native requestDevice Promise fulfills.
// The same GPUDevice crosses the actual initialize await; no module-timing guess.
for(const scenario of ['native first frame','pipeline failure recovery','pending visibility and resize','pending document teardown'] as const)test('compiled login backdrop '+scenario,{timeout:90_000},async()=>{
 const initialMode:BackdropPipelineMode=scenario==='pipeline failure recovery'?'reject':scenario==='pending visibility and resize'?'lifecycle':scenario==='pending document teardown'?'destroy':'normal';
 let origin='',generation=0,fixtureFailure:unknown;const proofs:BackdropPipelineSnapshot[]=[];
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);
  if(url.pathname==='/backdrop-pipeline-proof'&&request.method==='POST'){
   const chunks:Buffer[]=[];let bytes=0;for await(const part of request){const chunk:unknown=part;assert.ok(Buffer.isBuffer(chunk));bytes+=chunk.length;assert.ok(bytes<24_576);chunks.push(chunk);}proofs.push(readBackdropPipelineSnapshot(JSON.parse(Buffer.concat(chunks).toString()) as unknown));response.writeHead(204);response.end();return;
  }
  if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/workbench/desktop/embedded'){generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.backdrop-pipeline-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Synthetic backdrop pipeline test</title>');
 })().catch(error=>{fixtureFailure??=error;if(!response.headersSent)response.writeHead(500);response.end('SYNTHETIC_BACKDROP_PIPELINE_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 const provider=createNeutralProviderFixture();
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true,socketFactory:provider.socketFactory});assert.ok(browser);const currentBrowser=browser;
  const snapshot=async()=>readBackdropPipelineSnapshot(await currentBrowser.evaluate('window.__backdropPipeline.snapshot()'));
  const savedIframe=async()=>{await currentBrowser.waitFor('Boolean(document.querySelector("#wecom-panel iframe"))');await currentBrowser.evaluate('window.__backdropPipeline.savedIframe??=document.querySelector("#wecom-panel iframe")');};
  const present=async()=>{await savedIframe();await currentBrowser.evaluate('window.__backdropPipeline.present();window.__backdropPipeline.present()');await currentBrowser.waitFor('document.body?.dataset.loginScene==="ready"');const value=await snapshot();assert.equal(value.sameIframe,true);assert.equal(value.iframeCreates,1);assert.equal(value.iframeCount,1);assert.equal(value.prepared.length,1);return value;};
  const pending=async()=>{await currentBrowser.waitFor('window.__backdropPipeline?.nativeDeviceFulfilled>0&&window.__backdropPipeline.pendingDeviceReturns>0');await savedIframe();const value=await snapshot();assert.equal(value.available,true);assert.ok(value.nativeDeviceFulfilled>0);assert.ok(value.pendingDeviceReturns>0);assert.equal(value.deviceReturns,0);assert.equal(value.submits,0);assert.equal(value.submitsWhilePending,0);assert.equal(value.shaderTransitions,0);assert.equal(value.prepared.length,0);return value;};
  const releaseDevice=async()=>{await currentBrowser.evaluate('window.__backdropPipeline.releaseDevice();window.__backdropPipeline.afterDelivery()');};
  await browser.command('Network.enable');await provider.install(browser.command);await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:backdropPipelineScript(initialMode)});await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  if(scenario==='native first frame'){
   const before=await pending();await releaseDevice();await browser.waitFor('document.body?.dataset.backdrop==="shader"&&document.body.dataset.loginScene==="prepared"');
   const prepared=await snapshot();assert.ok(prepared.syncRequests+prepared.asyncRequests>0,'a real native pipeline is created without prescribing its API');assert.equal(prepared.pendingReturned,0);assert.equal(prepared.asyncRejected,0);assert.ok(prepared.submits>0);assert.equal(prepared.submitsWhilePending,0);assert.ok(prepared.firstSubmitSequence>prepared.deviceReleaseSequence);assert.equal(prepared.shaderTransitions,1);assert.deepEqual(prepared.prepared,[{version:1,panel:'created',backdrop:'shader'}]);assert.equal(prepared.sameIframe,true);assert.ok(prepared.maxSubmittedPixels>0&&prepared.maxSubmittedPixels<=550_000);
   await present();await delay(3200);const start=await snapshot(),sampleStart=performance.now();await delay(2200);const sampled=await snapshot(),frequency=(sampled.submits-start.submits)*1000/(performance.now()-sampleStart);assert.ok(frequency>=20&&frequency<=35,'the original 30fps background cap remains: '+frequency);assert.ok(sampled.maxSubmittedPixels<=550_000);assert.equal(sampled.shaderTransitions,1);assert.equal(sampled.prepared.length,1);assert.equal(sampled.sameIframe,true);assert.equal(generation,1);
   console.log('LOGIN_BACKDROP_ASYNC_NATIVE',JSON.stringify({before,prepared,sampled,frequency}));
  }else if(scenario==='pipeline failure recovery'){
   for(const mode of ['reject','held'] as const){
    if(mode==='held'){const priorOrigin=Number(await browser.evaluate('performance.timeOrigin'));await browser.evaluate('sessionStorage.setItem("backdrop-pipeline-test-mode","held")');await browser.command('Page.reload');await browser.waitFor('performance.timeOrigin!=='+priorOrigin+'&&window.__backdropPipeline?.mode==="held"');await pending();}
    if(mode==='reject'){await pending();await releaseDevice();}
    await browser.waitFor('document.body?.dataset.backdrop==="fallback"&&document.body.dataset.loginScene==="prepared"');await savedIframe();const fallback=await snapshot();assert.equal(fallback.available,true);if(mode==='reject')assert.ok(fallback.syncRejected>0);else{assert.ok(fallback.nativeDeviceFulfilled>0);assert.ok(fallback.pendingDeviceReturns>0);assert.equal(fallback.syncRequests+fallback.asyncRequests,0);}assert.equal(fallback.shaderTransitions,0);assert.equal(fallback.fallbackTransitions,1);assert.deepEqual(fallback.prepared,[{version:1,panel:'created',backdrop:'fallback'}]);assert.equal(fallback.reason,mode==='held'?'timeout':'render-failed');
    if(mode==='held')assert.ok(fallback.elapsedMs>=8000,'held compilation exits through the existing eight-second background deadline');else assert.equal(fallback.syncRejected,5,'the unchanged core error limit is bounded');
    if(mode==='held')await releaseDevice();await browser.evaluate('window.__backdropPipeline.twoFrames()');await delay(150);const late=await snapshot();assert.equal(late.backdrop,'fallback');assert.equal(late.shaderTransitions,0);assert.equal(late.submits,0);assert.equal(late.prepared.length,1);assert.equal(late.sameIframe,true);assert.equal(late.iframeCreates,1);assert.equal(await browser.evaluate('document.getElementById("login-backdrop").childElementCount'),0,'late native pipeline completion never remounts a timed-out background');const presented=await present();assert.equal(presented.reason,fallback.reason);console.log('LOGIN_BACKDROP_ASYNC_FALLBACK',JSON.stringify({mode,fallback,late,presented}));
   }
   assert.equal(generation,2,'only the explicit full-page reload creates another login intent');
  }else if(scenario==='pending visibility and resize'){
   const before=await pending();await browser.evaluate('window.__backdropPipeline.setHidden(true)');await browser.command('Emulation.setDeviceMetricsOverride',{width:1100,height:820,deviceScaleFactor:1,mobile:false});await releaseDevice();await browser.evaluate('window.__backdropPipeline.twoFrames()');const hidden=await snapshot();assert.equal(hidden.deviceReturns,before.nativeDeviceFulfilled);assert.equal(hidden.pendingDeviceReturns,0);assert.equal(hidden.hidden,true);assert.equal(hidden.submits,0);assert.equal(hidden.shaderTransitions,0);assert.equal(hidden.prepared.length,0);assert.equal(hidden.sameIframe,true);
   await browser.evaluate('window.__backdropPipeline.setOnline(false);window.__backdropPipeline.setHidden(false)');await browser.command('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});await browser.evaluate('window.__backdropPipeline.twoFrames()');const offline=await snapshot();assert.equal(offline.hidden,false);assert.equal(offline.online,false);assert.equal(offline.submits,0);assert.equal(offline.shaderTransitions,0);assert.equal(offline.prepared.length,0);assert.equal(offline.sameIframe,true);
   await browser.evaluate('window.__backdropPipeline.setOnline(true)');await browser.waitFor('document.body?.dataset.backdrop==="shader"&&document.body.dataset.loginScene==="prepared"');const resumed=await snapshot();assert.ok(resumed.syncRequests+resumed.asyncRequests>0);assert.equal(resumed.shaderTransitions,1);assert.equal(resumed.prepared.length,1);assert.equal(resumed.sameIframe,true);assert.ok(resumed.canvasWidth*resumed.canvasHeight<=550_000);assert.ok(Math.abs(resumed.canvasWidth/resumed.canvasHeight-1000/760)<.01,'the first real draw uses the latest resized viewport, not the pre-compile dimensions');assert.ok(resumed.maxSubmittedPixels<=550_000);await present();assert.equal(generation,1);console.log('LOGIN_BACKDROP_ASYNC_LIFECYCLE',JSON.stringify({before,hidden,offline,resumed}));
  }else{
   const before=await pending();await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}))");await releaseDevice();await browser.evaluate('window.__backdropPipeline.twoFrames()');const disposed=await snapshot();assert.equal(disposed.pageHidden,true);assert.equal(disposed.submits,0);assert.equal(disposed.adapterRequests,before.adapterRequests);assert.equal(disposed.deviceRequests,before.deviceRequests);assert.equal(disposed.nativeDeviceFulfilled,before.nativeDeviceFulfilled);assert.equal(disposed.nativeCanvasConfigurations,before.nativeCanvasConfigurations);assert.equal(disposed.syncRequests+disposed.asyncRequests,before.syncRequests+before.asyncRequests);assert.equal(disposed.submitsAfterPagehide,0);assert.equal(disposed.shaderTransitions,0);assert.equal(disposed.prepared.length,0);assert.equal(disposed.iframeCreates,before.iframeCreates);assert.equal(disposed.rafPending,0,'page teardown leaves no continuing production RAF work after pending callbacks drain');
   await browser.command('Page.navigate',{url:origin+'/done'});await browser.waitFor('location.pathname==="/done"');assert.equal(generation,1);console.log('LOGIN_BACKDROP_ASYNC_DESTROY',JSON.stringify({before,disposed,proofs}));
  }
  provider.assertHealthy();console.log('LOGIN_NEUTRAL_PROVIDER_FIXTURE',JSON.stringify(provider.receipt()));if(fixtureFailure)throw fixtureFailure;
 }catch(error){failure=error;let state:unknown=null;try{state=await browser?.evaluate('window.__backdropPipeline?.snapshot?.()??null');}catch{}console.log('LOGIN_BACKDROP_ASYNC_FAILURE',JSON.stringify({scenario,generation,state,proofs}));}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();provider.dispose();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});


// This is an explicit public SDK-message simulation from the owned test page.
// It does not represent a real provider callback or user authorization.
test('compiled login SDK onLoginFail exposes an actionable error and renews only on explicit retry',{timeout:90_000},async()=>{
 let origin='',generation=0,fixtureFailure:unknown;const provider=createNeutralProviderFixture();
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url??'/',origin);if(await serveEmbeddedLoginAsset(request,response,url))return;
  if(url.pathname==='/backdrop-pipeline-proof'){response.writeHead(204);response.end();return;}
  if(url.pathname==='/workbench/desktop/embedded'){generation++;const now=Date.now();response.writeHead(200,embeddedLoginHeaders());response.end(await renderEmbeddedLogin({corpId:'synthetic',agentId:'1000001',state:'desktop.sdk-provider-fail-'+generation,issuedEpochMs:now,expiresEpochMs:now+300_000,publicOrigin:origin}));return;}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Synthetic SDK callback test</title>');
 })().catch(error=>{fixtureFailure??=error;if(!response.headersSent)response.writeHead(500);response.end('SYNTHETIC_SDK_CALLBACK_FAILED');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
 try{
  browser=await launchSystemBrowser({url:origin+'/start',width:1280,height:900,graphics:true,socketFactory:provider.socketFactory});assert.ok(browser);await browser.command('Network.enable');await provider.install(browser.command);await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:backdropPipelineScript('normal')});await browser.command('Page.navigate',{url:origin+'/workbench/desktop/embedded'});
  await browser.waitFor('document.getElementById("desktop-login")?.dataset.loginPanel==="created"&&document.querySelector("#wecom-panel iframe")&&window.__backdropPipeline?.nativeDeviceFulfilled>0&&window.__backdropPipeline.pendingDeviceReturns>0');
  await browser.evaluate('window.__backdropPipeline.savedIframe=document.querySelector("#wecom-panel iframe")');
  await browser.evaluate(`(()=>{const frame=document.querySelector('#wecom-panel iframe');const data=JSON.stringify({type:'ww-iframe-handle:call',args:{type:'call',name:'onLoginFail',payload:{errCode:'SYNTHETIC_PROVIDER_FAILURE'}}});window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.invalid',source:frame.contentWindow,data}));window.dispatchEvent(new MessageEvent('message',{origin:'https://login.work.weixin.qq.com',source:window,data}));})()`);
  assert.equal(await browser.evaluate('document.getElementById("desktop-login").dataset.loginPanel'),'created','the actual SDK rejects wrong-origin and wrong-source callback messages');
  await browser.evaluate(`(()=>{const frame=document.querySelector('#wecom-panel iframe');window.dispatchEvent(new MessageEvent('message',{origin:'https://login.work.weixin.qq.com',source:frame.contentWindow,data:JSON.stringify({type:'ww-iframe-handle:call',args:{type:'call',name:'onLoginFail',payload:{errCode:'SYNTHETIC_PROVIDER_FAILURE'}}})}));})()`);
  await browser.waitFor('document.getElementById("desktop-login")?.dataset.loginPanel==="failed"');await browser.evaluate('window.__backdropPipeline.releaseDevice();window.__backdropPipeline.afterDelivery()');await browser.waitFor('document.body?.dataset.loginScene==="prepared"&&document.body.dataset.backdrop==="shader"');
  const prepared=readBackdropPipelineSnapshot(await browser.evaluate('window.__backdropPipeline.snapshot()'));assert.deepEqual(prepared.prepared,[{version:1,panel:'failed',backdrop:'shader'}]);assert.equal(prepared.sameIframe,true);assert.equal(prepared.iframeCreates,1);assert.equal(prepared.iframeCount,1);assert.equal(generation,1);assert.equal(await browser.evaluate('Boolean(document.querySelector("#wecom-panel .login-panel-failure"))'),false,'callback failure does not pretend the initializer threw or replace its live iframe');
  await browser.evaluate('window.__backdropPipeline.present();window.__backdropPipeline.present()');await browser.waitFor('document.body?.dataset.loginScene==="ready"');
  assert.equal(await browser.evaluate('document.getElementById("login-status").textContent'),'企业微信登录面板未能加载，请重新获取二维码，或使用官方登录页。');
  await browser.waitFor('(()=>{const status=document.getElementById("login-status"),button=document.getElementById("retry-login"),link=document.querySelector(".login-panel-recovery a");if(!status||!button||!link)return false;const style=getComputedStyle(status),r=status.getBoundingClientRect(),b=button.getBoundingClientRect(),l=link.getBoundingClientRect();return !status.closest("[inert]")&&style.display!=="none"&&style.visibility==="visible"&&r.width>0&&r.height>0&&!button.disabled&&b.width>0&&b.height>0&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button&&link.getAttribute("href")==="/workbench/desktop"&&l.width>0&&l.height>0;})()');
  const current=readBackdropPipelineSnapshot(await browser.evaluate('window.__backdropPipeline.snapshot()'));assert.equal(current.sameIframe,true);assert.equal(current.prepared.length,1);assert.equal(current.iframeCreates,1);
  const previousOrigin=Number(await browser.evaluate('performance.timeOrigin'));const point:unknown=await browser.evaluate('(()=>{const r=document.getElementById("retry-login").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');assert.ok(point&&typeof point==='object'&&'x'in point&&'y'in point&&typeof point.x==='number'&&typeof point.y==='number');
  for(const type of ['mousePressed','mouseReleased'])await browser.command('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});await browser.waitFor('performance.timeOrigin!=='+previousOrigin+'&&document.getElementById("desktop-login")?.dataset.loginPanel==="created"&&document.querySelector("#wecom-panel iframe")');assert.equal(generation,2,'only the actionable explicit retry renews the complete login intent');
  provider.assertHealthy();console.log('LOGIN_SDK_ON_LOGIN_FAIL',JSON.stringify({kind:'SIMULATED_PUBLIC_SDK_MESSAGE_NOT_REAL_PROVIDER',prepared,current,provider:provider.receipt(),retryGeneration:generation}));if(fixtureFailure)throw fixtureFailure;
 }catch(error){failure=error;let state:unknown=null;try{state=await browser?.evaluate('({pipeline:window.__backdropPipeline?.snapshot(),panel:document.getElementById("desktop-login")?.dataset.loginPanel,status:document.getElementById("login-status")?.textContent,retryDisabled:document.getElementById("retry-login")?.disabled})');}catch{}console.log('LOGIN_SDK_ON_LOGIN_FAIL_FAILURE',JSON.stringify({generation,state}));}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();provider.dispose();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}],failure);}
});
