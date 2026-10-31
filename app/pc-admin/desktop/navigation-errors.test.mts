import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createHash,createPublicKey,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

test('real Electron navigation recovers offline/crashes and keeps authentication/window guards',{timeout:90000,skip:process.platform!=='win32'},async()=>{
  const root=process.cwd(),id=randomUUID(),stage=path.join(root,'.local/electron/temp','navigation-'+id),profile=path.join(root,'.local/electron/profiles','navigation-'+id);
  mkdirSync(stage,{recursive:true});mkdirSync(profile,{recursive:true});
  execFileSync('D:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(stage,'key.pem'),'-out',path.join(stage,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
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
  for(const file of ['main.mjs','policy.mjs','preload.cjs','unavailable.html','package.json','icon.ico','icon.png','chrome.html','login-chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs'])copyFileSync(path.join(root,'.local/electron/stage',file),path.join(stage,file));
  for(const file of ['main.mjs','policy.mjs','preload.cjs','chrome.mjs','chrome-preload.cjs']){copyFileSync(path.join(root,'.local/electron/compiled',file),path.join(stage,file));assert.deepEqual(readFileSync(path.join(stage,file)),readFileSync(path.join(root,'.local/electron/compiled',file)));}
  copyFileSync(path.join(root,'.local/electron/compiled/process-driver.mjs'),path.join(stage,'process-driver.mjs'));
  const packageInfo=JSON.parse(readFileSync(path.join(stage,'package.json'),'utf8'));packageInfo.main='process-driver.mjs';writeFileSync(path.join(stage,'package.json'),JSON.stringify(packageInfo));
  writeFileSync(path.join(stage,'desktop.config.json'),JSON.stringify({schemaVersion:1,serverOrigin:origin}));
  const env:NodeJS.ProcessEnv={...process.env,WECOM_DESKTOP_DATA_ROOT:profile,WECOM_DESKTOP_TEST_STAGE:stage,WECOM_DESKTOP_TEST_SPKI:spki};delete env.ELECTRON_RUN_AS_NODE;
  // This GUI test observes the app's first show. SW_HIDE would override that first
  // native ShowWindow call and require the test driver to manufacture visibility.
  const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[stage],{cwd:root,env,windowsHide:false,stdio:['ignore','ignore','pipe','ipc']});
  child.stderr?.on('data',(chunk:Buffer)=>writeFileSync(path.join(profile,'process-stderr.log'),chunk,{flag:'a'}));
  let ready=false,next=1;const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  child.on('message',(value:unknown)=>{if(!value||typeof value!=='object')return;const message=value as Record<string,unknown>;if(message.ready===true){ready=true;return;}if(typeof message.id!=='number')return;const slot=pending.get(message.id);if(!slot)return;clearTimeout(slot.timer);pending.delete(message.id);if(message.ok)slot.resolve(message.result);else slot.reject(Error(String(message.error)));});
  const command=(action:string,expression?:string):Promise<unknown>=>new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(Error('TEST_COMMAND_TIMEOUT'));},5000);pending.set(id,{resolve,reject,timer});child.send({id,action,expression});});
  const wait=async(expression:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){try{if(await command('evaluate',expression))return;}catch(error){if(!(error instanceof Error)||!/Render frame was disposed|frame was destroyed|Script failed to execute/u.test(error.message))throw error;}await delay(50);}throw Error('EXPECTED_FRIENDLY_HTTP_ERROR_NOT_RENDERED');};
  const waitChrome=async(expression:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){if(await command('chrome-evaluate',expression))return;await delay(50);}throw Error('EXPECTED_LOCAL_RECOVERY_NOT_RENDERED');};
  try{
    const deadline=Date.now()+10000;while(!ready&&Date.now()<deadline)await delay(50);assert.ok(ready);
    assert.equal(await command('chrome-evaluate','document.querySelector(".titlebar")!==null'),true);
    assert.equal(await command('chrome-evaluate','document.querySelector(".surface-name").textContent'),'v'+packageInfo.version,'the trusted titlebar renders the actual package version');
    assert.equal(await command('chrome-evaluate','(()=>{const button=document.getElementById("menu");button.focus();return getComputedStyle(button).outlineStyle;})()'),'none','titlebar controls follow the app focus policy');
    const showDeadline=Date.now()+5000;
    while(!(await command('state') as {visible:boolean}).visible&&Date.now()<showDeadline)await delay(50);
    assert.equal((await command('state') as {visible:boolean}).visible,true,'the local startup window must become visible without waiting for a remote response');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,false,'the unpainted remote view must not cover local startup content while the server is pending');
    assert.equal(await command('chrome-evaluate','document.querySelector("[data-startup]")?.getBoundingClientRect().height>0'),true,'local startup content must be visible before the first response');
    const startupImage=await command('screenshot');assert.ok(typeof startupImage==='string'&&startupImage.startsWith(profile+path.sep));
    console.log('DESKTOP_STARTUP '+JSON.stringify({local_visible_before_response:true,remote_hidden:true,screenshot:{file:startupImage,sha256:createHash('sha256').update(readFileSync(startupImage)).digest('hex')}}));
    assert.equal(await command('chrome-evaluate','document.querySelector(".startup-columns,.startup-card,.startup-line")===null'),true,'before authentication the native startup surface must not impersonate the ticket workbench');
    assert.equal(await command('chrome-evaluate','document.body.dataset.booting'),'true');
    assert.deepEqual(await command('chrome-evaluate','(()=>{const loader=document.querySelector("[data-startup] .loader"),track=loader?.querySelector(".loader-track"),r=loader?.getBoundingClientRect(),s=track&&getComputedStyle(track),a=track?.getAnimations()[0];if(!r||!s||!a)return null;a.pause();const positions=[0,1000,2000,3000,3999].map(time=>{a.currentTime=time;return Math.round(new DOMMatrixReadOnly(getComputedStyle(track).transform).m42)});a.play();return {width:r.width,height:r.height,centered:Math.abs(r.x+r.width/2-innerWidth/2)<1&&Math.abs(r.y+r.height/2-innerHeight/2)<1,duration:s.animationDuration,animation:s.animationName,label:document.querySelector("[data-startup]").getAttribute("aria-label"),words:Array.from(loader.querySelectorAll(".loader-word"),e=>e.textContent),colors:Array.from(loader.querySelectorAll(".loader-word"),e=>getComputedStyle(e).color),positions,noWorkbench:!document.body.innerText.includes("正在连接")&&!document.body.innerText.includes("工作台")};})()'),{width:208,height:40,centered:true,duration:'4s',animation:'loader-word-roll',label:'正在加载登录页面',words:['登录页面','扫码入口','工牌视图','医小修','登录页面'],colors:['rgb(7, 132, 239)','rgb(229, 72, 77)','rgb(220, 169, 0)','rgb(35, 165, 102)','rgb(7, 132, 239)'],positions:[0,-40,-80,-120,-160],noWorkbench:true},'startup uses the centered reference word roller, shared login colors and a seamless repeated first word');
    assert.equal(await command('chrome-evaluate','Array.from(document.querySelectorAll(".window-actions button")).filter(button=>button.getBoundingClientRect().width>0).length'),3,'startup exposes window controls without the workbench menu');
    releaseStartup();
    await wait('document.body?.innerText.includes("服务器尚未提供桌面入口")');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,true,'the first rendered document replaces startup content');
    assert.equal(await command('chrome-evaluate','document.querySelector("[data-startup]").hidden'),true,'the first remote document retires the native startup surface');
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
    assert.equal(await command('login-chrome-evaluate','document.querySelectorAll(".window-actions button").length'),3);
    assert.equal(await command('login-chrome-evaluate','document.querySelector("#menu,.identity,[data-startup]")===null'),true,'login has no application menu or title strip content');
    assert.equal(await command('login-chrome-evaluate','getComputedStyle(document.body).backgroundColor'),'rgba(0, 0, 0, 0)');
    assert.equal(await command('login-chrome-evaluate','window.desktopChrome.command("menu").then(()=>false,()=>true)'),true,'login controls cannot open the application menu');
    assert.equal(await command('login-chrome-evaluate','window.desktopChrome.command("reconnect").then(()=>false,()=>true)'),true,'transparent login controls do not acquire the local recovery action');
    assert.equal(await command('evaluate','typeof window.desktopChrome'),'undefined','remote login does not acquire window commands');
    assert.equal(await command('evaluate','typeof window.workbenchDesktop'),'undefined','embedded login has no business IPC');
    assert.equal(await command('evaluate','Object.keys(window.workbenchLogin).sort().join(":")'),'getAppVersion:quit:version','login exposes only its bounded display/lifecycle methods');
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
