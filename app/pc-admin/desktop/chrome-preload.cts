import {contextBridge,ipcRenderer} from 'electron';
import type {ChromeBridge,ChromeState} from './policy.mjs';
if(process.isMainFrame){
  const bridge:ChromeBridge={
    state:()=>ipcRenderer.invoke('chrome:state'),
    command:action=>ipcRenderer.invoke('chrome:command',action),
    onState:callback=>{const listener=(_event:Electron.IpcRendererEvent,state:ChromeState)=>callback(state);ipcRenderer.on('chrome:state',listener);return()=>{ipcRenderer.removeListener('chrome:state',listener);};},
  };
  contextBridge.exposeInMainWorld('desktopChrome',Object.freeze(bridge));
}
