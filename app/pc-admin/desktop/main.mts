import {app,BrowserWindow,WebContentsView,Menu,Tray,Notification,dialog,ipcMain,powerMonitor,session,nativeTheme,net} from 'electron';
import {mkdirSync,readFileSync,statSync,lstatSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allowedNavigation,allowedAttachmentDownload,businessDocument,embeddedLoginDocument,loginEntryPath,recoveryTarget,connectionFailure,EMBEDDED_LOGIN_PATH,OFFICIAL_LOGIN_PATH,navigationFailure,loginRefreshDelay,readConfig,readContext,readReminder,readChromeAction,motionPreference,TITLEBAR_HEIGHT} from './policy.mjs';
import type {LoginEntryPath} from './policy.mjs';
import type {DesktopContext,DesktopState,ChromeState,RecoveryState} from './policy.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const chromeUrl=new URL('./chrome.html',import.meta.url).href;
const loginChromeUrl=new URL('./login-chrome.html',import.meta.url).href;
// A bounded presentation fallback; this never changes origin, identity or authentication rules.
const defaultLoginEntry:LoginEntryPath=process.argv.includes('--wecom-login=official')?OFFICIAL_LOGIN_PATH:EMBEDDED_LOGIN_PATH;
const configFile=path.join(directory,'desktop.config.json');
if(statSync(configFile).size>2048)throw Error('DESKTOP_CONFIG_TOO_LARGE');
const config=readConfig(JSON.parse(readFileSync(configFile,'utf8').replace(/^\uFEFF/u,'')) as unknown);
const developmentRoot=process.env.WECOM_DESKTOP_DATA_ROOT;
if(!app.isPackaged&&!developmentRoot)throw Error('DESKTOP_DEVELOPMENT_DATA_ROOT_REQUIRED');
if(developmentRoot){
  const resolved=path.resolve(developmentRoot);
  if(!/^D:\\/iu.test(resolved)||resolved!==developmentRoot)throw Error('DESKTOP_DATA_ROOT_MUST_BE_ABSOLUTE_D_PATH');
  for(let parent=resolved;;parent=path.dirname(parent)){
    if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('DESKTOP_DATA_ROOT_REPARSE_REJECTED');
    if(parent===path.dirname(parent))break;
  }
  for(const name of ['userData','sessionData','temp','crashDumps'] as const){const value=path.join(resolved,name);mkdirSync(value,{recursive:true});app.setPath(name,value);}
  app.setAppLogsPath(path.join(resolved,'logs'));
}
app.setAppUserModelId('cn.mobimedical.yixiaoxiu.workbench');
app.commandLine.appendSwitch('disk-cache-size',String(128*1024*1024));
let window:BrowserWindow|null=null,tray:Tray|null=null,quitting=false,locked=false,suspended=false,enabled=false,revision=0;
let content:WebContentsView|null=null,loginChrome:WebContentsView|null=null,applicationMenu:Menu|null=null,menuOpen=false;
let recovery:RecoveryState=null,loginExpired=false,reconnect=()=>{};
let context:DesktopContext={epoch:null,blocked:true,live:false,remindersAvailable:false};
const notices=new Map<string,Notification>(),seen=new Map<string,number>();
const state=():DesktopState=>({version:1,visible:!!window?.isVisible()&&!window.isMinimized()&&!recovery,focused:!!window?.isFocused()&&!recovery,locked,suspended,remindersEnabled:enabled,revision});
const chromeState=():ChromeState=>({maximized:!!window?.isMaximized(),focused:!!window?.isFocused(),menuOpen,appVersion:app.getVersion(),booting:!content?.getVisible(),recovery,loginExpired});
function clearNotices(){for(const notice of notices.values())notice.close();notices.clear();}
function sendState(){
  if(!window||window.isDestroyed())return;
  if(content&&!content.webContents.isDestroyed()&&!content.webContents.isCrashed()&&businessDocument(content.webContents.getURL(),config.serverOrigin))content.webContents.send('desktop:state',state());
  if(!window.webContents.isDestroyed()&&window.webContents.getURL()===chromeUrl)window.webContents.send('chrome:state',chromeState());
  if(loginChrome&&!loginChrome.webContents.isDestroyed()&&loginChrome.webContents.getURL()===loginChromeUrl)loginChrome.webContents.send('chrome:state',{...chromeState(),menuOpen:false});
}
function show(){if(!window)return;if(window.isMinimized())window.restore();window.show();window.focus();content?.webContents.focus();}
function resetContext(){context={epoch:null,blocked:true,live:false,remindersAvailable:false};enabled=false;seen.clear();clearNotices();refreshTray();sendState();}
function refreshTray(){tray?.setContextMenu(Menu.buildFromTemplate([
  {label:'打开工作台',click:show},
  {label:'桌面提醒',type:'checkbox',checked:enabled,enabled:context.epoch!==null,click:item=>{enabled=item.checked;revision++;clearNotices();sendState();}},
  {type:'separator'},{label:'退出应用',click:requestQuit},
]));}
function guardLeave():boolean {
  if(window&&context.epoch&&context.blocked){show();void dialog.showMessageBox(window,{type:'info',message:'请先处理当前输入或核对未确认操作，再离开工作台。',buttons:['返回工作台']});return false;}
  return true;
}
function requestQuit(){
  if(!guardLeave())return;quitting=true;
  // The business view has its own lifecycle. Give its beforeunload guard the first decision.
  if(content&&!content.webContents.isDestroyed())content.webContents.close({waitForBeforeUnload:true});
  else if(window)window.close();else app.quit();
}
function login(entry:LoginEntryPath=defaultLoginEntry){if(!content||content.webContents.isDestroyed()||!guardLeave())return;void content.webContents.loadURL(config.serverOrigin+entry).catch(()=>{});}
function reload(){if(content&&!content.webContents.isDestroyed()&&guardLeave())content.webContents.reload();}
function zoom(delta:number|null){const target=content?.webContents;if(target&&!target.isDestroyed())target.setZoomLevel(delta===null?0:Math.min(3,Math.max(-1,target.getZoomLevel()+delta)));}
function edit(action:'undo'|'redo'|'cut'|'copy'|'paste'|'selectAll'){const target=content?.webContents;if(target&&!target.isDestroyed()){target.focus();target[action]();}}
function openMenu(){
  if(!window||!applicationMenu||menuOpen)return;menuOpen=true;sendState();
  applicationMenu.popup({window,x:Math.max(0,window.getContentBounds().width-246),y:TITLEBAR_HEIGHT,callback:()=>{menuOpen=false;sendState();if(!quitting&&window?.isVisible()&&content&&!content.webContents.isDestroyed())content.webContents.focus();}});
}
function admit(event:Electron.IpcMainInvokeEvent){
  if(!content||event.sender!==content.webContents||event.senderFrame!==content.webContents.mainFrame||!businessDocument(event.senderFrame.url,config.serverOrigin))throw Error('DESKTOP_SENDER_REJECTED');
}
function admitLogin(event:Electron.IpcMainInvokeEvent){
  if(!content||event.sender!==content.webContents||event.senderFrame!==content.webContents.mainFrame||!embeddedLoginDocument(event.senderFrame.url,config.serverOrigin))throw Error('DESKTOP_LOGIN_SENDER_REJECTED');
}
function admitChrome(event:Electron.IpcMainInvokeEvent):'standard'|'login'{
  if(window&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===chromeUrl)return 'standard';
  const local=loginChrome?.webContents;
  if(local&&!local.isDestroyed()&&event.sender===local&&event.senderFrame===local.mainFrame&&event.senderFrame.url===loginChromeUrl)return 'login';
  throw Error('DESKTOP_CHROME_SENDER_REJECTED');
}
ipcMain.handle('chrome:state',event=>{admitChrome(event);return chromeState();});
ipcMain.handle('chrome:command',(event,value:unknown)=>{const sender=admitChrome(event),action=readChromeAction(value);if(sender==='login'&&(action==='menu'||action==='reconnect'))throw Error('DESKTOP_CHROME_ACTION_REJECTED');switch(action){case 'reconnect':reconnect();break;case 'menu':openMenu();break;case 'minimize':window?.minimize();break;case 'maximize':if(window?.isMaximized())window.unmaximize();else window?.maximize();break;case 'close':window?.close();break;}});
ipcMain.handle('desktop:state',event=>{admit(event);return state();});
ipcMain.handle('desktop-login:version',event=>{admitLogin(event);return app.getVersion();});
ipcMain.handle('desktop-login:quit',event=>{admitLogin(event);requestQuit();});
ipcMain.handle('desktop:context',(event,value:unknown)=>{
  admit(event);const next=readContext(value);
  if(next.epoch!==context.epoch){enabled=false;seen.clear();clearNotices();revision++;}
  if(!next.live||!next.remindersAvailable)clearNotices();context=next;refreshTray();sendState();
});
ipcMain.handle('desktop:reminders',(event,value:unknown)=>{admit(event);if(typeof value!=='boolean')throw Error('DESKTOP_INPUT_INVALID');enabled=value&&context.epoch!==null;revision++;clearNotices();refreshTray();sendState();return enabled;});
ipcMain.handle('desktop:clear',(event,value:unknown)=>{admit(event);if(typeof value!=='string')throw Error('DESKTOP_INPUT_INVALID');if(value===context.epoch)clearNotices();});
ipcMain.handle('desktop:login',event=>{admit(event);login();});
ipcMain.handle('desktop:notify',(event,value:unknown)=>{
  admit(event);const reminder=readReminder(value);
  if(recovery||!enabled||!context.remindersAvailable||!context.live||reminder.epoch!==context.epoch||locked||suspended||!Notification.isSupported())return false;
  const now=Date.now();for(const [id,at] of seen)if(now-at>600_000)seen.delete(id);
  if(seen.has(reminder.id)||seen.size>=256)return false;
  seen.set(reminder.id,now);clearNotices();
  const notice=new Notification({title:'医小修工作台',body:'有新的服务事项，请打开工作台核验。',silent:true,icon:path.join(directory,'icon.png')});
  notices.set(reminder.id,notice);
  notice.once('click',()=>{if(reminder.epoch!==context.epoch||!context.remindersAvailable||!context.live||!enabled||locked||suspended)return;show();content?.webContents.send('desktop:locate',reminder);});
  notice.once('close',()=>{notices.delete(reminder.id);});notice.once('failed',()=>{notices.delete(reminder.id);});notice.show();return true;
});
if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',show);
  // Finish cancelling Electron's quit cycle before closing a child view; closing synchronously
  // here can re-enter quit while the original before-quit dispatch is still in progress.
  app.on('before-quit',event=>{if(!quitting){event.preventDefault();setImmediate(requestQuit);}});
  app.on('window-all-closed',()=>{tray?.destroy();tray=null;app.quit();});
  // Electron emits ready after the ESM entry finishes evaluating; a top-level await deadlocks startup.
  void app.whenReady().then(async()=>{
  nativeTheme.themeSource='light';Menu.setApplicationMenu(null);
  const ownedSession=session.fromPartition('persist:workbench');
  ownedSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ownedSession.setPermissionCheckHandler(()=>false);
  ownedSession.on('will-download',(event,item,source,frame)=>{
    const page=content&&!content.webContents.isDestroyed()?content.webContents:null;
    if(!page||source!==page||!frame||frame!==page.mainFrame||context.epoch===null||!businessDocument(frame.url,config.serverOrigin)||item.getInitiatorOrigin()!==config.serverOrigin
      ||!allowedAttachmentDownload({url:item.getURL(),filename:item.getFilename(),mime:item.getMimeType(),bytes:item.getTotalBytes()},config.serverOrigin)){event.preventDefault();return;}
    // Never choose a filesystem destination for the user. Electron opens its
    // native save dialog; the renderer has neither a path nor a native write API.
    item.setSaveDialogOptions({title:'保存报修附件',defaultPath:item.getFilename(),filters:[{name:'报修附件',extensions:[path.extname(item.getFilename()).slice(1)]}]});
  });
  window=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,title:'医小修工作台',icon:path.join(directory,'icon.ico'),backgroundColor:'#f7f7f5',frame:false,show:false,
    webPreferences:{preload:path.join(directory,'chrome-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false}});
  window.removeMenu();
  window.once('ready-to-show',()=>{if(!quitting)window?.show();});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.on('will-navigate',(event,url)=>{if(url!==chromeUrl)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));window.webContents.session.setPermissionCheckHandler(()=>false);
  content=new WebContentsView({webPreferences:{session:ownedSession,preload:path.join(directory,'preload.cjs'),additionalArguments:['--workbench-origin='+config.serverOrigin],sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,backgroundThrottling:false}});
  window.contentView.addChildView(content);
  loginChrome=new WebContentsView({webPreferences:{preload:path.join(directory,'chrome-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false}});
  const loginChromePage=loginChrome.webContents;
  loginChrome.setBackgroundColor('#00000000');loginChrome.setVisible(false);window.contentView.addChildView(loginChrome);
  loginChromePage.setWindowOpenHandler(()=>({action:'deny'}));loginChromePage.on('will-attach-webview',event=>event.preventDefault());
  loginChromePage.on('will-navigate',(event,url)=>{if(url!==loginChromeUrl)event.preventDefault();});
  loginChromePage.on('will-redirect',(event,url)=>{if(url!==loginChromeUrl)event.preventDefault();});
  loginChromePage.once('destroyed',()=>{loginChrome=null;});
  void loginChromePage.loadURL(loginChromeUrl).catch(()=>{});
  content.setBackgroundColor('#ffffff');
  // Keep the local startup surface visible while the first remote document is pending.
  content.setVisible(false);
  let loginPresentation=false;
  const layout=()=>{if(window&&content){const {width,height}=window.getContentBounds(),top=loginPresentation?0:TITLEBAR_HEIGHT;content.setBounds({x:0,y:top,width,height:Math.max(0,height-top)});loginChrome?.setBounds({x:0,y:0,width,height:TITLEBAR_HEIGHT});loginChrome?.setVisible(loginPresentation&&content.getVisible());}};
  layout();window.on('resize',layout);
  const page=content.webContents;
  let loginTimer:ReturnType<typeof setTimeout>|null=null,loginRefreshAt=0,pendingLogin=false;
  let pendingLoginPath:LoginEntryPath=EMBEDDED_LOGIN_PATH;
  let requestedDocument:{url:string;method:string}|null=null;
  let networkRetry:ReturnType<typeof setTimeout>|null=null,loadDeadline:ReturnType<typeof setTimeout>|null=null,networkAttempts=0;
  let target:string|null=null,lastDocument=config.serverOrigin+defaultLoginEntry,activeLoginEntry=defaultLoginEntry;
  let rendererCrashes=0,crashWindow=0;
  const clearRecoveryTimers=()=>{if(networkRetry)clearTimeout(networkRetry);if(loadDeadline)clearTimeout(loadDeadline);networkRetry=null;loadDeadline=null;};
  const finishRecovery=()=>{clearRecoveryTimers();networkAttempts=0;target=null;recovery=null;};
  const displayRecovery=(value:RecoveryState)=>{recovery=value;clearNotices();content?.setVisible(false);layout();sendState();};
  const queueRecovery=()=>{if(networkRetry||recovery==='failed')return;networkRetry=setTimeout(()=>{networkRetry=null;retryRecovery();},Math.min(30_000,1000*2**Math.min(networkAttempts++,5)));networkRetry.unref();};
  const retryRecovery=()=>{
    if(!target||page.isDestroyed()||!window||window.isDestroyed()||quitting||suspended)return;
    if(!net.isOnline()){displayRecovery('offline');queueRecovery();return;}
    if(page.isLoadingMainFrame())return;
    // A still-live document may have protected input. Resume it without navigating away.
    if(context.epoch&&context.blocked&&!page.isCrashed()){finishRecovery();content?.setVisible(true);layout();sendState();return;}
    clearRecoveryTimers();displayRecovery('reconnecting');
    loadDeadline=setTimeout(()=>{loadDeadline=null;if(!recovery)return;page.stop();displayRecovery(net.isOnline()?'unavailable':'offline');queueRecovery();},15_000);loadDeadline.unref();
    void page.loadURL(target).catch(()=>{});
  };
  const beginRecovery=(value:string,kind:RecoveryState='offline')=>{target=value;stopLoginTimer();pendingLogin=false;displayRecovery(kind);queueRecovery();};
  const checkConnection=()=>{
    if(page.isDestroyed()||quitting)return;
    if(!net.isOnline()){if(!recovery)beginRecovery(recoveryTarget(lastDocument,config.serverOrigin,'GET',activeLoginEntry)??config.serverOrigin+activeLoginEntry);return;}
    if(recovery&&recovery!=='failed')retryRecovery();
  };
  reconnect=()=>{if(!recovery)return;rendererCrashes=0;if(recovery==='failed')recovery='reconnecting';retryRecovery();};
  const connectionMonitor=setInterval(()=>{if(!net.isOnline()||recovery&&recovery!=='failed'&&!networkRetry)checkConnection();},2000);connectionMonitor.unref();
  window.on('focus',checkConnection);powerMonitor.on('resume',checkConnection);powerMonitor.on('unlock-screen',checkConnection);
  const stopLoginTimer=()=>{if(loginTimer)clearTimeout(loginTimer);loginTimer=null;loginRefreshAt=0;};
  const callbackDocument=(url:string)=>{try{const value=new URL(url);return value.origin===config.serverOrigin&&value.pathname==='/workbench/callback';}catch{return false;}};
  const renewLogin=()=>{
    if(!pendingLogin||page.isDestroyed()||!allowedNavigation(page.getURL(),config.serverOrigin)||businessDocument(page.getURL(),config.serverOrigin)||callbackDocument(page.getURL()))return;
    if(embeddedLoginDocument(page.getURL(),config.serverOrigin)){
      // The page owns its timer and coalesces native resume with its own pending renewal.
      void page.executeJavaScript("window.dispatchEvent(new Event('workbench-login-expired'))",false).catch(()=>{});return;
    }
    stopLoginTimer();pendingLogin=false;login(pendingLoginPath);
  };
  ownedSession.webRequest.onBeforeRequest((details,callback)=>{
    if(!page.isDestroyed()&&details.webContentsId===page.id&&details.resourceType==='mainFrame'){
      requestedDocument={url:details.url,method:details.method};
      const entry=loginEntryPath(details.url,config.serverOrigin);if(entry)activeLoginEntry=entry;
    }
    callback({});
  });
  ownedSession.webRequest.onHeadersReceived((details,callback)=>{
    if(details.webContentsId===page.id&&details.resourceType==='mainFrame'&&details.method==='GET'){
      const delay=loginRefreshDelay(details.url,config.serverOrigin,details.statusCode,details.responseHeaders??{});
      if(delay!==null){stopLoginTimer();pendingLogin=true;pendingLoginPath=embeddedLoginDocument(details.url,config.serverOrigin)?EMBEDDED_LOGIN_PATH:OFFICIAL_LOGIN_PATH;loginRefreshAt=Date.now()+delay;if(pendingLoginPath===OFFICIAL_LOGIN_PATH){loginTimer=setTimeout(renewLogin,delay);loginTimer.unref();}}
    }
    callback({});
  });
  const renewAfterIdle=()=>{if(loginRefreshAt&&Date.now()>=loginRefreshAt)renewLogin();};
  window.on('focus',renewAfterIdle);powerMonitor.on('resume',renewAfterIdle);powerMonitor.on('unlock-screen',renewAfterIdle);
  page.setWindowOpenHandler(()=>({action:'deny'}));page.on('will-attach-webview',event=>event.preventDefault());
  const navigation=(event:Electron.Event,url:string)=>{if(!allowedNavigation(url,config.serverOrigin))event.preventDefault();};
  page.on('will-navigate',navigation);page.on('will-redirect',navigation);
  page.on('will-frame-navigate',event=>{
    if(event.isMainFrame||!embeddedLoginDocument(page.getURL(),config.serverOrigin))return;
    if(event.url!=='about:blank'&&!allowedNavigation(event.url,config.serverOrigin))event.preventDefault();
    else if(event.url!=='about:blank'&&new URL(event.url).origin===config.serverOrigin)event.preventDefault();
  });
  let rejectedDocument=false;
  page.on('did-navigate',(_event,url,status)=>{
    const failure=navigationFailure(url,config.serverOrigin,status);
    rejectedDocument=failure!==null;
    if(failure&&window&&!window.isDestroyed()){
      const expiredLogin=pendingLogin&&status===400&&callbackDocument(url);
      stopLoginTimer();pendingLogin=false;
      resetContext();
      if(expiredLogin){login(pendingLoginPath);return;}
      if(status===401&&businessDocument(url,config.serverOrigin)){finishRecovery();loginExpired=true;login(activeLoginEntry);return;}
      finishRecovery();loginPresentation=false;layout();sendState();
      void page.loadFile(path.join(directory,'unavailable.html'),{hash:failure}).catch(()=>{});
    }
    if(!failure&&allowedNavigation(url,config.serverOrigin))lastDocument=recoveryTarget(url,config.serverOrigin,'GET',activeLoginEntry)??lastDocument;
    if(businessDocument(url,config.serverOrigin)){stopLoginTimer();pendingLogin=false;if(!failure){loginExpired=false;loginPresentation=false;layout();}}
  });
  page.on('did-navigate-in-page',(_event,url,mainFrame)=>{if(mainFrame&&businessDocument(url,config.serverOrigin))lastDocument=recoveryTarget(url,config.serverOrigin,'GET',activeLoginEntry)??lastDocument;});
  page.on('dom-ready',()=>{if(!rejectedDocument&&page.getURL()!=='about:blank'){finishRecovery();content?.setVisible(true);layout();sendState();}});
  page.on('did-start-navigation',(_event,url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace){
    if(loginEntryPath(url,config.serverOrigin)){loginPresentation=true;layout();}
    if(callbackDocument(url))stopLoginTimer();else if(embeddedLoginDocument(url,config.serverOrigin)||url===config.serverOrigin+OFFICIAL_LOGIN_PATH){stopLoginTimer();pendingLogin=false;}resetContext();
  }});
  page.on('did-finish-load',()=>{if(window?.isFocused()&&!menuOpen&&!recovery)page.focus();sendState();});window.webContents.on('did-finish-load',sendState);loginChromePage.on('did-finish-load',sendState);
  page.on('did-fail-load',(_event,code,_description,url,mainFrame)=>{if(mainFrame&&code!==-3&&window&&!window.isDestroyed()){
    rejectedDocument=true;
    const safeTarget=recoveryTarget(url,config.serverOrigin,requestedDocument?.url===url?requestedDocument.method:'',activeLoginEntry);
    stopLoginTimer();pendingLogin=false;
    if(safeTarget&&connectionFailure(code)){
      clearRecoveryTimers();beginRecovery(safeTarget,code===-106||!net.isOnline()?'offline':'unavailable');return;
    }
    finishRecovery();loginPresentation=false;layout();void page.loadFile(path.join(directory,'unavailable.html')).catch(()=>{});
  }});
  page.on('will-prevent-unload',()=>{quitting=false;finishRecovery();content?.setVisible(true);layout();sendState();show();void dialog.showMessageBox(window!,{type:'info',message:'当前页面有未保存或未确认的内容，请先在工作台完成核对。',buttons:['返回工作台']});});
  page.on('render-process-gone',()=>{
    if(quitting||page.isDestroyed())return;
    resetContext();clearRecoveryTimers();if(Date.now()-crashWindow>60_000){crashWindow=Date.now();rendererCrashes=0;}
    beginRecovery(recoveryTarget(lastDocument,config.serverOrigin,'GET',activeLoginEntry)??config.serverOrigin+activeLoginEntry,++rendererCrashes<=3?'reconnecting':'failed');
  });
  // A destroyed WebContentsView no longer exposes webContents. Drop the view before parent cleanup.
  page.on('destroyed',()=>{clearInterval(connectionMonitor);clearRecoveryTimers();stopLoginTimer();pendingLogin=false;content=null;reconnect=()=>{};if(quitting)setImmediate(()=>window?.close());});
  const shortcut=(event:Electron.Event,input:Electron.Input)=>{
    if(input.type!=='keyDown')return;
    if(input.alt&&input.key.toLowerCase()==='m'){event.preventDefault();openMenu();return;}
    if(input.key==='F5'||input.control&&!input.alt&&input.key.toLowerCase()==='r'){event.preventDefault();reload();return;}
    if(input.control&&!input.alt&&['+','=','-','0'].includes(input.key)){event.preventDefault();zoom(input.key==='0'?null:input.key==='-'?-.5:.5);}
  };
  page.on('before-input-event',shortcut);window.webContents.on('before-input-event',shortcut);loginChromePage.on('before-input-event',shortcut);
  window.on('close',event=>{if(!quitting){event.preventDefault();window?.hide();sendState();}});
  window.on('closed',()=>{if(!page.isDestroyed())page.close();if(!loginChromePage.isDestroyed())loginChromePage.close();content=null;loginChrome=null;window=null;clearNotices();});
  window.on('show',sendState);window.on('hide',sendState);window.on('minimize',sendState);window.on('restore',sendState);window.on('focus',sendState);window.on('blur',sendState);
  window.on('maximize',sendState);window.on('unmaximize',sendState);
  const powerChanged=()=>{revision++;clearNotices();sendState();};
  powerMonitor.on('lock-screen',()=>{locked=true;powerChanged();});powerMonitor.on('unlock-screen',()=>{locked=false;powerChanged();});
  powerMonitor.on('suspend',()=>{suspended=true;powerChanged();});powerMonitor.on('resume',()=>{suspended=false;powerChanged();});
  applicationMenu=Menu.buildFromTemplate([{label:'重新连接 / 登录',click:()=>login()},{label:'使用官方登录页',click:()=>login(OFFICIAL_LOGIN_PATH)},{label:'刷新工作台',accelerator:'Ctrl+R',click:reload},{type:'separator'},{label:'编辑',submenu:[{label:'撤销',click:()=>edit('undo')},{label:'重做',click:()=>edit('redo')},{type:'separator'},{label:'剪切',click:()=>edit('cut')},{label:'复制',click:()=>edit('copy')},{label:'粘贴',click:()=>edit('paste')},{label:'全选',click:()=>edit('selectAll')}]},{label:'页面缩放',submenu:[{label:'放大',accelerator:'Ctrl+=',click:()=>zoom(.5)},{label:'缩小',accelerator:'Ctrl+-',click:()=>zoom(-.5)},{label:'恢复默认大小',accelerator:'Ctrl+0',click:()=>zoom(null)}]},{type:'separator'},{label:'医小修 '+app.getVersion(),enabled:false},{label:'退出应用',click:requestQuit}]);
  tray=new Tray(path.join(directory,'icon.ico'));tray.setToolTip('医小修工作台');tray.on('double-click',show);refreshTray();
  void window.loadFile(path.join(directory,'chrome.html')).catch(()=>{});
  // Initialize only an empty owned target before applying the private presentation preference.
  // No debugging port or protocol capability is exposed to any renderer.
  await page.loadURL('about:blank');
  page.debugger.attach('1.3');
  await page.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motionPreference(process.argv)}]});
  login();
  }).catch(()=>{dialog.showErrorBox('医小修工作台','桌面程序初始化失败，请检查配置和数据目录。');app.exit(1);});
}
