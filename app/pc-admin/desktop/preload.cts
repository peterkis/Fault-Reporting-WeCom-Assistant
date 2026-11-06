import {contextBridge,ipcRenderer} from 'electron';
import type {DesktopBridge,DesktopState,DesktopReminder,LoginBridge,LoginLease} from './policy.mjs';

const origin=process.argv.find(value=>value.startsWith('--workbench-origin='))?.slice('--workbench-origin='.length);
if(process.isMainFrame&&origin===location.origin&&location.pathname==='/workbench/desktop/embedded'&&!location.search&&!location.hash){
  // This lease stays in the isolated preload. It belongs to one committed document,
  // not to the URL or renderer process, which may be reused by a later navigation.
  let lease:LoginLease|null=null,presented=false,disposed=false;
  const callbacks=new Set<()=>void>();
  let offer:(value:LoginLease)=>void=()=>{};
  const offered=new Promise<LoginLease>(resolve=>{offer=resolve;});
  const presentation=(_event:Electron.IpcRendererEvent,value:unknown)=>{
    if(disposed||!value||typeof value!=='object'||Array.isArray(value))return;
    if(!('generation' in value)||typeof value.generation!=='number'||!Number.isSafeInteger(value.generation)||value.generation<1
      ||!('nonce' in value)||typeof value.nonce!=='string'||!/^[0-9a-f-]{36}$/u.test(value.nonce)
      ||!('presented' in value)||typeof value.presented!=='boolean')return;
    if(lease&&(lease.nonce!==value.nonce||lease.generation!==value.generation))return;
    if(!lease){lease={generation:value.generation,nonce:value.nonce};offer(lease);}
    if(value.presented&&!presented){presented=true;for(const callback of callbacks)callback();}
  };
  ipcRenderer.on('desktop-login:presentation',presentation);
  window.addEventListener('pagehide',()=>{disposed=true;callbacks.clear();ipcRenderer.removeListener('desktop-login:presentation',presentation);},{once:true});
  const bridge:LoginBridge={version:1,getAppVersion:()=>ipcRenderer.invoke('desktop-login:version'),quit:()=>ipcRenderer.invoke('desktop-login:quit'),startup:{version:1,
    connect:async()=>{const current=await offered;if(disposed)throw Error('DESKTOP_LOGIN_DOCUMENT_GONE');await ipcRenderer.invoke('desktop-login:connect',current);},
    prepared:async value=>{const current=await offered;if(disposed)throw Error('DESKTOP_LOGIN_DOCUMENT_GONE');return ipcRenderer.invoke('desktop-login:prepared',{lease:current,prepared:value});},
    onPresented:callback=>{callbacks.add(callback);if(presented)queueMicrotask(()=>{if(!disposed&&callbacks.has(callback))callback();});return()=>{callbacks.delete(callback);};},
  }};
  contextBridge.exposeInMainWorld('workbenchLogin',Object.freeze(bridge));
}
if(process.isMainFrame&&origin===location.origin&&(location.pathname==='/workbench/app'||location.pathname.startsWith('/workbench/app/'))){
  const stateEvent=(callback:(state:DesktopState)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:DesktopState)=>callback(value);
    ipcRenderer.on('desktop:state',listener);return()=>{ipcRenderer.removeListener('desktop:state',listener);};
  };
  const bridge:DesktopBridge={version:1,
    getState:()=>ipcRenderer.invoke('desktop:state'),onState:stateEvent,
    updateContext:context=>ipcRenderer.invoke('desktop:context',context),
    setReminders:enabled=>ipcRenderer.invoke('desktop:reminders',enabled),
    showReminder:reminder=>ipcRenderer.invoke('desktop:notify',reminder),
    clearReminders:epoch=>ipcRenderer.invoke('desktop:clear',epoch),
    onReminderClick:callback=>{const listener=(_event:Electron.IpcRendererEvent,value:DesktopReminder)=>callback(value);ipcRenderer.on('desktop:locate',listener);return()=>{ipcRenderer.removeListener('desktop:locate',listener);};},
    requestLogin:()=>ipcRenderer.invoke('desktop:login'),
  };
  contextBridge.exposeInMainWorld('workbenchDesktop',Object.freeze(bridge));
}
