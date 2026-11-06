import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createHash,createPublicKey,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const startupFiles=['main.mjs','policy.mjs','startup-state.mjs','preload.cjs','unavailable.html','package.json','icon.ico','icon.png','chrome.html','login-chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs','startup.html','startup.css','startup.mjs','startup-preload.cjs','startup-video.mp4'];

interface StartupFixture {
  command:(action:string,expression?:string)=>Promise<unknown>;
  wait:(surface:'evaluate'|'startup-evaluate'|'chrome-evaluate',expression:string,timeout?:number)=>Promise<void>;
  waitReleased:()=>Promise<void>;
  diagnostics:()=>string;
  close:()=>Promise<void>;
}
async function launchStartupFixture(root:string,origin:string,spki:string,name:string,media:'normal'|'missing'|'rejected'|'script-failed'|'bootstrap-stalled'='normal',reduce=false):Promise<StartupFixture>{
  const stage=path.join(root,'.local/electron/temp',name),profile=path.join(root,'.local/electron/profiles',name);
  mkdirSync(stage,{recursive:true});mkdirSync(profile,{recursive:true});
  for(const file of startupFiles)copyFileSync(path.join(root,'.local/electron/stage',file),path.join(stage,file));
  copyFileSync(path.join(root,'.local/electron/compiled/process-driver.mjs'),path.join(stage,'process-driver.mjs'));
  const info=JSON.parse(readFileSync(path.join(stage,'package.json'),'utf8'));info.main='process-driver.mjs';writeFileSync(path.join(stage,'package.json'),JSON.stringify(info));
  writeFileSync(path.join(stage,'desktop.config.json'),JSON.stringify({schemaVersion:1,serverOrigin:origin}));
  if(media==='missing')writeFileSync(path.join(stage,'startup-video.mp4'),Buffer.from('synthetic invalid media for error recovery'));
  if(media==='script-failed')writeFileSync(path.join(stage,'startup.mjs'),'const invalidStartupModule = ; // Deliberate test-only parse failure.');
  if(media==='rejected'){
    writeFileSync(path.join(stage,'startup.html'),readFileSync(path.join(stage,'startup.html'),'utf8').replace('<script type="module" src="startup.mjs">','<script type="module" src="reject-play.mjs"></script><script type="module" src="startup.mjs">'));
    writeFileSync(path.join(stage,'reject-play.mjs'),'HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException("Synthetic denied playback","NotAllowedError"));');
  }
  const env:NodeJS.ProcessEnv={...process.env,WECOM_DESKTOP_DATA_ROOT:profile,WECOM_DESKTOP_TEST_STAGE:stage,WECOM_DESKTOP_TEST_SPKI:spki};delete env.ELECTRON_RUN_AS_NODE;
  if(media==='bootstrap-stalled')env.WECOM_DESKTOP_TEST_BOOTSTRAP_STALL='true';
  const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[stage,'--disable-features=CalculateNativeWinOcclusion',...(reduce?['--wecom-reduced-motion']:[])],{cwd:root,env,windowsHide:false,stdio:['ignore','ignore','pipe','ipc']});
  child.stderr?.on('data',(chunk:Buffer)=>writeFileSync(path.join(profile,'process-stderr.log'),chunk,{flag:'a'}));
  let ready=false,next=1;const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  child.on('message',(value:unknown)=>{if(!value||typeof value!=='object')return;const message=value as Record<string,unknown>;if(message.ready===true){ready=true;return;}if(typeof message.id!=='number')return;const slot=pending.get(message.id);if(!slot)return;clearTimeout(slot.timer);pending.delete(message.id);if(message.ok)slot.resolve(message.result);else slot.reject(Error(String(message.error)));});
  child.on('exit',()=>{for(const slot of pending.values()){clearTimeout(slot.timer);slot.reject(Error('STARTUP_FIXTURE_EXITED'));}pending.clear();});
  const command=(action:string,expression?:string):Promise<unknown>=>new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(Error('STARTUP_FIXTURE_COMMAND_TIMEOUT:'+action));},5000);pending.set(id,{resolve,reject,timer});child.send({id,action,expression});});
  const wait=async(surface:'evaluate'|'startup-evaluate'|'chrome-evaluate',expression:string,timeout=12_000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){try{if(await command(surface,expression))return;}catch(error){if(!(error instanceof Error)||!/Render frame was disposed|frame was destroyed|Script failed to execute|TEST_STARTUP/u.test(error.message))throw error;}await delay(40);}throw Error('STARTUP_FIXTURE_CONDITION_TIMEOUT:'+surface+':'+expression);};
  const waitReleased=async()=>{const deadline=Date.now()+12_000;while(Date.now()<deadline){const state=await command('state') as {startupVisible:boolean;viewCount:number};if(!state.startupVisible&&state.viewCount===2)return;await delay(40);}throw Error('STARTUP_FIXTURE_HANDOFF_TIMEOUT');};
  const diagnostics=()=>{const file=path.join(profile,'logs/startup.jsonl');return existsSync(file)?readFileSync(file,'utf8'):'';};
  const close=async()=>{if(child.exitCode!==null)return;if(child.connected)child.disconnect();await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});};
  try{const deadline=Date.now()+10_000;while(!ready&&Date.now()<deadline){if(child.exitCode!==null)throw Error('STARTUP_FIXTURE_START_FAILED');await delay(25);}assert.ok(ready);return {command,wait,waitReleased,diagnostics,close};}catch(error){await close();throw error;}
}

test('native startup gates real playback, isolates input, preserves prepared frames and exits bounded failures',{timeout:180000,skip:process.platform!=='win32'},async()=>{
  const root=process.cwd(),run='startup-'+randomUUID(),tlsDirectory=path.join(root,'.local/electron/temp',run+'-tls');
  mkdirSync(tlsDirectory,{recursive:true});
  const openssl=['D:/Program Files/Git/usr/bin/openssl.exe','C:/Program Files/Git/usr/bin/openssl.exe'].find(existsSync);assert.ok(openssl);
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(tlsDirectory,'key.pem'),'-out',path.join(tlsDirectory,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
  const cert=readFileSync(path.join(tlsDirectory,'cert.pem')),key=readFileSync(path.join(tlsDirectory,'key.pem'));
  const spki=createHash('sha256').update(createPublicKey(cert).export({type:'spki',format:'der'})).digest('base64');
  let mode:'early'|'manual'|'legacy'|'visible'='early';
  const server=createServer({key,cert},(_request,response)=>{
    response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    response.end(`<!doctype html><body data-fixture="${mode}"><button id="under-cover" style="position:fixed;left:calc(50% - 50px);top:calc(50% - 20px);width:100px;height:40px">合成登录操作</button><iframe src="about:blank"></iframe><script>
      window.documentId=crypto.randomUUID();window.clicks=0;window.presentations=0;
      const present=()=>{if(document.body.dataset.presented==='true')return;window.presentations++;document.body.dataset.presented='true';};
      document.getElementById('under-cover').onclick=()=>window.clicks++;
      window.savedFrame=document.querySelector('iframe');window.savedFrameWindow=window.savedFrame.contentWindow;
      window.prepare=()=>{window.signalSent=true;return window.workbenchLogin.startup.prepared({version:1,panel:'created',backdrop:'fallback'}).then(value=>{if(value.presented)present();return value;});};
      if(${JSON.stringify(mode)}!=='legacy'&&window.workbenchLogin?.startup){window.workbenchLogin.startup.onPresented(present);void window.workbenchLogin.startup.connect();}
      if(${JSON.stringify(mode)}==='early')void window.prepare();
      if(${JSON.stringify(mode)}==='visible'){
        const prepareWhenVisible=()=>{if(document.hidden||window.signalSent)return;window.preparedWhileVisible=true;void window.prepare();};
        document.addEventListener('visibilitychange',prepareWhenVisible);requestAnimationFrame(prepareWhenVisible);
      }
    </script></body>`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const origin='https://127.0.0.1:'+address.port;
  let fixture:StartupFixture|null=null;
  const launch=async(name:string,media:'normal'|'missing'|'rejected'|'script-failed'|'bootstrap-stalled'='normal',reduce=false)=>{fixture=await launchStartupFixture(root,origin,spki,run+'-'+name,media,reduce);return fixture;};
  const finish=async()=>{await fixture?.close();fixture=null;};
  try{
    const early=await launch('early');
    await early.wait('evaluate','window.signalSent===true');
    await early.wait('startup-evaluate','window.desktopStartup.state().then(state=>state.scene==="prepared")');
    assert.equal(await early.command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),false,'fast login preparation cannot bypass the first real playback');
    assert.equal((await early.command('state') as {startupVisible:boolean}).startupVisible,true);
    assert.equal(await early.command('evaluate','window.presentations'),0,'prepared login animations have not been presented in the background');
    assert.equal(await early.command('evaluate','typeof document.querySelector("iframe").contentWindow.workbenchLogin'),'undefined','child frames do not acquire even the presentation-only login bridge');
    await early.command('chrome-evaluate','document.getElementById("close").click()');
    assert.equal((await early.command('state') as {visible:boolean}).visible,false,'close-to-tray responds immediately without waiting for startup completion');
    await early.wait('startup-evaluate','document.querySelector("video").paused');
    await early.command('show');
    await early.command('tab');
    assert.notEqual((await early.command('state') as {focusedURL:string}).focusedURL,origin+'/workbench/desktop/embedded','Tab stays outside the covered login WebContents');
    const dimensions=await early.command('state') as {contentSize:number[]};
    await early.command('click',JSON.stringify({x:Math.floor((dimensions.contentSize[0]??0)/2),y:Math.floor((dimensions.contentSize[1]??0)/2)}));
    assert.equal(await early.command('evaluate','window.clicks'),0,'native overlay hit testing stops clicks on login controls');
    await early.waitReleased();await early.wait('evaluate','document.body.dataset.presented==="true"');
    assert.equal(await early.command('evaluate','window.presentations'),1,'one prepared scene receives exactly one presentation notification');
    assert.equal(await early.command('evaluate','window.savedFrame===document.querySelector("iframe")&&window.savedFrameWindow===document.querySelector("iframe").contentWindow'),true,'handoff retains the same already-created iframe and browsing context');
    await early.command('evaluate','window.prepare()');
    assert.equal((await early.command('state') as {startupVisible:boolean}).startupVisible,false,'duplicate readiness cannot recreate the startup player');
    await early.command('navigate',origin+'/workbench/app/');await early.wait('evaluate','location.pathname==="/workbench/app/"');
    assert.equal(await early.command('evaluate','typeof window.workbenchLogin'),'undefined','non-login paths never acquire startup readiness');
    await finish();

    mode='manual';const cached=await launch('cached-business-under-cover');
    await cached.wait('startup-evaluate','document.body.dataset.firstFrame==="true"');
    await cached.command('startup-evaluate','document.querySelector("video").pause();true');
    mode='business';await cached.command('navigate',origin+'/workbench/app/');
    await cached.wait('evaluate','typeof window.workbenchDesktop==="object"');
    const covered=await cached.command('evaluate','window.workbenchDesktop.getState()') as {visible:boolean;focused:boolean};
    assert.equal(covered.visible,false,'a cached business document beneath the video must not acquire business visibility');
    assert.equal(covered.focused,false,'native window focus does not present a covered business document');
    assert.equal((await cached.command('state') as {startupVisible:boolean}).startupVisible,true);
    await cached.command('startup-evaluate','document.querySelector("video").play().then(()=>true)');await cached.waitReleased();
    assert.equal(await cached.command('evaluate','window.workbenchDesktop.getState().then(state=>state.visible)'),true,'business visibility starts only after the native cover is released');
    await finish();

    mode='manual';const late=await launch('late');
    await late.wait('evaluate','typeof window.prepare==="function"');
    await late.wait('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)');
    const oldDocument=await late.command('evaluate','window.documentId');
    await late.command('evaluate','void window.prepare();location.assign("/workbench/desktop/embedded");true');
    await late.wait('evaluate','window.documentId!=='+JSON.stringify(oldDocument)+'&&typeof window.prepare==="function"');
    assert.equal(await late.command('startup-evaluate','window.desktopStartup.state().then(state=>state.scene)'), 'loading','a readiness race from the old document cannot prepare the replacement navigation');
    assert.equal((await late.command('state') as {startupVisible:boolean}).startupVisible,true);
    await late.wait('startup-evaluate','(()=>{const v=document.querySelector("video");return v.currentTime>.3&&v.currentTime<v.duration-1;})()');
    const beforeReady=Date.now();await late.command('evaluate','window.prepare()');await late.waitReleased();
    assert.ok(Date.now()-beforeReady<1000,'a prepared scene during a later loop releases without waiting for that loop to end');
    assert.equal(await late.command('evaluate','window.savedFrame===document.querySelector("iframe")&&window.savedFrameWindow===document.querySelector("iframe").contentWindow'),true);
    assert.equal(await late.command('evaluate','window.presentations'),1);
    await finish();

    mode='legacy';const legacy=await launch('legacy');
    await legacy.wait('evaluate','document.body.dataset.fixture==="legacy"');
    await legacy.wait('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)');
    assert.equal(await legacy.command('startup-evaluate','window.desktopStartup.state().then(state=>state.scene)'), 'loading','DOM readiness alone is not prepared scene readiness');
    await legacy.waitReleased();
    assert.equal(await legacy.command('login-chrome-evaluate','!document.querySelector("[data-compatibility-notice]").hidden&&!document.getElementById("menu").hidden'),true,'a DOM-only compatibility handoff retains a visible explanation and native recovery menu');
    assert.equal((await legacy.command('state') as {viewVisible:boolean}).viewVisible,true,'the old-server combination has a bounded compatibility path');
    await finish();

    mode='early';const noScript=await launch('startup-script-failed','script-failed');
    await noScript.wait('evaluate','window.signalSent===true');
    assert.equal(await noScript.command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),false);
    await noScript.waitReleased();
    assert.equal(await noScript.command('evaluate','window.presentations'),1,'a broken overlay module cannot permanently block a prepared login');
    assert.match(noScript.diagnostics(),/"failure":"first-frame-timeout"/u,'the main-process visible watchdog diagnoses a renderer that never started playback');
    assert.doesNotMatch(noScript.diagnostics(),/"firstPlaybackComplete":true/u,'watchdog recovery does not fabricate a completed playback');
    await finish();

    mode='manual';const recovered=await launch('retry-before-first-end');
    await recovered.wait('evaluate','typeof window.prepare==="function"');
    await recovered.wait('startup-evaluate','document.body.dataset.firstFrame==="true"');
    // Keep the normal first viewing incomplete while recovery creates its replacement document.
    await recovered.command('startup-evaluate','document.querySelector("video").pause();true');
    await recovered.wait('startup-evaluate','document.querySelector("video").paused');
    const failedDocument=await recovered.command('evaluate','window.documentId');
    await recovered.command('network-failure','-105');
    assert.equal(await recovered.command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),false);
    mode='visible';await recovered.command('chrome-evaluate','window.desktopChrome.command("reconnect")');
    await recovered.wait('evaluate','window.documentId!=='+JSON.stringify(failedDocument)+'&&window.preparedWhileVisible===true');
    await recovered.wait('startup-evaluate','window.desktopStartup.state().then(state=>state.scene==="prepared")');
    assert.equal((await recovered.command('state') as {viewVisible:boolean}).viewVisible,true,'a retry restores the remote view beneath the native cover before waiting for visibility-dependent resources');
    assert.equal((await recovered.command('state') as {startupVisible:boolean}).startupVisible,true,'the replacement login prepares while the original incomplete startup is still covered');
    await recovered.command('startup-evaluate','document.querySelector("video").play().then(()=>true)');await recovered.waitReleased();
    assert.equal(await recovered.command('evaluate','window.presentations'),1,'the recovered visible scene receives the eventual presentation');
    await finish();

    mode='manual';
    mode='early';const bootstrap=await launch('bootstrap-stalled','bootstrap-stalled');
    await bootstrap.wait('startup-evaluate','document.body.dataset.firstFrame==="true"');
    await bootstrap.waitReleased();
    assert.match(bootstrap.diagnostics(),/content-bootstrap-failed/u,'the empty target initialization has its own bounded diagnostic recovery');
    await bootstrap.wait('evaluate','typeof window.prepare==="function"');
    assert.equal((await bootstrap.command('state') as {startupVisible:boolean}).startupVisible,false,'a generation-zero bootstrap failure does not strand the continuous startup player');
    await finish();mode='manual';
    for(const [name,media,expected] of [['invalid-media','missing','media-error'],['denied-play','rejected','play-rejected']] as const){
      const broken=await launch(name,media);
      await broken.wait('evaluate','typeof window.prepare==="function"');
      await broken.wait('startup-evaluate','document.body.dataset.startupFailure==='+JSON.stringify(expected));
      assert.equal(await broken.command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),false,'media exceptions do not claim normal playback completion');
      await broken.command('evaluate','window.prepare()');await broken.waitReleased();
      assert.equal(await broken.command('evaluate','window.presentations'),1,'media failure allows an actionable prepared login');
      await finish();
    }
    const stalled=await launch('stalled');
    await stalled.wait('evaluate','typeof window.prepare==="function"');
    await stalled.wait('startup-evaluate','document.body.dataset.firstFrame==="true"');
    await stalled.command('startup-evaluate','document.querySelector("video").pause();true');
    await stalled.wait('startup-evaluate','document.body.dataset.startupFailure==="playback-stalled"');
    assert.equal(await stalled.command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),false,'the stall watchdog diagnoses failure without fabricating ended');
    await stalled.command('evaluate','window.prepare()');await stalled.waitReleased();await finish();

    const reduced=await launch('reduced-motion','normal',true);
    await reduced.wait('evaluate','typeof window.prepare==="function"');
    await reduced.wait('startup-evaluate','document.body.dataset.reducedMotion==="true"');
    assert.equal(await reduced.command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),false,'reduced motion is an explicit bypass, not a completed viewing');
    await reduced.command('evaluate','window.prepare()');await reduced.waitReleased();await finish();
    console.log('DESKTOP_STARTUP_MATRIX '+JSON.stringify({early_prepared:true,later_loop_handoff:true,iframe_retained:true,input_isolated:true,legacy_server_fallback:true,overlay_module_failure:true,retry_visible_before_first_end:true,decode_error:true,play_rejection:true,stall_watchdog:true,reduced_motion:true,real_wecom_qr:'NOT_RUN',physical_power_events:'NOT_RUN'}));
  }finally{await finish();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('real Electron navigation recovers offline/crashes and keeps authentication/window guards',{timeout:120000,skip:process.platform!=='win32'},async()=>{
  const root=process.cwd(),id=randomUUID(),stage=path.join(root,'.local/electron/temp','navigation-'+id),profile=path.join(root,'.local/electron/profiles','navigation-'+id);
  mkdirSync(stage,{recursive:true});mkdirSync(profile,{recursive:true});
  const openssl=['D:/Program Files/Git/usr/bin/openssl.exe','C:/Program Files/Git/usr/bin/openssl.exe'].find(existsSync);
  assert.ok(openssl,'native navigation tests require Git for Windows OpenSSL');
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(stage,'key.pem'),'-out',path.join(stage,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
  const cert=readFileSync(path.join(stage,'cert.pem')),key=readFileSync(path.join(stage,'key.pem'));
  const spki=createHash('sha256').update(createPublicKey(cert).export({type:'spki',format:'der'})).digest('base64');
  let status=404,loginRecovery=false,qrGeneration=0,confirmations=0;
  let embeddedRecovery=false,embeddedGeneration=0,embeddedConfirmations=0;
  let releaseEmbeddedConfirmation=()=>{};const embeddedConfirmation=new Promise<void>(resolve=>{releaseEmbeddedConfirmation=resolve;});
  let releaseConfirmation=()=>{};const confirmation=new Promise<void>(resolve=>{releaseConfirmation=resolve;});
  let releaseStartup=()=>{};
  const startup=new Promise<void>(resolve=>{releaseStartup=resolve;});
  const server=createServer({key,cert},async(request,response)=>{
    await startup;
    const url=new URL(request.url??'/', 'https://127.0.0.1');
    if(embeddedRecovery&&url.pathname==='/workbench/desktop/embedded'){
      embeddedGeneration++;response.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':'__Host-wecom_workbench_intent=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300'});
      response.end('<!doctype html><main id="embedded">内嵌二维码 '+embeddedGeneration+'</main><iframe src="about:blank"></iframe><script>let restarting=false;addEventListener("workbench-login-expired",()=>{if(!restarting){restarting=true;location.replace("/workbench/desktop/embedded")}});</script>');return;
    }
    if(embeddedRecovery&&url.pathname==='/workbench/callback'){
      embeddedConfirmations++;await embeddedConfirmation;response.writeHead(303,{location:'/workbench/app/'});response.end();return;
    }
    if(loginRecovery&&url.pathname==='/workbench/desktop'){
      qrGeneration++;response.writeHead(302,{location:'/workbench/qr?generation='+qrGeneration,'set-cookie':'__Host-wecom_workbench_intent=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+(qrGeneration===1?'2':'300')});response.end();return;
    }
    if(loginRecovery&&url.pathname==='/workbench/qr'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><main id="qr">二维码 '+qrGeneration+'</main><button onclick="location.href=\'/workbench/callback\'">手机确认</button>');return;
    }
    if(loginRecovery&&url.pathname==='/workbench/callback'){
      confirmations++;await confirmation;response.writeHead(url.search?400:303,url.search?{'content-type':'application/json'}:{location:'/workbench/app/'});response.end();return;
    }
    response.writeHead(status,{'content-type':status===200?'text/html; charset=utf-8':'application/json'});
    response.end(status===200?'<!doctype html><title>管理端</title><main>可用管理端</main>':JSON.stringify({error:{code:status===404?'WORKBENCH_NOT_FOUND':'WORKBENCH_UNAVAILABLE',retryable:false}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const origin='https://127.0.0.1:'+address.port;
  for(const file of ['main.mjs','policy.mjs','startup-state.mjs','preload.cjs','unavailable.html','package.json','icon.ico','icon.png','chrome.html','login-chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs','startup.html','startup.css','startup.mjs','startup-preload.cjs','startup-video.mp4'])copyFileSync(path.join(root,'.local/electron/stage',file),path.join(stage,file));
  for(const file of ['main.mjs','policy.mjs','startup-state.mjs','preload.cjs','chrome.mjs','chrome-preload.cjs','startup.mjs','startup-preload.cjs']){copyFileSync(path.join(root,'.local/electron/compiled',file),path.join(stage,file));assert.deepEqual(readFileSync(path.join(stage,file)),readFileSync(path.join(root,'.local/electron/compiled',file)));}
  copyFileSync(path.join(root,'.local/electron/compiled/process-driver.mjs'),path.join(stage,'process-driver.mjs'));
  const packageInfo=JSON.parse(readFileSync(path.join(stage,'package.json'),'utf8'));packageInfo.main='process-driver.mjs';writeFileSync(path.join(stage,'package.json'),JSON.stringify(packageInfo));
  writeFileSync(path.join(stage,'desktop.config.json'),JSON.stringify({schemaVersion:1,serverOrigin:origin}));
  const env:NodeJS.ProcessEnv={...process.env,WECOM_DESKTOP_DATA_ROOT:profile,WECOM_DESKTOP_TEST_STAGE:stage,WECOM_DESKTOP_TEST_SPKI:spki};delete env.ELECTRON_RUN_AS_NODE;
  // This GUI test observes the app's first show. SW_HIDE would override that first
  // native ShowWindow call and require the test driver to manufacture visibility.
  // Unrelated host windows must not occlude this GUI fixture. Actual hide/show
  // visibility and the application's native privacy guards remain under test.
  const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[stage,'--disable-features=CalculateNativeWinOcclusion'],{cwd:root,env,windowsHide:false,stdio:['ignore','ignore','pipe','ipc']});
  child.stderr?.on('data',(chunk:Buffer)=>writeFileSync(path.join(profile,'process-stderr.log'),chunk,{flag:'a'}));
  let ready=false,next=1;const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  child.on('message',(value:unknown)=>{if(!value||typeof value!=='object')return;const message=value as Record<string,unknown>;if(message.ready===true){ready=true;return;}if(typeof message.id!=='number')return;const slot=pending.get(message.id);if(!slot)return;clearTimeout(slot.timer);pending.delete(message.id);if(message.ok)slot.resolve(message.result);else slot.reject(Error(String(message.error)));});
  const command=(action:string,expression?:string):Promise<unknown>=>new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(Error('TEST_COMMAND_TIMEOUT'));},5000);pending.set(id,{resolve,reject,timer});child.send({id,action,expression});});
  const wait=async(expression:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){try{if(await command('evaluate',expression))return;}catch(error){if(!(error instanceof Error)||!/Render frame was disposed|frame was destroyed|Script failed to execute/u.test(error.message))throw error;}await delay(50);}throw Error('EXPECTED_FRIENDLY_HTTP_ERROR_NOT_RENDERED');};
  const waitChrome=async(expression:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){if(await command('chrome-evaluate',expression))return;await delay(50);}throw Error('EXPECTED_LOCAL_RECOVERY_NOT_RENDERED');};
  const waitStartup=async(expression:string)=>{const deadline=Date.now()+8000;while(Date.now()<deadline){if(await command('startup-evaluate',expression))return;await delay(50);}throw Error('EXPECTED_STARTUP_VIDEO_STATE_NOT_RENDERED');};
  try{
    const deadline=Date.now()+10000;while(!ready&&Date.now()<deadline)await delay(50);assert.ok(ready);
    assert.equal(await command('chrome-evaluate','document.querySelector(".titlebar")!==null'),true);
    assert.equal(await command('chrome-evaluate','document.querySelector(".surface-name").textContent'),'v'+packageInfo.version,'the trusted titlebar renders the actual package version');
    assert.equal(await command('chrome-evaluate','(()=>{const button=document.getElementById("menu");button.focus();return getComputedStyle(button).outlineStyle;})()'),'none','titlebar controls follow the app focus policy');
    const showDeadline=Date.now()+5000;
    while(!(await command('state') as {visible:boolean}).visible&&Date.now()<showDeadline)await delay(50);
    assert.equal((await command('state') as {visible:boolean}).visible,true,'the local startup window must become visible without waiting for a remote response');
    assert.equal((await command('state') as {startupVisible:boolean}).startupVisible,true,'a trusted native child view covers remote loading before the first response');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,true,'remote login stays visible beneath the cover so its preparation can make progress');
    const startupBounds=await command('state') as {startupBounds:{x:number;y:number;width:number;height:number};contentSize:number[];windowBounds:{width:number;height:number}};
    assert.equal(startupBounds.windowBounds.width,1440);assert.equal(startupBounds.windowBounds.height,960,'startup keeps the existing main window size');
    assert.equal(startupBounds.startupBounds.x,0);assert.equal(startupBounds.startupBounds.y,40);
    assert.equal(startupBounds.startupBounds.width,startupBounds.contentSize[0]);assert.equal(startupBounds.startupBounds.height,(startupBounds.contentSize[1]??0)-40);
    await waitStartup('document.body.dataset.firstFrame==="true"');
    assert.deepEqual(await command('startup-evaluate','(()=>{const v=document.querySelector("video"),s=getComputedStyle(v);window.__observedStartupEnds=0;v.addEventListener("ended",()=>window.__observedStartupEnds++);return {width:v.videoWidth,height:v.videoHeight,duration:Math.round(v.duration*1e6)/1e6,loop:v.loop,muted:v.muted,playsInline:v.playsInline,fit:s.objectFit,source:v.getAttribute("src"),local:location.protocol,noNode:typeof require+":"+typeof process};})()'),{width:972,height:972,duration:2.266667,loop:false,muted:true,playsInline:true,fit:'contain',source:'startup-video.mp4',local:'file:',noNode:'undefined:undefined'},'the original local MP4 decodes in Electron without a media dependency or remote source');
    const startupImage=await command('screenshot');assert.ok(typeof startupImage==='string'&&startupImage.startsWith(profile+path.sep));
    console.log('DESKTOP_STARTUP '+JSON.stringify({local_visible_before_response:true,remote_visible_under_native_cover:true,video_sha256:createHash('sha256').update(readFileSync(path.join(stage,'startup-video.mp4'))).digest('hex'),screenshot:{file:startupImage,sha256:createHash('sha256').update(readFileSync(startupImage)).digest('hex')}}));
    assert.equal(await command('chrome-evaluate','document.querySelector(".startup-columns,.startup-card,.startup-line")===null'),true,'before authentication the native startup surface must not impersonate the ticket workbench');
    assert.equal(await command('chrome-evaluate','document.body.dataset.booting'),'true');
    assert.equal(await command('chrome-evaluate','document.querySelector(".loader")===null'),true,'the parent chrome no longer renders a second CSS spinner');
    assert.equal(await command('chrome-evaluate','Array.from(document.querySelectorAll(".window-actions button")).filter(button=>button.getBoundingClientRect().width>0).length'),3,'startup exposes window controls without the workbench menu');
    await command('chrome-evaluate','document.getElementById("minimize").click()');
    await waitStartup('document.querySelector("video").paused');
    const minimizedTime=await command('startup-evaluate','document.querySelector("video").currentTime');await delay(350);
    assert.equal(await command('startup-evaluate','document.querySelector("video").currentTime'),minimizedTime,'minimizing pauses the same continuous player');
    await command('show');await waitStartup('!document.querySelector("video").paused');
    for(const [pause,resume] of [['lock','unlock'],['suspend','resume-after-idle']] as const){
      await command(pause);await waitStartup('document.querySelector("video").paused');
      const pausedTime=await command('startup-evaluate','document.querySelector("video").currentTime');await delay(250);
      assert.equal(await command('startup-evaluate','document.querySelector("video").currentTime'),pausedTime,'native '+pause+' pauses media rather than advancing a wall-clock completion');
      await command(resume,resume==='resume-after-idle'?'360000':undefined);await waitStartup('!document.querySelector("video").paused');
    }
    await waitStartup('window.__observedStartupEnds>=2');
    assert.equal(await command('startup-evaluate','window.desktopStartup.state().then(state=>state.firstPlaybackComplete)'),true,'only real ended establishes the normal first playback');
    assert.equal((await command('state') as {startupVisible:boolean}).startupVisible,true,'multiple completed loops retain the cover while the current remote scene is loading');
    releaseStartup();
    await wait('document.body?.innerText.includes("服务器尚未提供桌面入口")');
    await waitChrome('document.body.dataset.booting==="false"');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,true,'the first rendered document replaces startup content');
    assert.equal((await command('state') as {startupVisible:boolean}).startupVisible,false,'the actionable HTTP error retires the completed startup player');
    assert.equal(await command('evaluate','document.body.innerText.includes("WORKBENCH_NOT_FOUND")'),false);
    for(const [code,expected] of [[503,'服务暂时不可用'],[403,'当前账号无法进入工作台'],[200,'可用管理端']] as const){
      status=code;await command('navigate',origin+'/workbench/desktop');await wait('document.body?.innerText.includes('+JSON.stringify(expected)+')');
    }
    loginRecovery=true;
    await command('navigate',origin+'/workbench/desktop');await wait('document.querySelector("#qr")?.textContent==="二维码 1"');
    await wait('document.querySelector("#qr")?.textContent==="二维码 2"');
    assert.equal(confirmations,0,'the waiting QR renews before the user spends a confirmation');
    await command('evaluate','document.querySelector("button").click()');
    const callbackDeadline=Date.now()+3000;while(confirmations<1&&Date.now()<callbackDeadline)await delay(25);
    assert.equal(confirmations,1);await command('resume-after-idle','360000');
    assert.equal(qrGeneration,2,'an in-flight phone confirmation must not rotate its browser binding');
    releaseConfirmation();await wait('document.body?.innerText.includes("可用管理端")');
    assert.equal(confirmations,1,'one phone confirmation reaches the workbench after a long wait');
    await command('navigate',origin+'/workbench/desktop');await wait('document.querySelector("#qr")?.textContent==="二维码 3"');
    await command('resume-after-idle','360000');await wait('document.querySelector("#qr")?.textContent==="二维码 4"');
    await command('navigate',origin+'/workbench/callback?expired=1');await wait('document.querySelector("#qr")?.textContent==="二维码 5"');
    loginRecovery=false;embeddedRecovery=true;
    await command('navigate',origin+'/workbench/desktop/embedded');await wait('document.querySelector("#embedded")?.textContent==="内嵌二维码 1"');
    const loginLayout=await command('state') as {viewBounds:{y:number;height:number};contentSize:number[];loginControlsVisible:boolean};
    assert.equal(loginLayout.viewBounds.y,0,'embedded login starts at the window edge without the titlebar strip');
    assert.equal(loginLayout.viewBounds.height,loginLayout.contentSize[1]);
    assert.equal(loginLayout.loginControlsVisible,true,'transparent window controls remain available over login');
    assert.equal(await command('login-chrome-evaluate','Array.from(document.querySelectorAll(".window-actions button")).filter(button=>!button.hidden).length'),3);
    assert.equal(await command('login-chrome-evaluate','document.querySelector(".identity,[data-startup]")===null&&document.getElementById("menu").hidden'),true,'normal login has no visible application menu or title strip content');
    assert.equal(await command('login-chrome-evaluate','getComputedStyle(document.body).backgroundColor'),'rgba(0, 0, 0, 0)');
    assert.equal(await command('login-chrome-evaluate','window.desktopChrome.command("menu").then(()=>false,()=>true)'),true,'login controls cannot open the application menu');
    assert.equal(await command('login-chrome-evaluate','window.desktopChrome.command("reconnect").then(()=>false,()=>true)'),true,'transparent login controls do not acquire the local recovery action');
    assert.equal(await command('evaluate','typeof window.desktopChrome'),'undefined','remote login does not acquire window commands');
    assert.equal(await command('evaluate','typeof window.workbenchDesktop'),'undefined','embedded login has no business IPC');
    assert.equal(await command('evaluate','Object.keys(window.workbenchLogin).sort().join(":")'),'getAppVersion:quit:startup:version','login adds only its bounded presentation bridge');
    assert.equal(await command('evaluate','Object.keys(window.workbenchLogin.startup).sort().join(":")'),'connect:onPresented:prepared:version');
    assert.equal(await command('evaluate','window.workbenchLogin.startup.prepared({version:1,panel:"created",backdrop:"fallback"}).then(value=>value.presented)'),true,'a login reached after handoff is already presented without replaying startup');
    assert.equal(await command('evaluate','window.workbenchLogin.startup.prepared({version:1,panel:"qr-ready",backdrop:"fallback"}).then(()=>false,()=>true)'),true,'malformed readiness is rejected across the actual IPC boundary');
    assert.equal(await command('evaluate','window.workbenchLogin.getAppVersion()'),packageInfo.version,'login metadata is the actual package version');
    assert.equal(await command('evaluate','matchMedia("(prefers-reduced-motion: reduce)").matches'),false,'the content window defaults to full motion');
    assert.equal(await command('evaluate','typeof document.querySelector("iframe").contentWindow.workbenchLogin'),'undefined','child frames do not receive the login bridge');
    await command('hide');await wait('document.hidden===true');
    await command('show');await wait('document.hidden===false');
    await command('suspend');await command('resume-after-idle','360000');await wait('document.querySelector("#embedded")?.textContent==="内嵌二维码 2"');
    assert.equal(embeddedGeneration,2,'resume notifies the page to renew one whole embedded attempt');
    await command('offline');
    await command('evaluate',"window.dispatchEvent(new Event('workbench-login-expired'))");
    await waitChrome('!document.querySelector("[data-recovery]").hidden&&document.body.innerText.includes("已离线")');
    console.log('DESKTOP_OFFLINE '+JSON.stringify({state:await command('state'),screenshot:await command('screenshot')}));
    assert.equal(await command('chrome-evaluate','document.body.innerText.includes("已离线")'),true,'offline renewal must show a local offline surface independent of the remote renderer');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,false,'the failed remote renderer never covers the local offline surface');
    await command('chrome-evaluate','document.getElementById("minimize").click()');
    assert.equal((await command('state') as {minimized:boolean}).minimized,true,'offline window controls still work');await command('show');
    await delay(16_000);
    await command('online');
    await command('resume-after-idle','1200000');
    await wait('document.querySelector("#embedded")?.textContent==="内嵌二维码 3"');
    assert.equal(await command('chrome-evaluate','document.querySelector("[data-recovery]").hidden'),true,'network recovery retires the local offline surface even after the old retry budget');
    await command('network-failure','-105');await wait('document.querySelector("#embedded")?.textContent==="内嵌二维码 4"');
    assert.equal(embeddedGeneration,4,'a transient DNS failure on the fixed login GET recovers automatically');
    await command('navigate',origin+'/workbench/callback?code=embedded-synthetic&state=embedded-synthetic');
    const embeddedDeadline=Date.now()+3000;while(embeddedConfirmations<1&&Date.now()<embeddedDeadline)await delay(25);
    assert.equal(embeddedConfirmations,1);await command('resume-after-idle','360000');assert.equal(embeddedGeneration,4,'an in-flight embedded callback retains its binding');
    releaseEmbeddedConfirmation();await wait('document.body?.innerText.includes("可用管理端")');
    await command('offline');await command('navigate',origin+'/workbench/callback?code=never-replay&state=never-replay');
    await waitChrome('!document.querySelector("[data-recovery]").hidden');
    await command('online');await command('chrome-evaluate',"window.dispatchEvent(new Event('online'))");
    await wait('document.querySelector("#embedded")!==null');
    assert.equal(embeddedConfirmations,1,'a failed callback is replaced with fresh login and its code/state is never retried');
    embeddedRecovery=false;await command('navigate',origin+'/workbench/app/');await wait('document.body?.innerText.includes("可用管理端")');
    assert.equal((await command('state') as {viewBounds:{y:number}}).viewBounds.y,40,'business navigation restores the original titlebar');
    assert.equal(await command('chrome-evaluate','document.getElementById("menu").getBoundingClientRect().width>0'),true,'the real business document restores its normal local menu');
    await command('navigate',origin+'/workbench/app/');await wait('typeof window.workbenchDesktop==="object"');
    assert.equal(await command('evaluate','typeof window.workbenchLogin'),'undefined','business documents do not receive the login quit bridge');
    await command('offline');await command('navigate',origin+'/workbench/app/items/ticket/11111111-1111-4111-8111-111111111111');
    await waitChrome('!document.querySelector("[data-recovery]").hidden');
    await command('online');await command('chrome-evaluate',"window.dispatchEvent(new Event('online'))");
    await wait('location.pathname==="/workbench/app/items/ticket/11111111-1111-4111-8111-111111111111"&&document.body.innerText.includes("可用管理端")');
    console.log('DESKTOP_RECOVERY_ROUTE '+JSON.stringify({same_route_restored:true}));
    status=401;embeddedRecovery=true;
    await command('navigate',origin+'/workbench/app/');await wait('document.querySelector("#embedded")!==null');
    assert.equal(await command('login-chrome-evaluate','!document.querySelector("[data-session-notice]").hidden'),true,'a genuinely expired business document returns to login with a visible notice');
    status=403;await command('navigate',origin+'/workbench/app/');await wait('document.body.innerText.includes("当前账号无法进入工作台")');
    assert.equal(await command('evaluate','location.protocol'), 'file:','permission denial is not silently treated as an expired login');
    status=200;embeddedRecovery=false;await command('navigate',origin+'/workbench/app/');await wait('typeof window.workbenchDesktop==="object"');
    for(let crash=1;crash<=4;crash++){
      await command('crash-renderer');await waitChrome('!document.querySelector("[data-recovery]").hidden');
      if(crash<4)await wait('document.body?.innerText.includes("可用管理端")');
      else{
        await waitChrome('document.querySelector("[data-connection-title]").textContent==="页面暂时无法恢复"');
        console.log('DESKTOP_RENDERER_RECOVERY '+JSON.stringify({automatic_recoveries:3,loop_capped:true,screenshot:await command('screenshot')}));
        await command('chrome-evaluate','document.getElementById("reconnect").click()');await wait('document.body?.innerText.includes("可用管理端")');
      }
    }
    assert.equal(await command('evaluate','matchMedia("(prefers-reduced-motion: reduce)").matches'),false,'the motion preference survives navigation');
    await command('evaluate',`window.retainedDraft='synthetic draft';window.workbenchDesktop.updateContext({epoch:'00000000-0000-4000-8000-000000000123',blocked:true,live:true,remindersAvailable:false})`);
    await command('adapter-offline');await waitChrome('!document.querySelector("[data-recovery]").hidden');
    await command('adapter-online');await command('chrome-evaluate',"window.dispatchEvent(new Event('online'))");
    await waitChrome('document.querySelector("[data-recovery]").hidden');
    assert.equal(await command('evaluate','window.retainedDraft'),'synthetic draft','restoring a still-live protected document keeps its existing in-memory state without a forced reload');
    await command('evaluate',`window.workbenchDesktop.updateContext({epoch:'00000000-0000-4000-8000-000000000123',blocked:false,live:true,remindersAvailable:false})`);
    await command('evaluate',`window.workbenchDesktop.updateContext({epoch:'00000000-0000-4000-8000-000000000123',blocked:false,live:false,remindersAvailable:false})`);
    assert.equal(await command('evaluate','window.workbenchDesktop.setReminders(true)'),true,'notification preference is selectable while server delivery is unavailable');
    await command('evaluate',`window.workbenchDesktop.updateContext({epoch:'00000000-0000-4000-8000-000000000123',blocked:false,live:true,remindersAvailable:false})`);
    assert.equal(await command('evaluate','window.workbenchDesktop.getState().then(state=>state.remindersEnabled)'),true,'delivery capability changes must retain the user choice');
    assert.equal(await command('evaluate',`window.workbenchDesktop.showReminder({epoch:'00000000-0000-4000-8000-000000000123',id:'${'a'.repeat(64)}',kind:'ticket',itemId:'00000000-0000-4000-8000-000000000321'})`),false,'missing delivery capability cannot generate native notifications');
    await command('evaluate','window.workbenchDesktop.setReminders(false)');
    await command('arm-downloads');
    const attachment=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
    const download=(name:string,mime:string)=>command('evaluate',`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(attachment.toString('base64'))}),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:${JSON.stringify(mime)}})),link=document.createElement('a');link.href=url;link.download=${JSON.stringify(name)};document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);return true;})()`);
    await download('report-attachment.png','image/png');
    let receipt:{allowed:boolean;name:string;state?:string;sha256?:string;dialogTitle?:string}[]=[];
    const downloadDeadline=Date.now()+6000;while(Date.now()<downloadDeadline){receipt=await command('downloads') as typeof receipt;if(receipt[0]?.state==='completed'||receipt[0]?.allowed===false)break;await delay(50);}
    assert.equal(receipt[0]?.allowed,true,'explicit authorized attachment Blob must reach the native save path');assert.equal(receipt[0]?.state,'completed');assert.equal(receipt[0]?.sha256,createHash('sha256').update(attachment).digest('hex'));assert.equal(receipt[0]?.dialogTitle,'保存报修附件');
    await download('arbitrary.exe','application/octet-stream');const rejectedDeadline=Date.now()+3000;while(Date.now()<rejectedDeadline){receipt=await command('downloads') as typeof receipt;if(receipt.length===2)break;await delay(50);}assert.equal(receipt[1]?.allowed,false,'unrelated downloads stay blocked');
    await command('evaluate','window.workbenchDesktop.updateContext({epoch:null,blocked:true,live:false,remindersAvailable:false})');
    assert.equal(await command('evaluate','typeof window.desktopChrome+":"+typeof require'),'undefined:undefined','remote content cannot control the local titlebar or use Node');
    const chrome=(expression:string)=>command('chrome-evaluate',expression);
    assert.equal(await chrome('document.querySelectorAll(".window-actions button").length'),4);
    assert.equal(await chrome('getComputedStyle(document.querySelector(".titlebar")).height'),'40px');
    assert.equal(await chrome('getComputedStyle(document.querySelector(".window-actions")).getPropertyValue("-webkit-app-region")'),'no-drag');
    assert.equal(await chrome('getComputedStyle(document.querySelector(".titlebar")).getPropertyValue("-webkit-app-region")'),'drag');
    for(const size of [[1280,800],[1600,1000]]){
      await command('resize',JSON.stringify(size));
      const state=await command('state') as {viewBounds:{x:number;y:number;width:number;height:number};contentSize:number[];nativeMenuRemoved:boolean};
      assert.equal(state.nativeMenuRemoved,true);assert.equal(state.viewBounds.y,40);assert.equal(state.viewBounds.width,state.contentSize[0]);assert.equal(state.viewBounds.height,(state.contentSize[1]??0)-40);
    }
    await chrome('document.getElementById("maximize").click()');
    const until=Date.now()+5000;while(Date.now()<until&&await chrome('document.body.dataset.maximized')!=='true')await delay(50);
    assert.equal(await chrome('document.getElementById("maximize").getAttribute("aria-label")'),'还原窗口');
    await chrome('document.getElementById("maximize").click()');
    await chrome('document.getElementById("minimize").click()');assert.equal((await command('state') as {minimized:boolean}).minimized,true);
    await command('show');await chrome('document.getElementById("close").click()');assert.equal((await command('state') as {visible:boolean}).visible,false);await command('show');
    await command('evaluate','window.workbenchDesktop.updateContext({epoch:"11111111-1111-4111-8111-111111111111",blocked:true,live:true,remindersAvailable:true})');
    await command('attempt-quit');assert.equal((await command('state') as {windows:number}).windows,1,'protected input keeps the view alive');
    await command('evaluate','(async()=>{await window.workbenchDesktop.updateContext({epoch:"11111111-1111-4111-8111-111111111111",blocked:false,live:true,remindersAvailable:true});window.onbeforeunload=()=>false;return true;})()');
    await command('attempt-quit');await delay(150);
    assert.equal((await command('state') as {windows:number}).windows,1,'WebContentsView beforeunload still prevents destruction');
    assert.ok((await command('state') as {dialogs:number}).dialogs>=2,'both the app guard and native beforeunload guard actually ran');
    await command('evaluate','window.onbeforeunload=null; true');
    await command('navigate',origin+'/workbench/desktop/embedded');await wait('typeof window.workbenchLogin==="object"');
    const exited=new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('EXPLICIT_QUIT_TIMEOUT')),5000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
    void command('evaluate','window.workbenchLogin.quit();true').catch(()=>{});
    try{assert.equal(await exited,0,'the login quit action exits the entire application rather than hiding it');}
    catch(error){console.log('DESKTOP_QUIT_DIAGNOSTIC '+JSON.stringify(await command('lifecycle')));throw error;}
  }finally{
    releaseEmbeddedConfirmation();releaseConfirmation();
    releaseStartup();
    for(const slot of pending.values())clearTimeout(slot.timer);pending.clear();
    if(child.connected)child.disconnect();
    if(child.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
