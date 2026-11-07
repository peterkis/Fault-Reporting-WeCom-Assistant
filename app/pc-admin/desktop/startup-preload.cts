import {contextBridge,ipcRenderer} from 'electron';
import type {StartupBridge,StartupState} from './policy.mjs';

if(process.isMainFrame){
  const bridge:StartupBridge={
    state:()=>ipcRenderer.invoke('startup:state'),
    event:value=>ipcRenderer.invoke('startup:event',value),
    onState:callback=>{const listener=(_event:Electron.IpcRendererEvent,value:StartupState)=>callback(value);ipcRenderer.on('startup:state',listener);return()=>{ipcRenderer.removeListener('startup:state',listener);};},
  };
  contextBridge.exposeInMainWorld('desktopStartup',Object.freeze(bridge));
}
