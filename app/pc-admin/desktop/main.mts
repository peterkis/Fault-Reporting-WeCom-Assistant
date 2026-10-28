import {app,BrowserWindow,WebContentsView,Menu,Tray,Notification,dialog,ipcMain,powerMonitor,session,nativeTheme} from 'electron';
import {mkdirSync,readFileSync,statSync,lstatSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allowedNavigation,businessDocument,navigationFailure,readConfig,readContext,readReminder,readChromeAction,TITLEBAR_HEIGHT} from './policy.mjs';
import type {DesktopContext,DesktopState} from './policy.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const chromeUrl=new URL('./chrome.html',import.meta.url).href;
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
let content:WebContentsView|null=null,applicationMenu:Menu|null=null,menuOpen=false;
let context:DesktopContext={epoch:null,blocked:true,live:false,remindersAvailable:false};
const notices=new Map<string,Notification>(),seen=new Map<string,number>();
const state=():DesktopState=>({version:1,visible:!!window?.isVisible()&&!window.isMinimized(),focused:!!window?.isFocused(),locked,suspended,remindersEnabled:enabled,revision});
function clearNotices(){for(const notice of notices.values())notice.close();notices.clear();}
function sendState(){
  if(!window||window.isDestroyed())return;
  if(content&&!content.webContents.isDestroyed()&&businessDocument(content.webContents.getURL(),config.serverOrigin))content.webContents.send('desktop:state',state());
  if(!window.webContents.isDestroyed()&&window.webContents.getURL()===chromeUrl)window.webContents.send('chrome:state',{maximized:window.isMaximized(),focused:window.isFocused(),menuOpen});
}
function show(){if(!window)return;if(window.isMinimized())window.restore();window.show();window.focus();content?.webContents.focus();}
function resetContext(){context={epoch:null,blocked:true,live:false,remindersAvailable:false};enabled=false;seen.clear();clearNotices();refreshTray();sendState();}
function refreshTray(){tray?.setContextMenu(Menu.buildFromTemplate([
  {label:'打开工作台',click:show},
  {label:'桌面提醒',type:'checkbox',checked:enabled,enabled:context.epoch!==null&&context.remindersAvailable,click:item=>{enabled=item.checked;revision++;clearNotices();sendState();}},
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
function login(){if(!content||content.webContents.isDestroyed()||!guardLeave())return;void content.webContents.loadURL(config.serverOrigin+'/workbench/desktop').catch(()=>{});}
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
function admitChrome(event:Electron.IpcMainInvokeEvent){if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==chromeUrl)throw Error('DESKTOP_CHROME_SENDER_REJECTED');}
ipcMain.handle('chrome:state',event=>{admitChrome(event);return {maximized:window!.isMaximized(),focused:window!.isFocused(),menuOpen};});
ipcMain.handle('chrome:command',(event,value:unknown)=>{admitChrome(event);switch(readChromeAction(value)){case 'menu':openMenu();break;case 'minimize':window?.minimize();break;case 'maximize':if(window?.isMaximized())window.unmaximize();else window?.maximize();break;case 'close':window?.close();break;}});
ipcMain.handle('desktop:state',event=>{admit(event);return state();});
ipcMain.handle('desktop:context',(event,value:unknown)=>{
  admit(event);const next=readContext(value);
  if(next.epoch!==context.epoch||!next.remindersAvailable){enabled=false;seen.clear();clearNotices();revision++;}
  if(!next.live)clearNotices();context=next;refreshTray();sendState();
});
ipcMain.handle('desktop:reminders',(event,value:unknown)=>{admit(event);if(typeof value!=='boolean')throw Error('DESKTOP_INPUT_INVALID');enabled=value&&context.epoch!==null&&context.remindersAvailable;revision++;clearNotices();refreshTray();sendState();return enabled;});
ipcMain.handle('desktop:clear',(event,value:unknown)=>{admit(event);if(typeof value!=='string')throw Error('DESKTOP_INPUT_INVALID');if(value===context.epoch)clearNotices();});
ipcMain.handle('desktop:login',event=>{admit(event);login();});
ipcMain.handle('desktop:notify',(event,value:unknown)=>{
  admit(event);const reminder=readReminder(value);
  if(!enabled||!context.live||reminder.epoch!==context.epoch||locked||suspended||!Notification.isSupported())return false;
  const now=Date.now();for(const [id,at] of seen)if(now-at>600_000)seen.delete(id);
  if(seen.has(reminder.id)||seen.size>=256)return false;
  seen.set(reminder.id,now);clearNotices();
  const notice=new Notification({title:'医小修工作台',body:'有新的服务事项，请打开工作台核验。',silent:true,icon:path.join(directory,'icon.png')});
  notices.set(reminder.id,notice);
  notice.once('click',()=>{if(reminder.epoch!==context.epoch||!context.live||!enabled||locked||suspended)return;show();content?.webContents.send('desktop:locate',reminder);});
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
  void app.whenReady().then(()=>{
  nativeTheme.themeSource='light';Menu.setApplicationMenu(null);
  const ownedSession=session.fromPartition('persist:workbench');
  ownedSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ownedSession.setPermissionCheckHandler(()=>false);
  ownedSession.on('will-download',(event)=>event.preventDefault());
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
  content.setBackgroundColor('#ffffff');
  // Keep the local startup surface visible while the first remote document is pending.
  content.setVisible(false);
  const layout=()=>{if(window&&content){const {width,height}=window.getContentBounds();content.setBounds({x:0,y:TITLEBAR_HEIGHT,width,height:Math.max(0,height-TITLEBAR_HEIGHT)});}};
  layout();window.on('resize',layout);
  const page=content.webContents;
  page.setWindowOpenHandler(()=>({action:'deny'}));page.on('will-attach-webview',event=>event.preventDefault());
  const navigation=(event:Electron.Event,url:string)=>{if(!allowedNavigation(url,config.serverOrigin))event.preventDefault();};
  page.on('will-navigate',navigation);page.on('will-redirect',navigation);
  let rejectedDocument=false;
  page.on('did-navigate',(_event,url,status)=>{
    const failure=navigationFailure(url,config.serverOrigin,status);
    rejectedDocument=failure!==null;
    if(failure&&window&&!window.isDestroyed()){
      resetContext();
      void page.loadFile(path.join(directory,'unavailable.html'),{hash:failure}).catch(()=>{});
    }
  });
  page.on('dom-ready',()=>{if(!rejectedDocument&&page.getURL()!=='about:blank')content?.setVisible(true);});
  page.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)resetContext();});
  page.on('did-finish-load',()=>{if(window?.isFocused()&&!menuOpen)page.focus();sendState();});window.webContents.on('did-finish-load',sendState);
  page.on('did-fail-load',(_event,code,_description,_url,mainFrame)=>{if(mainFrame&&code!==-3&&window&&!window.isDestroyed())void page.loadFile(path.join(directory,'unavailable.html')).catch(()=>{});});
  page.on('will-prevent-unload',()=>{quitting=false;show();void dialog.showMessageBox(window!,{type:'info',message:'当前页面有未保存或未确认的内容，请先在工作台完成核对。',buttons:['返回工作台']});});
  page.on('render-process-gone',()=>{resetContext();show();});
  // A destroyed WebContentsView no longer exposes webContents. Drop the view before parent cleanup.
  page.on('destroyed',()=>{content=null;if(quitting)setImmediate(()=>window?.close());});
  const shortcut=(event:Electron.Event,input:Electron.Input)=>{
    if(input.type!=='keyDown')return;
    if(input.alt&&input.key.toLowerCase()==='m'){event.preventDefault();openMenu();return;}
    if(input.key==='F5'||input.control&&!input.alt&&input.key.toLowerCase()==='r'){event.preventDefault();reload();return;}
    if(input.control&&!input.alt&&['+','=','-','0'].includes(input.key)){event.preventDefault();zoom(input.key==='0'?null:input.key==='-'?-.5:.5);}
  };
  page.on('before-input-event',shortcut);window.webContents.on('before-input-event',shortcut);
  window.on('close',event=>{if(!quitting){event.preventDefault();window?.hide();sendState();}});
  window.on('closed',()=>{if(!page.isDestroyed())page.close();content=null;window=null;clearNotices();});
  window.on('show',sendState);window.on('hide',sendState);window.on('minimize',sendState);window.on('restore',sendState);window.on('focus',sendState);window.on('blur',sendState);
  window.on('maximize',sendState);window.on('unmaximize',sendState);
  const powerChanged=()=>{revision++;clearNotices();sendState();};
  powerMonitor.on('lock-screen',()=>{locked=true;powerChanged();});powerMonitor.on('unlock-screen',()=>{locked=false;powerChanged();});
  powerMonitor.on('suspend',()=>{suspended=true;powerChanged();});powerMonitor.on('resume',()=>{suspended=false;powerChanged();});
  applicationMenu=Menu.buildFromTemplate([{label:'重新连接 / 登录',click:login},{label:'刷新工作台',accelerator:'Ctrl+R',click:reload},{type:'separator'},{label:'编辑',submenu:[{label:'撤销',click:()=>edit('undo')},{label:'重做',click:()=>edit('redo')},{type:'separator'},{label:'剪切',click:()=>edit('cut')},{label:'复制',click:()=>edit('copy')},{label:'粘贴',click:()=>edit('paste')},{label:'全选',click:()=>edit('selectAll')}]},{label:'页面缩放',submenu:[{label:'放大',accelerator:'Ctrl+=',click:()=>zoom(.5)},{label:'缩小',accelerator:'Ctrl+-',click:()=>zoom(-.5)},{label:'恢复默认大小',accelerator:'Ctrl+0',click:()=>zoom(null)}]},{type:'separator'},{label:'医小修 '+app.getVersion(),enabled:false},{label:'退出应用',click:requestQuit}]);
  tray=new Tray(path.join(directory,'icon.ico'));tray.setToolTip('医小修工作台');tray.on('double-click',show);refreshTray();
  void window.loadFile(path.join(directory,'chrome.html')).catch(()=>{});login();
  }).catch(()=>{dialog.showErrorBox('医小修工作台','桌面程序初始化失败，请检查配置和数据目录。');app.exit(1);});
}
