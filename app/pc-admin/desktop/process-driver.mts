// Test-only Electron entry. Explicitly excluded from the staging/package allowlist.
import {app,BrowserWindow,WebContentsView,Notification,session,powerMonitor,dialog,Menu,net} from 'electron';
import {createHash,createPublicKey} from 'node:crypto';
import {writeFileSync,appendFileSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import './main.mjs';

const stage=process.env.WECOM_DESKTOP_TEST_STAGE,spki=process.env.WECOM_DESKTOP_TEST_SPKI;
if(!process.send||!stage||!spki||!path.resolve(stage).startsWith(path.resolve('.local/electron')+path.sep))throw Error('DESKTOP_TEST_CONTEXT_REQUIRED');
const loginControlsUrl=pathToFileURL(path.join(stage,'login-chrome.html')).href;
const notices:Notification[]=[];
const actualIsOnline=net.isOnline.bind(net);
const downloads:{allowed:boolean;name:string;state?:string;sha256?:string;bytes?:number;dialogTitle?:string}[]=[];let downloadObserver=false;
let dialogs=0;dialog.showMessageBox=async()=>{dialogs++;return {response:0,checkboxChecked:false};};
const diagnostics:{event:string;code?:number;path?:string;message?:string}[]=[];
const trace=(event:string)=>appendFileSync(path.join(process.env.WECOM_DESKTOP_DATA_ROOT!,'lifecycle.jsonl'),JSON.stringify({event,windows:BrowserWindow.getAllWindows().length})+'\n');
app.on('before-quit',()=>{diagnostics.push({event:'test-before-quit'});trace('before-quit');});
app.on('will-quit',()=>{diagnostics.push({event:'test-will-quit'});trace('will-quit');});
app.on('window-all-closed',()=>{diagnostics.push({event:'test-window-all-closed'});trace('window-all-closed');});
app.on('browser-window-created',(_event,window)=>{window.on('close',()=>trace('window-close'));window.on('closed',()=>trace('window-closed'));});
const nativeShow=Notification.prototype.show;
Notification.prototype.show=function(){notices.push(this);nativeShow.call(this);};
app.once('ready',()=>{
  session.fromPartition('persist:workbench').webRequest.onBeforeRequest((request,callback)=>{
    const url=new URL(request.url);callback({cancel:['https:','http:'].includes(url.protocol)&&url.hostname!=='127.0.0.1'});
  });
  session.fromPartition('persist:workbench').setCertificateVerifyProc((request,callback)=>{
    const actual=createHash('sha256').update(createPublicKey(request.certificate.data).export({type:'spki',format:'der'})).digest('base64');
    callback(request.hostname==='127.0.0.1'&&actual===spki?0:-3);
  });
});
app.on('web-contents-created',(_event,contents)=>{
  contents.on('destroyed',()=>trace('web-contents-destroyed'));
  contents.on('did-fail-load',(_event,code,_description,url)=>{diagnostics.push({event:'load-failed',code,path:new URL(url).pathname});});
  contents.on('console-message',(_event,_level,message)=>{if(diagnostics.length<40)diagnostics.push({event:'console',message:message.slice(0,1000)});});
});
process.on('message',async(value:unknown)=>{
  if(!value||typeof value!=='object'||!('id' in value)||!('action' in value))return;
  const command=value as {id:unknown;action:unknown;expression?:unknown};
  if(typeof command.id!=='number'||typeof command.action!=='string')return;
  try{
    if(command.action==='lifecycle'){process.send?.({id:command.id,ok:true,result:{windows:BrowserWindow.getAllWindows().length,diagnostics}});return;}
    const window=BrowserWindow.getAllWindows()[0];if(!window)throw Error('TEST_WINDOW_MISSING');
    const view=window.contentView.children.find((child):child is WebContentsView=>child instanceof WebContentsView&&child.webContents!==window.webContents);
    const page=view?.webContents??window.webContents;
    const loginControls=window.contentView.children.find((child):child is WebContentsView=>child instanceof WebContentsView&&child.webContents.getURL()===loginControlsUrl);
    let result:unknown;
    switch(command.action){
      case 'arm-downloads':{
        if(!downloadObserver){downloadObserver=true;page.session.on('will-download',(event,item)=>{
          const record:{allowed:boolean;name:string;state?:string;sha256?:string;bytes?:number;dialogTitle?:string}={allowed:!event.defaultPrevented,name:item.getFilename()};downloads.push(record);
          if(event.defaultPrevented)return;
          record.dialogTitle=item.getSaveDialogOptions().title??'';
          const downloadRoot=path.join(process.env.WECOM_DESKTOP_DATA_ROOT!,'downloads');mkdirSync(downloadRoot,{recursive:true});
          // Test-only stand-in for the user's save-dialog selection; never packaged.
          const target=path.join(downloadRoot,path.basename(record.name));item.setSavePath(target);
          item.once('done',(_event,state)=>{record.state=state;if(state==='completed'){const bytes=readFileSync(target);record.bytes=bytes.length;record.sha256=createHash('sha256').update(bytes).digest('hex');}});
        });}result=true;break;
      }
      case 'downloads':result=downloads;break;
      case 'evaluate':if(typeof command.expression!=='string')throw Error('TEST_EXPRESSION_REQUIRED');result=await page.executeJavaScript(command.expression,true);break;
      case 'chrome-evaluate':if(typeof command.expression!=='string')throw Error('TEST_EXPRESSION_REQUIRED');result=await window.webContents.executeJavaScript(command.expression,true);break;
      case 'login-chrome-evaluate':if(typeof command.expression!=='string'||!loginControls)throw Error('TEST_LOGIN_CHROME_REQUIRED');result=await loginControls.webContents.executeJavaScript(command.expression,true);break;
      case 'navigate':if(typeof command.expression!=='string'||!/^https:\/\/127\.0\.0\.1:\d+\/workbench\//u.test(command.expression))throw Error('TEST_LOOPBACK_URL_REQUIRED');void page.loadURL(command.expression).catch(()=>{});result=true;break;
      case 'hide':window.hide();result=true;break;
      case 'show':window.show();window.focus();page.focus();result=true;break;
      case 'resize':{const size:unknown=JSON.parse(String(command.expression));if(!Array.isArray(size)||size.length!==2||size.some(v=>!Number.isInteger(v)||v<650||v>2000))throw Error('TEST_SIZE_INVALID');window.setSize(size[0],size[1]);result=true;break;}
      case 'attempt-quit':app.quit();result=true;break;
      case 'lock':powerMonitor.emit('lock-screen');result=true;break;
      case 'unlock':powerMonitor.emit('unlock-screen');result=true;break;
      case 'suspend':powerMonitor.emit('suspend');result=true;break;
      case 'offline':await page.debugger.sendCommand('Network.enable');await page.debugger.sendCommand('Network.setCacheDisabled',{cacheDisabled:true});await page.debugger.sendCommand('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});result=true;break;
      case 'online':await page.debugger.sendCommand('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});result=true;break;
      case 'crash-renderer':page.forcefullyCrashRenderer();result=true;break;
      case 'adapter-offline':net.isOnline=()=>false;result=true;break;
      case 'adapter-online':net.isOnline=actualIsOnline;result=true;break;
      case 'network-failure':{const code=Number(command.expression);if(![-105,-106,-21,-200].includes(code))throw Error('TEST_NETWORK_CODE_INVALID');page.emit('did-fail-load',{},code,'SYNTHETIC_NETWORK',page.getURL(),true,0,0);result=true;break;}
      case 'resume-after-idle':{
        const elapsed=Number(command.expression);if(!Number.isSafeInteger(elapsed)||elapsed<0||elapsed>86400000)throw Error('TEST_IDLE_INVALID');
        const now=Date.now;try{Date.now=()=>now()+elapsed;powerMonitor.emit('resume');}finally{Date.now=now;}result=true;break;
      }
      case 'notification-click':notices.at(-1)?.emit('click');result=notices.length;break;
      case 'second-instance':result=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,[path.join(stage,'main.mjs')],{env:process.env,windowsHide:true,stdio:'ignore'});const timer=setTimeout(()=>{child.kill();reject(Error('SECOND_INSTANCE_TIMEOUT'));},10000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',error=>{clearTimeout(timer);reject(error);});});break;
      case 'screenshot':{window.show();window.focus();const image=await window.capturePage(undefined,{stayAwake:true});const target=path.join(process.env.WECOM_DESKTOP_DATA_ROOT!,'formal-workbench.png');writeFileSync(target,image.toPNG());result=target;break;}
      case 'state':result={url:page.getURL().split('?')[0],chromeUrl:window.webContents.getURL(),windows:BrowserWindow.getAllWindows().length,visible:window.isVisible(),minimized:window.isMinimized(),maximized:window.isMaximized(),windowBounds:window.getBounds(),contentSize:window.getContentSize(),viewBounds:view?.getBounds(),viewVisible:view?.getVisible(),loginControlsVisible:loginControls?.getVisible()??false,loginControlsBounds:loginControls?.getBounds(),nativeMenuRemoved:Menu.getApplicationMenu()===null&&!window.isMenuBarVisible(),dialogs,notifications:notices.length,paths:{userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),temp:app.getPath('temp')}};break;
      case 'quit':page.close({waitForBeforeUnload:true});result=true;break;
      default:throw Error('TEST_ACTION_UNKNOWN');
    }
    process.send?.({id:command.id,ok:true,result});
  }catch(error){process.send?.({id:command.id,ok:false,error:error instanceof Error?error.message:'TEST_FAILED'});}
});
process.on('disconnect',()=>{void (async()=>{
  for(const window of BrowserWindow.getAllWindows()){
    const view=window.contentView.children.find((child):child is WebContentsView=>child instanceof WebContentsView&&child.webContents!==window.webContents);const page=view?.webContents??window.webContents;
    try{await Promise.race([(async()=>{const snapshot=await page.executeJavaScript('JSON.stringify({path:location.pathname,title:document.title,text:document.body?.innerText?.slice(0,1400),bridge:typeof window.workbenchDesktop,realtime:document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus,visibility:document.visibilityState})');writeFileSync(path.join(process.env.WECOM_DESKTOP_DATA_ROOT!,'diagnostic.json'),JSON.stringify({snapshot,diagnostics,visible:window.isVisible(),viewVisible:view?.getVisible()}));await window.capturePage(undefined,{stayHidden:true}).then(image=>writeFileSync(path.join(process.env.WECOM_DESKTOP_DATA_ROOT!,'final-screen.png'),image.toPNG()));})(),new Promise<void>(resolve=>setTimeout(resolve,1500))]);}catch{}
    window.destroy();
  }app.exit(0);
})();});
void app.whenReady().then(()=>{process.send?.({ready:true});});
