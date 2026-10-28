import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createHash,createPublicKey,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

test('real Electron main navigation replaces HTTP JSON errors and still opens successful pages',{timeout:45000,skip:process.platform!=='win32'},async()=>{
  const root=process.cwd(),id=randomUUID(),stage=path.join(root,'.local/electron/temp','navigation-'+id),profile=path.join(root,'.local/electron/profiles','navigation-'+id);
  mkdirSync(stage,{recursive:true});mkdirSync(profile,{recursive:true});
  execFileSync('D:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(stage,'key.pem'),'-out',path.join(stage,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
  const cert=readFileSync(path.join(stage,'cert.pem')),key=readFileSync(path.join(stage,'key.pem'));
  const spki=createHash('sha256').update(createPublicKey(cert).export({type:'spki',format:'der'})).digest('base64');
  let status=404;
  let releaseStartup=()=>{};
  const startup=new Promise<void>(resolve=>{releaseStartup=resolve;});
  const server=createServer({key,cert},async(_request,response)=>{
    await startup;
    response.writeHead(status,{'content-type':status===200?'text/html; charset=utf-8':'application/json'});
    response.end(status===200?'<!doctype html><title>管理端</title><main>可用管理端</main>':JSON.stringify({error:{code:status===404?'WORKBENCH_NOT_FOUND':'WORKBENCH_UNAVAILABLE',retryable:false}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const origin='https://127.0.0.1:'+address.port;
  for(const file of ['main.mjs','policy.mjs','preload.cjs','unavailable.html','package.json','icon.ico','icon.png','chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs'])copyFileSync(path.join(root,'.local/electron/stage',file),path.join(stage,file));
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
  const wait=async(expression:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){if(await command('evaluate',expression))return;await delay(50);}throw Error('EXPECTED_FRIENDLY_HTTP_ERROR_NOT_RENDERED');};
  try{
    const deadline=Date.now()+10000;while(!ready&&Date.now()<deadline)await delay(50);assert.ok(ready);
    assert.equal(await command('chrome-evaluate','document.querySelector(".titlebar")!==null'),true);
    const showDeadline=Date.now()+5000;
    while(!(await command('state') as {visible:boolean}).visible&&Date.now()<showDeadline)await delay(50);
    assert.equal((await command('state') as {visible:boolean}).visible,true,'the local startup window must become visible without waiting for a remote response');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,false,'the unpainted remote view must not cover local startup content while the server is pending');
    assert.equal(await command('chrome-evaluate','document.querySelector("[data-startup]")?.getBoundingClientRect().height>0'),true,'local startup content must be visible before the first response');
    const startupImage=await command('screenshot');assert.ok(typeof startupImage==='string'&&startupImage.startsWith(profile+path.sep));
    console.log('DESKTOP_STARTUP '+JSON.stringify({local_visible_before_response:true,remote_hidden:true,screenshot:{file:startupImage,sha256:createHash('sha256').update(readFileSync(startupImage)).digest('hex')}}));
    releaseStartup();
    await wait('document.body?.innerText.includes("服务器尚未提供桌面入口")');
    assert.equal((await command('state') as {viewVisible:boolean}).viewVisible,true,'the first rendered document replaces startup content');
    assert.equal(await command('evaluate','document.body.innerText.includes("WORKBENCH_NOT_FOUND")'),false);
    for(const [code,expected] of [[503,'服务暂时不可用'],[403,'当前账号无法进入工作台'],[200,'可用管理端']] as const){
      status=code;await command('navigate',origin+'/workbench/desktop');await wait('document.body?.innerText.includes('+JSON.stringify(expected)+')');
    }
    await command('navigate',origin+'/workbench/app/');await wait('typeof window.workbenchDesktop==="object"');
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
    const exited=new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('EXPLICIT_QUIT_TIMEOUT')),5000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
    void command('attempt-quit').catch(()=>{});
    try{assert.equal(await exited,0,'explicit quit closes both titlebar and business renderer');}
    catch(error){console.log('DESKTOP_QUIT_DIAGNOSTIC '+JSON.stringify(await command('lifecycle')));throw error;}
  }finally{
    releaseStartup();
    for(const slot of pending.values())clearTimeout(slot.timer);pending.clear();
    if(child.connected)child.disconnect();
    if(child.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
