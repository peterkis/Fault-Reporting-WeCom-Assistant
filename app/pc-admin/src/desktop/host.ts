import {useEffect,useMemo} from 'react';
import type {DesktopBridge,DesktopState} from '../../desktop/policy.mjs';
import type {Principal} from '../api/client';
import type {RealtimeView} from '../realtime/useRealtime';
declare global {interface Window {workbenchDesktop?:DesktopBridge}}
export const desktopHost=window.workbenchDesktop?.version===1?window.workbenchDesktop:undefined;
let nativeState:DesktopState={version:1,visible:false,focused:false,locked:false,suspended:false,remindersEnabled:false,revision:0};
const listeners=new Set<()=>void>();
export const getDesktopState=()=>nativeState;
export const subscribeDesktopState=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function receive(state:DesktopState){
  if(JSON.stringify(state)===JSON.stringify(nativeState))return;
  nativeState=state;for(const listener of listeners)listener();
  // Electron's backgroundThrottling=false keeps Chromium "visible". Fan out the real native change;
  // readers use isWorkbenchVisible/isWorkbenchForeground, never that synthetic Chromium visibility.
  document.dispatchEvent(new Event('visibilitychange'));
}
if(desktopHost){
  let received=false;desktopHost.onState(state=>{received=true;receive(state);});
  void desktopHost.getState().then(state=>{if(!received)receive(state);}).catch(()=>{});
}
export const isWorkbenchVisible=()=>desktopHost?nativeState.visible&&!nativeState.locked&&!nativeState.suspended:document.visibilityState!=='hidden';
export const isWorkbenchForeground=()=>isWorkbenchVisible()&&document.hasFocus()&&(!desktopHost||nativeState.focused);
export const canRunWorkbenchTransport=()=>isWorkbenchVisible()||!!desktopHost&&nativeState.remindersEnabled&&!nativeState.locked&&!nativeState.suspended;
export function closeDesktopSession(){void desktopHost?.updateContext({epoch:null,blocked:false,live:false,remindersAvailable:false}).catch(()=>{});}
export function useDesktopSession(principal:Principal,realtime:RealtimeView,blocked:boolean):string {
  const authority=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision]);
  const epoch=useMemo(()=>crypto.randomUUID(),[authority]);
  useEffect(()=>()=>closeDesktopSession(),[epoch]);
  const remindersAvailable=principal.workbench_reminders_enabled===true&&principal.realtime_sse_enabled;
  useEffect(()=>{void desktopHost?.updateContext({epoch,blocked,live:realtime.status==='live',remindersAvailable}).catch(()=>{});},[epoch,blocked,realtime.status,remindersAvailable]);
  return epoch;
}
