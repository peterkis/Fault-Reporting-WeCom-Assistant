import {useSyncExternalStore} from 'react';
import {motionAllowed} from '../experience';

/** A failed optional import is sticky for this document; no reload or retry storm. */
function optionalModule<T>(load:()=>Promise<T>){
 let module:T|null=null,pending:Promise<void>|null=null;
 const listeners=new Set<()=>void>();
 const get=()=>module;
 const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
 return {get,use:()=>useSyncExternalStore(subscribe,get,get),load:()=>{
  if(!motionAllowed())return;
  pending??=load().then(value=>{module=value;for(const listener of listeners)listener();},()=>{});
 }};
}
export const decorations=optionalModule(()=>import('./decorations'));
export const interactions=optionalModule(()=>import('./interactions'));
export const sendFeedback=optionalModule(()=>import('./send'));
