import {contextBridge,ipcRenderer} from 'electron';
import type {DesktopBridge,DesktopState,DesktopReminder,LoginBridge} from './policy.mjs';

const origin=process.argv.find(value=>value.startsWith('--workbench-origin='))?.slice('--workbench-origin='.length);
if(process.isMainFrame&&origin===location.origin&&location.pathname==='/workbench/desktop/embedded'&&!location.search&&!location.hash){
  const bridge:LoginBridge={version:1,getAppVersion:()=>ipcRenderer.invoke('desktop-login:version'),quit:()=>ipcRenderer.invoke('desktop-login:quit')};
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
